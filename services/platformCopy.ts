/**
 * Platform-aware caption guidance for generation briefs.
 * Maps publish targets → copy constraints and preferred export format.
 */
import { PUBLISH_TARGETS, type PublishTarget } from "./publishTargets";
import type { ExportFormatId } from "../utils/multiFormatExport";
import type { ImageAspectRatio, PrimaryImageFormatId } from "../types";

export type PlatformId = string;

export interface PlatformOption {
  id: PlatformId;
  label: string;
  shortLabel: string;
  /** Mobile-friendly one-liner shown under the chip. */
  hint: string;
  format: ExportFormatId;
  charBudget: number;
  verticalPreferred: boolean;
}

export interface PrimaryImageProfile {
  primaryFormatId: PrimaryImageFormatId;
  imageAspectRatio: ImageAspectRatio;
  label: string;
}

const PRIMARY_IMAGE_PROFILES: Record<
  PrimaryImageFormatId,
  Omit<PrimaryImageProfile, "primaryFormatId">
> = {
  feed_portrait: {
    imageAspectRatio: "4:5",
    label: "Feed portrait · 4:5",
  },
  story_vertical: {
    imageAspectRatio: "9:16",
    label: "Story / Reel · 9:16",
  },
  feed_square: {
    imageAspectRatio: "1:1",
    label: "Social Feed · 1:1",
  },
  marketplace: {
    // Gemini does not offer the exact 1.91:1 Marketplace ratio. Generate the
    // closest native landscape canvas, then use the lossless export adapter.
    imageAspectRatio: "16:9",
    label: "Marketplace · 16:9 master",
  },
  gbp: {
    imageAspectRatio: "4:3",
    label: "Google Business · 4:3",
  },
};

export const getPrimaryImageProfile = (
  primaryFormatId: PrimaryImageFormatId,
): PrimaryImageProfile => ({
  primaryFormatId,
  ...PRIMARY_IMAGE_PROFILES[primaryFormatId],
});

/**
 * Resolve one deterministic native generation canvas from a destination mix.
 *
 * Vertical destinations lead because Stories/Reels/TikTok cannot recover
 * useful portrait composition from a square or landscape master. When no
 * vertical destination is selected, a 4:5 portrait feed leads mixed sets;
 * GBP and Marketplace retain their native profile when selected alone.
 */
export const resolvePrimaryImageProfile = (
  platformIds: PlatformId[] | undefined | null,
): PrimaryImageProfile => {
  const formats = resolvePlatformOptions(platformIds ?? []).map(
    (option) => option.format,
  );
  if (formats.includes("story_vertical")) {
    return getPrimaryImageProfile("story_vertical");
  }
  if (formats.includes("feed_portrait")) {
    return getPrimaryImageProfile("feed_portrait");
  }
  if (formats.includes("feed_square")) {
    return getPrimaryImageProfile("feed_square");
  }
  if (formats.includes("gbp")) {
    return getPrimaryImageProfile("gbp");
  }
  if (formats.includes("marketplace")) {
    return getPrimaryImageProfile("marketplace");
  }
  // No social destination means the image is being prepared for a neutral
  // destination such as the private website draft. A square master is the
  // least platform-branded, website-friendly starting composition; defaulting
  // to 9:16 here made Website-only work look like an accidental TikTok post.
  return getPrimaryImageProfile("feed_square");
};

const SHORT: Record<string, string> = {
  facebook_feed: "Facebook",
  instagram_feed: "IG Feed",
  instagram_reel: "IG Reel",
  instagram_story: "IG Story",
  tiktok: "TikTok",
  gbp: "Google",
  x_twitter: "X",
  linkedin: "LinkedIn",
  marketplace: "Marketplace",
  native_share: "Device share",
};

/** Curated subset for the generate screen — keep it phone-thumb friendly. */
export const PRIMARY_PLATFORM_IDS = [
  "instagram_feed",
  "instagram_story",
  "facebook_feed",
  "tiktok",
  "gbp",
] as const;

const toPlatformOption = (t: PublishTarget): PlatformOption => ({
  id: t.id,
  label: t.label,
  shortLabel: SHORT[t.id] || t.label,
  hint: t.hint,
  format: t.format,
  charBudget: t.charBudget,
  verticalPreferred:
    t.format === "story_vertical" || t.id === "tiktok" || t.id === "instagram_story",
});

export const getPlatformOptions = (): PlatformOption[] => {
  return PUBLISH_TARGETS.filter((t) =>
    (PRIMARY_PLATFORM_IDS as readonly string[]).includes(t.id),
  ).map(toPlatformOption);
};

/**
 * Secondary destinations stay collapsed in the editor, but are sourced from
 * the same canonical publish registry as the share dialog and delivery board.
 */
export const getSecondaryPlatformOptions = (): PlatformOption[] => {
  return PUBLISH_TARGETS.filter(
    (target) => !(PRIMARY_PLATFORM_IDS as readonly string[]).includes(target.id),
  ).map(toPlatformOption);
};

/** Resolve any publish-target id (not only the primary generate-screen set). */
export const resolvePlatformOption = (
  platformId: PlatformId,
): PlatformOption | undefined => {
  const target = PUBLISH_TARGETS.find((t) => t.id === platformId);
  return target ? toPlatformOption(target) : undefined;
};

export const resolvePlatformOptions = (platformIds: PlatformId[]): PlatformOption[] => {
  return platformIds
    .map(resolvePlatformOption)
    .filter((p): p is PlatformOption => Boolean(p));
};

/** Default selection: Instagram + Facebook + TikTok — real dealership channels. */
export const DEFAULT_PLATFORM_IDS: PlatformId[] = [
  "instagram_feed",
  "instagram_story",
  "facebook_feed",
  "tiktok",
];

/**
 * Restore the destination intent recorded on a History item.
 *
 * `[]` is meaningful: modern Website-only posts persist it explicitly, so it
 * must never receive social defaults. Older posts predate `platform_ids`; for
 * those only, retain any caption-pack destinations the server can still
 * provide and otherwise fall back to the social destinations that were the
 * product default when those creatives were generated.
 */
export const resolveHistoryPlatformIds = (
  platformIds: PlatformId[] | undefined | null,
  platformCaptions?: Record<string, string> | null,
): PlatformId[] => {
  if (Array.isArray(platformIds)) {
    return Array.from(new Set(platformIds.filter((id) => resolvePlatformOption(id))));
  }

  const inferred = Object.keys(platformCaptions || {}).filter((id) =>
    Boolean(resolvePlatformOption(id)),
  );
  return inferred.length > 0
    ? Array.from(new Set(inferred))
    : [...DEFAULT_PLATFORM_IDS];
};

/**
 * Inject into the creative brief so the model writes platform-fit captions.
 */
export const platformsToCreativeBrief = (
  platformIds: PlatformId[],
  dealershipName: string,
): string => {
  const options = resolvePlatformOptions(platformIds);
  if (options.length === 0) return "";

  const lines = options.map((p) => {
    const vertical = p.verticalPreferred
      ? "Prefer short, punchy lines that work over a 9:16 visual."
      : "Feed-friendly; can use slightly longer storytelling.";
    return `- ${p.label} (≤${Math.min(p.charBudget, 400)} chars recommended for the hook): ${vertical}`;
  });

  const anyVertical = options.some((p) => p.verticalPreferred);
  const anyFeed = options.some((p) => !p.verticalPreferred);

  return [
    `Target platforms (dealership priority: Instagram, Facebook, TikTok — not X). Write ONE primary caption that works across these, optimized for the strictest length:`,
    ...lines,
    `Always name the store exactly as "${dealershipName}" so multi-location traffic hits the right rooftop.`,
    anyVertical && anyFeed
      ? `Structure: hook + 2 story sentences + CTA with store name + 4–5 hashtags on the last line. First line under ~90 characters for story previews.`
      : anyVertical
        ? `Structure for Stories/Reels/TikTok: punchy hook, short story beat, store name CTA, 3–5 hashtags (Stories lean 0–2 when tagged separately).`
        : `Structure for Feed: full agency caption — hook + story + CTA with store name + 4–5 hashtags.`,
    `HASHTAG RULES: each tag is one #PascalCase token with NO spaces inside; separate tags with a single space; never glue #TagA#TagB; never write #New Car. Always include a store brand tag.`,
  ]
    .filter(Boolean)
    .join("\n");
};

export const preferredExportFormatIds = (
  platformIds: PlatformId[],
): ExportFormatId[] => {
  const options = resolvePlatformOptions(platformIds);
  const formats = new Set<ExportFormatId>();
  // Stories/vertical first when any vertical platform selected
  if (options.some((p) => p.verticalPreferred)) {
    formats.add("story_vertical");
  }
  for (const p of options) formats.add(p.format);
  if (formats.size === 0) {
    formats.add("story_vertical");
    formats.add("feed_square");
  }
  return Array.from(formats);
};

/**
 * Order export formats so preferred ones (from selected platforms) appear first.
 * Formats not in the preferred list keep their relative default order after.
 */
export const orderExportFormatsByPreference = <T extends { id: ExportFormatId }>(
  formats: readonly T[],
  preferredIds: ExportFormatId[],
): T[] => {
  if (!preferredIds.length) return [...formats];
  const rank = new Map(preferredIds.map((id, i) => [id, i]));
  return [...formats].sort((a, b) => {
    const ra = rank.has(a.id) ? (rank.get(a.id) as number) : 1000;
    const rb = rank.has(b.id) ? (rank.get(b.id) as number) : 1000;
    if (ra !== rb) return ra - rb;
    return formats.indexOf(a) - formats.indexOf(b);
  });
};
