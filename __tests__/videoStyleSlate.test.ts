import { describe, expect, it } from "vitest";
import { VideoStyle } from "../types";
import {
  EXPOSED_VIDEO_STYLES,
  UNEXPOSED_VIDEO_STYLES,
  styles as videoStyleSlate,
} from "../components/video-director/constants";

/**
 * The curated motion slate (brand-consistency direction, 2026-09-02) that the
 * dealer settings Creative section offers. This case lived in the retired
 * PostResult suite; the constants it pins are still live.
 */
describe("video style slate", () => {
  it("exposes exactly the curated slate and names every unreachable enum value", () => {
    expect(EXPOSED_VIDEO_STYLES).toEqual(videoStyleSlate.map((entry) => entry.style));
    expect(new Set(EXPOSED_VIDEO_STYLES).size).toBe(EXPOSED_VIDEO_STYLES.length);

    const all = Object.values(VideoStyle);
    expect([...EXPOSED_VIDEO_STYLES, ...UNEXPOSED_VIDEO_STYLES].sort()).toEqual(
      [...all].sort(),
    );
    expect(UNEXPOSED_VIDEO_STYLES).toHaveLength(9);
    expect(
      EXPOSED_VIDEO_STYLES.filter((style) => UNEXPOSED_VIDEO_STYLES.includes(style)),
    ).toEqual([]);
  });
});
