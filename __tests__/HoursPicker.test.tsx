import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HoursPicker } from "../components/HoursPicker";
import { defaultWeekHours, type WeekHours } from "../utils/hoursFormat";

const week = (): WeekHours => defaultWeekHours();

describe("HoursPicker", () => {
  it("lists the week as hairline rows in one panel with sentence-case status tags", () => {
    render(<HoursPicker value={week()} onChange={vi.fn()} preview="Mon–Sat 9:00 AM" />);
    const panel = screen.getByRole("group", { name: "Business hours" });
    const rows = within(panel).getAllByRole("listitem");
    expect(rows).toHaveLength(7);
    for (const row of rows) {
      expect(row.className).toContain("border-hairline");
      expect(row.className).not.toMatch(/\brounded|\bbg-/);
    }
    const monday = within(rows[0]).getByText("Open");
    expect(monday.className).toContain("text-success-ink");
    expect(monday.className).not.toMatch(/uppercase|tracking-/);
    expect(within(rows[6]).getByText("Closed")).toBeInTheDocument();
    expect(screen.getByText("Mon–Sat 9:00 AM")).toBeInTheDocument();
  });

  it("toggles a day and copies Monday to the weekdays", () => {
    const onChange = vi.fn();
    const value = week();
    value.mon = { open: true, openMinutes: 8 * 60, closeMinutes: 20 * 60 };
    render(<HoursPicker value={value} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /^Sun/ }));
    expect(onChange.mock.calls[0][0].sun.open).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Copy Mon → weekdays" }));
    const copied = onChange.mock.calls[1][0] as WeekHours;
    for (const day of ["tue", "wed", "thu", "fri"] as const) {
      expect(copied[day]).toEqual(value.mon);
    }
    expect(copied.sat).toEqual(value.sat);
  });
});
