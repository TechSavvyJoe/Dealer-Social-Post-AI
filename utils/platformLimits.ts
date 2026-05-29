/**
 * Per-platform character limits and hashtag rules for social media posts.
 *
 * Values reflect current public specs as of 2026-05. Limits change — if a
 * platform tightens or loosens, edit here and the UI updates everywhere.
 */

export interface PlatformLimit {
  id: string;
  label: string;
  /** Max total characters in the caption (post text). */
  maxChars: number;
  /** Soft limit — text remains visible inline below this; longer texts get a "...more" fold. */
  softFoldChars?: number;
  /** Max number of hashtags before the platform truncates or down-ranks. */
  maxHashtags?: number;
}

export const PLATFORM_LIMITS: PlatformLimit[] = [
  { id: "x", label: "X / Twitter", maxChars: 280 },
  {
    id: "facebook",
    label: "Facebook Feed",
    maxChars: 63206,
    softFoldChars: 477, // about ~3 lines on desktop before "See more"
  },
  {
    id: "instagram",
    label: "Instagram",
    maxChars: 2200,
    softFoldChars: 125, // characters visible before "...more"
    maxHashtags: 30,
  },
  {
    id: "tiktok",
    label: "TikTok",
    maxChars: 2200,
    softFoldChars: 100,
    maxHashtags: 30,
  },
  {
    id: "gbp",
    label: "Google Business",
    maxChars: 1500,
    softFoldChars: 250,
  },
  {
    id: "marketplace",
    label: "FB Marketplace",
    maxChars: 9999,
    softFoldChars: 300,
  },
];

export type CountState = "ok" | "fold" | "over";

// Count user-perceived characters, not UTF-16 code units. `"🚗".length` is 2
// and flag/ZWJ emoji are more, so `text.length` over-counts and falsely flags
// emoji-containing captions as "over" the limit — blocking valid posts in an
// app whose whole job is emoji-rich social captions. Intl.Segmenter gives
// grapheme clusters; fall back to code points where unavailable.
let _grapheme: { segment: (s: string) => Iterable<unknown> } | null = null;
let _graphemeInit = false;
const countGraphemes = (text: string): number => {
  if (!_graphemeInit) {
    _graphemeInit = true;
    const Ctor = (Intl as { Segmenter?: new (l: string | undefined, o: { granularity: string }) => { segment: (s: string) => Iterable<unknown> } }).Segmenter;
    if (typeof Ctor === "function") {
      try {
        _grapheme = new Ctor(undefined, { granularity: "grapheme" });
      } catch {
        _grapheme = null;
      }
    }
  }
  if (_grapheme) {
    let n = 0;
    for (const _ of _grapheme.segment(text)) n++;
    return n;
  }
  return Array.from(text).length;
};

export const evaluate = (
  text: string,
  limit: PlatformLimit
): { count: number; state: CountState; remaining: number } => {
  const count = countGraphemes(text);
  let state: CountState = "ok";
  if (count > limit.maxChars) state = "over";
  else if (limit.softFoldChars && count > limit.softFoldChars) state = "fold";
  return { count, state, remaining: limit.maxChars - count };
};

export const countHashtags = (text: string): number => {
  // Match #words (letters/digits/underscores) preceded by start or whitespace
  const matches = text.match(/(?:^|\s)#[\w]+/g);
  return matches ? matches.length : 0;
};
