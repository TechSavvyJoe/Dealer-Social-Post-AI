/**
 * Platform-aware caption guidance for generation briefs.
 * Maps publish targets → copy constraints and preferred export format.
 */
import { PUBLISH_TARGETS, type PublishTarget } from "./publishTargets";
import type { ExportFormatId } from "../utils/multiFormatExport";

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

const SHORT: Record<string, string> = {
  facebook_feed: "Facebook",
  instagram_feed: "IG Feed",
  instagram_story: "IG Story",
  tiktok: "TikTok",
  gbp: "Google",
  x_twitter: "X",
  linkedin: "LinkedIn",
};

/** Curated subset for the generate screen — keep it phone-thumb friendly. */
export const PRIMARY_PLATFORM_IDS = [
  "instagram_feed",
  "instagram_story",
  "facebook_feed",
  "tiktok",
  "gbp",
] as const;

export const getPlatformOptions = (): PlatformOption[] => {
  return PUBLISH_TARGETS.filter((t) =>
    (PRIMARY_PLATFORM_IDS as readonly string[]).includes(t.id),
  ).map((t: PublishTarget) => ({
    id: t.id,
    label: t.label,
    shortLabel: SHORT[t.id] || t.label,
    hint: t.hint,
    format: t.format,
    charBudget: t.charBudget,
    verticalPreferred:
      t.format === "story_vertical" || t.id === "tiktok" || t.id === "instagram_story",
  }));
};

/** Default selection biases stories + feed — most salesperson traffic. */
export const DEFAULT_PLATFORM_IDS: PlatformId[] = [
  "instagram_feed",
  "instagram_story",
  "facebook_feed",
];

/**
 * Inject into the creative brief so the model writes platform-fit captions.
 */
export const platformsToCreativeBrief = (
  platformIds: PlatformId[],
  dealershipName: string,
): string => {
  const options = getPlatformOptions().filter((p) => platformIds.includes(p.id));
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
    `Target platforms (write ONE primary caption that works across these, optimized for the strictest length):`,
    ...lines,
    `Always name the store exactly as "${dealershipName}" so multi-location traffic hits the right rooftop.`,
    anyVertical && anyFeed
      ? `Structure: 1 hook sentence, 1 CTA with store name, then hashtags. Keep the first line story-ready (under ~90 characters).`
      : anyVertical
        ? `Structure for Stories/Reels/TikTok: ultra-short hook, store name CTA, 3–5 hashtags.`
        : `Structure for Feed: hook + story, CTA with store name, 4–6 hashtags.`,
  ]
    .filter(Boolean)
    .join("\n");
};

export const preferredExportFormatIds = (
  platformIds: PlatformId[],
): ExportFormatId[] => {
  const options = getPlatformOptions().filter((p) => platformIds.includes(p.id));
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
