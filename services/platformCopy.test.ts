import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLATFORM_IDS,
  getPlatformOptions,
  platformsToCreativeBrief,
  preferredExportFormatIds,
} from "./platformCopy";

describe("platformCopy", () => {
  it("exposes primary platforms with story bias", () => {
    const options = getPlatformOptions();
    expect(options.length).toBeGreaterThanOrEqual(4);
    expect(DEFAULT_PLATFORM_IDS).toContain("instagram_story");
    expect(DEFAULT_PLATFORM_IDS).toContain("instagram_feed");
  });

  it("builds a store-specific multi-platform brief", () => {
    const brief = platformsToCreativeBrief(
      ["instagram_story", "facebook_feed"],
      "Bob Maxey Ford of Howell",
    );
    expect(brief).toContain("Bob Maxey Ford of Howell");
    expect(brief).toMatch(/Instagram Story|story/i);
    expect(brief).toMatch(/Facebook/i);
  });

  it("prefers story_vertical when any vertical platform is selected", () => {
    const formats = preferredExportFormatIds(["tiktok", "facebook_feed"]);
    expect(formats[0]).toBe("story_vertical");
    expect(formats).toContain("feed_square");
  });
});
