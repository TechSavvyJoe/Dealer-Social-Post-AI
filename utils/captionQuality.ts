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
import { toPublicCustomerLabel } from "./customerIdentity";

const NEUTRAL_DISCOVERY_HASHTAGS = [
  "#DealershipUpdate",
  "#LocalBusiness",
  "#CommunityConnection",
  "#ExploreMore",
];

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
  /** Defaults to true for legacy delivery flows; inventory/service callers opt out. */
  customerIdentityRequired?: boolean;
}

const escapeIdentityPattern = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const CUSTOMER_NAME_TOKEN = "[\\p{Lu}][\\p{L}'’\\-]{1,39}";
const CUSTOMER_LIST_SEPARATOR = "(?:\\s+and\\s+|\\s*(?:&|\\+|/)\\s*)";
const CUSTOMER_NAME_LIST = `${CUSTOMER_NAME_TOKEN}(?:${CUSTOMER_LIST_SEPARATOR}${CUSTOMER_NAME_TOKEN})*`;
const DIRECT_CUSTOMER_ACTION =
  "drove|drives|found|chose|chooses|picked|purchased|bought|is|are|has|have|loves|love|celebrated|celebrates|celebrate|shared|shares|takes|took|starts|started|received|receives";
const CUSTOMER_ACTION =
  DIRECT_CUSTOMER_ACTION + "|just\\s+(?:" + DIRECT_CUSTOMER_ACTION + ")";

const customerContextPatterns = [
  new RegExp(
    `\\b(?:[Cc]ongratulations|[Cc]ongrats|[Cc]heers|[Ss]hout(?:-?out)?)(?:\\s+to)?[,:!]?\\s+(${CUSTOMER_NAME_LIST})`,
    "gu",
  ),
  new RegExp(
    `\\b(?:[Mm]eet|[Ww]elcoming|[Cc]elebrate(?:\\s+with)?|[Ww]elcome(?!\\s+to\\b))[,:!]?\\s+(${CUSTOMER_NAME_LIST})`,
    "gu",
  ),
  new RegExp(`\\b(${CUSTOMER_NAME_LIST})(?=\\s+(?:${CUSTOMER_ACTION})\\b)`, "gu"),
  new RegExp(
    `\\b(?:[Ff]or|[Ww]ith|[Ff]rom)\\s+(${CUSTOMER_NAME_LIST})(?=[,!.?]|\\s+(?:${CUSTOMER_ACTION})\\b)`,
    "gu",
  ),
  new RegExp(
    "\\b(?:[Hh]elping|[Ww]elcoming|[Tt]hanking|[Cc]ongratulating)\\s+(" +
      CUSTOMER_NAME_LIST +
      ")",
    "gu",
  ),
  new RegExp(
    "\\b(?:[Ff]or|[Ww]ith)\\s+(" +
      CUSTOMER_NAME_LIST +
      ")(?=$|[,!.?]|\\s+(?:at|during|today|this|on|after|before|who)\\b)",
    "gu",
  ),
  // Short campaign headlines are common in this app. Keep these explicit so
  // a wrong name cannot hide behind wording such as "Welcome home, Jordan"
  // or "Jordan — new car day" merely because the name is not next to a verb.
  new RegExp(
    `\\b(?:[Ww]elcome\\s+home|[Ww]elcome\\s+to\\s+the\\s+family|[Nn]ew\\s+car\\s+day|[Dd]elivered)[,:!\\s–—-]+(${CUSTOMER_NAME_LIST})(?=$|[^\\p{L}])`,
    "gu",
  ),
  new RegExp(
    `\\b(${CUSTOMER_NAME_LIST})\\s*(?:[,!]|[–—-])\\s*(?:[Ww]elcome\\s+home|[Ww]elcome\\s+to\\s+the\\s+family|[Nn]ew\\s+car\\s+day|[Dd]elivered)\\b`,
    "gu",
  ),
];

const NON_CUSTOMER_CONTEXT_WORDS = new Set([
  "customer",
  "customers",
  "family",
  "families",
  "they",
  "we",
  "he",
  "she",
  "it",
  "this",
  "that",
  "these",
  "those",
  "everyone",
  "someone",
  "nobody",
  "who",
  "what",
]);

export interface CaptionCustomerIdentityOptions {
  /** Dealership and vehicle phrases are grounded proper nouns, not customers. */
  allowedPhrases?: Array<string | undefined>;
  /** Require the approved public label to appear as well as rejecting others. */
  requireExpected?: boolean;
  /** For a non-customer post, reject any customer-like personal name. */
  rejectAnyCustomerIdentity?: boolean;
}

const replaceAllowedIdentityPhrase = (
  text: string,
  phrase?: string,
  placeholder = " Customer ",
): string => {
  const normalized = (phrase || "").normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!normalized) return text;
  return text.replace(
    new RegExp(
      `(^|[^\\p{L}\\p{N}])${escapeIdentityPattern(normalized)}(?=$|[^\\p{L}\\p{N}])`,
      "giu",
    ),
    `$1${placeholder}`,
  );
};

const ALLOWED_PHRASE_STOPWORDS = new Set([
  "of",
  "the",
  "and",
  "at",
  "in",
  "a",
  "an",
  "inc",
  "llc",
  "co",
  "corp",
]);

/**
 * A caption almost never repeats a dealership's or vehicle's full configured
 * name verbatim — "Bob Maxey Ford of Howell" becomes "Ford" or "Maxey Ford"
 * in natural prose. Individual words are grounded because they came from the
 * dealer's own configured name/vehicle description, not from caption text —
 * but a dealership is routinely named after real people ("Bob Maxey Ford"),
 * so a bare word this loose ("Maxey", "Ford") is also a plausible real
 * customer name and must not be whitelisted everywhere. It is only widened
 * for the one pattern below that actually needs it.
 */
const allowedPhraseTokens = (phrase?: string): string[] => {
  const normalized = (phrase || "").normalize("NFKC").trim();
  if (!normalized) return [];
  return normalized
    .split(/\s+/)
    .filter(
      (word) => word.length > 1 && !ALLOWED_PHRASE_STOPWORDS.has(word.toLowerCase()),
    );
};

/**
 * Index into `customerContextPatterns` of the plain "X is/has/drove ..."
 * shape: any capitalized word immediately before a common verb, with no
 * "Congrats/Meet/Welcome/For/With" framing. It is the most generic pattern —
 * the only one ordinary prose about the dealership itself naturally
 * triggers ("Ford is proud to...", "Maxey Ford has done it again") — so it
 * is the only pattern where a dealer/vehicle word is forgiven below. Every
 * other, more deliberate customer-naming pattern ("Congratulations to X",
 * "Meet X", "Welcome home, X") keeps requiring the allowed phrase's exact
 * configured text, unchanged, so a real customer who happens to share a
 * word with the dealer's own name is still caught wherever a caption
 * actually goes out of its way to name someone.
 */
const BARE_ACTION_PATTERN_INDEX = 2;

/**
 * `CUSTOMER_NAME_TOKEN` only ever spans a single capitalized word for this
 * pattern — a plain space (as opposed to "and"/"&"/"+"/"/") never joins two
 * tokens into one candidate. So a real two-word name with no list separator
 * — "Sarah Ford is thrilled..." — only ever yields "Ford" as a candidate;
 * "Sarah" is invisible to the match entirely. Forgiving "Ford" there would
 * silently ship "Sarah Ford" whole. This checks whether a DIFFERENT
 * (non-dealer/vehicle, non-filler) capitalized word sits somewhere before
 * the matched token — if so, it's a real personal name, not the dealer's
 * own name, and the token must not be forgiven. The trailing separator
 * reuses the exact headline-punctuation class `customerContextPatterns[6]`
 * and `[7]` already trust ("Jordan — new car day!") — not just a plain
 * space — so a vocative opener written with a colon, dash, or exclamation
 * point ("Sarah — Ford is proud...") is caught too.
 */
const CHAIN_WORD_PATTERN = new RegExp(
  `(?:^|[^\\p{L}\\p{N}])(${CUSTOMER_NAME_TOKEN})[,:!\\s–—-]*$`,
  "u",
);

/**
 * The literal opener vocabulary every OTHER `customerContextPatterns` entry
 * matches on ("Congrats to X", "Meet X", "Welcome home, X", ...). Punctuation
 * tolerance above means one of these words can now sit immediately before a
 * forgiven token too ("Congratulations, Ford is thrilled...") — without
 * this, that would misread as a "Congratulations" customer and reject a
 * caption naming no one. Reusing this already-audited set (rather than a
 * new heuristic) keeps the exemption from becoming its own surface to get
 * wrong. Includes bare "shout" alongside "shoutout"/"shout-out" since
 * pattern[0]'s own regex (`[Ss]hout(?:-?out)?`) treats it the same way.
 */
const CUSTOMER_CONTEXT_TRIGGER_WORDS = new Set([
  "congratulations",
  "congrats",
  "cheers",
  "shout",
  "shoutout",
  "shout-out",
  "meet",
  "welcoming",
  "welcome",
  "celebrate",
  "helping",
  "thanking",
  "congratulating",
  "for",
  "with",
  "from",
  "delivered",
]);

/**
 * "[Founder first] [Founder last] [Brand]" is the standard car-dealer
 * naming convention this feature exists to support — the ALLOWED dealer
 * name itself is routinely two or more consecutive capitalized words
 * ("Bob Maxey Ford"). So a single lookback hop isn't enough: it must walk
 * backward through however many consecutive ALLOWED words precede the
 * match before concluding nothing unrelated is there — otherwise a third,
 * genuinely unrelated word ("Sarah Maxey Ford is thrilled...") hides behind
 * the already-legitimate two-word dealer run right in front of it.
 */
const precededByUnrelatedName = (
  caption: string,
  matchIndex: number,
  allowedWords: ReadonlySet<string>,
): boolean => {
  let remaining = caption.slice(0, matchIndex);
  for (;;) {
    const match = remaining.match(CHAIN_WORD_PATTERN);
    if (!match) return false;
    const lower = match[1].toLocaleLowerCase("en-US");
    if (NON_CUSTOMER_CONTEXT_WORDS.has(lower)) return false;
    if (CUSTOMER_CONTEXT_TRIGGER_WORDS.has(lower)) return false;
    if (!allowedWords.has(lower)) return true;
    remaining = remaining.slice(0, match.index);
  }
};

/**
 * Extracts every name-shaped candidate `customerContextPatterns` finds in
 * the UNMODIFIED caption, then drops a candidate only if it is individually
 * an allowed dealer/vehicle word AND came from the bare-action pattern AND
 * is not itself part of a longer, unrelated personal name. Filtering after
 * matching (rather than blanking the word out of the text first) matters: a
 * name list like "Jordan and Ford are picking up..." must still catch
 * "Jordan" even though "Ford" is forgiven — pre-erasing "Ford" from the text
 * would break the list match itself and lose "Jordan" too.
 */
const namesFromCustomerContext = (
  caption: string,
  allowedWords: ReadonlySet<string> = new Set(),
): string[] => {
  const found: string[] = [];
  customerContextPatterns.forEach((pattern, patternIndex) => {
    pattern.lastIndex = 0;
    for (const match of caption.matchAll(pattern)) {
      const group = match[1] || "";
      const isBareAction = patternIndex === BARE_ACTION_PATTERN_INDEX;
      const precededByForeignName =
        isBareAction &&
        precededByUnrelatedName(caption, match.index ?? 0, allowedWords);
      for (const token of group.split(/\s+and\s+|\s*(?:&|\+|\/)\s*/i)) {
        const normalized = token.normalize("NFKC").trim();
        if (!normalized) continue;
        const lower = normalized.toLocaleLowerCase("en-US");
        if (NON_CUSTOMER_CONTEXT_WORDS.has(lower)) continue;
        if (isBareAction && allowedWords.has(lower) && !precededByForeignName) {
          continue;
        }
        found.push(normalized);
      }
    }
  });
  return found;
};

/**
 * Fail closed when customer-like grammar introduces a second person. This is
 * intentionally narrower than treating every capitalized word as a name:
 * dealership, city, vehicle, and model names are normal marketing copy.
 */
export const captionUsesOnlyExpectedCustomer = (
  caption: string,
  expectedCustomerName?: string,
  options: CaptionCustomerIdentityOptions = {},
): boolean => {
  const expected = toPublicCustomerLabel(expectedCustomerName);
  const normalizedCaption = (caption || "").normalize("NFKC").replace(/\s+/g, " ");
  const exactIdentity = expected
    ? new RegExp(
        `(^|[^\\p{L}\\p{N}])${escapeIdentityPattern(expected)}(?=$|[^\\p{L}\\p{N}])`,
        "iu",
      )
    : null;

  if (
    options.requireExpected &&
    (!exactIdentity || !exactIdentity.test(normalizedCaption))
  ) {
    return false;
  }
  if (
    expected &&
    new RegExp(
      `(^|[^\\p{L}\\p{N}])${escapeIdentityPattern(expected)}\\p{L}+(?=$|[^\\p{L}\\p{N}])`,
      "iu",
    ).test(normalizedCaption)
  ) {
    return false;
  }
  if (!expected && !options.rejectAnyCustomerIdentity) return true;

  let identityScan = normalizedCaption;
  identityScan = replaceAllowedIdentityPhrase(identityScan, expected);
  for (const phrase of options.allowedPhrases || []) {
    identityScan = replaceAllowedIdentityPhrase(identityScan, phrase);
  }
  if (
    /\bCustomer\s+(?:[\p{Lu}][\p{L}'’\-]{1,39}|[\p{Lu}]\.)(?=$|[^\p{L}])/gu.test(
      identityScan,
    )
  ) {
    return false;
  }

  // The bare-action exemption is applied by filtering candidates found
  // against the caption AFTER the full-phrase-only scrub above, never by
  // blanking a dealer/vehicle word out of the text — a text edit here would
  // corrupt an adjacent, unrelated multi-name match (see
  // BARE_ACTION_PATTERN_INDEX's docstring).
  const allowedWords = new Set<string>();
  for (const phrase of options.allowedPhrases || []) {
    for (const token of allowedPhraseTokens(phrase)) {
      allowedWords.add(token.toLowerCase());
    }
  }
  return namesFromCustomerContext(identityScan, allowedWords).length === 0;
};

/**
 * A fluent caption is still unusable when it names the wrong customer. When a
 * release/form supplies an identity, require that exact phrase to survive the
 * model response; otherwise the deterministic fallback is safer than guessing.
 */
export const captionUsesExpectedCustomer = (
  caption: string,
  expectedCustomerName?: string,
): boolean => {
  return captionUsesOnlyExpectedCustomer(caption, expectedCustomerName, {
    requireExpected: Boolean(toPublicCustomerLabel(expectedCustomerName)),
  });
};

/** Deterministic, paste-ready marketing caption when AI fails quality checks. */
export const buildSafeMarketingCaption = (opts: SafeCaptionOptions): string => {
  const store = (opts.storeName || "our dealership").trim();
  const publicCustomer = toPublicCustomerLabel(opts.customerName);
  const customerIdentityRequired = opts.customerIdentityRequired ?? true;
  const who = publicCustomer || "our newest customer";
  const ride = opts.vehiclePhrase?.trim()
    ? opts.vehiclePhrase.trim()
    : "their new ride";

  const body = (
    publicCustomer || customerIdentityRequired
      ? [
          `Keys in hand and big smiles — ${who} just drove off in ${ride}.`,
          `Moments like this are why we love what we do at ${store}.`,
          `Ready for your delivery day? Visit ${store} this week and find the one that feels like yours.`,
        ]
      : [
          `Fresh at ${store} — ${opts.vehiclePhrase?.trim() || "a standout vehicle"} is ready for a closer look.`,
          "Our team is excited to share the details and help shoppers find the right fit.",
          `Visit ${store} this week to explore what is available.`,
        ]
  ).join("\n\n");

  const tags = uniqueFormattedHashtags([
    brandHashtagFromName(store),
    ...(opts.defaultHashtags || "")
      .split(/[\n,]+/)
      .map((h) => formatHashtag(h.trim()))
      .filter(Boolean),
    ...(customerIdentityRequired
      ? AGENCY_DISCOVERY_HASHTAGS
      : NEUTRAL_DISCOVERY_HASHTAGS),
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
  if (
    !isLowQualityCaption(cleaned) &&
    captionUsesOnlyExpectedCustomer(cleaned, opts.customerName, {
      allowedPhrases: [opts.storeName, opts.vehiclePhrase],
      requireExpected: Boolean(toPublicCustomerLabel(opts.customerName)),
      rejectAnyCustomerIdentity: Boolean(
        (opts.customerIdentityRequired ?? true) &&
        !toPublicCustomerLabel(opts.customerName),
      ),
    })
  ) {
    return { caption: cleaned, usedFallback: false };
  }
  return {
    caption: buildSafeMarketingCaption(opts),
    usedFallback: true,
  };
};
