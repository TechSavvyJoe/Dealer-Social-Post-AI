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

export type DisclosureCategory =
  | "financing_apr"
  | "zero_down"
  | "lease"
  | "rebate_pricing"
  | "trade_value"
  | "prohibited_phrase";

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

// Order matters only for which trigger phrase shows up first in audit output;
// disclosures themselves are deduplicated by category.
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

export const detectDisclosures = (text: string): DisclosureMatch[] => {
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
  return matches;
};

const formatDisclosureFooter = (matches: DisclosureMatch[]): string => {
  const usable = matches.filter((m) => !m.prohibited && m.disclosure);
  if (usable.length === 0) return "";
  // Deduplicate by category in order of appearance
  const seen = new Set<DisclosureCategory>();
  const ordered: string[] = [];
  for (const m of usable) {
    if (seen.has(m.category)) continue;
    seen.add(m.category);
    ordered.push(m.disclosure);
  }
  return `\n\n— Disclosures —\n${ordered.join(" ")}`;
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

/**
 * Scans the text and returns the text with the disclosure footer appended.
 * If the text already contains "— Disclosures —" we assume it was processed
 * before and return unchanged (idempotent).
 */
export const applyDisclosures = (text: string): ComplianceResult => {
  if (!text) {
    return { text: "", matches: [], prohibited: [], changed: false };
  }
  if (text.includes("— Disclosures —")) {
    // Already has a disclosure block; treat as already compliant.
    const matches = detectDisclosures(text);
    return {
      text,
      matches,
      prohibited: matches.filter((m) => m.prohibited),
      changed: false,
    };
  }

  const matches = detectDisclosures(text);
  const prohibited = matches.filter((m) => m.prohibited);
  const footer = formatDisclosureFooter(matches);
  const newText = footer ? text + footer : text;
  return {
    text: newText,
    matches,
    prohibited,
    changed: footer.length > 0 || prohibited.length > 0,
  };
};
