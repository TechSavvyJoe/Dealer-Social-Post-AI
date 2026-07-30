/**
 * Clean and validate AI caption output.
 * Models sometimes emit labels, XML, markdown, or nonsense — salespeople
 * must never see that. Low-quality output is replaced with a clean template.
 */
import {
  brandHashtagFromName,
  formatHashtag,
  normalizeCaptionHashtags,
  uniqueFormattedHashtags,
} from "./hashtags";
import { AGENCY_DISCOVERY_HASHTAGS } from "./brandKit";

/** Strip model junk so only post-ready prose + hashtags remain. */
export const cleanSocialCaption = (raw: string): string => {
  if (!raw?.trim()) return "";

  let text = raw.trim();

  // Markdown fences / JSON wrappers
  text = text.replace(/^```(?:json|text|markdown)?\s*/i, "").replace(/\s*```$/i, "");
  text = text.replace(/^["']|["']$/g, "");

  // Drop common assistant preambles (whole first line)
  const lines = text.split("\n");
  const dropFirst =
    /^(here('s| is)|sure[,!]?|certainly|of course|i('ve| have)|as an ai|caption\s*:|post\s*:|output\s*:)/i.test(
      lines[0]?.trim() || "",
    );
  if (dropFirst && lines.length > 1) {
    text = lines.slice(1).join("\n").trim();
  }

  // Remove XML-ish prompt tags the model may echo
  text = text.replace(/<\/?[a-zA-Z_][\w:-]*\b[^>]*>/g, " ");

  // Remove section labels models invent from structured prompts
  text = text.replace(
    /^\s*(HOOK|STORY|CTA|HASHTAGS?|BODY|CAPTION|POST|OUTPUT|RULES?|FORMAT)\s*[:.\-)–—]\s*/gim,
    "",
  );
  text = text.replace(/^\s*[\d]+[.)]\s*(HOOK|STORY|CTA|HASHTAGS?)\b.*$/gim, "");

  // Strip bullet / markdown noise
  text = text
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*[-*•]\s+/, "")
        .replace(/^\s*#{1,6}\s+/, "")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/\*([^*]+)\*/g, "$1")
        .trimEnd(),
    )
    .join("\n");

  // Collapse 3+ blank lines
  text = text.replace(/\n{3,}/g, "\n\n").trim();

  return normalizeCaptionHashtags(text);
};

const wordStats = (body: string) => {
  const words = body
    .replace(/#[A-Za-z0-9_]+/g, " ")
    .split(/[^A-Za-z']+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
  if (words.length === 0) {
    return { words: [] as string[], avgLen: 0, longWordRatio: 1, vowelRatio: 0 };
  }
  const avgLen = words.reduce((s, w) => s + w.length, 0) / words.length;
  const longWordRatio = words.filter((w) => w.length >= 15).length / words.length;
  const letters = body.replace(/[^A-Za-z]/g, "");
  const vowels = (letters.match(/[aeiouAEIOU]/g) || []).length;
  const vowelRatio = letters.length ? vowels / letters.length : 0;
  return { words, avgLen, longWordRatio, vowelRatio };
};

/**
 * True when caption is not usable as a social post (gibberish, labels, stubs).
 */
export const isLowQualityCaption = (caption: string): boolean => {
  const cleaned = cleanSocialCaption(caption);
  if (!cleaned.trim()) return true;

  // Structural junk still present
  if (/<\/?[a-zA-Z_][\w:-]*\b/.test(cleaned)) return true;
  if (
    /\b(HOOK|STORY|CTA|HASHTAGS?|OUTPUT FORMAT)\b/i.test(cleaned) &&
    cleaned.length < 280
  ) {
    return true;
  }
  if (/^\s*\{[\s\S]*\}\s*$/.test(cleaned)) return true;
  if (/as an ai\b|language model\b|i cannot\b|i'm unable\b/i.test(cleaned)) {
    return true;
  }

  // Body without hashtag line
  const withoutTags = cleaned
    .replace(/#[A-Za-z0-9_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (withoutTags.length < 50) return true;
  if (withoutTags.length > 1200) return true;

  const { words, avgLen, longWordRatio, vowelRatio } = wordStats(withoutTags);
  if (words.length < 8) return true;
  // Gibberish: huge average word length or almost no vowels
  if (avgLen > 14) return true;
  if (longWordRatio > 0.35) return true;
  if (vowelRatio < 0.22 && withoutTags.length > 40) return true;

  // Must look like English sentences (at least one space-separated phrase)
  if (!/\s/.test(withoutTags)) return true;

  // Random consonant salad: many 6+ consonant runs
  const consonantRuns = withoutTags.match(/[bcdfghjklmnpqrstvwxyz]{6,}/gi) || [];
  if (consonantRuns.length >= 2) return true;

  return false;
};

export interface SafeCaptionOptions {
  storeName: string;
  customerName?: string;
  /** Optional vehicle phrase e.g. "new Ford F-150" */
  vehiclePhrase?: string;
  defaultHashtags?: string;
}

/** Deterministic, paste-ready marketing caption when AI fails quality checks. */
export const buildSafeMarketingCaption = (opts: SafeCaptionOptions): string => {
  const store = (opts.storeName || "our dealership").trim();
  const who = opts.customerName?.trim()
    ? opts.customerName.trim()
    : "our newest customer";
  const ride = opts.vehiclePhrase?.trim()
    ? opts.vehiclePhrase.trim()
    : "their new ride";

  const body = [
    `Keys in hand and big smiles — ${who} just drove off in ${ride}.`,
    `Moments like this are why we love what we do at ${store}.`,
    `Ready for your delivery day? Visit ${store} this week and find the one that feels like yours.`,
  ].join("\n\n");

  const tags = uniqueFormattedHashtags([
    brandHashtagFromName(store),
    ...(opts.defaultHashtags || "")
      .split(/[\n,]+/)
      .map((h) => formatHashtag(h.trim()))
      .filter(Boolean),
    ...AGENCY_DISCOVERY_HASHTAGS,
  ]).slice(0, 5);

  return normalizeCaptionHashtags(`${body}\n${tags.join(" ")}`);
};

/**
 * Full post-process pipeline for raw model text:
 * clean → quality check → safe template if needed.
 */
export const ensureUsableCaption = (
  raw: string,
  opts: SafeCaptionOptions,
): { caption: string; usedFallback: boolean } => {
  const cleaned = cleanSocialCaption(raw);
  if (!isLowQualityCaption(cleaned)) {
    return { caption: cleaned, usedFallback: false };
  }
  return {
    caption: buildSafeMarketingCaption(opts),
    usedFallback: true,
  };
};
