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
  marketplace: "Marketplace",
  native_share: "More",
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
    t.format === "story_vertical" ||
    t.id === "tiktok" ||
    t.id === "instagram_story",
});

export const getPlatformOptions = (): PlatformOption[] => {
  return PUBLISH_TARGETS.filter((t) =>
    (PRIMARY_PLATFORM_IDS as readonly string[]).includes(t.id),
  ).map(toPlatformOption);
};

/** Resolve any publish-target id (not only the primary generate-screen set). */
export const resolvePlatformOption = (
  platformId: PlatformId,
): PlatformOption | undefined => {
  const target = PUBLISH_TARGETS.find((t) => t.id === platformId);
  return target ? toPlatformOption(target) : undefined;
};

export const resolvePlatformOptions = (
  platformIds: PlatformId[],
): PlatformOption[] => {
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
      ? `Structure: 1 hook sentence, 1 CTA with store name, then 3–5 hashtags on the last line. Keep the first line story-ready (under ~90 characters).`
      : anyVertical
        ? `Structure for Stories/Reels/TikTok: ultra-short hook, store name CTA, 0–5 hashtags (Stories lean 0–2; Reels/TikTok 3–5).`
        : `Structure for Feed: hook + story, CTA with store name, 3–5 hashtags (Facebook can use fewer).`,
    `HASHTAG RULES: each tag is one #PascalCase token with NO spaces inside; separate tags with a single space; never glue #TagA#TagB; never write #New Car.`,
  ]
    .filter(Boolean)
    .join("\n");
};

/**
 * Per-platform copy constraints used when generating a caption pack.
 * Pure helper — no I/O.
 */
export const platformCopyGuidance = (platformId: PlatformId): string => {
  const tagFmt =
    "Hashtags: #PascalCase only (no spaces inside), single space between tags, never #A#B glued.";
  switch (platformId) {
    case "instagram_feed":
      return `IG Feed (primary dealer channel): hook in first line, warm storytelling, CTA with store name, exactly 3–5 relevant hashtags on the last line. Aim ≤400 chars for the body before hashtags. ${tagFmt}`;
    case "instagram_story":
      return `IG Story: ultra-short (≤90 chars ideal). One punchy line + store name. 0–2 hashtags or none — Stories are not hashtag discovery. ${tagFmt}`;
    case "facebook_feed":
      return `Facebook Feed (primary dealer channel): conversational, slightly longer OK. Clear CTA with store name. 0–3 light hashtags only — excess looks spammy. ${tagFmt}`;
    case "tiktok":
      return `TikTok (primary dealer channel for short video): scroll-stopping first line, casual voice, 3–5 descriptive hashtags (niche + local + vehicle intent). Keep ≤150 chars before hashtags. ${tagFmt}`;
    case "x_twitter":
      return `X/Twitter is optional/low priority for most dealerships. If used: hard cap 280 chars total, 0–2 hashtags, punchy. ${tagFmt}`;
    case "gbp":
      return `Google Business: factual, local, professional. Store name + city/market keywords in prose matter more than tags. 0–2 hashtags max. ≤500 chars preferred. ${tagFmt}`;
    case "linkedin":
      return `LinkedIn: professional tone, light personal story OK, store name CTA, 1–3 hashtags max. ${tagFmt}`;
    case "marketplace":
      return `Marketplace listing tone: clear vehicle/value pitch, store name, contact CTA. Prefer keywords in body over hashtags (0–1). ${tagFmt}`;
    default: {
      const opt = resolvePlatformOption(platformId);
      if (!opt) return `Platform ${platformId}: stay on-brand and under typical social length. ${tagFmt}`;
      return `${opt.label}: respect ≤${Math.min(opt.charBudget, 400)} chars for the hook; name the store. ${tagFmt}`;
    }
  }
};

/**
 * Brief for a multi-platform caption pack (JSON or clearly delimited blocks).
 * Used after the primary caption so variants stay on-message.
 */
export const platformsToCaptionPackBrief = (
  platformIds: PlatformId[],
  dealershipName: string,
  primaryCaption?: string,
): string => {
  const options = resolvePlatformOptions(platformIds);
  if (options.length === 0) return "";

  const guidance = options
    .map((p) => `- ${p.id} (${p.label}): ${platformCopyGuidance(p.id)}`)
    .join("\n");

  const keys = options.map((p) => p.id);

  return [
    `You are writing a CAPTION PACK for multiple platforms for "${dealershipName}".`,
    primaryCaption?.trim()
      ? `Base caption (preserve facts, names, vehicle details, required hashtags/footer intent):\n"""\n${primaryCaption.trim()}\n"""`
      : `Write on-brand variants for "${dealershipName}".`,
    `Create ONE tailored caption per platform below. Same core message; adapt length, tone, and structure.`,
    guidance,
    `Always use the store name exactly as "${dealershipName}".`,
    `HASHTAGS: each is one #PascalCase token with NO spaces inside; separate with single spaces; never glue tags. Match platform counts (IG/TikTok 3–5, FB 0–3, Stories 0–2).`,
    `OUTPUT FORMAT (strict): return ONLY a JSON object with exactly these keys: ${JSON.stringify(keys)}.`,
    `Each value is a plain caption string (no markdown fences, no extra keys, no commentary).`,
    `Example shape: {"${keys[0]}":"..."${keys[1] ? `,"${keys[1]}":"..."` : ""}}`,
    `If you cannot emit JSON, use delimited blocks exactly like:`,
    `=== ${keys[0]} ===`,
    `caption text here`,
    keys[1] ? `=== ${keys[1]} ===` : "",
    keys[1] ? `caption text here` : "",
  ]
    .filter(Boolean)
    .join("\n");
};

/**
 * Parse model output from a caption-pack call into platformId → caption.
 * Accepts JSON objects or `=== platform_id ===` delimited blocks.
 */
export const parsePlatformCaptionPack = (
  raw: string,
  platformIds: PlatformId[],
): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!raw?.trim() || platformIds.length === 0) return out;

  const text = raw.trim();

  // Strip common markdown fences
  const unfenced = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  // Try JSON object (full string or first {...} slice)
  const tryJson = (candidate: string): Record<string, string> | null => {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
      }
      const record = parsed as Record<string, unknown>;
      const mapped: Record<string, string> = {};
      for (const id of platformIds) {
        const val = record[id];
        if (typeof val === "string" && val.trim()) {
          mapped[id] = val.trim();
        }
      }
      return Object.keys(mapped).length > 0 ? mapped : null;
    } catch {
      return null;
    }
  };

  const jsonHit =
    tryJson(unfenced) ||
    (() => {
      const start = unfenced.indexOf("{");
      const end = unfenced.lastIndexOf("}");
      if (start >= 0 && end > start) {
        return tryJson(unfenced.slice(start, end + 1));
      }
      return null;
    })();

  if (jsonHit) return jsonHit;

  // Delimited: === platform_id ===
  const idSet = new Set(platformIds);
  const delimRe = /^===\s*([a-z0-9_]+)\s*===\s*$/gim;
  const matches = [...unfenced.matchAll(delimRe)];
  if (matches.length > 0) {
    for (let i = 0; i < matches.length; i++) {
      const id = matches[i][1];
      if (!idSet.has(id)) continue;
      const bodyStart = (matches[i].index ?? 0) + matches[i][0].length;
      const bodyEnd =
        i + 1 < matches.length
          ? (matches[i + 1].index ?? unfenced.length)
          : unfenced.length;
      const body = unfenced.slice(bodyStart, bodyEnd).trim();
      if (body) out[id] = body;
    }
  }

  return out;
};

/**
 * Whether a multi-platform pack step is useful (2+ selected destinations).
 */
export const shouldGenerateCaptionPack = (
  platformIds: PlatformId[] | undefined | null,
): boolean => {
  return Array.isArray(platformIds) && platformIds.length >= 2;
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
