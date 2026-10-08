import { describe, expect, it } from "vitest";
import { checkSpinVideo, spinFrameAt, spinSampleTimes, spinZoom } from "./vehicleSpin";

describe("walkaround frame planning", () => {
  it("samples one full turn without repeating the last angle", () => {
    const times = spinSampleTimes(4, 28, 30);
    expect(times).toHaveLength(48);
    expect(times[0]).toBe(4);
    expect(times[47]).toBe(27.5);
    expect(new Set(times).size).toBe(48);
  });
  it.each([
    [-1, 12, 20],
    [0, 25, 20],
    [2, 3, 20],
    [0, 181, 181],
    [NaN, 12, 20],
    [0, Infinity, 20],
    [0, 12, 0],
  ])("rejects invalid capture range %s–%s (%s)", (start, end, duration) => {
    expect(() => spinSampleTimes(start, end, duration)).toThrow();
  });
  it("wraps both rotation directions and clamps zoom", () => {
    expect(spinFrameAt(-1, 48)).toBe(47);
    expect(spinFrameAt(50, 48)).toBe(2);
    expect(spinFrameAt(1, 0)).toBe(0);
    expect(spinZoom(0.5)).toBe(1);
    expect(spinZoom(5)).toBe(3);
    expect(spinZoom(NaN)).toBe(1);
  });
  it("accepts phone MOV files without a supplied MIME and rejects other uploads", () => {
    expect(() => checkSpinVideo(new File(["test"], "walkaround.MOV"))).not.toThrow();
    expect(() =>
      checkSpinVideo(new File(["test"], "notes.txt", { type: "text/plain" })),
    ).toThrow();
    expect(() =>
      checkSpinVideo(new File([], "empty.mp4", { type: "video/mp4" })),
    ).toThrow();
  });
});
