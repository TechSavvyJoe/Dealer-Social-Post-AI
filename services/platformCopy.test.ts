import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLATFORM_IDS,
  getPlatformOptions,
  orderExportFormatsByPreference,
  parsePlatformCaptionPack,
  platformsToCaptionPackBrief,
  platformsToCreativeBrief,
  platformCopyGuidance,
  preferredExportFormatIds,
  shouldGenerateCaptionPack,
} from "./platformCopy";
import { EXPORT_FORMATS } from "../utils/multiFormatExport";

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

  it("builds a caption pack brief with JSON keys for selected platforms", () => {
    const brief = platformsToCaptionPackBrief(
      ["instagram_feed", "tiktok", "x_twitter"],
      "Bob Maxey Ford of Howell",
      "Primary caption about a new F-150.",
    );
    expect(brief).toContain("Bob Maxey Ford of Howell");
    expect(brief).toContain("instagram_feed");
    expect(brief).toContain("tiktok");
    expect(brief).toContain("x_twitter");
    expect(brief).toContain("Primary caption about a new F-150.");
    expect(brief).toMatch(/JSON object/i);
    expect(platformCopyGuidance("x_twitter")).toMatch(/280/);
  });

  it("parses JSON caption packs", () => {
    const raw = JSON.stringify({
      instagram_feed: "IG feed caption",
      tiktok: "TikTok punchy line #cars",
      ignored: "nope",
    });
    const pack = parsePlatformCaptionPack(raw, [
      "instagram_feed",
      "tiktok",
      "facebook_feed",
    ]);
    expect(pack).toEqual({
      instagram_feed: "IG feed caption",
      tiktok: "TikTok punchy line #cars",
    });
  });

  it("parses fenced JSON and delimited caption packs", () => {
    const fenced = '```json\n{"instagram_story":"Story line"}\n```';
    expect(parsePlatformCaptionPack(fenced, ["instagram_story"]).instagram_story).toBe(
      "Story line",
    );

    const delimited = `
=== instagram_feed ===
Feed body here

=== tiktok ===
TikTok body
`;
    const pack = parsePlatformCaptionPack(delimited, ["instagram_feed", "tiktok"]);
    expect(pack.instagram_feed).toBe("Feed body here");
    expect(pack.tiktok).toBe("TikTok body");
  });

  it("only recommends a pack when 2+ platforms are selected", () => {
    expect(shouldGenerateCaptionPack([])).toBe(false);
    expect(shouldGenerateCaptionPack(["instagram_feed"])).toBe(false);
    expect(shouldGenerateCaptionPack(["instagram_feed", "facebook_feed"])).toBe(true);
  });

  it("orders export formats by preferred ids", () => {
    const preferred = preferredExportFormatIds(["gbp", "facebook_feed"]);
    const ordered = orderExportFormatsByPreference(EXPORT_FORMATS, preferred);
    expect(ordered[0].id).toBe(preferred[0]);
    expect(ordered.map((f) => f.id)).toEqual(
      expect.arrayContaining(EXPORT_FORMATS.map((f) => f.id)),
    );
    expect(ordered).toHaveLength(EXPORT_FORMATS.length);
  });
});
