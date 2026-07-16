import { describe, expect, it } from "vitest";
import {
  defaultWeekHours,
  parseHoursString,
  serializeHours,
  minutesToLabel,
  labelToMinutes,
} from "./hoursFormat";

describe("hoursFormat", () => {
  it("round-trips common open week", () => {
    const week = defaultWeekHours();
    week.sun.open = false;
    const text = serializeHours(week);
    expect(text).toMatch(/Mon/);
    expect(text.toLowerCase()).toMatch(/closed|sun/i);
    const parsed = parseHoursString(text);
    expect(parsed).not.toBeNull();
    expect(parsed!.mon.open).toBe(true);
    expect(parsed!.sun.open).toBe(false);
  });

  it("converts minutes labels", () => {
    expect(minutesToLabel(9 * 60)).toBe("9:00 AM");
    expect(minutesToLabel(20 * 60)).toBe("8:00 PM");
    expect(labelToMinutes("9:00 AM")).toBe(9 * 60);
    expect(labelToMinutes("8:00 PM")).toBe(20 * 60);
  });

  it("parses collapsed weekday string", () => {
    const parsed = parseHoursString(
      "Mon–Fri 9:00 AM–8:00 PM, Sat 9:00 AM–6:00 PM, Sun closed",
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.mon.open).toBe(true);
    expect(parsed!.fri.openMinutes).toBe(9 * 60);
    expect(parsed!.sat.closeMinutes).toBe(18 * 60);
    expect(parsed!.sun.open).toBe(false);
  });
});
