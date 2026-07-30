import { describe, expect, it } from "vitest";
import { PUBLISH_TARGETS } from "./publishTargets";
import {
  PLATFORM_OUTPUT_PROFILES,
  buildPlatformOutputFilename,
  buildPlatformOutputLabel,
  derivePlatformDeliveryPlan,
  getPlatformOutputProfile,
  type LegacyPlatformId,
  type NativeImageAspectRatio,
  type NativeVeoAspectRatio,
  type OutputAspectRatio,
  type SupportedPlatformOutput,
} from "./platformOutputs";

const expectedRatio: Record<OutputAspectRatio, number> = {
  "1:1": 1,
  "4:5": 4 / 5,
  "9:16": 9 / 16,
  "16:9": 16 / 9,
  "1.91:1": 1.91,
  "4:3": 4 / 3,
};

describe("platform output contract", () => {
  it("has one unique row for every configured destination/media pair", () => {
    const ids = PLATFORM_OUTPUT_PROFILES.map((profile) => profile.profileId);
    expect(new Set(ids).size).toBe(ids.length);

    const legacyIds = PUBLISH_TARGETS.map((target) => target.id).filter(
      (id): id is LegacyPlatformId => id !== "instagram_reel",
    );
    for (const destinationId of legacyIds) {
      expect(ids).toContain(`${destinationId}:photo`);
      expect(ids).toContain(`${destinationId}:video`);
    }
  });

  it("keeps supported dimensions consistent with their advertised ratio", () => {
    const supported = PLATFORM_OUTPUT_PROFILES.filter(
      (profile): profile is SupportedPlatformOutput => profile.supported,
    );
    for (const profile of supported) {
      const actual = profile.output.width / profile.output.height;
      const advertised = expectedRatio[profile.output.aspectRatio];
      expect(
        actual,
        `${profile.profileId} dimensions do not match ${profile.output.aspectRatio}`,
      ).toBeCloseTo(advertised, 2);
      expect(profile.output.width).toBeGreaterThanOrEqual(1080);
      expect(profile.output.height).toBeGreaterThanOrEqual(628);
    }
  });

  it("uses only canonical Gemini image ratios", () => {
    const allowed = new Set<NativeImageAspectRatio>([
      "1:1",
      "4:5",
      "9:16",
      "16:9",
      "4:3",
    ]);
    const imageProfiles = PLATFORM_OUTPUT_PROFILES.filter(
      (profile): profile is SupportedPlatformOutput =>
        profile.supported && profile.preparation.kind === "image",
    );

    for (const profile of imageProfiles) {
      expect(allowed.has(profile.preparation.nativeAspectRatio)).toBe(true);
    }
    expect(getPlatformOutputProfile("instagram_feed", "photo")).toMatchObject({
      supported: true,
      output: { aspectRatio: "4:5", width: 1080, height: 1350 },
      preparation: {
        nativeAspectRatio: "4:5",
        transform: "exact-resize",
      },
    });
    expect(getPlatformOutputProfile("marketplace", "photo")).toMatchObject({
      supported: true,
      output: { aspectRatio: "1.91:1", width: 1200, height: 628 },
      preparation: {
        nativeAspectRatio: "16:9",
        transform: "contain-with-backdrop",
      },
    });
  });

  it("uses only native Veo ratios and encodes the 1080p duration constraint", () => {
    const allowed = new Set<NativeVeoAspectRatio>(["9:16", "16:9"]);
    const videos = PLATFORM_OUTPUT_PROFILES.filter(
      (profile): profile is SupportedPlatformOutput =>
        profile.supported && profile.mediaKind === "video",
    );

    for (const profile of videos) {
      expect(profile.preparation.kind).toBe("veo");
      if (profile.preparation.kind !== "veo") continue;
      expect(allowed.has(profile.preparation.nativeAspectRatio)).toBe(true);
      expect(profile.preparation.resolution).toBe("1080p");
      expect(profile.preparation.durationSeconds).toBe(8);
      expect(profile.preparation.transform).toBe("none");
      expect(profile.mimeType).toBe("video/mp4");
      expect(profile.extension).toBe("mp4");
    }
  });

  it("routes a legacy Instagram video selection to a Reel", () => {
    const plan = derivePlatformDeliveryPlan(["instagram_feed"], "video");
    expect(plan.deliveries).toHaveLength(1);
    expect(plan.deliveries[0]).toMatchObject({
      id: "instagram_reel:video",
      destinationId: "instagram_reel",
      mediaKind: "video",
      requestedVia: ["instagram_feed"],
    });
    expect(plan.unsupported).toEqual([]);
  });

  it("routes both media kinds to the appropriate Instagram post types", () => {
    const plan = derivePlatformDeliveryPlan(["instagram_feed"], "both", "Delivery 42");
    expect(plan.deliveries.map((delivery) => delivery.id)).toEqual([
      "instagram_feed:photo",
      "instagram_reel:video",
    ]);
    expect(plan.deliveries[0].filename).toBe(
      "delivery-42-instagram-feed-photo-4x5-1080x1350.jpg",
    );
    expect(plan.deliveries[1].filename).toBe(
      "delivery-42-instagram-reel-video-9x16-1080x1920.mp4",
    );
  });

  it("deduplicates identical vertical masters without merging delivery actions", () => {
    const plan = derivePlatformDeliveryPlan(
      ["instagram_feed", "instagram_story", "tiktok"],
      "both",
    );

    expect(plan.deliveries.map((delivery) => delivery.id)).toEqual([
      "instagram_feed:photo",
      "instagram_reel:video",
      "instagram_story:photo",
      "instagram_story:video",
      "tiktok:photo",
      "tiktok:video",
    ]);
    expect(plan.assets).toHaveLength(3);

    const verticalPhoto = plan.assets.find(
      (asset) =>
        asset.mediaKind === "photo" &&
        asset.output.width === 1080 &&
        asset.output.height === 1920,
    );
    expect(verticalPhoto?.deliveryProfileIds).toEqual([
      "instagram_story:photo",
      "tiktok:photo",
    ]);

    const verticalVideo = plan.assets.find(
      (asset) =>
        asset.mediaKind === "video" &&
        asset.output.width === 1080 &&
        asset.output.height === 1920,
    );
    expect(verticalVideo?.deliveryProfileIds).toEqual([
      "instagram_reel:video",
      "instagram_story:video",
      "tiktok:video",
    ]);
  });

  it("supports a saveable exact output for every configured photo/video selection", () => {
    const plan = derivePlatformDeliveryPlan(["gbp", "marketplace", "linkedin"], "both");

    expect(plan.deliveries.map((delivery) => delivery.id)).toEqual([
      "gbp:photo",
      "gbp:video",
      "marketplace:photo",
      "marketplace:video",
      "linkedin:photo",
      "linkedin:video",
    ]);
    expect(plan.unsupported).toEqual([]);
  });

  it("deduplicates repeated selections while retaining how the delivery was requested", () => {
    const plan = derivePlatformDeliveryPlan(
      ["instagram_feed", "instagram_reel", "instagram_feed"],
      "video",
    );
    expect(plan.deliveries).toHaveLength(1);
    expect(plan.deliveries[0].id).toBe("instagram_reel:video");
    expect(plan.deliveries[0].requestedVia).toEqual([
      "instagram_feed",
      "instagram_reel",
    ]);
    expect(plan.assets).toHaveLength(1);
  });

  it("reports unknown saved IDs once and returns an empty plan for no selection", () => {
    const unknown = derivePlatformDeliveryPlan(
      ["future_platform", "future_platform", ""],
      "both",
    );
    expect(unknown.deliveries).toEqual([]);
    expect(unknown.assets).toEqual([]);
    expect(unknown.unknown).toEqual([
      {
        platformId: "future_platform",
        reason: "The saved platform ID is not recognized by this release.",
      },
    ]);

    expect(derivePlatformDeliveryPlan(undefined, "photo")).toEqual({
      mode: "photo",
      deliveries: [],
      assets: [],
      unsupported: [],
      unknown: [],
    });
  });

  it("builds human-readable labels and filesystem-safe platform filenames", () => {
    const profile = getPlatformOutputProfile("facebook_feed", "video");
    expect(profile.supported).toBe(true);
    if (!profile.supported) return;

    expect(buildPlatformOutputLabel(profile)).toBe(
      "Facebook Feed video · 16:9 · 1920×1080",
    );
    expect(buildPlatformOutputFilename(profile, "José's F-150 Delivery!!!")).toBe(
      "jose-s-f-150-delivery-facebook-feed-video-16x9-1920x1080.mp4",
    );
    expect(buildPlatformOutputFilename(profile, "!!!")).toMatch(
      /^dealer-social-facebook-feed-video-16x9-1920x1080\.mp4$/,
    );
  });

  it("keeps exact destination dimensions stable for the core platform matrix", () => {
    expect(getPlatformOutputProfile("instagram_story", "photo")).toMatchObject({
      supported: true,
      output: { width: 1080, height: 1920, aspectRatio: "9:16" },
    });
    expect(getPlatformOutputProfile("facebook_feed", "photo")).toMatchObject({
      supported: true,
      output: { width: 1080, height: 1350, aspectRatio: "4:5" },
    });
    expect(getPlatformOutputProfile("tiktok", "video")).toMatchObject({
      supported: true,
      output: { width: 1080, height: 1920, aspectRatio: "9:16" },
    });
    expect(getPlatformOutputProfile("gbp", "photo")).toMatchObject({
      supported: true,
      output: { width: 1200, height: 900, aspectRatio: "4:3" },
    });
    expect(getPlatformOutputProfile("x_twitter", "photo")).toMatchObject({
      supported: true,
      output: { width: 1200, height: 675, aspectRatio: "16:9" },
    });
    expect(getPlatformOutputProfile("linkedin", "photo")).toMatchObject({
      supported: true,
      output: { width: 1200, height: 1200, aspectRatio: "1:1" },
    });
  });
});
