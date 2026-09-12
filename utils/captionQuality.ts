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
import { AGENCY_DISCOVERY_HASHTAGS, CUSTOMER_TRUST_HASHTAGS } from "./brandKit";
import { toPublicCustomerLabel } from "./customerIdentity";
import { isAutomotiveBrandToken } from "./automotiveBrands";

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
  /** Named in prose freely, never the celebrated customer (the salesperson). */
  maskedPhrases?: Array<string | undefined>;
  /** The OEM the dealer sells ("Ford") — a brand word, never a customer. */
  oemAffiliation?: string;
  defaultHashtags?: string;
  /** Defaults to true for legacy delivery flows; inventory/service callers opt out. */
  customerIdentityRequired?: boolean;
  /**
   * Whether "just drove off in...", "delivery day" language is true for this
   * post. Defaults to true so every pre-existing caller (which never had a
   * reason to think about this before Recall Completion/Customer Testimonial
   * existed) keeps today's behavior unchanged. A caller for a customer-story
   * scenario that is NOT a vehicle handoff (a recall visit, a testimonial
   * quote) must pass false, or the deterministic fallback fabricates a
   * vehicle purchase/delivery that never happened.
   */
  deliveryLanguageAllowed?: boolean;
}

const escapeIdentityPattern = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------------------------------------------------------------------------
// Customer-identity guard
//
// Refuses a caption that names a person who is not the authorized customer.
// It runs three times on every post — at generation (hooks/useGeneration.ts),
// before save/reopen (services/posts.ts) and on the server
// (pb_hooks/websitePublications.js, on save, on History projection and on
// website send) — so EVERYTHING below is mirrored 1:1 in that server file and
// the two are parity-tested (__tests__/customerIdentityParity.test.ts). Change
// one, change both, add the caption to the corpus.
//
// The model: a capitalized word is a candidate only when it sits in a slot
// that ADDRESSES a person (an opener like "Congrats to", a trailing vocative,
// "for/with/from", a "X is/has…" subject, a headline). A candidate is then
// forgiven when it is provably a thing: a run of the dealership's own
// configured words, the OEM followed by model words, a word introduced by a
// determiner ("this Bronco"), the authorized customer, or one of the closed
// non-customer word lists. A grounded run in an opener can still hand the
// sentence off to a person ("Bob Maxey Ford's newest owner, Michelle") and
// that person is what gets refused.
// ---------------------------------------------------------------------------

// A personal-name token is never directly followed by a digit or a hyphen
// into a digit, so "F-150", "F-250 XLT", "Model 3" can never be mistaken for
// a name's first word.
const CUSTOMER_NAME_TOKEN = "[\\p{Lu}][\\p{L}'’\\-]{1,39}(?![\\p{N}-])";
const CUSTOMER_LIST_SEPARATOR = "(?:\\s+and\\s+|\\s*(?:&|\\+|/)\\s*)";
const CUSTOMER_NAME_LIST = `${CUSTOMER_NAME_TOKEN}(?:${CUSTOMER_LIST_SEPARATOR}${CUSTOMER_NAME_TOKEN})*`;
// Participles only for the photo-description verbs: the finite forms
// ("smiles", "stands") read as nouns in the captions the model actually
// writes ("Big smiles today!") and flagged the sentence-opening word.
const DIRECT_CUSTOMER_ACTION =
  "drove|drives|found|chose|chooses|picked|purchased|bought|is|are|was|were|has|have|got|went|left|joined|became|owns|loves|love|celebrated|celebrates|celebrate|shared|shares|takes|took|starts|started|received|receives|standing|posing|smiling";
const CUSTOMER_ACTION =
  DIRECT_CUSTOMER_ACTION + "|just\\s+(?:" + DIRECT_CUSTOMER_ACTION + ")";
// Up to five lowercase words may sit between "to" and the person: "Congrats
// to our newest customer, Michelle!", "Congrats to the Johnson family".
const OPENER_LEAD_IN = "(?:\\s+[\\p{Ll}][\\p{Ll}'’-]*){0,5}?[,:]?";
const HEADLINE_OPENERS =
  "[Ww]elcome\\s+home|[Ww]elcome\\s+to\\s+the\\s+family|[Nn]ew\\s+car\\s+day|[Dd]elivered|[Ss]old";

/**
 * Where a caption addresses someone. Index 2 is the generic "X is/has…"
 * subject and gets the determiner exemption; 3 and 5 are prose, so the
 * masked salesperson is forgiven there; 6 and 7 are headline slots a vehicle
 * legitimately fills ("Delivered: Ford Bronco Sport"); 8 is a trailing
 * vocative ("Thank you, Michelle!"). An opener followed by "!" starts a new
 * sentence, so "!" is never a separator between opener and name.
 */
const customerContextPatterns = [
  new RegExp(
    `\\b(?:[Cc]ongratulations|[Cc]ongrats|[Cc]heers|[Ss]hout(?:-?out)?|[Tt]hanks|[Tt]hank\\s+you|[Kk]udos)(?:\\s+again)?(?:\\s+to${OPENER_LEAD_IN}|[,:]?)\\s+(${CUSTOMER_NAME_LIST})`,
    "gu",
  ),
  new RegExp(
    `\\b(?:[Mm]eet|[Ww]elcoming|[Cc]elebrate(?:\\s+with)?|[Ww]elcome(?!\\s+(?:to|aboard)\\b))[,:]?\\s+(${CUSTOMER_NAME_LIST})`,
    "gu",
  ),
  new RegExp(`\\b(${CUSTOMER_NAME_LIST})(?=\\s+(?:${CUSTOMER_ACTION})\\b)`, "gu"),
  new RegExp(
    `\\b(?:[Ff]or|[Ww]ith|[Ff]rom)\\s+(?:the\\s+)?(${CUSTOMER_NAME_LIST})(?=(?:\\s+${CUSTOMER_NAME_TOKEN})*(?:[,!.?]|\\s+(?:${CUSTOMER_ACTION})\\b))`,
    "gu",
  ),
  new RegExp(
    `\\b(?:[Hh]elping|[Ww]elcoming|[Tt]hanking|[Cc]ongratulating)\\s+(${CUSTOMER_NAME_LIST})`,
    "gu",
  ),
  new RegExp(
    `\\b(?:[Ff]or|[Ww]ith|[Ff]rom)\\s+(?:the\\s+)?(${CUSTOMER_NAME_LIST})(?=(?:\\s+${CUSTOMER_NAME_TOKEN})*(?:$|[,!.?]|\\s+(?:at|during|today|this|on|after|before|who)\\b))`,
    "gu",
  ),
  new RegExp(
    `\\b(?:(?:${HEADLINE_OPENERS})(?:\\s+to${OPENER_LEAD_IN}\\s+|[,:\\s–—-]+)|[Ww]elcome\\s+(?:aboard|to\\s+[^,:!\\n–—]{1,80}?)\\s*[,:–—-]+\\s*)(${CUSTOMER_NAME_LIST})(?=$|[^\\p{L}])`,
    "gu",
  ),
  new RegExp(
    `\\b(${CUSTOMER_NAME_LIST})\\s*(?:[,!]|[–—-])\\s*(?:[Ww]elcome\\s+(?:home|aboard|to\\s+[^.!?\\n]{1,60})|[Nn]ew\\s+car\\s+day|[Dd]elivered|[Ss]old)\\b`,
    "gu",
  ),
  new RegExp(
    `,\\s*(${CUSTOMER_NAME_LIST})(?:\\s+${CUSTOMER_NAME_TOKEN})*\\s*[!.?]*\\s*(?=$|\\n)`,
    "gu",
  ),
];

/** A congratulation opener still governing the clause just before a match. */
const CONGRATULATION_OPENER_PATTERN =
  /\b(?:[Cc]ongratulations|[Cc]ongrats|[Cc]heers|[Ss]hout(?:-?out)?|[Tt]hanks|[Tt]hank\s+you|[Kk]udos|[Mm]eet|[Ww]elcome)\b[^.!?\n]*$/u;

const BARE_ACTION_PATTERN_INDEX = 2;
/** Prose slots where the salesperson's name is forgiven ("Ask for Joe"). */
const PROSE_PATTERN_INDEXES: readonly number[] = [3, 5];
const DELIBERATE_PATTERN_INDEXES = customerContextPatterns
  .map((_, index) => index)
  .filter(
    (index) =>
      index !== BARE_ACTION_PATTERN_INDEX && !PROSE_PATTERN_INDEXES.includes(index),
  );

/**
 * Slots a VEHICLE legitimately fills ("Delivered: Ford Bronco Sport",
 * "Mustang — new car day!", "This Bronco is…", "Much love, Howell!"). Only
 * here may an OEM brand word be followed by capitalized model words; in a
 * deliberately personal opener ("Congrats to Ford Johnson") a capitalized
 * word after the brand is a surname, never a model.
 */
const vehicleSlotPattern = (patternIndex: number, matchText: string): boolean =>
  patternIndex === BARE_ACTION_PATTERN_INDEX ||
  patternIndex === 7 ||
  patternIndex === 8 ||
  (patternIndex === 6 &&
    /^(?:[Dd]elivered|[Nn]ew\s+car\s+day|[Ss]old)/u.test(matchText));

/**
 * Words that can never be a customer: pronouns, calendar words, the
 * collective nouns that follow the dealer's own name ("Ford family", "Maxey
 * team"), and the ordinary capitalized sentence openers a caption puts before
 * "is/are/has" ("Today is delivery day", "Keys are in hand", "There is",
 * "Congratulations are in order"). Kept identical on the server.
 */
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
  "there",
  "here",
  "now",
  "then",
  "everyone",
  "someone",
  "nobody",
  "who",
  "what",
  "how",
  "when",
  "where",
  "why",
  "which",
  "everything",
  "everybody",
  "anyone",
  "anybody",
  "anything",
  "something",
  "somebody",
  "nothing",
  "none",
  "all",
  "more",
  "big",
  "huge",
  "ready",
  "yes",
  "well",
  "hello",
  "hi",
  "hey",
  "home",
  "congratulations",
  "congrats",
  "thanks",
  "cheers",
  "kudos",
  "today",
  "tonight",
  "tomorrow",
  "yesterday",
  "day",
  "days",
  "night",
  "morning",
  "afternoon",
  "evening",
  "week",
  "month",
  "year",
  "season",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "spring",
  "summer",
  "fall",
  "autumn",
  "winter",
  "weekend",
  "christmas",
  "thanksgiving",
  "halloween",
  "easter",
  "holiday",
  "holidays",
  "keys",
  "delivery",
  "adventure",
  "owner",
  "owners",
  "team",
  "crew",
  "staff",
  "nation",
  "fans",
  "community",
  "dealership",
  "store",
  "showroom",
  "department",
  "sales",
  "parts",
  "finance",
  "inventory",
  "lot",
  "safety",
  "trust",
  "happiness",
  "paperwork",
  "sunshine",
  "service",
  "time",
  "another",
  "enjoy",
  "welcome",
  "smiles",
  "life",
  "road",
  "ride",
  "drivers",
]);

/**
 * Words that may directly follow the dealer's own name in a deliberate
 * opener and prove it is the business being addressed, not a person:
 * "Congrats, Ford family!", "Shout-out to the Maxey Ford team".
 */
const COLLECTIVE_FOLLOWERS = new Set([
  "family",
  "families",
  "team",
  "crew",
  "staff",
  "nation",
  "fans",
  "community",
  "dealership",
  "store",
  "showroom",
  "customers",
  "drivers",
  "owners",
]);

/**
 * Nouns that hand a sentence from the business (or a vehicle) to a person:
 * "Bob Maxey Ford's newest customer, Michelle", "Meet Howell's newest owner
 * Sarah", "the newest Bronco owner, Michelle", "Bob's wife Michelle". A
 * capitalized word right before one of them is the thing owned; the first
 * unknown capitalized word after one is the person.
 */
const HANDOFF_CONNECTORS = new Set([
  "to",
  "for",
  "own",
  "owner",
  "owners",
  "customer",
  "customers",
  "buyer",
  "buyers",
  "driver",
  "drivers",
  "member",
  "members",
  "wife",
  "husband",
  "spouse",
  "partner",
  "son",
  "daughter",
  "mom",
  "mother",
  "dad",
  "father",
  "friend",
  "brother",
  "sister",
]);

export interface CaptionCustomerIdentityOptions {
  /**
   * Grounded business identity — the dealership's configured name, the OEM it
   * sells, a VIN-decoded vehicle description. Every WORD of these may stand
   * alone in customer-name grammar as long as nothing that looks like the
   * rest of a personal name is attached to it.
   */
  allowedPhrases?: Array<string | undefined>;
  /**
   * Phrases that are legitimate in prose but must never be accepted as the
   * celebrated customer (the salesperson's name). They are masked out of the
   * generic "X is/has…" and "for/with/from" scans only; "Congratulations to
   * <salesperson>" is still refused. Mirrors the plain-string entries on the
   * server.
   */
  maskedPhrases?: Array<string | undefined>;
  /** Require the approved public label to appear as well as rejecting others. */
  requireExpected?: boolean;
  /** For a non-customer post, reject any customer-like personal name. */
  rejectAnyCustomerIdentity?: boolean;
}

const IDENTITY_PLACEHOLDER = " Customer ";

const replaceAllowedIdentityPhrase = (text: string, phrase?: string): string => {
  const normalized = (phrase || "").normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!normalized) return text;
  return text.replace(
    new RegExp(
      `(^|[^\\p{L}\\p{N}])${escapeIdentityPattern(normalized).replace(/ /g, "\\s+")}(?=$|[^\\p{L}\\p{N}])`,
      "giu",
    ),
    `$1${IDENTITY_PLACEHOLDER}`,
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

const allowedPhraseTokens = (phrase?: string): string[] => {
  const normalized = (phrase || "").normalize("NFKC").trim();
  if (!normalized) return [];
  return normalized
    .split(/\s+/)
    .filter(
      (word) => word.length > 1 && !ALLOWED_PHRASE_STOPWORDS.has(word.toLowerCase()),
    );
};

const stripPossessive = (token: string): string => token.replace(/['’]s?$/u, "");
const lowerToken = (token: string): string =>
  stripPossessive(token).normalize("NFKC").toLocaleLowerCase("en-US");
const isCapitalized = (token: string): boolean => /^\p{Lu}/u.test(token);
const hasDigit = (token: string): boolean => /\p{N}/u.test(token);

/**
 * A caption almost never repeats a dealership's or vehicle's full configured
 * name verbatim — "Bob Maxey Ford of Howell" becomes "Ford", "Maxey Ford",
 * "Howell", or "Bob Maxey Ford's team" in natural prose. Individual words are
 * grounded because they came from the dealer's own configured name / OEM
 * affiliation / VIN-decoded vehicle description — but a dealership is
 * routinely named after real people ("Bob Maxey Ford"), so a bare word this
 * loose ("Bob", "Maxey") is also a plausible real customer name. `pairs`
 * records which grounded words are ADJACENT in a configured phrase, so a run
 * of dealer words is only forgiven when it is a real slice of the name:
 * "Maxey Ford" and "Bob Maxey Ford's" are, "Bob Howell" and "Bob Ford" are
 * not. `modelWords` are the words that follow the OEM in a VIN-decoded
 * phrase ("2025 Ford Bronco Big Bend" → bronco/big/bend): the only lone
 * grounded words that legitimately open a "X is ready" sentence.
 */
interface IdentityGrounding {
  words: ReadonlySet<string>;
  pairs: ReadonlySet<string>;
  modelWords: ReadonlySet<string>;
}

const buildGrounding = (
  phrases: Array<string | undefined> | undefined,
): IdentityGrounding => {
  const words = new Set<string>();
  const pairs = new Set<string>();
  const modelWords = new Set<string>();
  for (const phrase of phrases || []) {
    const tokens = allowedPhraseTokens(phrase);
    const lowered = tokens.map(lowerToken);
    lowered.forEach((token, index) => {
      words.add(token);
      if (index > 0) pairs.add(`${lowered[index - 1]}>${token}`);
    });
    // Model words are walked over the RAW tokens so the phrase's own stopword
    // breaks the run: "2025 Ford Bronco Big Bend" yields bronco/big/bend, but
    // "Bob Maxey Ford of Howell" yields nothing — the town after "of" is not
    // a model, and treating it as one forgave "Howell is all smiles".
    let afterBrand = false;
    for (const raw of (phrase || "").normalize("NFKC").trim().split(/\s+/)) {
      if (!raw) continue;
      if (ALLOWED_PHRASE_STOPWORDS.has(raw.toLowerCase())) afterBrand = false;
      else if (isAutomotiveBrandToken(raw)) afterBrand = true;
      else if (afterBrand) modelWords.add(lowerToken(raw));
    }
  }
  return { words, pairs, modelWords };
};

/**
 * A capitalized word sitting right after a determiner or possessive
 * ("this Bronco", "your new Explorer", "their gorgeous new Escape") is a
 * thing, not a person — English does not put "this"/"your"/"our" in front
 * of someone's given name. "that" is left out because it is just as often a
 * conjunction that DOES precede a name ("we're thrilled that Sarah is..."),
 * and "the" is handled separately (it can precede a pluralized or possessive
 * family name — "the Johnsons are", "the Johnson's are" — which is exactly
 * the shape a name read off a SOLD sign in the photo takes).
 */
const NOUN_DETERMINERS = new Set([
  "this",
  "these",
  "those",
  "your",
  "our",
  "their",
  "his",
  "her",
  "its",
  "my",
  "a",
  "an",
  "another",
  "every",
  "each",
]);

/**
 * Possessive determiners that can introduce a PERSON ("our Michelle", "her
 * Sarah"). They still count when an adjective sits between them and the
 * candidate ("Their new Bronco Sport is"), but not when an unknown
 * capitalized word was crossed with no adjective in front of it: "Our
 * Michelle Smith is" is a person.
 */
const PERSON_CAPABLE_DETERMINERS = new Set(["our", "their", "his", "her", "its", "my"]);

/**
 * Lowercase descriptive words a caption commonly stacks between a
 * determiner and the vehicle ("her shiny new Bronco"). Deliberately a short
 * closed list of words that describe THINGS: walking back over any
 * lowercase word would let "her friend Michelle is..." reach "her", and
 * words that praise people ("our very own Sarah", "our amazing Michelle")
 * are exactly how a caption introduces a customer, so they are excluded.
 */
const DETERMINER_ADJECTIVES = new Set([
  "new",
  "brand",
  "shiny",
  "stunning",
  "beautiful",
  "gorgeous",
  "sleek",
  "gleaming",
  "sparkling",
  "first",
  "next",
  "dream",
  "perfect",
  "fresh",
  "latest",
  "newest",
  "bold",
  "loaded",
  "certified",
  "preowned",
  "used",
  "custom",
  "black",
  "white",
  "blue",
  "red",
  "silver",
  "gray",
  "grey",
  "green",
  "orange",
  "yellow",
  "bronze",
  "gold",
  "copper",
  "pearl",
  "metallic",
  "sporty",
  "rugged",
  "everyday",
  "electric",
  "hybrid",
  "lifted",
  "spotless",
  "immaculate",
  "clean",
  "sharp",
  "capable",
  "tough",
  "fully",
  "gently",
  "redesigned",
  "upgraded",
]);

/** The word (plus optional orphaned possessive) just before a position. */
const PREVIOUS_WORD_PATTERN =
  /(?:^|[^\p{L}\p{N}'’-])([\p{L}\p{N}][\p{L}\p{N}'’-]*)(?:\s+['’]s)?[^\S\n]+$/u;

/**
 * True when the bare-action candidate at `tokenIndex` is introduced by a
 * determiner phrase ("this ... Bronco", "your new Explorer", "this 2025 Ford
 * Bronco Sport Big Bend", "Michelle's new Bronco" once the approved label is
 * blanked, "F-150 Lightning"). "the" counts only for a singular-looking,
 * non-possessive token so "The Explorer is heading home" passes while "the
 * Johnsons are thrilled" / "The Johnson's are all smiles" are still caught.
 * A line break is a hard stop: "…like this\nMichelle is…" is a new sentence.
 */
const precededByDeterminer = (
  caption: string,
  tokenIndex: number,
  token: string,
  grounding: IdentityGrounding,
): boolean => {
  let remaining = caption.slice(0, tokenIndex);
  let crossedUnknownCapital = false;
  let crossedAdjective = false;
  for (let hops = 0; hops <= 6; hops++) {
    const match = remaining.match(PREVIOUS_WORD_PATTERN);
    if (!match) return false;
    const raw = match[1];
    const word = lowerToken(raw);
    const possessive = /['’]s?$/u.test(raw) || /['’]s\s*$/u.test(match[0].trimEnd());
    // The blanked approved label or salesperson owns the thing.
    if (word === "customer" && possessive) return true;
    if (NOUN_DETERMINERS.has(word)) {
      return !(
        crossedUnknownCapital &&
        !crossedAdjective &&
        PERSON_CAPABLE_DETERMINERS.has(word)
      );
    }
    if (word === "the") return !/['’]/u.test(token) && !/s$/iu.test(token);
    // A model year or a hyphenated/numbered trim ("F-150", "2025") right in
    // front of the candidate can only precede a vehicle.
    if (hasDigit(raw)) return true;
    const capitalized = isCapitalized(raw);
    const knownVehicleWord =
      capitalized && (grounding.words.has(word) || isAutomotiveBrandToken(raw));
    // A possessive that is not the dealer's own name ("The Johnsons' new
    // Explorer", "The Smith's Bronco") is a family owning the vehicle.
    if (capitalized && possessive && !knownVehicleWord) return false;
    const walkable =
      DETERMINER_ADJECTIVES.has(word) ||
      /-/u.test(raw) ||
      // Another model word / the make in front of the model: "this Ford
      // Bronco Sport is", "your new Bronco Sport is", "Our Service
      // Department is".
      (capitalized && !CUSTOMER_CONTEXT_TRIGGER_WORDS.has(word));
    if (!walkable) return false;
    if (DETERMINER_ADJECTIVES.has(word)) crossedAdjective = true;
    if (capitalized && !knownVehicleWord && !NON_CUSTOMER_CONTEXT_WORDS.has(word)) {
      crossedUnknownCapital = true;
    }
    // Cut just before the word, keeping its leading separator so the next
    // hop still sees a word followed by whitespace.
    remaining = remaining.slice(0, (match.index ?? 0) + match[0].indexOf(raw));
  }
  return false;
};

const CHAIN_WORD_PATTERN = new RegExp(
  `(?:^|[^\\p{L}\\p{N}])(${CUSTOMER_NAME_TOKEN})(?:\\s+(${[...ALLOWED_PHRASE_STOPWORDS].join("|")}))?[,:!\\s–—-]*$`,
  "u",
);
// No `i` flag: the stopword bridge is lowercase by construction and the
// name token MUST stay case-sensitive, or every following lowercase word
// would read as another capitalized name.
const NEXT_WORD_PATTERN = new RegExp(
  `^\\s+(?:(${[...ALLOWED_PHRASE_STOPWORDS].join("|")})\\s+)?(${CUSTOMER_NAME_TOKEN})`,
  "u",
);

/**
 * The literal opener vocabulary the deliberate patterns match on. One of
 * these right before a forgiven token ("Congratulations, Ford is
 * thrilled...") must not read as a preceding name.
 */
const CUSTOMER_CONTEXT_TRIGGER_WORDS = new Set([
  "congratulations",
  "congrats",
  "cheers",
  "shout",
  "shoutout",
  "shout-out",
  "thanks",
  "thank",
  "kudos",
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
  "sold",
]);

interface GroundedRun {
  /** False when an unrelated capitalized word is glued to the run. */
  ok: boolean;
  /** Caption offset just past the last word of the run. */
  end: number;
  tokenCount: number;
  endsWithPossessive: boolean;
  lastIsBrand: boolean;
  containsBrand: boolean;
}

/**
 * "[Founder first] [Founder last] [Brand]" is the standard car-dealer
 * naming convention this feature exists to support — the ALLOWED dealer
 * name itself is routinely two or more consecutive capitalized words
 * ("Bob Maxey Ford"). Walk backward through the consecutive,
 * ADJACENT-in-the-phrase dealer words (bridging the phrase's own stopword in
 * "Ford of Howell") that precede the match. Any other capitalized word there
 * ("Sarah Maxey Ford is thrilled...") means the run is half of a real name;
 * a determiner, a non-customer word or an opener word ends the walk
 * harmlessly ("Your Ford is back on the road").
 */
const precedingRun = (
  caption: string,
  matchIndex: number,
  token: string,
  grounding: IdentityGrounding,
): { unrelated: boolean; tokenCount: number; containsBrand: boolean } => {
  let remaining = caption.slice(0, matchIndex);
  let current = lowerToken(token);
  let tokenCount = 0;
  let containsBrand = false;
  for (;;) {
    const match = remaining.match(CHAIN_WORD_PATTERN);
    if (!match) return { unrelated: false, tokenCount, containsBrand };
    const lower = lowerToken(match[1]);
    if (
      NON_CUSTOMER_CONTEXT_WORDS.has(lower) ||
      CUSTOMER_CONTEXT_TRIGGER_WORDS.has(lower) ||
      NOUN_DETERMINERS.has(lower) ||
      lower === "the"
    ) {
      return { unrelated: false, tokenCount, containsBrand };
    }
    if (!grounding.pairs.has(`${lower}>${current}`)) {
      return { unrelated: true, tokenCount, containsBrand };
    }
    tokenCount += 1;
    if (isAutomotiveBrandToken(match[1])) containsBrand = true;
    current = lower;
    remaining = remaining.slice(0, match.index);
  }
};

/**
 * Forward counterpart: walks over the rest of a dealer-name run ("Bob
 * [Maxey Ford's] team", bridging the phrase's own stopword in "Ford [of
 * Howell]") and — in a vehicle slot only — over the capitalized model words
 * that follow an OEM brand ("Ford [Bronco Sport Big Bend]"). Any other
 * capitalized word directly after the run ("Congratulations, Bob [Smith]!",
 * "Congrats to Ford [Johnson]") means the dealer word was half of a real
 * name.
 */
const groundedRun = (
  caption: string,
  tokenEnd: number,
  token: string,
  grounding: IdentityGrounding,
  brandMayLeadModelRun: boolean,
): GroundedRun => {
  let remaining = caption.slice(tokenEnd);
  let current = lowerToken(token);
  let afterBrand = brandMayLeadModelRun && isAutomotiveBrandToken(token);
  let end = tokenEnd;
  let tokenCount = 1;
  let endsWithPossessive = /['’]s?$/u.test(token);
  let lastIsBrand = isAutomotiveBrandToken(token);
  let containsBrand = lastIsBrand;
  for (;;) {
    const match = remaining.match(NEXT_WORD_PATTERN);
    if (!match) break;
    const raw = match[2];
    const lower = lowerToken(raw);
    if (NON_CUSTOMER_CONTEXT_WORDS.has(lower)) break;
    if (grounding.pairs.has(`${current}>${lower}`)) {
      current = lower;
      afterBrand = brandMayLeadModelRun && isAutomotiveBrandToken(raw);
      lastIsBrand = isAutomotiveBrandToken(raw);
      if (lastIsBrand) containsBrand = true;
    } else if (afterBrand && !match[1]) {
      lastIsBrand = false;
    } else {
      return {
        ok: false,
        end,
        tokenCount,
        endsWithPossessive,
        lastIsBrand,
        containsBrand,
      };
    }
    tokenCount += 1;
    endsWithPossessive = /['’]s?$/u.test(raw);
    remaining = remaining.slice(match[0].length);
    end += match[0].length;
  }
  return { ok: true, end, tokenCount, endsWithPossessive, lastIsBrand, containsBrand };
};

/**
 * What follows a forgiven dealer-name run decides whether a deliberate
 * opener was addressing the business or a person who shares its words:
 * - a possessive, a collective noun, or the end of the phrase after a run
 *   that includes the brand → business ("Bob Maxey Ford's team", "Congrats,
 *   Ford family!", "Cheers to Bob Maxey Ford!");
 * - a lone non-brand word or the founder's two-word name before punctuation
 *   ("Congratulations, Howell!", "Welcome to the family, Bob!", "Meet Bob
 *   Maxey!") → the guard cannot tell the town from the founder, so the
 *   person reading wins and it is refused;
 * - any other lowercase continuation ("Congrats to Bob [on his] new
 *   Explorer", "Delivered: Ford Bronco Sport [to] Michelle") → person.
 */
const deliberateRunIsBusiness = (
  caption: string,
  run: GroundedRun,
  loneTokenAllowed: boolean,
): boolean => {
  if (run.endsWithPossessive) return true;
  const rest = caption.slice(run.end);
  const next = rest.match(/^\s+([\p{L}][\p{L}'’-]*)/u);
  if (!next) return loneTokenAllowed || run.containsBrand;
  return COLLECTIVE_FOLLOWERS.has(lowerToken(next[1]));
};

/**
 * "Bob Maxey Ford's newest Bronco owner, Michelle" / "Meet Howell's newest
 * owner Sarah" / "the Maxey Ford team's newest member, Sarah": a possessive
 * business run hands the rest of the clause to a person. Scans to the end of
 * the clause, skipping everything that is provably not a person — lowercase
 * words, model years/trims, grounded and OEM words, a capitalized word that
 * is itself followed by another capitalized word or by an owner/customer
 * noun (that is the vehicle being owned). Returns the first other
 * capitalized word, or null.
 */
const handoffTargetAfter = (
  caption: string,
  run: GroundedRun,
  grounding: IdentityGrounding,
): string | null => {
  let remaining = caption.slice(run.end);
  if (!run.endsWithPossessive) {
    // "the Maxey Ford team's newest member, Sarah"
    const collective = remaining.match(/^\s+([\p{L}]+)(['’]s?)/u);
    if (!collective || !COLLECTIVE_FOLLOWERS.has(lowerToken(collective[1]))) {
      return null;
    }
    remaining = remaining.slice(collective[0].length);
  }
  let afterBrand = false;
  for (let hops = 0; hops < 12; hops++) {
    const match = remaining.match(/^[\s,:;–—-]+([\p{L}\p{N}][\p{L}\p{N}'’-]*)/u);
    if (!match) return null;
    const raw = match[1];
    const lower = lowerToken(raw);
    const rest = remaining.slice(match[0].length);
    remaining = rest;
    if (!isCapitalized(raw) || hasDigit(raw) || /-/u.test(raw)) {
      afterBrand = false;
      continue;
    }
    if (CUSTOMER_CONTEXT_TRIGGER_WORDS.has(lower)) return null;
    if (isAutomotiveBrandToken(raw)) {
      afterBrand = true;
      continue;
    }
    if (
      afterBrand ||
      grounding.words.has(lower) ||
      NON_CUSTOMER_CONTEXT_WORDS.has(lower) ||
      DETERMINER_ADJECTIVES.has(lower)
    ) {
      continue;
    }
    // "…newest Bronco owner, Michelle" / "…Bronco Sport owner": the word
    // owned by the next noun, or followed by more of its own name.
    const following = rest.match(/^\s+([\p{L}][\p{L}'’-]*)/u);
    if (following) {
      const followingLower = lowerToken(following[1]);
      if (
        isCapitalized(following[1]) ||
        HANDOFF_CONNECTORS.has(followingLower) ||
        NON_CUSTOMER_CONTEXT_WORDS.has(followingLower)
      ) {
        if (!isCapitalized(following[1])) continue;
        // Two capitalized unknown words in a row after the run: a full
        // personal name ("owners, Sarah Johnson") unless the second is
        // itself owned ("Bronco Sport owner").
        const third = rest
          .slice(following[0].length)
          .match(/^\s+([\p{L}][\p{L}'’-]*)/u);
        if (
          third &&
          (HANDOFF_CONNECTORS.has(lowerToken(third[1])) ||
            NON_CUSTOMER_CONTEXT_WORDS.has(lowerToken(third[1])))
        ) {
          continue;
        }
      }
    }
    return stripPossessive(raw);
  }
  return null;
};

/**
 * "Delivered: Ford Bronco Sport — Michelle Johnson!": after a forgiven
 * vehicle-slot run, a dash/colon/comma and another capitalized word is the
 * headline naming its person.
 */
const headlineTailAfter = (
  caption: string,
  run: GroundedRun,
  grounding: IdentityGrounding,
): string | null => {
  const tail = caption.slice(run.end).match(/^\s*[,:–—-]+\s*([\p{Lu}][\p{L}'’-]*)/u);
  if (!tail) return null;
  const lower = lowerToken(tail[1]);
  if (
    grounding.words.has(lower) ||
    NON_CUSTOMER_CONTEXT_WORDS.has(lower) ||
    CUSTOMER_CONTEXT_TRIGGER_WORDS.has(lower) ||
    isAutomotiveBrandToken(tail[1])
  ) {
    return null;
  }
  return stripPossessive(tail[1]);
};

/**
 * "Congrats to the newest Bronco owner!", "Cheers to the Explorer!",
 * "Perfect for the F-150!": an unknown capitalized word reached through a
 * lowercase lead-in or "the" is a thing when the next word owns it or when
 * "the" introduces a singular, non-possessive word with nothing capitalized
 * after it. "Congrats to the Johnsons" / "for the Smith family" stay people.
 */
const leadInTargetIsThing = (
  caption: string,
  tokenStart: number,
  tokenEnd: number,
  token: string,
): boolean => {
  const following = caption.slice(tokenEnd).match(/^\s+([\p{L}][\p{L}'’-]*)/u);
  const followingLower = following ? lowerToken(following[1]) : "";
  if (following && HANDOFF_CONNECTORS.has(followingLower)) return true;
  if (following && isCapitalized(following[1])) return false;
  if (following && COLLECTIVE_FOLLOWERS.has(followingLower)) return false;
  const the = /\bthe\s+$/u.test(caption.slice(0, tokenStart));
  return the && !/['’]/u.test(token) && !/s$/iu.test(token);
};

interface CandidateContext {
  patternIndex: number;
  matchText: string;
  vehicleSlot: boolean;
  /** "Greetings from Howell", "Much love, Howell!" — a lone grounded word is fine here. */
  loneTokenAllowed: boolean;
  isNameList: boolean;
  /** The opener reached the candidate through lowercase words or "the". */
  viaLeadIn: boolean;
}

const evaluateCandidate = (
  caption: string,
  token: string,
  tokenStart: number,
  tokenEnd: number,
  grounding: IdentityGrounding,
  context: CandidateContext,
  found: string[],
): void => {
  const lower = lowerToken(token);
  if (NON_CUSTOMER_CONTEXT_WORDS.has(lower)) return;
  const isBareAction = context.patternIndex === BARE_ACTION_PATTERN_INDEX;

  if (grounding.words.has(lower)) {
    const run = groundedRun(caption, tokenEnd, token, grounding, context.vehicleSlot);
    const before = precedingRun(caption, tokenStart, token, grounding);
    if (run.ok && !before.unrelated) {
      const totalTokens = run.tokenCount + before.tokenCount;
      const anyBrand = run.containsBrand || before.containsBrand;
      if (isBareAction) {
        // "Ford is proud", "Maxey Ford has done it again", "Bronco is ready"
        // (VIN scanned) pass; a lone founder/town word before a verb ("Bob is
        // all smiles", "Howell is thrilled") is a person unless a determiner
        // introduces it ("Your Ford is back on the road").
        if (
          totalTokens >= 2 ||
          anyBrand ||
          grounding.modelWords.has(lower) ||
          precededByDeterminer(caption, tokenStart, token, grounding)
        ) {
          return;
        }
        found.push(token);
        return;
      }
      if (deliberateRunIsBusiness(caption, run, context.loneTokenAllowed)) {
        const handoff = handoffTargetAfter(caption, run, grounding);
        if (handoff) found.push(handoff);
        else if (context.vehicleSlot) {
          const tail = headlineTailAfter(caption, run, grounding);
          if (tail) found.push(tail);
        }
        return;
      }
      found.push(token);
      return;
    }
    if (isBareAction && precededByDeterminer(caption, tokenStart, token, grounding)) {
      return;
    }
    found.push(token);
    return;
  }

  if (isBareAction) {
    if (precededByDeterminer(caption, tokenStart, token, grounding)) return;
    // Bare "love" (unlike "loves") only takes a PERSON as its subject when
    // that subject is plural or part of a list — "The Johnsons love", "Sarah
    // and Mike love", "Sarah and her husband Mike love". A single singular
    // word OPENING its clause before it is the noun: "With love", "Much
    // love", "Bronco love is real".
    if (
      !context.isNameList &&
      !/s$/iu.test(stripPossessive(token)) &&
      /(?:^|[.!?\n:;—–-])\s*$/u.test(caption.slice(0, tokenStart)) &&
      /^\s+(?:just\s+)?love\b/iu.test(caption.slice(tokenEnd))
    ) {
      return;
    }
    found.push(token);
    return;
  }

  if (context.viaLeadIn && leadInTargetIsThing(caption, tokenStart, tokenEnd, token)) {
    return;
  }
  found.push(token);
};

/**
 * Extracts every name-shaped candidate the given patterns find in the
 * UNMODIFIED scan text and evaluates each one. Filtering after matching
 * (rather than blanking a word out of the text first) matters: a name list
 * like "Jordan and Ford are picking up..." must still catch "Jordan" even
 * though "Ford" is forgiven — pre-erasing "Ford" from the text would break
 * the list match itself and lose the other name too.
 */
const namesFromCustomerContext = (
  caption: string,
  grounding: IdentityGrounding,
  patternIndexes: readonly number[],
): string[] => {
  const found: string[] = [];
  for (const patternIndex of patternIndexes) {
    const pattern = customerContextPatterns[patternIndex];
    pattern.lastIndex = 0;
    for (const match of caption.matchAll(pattern)) {
      const group = match[1] || "";
      const groupOffset = match[0].lastIndexOf(group);
      const groupStart = (match.index ?? 0) + groupOffset;
      const opener = match[0].slice(0, groupOffset);
      const vehicleSlot = vehicleSlotPattern(patternIndex, match[0]);
      const context: CandidateContext = {
        patternIndex,
        matchText: match[0],
        vehicleSlot,
        loneTokenAllowed:
          vehicleSlot ||
          patternIndex === 8 ||
          // "Greetings from Howell.", "Straight from Ford," — but not when a
          // congratulation opener owns the clause ("Congrats from Bob!"),
          // where a lone dealer word is as likely the founder as the town.
          (/^[Ff]rom\b/u.test(match[0]) &&
            !CONGRATULATION_OPENER_PATTERN.test(caption.slice(0, match.index ?? 0))),
        isNameList: /\s+and\s+|[&+/]/iu.test(group),
        viaLeadIn:
          (patternIndex === 0 ||
            patternIndex === 3 ||
            patternIndex === 5 ||
            patternIndex === 6) &&
          /\bto\s+\p{Ll}|\bthe\s+$/u.test(opener),
      };
      let cursor = 0;
      for (const raw of group.split(/\s+and\s+|\s*(?:&|\+|\/)\s*/i)) {
        const token = raw.normalize("NFKC").trim();
        if (!token) continue;
        const tokenStart = groupStart + group.indexOf(raw, cursor);
        cursor = group.indexOf(raw, cursor) + raw.length;
        evaluateCandidate(
          caption,
          token,
          tokenStart,
          tokenStart + raw.length,
          grounding,
          context,
          found,
        );
      }
    }
  }
  return found;
};

/**
 * Every name-shaped word the identity guard would refuse this caption for,
 * so the refusal can say WHICH word tripped it. Empty means the caption is
 * acceptable. The special entries below stand in for the two checks that
 * are about the expected customer rather than a stray word:
 * - "(expected customer missing)" — `requireExpected` and the approved
 *   label never appears;
 * - "<Label>…" — the approved label appears with extra letters glued on
 *   ("Michelles"), which is how a surname or a different person leaks.
 */
export const unauthorizedCustomerNames = (
  caption: string,
  expectedCustomerName?: string,
  options: CaptionCustomerIdentityOptions = {},
): string[] => {
  const expected = toPublicCustomerLabel(expectedCustomerName);
  // Every whitespace run collapses to one character, but a line break stays
  // a line break so a new sentence on the next line is a hard boundary.
  const normalizedCaption = (caption || "")
    .normalize("NFKC")
    .replace(/\s+/g, (ws) => (ws.includes("\n") ? "\n" : " "))
    .trim();
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
    return ["(expected customer missing)"];
  }
  if (expected) {
    const extended = new RegExp(
      `(^|[^\\p{L}\\p{N}])(${escapeIdentityPattern(expected)}\\p{L}+)(?=$|[^\\p{L}\\p{N}])`,
      "iu",
    ).exec(normalizedCaption);
    if (extended) return [extended[2]];
  }
  if (!expected && !options.rejectAnyCustomerIdentity) return [];

  // The approved label is blanked and checked for a glued-on surname
  // ("Michelle Smith" → "Customer Smith"). Nothing else is ever blanked:
  // grounded business phrases are forgiven per word by the run walkers, so
  // the person they hand off to ("Bob Maxey Ford of Howell's newest
  // customer, Michelle") stays visible.
  const strictScan = replaceAllowedIdentityPhrase(normalizedCaption, expected);
  if (strictScan !== normalizedCaption) {
    const leakedAfterPlaceholder =
      /\bCustomer\s+([\p{Lu}][\p{L}'’\-]{1,39}|[\p{Lu}]\.)(?=$|[^\p{L}])/u.exec(
        strictScan,
      );
    if (leakedAfterPlaceholder) return [leakedAfterPlaceholder[1]];
  }
  // A salesperson's name is masked only out of the generic "X is/has…" and
  // "for/with/from" prose scans. "Congratulations to <salesperson>" stays a
  // refusal.
  let looseScan = strictScan;
  for (const phrase of options.maskedPhrases || []) {
    looseScan = replaceAllowedIdentityPhrase(looseScan, phrase);
  }

  const grounding = buildGrounding(options.allowedPhrases);
  return Array.from(
    new Set([
      ...namesFromCustomerContext(strictScan, grounding, DELIBERATE_PATTERN_INDEXES),
      ...namesFromCustomerContext(looseScan, grounding, [
        BARE_ACTION_PATTERN_INDEX,
        ...PROSE_PATTERN_INDEXES,
      ]),
    ]),
  );
};

export const captionUsesOnlyExpectedCustomer = (
  caption: string,
  expectedCustomerName?: string,
  options: CaptionCustomerIdentityOptions = {},
): boolean =>
  unauthorizedCustomerNames(caption, expectedCustomerName, options).length === 0;

/** Human-readable list for an error message: `"Bronco"` or `"Bronco", "Sarah"`. */
export const describeUnauthorizedNames = (names: string[]): string => {
  const quoted = names.slice(0, 3).map((name) => `"${name}"`);
  const suffix = names.length > 3 ? ` and ${names.length - 3} more` : "";
  return quoted.join(", ") + suffix;
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
  const deliveryLanguageAllowed = opts.deliveryLanguageAllowed ?? true;
  const customerFocused = Boolean(publicCustomer || customerIdentityRequired);
  const who = publicCustomer || "our newest customer";
  const ride = opts.vehiclePhrase?.trim()
    ? opts.vehiclePhrase.trim()
    : "their new ride";

  const body = (
    customerFocused && deliveryLanguageAllowed
      ? [
          `Keys in hand and big smiles — ${who} just drove off in ${ride}.`,
          `Moments like this are why we love what we do at ${store}.`,
          `Ready for your delivery day? Visit ${store} this week and find the one that feels like yours.`,
        ]
      : customerFocused
        ? [
            `We're grateful for the trust ${who} places in ${store}.`,
            `Moments like this are exactly why our team does what we do.`,
            `Thank you for being part of the ${store} family.`,
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
    ...(customerFocused
      ? deliveryLanguageAllowed
        ? AGENCY_DISCOVERY_HASHTAGS
        : CUSTOMER_TRUST_HASHTAGS
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
      allowedPhrases: [opts.storeName, opts.oemAffiliation, opts.vehiclePhrase],
      maskedPhrases: opts.maskedPhrases,
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
