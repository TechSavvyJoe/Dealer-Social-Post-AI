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

/**
 * Case-insensitive keyword source without the `i` flag: the name token in the
 * same pattern MUST stay case-sensitive (or every lowercase word would read
 * as a name), and the server's regex engine has no inline modifiers. So
 * "congrats" becomes "[Cc][Oo][Nn][Gg][Rr][Aa][Tt][Ss]" — an all-caps caption
 * ("CONGRATS TO MICHELLE!") is then addressed exactly like a normal one.
 */
const ci = (keyword: string): string =>
  keyword
    .split("")
    .map((ch) => (/[a-z]/i.test(ch) ? `[${ch.toUpperCase()}${ch.toLowerCase()}]` : ch))
    .join("");
const ciAlt = (keywords: string[]): string => keywords.map(ci).join("|");

// A personal-name token is never directly followed by a digit or a hyphen
// into a digit, so "F-150", "F-250 XLT", "Model 3" can never be mistaken for
// a name's first word.
const CUSTOMER_NAME_TOKEN = "[\\p{Lu}][\\p{L}'’\\-]{1,39}(?![\\p{N}-])";
const CUSTOMER_LIST_SEPARATOR = "(?:\\s+[Aa][Nn][Dd]\\s+|\\s*(?:&|\\+|/)\\s*)";
const CUSTOMER_NAME_LIST = `${CUSTOMER_NAME_TOKEN}(?:${CUSTOMER_LIST_SEPARATOR}${CUSTOMER_NAME_TOKEN})*`;
// Participles only for the photo-description verbs: the finite forms
// ("smiles", "stands") read as nouns in the captions the model actually
// writes ("Big smiles today!") and flagged the sentence-opening word.
// Verbs and the for/with/from prose openers stay case-sensitive: in ALL CAPS
// every word is "capitalized", so "THANK YOU FOR CHOOSING US" and "SUMMER
// SAVINGS ARE HERE" would read as names. Only the deliberate openers
// ("CONGRATS TO", "WELCOME HOME,") match case-insensitively.
const DIRECT_CUSTOMER_ACTION =
  "drove|drives|drive|driving|found|chose|chooses|selected|picked|picks|pick|purchased|bought|is|are|was|were|has|have|had|got|went|left|joined|became|owns|loves|love|loved|enjoys|enjoyed|celebrated|celebrates|celebrate|shared|shares|takes|take|took|starts|started|received|receives|standing|posing|smiling|traded|upgraded|stopped|signed|arrived|arrives|walked|rolled|headed|landed|grabbed|grabs|snagged|scored|added|adds|wanted|wants|needed|needs|deserved|deserves|earned|earns|treated|ordered|visited|dropped|recommended|recommends|trusted|trusts|thanked|welcomed|handled|cruised|came|comes|brought|brings|said|says|told|tells|made|makes|leased|leases|financed|finances|gave|gives|rated|rates|wrote|writes|worked|works|waited|waits|returned|returns|swung|swings|sold|sells|helped|helps|put|puts|spent|spends|hit|hits|smiled|smiles|stands|stood|poses|posed|test-drove|test-drives|" +
  // Adverbs and modals that only ever sit between a person and a verb.
  "finally|officially|recently|proudly|happily|already|truly|really|absolutely|totally|now|always|never|still|also|even|simply|definitely|clearly|literally|test|couldn't|couldn’t|can't|can’t|cannot|could|can|will|would|wasn't|wasn’t|weren't|weren’t|isn't|isn’t|aren't|aren’t|hasn't|hasn’t|haven't|haven’t|didn't|didn’t|won't|won’t|doesn't|doesn’t|don't|don’t";
const CUSTOMER_ACTION =
  DIRECT_CUSTOMER_ACTION + "|just\\s+(?:" + DIRECT_CUSTOMER_ACTION + ")";
const CUSTOMER_ACTION_WORDS = new Set([...DIRECT_CUSTOMER_ACTION.split("|"), "just"]);
// Up to five lowercase words may sit between "to" and the person: "Congrats
// to our newest customer, Michelle!", "Congrats to the Johnson family".
// A lead-in word is lowercase, a model code / year ("our newest F-150
// owner") or an initial ("S. Johnson"); a comma may sit inside the lead-in
// ("our newest owners, the Johnsons").
const OPENER_LEAD_IN_WORD =
  "(?:[\\p{Ll}][\\p{Ll}'’-]*|[\\p{L}\\p{N}-]*\\p{N}[\\p{L}\\p{N}'’-]*|[\\p{Lu}]\\.)";
const OPENER_LEAD_IN_WORDS = `(?:\\s+${OPENER_LEAD_IN_WORD}){0,5}?`;
const OPENER_LEAD_IN = `(?:(?:\\s+${OPENER_LEAD_IN_WORD}|[,:]){0,7}?)`;
const FAMILY_NOUNS = ["family", "families", "household", "clan"];
/**
 * "the Johnson household", "the Johnson kids", "the Smith twins": the word
 * before one of these is the family's name.
 */
const FAMILY_FOLLOWERS = new Set([
  "family",
  "families",
  "household",
  "clan",
  "crew",
  "kids",
  "twins",
  "sisters",
  "brothers",
  "boys",
  "girls",
  "couple",
  "gang",
  "bunch",
  "tribe",
  "squad",
]);

const HEADLINE_OPENERS = [
  `${ci("welcome")}\\s+${ci("home")}`,
  `${ci("welcome")}\\s+${ci("to")}\\s+${ci("the")}\\s+${ci("family")}`,
  `${ci("new")}\\s+${ci("car")}\\s+${ci("day")}`,
  ci("delivered"),
  ci("sold"),
].join("|");

/**
 * Where a caption addresses someone. Index 2 is the generic "X is/has…"
 * subject and gets the determiner exemption; 3 and 5 are prose, so the
 * masked salesperson is forgiven there; 6 and 7 are headline slots a vehicle
 * legitimately fills ("Delivered: Ford Bronco Sport"); 8 is a trailing
 * vocative ("Thank you, Michelle!"). An opener followed by "!" starts a new
 * sentence, so "!" is never a separator between opener and name.
 */
const TO = ci("to");
const THE = ci("the");
const PREPOSITION_OPENERS = "[Ff]or|[Ww]ith|[Ff]rom";
// "Sarah and her family are…", "Sarah & family love…": an unnamed party
// may follow the person before the verb.
const UNNAMED_PARTY =
  "(?:\\s*(?:[Aa][Nn][Dd]|&)\\s+(?:(?:her|his|their|the|our)\\s+)?[\\p{Ll}]+)?";
const CONGRATS_OPENERS = [
  ciAlt(["congratulations", "congrats", "cheers", "kudos", "thanks", "props"]),
  `${ci("shout")}(?:[\\s-]?${ci("out")})?`,
  `${ci("thank")}\\s+${ci("you")}`,
  `${ci("say")}\\s+(?:${ci("hello")}|${ci("hi")})`,
  `${ci("hats")}\\s+${ci("off")}`,
  `${ci("high")}\\s+${ci("five")}`,
  `(?:${ci("so")}\\s+)?${ci("proud")}\\s+${ci("of")}`,
  `${ci("enjoy")}\\s+${ci("the")}\\s+${ci("ride")}`,
  `${ci("way")}\\s+${ci("to")}\\s+${ci("go")}`,
  `${ci("well")}\\s+${ci("done")}`,
  `${ci("happy")}\\s+${ci("trails")}`,
  `${ci("safe")}\\s+${ci("travels")}`,
  `${ci("good")}\\s+${ci("luck")}`,
  `${ci("nice")}\\s+${ci("work")}`,
  `${ci("great")}\\s+${ci("job")}`,
  `${ci("welcome")}\\s+${ci("back")}`,
  `${ci("warm")}\\s+${ci("welcome")}`,
  `${ci("spotlight")}\\s+${ci("on")}`,
  `${ci("happy")}(?:\\s+[\\p{L}\\p{N}-]+){0,3}?\\s+(?:${ciAlt(["birthday", "anniversary", "retirement", "graduation"])}|${ci("year")}s?)`,
  `${ci("congratulations")}\\s+${ci("are")}\\s+${ci("in")}\\s+${ci("order")}\\s+(?:${ci("for")}|${TO})`,
].join("|");
/** Openers that only name a person through "to" ("Much love to Sarah"). */
const AFFECTION_OPENERS = [
  ci("salute"),
  `(?:${ci("a")}\\s+)?${ci("toast")}`,
  `${ci("here")}['’]${ci("s")}`,
  `${ci("best")}\\s+${ci("wishes")}`,
  `${ci("sending")}\\s+(?:${ciAlt(["love", "hugs", "congrats", "congratulations", "thanks"])})`,
  `${ci("all")}\\s+${ci("the")}\\s+${ci("best")}`,
  `${ci("much")}\\s+${ci("love")}`,
  `(?:${ci("a")}\\s+)?(?:${ci("big")}\\s+)?${ci("round")}\\s+${ci("of")}\\s+${ci("applause")}`,
  `${ci("three")}\\s+${ci("cheers")}`,
  `${ci("standing")}\\s+${ci("ovation")}`,
].join("|");
const PERSON_LABELS = [
  ci("spotlight"),
  `(?:${ciAlt(["employee", "salesperson", "customer", "member"])})\\s+${ci("of")}\\s+${ci("the")}\\s+${ci("month")}`,
  `(?:[\\p{L}-]+\\s+){0,3}?(?:${ciAlt(["owner", "owners", "customer", "customers", "member", "members", "driver", "drivers", "buyer", "buyers", "client", "clients", "winner", "winners", "name", "names", "guest", "guests", "host", "hosts", "hire", "advisor", "consultant", "salesperson", "credit", "featured", "pictured", "photo"])})`,
  `${ci("referred")}\\s+${ci("by")}`,
  `${ci("hosted")}\\s+${ci("by")}`,
  `${ci("sold")}\\s+${TO}`,
  `${ci("delivered")}\\s+${TO}`,
].join("|");
/**
 * Photo-caption continuations: what a caption says right after the person
 * in the picture ("Sarah Johnson with her new Bronco", "Sarah picking up her
 * Explorer", "The Johnsons — all smiles!").
 */
const PHOTO_PARTICIPLES = ciAlt([
  "picking",
  "taking",
  "checking",
  "showing",
  "getting",
  "receiving",
  "holding",
  "celebrating",
  "enjoying",
  "loving",
  "rocking",
  "cruising",
  "driving",
  "smiling",
  "grinning",
  "beaming",
  "heading",
  "rolling",
  "sporting",
  "posing",
  "standing",
  "leaving",
  "signing",
  "grabbing",
  "testing",
  "pulling",
  "hitting",
  "scoring",
  "snagging",
  "riding",
  "kicking",
  "starting",
  "hopping",
  "jumping",
  "sliding",
  "stepping",
  "climbing",
  "walking",
  "strolling",
  "shopping",
  "browsing",
  "visiting",
  "stopping",
  "waiting",
  "waving",
  "cheering",
  "laughing",
  "hugging",
  "trading",
  "upgrading",
  "buying",
  "financing",
  "leasing",
  "collecting",
]);
const PHOTO_CONTINUATION = [
  `(?:${ci("with")}|${ci("and")}|&)\\s+(?:${ciAlt(["her", "his", "their"])})\\b`,
  `${ci("next")}\\s+${TO}\\b`,
  `${ci("in")}\\s+${ci("front")}\\s+${ci("of")}\\b`,
  `${ci("behind")}\\s+${ci("the")}\\s+${ci("wheel")}\\b`,
  `${ci("ready")}\\s+${ci("for")}\\b`,
  `${ci("all")}\\s+${ci("smiles")}\\b`,
  `${ci("pictured")}\\b`,
  `${ci("here")}\\s+${ci("at")}\\b`,
  `(?:${PHOTO_PARTICIPLES})\\b`,
].join("|");
const RELATIVE_NOUNS = [
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
  "grandma",
  "grandpa",
  "grandmother",
  "grandfather",
  "fiancé",
  "fiancée",
  "fiance",
  "fiancee",
  "boyfriend",
  "girlfriend",
  "hubby",
  "wifey",
  "grandson",
  "granddaughter",
  "nephew",
  "niece",
  "baby",
  "buddy",
  "pal",
  "coworker",
  "co-worker",
  "colleague",
  "roommate",
  "bestie",
  "stepson",
  "stepdaughter",
  "stepmom",
  "stepdad",
  "aunt",
  "uncle",
  "cousin",
  "twin",
  "kiddo",
  "neighbor",
  "neighbour",
  "mother-in-law",
  "father-in-law",
  "son-in-law",
  "daughter-in-law",
  "brother-in-law",
  "sister-in-law",
];
const RELATIVE_NOUN_SET = new Set(RELATIVE_NOUNS);
/** A title directly before a name always names a person ("Mr. Jones", "Coach Miller"). */
const TITLE_HEAD_NOUNS = new Set([
  "mr",
  "mrs",
  "ms",
  "mx",
  "miss",
  "dr",
  "coach",
  "officer",
  "pastor",
  "captain",
  "chief",
  "mayor",
  "principal",
  "professor",
  "nurse",
  "doctor",
  "aunt",
  "uncle",
  "cousin",
  "grandma",
  "grandpa",
  "grandmother",
  "grandfather",
  "mom",
  "dad",
  "mother",
  "father",
  "sir",
  "reverend",
  "rev",
  "judge",
  "sergeant",
  "sgt",
  "deputy",
  "senator",
]);
const VOCATIVE_CONTINUATION = ciAlt([
  "enjoy",
  "congrats",
  "congratulations",
  "welcome",
  "thank",
  "thanks",
  "hope",
  "wishing",
  "cheers",
  "glad",
  "hats",
  "way",
  "well",
  "we",
  "so",
]);
const PERSON_HEAD_LABELS = ciAlt([
  "customer",
  "customers",
  "owner",
  "owners",
  "member",
  "members",
  "buyer",
  "buyers",
  "driver",
  "drivers",
]);
const customerContextPatterns = [
  new RegExp(
    `\\b(?:(?:(?:${ciAlt(["big", "huge", "special", "massive", "major"])})\\s+)?(?:${CONGRATS_OPENERS})(?:\\s+(?:${ciAlt(["going", "goes", "go"])})(?:\\s+${ci("out")})?)?(?:\\s+(?:${ci("once")}\\s+)?${ci("again")}|\\s+${ci("also")}|\\s+${ci("as")}\\s+${ci("well")})?(?:\\s+${TO}${OPENER_LEAD_IN}|(?:\\s+[\\p{N}][\\p{L}\\p{N}-]*)?[,:]?)|(?:${AFFECTION_OPENERS})(?:\\s+(?:${ci("once")}\\s+)?${ci("again")}|\\s+${ci("also")})?\\s+${TO}${OPENER_LEAD_IN})\\s+["“'‘(\\[]?(${CUSTOMER_NAME_LIST})`,
    "gu",
  ),
  new RegExp(
    `\\b(?:${ciAlt(["meet", "welcoming"])}|${ci("celebrate")}(?:\\s+${ci("with")})?|${ci("welcome")}(?!\\s+(?:${TO}|${ci("aboard")})\\b))${OPENER_LEAD_IN}\\s+["“'‘(\\[]?(${CUSTOMER_NAME_LIST})`,
    "gu",
  ),
  new RegExp(
    `(?:^|[^\\p{L}\\p{N}'’-])(${CUSTOMER_NAME_LIST})(?=,?(?:\\s+[\\p{Lu}]\\.|\\s+(?:${ciAlt([...FAMILY_NOUNS, "crew", "kids", "twins"])}))?(?:\\s+(?:from|in|at|of|with)(?:\\s+[\\p{L}][\\p{L}'’-]*){0,4}?)?${UNNAMED_PARTY}\\s+(?:${CUSTOMER_ACTION})\\b)`,
    "gu",
  ),
  new RegExp(
    `\\b(?:${PREPOSITION_OPENERS})${OPENER_LEAD_IN_WORDS}\\s+(${CUSTOMER_NAME_LIST})(?=(?:\\s+${CUSTOMER_NAME_TOKEN})*(?:[,!.?]|\\s+(?:${CUSTOMER_ACTION})\\b|\\s+(?:${ciAlt(FAMILY_NOUNS)})\\b|\\s*(?:[Aa][Nn][Dd]|&)\\s+(?:her|his|their|the)\\b))`,
    "gu",
  ),
  new RegExp(
    `\\b(?:${ciAlt(["helping", "helped", "welcoming", "welcomed", "thanking", "thanked", "thank", "congratulating", "congratulated", "congratulate", "introducing", "presenting", "wishing", "honoring", "honored", "celebrating", "spotlighting", "recognizing", "recognized", "saluting", "surprising", "surprised", "greeting", "greeted", "treating", "treated", "gifting", "gifted", "assisting", "assisted", "serving", "served", "handed"])})${OPENER_LEAD_IN_WORDS}\\s+["“'‘(\\[]?(${CUSTOMER_NAME_LIST})`,
    "gu",
  ),
  new RegExp(
    `\\b(?:${PREPOSITION_OPENERS})${OPENER_LEAD_IN_WORDS}\\s+(${CUSTOMER_NAME_LIST})(?=(?:\\s+${CUSTOMER_NAME_TOKEN})*(?:$|[,!.?]|\\s+(?:at|during|today|this|on|after|before|who|by|to)\\b|\\s+(?:${ciAlt(FAMILY_NOUNS)})\\b|\\s*(?:[Aa][Nn][Dd]|&)\\s+(?:her|his|their|the)\\b))`,
    "gu",
  ),
  new RegExp(
    `\\b(?:(?:${HEADLINE_OPENERS})(?:\\s+${TO}${OPENER_LEAD_IN}\\s+|[,:\\s–—-]+|[,:\\s]+[^,:!.?\\n–—]{1,80}?(?:\\s*[–—-]+\\s*|\\s+${TO}${OPENER_LEAD_IN}\\s+))|${ci("welcome")}\\s+(?:${ci("aboard")}|${TO}\\s+[^,:!\\n–—]{1,80}?)\\s*[,:–—-]+\\s*|${ci("welcome")}\\s+${TO}\\s+[^,:!.?\\n–—]{1,80}?\\s+(?:${ciAlt(["family", "families", "team", "crew", "nation", "club"])})\\s+)(?:${THE}\\s+)?(${CUSTOMER_NAME_LIST})(?=$|[^\\p{L}])`,
    "gu",
  ),
  new RegExp(
    `(?:^|[^\\p{L}\\p{N}'’-])(${CUSTOMER_NAME_LIST})\\s*(?:[,!]|[–—-])\\s*(?:${ci("welcome")}\\s+(?:${ci("home")}|${ci("aboard")}|${TO}\\s+[^.!?\\n]{1,60})|${ci("new")}\\s+${ci("car")}\\s+${ci("day")}|${ci("delivered")}|${ci("sold")})\\b`,
    "gu",
  ),
  new RegExp(
    `(?:,|[^"”'’\\s][^\\S\\n]*[–—])\\s*(?:${THE}\\s+)?(${CUSTOMER_NAME_LIST})(?:\\s+${CUSTOMER_NAME_TOKEN})*\\s*(?:[!.?]+|(?=$|\\n)|,\\s*(?=(?:${VOCATIVE_CONTINUATION}|you|your|it|this|here|see|have|and)\\b))`,
    "gu",
  ),
  // 9: "Sarah's new ride", "Grateful for Sarah's trust" — a possessive name.
  new RegExp(
    `(?:^|[^\\p{L}\\p{N}'’-])([\\p{Lu}][\\p{L}\\-]{1,39}['’][Ss])(?=$|[^\\p{L}\\p{N}])`,
    "gu",
  ),
  // 10: "Sarah, enjoy your new Bronco!", "Sarah — enjoy…" — a leading vocative.
  new RegExp(
    `(?:^|\\n)\\s*(${CUSTOMER_NAME_LIST})(?:\\s+${CUSTOMER_NAME_TOKEN})*\\s*(?:,\\s*(?=[\\p{Ll}])|[:–—-]+\\s*(?=(?:${VOCATIVE_CONTINUATION})\\b))`,
    "gu",
  ),
  // 11: "Employee of the Month: Sarah!", "New owner: Sarah Johnson".
  new RegExp(
    `\\b(?:${PERSON_LABELS})\\s*:\\s*(?:${THE}\\s+)?(${CUSTOMER_NAME_LIST})`,
    "gu",
  ),
  // 12: '"Best experience ever!" — Sarah', a line that is just "— Sarah" —
  // a testimonial attribution.
  new RegExp(`(?:["”'’]\\s*|(?:^|\\n)\\s*)[–—-]+\\s*(${CUSTOMER_NAME_LIST})`, "gu"),
  // 13: "Proud owner Dave Miller with his new F-150!", "Bronco owner Sarah!"
  // — a head noun naming its person.
  new RegExp(
    `\\b(?:${PERSON_HEAD_LABELS})\\s+(${CUSTOMER_NAME_LIST})(?:\\s+${CUSTOMER_NAME_TOKEN})*(?=\\s*(?:[!.?,;:—–|-]|$|\\n)|\\s+(?:and|&|with|on|in|at|from|of|by|${CUSTOMER_ACTION}|${PHOTO_PARTICIPLES})\\b)`,
    "gu",
  ),
  // 14: "Sarah Johnson with her new Bronco!", "The Johnsons — all smiles!",
  // "Sarah Johnson: Bronco owner!" — the person a photo caption opens with.
  new RegExp(
    `(?:^|\\n|[.!?])[^\\p{L}\\p{N}\\n]*(?:${CUSTOMER_NAME_TOKEN}\\s+)*?(${CUSTOMER_NAME_LIST})(?=(?:\\s+${CUSTOMER_NAME_TOKEN})*(?:\\s+(?:${ciAlt(["family", "families", "household", "crew", "kids", "twins"])}))?(?:\\s+${ci("of")}\\s+${CUSTOMER_NAME_TOKEN})?\\s*(?:,\\s*|[–—]\\s*)?(?:${PHOTO_CONTINUATION})|\\s+${CUSTOMER_NAME_TOKEN}(?:\\s+${CUSTOMER_NAME_TOKEN})*\\s*[:|])`,
    "gu",
  ),
  // 15: "her husband Bob", "our friend Dave" — a relative named after the noun.
  new RegExp(
    `\\b(?:${ciAlt(["her", "his", "their", "my", "our", "the"])})\\s+(?:${ciAlt(RELATIVE_NOUNS)})\\s+(${CUSTOMER_NAME_LIST})`,
    "gu",
  ),
  // 16: "Michelle and Bob!" — a caption that is nothing but names.
  new RegExp(
    `^\\s*(${CUSTOMER_NAME_TOKEN}(?:(?:${CUSTOMER_LIST_SEPARATOR}|\\s*,\\s*)${CUSTOMER_NAME_TOKEN})+)\\s*(?:,?\\s*(?:[Aa][Nn][Dd]|&)\\s+(?:the|their|her|his)\\s+[\\p{Ll}]+)?\\s*[!.]*\\s*$`,
    "gu",
  ),
  // 17: "The Johnson family's new Explorer" — a family's possessive.
  new RegExp(
    `(?:^|[^\\p{L}\\p{N}'’-])(${CUSTOMER_NAME_TOKEN})\\s+(?:${ciAlt(["family", "families", "household", "crew", "kids"])})['’][Ss]\\b`,
    "gu",
  ),
];

/** A congratulation opener still governing the clause just before a match. */
const CONGRATULATION_OPENER_PATTERN = new RegExp(
  `\\b(?:${ciAlt(["congratulations", "congrats", "cheers", "kudos", "thanks", "meet", "welcome"])}|${ci("shout")}(?:-?${ci("out")})?|${ci("thank")}\\s+${ci("you")})\\b[^.!?\\n]*$`,
  "u",
);
const FROM_OPENER = /\b[Ff]rom(?:\s+[\p{Ll}][\p{Ll}'’-]*)*\s+$/u;
// The opener reached the candidate through a lead-in word ("to", "the",
// "our newest", "the all-new", "the 2025") rather than naming it outright.
const LEAD_IN_OPENER =
  /(?:^|\s)(?:[\p{Ll}][\p{Ll}'’-]*|[\p{L}\p{N}-]*\p{N}[\p{L}\p{N}'’-]*)\s+$/u;
// "Delivered: Ford Bronco Sport" is a vehicle slot; "Sold to Bob!" is not —
// the "to <person>" alternative always addresses someone.
const VEHICLE_HEADLINE_OPENER = new RegExp(
  `^(?:${ci("delivered")}|${ci("new")}\\s+${ci("car")}\\s+${ci("day")}|${ci("sold")})(?!\\s+${ci("to")}\\b)`,
  "u",
);

const BARE_ACTION_PATTERN_INDEX = 2;
/** "The Miller family loves...": the surname a family noun follows. */
const followedByFamilyNoun = (caption: string, tokenEnd: number): boolean => {
  const following = caption.slice(tokenEnd).match(/^\s+([\p{L}][\p{L}'’-]*)/u);
  return !!following && FAMILY_FOLLOWERS.has(lowerToken(following[1]));
};
/** Prose slots where the salesperson's name is forgiven ("Ask for Joe", "Joe's customers"). */
const PROSE_PATTERN_INDEXES: readonly number[] = [3, 5, 9, 11, 12, 13, 14, 15, 17];
const FAMILY_POSSESSIVE_PATTERN_INDEX = 17;
const POSSESSIVE_PATTERN_INDEX = 9;
const LEADING_VOCATIVE_PATTERN_INDEX = 10;
const HEAD_LABEL_PATTERN_INDEX = 13;
const PHOTO_CAPTION_PATTERN_INDEX = 14;
const TRAILING_VOCATIVE_PATTERN_INDEX = 8;
/**
 * Openers that address a PERSON rather than toast a thing: nobody
 * congratulates a season, so "Congrats to Summer!" names someone, while
 * "Cheers to Summer!" / "Thanks to Everyone!" do not.
 */
const PERSON_SLOT_OPENER = new RegExp(
  `^(?:(?:${ciAlt(["big", "huge", "special", "massive", "major"])})\\s+)?(?:${ciAlt(["congratulations", "congrats", "kudos", "meet", "welcoming", "welcome", "happy", "say", "hats", "props", "way", "well", "enjoy", "good", "nice", "great", "sold", "delivered", "new", "spotlight"])}|(?:${ci("so")}\\s+)?${ci("proud")})\\b`,
  "u",
);
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
  (patternIndex === 6 && VEHICLE_HEADLINE_OPENER.test(matchText));

/**
 * Nouns that make the capitalized word before them a place or an
 * organisation, never a person: "Shout out to Livingston County", "Congrats
 * to Brighton High School", "Proud sponsor of Howell Little League".
 */
const ORGANISATION_FOLLOWERS = new Set([
  "county",
  "township",
  "city",
  "village",
  "town",
  "school",
  "schools",
  "high",
  "elementary",
  "middle",
  "academy",
  "district",
  "college",
  "university",
  "hospital",
  "library",
  "chamber",
  "commerce",
  "police",
  "fire",
  "sheriff",
  "rescue",
  "foundation",
  "festival",
  "fair",
  "parade",
  "market",
  "league",
  "club",
  "park",
  "parks",
  "athletics",
  "boosters",
  "band",
  "choir",
  "rotary",
  "lions",
  "tigers",
  "pistons",
  "wings",
  "wolverines",
  "spartans",
  // Sports, activities and mascots: "Howell Football", "Brighton Bulldogs".
  "football",
  "hockey",
  "basketball",
  "baseball",
  "soccer",
  "wrestling",
  "swim",
  "swimming",
  "track",
  "golf",
  "tennis",
  "volleyball",
  "softball",
  "lacrosse",
  "bowling",
  "rugby",
  "cross",
  "country",
  "esports",
  "chess",
  "debate",
  "robotics",
  "stem",
  "science",
  "math",
  "arts",
  "music",
  "theater",
  "theatre",
  "drama",
  "orchestra",
  "cheer",
  "dance",
  "ems",
  "paramedics",
  "responders",
  "recreation",
  "rec",
  "state",
  "valley",
  "michigan",
  "bulldogs",
  "highlanders",
  "eagles",
  "wolves",
  "panthers",
  "knights",
  "warriors",
  "wildcats",
  "pirates",
  "vikings",
  "raiders",
  "hornets",
  "falcons",
  "cougars",
  "bears",
  "rams",
  "colts",
  "chiefs",
  "braves",
  "cardinals",
  "orioles",
  "hawks",
  "jets",
  "giants",
  "patriots",
  "packers",
  "bucks",
  "bruins",
  "blackhawks",
  "cubs",
  "sox",
  "yankees",
  "mets",
  "dodgers",
  "steelers",
  "browns",
  "bengals",
  "seahawks",
  "cowboys",
  "broncos",
  "titans",
  "saints",
  "bills",
  "dolphins",
  "chargers",
  "raptors",
  "celtics",
  "lakers",
  "heat",
  "magic",
  "thunder",
  "suns",
  "kings",
  "blues",
  "flames",
  "oilers",
  "canucks",
  "sabres",
  "predators",
  "sharks",
]);

/**
 * Departments, job titles and the crowds a caption thanks or helps
 * ("Shout out to our Detail Team", "our Service Manager Bob", "Thanking Our
 * Veterans"). None of these is ever a customer's name, and a capitalized
 * one in a name slot is walked over to the person it may introduce.
 */
const LEAD_IN_NOUN_WORDS: string[] = [
  ...ORGANISATION_FOLLOWERS,
  // Occasions, labels, marketing phrases, trims and nearby places.
  "spotlight",
  "birthday",
  "anniversary",
  "retirement",
  "graduation",
  "arrival",
  "arrivals",
  "news",
  "price",
  "drop",
  "top",
  "zero",
  "down",
  "less",
  "double",
  "triple",
  "half",
  "full",
  "giant",
  "mega",
  "super",
  "instant",
  "easy",
  "fast",
  "smart",
  "safe",
  "secure",
  "guaranteed",
  "quality",
  "premium",
  "elite",
  "platinum",
  "value",
  "pricing",
  "interest",
  "apr",
  "cash",
  "cashback",
  "trade",
  "trade-in",
  "trade-ins",
  "upgrade",
  "upgrades",
  "roads",
  "trails",
  "miles",
  "memories",
  "moments",
  "vibes",
  "mode",
  "style",
  "living",
  "power",
  "torque",
  "horsepower",
  "speed",
  "luxury",
  "comfort",
  "capability",
  "reliability",
  "efficiency",
  "mpg",
  "range",
  "ev",
  "evs",
  "toys",
  "tots",
  "master",
  "senior",
  "junior",
  "expert",
  "experts",
  "pros",
  "ace",
  "apprentice",
  "rookie",
  "rookies",
  "intern",
  "interns",
  "perks",
  "benefits",
  "loyalty",
  "program",
  "programs",
  "portal",
  "app",
  "account",
  "accounts",
  "support",
  "care",
  "around",
  "lane",
  "photo",
  "featured",
  "pictured",
  "hire",
  "host",
  "hosted",
  "name",
  "names",
  "badlands",
  "everglades",
  "raptor",
  "tremor",
  "lariat",
  "lightning",
  "heritage",
  "wildtrak",
  "sasquatch",
  "timberline",
  "titanium",
  "xlt",
  "xl",
  "stx",
  "sel",
  "mach",
  "king",
  "ranch",
  "detroit",
  "lansing",
  "flint",
  "brighton",
  "fenton",
  "hartland",
  "pinckney",
  "milford",
  "novi",
  "livonia",
  "southfield",
  "dearborn",
  "wixom",
  "plymouth",
  "canton",
  "northville",
  "okemos",
  "fowlerville",
  "kalamazoo",
  "saginaw",
  "muskegon",
  "midland",
  "quick",
  "fordpass",
  "speaker",
  "speakers",
  "manual",
  "manuals",
  "dealer",
  "dealers",
  "heads",
  "tip",
  "tips",
  "fact",
  "facts",
  "humanity",
  "habitat",
  "meals",
  "wheels",
  "wish",
  "gleaners",
  "salvation",
  "army",
  "united",
  "way",
  "olympics",
  "wounded",
  "warrior",
  "project",
  "relay",
  "bank",
  "food",
  "pantry",
  "shelter",
  "mission",
  "hospice",
  "cancer",
  "society",
  "association",
  "alliance",
  "network",
  "initiative",
  "fund",
  "coalition",
  "council",
  "committee",
  "board",
  "unit",
  "corps",
  "guard",
  "legion",
  "vfw",
  "kiwanis",
  "elks",
  "moose",
  "shriners",
  "scouts",
  "troop",
  "pack",
  "ffa",
  "pta",
  "pto",
  "homecoming",
  "prom",
  "court",
  "marching",
  "melon",
  "fest",
  "expo",
  "show",
  "showcase",
  "gala",
  "benefit",
  "walk",
  "run",
  "marathon",
  "tournament",
  "tourney",
  "classic",
  "invitational",
  "championship",
  "championships",
  "playoffs",
  "finals",
  "semifinals",
  "quarterfinals",
  "regionals",
  "districts",
  "states",
  "nationals",
  "conference",
  "varsity",
  "jv",
  "freshman",
  "sophomore",
  "alumni",
  "reunion",
  "award",
  "awards",
  "athlete",
  "player",
  "citizen",
  "business",
  "general",
  "national",
  "pure",
  "fourth",
  "oval",
  "crown",
  "percent",
  "co",
  "inc",
  "llc",
  "corp",
  "motor",
  "motors",
  "company",
  "year-end",
  "model",
  "queen",
  "prince",
  "princess",
  "colors",
  "colours",
  "skies",
  "central",
  "state",
  "valley",
  "gt",
  "area",
  "student",
  "students",
  "grand",
  "michigan",
  "usa",
  "detail",
  "detailing",
  "body",
  "shop",
  "collision",
  "center",
  "centre",
  "management",
  "bdc",
  "internet",
  "express",
  "tire",
  "tires",
  "accessories",
  "reception",
  "office",
  "leadership",
  "wash",
  "warranty",
  "rental",
  "rentals",
  "shuttle",
  "fleet",
  "commercial",
  "truck",
  "trucks",
  "used",
  "preowned",
  "certified",
  "digital",
  "marketing",
  "media",
  "admin",
  "title",
  "billing",
  "accounting",
  "group",
  "division",
  "floor",
  "drive",
  "counter",
  "desk",
  "quick",
  "mobile",
  "loaner",
  "loaners",
  "oil",
  "brake",
  "brakes",
  "battery",
  "batteries",
  "alignment",
  "inspection",
  "inspections",
  "recall",
  "recalls",
  "maintenance",
  "repair",
  "repairs",
  "wheel",
  "wheels",
  "dept",
  "manager",
  "managers",
  "advisor",
  "advisors",
  "technician",
  "technicians",
  "tech",
  "techs",
  "specialist",
  "specialists",
  "consultant",
  "consultants",
  "associate",
  "associates",
  "director",
  "directors",
  "president",
  "coordinator",
  "coordinators",
  "assistant",
  "assistants",
  "detailer",
  "detailers",
  "mechanic",
  "mechanics",
  "lead",
  "leads",
  "rep",
  "reps",
  "salesperson",
  "salespeople",
  "porter",
  "porters",
  "cashier",
  "greeter",
  "receptionist",
  "gm",
  "ambassador",
  "ambassadors",
  "veteran",
  "veterans",
  "hero",
  "heroes",
  "hands",
  "guest",
  "guests",
  "neighbor",
  "neighbors",
  "kids",
  "student",
  "students",
  "teacher",
  "teachers",
  "nurse",
  "nurses",
  "doctor",
  "doctors",
  "graduate",
  "graduates",
  "grads",
  "seniors",
  "troops",
  "responders",
  "volunteer",
  "volunteers",
  "worker",
  "workers",
  "visitor",
  "visitors",
  "rider",
  "riders",
  "member",
  "members",
  "client",
  "clients",
  "shopper",
  "shoppers",
  "sponsor",
  "sponsors",
  "supporter",
  "supporters",
  "follower",
  "followers",
  "donor",
  "donors",
  "moms",
  "dads",
  "ladies",
  "gentlemen",
  "folks",
  "people",
  "buddies",
  "partners",
  "parents",
  "grandparents",
  "newlyweds",
  "couple",
  "everywhere",
  "anywhere",
  "somewhere",
  "nowhere",
  "ahead",
  "tonight",
  "again",
  "always",
  "forever",
  "soon",
  "also",
  "plus",
  "honestly",
  "seriously",
  "okay",
  "ok",
  "no",
  "oh",
  "psst",
  "bonus",
  "fun",
  "pro",
  "spoiler",
  "question",
  "disclaimer",
  "note",
  "reminder",
  "update",
  "attention",
  "alert",
  "psa",
  "surprise",
  "wow",
  "boom",
  "perfection",
  "whoa",
  "yes",
  "finally",
  "officially",
  "done",
  "employee",
  "employees",
  "weather",
  "savings",
  "prices",
  "rates",
  "payments",
  "financing",
  "incentives",
  "rebates",
  "discounts",
  "winner",
  "winners",
  "faculty",
  "credit",
  "performance",
  "racing",
  "motor",
  "motors",
  "company",
  "corporation",
  "pass",
  "rewards",
  "protect",
  "advantage",
  "class",
  "mom",
  "dad",
  "mother",
  "father",
  "grandma",
  "grandpa",
  "grandmother",
  "grandfather",
  "mr",
  "mrs",
  "ms",
  "mx",
  "dr",
  "coach",
  "officer",
  "pastor",
  "captain",
  "chief",
  "mayor",
  "principal",
  "professor",
  "aunt",
  "uncle",
  "cousin",
  "over",
  "off",
  "up",
  "back",
  "away",
  "down",
  "ourselves",
  "yourself",
  "myself",
  "themselves",
  "himself",
  "herself",
  "built",
  "public",
  "choosing",
  "trusting",
  "visiting",
  "stopping",
  "coming",
  "being",
  "making",
  "joining",
  "shopping",
  "buying",
  "supporting",
  "sharing",
  "following",
  "reading",
  "watching",
  "letting",
  "having",
  "giving",
  "taking",
  "bringing",
  "riding",
  "going",
  "getting",
  "keeping",
  "looking",
  "seeing",
  "saying",
  "telling",
  "finding",
  "showing",
  "working",
  "living",
  "loving",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "fifteen",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "hundred",
  "thousand",
  "million",
  // Events a caption invites people to ("Customer Appreciation Day", "Open
  // House", "Tent Sale").
  "appreciation",
  "event",
  "events",
  "night",
  "nights",
  "special",
  "specials",
  "deal",
  "deals",
  "offer",
  "offers",
  "clearance",
  "blowout",
  "bonanza",
  "party",
  "celebration",
  "giveaway",
  "raffle",
  "contest",
  "drawing",
  "fundraiser",
  "cookout",
  "bbq",
  "picnic",
  "open",
  "house",
  "tent",
  "sale",
];

const LEAD_IN_NOUN_SET = new Set(LEAD_IN_NOUN_WORDS);

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
  // Regions a caption is written "for"/"from" — only the ones that are not
  // also given names or surnames (no Georgia, Virginia, Carolina, Dakota,
  // Montana, Indiana, Washington, Jersey, York).
  "michigan",
  "ohio",
  "illinois",
  "wisconsin",
  "minnesota",
  "iowa",
  "missouri",
  "kansas",
  "nebraska",
  "oklahoma",
  "texas",
  "arkansas",
  "louisiana",
  "mississippi",
  "alabama",
  "florida",
  "kentucky",
  "tennessee",
  "pennsylvania",
  "delaware",
  "maryland",
  "connecticut",
  "massachusetts",
  "vermont",
  "hampshire",
  "idaho",
  "utah",
  "wyoming",
  "colorado",
  "arizona",
  "mexico",
  "california",
  "oregon",
  "alaska",
  "hawaii",
  "midwest",
  "american",
  "usa",
  ...LEAD_IN_NOUN_WORDS,
  // Function words a camel-case hashtag splits into ("#SoldByJoe" →
  // "Sold By Joe"); never a person.
  "by",
  "of",
  "the",
  "and",
  "at",
  "in",
  "to",
  "for",
  "with",
  "from",
  "on",
  "a",
  "an",
  "new",
  "car",
  "your",
  "our",
  "my",
  "out",
  "us",
  "you",
  "me",
  "them",
  "are",
  "is",
  "was",
  "were",
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
  "grandma",
  "grandpa",
  "grandmother",
  "grandfather",
  "kids",
  "parents",
  "grandparents",
  "fiancé",
  "fiancée",
  "fiance",
  "fiancee",
  "boyfriend",
  "girlfriend",
  "hubby",
  "wifey",
  "grandson",
  "granddaughter",
  "nephew",
  "niece",
  "baby",
  "buddy",
  "pal",
  "coworker",
  "co-worker",
  "colleague",
  "roommate",
  "bestie",
  "stepson",
  "stepdaughter",
  "stepmom",
  "stepdad",
  "aunt",
  "uncle",
  "cousin",
  "twin",
  "kiddo",
  "mother-in-law",
  "father-in-law",
  "son-in-law",
  "daughter-in-law",
  "brother-in-law",
  "sister-in-law",
]);
/**
 * "Memorial Day", "Game Day", "Football Season", "Mustang Monday": the word
 * before one of these names an occasion, not a person.
 */
const TIME_FOLLOWERS = new Set([
  "day",
  "days",
  "month",
  "months",
  "week",
  "weeks",
  "weekend",
  "weekends",
  "night",
  "nights",
  "season",
  "seasons",
  "morning",
  "afternoon",
  "evening",
  "eve",
  "hour",
  "hours",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "weather",
]);
const followedByTimeNoun = (caption: string, tokenEnd: number): boolean => {
  const following = caption.slice(tokenEnd).match(/^\s+([\p{L}][\p{L}'’-]*)/u);
  return !!following && TIME_FOLLOWERS.has(lowerToken(following[1]));
};

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

// The substituted label is tagged with a control character so the glued-on
// surname check ("Customer Smith") only ever fires on a real substitution,
// never on the literal word in "Customer Appreciation Day" or a split
// "#HappyCustomer". The tag is stripped before any pattern runs.
const PLACEHOLDER_TAG = "\u0001";
const IDENTITY_PLACEHOLDER = ` ${PLACEHOLDER_TAG}Customer `;

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
/** Directly before a bare unknown word, these name a person ("our Sarah"). */
const OWN_PERSON_DETERMINERS = new Set(["our", "my"]);
/**
 * Words a capitalized lead-in may consist of before the person it introduces
 * ("Congrats to The Johnsons", "Meet Our Newest Customer Michelle", "Sold To
 * The Smiths", "— New Owner Michelle"). Deliberately NOT prepositions such as
 * "by"/"at" — "Sold By Joe" hands off to nobody.
 */
/**
 * Non-customer words that END a lead-in hop instead of being walked over:
 * "Thanks For Choosing Us", "Sold By Joe" hand off to nobody. Every other
 * non-customer word ("Team", "Member") is walked: "Congrats to Our Team
 * Member Michelle".
 */
const HOP_STOP_WORDS = new Set([
  "by",
  "of",
  "for",
  "from",
  "at",
  "in",
  "on",
  // "Thanks To Our Techs Who Keep You Rolling", "THANKS TO ALL WHO SERVE":
  // a pronoun, verb or conjunction ends the noun phrase a lead-in opened.
  "who",
  "whom",
  "whose",
  "that",
  "which",
  "what",
  "when",
  "where",
  "why",
  "how",
  "i",
  "you",
  "we",
  "they",
  "he",
  "she",
  "it",
  "us",
  "me",
  "them",
  "him",
  "are",
  "is",
  "was",
  "were",
  "be",
  "been",
  "has",
  "have",
  "had",
  "do",
  "does",
  "did",
  "will",
  "can",
  "could",
  "would",
  "should",
  "may",
  "might",
  "must",
  "if",
  "and",
  "or",
  "but",
  "so",
  "as",
  "than",
  "everyone",
  "everybody",
  "someone",
  "somebody",
  "anyone",
  "anybody",
  "nobody",
  "everything",
  "something",
  "anything",
  "nothing",
  "here",
  "there",
  "now",
  "then",
]);
/**
 * Where a lead-in phrase starts: the opener's own preposition or a
 * conjunction ("Thanks To Chris", "SOLD TO CHRIS", "Sarah and Mike") is
 * never walked as part of the phrase in front of a candidate.
 */
const LEAD_IN_BOUNDARY_WORDS = new Set([
  ...HOP_STOP_WORDS,
  "to",
  "and",
  "or",
  "but",
  "as",
  "than",
  "with",
  "so",
]);
/**
 * Praise words a caption puts in front of a PERSON ("our amazing Sarah",
 * "the wonderful Johnsons", "Congrats to the Lucky Michelle"). Crossing one
 * on the way back to a determiner means the determiner introduces a person,
 * never a vehicle — the opposite of DETERMINER_ADJECTIVES.
 */
const PERSON_ADJECTIVES = new Set([
  "amazing",
  "wonderful",
  "awesome",
  "incredible",
  "fantastic",
  "fabulous",
  "lovely",
  "dear",
  "lucky",
  "proud",
  "happy",
  "loyal",
  "valued",
  "beloved",
  "favorite",
  "longtime",
  "long-time",
  "repeat",
  "returning",
  "esteemed",
  "hardworking",
  "hard-working",
  "deserving",
  "sweet",
  "kind",
  "generous",
  "thrilled",
  "excited",
  "smiling",
  "radiant",
  "glowing",
  "very",
  "own",
]);
const HOP_LEAD_IN_WORDS = new Set([
  "the",
  "our",
  "my",
  "your",
  "their",
  "his",
  "her",
  "a",
  "an",
  "to",
  "new",
  "newest",
  "brand",
  "first",
  "latest",
  ...PERSON_ADJECTIVES,
  ...LEAD_IN_NOUN_WORDS,
  // The departments and collectives that were already non-customer words.
  "team",
  "crew",
  "staff",
  "family",
  "families",
  "community",
  "nation",
  "fans",
  "dealership",
  "store",
  "showroom",
  "department",
  "sales",
  "parts",
  "finance",
  "service",
  "inventory",
  "delivery",
  // Thing-describing adjectives, minus the colours ("Red" is a nickname).
  "shiny",
  "stunning",
  "beautiful",
  "gorgeous",
  "sleek",
  "gleaming",
  "sparkling",
  "next",
  "dream",
  "perfect",
  "fresh",
  "bold",
  "loaded",
  "custom",
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
  "great",
  "good",
  "best",
  "finest",
  "whole",
  "entire",
  "massive",
  "lower",
  "low",
  "better",
  "bigger",
  "biggest",
  "endless",
  "free",
  "long",
  "extra",
  "unbeatable",
  "exclusive",
  "limited",
  "little",
  "extended",
  "growing",
  "customer",
  "customers",
  "owner",
  "owners",
  "driver",
  "drivers",
  "buyer",
  "buyers",
  "member",
  "members",
  "friend",
  "friends",
  "family",
  "home",
  "welcome",
  "delivered",
  "sold",
  "aboard",
  "day",
  "car",
  // "Shout Out To Our Team": the second half of the opener.
  "out",
  "you",
  "with",
]);

/**
 * Lowercase descriptive words a caption commonly stacks between a
 * determiner and the vehicle ("her shiny new Bronco"). Deliberately a short
 * closed list of words that describe THINGS: walking back over any
 * lowercase word would let "her friend Michelle is..." reach "her", and
 * words that praise people ("our very own Sarah", "our amazing Michelle")
 * are exactly how a caption introduces a customer, so they are excluded.
 */
const DETERMINER_ADJECTIVES = new Set([
  "whole",
  "entire",
  "extended",
  "growing",
  "massive",
  "lower",
  "low",
  "better",
  "bigger",
  "biggest",
  "endless",
  "free",
  "long",
  "extra",
  "unbeatable",
  "exclusive",
  "limited",
  "little",
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
  "great",
  "good",
  "best",
  "finest",
  "whole",
  "entire",
  "massive",
  "lower",
  "low",
  "better",
  "bigger",
  "biggest",
  "endless",
  "free",
  "long",
  "extra",
  "unbeatable",
  "exclusive",
  "limited",
  "little",
]);

/**
 * Vocabulary words that are also given names or surnames ("Congrats to
 * April", "Meet Porter", "the Parks family", "our newest owner Will"). In a
 * person-addressing slot, one of these followed by the end of the phrase, a
 * family noun or "on her/his…" is the person, not the word.
 */
const AMBIGUOUS_NAME_WORDS = new Set([
  "april",
  "may",
  "june",
  "august",
  "january",
  "summer",
  "autumn",
  "winter",
  "lucky",
  "happy",
  "sweet",
  "proud",
  "dear",
  "porter",
  "parks",
  "park",
  "sharp",
  "best",
  "good",
  "day",
  "house",
  "guest",
  "rider",
  "fair",
  "keys",
  "holiday",
  "brand",
  "will",
  "pearl",
  "gray",
  "grey",
  "gold",
  "silver",
  "red",
  "white",
  "blue",
  "green",
  "sunny",
  "star",
  "chip",
  "art",
  "rich",
  "guy",
  "bill",
  "lane",
  "long",
  "little",
  "free",
  "porters",
  "days",
  "houses",
  "guests",
  "riders",
  "fairs",
  "holidays",
  "brands",
  "pearls",
  "grays",
  "greys",
  "golds",
  "silvers",
  "reds",
  "whites",
  "blues",
  "greens",
  "stars",
  "chips",
  "bills",
  "lanes",
  "longs",
  "sharps",
  "bests",
  "goods",
  "sweets",
  "summers",
  "winters",
  "mays",
  "junes",
  "springs",
  "spring",
  "march",
  "christmas",
  "quick",
  "coach",
  "deal",
  "young",
  "small",
  "strong",
  "master",
  "senior",
  "junior",
  "major",
  "king",
  "night",
  "field",
  "fields",
  "hill",
  "wood",
  "woods",
  "stone",
  "lake",
  "rose",
  "hope",
  "grace",
  "joy",
  "dawn",
  "chase",
  "hunter",
  "dean",
  "cash",
  "snow",
  "storm",
  "fox",
  "wolf",
  "bear",
  "banks",
  "bell",
  "sky",
  "cross",
  "country",
  "track",
  "north",
  "south",
  "east",
  "west",
]);
/** "Appreciation Day", "Game Day": the ambiguous word completes a noun phrase. */
const ambiguousWordCompletesPhrase = (caption: string, tokenStart: number): boolean => {
  const before = caption.slice(0, tokenStart).match(PREVIOUS_WORD_PATTERN);
  if (!before) return false;
  const lower = lowerToken(before[1]);
  return (
    (NON_CUSTOMER_CONTEXT_WORDS.has(lower) || LEAD_IN_NOUN_SET.has(lower)) &&
    !PERSON_HEAD_NOUNS.has(lower) &&
    !NOUN_DETERMINERS.has(lower) &&
    lower !== "the" &&
    !HOP_STOP_WORDS.has(lower) &&
    !LEAD_IN_BOUNDARY_WORDS.has(lower)
  );
};
/** The clause goes on about a single person ("…is all smiles with her new Bronco"). */
const clauseOwnsPerson = (caption: string, tokenEnd: number): boolean =>
  /^(?:\s+[^\s.!?;:\n—–]+){0,7}?\s+(?:her|his)\b/iu.test(caption.slice(tokenEnd));
/**
 * The next word is an unknown capitalized word — the shape of a surname or
 * a second person ("Summer Johnson", "Coach Miller", "Sarah Driver").
 */
const followedByUnknownCapital = (
  caption: string,
  tokenEnd: number,
  grounding: IdentityGrounding,
): string | null => {
  const following = caption
    .slice(tokenEnd)
    .match(/^\s+([\p{Lu}][\p{L}'’-]*)(?![\p{N}-])/u);
  if (!following) return null;
  const word = following[1];
  const lower = lowerToken(word);
  if (
    hasDigit(word) ||
    grounding.words.has(lower) ||
    isAutomotiveBrandToken(word) ||
    NON_CUSTOMER_CONTEXT_WORDS.has(lower) ||
    LEAD_IN_NOUN_SET.has(lower) ||
    HOP_LEAD_IN_WORDS.has(lower) ||
    DETERMINER_ADJECTIVES.has(lower) ||
    PERSON_ADJECTIVES.has(lower) ||
    CUSTOMER_CONTEXT_TRIGGER_WORDS.has(lower) ||
    CUSTOMER_ACTION_WORDS.has(lower) ||
    NOUN_DETERMINERS.has(lower) ||
    HOP_STOP_WORDS.has(lower) ||
    LEAD_IN_BOUNDARY_WORDS.has(lower) ||
    TIME_FOLLOWERS.has(lower) ||
    ORGANISATION_FOLLOWERS.has(lower) ||
    COLLECTIVE_FOLLOWERS.has(lower) ||
    HANDOFF_CONNECTORS.has(lower) ||
    AMBIGUOUS_NAME_WORDS.has(lower)
  ) {
    return null;
  }
  return word;
};
/** The previous word is an unknown capitalized word (a given name before a surname). */
const precededByUnknownCapital = (
  caption: string,
  tokenStart: number,
  grounding: IdentityGrounding,
): string | null => {
  const before = caption.slice(0, tokenStart).match(PREVIOUS_WORD_PATTERN);
  if (!before) return null;
  const word = before[1];
  const lower = lowerToken(word);
  if (
    !isCapitalized(word) ||
    hasDigit(word) ||
    /['’]/u.test(word) ||
    grounding.words.has(lower) ||
    isAutomotiveBrandToken(word) ||
    NON_CUSTOMER_CONTEXT_WORDS.has(lower) ||
    LEAD_IN_NOUN_SET.has(lower) ||
    HOP_LEAD_IN_WORDS.has(lower) ||
    DETERMINER_ADJECTIVES.has(lower) ||
    PERSON_ADJECTIVES.has(lower) ||
    CUSTOMER_CONTEXT_TRIGGER_WORDS.has(lower) ||
    CUSTOMER_ACTION_WORDS.has(lower) ||
    NOUN_DETERMINERS.has(lower) ||
    lower === "the" ||
    HOP_STOP_WORDS.has(lower) ||
    LEAD_IN_BOUNDARY_WORDS.has(lower) ||
    AMBIGUOUS_NAME_WORDS.has(lower)
  ) {
    return null;
  }
  return word;
};
/** "Mr. Ford", "Coach Miller", "her son Ford": a title or relative right before. */
const precededByPersonNoun = (caption: string, tokenStart: number): boolean => {
  const before = caption.slice(0, tokenStart).match(PREVIOUS_WORD_PATTERN);
  if (!before) return false;
  const lower = lowerToken(before[1]);
  return TITLE_HEAD_NOUNS.has(lower) || RELATIVE_NOUN_SET.has(lower);
};
/**
 * ", Expedition" at the end of "New Arrivals: Bronco, Explorer, Expedition"
 * is the last item of a list, not a vocative: walk back over single
 * capitalized comma-separated items to a colon or the start of the line.
 */
const trailingVocativeIsList = (caption: string, tokenStart: number): boolean => {
  let text = caption.slice(0, tokenStart).replace(/\s+$/u, "");
  if (!text.endsWith(",")) return false;
  text = text.slice(0, -1).replace(/\s+$/u, "");
  for (let items = 0; items < 12; items++) {
    const item = text.match(/(?:^|\n|([:,]))\s*([\p{Lu}][\p{L}\p{N}'’-]*)$/u);
    if (!item) return false;
    if (!item[1] || item[1] === ":") return true;
    text = text.slice(0, text.length - item[0].length).replace(/\s+$/u, "");
  }
  return false;
};
const personContinuation = (
  caption: string,
  tokenEnd: number,
  token: string,
  grounding: IdentityGrounding,
  strongOnly: boolean,
): boolean => {
  const rest = caption.slice(tokenEnd);
  if (
    /^\s+(?:[Oo][Nn]|[Ww][Ii][Tt][Hh]|[Aa][Nn][Dd]|&)\s+(?:[Hh][Ee][Rr]|[Hh][Ii][Ss]|[Tt][Hh][Ee][Ii][Rr])\b/u.test(
      rest,
    )
  ) {
    return true;
  }
  if (
    /^\s+for\s+(?:choosing|trusting|visiting|stopping|coming|being|joining|shopping|buying|supporting|sharing|letting|picking|making|bringing|referring|recommending)\b/iu.test(
      rest,
    )
  ) {
    return true;
  }
  const surname = followedByUnknownCapital(caption, tokenEnd, grounding);
  if (surname) {
    if (!strongOnly) return true;
    // "Cheers to Summer Johnson!": outside a person-addressing opener only a
    // pure calendar/given-name word followed by a singular word that ends
    // the phrase reads as a full name ("Cheers to Good Times", "Cheers to
    // Sunny Skies" do not).
    const lower = lowerToken(token);
    const afterSurname = caption
      .slice(tokenEnd)
      .replace(/^\s+[\p{Lu}][\p{L}'’-]*/u, "");
    if (
      !HOP_LEAD_IN_WORDS.has(lower) &&
      !LEAD_IN_NOUN_SET.has(lower) &&
      !DETERMINER_ADJECTIVES.has(lower) &&
      !PERSON_ADJECTIVES.has(lower) &&
      !looksPlural(surname) &&
      /^\s*(?:[!.?,;]|$|\n)/u.test(afterSurname)
    ) {
      return true;
    }
  }
  if (
    !PERSON_ADJECTIVES.has(lowerToken(token)) &&
    /^\s+(?:[Ff][Aa][Mm][Ii][Ll][Yy]|[Ff][Aa][Mm][Ii][Ll][Ii][Ee][Ss])\b/u.test(rest)
  ) {
    return true;
  }
  if (strongOnly) return false;
  return /^\s*(?:[!.?,;]|$|\n)/u.test(rest);
};

/**
 * Nouns that, directly in front of an unknown capitalized word, hand the
 * sentence to the person named next: the owner/customer/relative nouns, the
 * collectives ("Our Team Michelle", "The Ford Family Michelle") and job
 * titles ("our Service Manager Bob", "Nurse Sarah").
 */
const PERSON_HEAD_NOUNS = new Set([
  ...HANDOFF_CONNECTORS,
  ...COLLECTIVE_FOLLOWERS,
  "manager",
  "managers",
  "advisor",
  "advisors",
  "technician",
  "technicians",
  "tech",
  "techs",
  "specialist",
  "specialists",
  "consultant",
  "consultants",
  "associate",
  "associates",
  "director",
  "directors",
  "president",
  "coordinator",
  "coordinators",
  "assistant",
  "assistants",
  "detailer",
  "detailers",
  "mechanic",
  "mechanics",
  "lead",
  "rep",
  "salesperson",
  "porter",
  "cashier",
  "greeter",
  "receptionist",
  "gm",
  "ambassador",
  "veteran",
  "nurse",
  "doctor",
  "graduate",
  "mr",
  "mrs",
  "ms",
  "mx",
  "dr",
  "coach",
  "officer",
  "pastor",
  "captain",
  "chief",
  "mayor",
  "principal",
  "professor",
  "aunt",
  "uncle",
  "cousin",
  "parents",
  "grandparents",
  "newlyweds",
  "couple",
]);

/**
 * A non-possessive word that ends in "s" the way a plural does ("Johnsons",
 * "Adventures", "Williams") — not "class"/"boss", "bus"/"Focus"/"Taurus" or
 * "Chris"/"Travis", which are singular.
 */
const looksPlural = (token: string): boolean =>
  /s$/iu.test(token) && !/['’]/u.test(token) && !/(?:ss|us|is)$/iu.test(token);

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
  let crossedPersonAdjective = false;
  const ownWordIsVehicle =
    grounding.words.has(lowerToken(token)) || isAutomotiveBrandToken(token);
  // "New Adventures", "Our Veterans", "Michigan Winters": a plural,
  // non-possessive word reached through nothing but lead-in vocabulary is a
  // crowd or a thing, never one person — unless "the" introduces it ("the
  // Johnsons", "the Amazing Smiths"), the shape a family name takes.
  const plural = looksPlural(token);
  for (let hops = 0; hops <= 6; hops++) {
    const match = remaining.match(PREVIOUS_WORD_PATTERN);
    if (!match) {
      return plural && hops > 0 && !crossedUnknownCapital && !crossedPersonAdjective;
    }
    const raw = match[1];
    const word = lowerToken(raw);
    const possessive = /['’]s?$/u.test(raw) || /['’]s\s*$/u.test(match[0].trimEnd());
    // The blanked approved label or salesperson owns the thing.
    if (word === "customer" && possessive) return true;
    // "Michelle from Brighton is all smiles", "our newest owner from Howell":
    // a place, when a person (the label or a head noun) sits before "from".
    if (hops === 0 && (word === "from" || word === "of")) {
      const beforeMatch = remaining
        .slice(0, (match.index ?? 0) + match[0].indexOf(raw))
        .match(PREVIOUS_WORD_PATTERN);
      if (beforeMatch) {
        const beforeWord = lowerToken(beforeMatch[1]);
        if (beforeWord === "customer" || PERSON_HEAD_NOUNS.has(beforeWord)) return true;
      }
    }
    if (LEAD_IN_BOUNDARY_WORDS.has(word)) {
      return plural && hops > 0 && !crossedUnknownCapital && !crossedPersonAdjective;
    }
    // "Our newest customer Michelle", "Our Team Michelle", "our Service
    // Manager Bob": the noun right before the candidate hands the sentence
    // to a person.
    if (
      hops === 0 &&
      (TITLE_HEAD_NOUNS.has(word) ||
        RELATIVE_NOUN_SET.has(word) ||
        (PERSON_HEAD_NOUNS.has(word) && !plural))
    ) {
      return false;
    }
    if (NOUN_DETERMINERS.has(word)) {
      // "Our Sarah is thrilled", "My Sarah just drove off", "our Chris":
      // "our"/"my" directly before an unknown word introduces a person,
      // never a vehicle ("This Bronco", "Your Bronco", "Their Explorer" stay
      // things; "Our new Bronco" walks the adjective first).
      if (hops === 0 && OWN_PERSON_DETERMINERS.has(word) && !ownWordIsVehicle) {
        return false;
      }
      // "our amazing Sarah", "their lovely Michelle": praise between a
      // person-capable determiner and the candidate introduces a person.
      if (crossedPersonAdjective && PERSON_CAPABLE_DETERMINERS.has(word)) {
        return false;
      }
      return !(
        crossedUnknownCapital &&
        !crossedAdjective &&
        PERSON_CAPABLE_DETERMINERS.has(word)
      );
    }
    if (word === "the") {
      if (plural && crossedUnknownCapital) return true;
      return !/['’]/u.test(token) && !plural && !crossedPersonAdjective;
    }
    // A model year or a hyphenated/numbered trim ("F-150", "2025") right in
    // front of the candidate can only precede a vehicle.
    if (hasDigit(raw)) return true;
    const capitalized = isCapitalized(raw);
    const knownVehicleWord =
      capitalized && (grounding.words.has(word) || isAutomotiveBrandToken(raw));
    // A possessive that is not the dealer's own name ("The Johnsons' new
    // Explorer", "The Smith's Bronco") is a family owning the vehicle; the
    // store's or the make's own possessive ("Ford's newest Bronco") owns a
    // thing.
    // "Mom's new SUV", "New Year's Eve": a generic noun's possessive owns a
    // thing too.
    if (capitalized && possessive) {
      return knownVehicleWord || NON_CUSTOMER_CONTEXT_WORDS.has(word);
    }
    const walkable =
      DETERMINER_ADJECTIVES.has(word) ||
      PERSON_ADJECTIVES.has(word) ||
      /-/u.test(raw) ||
      // Another model word / the make in front of the model: "this Ford
      // Bronco Sport is", "your new Bronco Sport is", "Our Service
      // Department is".
      (capitalized && !CUSTOMER_CONTEXT_TRIGGER_WORDS.has(word));
    if (!walkable) {
      return plural && hops > 0 && !crossedUnknownCapital && !crossedPersonAdjective;
    }
    if (DETERMINER_ADJECTIVES.has(word)) crossedAdjective = true;
    if (PERSON_ADJECTIVES.has(word)) crossedPersonAdjective = true;
    if (
      capitalized &&
      !knownVehicleWord &&
      !NON_CUSTOMER_CONTEXT_WORDS.has(word) &&
      !DETERMINER_ADJECTIVES.has(word) &&
      !PERSON_ADJECTIVES.has(word) &&
      !HOP_LEAD_IN_WORDS.has(word)
    ) {
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
    if (
      NON_CUSTOMER_CONTEXT_WORDS.has(lower) ||
      DETERMINER_ADJECTIVES.has(lower) ||
      HOP_LEAD_IN_WORDS.has(lower)
    ) {
      break;
    }
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
  fullNameIsBusiness: boolean,
): boolean => {
  if (run.endsWithPossessive) return true;
  let rest = caption.slice(run.end);
  const next = rest.match(/^\s+([\p{L}\p{N}][\p{L}\p{N}'’-]*)/u);
  if (!next) return loneTokenAllowed || run.containsBrand;
  // "Howell 4-H", "Howell 2026 Grads": a number after the town.
  if (hasDigit(next[1])) return true;
  // "Bob Maxey Ford of Howell on 25 years", "Maxey Ford for sponsoring":
  // the store's name spelled out is the store, whatever follows — outside a
  // vehicle slot, where "Ford Bronco Sport" is just as long.
  if (
    fullNameIsBusiness &&
    (run.tokenCount >= 3 || (run.tokenCount >= 2 && run.containsBrand))
  ) {
    return true;
  }
  // "Howell Little League", "Howell Public Schools": walk the lead-in words
  // to the organisation they describe.
  for (let hops = 0; hops < 4; hops++) {
    const word = rest.match(/^\s+([\p{L}][\p{L}'’-]*)/u);
    if (!word) return false;
    const lower = lowerToken(word[1]);
    if (
      COLLECTIVE_FOLLOWERS.has(lower) ||
      ORGANISATION_FOLLOWERS.has(lower) ||
      LEAD_IN_NOUN_SET.has(lower)
    ) {
      return true;
    }
    if (!DETERMINER_ADJECTIVES.has(lower) && !HOP_LEAD_IN_WORDS.has(lower))
      return false;
    rest = rest.slice(word[0].length);
  }
  return false;
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
      // "…newest customer on her new Escape": the clause moved on to the
      // vehicle before naming anyone.
      if (HOP_STOP_WORDS.has(lower)) return null;
      afterBrand = false;
      continue;
    }
    if (CUSTOMER_CONTEXT_TRIGGER_WORDS.has(lower)) return null;
    if (isAutomotiveBrandToken(raw)) {
      afterBrand = true;
      continue;
    }
    // "…newest arrival: the 2025 Expedition": a determiner or model year
    // right before the word introduces a thing, unless it is a plural
    // family name ("…newest owners, the Johnsons").
    const previous = caption
      .slice(0, caption.length - rest.length - match[0].length + match[0].indexOf(raw))
      .match(PREVIOUS_WORD_PATTERN);
    if (
      previous &&
      (NOUN_DETERMINERS.has(lowerToken(previous[1])) ||
        (lowerToken(previous[1]) === "the" && !looksPlural(raw)) ||
        hasDigit(previous[1]) ||
        (DETERMINER_ADJECTIVES.has(lowerToken(previous[1])) &&
          !/^\s+[\p{Lu}]/u.test(rest)))
    ) {
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
  const tail = caption
    .slice(run.end)
    .match(/^\s*[,:–—-]+\s*(?:[Tt][Hh][Ee]\s+)?([\p{Lu}][\p{L}'’-]*)/u);
  if (!tail) return null;
  // "— New Owner Michelle!": walk the closed lead-in vocabulary to the person.
  let word = tail[1];
  let cursor = run.end + tail[0].length;
  for (let hops = 0; hops < 6; hops++) {
    const lower = lowerToken(word);
    if (grounding.words.has(lower) || isAutomotiveBrandToken(word)) return null;
    if (HOP_STOP_WORDS.has(lower)) return null;
    if (!HOP_LEAD_IN_WORDS.has(lower) && !NON_CUSTOMER_CONTEXT_WORDS.has(lower)) {
      if (CUSTOMER_CONTEXT_TRIGGER_WORDS.has(lower)) return null;
      return stripPossessive(word);
    }
    const next = caption.slice(cursor).match(/^\s+([\p{L}][\p{L}'’-]*)/u);
    if (!next || !isCapitalized(next[1])) return null;
    word = next[1];
    cursor += next[0].length;
  }
  return null;
};

/**
 * "Bronco owner", "Explorer owners": the next word owns the candidate. Only
 * the nouns count — "Congrats Michelle for choosing us" hands off nothing.
 */
const followedByHandoffNoun = (caption: string, tokenEnd: number): boolean => {
  const following = caption.slice(tokenEnd).match(/^\s+([\p{L}][\p{L}'’-]*)/u);
  if (!following) return false;
  const followingLower = lowerToken(following[1]);
  return (
    HANDOFF_CONNECTORS.has(followingLower) &&
    followingLower !== "to" &&
    followingLower !== "for"
  );
};

/**
 * "Meet us at Brighton…", "everyone in Howell…", "neighbors in Howell and
 * Brighton": the word after (or the next item of its list) is a place.
 */
const LOCATION_BEFORE =
  /\b(?:at|in|on|near|around|inside)\s+(?:[\p{L}\p{N}'’-]+\s*(?:and|&)\s+)*$/iu;

/** "Bronco Nation", "Ford family": a group. */
const followedByCollectiveNoun = (caption: string, tokenEnd: number): boolean => {
  const following = caption.slice(tokenEnd).match(/^\s+([\p{L}][\p{L}'’-]*)/u);
  return !!following && COLLECTIVE_FOLLOWERS.has(lowerToken(following[1]));
};

/** "Livingston County", "Brighton High School": a place or organisation. */
const followedByOrganisationNoun = (caption: string, tokenEnd: number): boolean => {
  const following = caption.slice(tokenEnd).match(/^\s+([\p{L}][\p{L}'’-]*)/u);
  return !!following && ORGANISATION_FOLLOWERS.has(lowerToken(following[1]));
};

/**
 * Which determiner governs a lead-in phrase: walks back over the lead-in
 * vocabulary ("the Amazing", "our Detail", "New") to "the", an owning
 * determiner ("our"/"my"), any other determiner, or nothing at all.
 */
const leadInDeterminer = (
  caption: string,
  tokenStart: number,
): "the" | "own" | "other" | "none" => {
  let remaining = caption.slice(0, tokenStart);
  for (let hops = 0; hops <= 6; hops++) {
    const match = remaining.match(PREVIOUS_WORD_PATTERN);
    if (!match) return "none";
    const word = lowerToken(match[1]);
    if (word === "the") return "the";
    if (OWN_PERSON_DETERMINERS.has(word)) return "own";
    if (NOUN_DETERMINERS.has(word)) return "other";
    if (
      !HOP_LEAD_IN_WORDS.has(word) &&
      !DETERMINER_ADJECTIVES.has(word) &&
      !PERSON_ADJECTIVES.has(word)
    ) {
      return "none";
    }
    remaining = remaining.slice(0, (match.index ?? 0) + match[0].indexOf(match[1]));
  }
  return "none";
};

/**
 * "Congrats to the newest Bronco owner!", "Cheers to the Explorer!",
 * "Perfect for the F-150!": an unknown capitalized word reached through a
 * lead-in is a THING when the next word owns it (the person, if any, is
 * named after that noun and examined next) or when a determiner phrase
 * introduces it as one. It is a PERSON when a family noun follows it ("the
 * Johnson family", "the Smith crew") — unless the phrase is the dealer's
 * own ("our Detail Team") — or when nothing introduces it as a thing.
 */
const leadInTargetVerdict = (
  caption: string,
  tokenStart: number,
  tokenEnd: number,
  token: string,
  grounding: IdentityGrounding,
): "thing" | "person" => {
  const following = caption.slice(tokenEnd).match(/^\s+([\p{L}][\p{L}'’-]*)/u);
  const followingLower = following ? lowerToken(following[1]) : "";
  if (following && FAMILY_FOLLOWERS.has(followingLower)) return "person";
  if (following && TIME_FOLLOWERS.has(followingLower)) return "thing";
  if (followedByHandoffNoun(caption, tokenEnd)) return "thing";
  if (following && ORGANISATION_FOLLOWERS.has(followingLower)) return "thing";
  if (LOCATION_BEFORE.test(caption.slice(0, tokenStart))) return "thing";
  if (following && COLLECTIVE_FOLLOWERS.has(followingLower)) {
    if (followingLower === "family" || followingLower === "families") {
      return "person";
    }
    const determiner = leadInDeterminer(caption, tokenStart);
    return determiner === "own" || determiner === "other" ? "thing" : "person";
  }
  return precededByDeterminer(caption, tokenStart, token, grounding)
    ? "thing"
    : "person";
};

/**
 * "Congrats to The Johnsons!", "Meet Our Newest Customer Michelle", "Cheers
 * to the newest Bronco owner Sarah": walk forward over the closed lead-in
 * vocabulary from `cursor` to the next capitalized word and examine it as
 * the person the phrase was really addressing. Stops at a preposition
 * ("Sold By Joe" hands off to nobody), at a lowercase word outside that
 * vocabulary, or at the end of the phrase.
 */
const hopToPerson = (
  caption: string,
  cursor: number,
  grounding: IdentityGrounding,
  context: CandidateContext,
  found: string[],
): void => {
  for (let hops = 0; hops < 8; hops++) {
    const next = caption
      .slice(cursor)
      .match(/^[\s,]*(?:['’][Ss])?[\s,]+(&|[\p{L}\p{N}][\p{L}\p{N}'’-]*)/u);
    if (!next) return;
    const nextStart = cursor + next[0].indexOf(next[1]);
    cursor += next[0].length;
    const nextLower = lowerToken(next[1]);
    // "Congrats to Our Newest Owner Will!", "the Parks family", "our newest
    // team member May": a vocabulary word that is also a name, ending the
    // phrase in a person-addressing slot, is the person.
    if (
      AMBIGUOUS_NAME_WORDS.has(nextLower) &&
      isCapitalized(next[1]) &&
      personContinuation(
        caption,
        cursor,
        next[1],
        grounding,
        !PERSON_SLOT_OPENER.test(context.matchText),
      ) &&
      !ambiguousWordCompletesPhrase(caption, nextStart)
    ) {
      found.push(followedByUnknownCapital(caption, cursor, grounding) || next[1]);
      return;
    }
    if (nextLower === "and" || next[1] === "&") continue;
    if (HOP_STOP_WORDS.has(nextLower)) return;
    // "Our Newest F-150 Owner Dave": a model code or year is part of the thing.
    if (hasDigit(next[1])) continue;
    if (
      HOP_LEAD_IN_WORDS.has(nextLower) ||
      NON_CUSTOMER_CONTEXT_WORDS.has(nextLower) ||
      DETERMINER_ADJECTIVES.has(nextLower) ||
      // "Michelle and her husband Bob": a relative hands off to the person.
      (HANDOFF_CONNECTORS.has(nextLower) && nextLower !== "to" && nextLower !== "for")
    ) {
      continue;
    }
    if (!isCapitalized(next[1])) return;
    evaluateCandidate(
      caption,
      next[1],
      nextStart,
      cursor,
      grounding,
      { ...context, viaLeadIn: true },
      found,
    );
    return;
  }
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
  /** ", Expedition" closing "Bronco, Explorer, Expedition" — a list, not a vocative. */
  listTail: boolean;
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
  const isBareAction = context.patternIndex === BARE_ACTION_PATTERN_INDEX;
  const isPhotoCaption = context.patternIndex === PHOTO_CAPTION_PATTERN_INDEX;
  // "New Arrivals: Bronco, Explorer, Expedition": the last item of a list.
  if (context.listTail) return;
  // "America's Truck", "Sarah's": a possessive in a photo caption belongs to
  // the possessive pattern.
  if (isPhotoCaption && /['’][Ss]$/u.test(token)) return;
  if (
    NON_CUSTOMER_CONTEXT_WORDS.has(lower) ||
    CUSTOMER_CONTEXT_TRIGGER_WORDS.has(lower) ||
    (!isBareAction &&
      (HOP_LEAD_IN_WORDS.has(lower) ||
        AMBIGUOUS_NAME_WORDS.has(lower) ||
        (CUSTOMER_ACTION_WORDS.has(lower) && !AMBIGUOUS_NAME_WORDS.has(lower))))
  ) {
    // "Congrats to The Johnsons!", "Meet Our Newest Customer Michelle",
    // "Congrats to the Wonderful Michelle": a capitalized lead-in word landed
    // in the name slot and the regex has already consumed it, so the person
    // right after it would never be examined. Hop over the closed lead-in
    // vocabulary to that person. Anything else ("Delivered Sold By Joe" —
    // "by" is not lead-in) stops.
    if (isPhotoCaption && HOP_LEAD_IN_WORDS.has(lower) && !isBareAction) {
      // "The Johnsons with their new Explorer!": walk to the person.
      hopToPerson(caption, tokenEnd, grounding, context, found);
      return;
    }
    if (isBareAction || isPhotoCaption) {
      // "Sarah Day is all smiles with her new Bronco", "Nguyễn Văn An is
      // thrilled with his…": a vocabulary surname erases nothing when a
      // given name sits before it and the clause goes on about one person.
      // "Summer is all smiles with her new Bronco": the given name itself.
      if (clauseOwnsPerson(caption, tokenEnd)) {
        const givenName = precededByUnknownCapital(caption, tokenStart, grounding);
        if (givenName) {
          found.push(givenName);
          return;
        }
        if (
          AMBIGUOUS_NAME_WORDS.has(lower) &&
          !ambiguousWordCompletesPhrase(caption, tokenStart)
        ) {
          found.push(token);
          return;
        }
      }
      return;
    }
    if (CUSTOMER_ACTION_WORDS.has(lower) && !AMBIGUOUS_NAME_WORDS.has(lower)) return;
    // "Congrats to the Spring family", "Meet the King family": any word but
    // an adjective is a surname in front of a family noun after "the".
    if (
      followedByFamilyNoun(caption, tokenEnd) &&
      /\bthe\s+$/iu.test(caption.slice(0, tokenStart)) &&
      !PERSON_ADJECTIVES.has(lower) &&
      !DETERMINER_ADJECTIVES.has(lower) &&
      !CUSTOMER_CONTEXT_TRIGGER_WORDS.has(lower) &&
      !NOUN_DETERMINERS.has(lower) &&
      !HOP_STOP_WORDS.has(lower) &&
      !LEAD_IN_BOUNDARY_WORDS.has(lower) &&
      !COLLECTIVE_FOLLOWERS.has(lower) &&
      !HANDOFF_CONNECTORS.has(lower)
    ) {
      found.push(token);
      return;
    }
    // "Congrats to April!", "Meet Porter!", "Welcome home, Summer!",
    // "Congrats to Summer Johnson", "Cheers to April on her new Bronco": a
    // vocabulary word that is also a name, standing where only a person can.
    if (
      AMBIGUOUS_NAME_WORDS.has(lower) &&
      context.patternIndex !== POSSESSIVE_PATTERN_INDEX &&
      personContinuation(
        caption,
        tokenEnd,
        token,
        grounding,
        !(
          PERSON_SLOT_OPENER.test(context.matchText) ||
          context.patternIndex === 8 ||
          context.patternIndex === LEADING_VOCATIVE_PATTERN_INDEX ||
          context.patternIndex >= 11
        ),
      ) &&
      !ambiguousWordCompletesPhrase(caption, tokenStart)
    ) {
      found.push(followedByUnknownCapital(caption, tokenEnd, grounding) || token);
      return;
    }
    if (context.patternIndex === POSSESSIVE_PATTERN_INDEX) {
      // "Father's Day to Bronco Dads", "Today's special": a vocabulary
      // possessive hands off only to a relative ("Customer's son Jake").
      const next = caption.slice(tokenEnd).match(/^\s+([\p{L}][\p{L}'’-]*)/u);
      if (!next || !RELATIVE_NOUN_SET.has(lowerToken(next[1]))) return;
    } else if (!HOP_LEAD_IN_WORDS.has(lower) && !AMBIGUOUS_NAME_WORDS.has(lower)) {
      return;
    }
    hopToPerson(caption, tokenEnd, grounding, context, found);
    return;
  }

  if (grounding.words.has(lower)) {
    const run = groundedRun(caption, tokenEnd, token, grounding, context.vehicleSlot);
    const before = precedingRun(caption, tokenStart, token, grounding);
    if (run.ok && !before.unrelated) {
      const totalTokens = run.tokenCount + before.tokenCount;
      const anyBrand = run.containsBrand || before.containsBrand;
      // "Mr. Ford", "Coach Ford", "her son Ford": a title or relative before
      // the store's word names a person who shares it — never a VIN-grounded
      // model ("Meet Mr. Bronco").
      if (
        !isBareAction &&
        !isPhotoCaption &&
        !grounding.modelWords.has(lower) &&
        precededByPersonNoun(caption, tokenStart)
      ) {
        found.push(token);
        return;
      }
      if (isBareAction || isPhotoCaption) {
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
      // "Congrats to Ford on 120 years!", "Cheers to Ford on the win": the
      // make itself, unless the clause goes on about a person ("Congrats to
      // Ford on his new Bronco").
      if (
        anyBrand &&
        run.tokenCount === 1 &&
        !clauseOwnsPerson(caption, run.end) &&
        !followedByUnknownCapital(caption, run.end, grounding)
      ) {
        hopToPerson(caption, run.end, grounding, context, found);
        return;
      }
      // "Welcome, Bronco Raptor!", "Meet Bronco owner Sarah": a VIN-grounded
      // model word is the vehicle in any slot; whoever it hands off to is
      // still examined.
      if (grounding.modelWords.has(lower)) {
        hopToPerson(caption, run.end, grounding, context, found);
        return;
      }
      if (
        deliberateRunIsBusiness(
          caption,
          run,
          context.loneTokenAllowed,
          !context.vehicleSlot,
        )
      ) {
        const handoff = handoffTargetAfter(caption, run, grounding);
        if (handoff) {
          found.push(handoff);
          return;
        }
        // "Howell's newest Bronco Sport owner", "the Maxey Ford team's newest
        // member": the possessive walk above already examined the clause.
        if (
          run.endsWithPossessive ||
          /^\s+[\p{L}]+['’][Ss]?\b/u.test(caption.slice(run.end))
        ) {
          return;
        }
        if (context.vehicleSlot) {
          const tail = headlineTailAfter(caption, run, grounding);
          if (tail) {
            found.push(tail);
            return;
          }
        }
        // "the Ford Family Michelle", "Ford Family Member Michelle": the
        // collective or department may still name its person after it.
        hopToPerson(caption, run.end, grounding, context, found);
        return;
      }
      // "Delivered: Ford Bronco Sport to the Howell family" / "to Michelle":
      // the vehicle was handed to whoever follows "to".
      if (context.vehicleSlot && /^\s+[Tt][Oo]\b/u.test(caption.slice(run.end))) {
        hopToPerson(caption, run.end, grounding, context, found);
        return;
      }
      // "Thanks to everyone in Howell", "the best team in Howell": the town.
      if (context.viaLeadIn && LOCATION_BEFORE.test(caption.slice(0, tokenStart))) {
        hopToPerson(caption, run.end, grounding, context, found);
        return;
      }
      // "Meet the Bronco Sport Badlands": a determiner before a grounded run
      // in a lead-in slot introduces the thing, not the founder.
      if (
        context.viaLeadIn &&
        precededByDeterminer(caption, tokenStart, token, grounding)
      ) {
        hopToPerson(caption, run.end, grounding, context, found);
        return;
      }
      found.push(token);
      return;
    }
    if (
      (isBareAction || context.viaLeadIn) &&
      precededByDeterminer(caption, tokenStart, token, grounding)
    ) {
      if (context.viaLeadIn) hopToPerson(caption, tokenEnd, grounding, context, found);
      return;
    }
    // "Meet us at Howell Melon Festival": the town, then whatever it hosts.
    if (context.viaLeadIn && LOCATION_BEFORE.test(caption.slice(0, tokenStart))) {
      hopToPerson(caption, tokenEnd, grounding, context, found);
      return;
    }
    found.push(token);
    return;
  }

  if (
    (lower === "america" || lower === "americas" || lower === "usa") &&
    !clauseOwnsPerson(caption, tokenEnd)
  ) {
    // "Built for America", "Happy Birthday to America": the country.
    return;
  }
  // "Bronco Nation, this one's for you!", "Truck Month, let's go!": a group
  // or an occasion opening the caption, not a person.
  if (
    context.patternIndex === LEADING_VOCATIVE_PATTERN_INDEX &&
    (followedByOrganisationNoun(caption, tokenEnd) ||
      followedByTimeNoun(caption, tokenEnd) ||
      followedByCollectiveNoun(caption, tokenEnd))
  ) {
    return;
  }
  if (context.patternIndex === FAMILY_POSSESSIVE_PATTERN_INDEX) {
    // "The Johnson family's new Explorer": the family's name.
    found.push(token);
    return;
  }
  if (context.patternIndex === POSSESSIVE_PATTERN_INDEX) {
    // "Sarah's new ride", "Sarah's husband Bob": a possessive name is the
    // person — unless it names an occasion ("Mother's Day"), a region
    // ("America's best-selling truck") or a determiner introduces the thing
    // owned ("the Bronco's new owner").
    if (followedByTimeNoun(caption, tokenEnd)) return;
    if (lower === "america" || lower === "americas") return;
    if (precededByDeterminer(caption, tokenStart, token, grounding)) {
      hopToPerson(caption, tokenEnd, grounding, context, found);
      return;
    }
    found.push(stripPossessive(token));
    return;
  }

  if (isBareAction) {
    // "The Miller family loves their new Explorer": the family noun makes
    // the word before it a surname, whatever introduced it.
    if (followedByFamilyNoun(caption, tokenEnd)) {
      found.push(token);
      return;
    }
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

  // "Customer Perks", "Owner Benefits": a plural thing after a head label.
  if (
    context.patternIndex === HEAD_LABEL_PATTERN_INDEX &&
    looksPlural(token) &&
    !context.isNameList &&
    !followedByUnknownCapital(caption, tokenEnd, grounding)
  ) {
    return;
  }
  if (
    (context.viaLeadIn ||
      followedByHandoffNoun(caption, tokenEnd) ||
      followedByOrganisationNoun(caption, tokenEnd) ||
      followedByTimeNoun(caption, tokenEnd)) &&
    leadInTargetVerdict(caption, tokenStart, tokenEnd, token, grounding) === "thing"
  ) {
    // The thing is forgiven, but the phrase may still name its person after
    // it: "the newest Bronco owner Sarah", "Our Newest Bronco Sport Owner
    // Michelle", "the Radiant Michelle".
    hopToPerson(caption, tokenEnd, grounding, context, found);
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
          patternIndex === LEADING_VOCATIVE_PATTERN_INDEX ||
          // "Greetings from Howell.", "Straight from Ford," — but not when a
          // congratulation opener owns the clause ("Congrats from Bob!"),
          // where a lone dealer word is as likely the founder as the town.
          (FROM_OPENER.test(opener) &&
            !CONGRATULATION_OPENER_PATTERN.test(caption.slice(0, match.index ?? 0))),
        isNameList: /\s+and\s+|[&+/]/iu.test(group),
        viaLeadIn:
          (patternIndex === 0 ||
            patternIndex === 1 ||
            patternIndex === 3 ||
            patternIndex === 4 ||
            patternIndex === 5 ||
            patternIndex === 6) &&
          LEAD_IN_OPENER.test(opener),
        listTail:
          patternIndex === TRAILING_VOCATIVE_PATTERN_INDEX &&
          trailingVocativeIsList(caption, groupStart),
      };
      let cursor = 0;
      for (const raw of group.split(/\s+and\s+|\s*(?:&|\+|\/|,)\s*/i)) {
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
 * "#CongratsMichelle" / "#WelcomeHomeMichelle" address a person as plainly as
 * prose does. Split a camel-case tag into words, but keep capitalization only
 * where it forms that addressing shape — an opener, its lead-in words, and
 * the first word after them (the name). Everything else is lowercased so the
 * Title Case a split produces cannot read as a name in a prose slot
 * ("#ThanksForChoosingUs" must not become "Thanks For Choosing Us").
 * Mirrored 1:1 on the server.
 */
const HASHTAG_OPENER_WORDS = new Set([
  ...[...CUSTOMER_CONTEXT_TRIGGER_WORDS].filter(
    (w) => !["for", "with", "from"].includes(w),
  ),
  // "#NewCarDayMichelle", "#HappyCustomerSarah", "#BroncoOwnerSarah"
  "new",
  "car",
  "day",
  "happy",
  "proud",
  "newest",
  "our",
  "customer",
  "customers",
  "owner",
  "owners",
  "member",
  "members",
  "team",
  "spotlight",
  "employee",
]);
const TITLE_ABBREVIATIONS = /\b(Mr|Mrs|Ms|Mx|Dr|Jr|Sr|St)\.(?=\s)/gu;

/** "@SarahJohnson" → "Sarah Johnson", "@BobMaxeyFord" → "Bob Maxey Ford". */
const splitMention = (tag: string): string =>
  tag
    .replace(/_/g, " ")
    .replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, "$1 $2")
    .trim();

// Only a preposition ends a split tag's addressing shape: "#ThankYouMichelle"
// keeps "You" as part of the opener, "#SoldByJoe" stops at "By".
const HASHTAG_STOP_WORDS = new Set(["by", "of", "for", "from", "at", "in", "on"]);
const splitHashtag = (tag: string, grounding: IdentityGrounding): string => {
  const words = tag
    .replace(/_/g, " ")
    .replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, "$1 $2")
    .replace(/(\p{L})(\p{N})/gu, "$1 $2")
    .split(" ")
    .filter(Boolean)
    // "#Congrats2Sarah", "#Thanks4Choosing": text-speak prepositions.
    .map((word) => (word === "2" ? "to" : word === "4" ? "for" : word))
    // "#Congrats2025Sarah": a year before the name is decoration.
    .filter(
      (word, index, all) =>
        !(/^\p{N}+$/u.test(word) && isCapitalized(all[index + 1] || "")),
    );
  let state: "plain" | "leadin" | "done" | "stopped" = "plain";
  return words
    .map((word) => {
      const lower = word.toLocaleLowerCase("en-US");
      if (state !== "stopped" && HASHTAG_OPENER_WORDS.has(lower)) {
        state = "leadin";
        return word;
      }
      if (state === "leadin") {
        // "#WelcomeToTheFordFamilyMichelle": the store's own words and the
        // collective nouns are lead-in too; a stop word ends the shape
        // ("#ThanksForVisitingHowell" names nobody).
        if (HASHTAG_STOP_WORDS.has(lower)) {
          state = "stopped";
          return word;
        }
        const walkable =
          hasDigit(word) ||
          HOP_LEAD_IN_WORDS.has(lower) ||
          NON_CUSTOMER_CONTEXT_WORDS.has(lower) ||
          grounding.words.has(lower) ||
          isAutomotiveBrandToken(word);
        if (!walkable) state = "done";
        return word;
      }
      // "#NewOwnerSarahJohnson": the words after the name keep their case —
      // the surname is part of the name. Before any opener, Title Case is
      // still lowercased so "#BroncoIsBack" cannot read as a name.
      return state === "done" ? word : lower;
    })
    .join(" ");
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
/**
 * "Michelle Smith" → "Customer Smith": a capitalized word glued to the
 * blanked label is a surname — unless it is the next word of the sentence
 * written in Title Case or ALL CAPS ("CONGRATS TO MICHELLE ON HER NEW
 * BRONCO", "Michelle Is All Smiles"). Vocabulary words are never a surname
 * here; the store's own words still are ("Michelle Ford").
 */
const NAME_PARTICLES =
  "(?:(?:de|la|del|della|di|da|du|van|von|der|den|le|el|al|bin|ibn|mac|mc)\\s+)*";
const surnameAfterPlaceholder = (
  tagged: string,
  grounding: IdentityGrounding,
): string | null => {
  const pattern = new RegExp(
    `\\u0001Customer\\s+${NAME_PARTICLES}([\\p{Lu}][\\p{L}'’\\-]{1,39}|[\\p{Lu}]\\.)(?=$|[^\\p{L}])`,
    "gu",
  );
  for (const match of tagged.matchAll(pattern)) {
    const word = match[1];
    const lower = lowerToken(word);
    const rest = tagged.slice((match.index ?? 0) + match[0].length);
    if (grounding.words.has(lower) || isAutomotiveBrandToken(word)) return word;
    // "Michelle Day is all smiles", "Michelle Porter!": a vocabulary word
    // that is also a surname, followed by the sentence going on in lowercase
    // (or ending) rather than by Title Case.
    if (
      AMBIGUOUS_NAME_WORDS.has(lower) &&
      !PERSON_ADJECTIVES.has(lower) &&
      /^(?:\s*(?:[!.?,;]|$|\n)|\s+[\p{Ll}])/u.test(rest)
    ) {
      return word;
    }
    if (!(
      NON_CUSTOMER_CONTEXT_WORDS.has(lower) ||
      HOP_STOP_WORDS.has(lower) ||
      LEAD_IN_BOUNDARY_WORDS.has(lower) ||
      HOP_LEAD_IN_WORDS.has(lower) ||
      DETERMINER_ADJECTIVES.has(lower) ||
      PERSON_ADJECTIVES.has(lower) ||
      CUSTOMER_CONTEXT_TRIGGER_WORDS.has(lower) ||
      CUSTOMER_ACTION_WORDS.has(lower) ||
      AMBIGUOUS_NAME_WORDS.has(lower)
    )) {
      return word;
    }
  }
  return null;
};

export const unauthorizedCustomerNames = (
  caption: string,
  expectedCustomerName?: string,
  options: CaptionCustomerIdentityOptions = {},
): string[] => {
  const expected = toPublicCustomerLabel(expectedCustomerName);
  const grounding = buildGrounding(options.allowedPhrases);
  // Every whitespace run collapses to one character, but a line break stays
  // a line break so a new sentence on the next line is a hard boundary.
  const preSplit = (caption || "")
    .normalize("NFKC")
    .replace(/\u0001/g, "")
    // Smart punctuation is the same punctuation.
    .replace(/[’‘ʼ]/gu, "'")
    .replace(/[“”]/gu, '"')
    .replace(/[‒―−]/gu, "—")
    // "Mr. Miller", "Dr. Nguyen": the title's period is not a sentence end.
    .replace(TITLE_ABBREVIATIONS, "$1")
    .replace(/\s+/g, (ws) => (ws.includes("\n") ? "\n" : " "))
    .trim();
  // "#CongratsMichelle" / "#WelcomeHomeMichelle" address a person just as
  // plainly as prose does; split a camel-case hashtag into its words so the
  // same openers see it. A tag is its own clause: a period is emitted before
  // every tag that follows text on the same line ("Bronco Sport! #Delivered"
  // must not read as a "Sport — Delivered" headline, "#Delivered #Bronco"
  // must not read as "Delivered Bronco"). Both sides split identically.
  const normalizedCaption = preSplit
    .replace(/([^\s#])[^\S\n]+(?=#[\p{L}\p{N}_])/gu, "$1. ")
    .replace(/#([\p{L}\p{N}_]+)/gu, (_m, tag: string) => splitHashtag(tag, grounding))
    // "@SarahJohnson" is a name written without spaces; "@BobMaxeyFord" is
    // the store's. Split the mention and keep its case.
    .replace(/@([\p{L}\p{N}_]+)/gu, (_m, tag: string) => splitMention(tag))
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
    // Checked on the UNSPLIT text so "#MichelleSmith" / "#MichelleAndBob"
    // are the glued-on surname / second person they look like — including
    // inside a camel-case tag ("#CongratsMichelleSmith"), where the label
    // must keep its own capital so "Ann" never matches "Planned".
    const extended =
      new RegExp(
        `(^|[^\\p{L}\\p{N}])(${escapeIdentityPattern(expected)}(?:\\p{L}+|-\\p{L}+))(?=$|[^\\p{L}\\p{N}])`,
        "iu",
      ).exec(preSplit) ||
      new RegExp(
        `\\p{Ll}(${escapeIdentityPattern(expected.charAt(0).toLocaleUpperCase("en-US"))}${ci(expected.slice(1))}\\p{Lu}\\p{L}*)(?=$|[^\\p{L}\\p{N}])`,
        "u",
      ).exec(preSplit);
    if (extended) return [extended[2] || extended[1]];
  }
  if (!expected && !options.rejectAnyCustomerIdentity) return [];

  // The approved label is blanked and checked for a glued-on surname
  // ("Michelle Smith" → "Customer Smith"). Nothing else is ever blanked:
  // grounded business phrases are forgiven per word by the run walkers, so
  // the person they hand off to ("Bob Maxey Ford of Howell's newest
  // customer, Michelle") stays visible.
  const tagged = replaceAllowedIdentityPhrase(normalizedCaption, expected);
  const leakedAfterPlaceholder = surnameAfterPlaceholder(tagged, grounding);
  if (leakedAfterPlaceholder) return [leakedAfterPlaceholder];
  const strictScan = tagged.replace(/\u0001/g, "");
  // A salesperson's name is masked only out of the generic "X is/has…" and
  // "for/with/from" prose scans. "Congratulations to <salesperson>" stays a
  // refusal.
  let looseScan = strictScan;
  for (const phrase of options.maskedPhrases || []) {
    looseScan = replaceAllowedIdentityPhrase(looseScan, phrase);
  }
  looseScan = looseScan.replace(/\u0001/g, "");

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
