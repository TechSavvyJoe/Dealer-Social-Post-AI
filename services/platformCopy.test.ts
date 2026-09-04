import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLATFORM_IDS,
  getPlatformOptions,
  getSecondaryPlatformOptions,
  orderExportFormatsByPreference,
  parsePlatformCaptionPack,
  platformsToCaptionPackBrief,
  platformsToCreativeBrief,
  platformCopyGuidance,
  preferredExportFormatIds,
  resolveHistoryPlatformIds,
  resolvePrimaryImageProfile,
  shouldGenerateCaptionPack,
} from "./platformCopy";
import { EXPORT_FORMATS } from "../utils/multiFormatExport";
import { PUBLISH_TARGETS } from "./publishTargets";

describe("platformCopy", () => {
  it("exposes primary platforms with story bias", () => {
    const options = getPlatformOptions();
    expect(options.length).toBeGreaterThanOrEqual(4);
    expect(DEFAULT_PLATFORM_IDS).toContain("instagram_story");
    expect(DEFAULT_PLATFORM_IDS).toContain("instagram_feed");
  });

  it("derives secondary editor destinations from the canonical publish registry", () => {
    const primaryIds = new Set(getPlatformOptions().map((option) => option.id));
    const secondaryIds = getSecondaryPlatformOptions().map((option) => option.id);
    const registrySecondaryIds = PUBLISH_TARGETS.filter(
      (target) => !primaryIds.has(target.id),
    ).map((target) => target.id);

    expect(secondaryIds).toEqual(registrySecondaryIds);
    expect(secondaryIds).toEqual([
      "instagram_reel",
      "marketplace",
      "linkedin",
      "x_twitter",
      "native_share",
    ]);
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
    expect(formats).toContain("feed_portrait");
  });

  it.each([
    {
      platforms: ["instagram_story", "facebook_feed"],
      format: "story_vertical",
      aspect: "9:16",
    },
    {
      platforms: ["facebook_feed", "gbp"],
      format: "feed_portrait",
      aspect: "4:5",
    },
    { platforms: ["gbp"], format: "gbp", aspect: "4:3" },
    { platforms: ["marketplace"], format: "marketplace", aspect: "16:9" },
    { platforms: [], format: "feed_square", aspect: "1:1" },
  ])(
    "maps $platforms to the $format native generation profile",
    ({ platforms, format, aspect }) => {
      expect(resolvePrimaryImageProfile(platforms)).toMatchObject({
        primaryFormatId: format,
        imageAspectRatio: aspect,
      });
    },
  );

  it("uses a Website-native square profile when no social destination is selected", () => {
    expect(resolvePrimaryImageProfile([])).toEqual({
      primaryFormatId: "feed_square",
      imageAspectRatio: "1:1",
      label: "Social Feed · 1:1",
    });
  });

  it("preserves explicit Website-only history while restoring legacy social outputs", () => {
    expect(
      resolveHistoryPlatformIds([], {
        tiktok: "A stale caption must not override an explicit empty selection.",
      }),
    ).toEqual([]);

    expect(
      resolveHistoryPlatformIds(undefined, {
        facebook_feed: "Facebook copy",
        instagram_feed: "Instagram copy",
      }),
    ).toEqual(["facebook_feed", "instagram_feed"]);

    expect(resolveHistoryPlatformIds(undefined)).toEqual(DEFAULT_PLATFORM_IDS);
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
    // The structured shape the server's `caption_pack_v1` schema pins.
    expect(brief).toContain('{"captions":[{"platformId":"...","caption":"..."}]}');
    // The legacy grammars stay documented for a proxy without the registry.
    expect(brief).toContain("A flat object keyed by platform id is also accepted");
    expect(brief).toContain("=== instagram_feed ===");
    expect(platformCopyGuidance("x_twitter")).toMatch(/280/);
  });

  it("parses the structured caption_pack_v1 captions array", () => {
    const raw = JSON.stringify({
      captions: [
        { platformId: "instagram_feed", caption: "  IG feed caption  " },
        { platformId: "tiktok", caption: "TikTok punchy line #cars" },
        // Ids outside the selected destinations never become captions.
        { platformId: "linkedin", caption: "Not requested" },
        // Malformed entries are skipped, not fatal.
        { platformId: "facebook_feed", caption: "   " },
        { caption: "no id" },
        null,
      ],
    });

    expect(
      parsePlatformCaptionPack(raw, ["instagram_feed", "tiktok", "facebook_feed"]),
    ).toEqual({
      instagram_feed: "IG feed caption",
      tiktok: "TikTok punchy line #cars",
    });
  });

  it("still recovers prose-mode packs from a proxy without the schema registry", () => {
    // Fenced structured array.
    const fencedStructured =
      '```json\n{"captions":[{"platformId":"instagram_story","caption":"Story line"}]}\n```';
    expect(parsePlatformCaptionPack(fencedStructured, ["instagram_story"])).toEqual({
      instagram_story: "Story line",
    });

    // Structured array wrapped in commentary.
    const chatty =
      'Here you go:\n{"captions":[{"platformId":"tiktok","caption":"TikTok body"}]}\nHope that helps!';
    expect(parsePlatformCaptionPack(chatty, ["tiktok"])).toEqual({
      tiktok: "TikTok body",
    });

    // Legacy flat object and delimited blocks keep working unchanged.
    expect(
      parsePlatformCaptionPack(JSON.stringify({ tiktok: "Flat body" }), ["tiktok"]),
    ).toEqual({ tiktok: "Flat body" });
    expect(
      parsePlatformCaptionPack("=== tiktok ===\nDelimited body", ["tiktok"]),
    ).toEqual({ tiktok: "Delimited body" });
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
