/**
 * Deterministic dealer brand kit for captions.
 * Model prompts *suggest* footer/hashtags; this layer *guarantees* them on
 * every delivery path (primary, pack, regen, alts) so salespeople never get
 * a thin body or empty hashtag line.
 */
import {
  brandHashtagFromName,
  formatHashtag,
  normalizeCaptionHashtags,
  uniqueFormattedHashtags,
} from "./hashtags";

export interface DealerBrandKit {
  name?: string;
  default_hashtags?: string;
  default_footer?: string;
  /**
   * When true, every dealer hashtag (brand tag + default_hashtags) is always
   * kept, even past TARGET_HASHTAG_COUNT — agency discovery tags only fill the
   * remaining slots. Off, the historical cap applies and a long dealer list is
   * trimmed to the target.
   */
  required_hashtags_locked?: boolean;
}

/**
 * Agency discovery tags used when AI or dealer kit leave a caption under-tagged.
 * Ordered by dealership marketing usefulness (delivery → social proof → intent).
 */
export const AGENCY_DISCOVERY_HASHTAGS = [
  "#NewCarDelivery",
  "#HappyCustomer",
  "#JustDelivered",
  "#CarShopping",
  "#KeysInHand",
  "#NewRide",
] as const;

/** Soft floor for body prose so paste-ready posts never look unfinished. */
export const MIN_MARKETING_BODY_CHARS = 120;

/** Target hashtag count for primary multi-channel posts (IG/TikTok/FB). */
export const TARGET_HASHTAG_COUNT = 5;

const parseHashtagList = (raw?: string): string[] => {
  if (!raw?.trim()) return [];
  return uniqueFormattedHashtags(
    raw
      .split(/[\n,]+/)
      .map((h) => h.trim())
      .filter(Boolean),
  );
};

const splitBodyAndTags = (caption: string): { body: string; tags: string[] } => {
  const normalized = normalizeCaptionHashtags(caption).trim();
  if (!normalized) return { body: "", tags: [] };

  const lines = normalized.split("\n");
  const lastIdx = (() => {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim()) return i;
    }
    return -1;
  })();
  if (lastIdx < 0) return { body: "", tags: [] };

  const last = lines[lastIdx].trim();
  const tags = last.match(/#[A-Za-z0-9_]+/g) || [];
  const withoutTags = last.replace(/#[A-Za-z0-9_]+/g, "").replace(/\s+/g, "");
  if (tags.length >= 1 && withoutTags.length <= 2) {
    return {
      body: lines.slice(0, lastIdx).join("\n").trimEnd(),
      tags: uniqueFormattedHashtags(tags),
    };
  }

  // Trailing tags on last prose line
  const trailing = last.match(/((?:\s*#[A-Za-z0-9_]+)+)\s*$/);
  if (trailing && tags.length >= 1) {
    const before = last.slice(0, trailing.index ?? 0).trimEnd();
    const peeled = uniqueFormattedHashtags(
      (trailing[0].match(/#[A-Za-z0-9_]+/g) as string[]) || [],
    );
    if (peeled.length > 0) {
      const body =
        before.length > 0
          ? [...lines.slice(0, lastIdx), before].join("\n").trimEnd()
          : lines.slice(0, lastIdx).join("\n").trimEnd();
      return { body, tags: peeled };
    }
  }

  return { body: normalized, tags: [] };
};

/**
 * If the model returned a stub, append a warm agency CTA that names the store.
 * Does not invent vehicle facts — only store-visit invitation language.
 */
const ensureMarketingBodyFloor = (body: string, storeName?: string): string => {
  const trimmed = (body ?? "").trim();
  const proseLen = trimmed.replace(/\s+/g, " ").length;
  if (proseLen >= MIN_MARKETING_BODY_CHARS) return trimmed;

  const name = storeName?.trim();
  if (!name) {
    if (!trimmed) {
      return "Another great delivery day in the books. Ready for your keys? Visit us this week and find the ride that feels like yours.";
    }
    return `${trimmed} Ready for your next delivery day? Stop by and let's find the one.`;
  }

  if (!trimmed) {
    return `Keys, smiles, and a new chapter. Thank you for trusting ${name} — stop by this week and let's find the ride that feels like yours.`;
  }

  if (!trimmed.toLowerCase().includes(name.toLowerCase())) {
    return `${trimmed}\n\nVisit ${name} this week and let's get you behind the wheel.`;
  }

  return `${trimmed} Stop by this week — we'd love to help you find the one.`;
};

/**
 * Ensure store brand tag, dealer defaults, and agency discovery tags appear.
 * Footer sits after body prose, before the hashtag line.
 */
export const applyDealerBrandKit = (
  caption: string,
  kit?: DealerBrandKit | null,
): string => {
  let { body, tags } = splitBodyAndTags(caption ?? "");
  const footer = (kit?.default_footer || "").trim();
  const storeName = kit?.name?.trim();

  body = ensureMarketingBodyFloor(body, storeName);

  // Strip existing footer if already present (avoid doubles on re-apply)
  if (footer) {
    const footerNorm = footer.replace(/\s+/g, " ").trim();
    const bodyNorm = body.replace(/\s+/g, " ");
    if (!bodyNorm.includes(footerNorm)) {
      body = body ? `${body.trimEnd()}\n\n${footer}` : footer;
    }
  }

  const required: string[] = [];
  if (storeName) {
    const brand = brandHashtagFromName(storeName);
    if (brand) required.push(brand);
  }
  required.push(...parseHashtagList(kit?.default_hashtags));

  const seen = new Set<string>();
  const merged: string[] = [];
  const pushUnique = (tag: string): boolean => {
    const formatted = formatHashtag(tag);
    if (!formatted) return false;
    const key = formatted.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    merged.push(formatted);
    return true;
  };
  if (kit?.required_hashtags_locked) {
    // Dealer-required tags are a brand contract: never trimmed, never
    // displaced by discovery tags. Everything else fills the remaining slots.
    required.forEach(pushUnique);
    const cap = Math.max(TARGET_HASHTAG_COUNT, merged.length);
    for (const t of [...tags, ...AGENCY_DISCOVERY_HASHTAGS]) {
      if (merged.length >= cap) break;
      pushUnique(t);
    }
  } else {
    for (const t of [...required, ...tags, ...AGENCY_DISCOVERY_HASHTAGS]) {
      pushUnique(t);
      if (merged.length >= TARGET_HASHTAG_COUNT) break;
    }
  }
  // Always keep at least brand + 3 discovery if possible
  if (merged.length < 4) {
    for (const t of AGENCY_DISCOVERY_HASHTAGS) {
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(t);
      if (merged.length >= 4) break;
    }
  }

  const parts = [body.trimEnd()];
  if (merged.length > 0) parts.push(merged.join(" "));
  return normalizeCaptionHashtags(parts.filter(Boolean).join("\n"));
};
