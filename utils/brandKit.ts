/**
 * Deterministic dealer brand kit for captions.
 * Model prompts *suggest* footer/hashtags; this layer *guarantees* them on
 * every delivery path (primary, pack, regen, alts).
 */
import {
  brandHashtagFromName,
  formatHashtag,
  normalizeCaptionHashtags,
} from "./hashtags";

export interface DealerBrandKit {
  name?: string;
  default_hashtags?: string;
  default_footer?: string;
}

const parseHashtagList = (raw?: string): string[] => {
  if (!raw?.trim()) return [];
  return raw
    .split(/[\n,]+/)
    .map((h) => formatHashtag(h.trim()))
    .filter(Boolean);
};

const splitBodyAndTags = (
  caption: string,
): { body: string; tags: string[] } => {
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
      tags,
    };
  }
  return { body: normalized, tags: [] };
};

/**
 * Ensure store brand tag, dealer default hashtags, and default footer appear
 * exactly once. Footer sits after body prose, before the hashtag line.
 */
export const applyDealerBrandKit = (
  caption: string,
  kit?: DealerBrandKit | null,
): string => {
  if (!kit) return normalizeCaptionHashtags(caption ?? "");

  let { body, tags } = splitBodyAndTags(caption ?? "");
  const footer = (kit.default_footer || "").trim();

  // Strip existing footer if already present (avoid doubles on re-apply)
  if (footer) {
    const footerNorm = footer.replace(/\s+/g, " ").trim();
    const bodyNorm = body.replace(/\s+/g, " ");
    if (bodyNorm.includes(footerNorm)) {
      // leave body as-is (already has footer)
    } else {
      body = body ? `${body.trimEnd()}\n\n${footer}` : footer;
    }
  }

  const required: string[] = [];
  if (kit.name?.trim()) {
    const brand = brandHashtagFromName(kit.name);
    if (brand) required.push(brand);
  }
  required.push(...parseHashtagList(kit.default_hashtags));

  const seen = new Set<string>();
  const merged: string[] = [];
  for (const t of [...required, ...tags]) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(t);
  }
  // Soft cap for IG/TikTok best practice
  const capped = merged.slice(0, 8);

  const parts = [body.trimEnd()];
  if (capped.length > 0) parts.push(capped.join(" "));
  return normalizeCaptionHashtags(parts.filter(Boolean).join("\n"));
};
