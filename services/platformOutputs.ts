/**
 * Canonical destination-to-media contract.
 *
 * This module deliberately does not import the legacy publish/export registries.
 * It is the typed source of truth that those adapters can migrate toward without
 * introducing a dependency cycle.
 *
 * Current provider constraints:
 * - Gemini image generation supports native 4:5. The legacy proxy policy must
 *   be kept in sync before these portrait-feed rows are sent upstream.
 * - Gemini still does not generate the exact 1.91:1 Marketplace canvas, so that
 *   file needs a deterministic render after a native 16:9 generation.
 * - Veo generates only 9:16 or 16:9. The current 1080p route requires an
 *   eight-second request, so every premium video profile encodes that constraint.
 */

export type MediaKind = "photo" | "video";
export type RequestedMediaMode = MediaKind | "both";

export type PlatformFamily =
  "instagram" | "facebook" | "tiktok" | "google_business" | "x" | "linkedin" | "native";

export type PlatformPostType =
  | "feed"
  | "reel"
  | "story"
  | "short_video"
  | "business_post"
  | "marketplace_listing"
  | "device_share";

export type PlatformDestinationId =
  | "instagram_feed"
  | "instagram_reel"
  | "instagram_story"
  | "facebook_feed"
  | "tiktok"
  | "gbp"
  | "marketplace"
  | "x_twitter"
  | "linkedin"
  | "native_share";

/** IDs already persisted on posts before the platform-first workflow. */
export type LegacyPlatformId = Exclude<PlatformDestinationId, "instagram_reel">;

export type OutputAspectRatio = "1:1" | "4:5" | "9:16" | "16:9" | "1.91:1" | "4:3";
export type NativeImageAspectRatio = "1:1" | "4:5" | "9:16" | "16:9" | "4:3";
export type NativeVeoAspectRatio = "9:16" | "16:9";
export type LegacyExportFormatId =
  | "feed_portrait"
  | "feed_square"
  | "story_vertical"
  | "social_landscape"
  | "marketplace"
  | "gbp";

export type PlatformOutputProfileId = `${PlatformDestinationId}:${MediaKind}`;

export interface ExactOutputDimensions {
  width: number;
  height: number;
  aspectRatio: OutputAspectRatio;
}

export type PhotoPreparation =
  | {
      kind: "image";
      nativeAspectRatio: NativeImageAspectRatio;
      transform: "exact-resize";
    }
  | {
      kind: "image";
      nativeAspectRatio: NativeImageAspectRatio;
      transform: "subject-aware-reframe" | "contain-with-backdrop";
    };

export interface VideoPreparation {
  kind: "veo";
  nativeAspectRatio: NativeVeoAspectRatio;
  resolution: "1080p";
  /** The current Veo quality policy permits 1080p only at eight seconds. */
  durationSeconds: 8;
  transform: "none";
}

export interface SupportedPlatformOutput {
  profileId: PlatformOutputProfileId;
  supported: true;
  destinationId: PlatformDestinationId;
  family: PlatformFamily;
  postType: PlatformPostType;
  mediaKind: MediaKind;
  platformLabel: string;
  destinationLabel: string;
  shortLabel: string;
  output: ExactOutputDimensions;
  mimeType: "image/jpeg" | "video/mp4";
  extension: "jpg" | "mp4";
  preparation: PhotoPreparation | VideoPreparation;
  /**
   * Existing export profile used while callers migrate to this richer
   * contract. Undefined for native video files.
   */
  legacyExportFormatId?: LegacyExportFormatId;
}

export interface UnsupportedPlatformOutput {
  profileId: PlatformOutputProfileId;
  supported: false;
  destinationId: PlatformDestinationId;
  family: PlatformFamily;
  postType: PlatformPostType;
  mediaKind: MediaKind;
  platformLabel: string;
  destinationLabel: string;
  shortLabel: string;
  reason: string;
  recommendedDestinationId?: PlatformDestinationId;
}

export type PlatformOutputProfile = SupportedPlatformOutput | UnsupportedPlatformOutput;

const supportedPhoto = (
  definition: Omit<
    SupportedPlatformOutput,
    "profileId" | "supported" | "mediaKind" | "mimeType" | "extension" | "preparation"
  > & {
    preparation: PhotoPreparation;
  },
): SupportedPlatformOutput => ({
  ...definition,
  profileId: `${definition.destinationId}:photo`,
  supported: true,
  mediaKind: "photo",
  mimeType: "image/jpeg",
  extension: "jpg",
});

const supportedVideo = (
  definition: Omit<
    SupportedPlatformOutput,
    | "profileId"
    | "supported"
    | "mediaKind"
    | "mimeType"
    | "extension"
    | "preparation"
    | "legacyExportFormatId"
  > & {
    preparation: VideoPreparation;
  },
): SupportedPlatformOutput => ({
  ...definition,
  profileId: `${definition.destinationId}:video`,
  supported: true,
  mediaKind: "video",
  mimeType: "video/mp4",
  extension: "mp4",
});

const unsupported = (
  definition: Omit<UnsupportedPlatformOutput, "profileId" | "supported">,
): UnsupportedPlatformOutput => ({
  ...definition,
  profileId: `${definition.destinationId}:${definition.mediaKind}`,
  supported: false,
});

/**
 * Product defaults prioritize the largest useful mobile-feed canvas while
 * retaining the app's current dealership-specific destinations.
 */
export const PLATFORM_OUTPUT_PROFILES = [
  supportedPhoto({
    destinationId: "instagram_feed",
    family: "instagram",
    postType: "feed",
    platformLabel: "Instagram",
    destinationLabel: "Instagram Feed",
    shortLabel: "IG Feed",
    output: { width: 1080, height: 1350, aspectRatio: "4:5" },
    preparation: {
      kind: "image",
      nativeAspectRatio: "4:5",
      transform: "exact-resize",
    },
    legacyExportFormatId: "feed_portrait",
  }),
  unsupported({
    destinationId: "instagram_feed",
    family: "instagram",
    postType: "feed",
    mediaKind: "video",
    platformLabel: "Instagram",
    destinationLabel: "Instagram Feed",
    shortLabel: "IG Feed",
    reason: "Video selections are delivered as an Instagram Reel.",
    recommendedDestinationId: "instagram_reel",
  }),
  unsupported({
    destinationId: "instagram_reel",
    family: "instagram",
    postType: "reel",
    mediaKind: "photo",
    platformLabel: "Instagram",
    destinationLabel: "Instagram Reel",
    shortLabel: "IG Reel",
    reason: "A Reel requires video; use Instagram Feed or Story for a photo.",
    recommendedDestinationId: "instagram_feed",
  }),
  supportedVideo({
    destinationId: "instagram_reel",
    family: "instagram",
    postType: "reel",
    platformLabel: "Instagram",
    destinationLabel: "Instagram Reel",
    shortLabel: "IG Reel",
    output: { width: 1080, height: 1920, aspectRatio: "9:16" },
    preparation: {
      kind: "veo",
      nativeAspectRatio: "9:16",
      resolution: "1080p",
      durationSeconds: 8,
      transform: "none",
    },
  }),
  supportedPhoto({
    destinationId: "instagram_story",
    family: "instagram",
    postType: "story",
    platformLabel: "Instagram",
    destinationLabel: "Instagram Story",
    shortLabel: "IG Story",
    output: { width: 1080, height: 1920, aspectRatio: "9:16" },
    preparation: {
      kind: "image",
      nativeAspectRatio: "9:16",
      transform: "exact-resize",
    },
    legacyExportFormatId: "story_vertical",
  }),
  supportedVideo({
    destinationId: "instagram_story",
    family: "instagram",
    postType: "story",
    platformLabel: "Instagram",
    destinationLabel: "Instagram Story",
    shortLabel: "IG Story",
    output: { width: 1080, height: 1920, aspectRatio: "9:16" },
    preparation: {
      kind: "veo",
      nativeAspectRatio: "9:16",
      resolution: "1080p",
      durationSeconds: 8,
      transform: "none",
    },
  }),
  supportedPhoto({
    destinationId: "facebook_feed",
    family: "facebook",
    postType: "feed",
    platformLabel: "Facebook",
    destinationLabel: "Facebook Feed",
    shortLabel: "Facebook",
    output: { width: 1080, height: 1350, aspectRatio: "4:5" },
    preparation: {
      kind: "image",
      nativeAspectRatio: "4:5",
      transform: "exact-resize",
    },
    legacyExportFormatId: "feed_portrait",
  }),
  supportedVideo({
    destinationId: "facebook_feed",
    family: "facebook",
    postType: "feed",
    platformLabel: "Facebook",
    destinationLabel: "Facebook Feed",
    shortLabel: "Facebook",
    output: { width: 1920, height: 1080, aspectRatio: "16:9" },
    preparation: {
      kind: "veo",
      nativeAspectRatio: "16:9",
      resolution: "1080p",
      durationSeconds: 8,
      transform: "none",
    },
  }),
  supportedPhoto({
    destinationId: "tiktok",
    family: "tiktok",
    postType: "short_video",
    platformLabel: "TikTok",
    destinationLabel: "TikTok",
    shortLabel: "TikTok",
    output: { width: 1080, height: 1920, aspectRatio: "9:16" },
    preparation: {
      kind: "image",
      nativeAspectRatio: "9:16",
      transform: "exact-resize",
    },
    legacyExportFormatId: "story_vertical",
  }),
  supportedVideo({
    destinationId: "tiktok",
    family: "tiktok",
    postType: "short_video",
    platformLabel: "TikTok",
    destinationLabel: "TikTok",
    shortLabel: "TikTok",
    output: { width: 1080, height: 1920, aspectRatio: "9:16" },
    preparation: {
      kind: "veo",
      nativeAspectRatio: "9:16",
      resolution: "1080p",
      durationSeconds: 8,
      transform: "none",
    },
  }),
  supportedPhoto({
    destinationId: "gbp",
    family: "google_business",
    postType: "business_post",
    platformLabel: "Google",
    destinationLabel: "Google Business Post",
    shortLabel: "Google",
    output: { width: 1200, height: 900, aspectRatio: "4:3" },
    preparation: {
      kind: "image",
      nativeAspectRatio: "4:3",
      transform: "exact-resize",
    },
    legacyExportFormatId: "gbp",
  }),
  supportedVideo({
    destinationId: "gbp",
    family: "google_business",
    postType: "business_post",
    platformLabel: "Google",
    destinationLabel: "Google Business Video",
    shortLabel: "Google",
    output: { width: 1920, height: 1080, aspectRatio: "16:9" },
    preparation: {
      kind: "veo",
      nativeAspectRatio: "16:9",
      resolution: "1080p",
      durationSeconds: 8,
      transform: "none",
    },
  }),
  supportedPhoto({
    destinationId: "marketplace",
    family: "facebook",
    postType: "marketplace_listing",
    platformLabel: "Facebook",
    destinationLabel: "Facebook Marketplace",
    shortLabel: "Marketplace",
    output: { width: 1200, height: 628, aspectRatio: "1.91:1" },
    preparation: {
      kind: "image",
      nativeAspectRatio: "16:9",
      transform: "contain-with-backdrop",
    },
    legacyExportFormatId: "marketplace",
  }),
  supportedVideo({
    destinationId: "marketplace",
    family: "facebook",
    postType: "marketplace_listing",
    platformLabel: "Facebook",
    destinationLabel: "Facebook Marketplace Video",
    shortLabel: "Marketplace",
    output: { width: 1920, height: 1080, aspectRatio: "16:9" },
    preparation: {
      kind: "veo",
      nativeAspectRatio: "16:9",
      resolution: "1080p",
      durationSeconds: 8,
      transform: "none",
    },
  }),
  supportedPhoto({
    destinationId: "x_twitter",
    family: "x",
    postType: "feed",
    platformLabel: "X",
    destinationLabel: "X Post",
    shortLabel: "X",
    output: { width: 1200, height: 675, aspectRatio: "16:9" },
    preparation: {
      kind: "image",
      nativeAspectRatio: "16:9",
      transform: "exact-resize",
    },
    legacyExportFormatId: "social_landscape",
  }),
  supportedVideo({
    destinationId: "x_twitter",
    family: "x",
    postType: "feed",
    platformLabel: "X",
    destinationLabel: "X Post",
    shortLabel: "X",
    output: { width: 1920, height: 1080, aspectRatio: "16:9" },
    preparation: {
      kind: "veo",
      nativeAspectRatio: "16:9",
      resolution: "1080p",
      durationSeconds: 8,
      transform: "none",
    },
  }),
  supportedPhoto({
    destinationId: "linkedin",
    family: "linkedin",
    postType: "feed",
    platformLabel: "LinkedIn",
    destinationLabel: "LinkedIn Feed",
    shortLabel: "LinkedIn",
    output: { width: 1200, height: 1200, aspectRatio: "1:1" },
    preparation: {
      kind: "image",
      nativeAspectRatio: "1:1",
      transform: "exact-resize",
    },
    legacyExportFormatId: "feed_square",
  }),
  supportedVideo({
    destinationId: "linkedin",
    family: "linkedin",
    postType: "feed",
    platformLabel: "LinkedIn",
    destinationLabel: "LinkedIn Feed",
    shortLabel: "LinkedIn",
    output: { width: 1920, height: 1080, aspectRatio: "16:9" },
    preparation: {
      kind: "veo",
      nativeAspectRatio: "16:9",
      resolution: "1080p",
      durationSeconds: 8,
      transform: "none",
    },
  }),
  supportedPhoto({
    destinationId: "native_share",
    family: "native",
    postType: "device_share",
    platformLabel: "Device",
    destinationLabel: "More sharing apps",
    shortLabel: "More",
    output: { width: 1080, height: 1080, aspectRatio: "1:1" },
    preparation: {
      kind: "image",
      nativeAspectRatio: "1:1",
      transform: "exact-resize",
    },
    legacyExportFormatId: "feed_square",
  }),
  supportedVideo({
    destinationId: "native_share",
    family: "native",
    postType: "device_share",
    platformLabel: "Device",
    destinationLabel: "More sharing apps",
    shortLabel: "More",
    output: { width: 1920, height: 1080, aspectRatio: "16:9" },
    preparation: {
      kind: "veo",
      nativeAspectRatio: "16:9",
      resolution: "1080p",
      durationSeconds: 8,
      transform: "none",
    },
  }),
] as const satisfies readonly PlatformOutputProfile[];

const PROFILES_BY_ID = new Map<PlatformOutputProfileId, PlatformOutputProfile>(
  PLATFORM_OUTPUT_PROFILES.map((profile) => [profile.profileId, profile]),
);

export const getPlatformOutputProfile = (
  destinationId: PlatformDestinationId,
  mediaKind: MediaKind,
): PlatformOutputProfile =>
  PROFILES_BY_ID.get(`${destinationId}:${mediaKind}`) ??
  unsupported({
    destinationId,
    family: "native",
    postType: "device_share",
    mediaKind,
    platformLabel: destinationId,
    destinationLabel: destinationId,
    shortLabel: destinationId,
    reason: "This destination and media combination has no configured output profile.",
  });

const mediaKindsForMode = (mode: RequestedMediaMode): readonly MediaKind[] =>
  mode === "both" ? ["photo", "video"] : [mode];

const platformSelectionForKind = (
  platformId: PlatformDestinationId,
  mediaKind: MediaKind,
): PlatformDestinationId => {
  if (platformId === "instagram_feed" && mediaKind === "video") {
    return "instagram_reel";
  }
  if (platformId === "instagram_reel" && mediaKind === "photo") {
    return "instagram_feed";
  }
  return platformId;
};

const slugify = (value: string): string => {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "dealer-social";
};

const ratioFilenameToken = (ratio: OutputAspectRatio): string =>
  ratio.replace(":", "x").replace(".", "");

export const buildPlatformOutputLabel = (profile: SupportedPlatformOutput): string =>
  `${profile.destinationLabel} ${profile.mediaKind} · ${profile.output.aspectRatio} · ${profile.output.width}×${profile.output.height}`;

export const buildPlatformOutputFilename = (
  profile: SupportedPlatformOutput,
  baseFilename = "dealer-social",
): string =>
  [
    slugify(baseFilename),
    slugify(profile.destinationLabel),
    profile.mediaKind,
    ratioFilenameToken(profile.output.aspectRatio),
    `${profile.output.width}x${profile.output.height}`,
  ].join("-") + `.${profile.extension}`;

export interface PlannedPlatformAsset {
  id: string;
  mediaKind: MediaKind;
  output: ExactOutputDimensions;
  mimeType: SupportedPlatformOutput["mimeType"];
  preparation: SupportedPlatformOutput["preparation"];
  filename: string;
  label: string;
  deliveryProfileIds: PlatformOutputProfileId[];
}

export interface PlannedPlatformDelivery {
  id: PlatformOutputProfileId;
  destinationId: PlatformDestinationId;
  mediaKind: MediaKind;
  assetId: string;
  filename: string;
  label: string;
  requestedVia: string[];
  profile: SupportedPlatformOutput;
}

export interface UnknownPlatformSelection {
  platformId: string;
  reason: string;
}

export interface PlatformDeliveryPlan {
  mode: RequestedMediaMode;
  deliveries: PlannedPlatformDelivery[];
  assets: PlannedPlatformAsset[];
  unsupported: UnsupportedPlatformOutput[];
  unknown: UnknownPlatformSelection[];
}

const assetKeyForProfile = (profile: SupportedPlatformOutput): string => {
  const preparation =
    profile.preparation.kind === "veo"
      ? [
          "veo",
          profile.preparation.nativeAspectRatio,
          profile.preparation.resolution,
          profile.preparation.durationSeconds,
        ].join("-")
      : [
          "image",
          profile.preparation.nativeAspectRatio,
          profile.preparation.transform,
        ].join("-");
  return [
    profile.mediaKind,
    `${profile.output.width}x${profile.output.height}`,
    profile.mimeType,
    preparation,
  ].join(":");
};

const assetFilename = (
  profile: SupportedPlatformOutput,
  baseFilename: string,
): string =>
  [
    slugify(baseFilename),
    profile.mediaKind,
    ratioFilenameToken(profile.output.aspectRatio),
    `${profile.output.width}x${profile.output.height}`,
  ].join("-") + `.${profile.extension}`;

const isPlatformDestinationId = (value: string): value is PlatformDestinationId =>
  [
    "instagram_feed",
    "instagram_reel",
    "instagram_story",
    "facebook_feed",
    "tiktok",
    "gbp",
    "marketplace",
    "x_twitter",
    "linkedin",
    "native_share",
  ].includes(value);

/**
 * Turn the old list of platform IDs into exact destination deliverables.
 *
 * Delivery rows stay destination-specific so each card can have its own
 * caption, Save, and Share actions. Expensive binary work is deduplicated in
 * `assets`: destinations with identical media specifications point to one
 * generated/rendered file.
 */
export const derivePlatformDeliveryPlan = (
  selectedPlatformIds: readonly string[] | null | undefined,
  mode: RequestedMediaMode,
  baseFilename = "dealer-social",
): PlatformDeliveryPlan => {
  const deliveries: PlannedPlatformDelivery[] = [];
  const unsupportedProfiles: UnsupportedPlatformOutput[] = [];
  const unknown: UnknownPlatformSelection[] = [];
  const deliveryById = new Map<PlatformOutputProfileId, PlannedPlatformDelivery>();
  const unsupportedIds = new Set<PlatformOutputProfileId>();
  const unknownIds = new Set<string>();
  const assetsByKey = new Map<string, PlannedPlatformAsset>();

  const selected = selectedPlatformIds ?? [];
  for (const rawPlatformId of selected) {
    const platformId = rawPlatformId.trim();
    if (!platformId) continue;
    if (!isPlatformDestinationId(platformId)) {
      if (!unknownIds.has(platformId)) {
        unknownIds.add(platformId);
        unknown.push({
          platformId,
          reason: "The saved platform ID is not recognized by this release.",
        });
      }
      continue;
    }

    for (const mediaKind of mediaKindsForMode(mode)) {
      const destinationId = platformSelectionForKind(platformId, mediaKind);
      const profile = getPlatformOutputProfile(destinationId, mediaKind);
      if (!profile.supported) {
        if (!unsupportedIds.has(profile.profileId)) {
          unsupportedIds.add(profile.profileId);
          unsupportedProfiles.push(profile);
        }
        continue;
      }

      const existingDelivery = deliveryById.get(profile.profileId);
      if (existingDelivery) {
        if (!existingDelivery.requestedVia.includes(platformId)) {
          existingDelivery.requestedVia.push(platformId);
        }
        continue;
      }

      const assetKey = assetKeyForProfile(profile);
      let asset = assetsByKey.get(assetKey);
      if (!asset) {
        asset = {
          id: `asset:${assetKey}`,
          mediaKind: profile.mediaKind,
          output: profile.output,
          mimeType: profile.mimeType,
          preparation: profile.preparation,
          filename: assetFilename(profile, baseFilename),
          label: `${profile.mediaKind === "photo" ? "Photo" : "Video"} master · ${profile.output.aspectRatio} · ${profile.output.width}×${profile.output.height}`,
          deliveryProfileIds: [],
        };
        assetsByKey.set(assetKey, asset);
      }
      asset.deliveryProfileIds.push(profile.profileId);

      const delivery: PlannedPlatformDelivery = {
        id: profile.profileId,
        destinationId: profile.destinationId,
        mediaKind: profile.mediaKind,
        assetId: asset.id,
        filename: buildPlatformOutputFilename(profile, baseFilename),
        label: buildPlatformOutputLabel(profile),
        requestedVia: [platformId],
        profile,
      };
      deliveryById.set(profile.profileId, delivery);
      deliveries.push(delivery);
    }
  }

  return {
    mode,
    deliveries,
    assets: [...assetsByKey.values()],
    unsupported: unsupportedProfiles,
    unknown,
  };
};
