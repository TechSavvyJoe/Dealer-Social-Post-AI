/**
 * Compliance disclosure auto-insert.
 *
 * Scans generated post copy for trigger phrases that legally require
 * disclosures under Reg Z (Truth in Lending), Reg M (Consumer Leasing Act),
 * FTC advertising rules, and common state-level auto-advertising regs.
 *
 * Appends the appropriate disclosure block as a small-print footer so the
 * dealer's social posts don't violate OEM brand guidelines or trigger
 * regulator complaints.
 *
 * NOT legal advice. Disclosures here are common-industry templates and should
 * be reviewed by the dealer's compliance officer / counsel.
 */

import { normalizeCaptionHashtags } from "./hashtags";
import { applyDealerBrandKit, type DealerBrandKit } from "./brandKit";
import { cleanSocialCaption } from "./captionQuality";

export type DisclosureCategory =
  | "financing_apr"
  | "zero_down"
  | "lease"
  | "rebate_pricing"
  | "trade_value"
  | "prohibited_phrase"
  | "dealer_banned_phrase";

export interface DisclosureMatch {
  category: DisclosureCategory;
  triggerPhrase: string;
  /** True if this is a prohibited phrase the dealer should remove entirely. */
  prohibited?: boolean;
  /** Disclosure text to append. Empty for prohibited phrases. */
  disclosure: string;
}

interface Rule {
  category: DisclosureCategory;
  /** Each pattern; if any matches, the rule fires. */
  patterns: RegExp[];
  disclosure: string;
  prohibited?: boolean;
}

// This order is the canonical client/server disclosure order. Caption packs can
// surface the same rules in any destination order, so delivery metadata and the
// locked footer must always be rebuilt in this fixed sequence.
const RULES: Rule[] = [
  {
    category: "financing_apr",
    patterns: [
      // Any advertised numeric APR triggers a Reg Z disclosure. The old rule
      // only matched 0/1.9/2.9/3.9/4.9%, so real ads like "0.9% APR",
      // "1.49% APR", "5.9% APR" or "6% APR" shipped with NO financing
      // disclosure — a Truth-in-Lending under-disclosure. Generalize to catch
      // every numeric APR (over-disclosing is the legally safe direction).
      /\b\d{1,2}(?:\.\d{1,2})?\s*%\s*apr\b/i,
      /\bzero\s+percent\s+apr\b/i,
      /\b0\s*apr\b/i,
      /\bfinancing\s+as\s+low\s+as\b/i,
    ],
    disclosure:
      "Financing subject to credit approval through dealer-participating lenders. Advertised APR is for qualified buyers (top-tier credit) and may vary by term, lender, and applicant credit. Not all buyers will qualify. See dealer for complete terms.",
  },
  {
    category: "zero_down",
    patterns: [
      /\$\s*0\s+down\b/i,
      /\bno\s+money\s+down\b/i,
      /\$\s*0\s+due\s+at\s+signing\b/i,
      /\bzero\s+down\b/i,
    ],
    disclosure:
      "Sign-and-drive offer subject to credit approval. First payment may be due at signing. Taxes, title, license, registration, and dealer documentary fees additional.",
  },
  {
    category: "lease",
    patterns: [
      /\blease\s+(?:for|from|starting\s+at)\b/i,
      /\$\d+(?:\.\d{1,2})?\s*\/?\s*mo(?:nth)?\b/i,
      /\bmonthly\s+lease\b/i,
      /\b\d+\s*-month\s+lease\b/i,
    ],
    disclosure:
      "Lease offer with approved credit through participating captive or third-party lender. Excludes tax, title, license, registration, acquisition, disposition, and dealer documentary fees. Mileage and wear-and-tear limits apply. Lessee responsible for excess. See dealer for full terms.",
  },
  {
    category: "rebate_pricing",
    patterns: [
      /\$\d[\d,]*\s+off\s+msrp\b/i,
      /\$\d[\d,]*\s+below\s+(?:invoice|msrp)\b/i,
      /\bsave\s+up\s+to\s+\$\d[\d,]*/i,
      /\b\d+%\s+off\b/i,
    ],
    disclosure:
      "Pricing excludes tax, title, license, registration, and dealer documentary fees. Offer applies to specific stock units only — stock # available upon request. Cannot be combined with all incentives. Offer expires end of month or while supplies last.",
  },
  {
    category: "trade_value",
    patterns: [
      /\btrade(?:-|\s)?in\s+value\b/i,
      /\bworth\s+up\s+to\s+\$\d[\d,]*/i,
      /\bguaranteed\s+trade\s+value\b/i,
    ],
    disclosure:
      "Trade-in value is an estimate based on industry guides and is subject to a physical inspection. Final trade allowance is at the dealer's discretion and may vary based on condition, mileage, and market.",
  },
  // Prohibited phrases under FTC + most state attorney-general guidance.
  {
    category: "prohibited_phrase",
    patterns: [
      /\bguaranteed\s+(?:approval|credit|financing)\b/i,
      /\bno\s+credit\s+check\b/i,
      /\beveryone\s+(?:approved|gets\s+approved)\b/i,
      /\b100%\s+(?:approval|approved)\b/i,
    ],
    disclosure: "",
    prohibited: true,
  },
];

/** The exact header that opens every canonical disclosure block. */
export const CANONICAL_DISCLOSURE_HEADER = "— Disclosures —";

/**
 * Canonical disclosure material: the exact header plus every rule's exact
 * disclosure text, in canonical order. Fixed legal copy that can never carry a
 * customer name. Must stay identical to canonicalDisclosureMaterial() in
 * pb_hooks/requestPolicies.js (asserted by __tests__/complianceDisclosures.test.ts).
 */
export const canonicalDisclosureMaterial = (): string[] => [
  CANONICAL_DISCLOSURE_HEADER,
  ...RULES.filter((rule) => !rule.prohibited && rule.disclosure).map(
    (rule) => rule.disclosure,
  ),
];

/**
 * What may bound canonical material on each side, besides the start or end of
 * the text. Explicit lists rather than \s, so the browser and the PocketBase
 * JSVM agree character for character. A rule's legal text ends in "." and is
 * joined with spaces, so any whitespace bounds it; the header does not end a
 * sentence and is always written on its own line, so only a line break bounds
 * it. Must stay identical to CANONICAL_DISCLOSURE_BOUNDARY and
 * CANONICAL_DISCLOSURE_HEADER_BOUNDARY in pb_hooks/requestPolicies.js.
 */
const CANONICAL_DISCLOSURE_BOUNDARY = " \t\n\r\f\v";
const CANONICAL_DISCLOSURE_HEADER_BOUNDARY = "\n\r";

/**
 * What each stripped piece of canonical material becomes: a line break, never
 * nothing. The legal copy ends in "." and a reader sees it as a sentence of its
 * own; removing it outright fused the text on either side into one word and
 * erased the sentence break before a name, so the guard missed names a reader
 * sees. Must stay identical to CANONICAL_DISCLOSURE_REPLACEMENT in
 * pb_hooks/requestPolicies.js.
 */
const CANONICAL_DISCLOSURE_REPLACEMENT = "\n";

const isCanonicalDisclosureBoundary = (
  source: string,
  index: number,
  boundary: string,
): boolean =>
  index < 0 || index >= source.length || boundary.indexOf(source.charAt(index)) !== -1;

/**
 * The first occurrence of `item` at or after `from` that is bounded on both
 * sides (see CANONICAL_DISCLOSURE_BOUNDARY). Material glued to other text is
 * not canonical there and stays in for review.
 */
const nextBoundedCanonicalMaterial = (
  source: string,
  item: string,
  from: number,
): number => {
  const boundary =
    item === CANONICAL_DISCLOSURE_HEADER
      ? CANONICAL_DISCLOSURE_HEADER_BOUNDARY
      : CANONICAL_DISCLOSURE_BOUNDARY;
  let at = source.indexOf(item, from);
  while (at !== -1) {
    if (
      isCanonicalDisclosureBoundary(source, at - 1, boundary) &&
      isCanonicalDisclosureBoundary(source, at + item.length, boundary)
    ) {
      return at;
    }
    at = source.indexOf(item, at + 1);
  }
  return -1;
};

/**
 * Replace canonical disclosure material before text reaches the customer-name
 * guard, which otherwise reads capitalised legal words ("Taxes", "Lessee",
 * "Disclosures") as names. The same rule as stripCanonicalDisclosures() in
 * pb_hooks/requestPolicies.js: one left-to-right pass; only exact material
 * bounded on both sides (whitespace for rule text, a line break for the
 * header, or the ends of the text) is taken out, and each piece becomes a line
 * break. Anything that is not exactly canonical — a name
 * planted beside real disclosures, an edited sentence, legal copy glued to
 * other text — stays in the text and is still reviewed.
 */
export const stripCanonicalDisclosures = (text: string | null | undefined): string => {
  const source = text ?? "";
  const material = canonicalDisclosureMaterial();
  const freeText: string[] = [];
  let cursor = 0;
  for (;;) {
    let foundAt = -1;
    let foundLength = 0;
    for (const item of material) {
      const at = nextBoundedCanonicalMaterial(source, item, cursor);
      if (at === -1) continue;
      if (
        foundAt === -1 ||
        at < foundAt ||
        (at === foundAt && item.length > foundLength)
      ) {
        foundAt = at;
        foundLength = item.length;
      }
    }
    if (foundAt === -1) break;
    freeText.push(source.slice(cursor, foundAt));
    cursor = foundAt + foundLength;
  }
  freeText.push(source.slice(cursor));
  return freeText.join(CANONICAL_DISCLOSURE_REPLACEMENT);
};

export type DealerBannedPhrases = string | string[] | null | undefined;

const parseDealerBannedPhrases = (value: DealerBannedPhrases): string[] => {
  const phrases = Array.isArray(value) ? value : (value ?? "").split(/[\n,]+/);
  return Array.from(new Set(phrases.map((phrase) => phrase.trim()).filter(Boolean)));
};

const normalizePhrase = (value: string): string =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, " ")
    .trim();

const detectDealerBannedPhrases = (
  text: string,
  bannedPhrases: DealerBannedPhrases,
): DisclosureMatch[] => {
  const normalizedText = ` ${normalizePhrase(text)} `;
  return parseDealerBannedPhrases(bannedPhrases)
    .filter((phrase) => {
      const normalizedPhrase = normalizePhrase(phrase);
      return (
        normalizedPhrase.length > 0 && normalizedText.includes(` ${normalizedPhrase} `)
      );
    })
    .map((phrase) => ({
      category: "dealer_banned_phrase" as const,
      triggerPhrase: phrase,
      disclosure: "",
      prohibited: true,
    }));
};

export const detectDisclosures = (
  text: string,
  bannedPhrases?: DealerBannedPhrases,
): DisclosureMatch[] => {
  const matches: DisclosureMatch[] = [];
  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      const m = text.match(pattern);
      if (m) {
        matches.push({
          category: rule.category,
          triggerPhrase: m[0],
          disclosure: rule.disclosure,
          prohibited: rule.prohibited,
        });
        break; // one match per rule is enough
      }
    }
  }
  return [...matches, ...detectDealerBannedPhrases(text, bannedPhrases)];
};

const formatDisclosureFooter = (matches: DisclosureMatch[]): string => {
  const usable = matches.filter((m) => !m.prohibited && m.disclosure);
  if (usable.length === 0) return "";
  const byCategory = new Map(usable.map((match) => [match.category, match]));
  const ordered = RULES.map((rule) => byCategory.get(rule.category)?.disclosure).filter(
    (disclosure): disclosure is string => Boolean(disclosure),
  );
  return `\n\n— Disclosures —\n${ordered.join(" ")}`;
};

const canonicalDisclosureCategories = (
  matches: DisclosureMatch[],
): DisclosureCategory[] => {
  const present = new Set(
    matches.filter((match) => !match.prohibited).map((match) => match.category),
  );
  return RULES.map((rule) => rule.category).filter((category) => present.has(category));
};

export interface ComplianceResult {
  /** Original text + appended disclosure block (if any). */
  text: string;
  /** Matches found, useful for showing warnings in the UI. */
  matches: DisclosureMatch[];
  /** Prohibited phrases the dealer must remove. */
  prohibited: DisclosureMatch[];
  /** True if anything was added or flagged. */
  changed: boolean;
}

export interface DeliveryCaption {
  caption: string;
  disclosures: string;
  disclosureCategories: DisclosureCategory[];
  compliance: ComplianceResult;
}

export interface CaptionSetDeliveryAnalysis {
  disclosures: string;
  disclosureCategories: DisclosureCategory[];
  matches: DisclosureMatch[];
  prohibited: DisclosureMatch[];
}

export const prohibitedClaimsMessage = (prohibited: DisclosureMatch[]): string => {
  const phrases = Array.from(
    new Set(prohibited.map((match) => match.triggerPhrase.trim())),
  );
  const dealerConfigured = prohibited.some(
    (match) => match.category === "dealer_banned_phrase",
  );
  const legalClaim = prohibited.some((match) => match.category === "prohibited_phrase");
  const reason =
    dealerConfigured && legalClaim
      ? "These claims are prohibited or blocked by this dealership and cannot be published."
      : dealerConfigured
        ? "This dealership has blocked this wording, so it cannot be published."
        : "Claims such as guaranteed approval or no credit check cannot be published.";
  return `Remove prohibited advertising claim${phrases.length === 1 ? "" : "s"}: ${phrases.map((phrase) => `“${phrase}”`).join(", ")}. ${reason}`;
};

/**
 * Scans the text and returns the text with the disclosure footer appended.
 * Existing disclosure text is never trusted as proof of compliance. Strip it,
 * rescan the editable caption, and rebuild the canonical footer. This keeps the
 * transform idempotent without letting an empty marker suppress disclosures.
 */
export const applyDisclosures = (
  text: string,
  bannedPhrases?: DealerBannedPhrases,
): ComplianceResult => {
  if (!text) {
    return { text: "", matches: [], prohibited: [], changed: false };
  }
  const markerIndex = text.indexOf("— Disclosures —");
  const caption = markerIndex >= 0 ? text.slice(0, markerIndex).trimEnd() : text;
  const matches = detectDisclosures(caption, bannedPhrases);
  const prohibited = matches.filter((m) => m.prohibited);
  const footer = formatDisclosureFooter(matches);
  const newText = footer ? caption + footer : caption;
  return {
    text: newText,
    matches,
    prohibited,
    changed: newText !== text || prohibited.length > 0,
  };
};

/** Split a scanned caption into editable copy plus its locked footer. */
export const analyzeCaptionForDelivery = (
  text: string,
  bannedPhrases?: DealerBannedPhrases,
  brandKit?: DealerBrandKit | null,
  deliveryLanguageAllowed = true,
): DeliveryCaption => {
  // Clean model junk first, then brand kit (footer + required tags), then compliance.
  const cleaned = cleanSocialCaption(text ?? "");
  const withBrand = applyDealerBrandKit(cleaned, brandKit, deliveryLanguageAllowed);
  const normalized = normalizeCaptionHashtags(withBrand);
  const compliance = applyDisclosures(normalized, bannedPhrases);
  const markerIndex = compliance.text.indexOf("— Disclosures —");
  const caption =
    markerIndex >= 0
      ? compliance.text.slice(0, markerIndex).trimEnd()
      : compliance.text.trimEnd();
  const disclosures = markerIndex >= 0 ? compliance.text.slice(markerIndex).trim() : "";
  return {
    caption,
    disclosures,
    disclosureCategories: canonicalDisclosureCategories(compliance.matches),
    compliance,
  };
};

/**
 * Rebuild the authoritative disclosure footer across a primary caption and
 * every destination variant. A platform-specific offer must never disappear
 * merely because the primary caption did not contain the same trigger.
 */
export const analyzeCaptionSetForDelivery = (
  captions: Array<string | null | undefined>,
  bannedPhrases?: DealerBannedPhrases,
): CaptionSetDeliveryAnalysis => {
  const matches = captions
    .filter((caption): caption is string => Boolean(caption?.trim()))
    .flatMap(
      (caption) => analyzeCaptionForDelivery(caption, bannedPhrases).compliance.matches,
    );
  const prohibited = matches.filter((match) => match.prohibited);
  return {
    disclosures: formatDisclosureFooter(matches).trim(),
    disclosureCategories: canonicalDisclosureCategories(matches),
    matches,
    prohibited,
  };
};

/**
 * Prepare copy for a delivery path and fail closed on legally prohibited
 * claims. Callers surface the thrown message without replacing known-good
 * creative.
 */
export const prepareCaptionForDelivery = (
  text: string,
  bannedPhrases?: DealerBannedPhrases,
  brandKit?: DealerBrandKit | null,
  deliveryLanguageAllowed = true,
): DeliveryCaption => {
  const result = analyzeCaptionForDelivery(
    text,
    bannedPhrases,
    brandKit,
    deliveryLanguageAllowed,
  );
  if (result.compliance.prohibited.length > 0) {
    throw new Error(prohibitedClaimsMessage(result.compliance.prohibited));
  }
  return result;
};

/**
 * FTC 16 CFR 255 (Endorsement Guides) material-connection disclosure.
 *
 * A salesperson posting about their own employer's inventory has a material
 * connection to the dealership. The Guides require that connection to be
 * disclosed clearly and conspicuously *in the post itself*, which is why this
 * line is prepended to the caption body rather than appended to the small-print
 * footer: the footer can be truncated by a destination's character budget, and
 * on several networks it falls below the "see more" fold.
 *
 * `{dealer}` is substituted case-insensitively so a dealer can write their own
 * wording without learning a template syntax.
 */
export const DEFAULT_EMPLOYEE_DISCLOSURE_TEMPLATE = "Posted by a {dealer} team member.";

export interface EmployeeDisclosureDealer {
  name?: string;
  employee_disclosure_text?: string;
  /** Opt-out. Unset/false keeps the disclosure on. */
  employee_disclosure_disabled?: boolean;
}

/**
 * The disclosure line for a dealership, or "" when the dealer has opted out.
 * An empty dealership name falls back to "our dealership" so the sentence
 * still reads as a disclosure rather than a broken template.
 */
export const buildEmployeeDisclosure = (
  dealer: EmployeeDisclosureDealer | null | undefined,
): string => {
  if (!dealer || dealer.employee_disclosure_disabled === true) return "";
  const template =
    (dealer.employee_disclosure_text || "").trim() ||
    DEFAULT_EMPLOYEE_DISCLOSURE_TEMPLATE;
  const dealerName = (dealer.name || "").trim() || "our dealership";
  return template.replace(/\{dealer\}/gi, dealerName).trim();
};

/**
 * Prepend the disclosure to a caption body, idempotently: a caption that
 * already opens with the line is returned unchanged, so re-running delivery
 * preparation (regenerate, edit, per-destination recompose) never stacks it.
 */
export const prependEmployeeDisclosure = (
  caption: string,
  dealer: EmployeeDisclosureDealer | null | undefined,
): string => {
  const disclosure = buildEmployeeDisclosure(dealer);
  const body = caption.trim();
  if (!disclosure) return body;
  if (captionIncludesEmployeeDisclosure(body, disclosure)) return body;
  return body ? `${disclosure}\n\n${body}` : disclosure;
};

/**
 * True when the caption already carries the disclosure. Compared on collapsed
 * whitespace and case so a hand-edited caption is not double-stamped.
 */
export const captionIncludesEmployeeDisclosure = (
  caption: string,
  disclosure: string,
): boolean => {
  const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
  const needle = normalize(disclosure);
  if (!needle) return false;
  return normalize(caption).startsWith(needle);
};
