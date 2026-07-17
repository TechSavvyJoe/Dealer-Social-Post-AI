/**
 * Social hashtag formatting for Instagram / Facebook / TikTok delivery posts.
 *
 * Platforms only treat the contiguous token after `#` as a tag. Spaces inside
 * a tag kill it (`#New Car` → only `#New` is a hashtag). Tags must be:
 *   - Single tokens: #PascalCase or #camelCase (no spaces, no punctuation)
 *   - Separated from each other by a single space: #TagOne #TagTwo
 *   - Never glued: #TagOne#TagTwo
 *
 * 2025–2026 marketing practice (dealership-relevant):
 *   Instagram Feed/Reels: 3–5 highly relevant tags (volume no longer wins)
 *   Facebook: 0–3 light tags (excess looks spammy)
 *   TikTok: 3–5 descriptive tags
 *   Stories: 0–2 or none (not discovery-driven)
 */

/** Strip a raw token into a legal hashtag body (no #). */
export const sanitizeHashtagBody = (raw: string): string => {
  const cleaned = raw
    .replace(/^#+/, "")
    .normalize("NFKD")
    // Drop combining marks so "café" → "cafe" style bodies stay simple
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim();
  if (!cleaned) return "";

  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    // Keep existing CamelCase/all-caps; only force first letter if all lower
    const p = parts[0];
    if (/^[a-z0-9]+$/.test(p) && p.length > 1) {
      return p.charAt(0).toUpperCase() + p.slice(1);
    }
    return p;
  }
  // Multi-word → PascalCase: "new car delivery" → "NewCarDelivery"
  return parts
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
};

/** Format a complete hashtag including leading #, or empty if unusable. */
export const formatHashtag = (raw: string): string => {
  const body = sanitizeHashtagBody(raw);
  if (!body || body.length < 2) return "";
  // Soft cap — IG tags can be long but discovery dies past ~30 chars
  const clipped = body.slice(0, 40);
  return `#${clipped}`;
};

/**
 * Build a store brand hashtag from a legal dealership name.
 * "Sunrise Ford of Howell" → #SunriseFordOfHowell
 */
export const brandHashtagFromName = (dealershipName: string): string => {
  return formatHashtag(dealershipName.replace(/[^A-Za-z0-9]+/g, " "));
};

/**
 * Insert spaces between glued hashtags: `#A#B` → `#A #B`.
 */
export const separateGluedHashtags = (text: string): string => {
  let out = text;
  // Repeat until stable (handles #A#B#C)
  for (let i = 0; i < 8; i++) {
    const next = out.replace(/#([A-Za-z0-9_]+)(?=#)/g, "#$1 ");
    if (next === out) break;
    out = next;
  }
  return out;
};

/**
 * Collapse multi-word hashtag phrases into PascalCase single tokens.
 * Only continues across spaces when the next word is Capitalized — so
 * `#New Car Delivery today` → `#NewCarDelivery today` (not swallowing body text).
 * Also handles all-lowercase multi-word tags: `#happy customer` → `#HappyCustomer`
 * when every word is lowercase (LLM artifact).
 */
export const collapseSpacedHashtags = (text: string): string => {
  // Title-case continuation: #New Car Delivery
  let out = text.replace(
    /#([A-Za-z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*)+)/g,
    (full) => formatHashtag(full) || full.replace(/\s+/g, ""),
  );
  // All-lowercase multi-word: #happy customer (stop before Title Case / end)
  out = out.replace(
    /#([a-z][a-z0-9]*(?:\s+[a-z][a-z0-9]*)+)/g,
    (full) => formatHashtag(full) || full.replace(/\s+/g, ""),
  );
  return out;
};

/**
 * Normalize every hashtag token in a caption for platform paste-readiness.
 * - Separates glued tags
 * - Collapses spaces inside tags to PascalCase
 * - Strips trailing punctuation from tags (`#Car.` → `#Car`)
 * - Collapses multi-spaces between tags on the same line
 */
export const normalizeCaptionHashtags = (text: string): string => {
  if (!text?.trim()) return text;

  let out = separateGluedHashtags(text);
  out = collapseSpacedHashtags(out);

  // Trailing punctuation stuck to tags (common LLM artifact)
  out = out.replace(/#([A-Za-z0-9_]+)([.,;:!?)}\]]+)/g, "#$1");

  // Normalize known-good single tags that contain underscores → PascalCase optional
  // Keep underscores (some markets use them); only fix empty/illegal

  // Collapse runs of whitespace between hashtags on the same line to single space
  out = out.replace(/(#[A-Za-z0-9_]+)\s{2,}(?=#)/g, "$1 ");

  // If the last non-empty line is mostly hashtags, ensure single-space separation
  const lines = out.split("\n");
  const lastIdx = (() => {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim()) return i;
    }
    return -1;
  })();
  if (lastIdx >= 0) {
    const line = lines[lastIdx].trim();
    const tagMatches = line.match(/#[A-Za-z0-9_]+/g) || [];
    const withoutTags = line.replace(/#[A-Za-z0-9_]+/g, "").replace(/\s+/g, "");
    // Pure (or nearly pure) hashtag line → rebuild cleanly
    if (tagMatches.length >= 2 && withoutTags.length <= 2) {
      const unique: string[] = [];
      const seen = new Set<string>();
      for (const t of tagMatches) {
        const formatted = formatHashtag(t);
        if (!formatted) continue;
        const key = formatted.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(formatted);
      }
      if (unique.length > 0) {
        lines[lastIdx] = unique.join(" ");
        out = lines.join("\n");
      }
    }
  }

  return out;
};

/**
 * Fit a caption into a platform character budget without mid-hashtag cuts.
 * Prefers dropping trailing hashtags first, then soft-trims the body.
 */
export const fitCaptionToBudget = (
  text: string,
  maxChars: number,
): string => {
  const normalized = normalizeCaptionHashtags(text ?? "").trim();
  if (!normalized || maxChars <= 0) return normalized;
  if (normalized.length <= maxChars) return normalized;

  const lines = normalized.split("\n");
  const lastLine = lines[lines.length - 1]?.trim() ?? "";
  const tags = lastLine.match(/#[A-Za-z0-9_]+/g) || [];
  const lastIsTagLine =
    tags.length >= 1 &&
    lastLine.replace(/#[A-Za-z0-9_]+/g, "").replace(/\s+/g, "").length <= 2;

  if (lastIsTagLine && lines.length >= 2) {
    const body = lines.slice(0, -1).join("\n").trimEnd();
    let kept = [...tags];
    while (kept.length > 0) {
      const candidate = `${body}\n${kept.join(" ")}`.trim();
      if (candidate.length <= maxChars) return candidate;
      kept = kept.slice(0, -1);
    }
    if (body.length <= maxChars) return body;
    return body.slice(0, Math.max(0, maxChars - 1)).trimEnd() + "…";
  }

  // No clean hashtag line — hard trim with ellipsis
  if (normalized.length <= maxChars) return normalized;
  return normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd() + "…";
};

/** Recommended hashtag counts for dealership marketing (2025–2026). */
export const HASHTAG_BUDGET: Record<
  string,
  { min: number; max: number; note: string }
> = {
  instagram_feed: {
    min: 3,
    max: 5,
    note: "IG prioritizes 3–5 relevant tags; stuffing no longer boosts reach.",
  },
  instagram_story: {
    min: 0,
    max: 2,
    note: "Stories are not hashtag-discovery surfaces — keep optional.",
  },
  facebook_feed: {
    min: 0,
    max: 3,
    note: "FB: 0–3 light tags. Excess reads as spam and can hurt engagement.",
  },
  tiktok: {
    min: 3,
    max: 5,
    note: "TikTok: 3–5 descriptive tags; mix niche + local + vehicle intent.",
  },
  gbp: {
    min: 0,
    max: 2,
    note: "Google Business: minimal tags; local keywords in prose matter more.",
  },
  x_twitter: {
    min: 0,
    max: 2,
    note: "X is low-priority for most dealerships; 0–2 if used.",
  },
  linkedin: { min: 0, max: 3, note: "LinkedIn: 1–3 professional tags max." },
  marketplace: {
    min: 0,
    max: 1,
    note: "Marketplace: search keywords in body beat hashtags.",
  },
};

/** Deduplicate formatted hashtags (case-insensitive). */
export const uniqueFormattedHashtags = (tags: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const formatted = formatHashtag(t);
    if (!formatted) continue;
    const key = formatted.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(formatted);
  }
  return out;
};

/**
 * Split a caption into editable body vs trailing hashtags.
 * Prefers a pure last-line hashtag block; also peels trailing tags from the
 * final prose line so the studio can edit each part independently.
 */
export const splitCaptionBodyAndTags = (
  text: string,
): { body: string; tags: string[] } => {
  const normalized = normalizeCaptionHashtags(text ?? "");
  if (!normalized.trim()) return { body: "", tags: [] };

  const lines = normalized.split("\n");
  let lastIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim()) {
      lastIdx = i;
      break;
    }
  }
  if (lastIdx < 0) return { body: "", tags: [] };

  const lastLine = lines[lastIdx].trim();
  const tagMatches = lastLine.match(/#[A-Za-z0-9_]+/g) || [];
  const withoutTags = lastLine
    .replace(/#[A-Za-z0-9_]+/g, "")
    .replace(/\s+/g, "");

  // Pure (or nearly pure) hashtag line
  if (tagMatches.length >= 1 && withoutTags.length <= 2) {
    const body = lines.slice(0, lastIdx).join("\n").trimEnd();
    return { body, tags: uniqueFormattedHashtags(tagMatches) };
  }

  // Trailing hashtag run on the last prose line: "CTA here #A #B"
  const trailing = lastLine.match(/((?:\s*#[A-Za-z0-9_]+)+)\s*$/);
  if (trailing && tagMatches.length >= 1) {
    const before = lastLine.slice(0, trailing.index ?? 0).trimEnd();
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

  return { body: normalized.trimEnd(), tags: [] };
};

/** Reassemble body + hashtag chips into a paste-ready caption. */
export const joinCaptionBodyAndTags = (
  body: string,
  tags: string[],
): string => {
  const cleanBody = (body ?? "").replace(/\s+$/g, "");
  const unique = uniqueFormattedHashtags(tags);
  if (unique.length === 0) return cleanBody.trimEnd();
  if (!cleanBody.trim()) return unique.join(" ");
  return `${cleanBody.trimEnd()}\n${unique.join(" ")}`;
};

/**
 * Parse freeform hashtag input.
 * - Comma/semicolon lists: each segment is one tag (spaces inside → PascalCase)
 * - `#Tag` tokens: split on whitespace
 * - Plain phrase without #: one PascalCase tag (e.g. "New Car" → #NewCar)
 */
export const parseHashtagInput = (raw: string): string[] => {
  if (!raw?.trim()) return [];
  const separated = separateGluedHashtags(raw.trim());

  if (/[,;]/.test(separated)) {
    const tokens = separated
      .split(/[,;]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    return uniqueFormattedHashtags(tokens);
  }

  if (/#/.test(separated)) {
    const tokens = separated.split(/\s+/).filter(Boolean);
    return uniqueFormattedHashtags(tokens);
  }

  // Single multi-word phrase without # → one tag
  return uniqueFormattedHashtags([separated]);
};

/** Resolve hashtag budget for a platform id (publish target or limit id). */
export const hashtagBudgetForPlatform = (
  platformId: string | null | undefined,
): { min: number; max: number; note: string } | null => {
  if (!platformId) {
    return {
      min: 3,
      max: 5,
      note: "Primary caption: aim for 3–5 tags that work across Instagram and TikTok; use fewer on Facebook.",
    };
  }
  if (HASHTAG_BUDGET[platformId]) return HASHTAG_BUDGET[platformId];
  // Map limit meter ids
  const alias: Record<string, string> = {
    instagram: "instagram_feed",
    facebook: "facebook_feed",
    x: "x_twitter",
  };
  const mapped = alias[platformId] || platformId;
  return HASHTAG_BUDGET[mapped] ?? null;
};

/**
 * Shared instruction block for model prompts — dealership social reality:
 * Instagram, Facebook, TikTok (and Google) matter; X is optional/low priority.
 */
export const HASHTAG_PROMPT_RULES = `HASHTAG FORMATTING (critical — platforms break on mistakes):
- Each hashtag is ONE token: #PascalCase with NO spaces inside (e.g. #NewCarDelivery not #New Car Delivery).
- Separate hashtags with a single SPACE: #BrandTag #LocalTag #IntentTag
- NEVER glue tags together: wrong #Brand#Local#Intent — right #Brand #Local #Intent
- NEVER put spaces, hyphens, or punctuation inside a tag.
- Prefer 3–5 tags for Instagram/TikTok; 0–3 for Facebook; 0–2 for Stories/GBP.
- Mix: 1 branded store tag + 1 local/market tag + 1–3 high-intent auto tags (#NewCarDelivery #HappyCustomer #CarShopping).
- Optional OEM tag only if the vehicle brand is certain.
- Primary channels for dealerships: Instagram, Facebook, TikTok (not X/Twitter).`;
