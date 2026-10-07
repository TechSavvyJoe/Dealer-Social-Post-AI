import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLATFORM_IDS,
  getPlatformOptions,
  getSecondaryPlatformOptions,
  orderExportFormatsByPreference,
  platformsToCreativeBrief,
  preferredExportFormatIds,
  resolveHistoryPlatformIds,
  resolvePrimaryImageProfile,
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
