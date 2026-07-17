import { describe, expect, it } from "vitest";
import { computeContainRect, EXPORT_FORMATS } from "./multiFormatExport";

describe("computeContainRect", () => {
  it("letterboxes a landscape creative into 9:16 without cropping", () => {
    const r = computeContainRect(1920, 1080, 1080, 1920);
    // Full width of destination used (landscape is width-limited into tall frame)
    expect(r.drawW).toBe(1080);
    expect(r.drawH).toBeLessThan(1920);
    expect(r.dx).toBe(0);
    expect(r.dy).toBeGreaterThan(0);
    // Entire source aspect preserved
    expect(r.drawW / r.drawH).toBeCloseTo(1920 / 1080, 2);
  });

  it("letterboxes a square creative into marketplace 1.91:1 without cropping", () => {
    const r = computeContainRect(1080, 1080, 1200, 628);
    expect(r.drawH).toBe(628);
    expect(r.drawW).toBeLessThan(1200);
    expect(r.dy).toBe(0);
    expect(r.dx).toBeGreaterThan(0);
    expect(r.drawW / r.drawH).toBeCloseTo(1, 2);
  });

  it("fills feed 1:1 when source is already square", () => {
    const r = computeContainRect(1080, 1080, 1080, 1080);
    expect(r.drawW).toBe(1080);
    expect(r.drawH).toBe(1080);
    expect(r.dx).toBe(0);
    expect(r.dy).toBe(0);
  });
});

describe("computeCoverRect", () => {
  it("fills 9:16 from landscape by overflowing height (backdrop only)", async () => {
    const { computeCoverRect } = await import("./multiFormatExport");
    const r = computeCoverRect(1920, 1080, 1080, 1920);
    expect(r.drawW).toBeGreaterThanOrEqual(1080);
    expect(r.drawH).toBeGreaterThanOrEqual(1920);
  });
});

describe("EXPORT_FORMATS", () => {
  it("lists story before feed for mobile-first dealership traffic", () => {
    expect(EXPORT_FORMATS[0].id).toBe("story_vertical");
    expect(EXPORT_FORMATS[1].id).toBe("feed_square");
  });
});
