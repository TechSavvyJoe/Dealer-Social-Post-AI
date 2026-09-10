import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyzeCaptionSetForDelivery,
  prepareCaptionForDelivery,
} from "../utils/complianceDisclosures";

type ComplianceResult = {
  ok: boolean;
  error: string;
  categories: string[];
  required_disclosures: string;
  legal_prohibited: boolean;
  dealer_blocked_phrases: string[];
};

type Policies = {
  canonicalPostCompliance(caption: string, bannedPhrases?: string): ComplianceResult;
  validatePostCompliance(
    caption: string,
    disclosures: string,
    bannedPhrases?: string,
  ): ComplianceResult;
  canonicalPostComplianceSet(
    captions: string[],
    bannedPhrases?: string,
  ): ComplianceResult;
  validatePostComplianceSet(
    captions: string[],
    disclosures: string,
    bannedPhrases?: string,
  ): ComplianceResult;
};

function loadPolicies(): Policies {
  const source = readFileSync(
    resolve(process.cwd(), "pb_hooks/requestPolicies.js"),
    "utf8",
  );
  const module = { exports: {} as Policies };
  new Function("module", "exports", source)(module, module.exports);
  return module.exports;
}

const policies = loadPolicies();

describe("PocketBase post compliance policy", () => {
  it.each([
    "Finance it with 4.9% APR on approved credit.",
    "Drive today with $0 down.",
    "Lease for $399/mo for 36 months.",
    "Save up to $5,000 this month.",
    "Ask about your trade-in value.",
  ])("matches the canonical delivery disclosure for %s", (caption) => {
    const clientCanonical = prepareCaptionForDelivery(caption).disclosures;
    const serverCanonical = policies.canonicalPostCompliance(caption);

    expect(serverCanonical.required_disclosures).toBe(clientCanonical);
    expect(policies.validatePostCompliance(caption, clientCanonical).ok).toBe(true);
  });

  it("rejects a disclosure marker without the exact required text", () => {
    const result = policies.validatePostCompliance(
      "Finance it with 4.9% APR.",
      "— Disclosures —",
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/exact canonical/i);
  });

  it("rejects missing, edited, extra, and caption-embedded disclosures", () => {
    const caption = "Finance it with 4.9% APR.";
    const canonical = policies.canonicalPostCompliance(caption);

    expect(policies.validatePostCompliance(caption, "").ok).toBe(false);
    expect(
      policies.validatePostCompliance(
        caption,
        canonical.required_disclosures.replace("qualified", "eligible"),
      ).ok,
    ).toBe(false);
    expect(
      policies.validatePostCompliance(
        "A straightforward vehicle spotlight.",
        "— Disclosures —\nUnrequested legal copy.",
      ).ok,
    ).toBe(false);
    expect(
      policies.validatePostCompliance(
        `${caption}\n\n${canonical.required_disclosures}`,
        canonical.required_disclosures,
      ).error,
    ).toMatch(/submitted separately/i);
  });

  it("blocks prohibited credit claims regardless of supplied disclosures", () => {
    const result = policies.validatePostCompliance(
      "Everyone approved — no credit check.",
      "",
    );
    expect(result.ok).toBe(false);
    expect(result.legal_prohibited).toBe(true);
    expect(result.error).toMatch(/prohibited advertising/i);
  });

  it("matches dealer phrases case-insensitively across punctuation", () => {
    const result = policies.validatePostCompliance(
      "Our BIGGEST—SALE is live now.",
      "",
      "biggest sale, lowest price",
    );
    expect(result.ok).toBe(false);
    expect(result.dealer_blocked_phrases).toEqual(["biggest sale"]);
    expect(result.error).toMatch(/blocked by this dealership/i);
  });

  it("does not match a blocked word inside an unrelated longer word", () => {
    expect(
      policies.validatePostCompliance("A refined carpeted interior.", "", "car").ok,
    ).toBe(true);
  });

  it("validates one canonical disclosure union across all destination captions", () => {
    const captions = [
      "Congratulations on your delivery!",
      "Lease for $299/mo with approved credit.",
    ];
    const clientCanonical = analyzeCaptionSetForDelivery(captions).disclosures;
    const serverCanonical = policies.canonicalPostComplianceSet(captions);

    expect(serverCanonical.required_disclosures).toBe(clientCanonical);
    expect(policies.validatePostComplianceSet(captions, clientCanonical).ok).toBe(true);
    expect(policies.validatePostComplianceSet(captions, "").error).toMatch(
      /exact canonical/i,
    );
  });

  it("keeps the client and server union identical when captions trigger rules out of order", () => {
    const captions = [
      "Lease for $299/mo with approved credit.",
      "Qualified buyers can ask about 4.9% APR.",
    ];
    const clientCanonical = analyzeCaptionSetForDelivery(captions);
    const serverCanonical = policies.canonicalPostComplianceSet(captions);

    expect(clientCanonical.disclosureCategories).toEqual(["financing_apr", "lease"]);
    expect(serverCanonical.categories).toEqual(["financing_apr", "lease"]);
    expect(clientCanonical.disclosures).toBe(serverCanonical.required_disclosures);
    expect(
      policies.validatePostComplianceSet(captions, clientCanonical.disclosures).ok,
    ).toBe(true);
  });

  it("enforces compliance both on queue creation and before approval", () => {
    const hook = readFileSync(resolve(process.cwd(), "pb_hooks/main.pb.js"), "utf8");
    const firstValidation = hook.indexOf("policies.validatePostComplianceSet(");
    const secondValidation = hook.lastIndexOf("policies.validatePostComplianceSet(");
    const postSubmit = hook.indexOf("form.submit();", firstValidation);
    const conditionalApproval = hook.indexOf(
      "\"AND approval_status = 'pending'\"",
      secondValidation,
    );

    expect(firstValidation).toBeGreaterThan(-1);
    expect(secondValidation).toBeGreaterThan(firstValidation);
    expect(firstValidation).toBeLessThan(postSubmit);
    expect(secondValidation).toBeLessThan(conditionalApproval);
    expect(hook).toContain('dealer.getString("banned_phrases")');
    expect(hook).toContain("return c.json(400, { error: compliance.error })");
    expect(hook).toContain("return c.json(409, { error: compliance.error })");
  });

  it("wires the team-member disclosure fields through the backend as an opt-out", () => {
    const helpers = readFileSync(resolve(process.cwd(), "pb_hooks/helpers.js"), "utf8");
    const migration = readFileSync(
      resolve(process.cwd(), "pb_migrations/1751900000_employee_disclosure.js"),
      "utf8",
    );

    // The column must be the opt-OUT spelling. PocketBase reports an unset bool
    // as false, so an `..._enabled` field would read false for every dealership
    // that existed before the deploy and turn the disclosure off for all of them.
    expect(migration).toContain("employee_disclosure_disabled");
    expect(migration).not.toContain("employee_disclosure_enabled");
    expect(helpers).not.toContain("employee_disclosure_enabled");

    // The migration must add fields the way PB 0.22 actually applies them.
    expect(migration).toContain("schema.getFieldByName(field.name)");
    expect(migration).toContain("collection.schema.addField(new SchemaField(field))");

    // And it must ROLL BACK for real. `schema = Array.from(schema).filter(...)`
    // reports "Applied" and leaves the column in place on 0.22 (verified
    // against 0.22.55 on a copy of production data); removeField takes the
    // field id. 22 older migrations still carry the broken idiom and are
    // tracked separately; every new one must use this API.
    expect(migration).toContain("dealers.schema.removeField(field.id)");
    // Match the assignment as it appears in code (collection-qualified), so the
    // migration's own comment naming the broken idiom does not trip this.
    expect(migration).not.toMatch(/\w+\.schema\s*=\s*Array\.from\(/);

    // Text limit, bool allowlist and serializer all carry the new fields.
    expect(helpers).toContain("employee_disclosure_text: 280");
    expect(helpers).toContain('"employee_disclosure_disabled",');
    expect(helpers).toContain(
      'employee_disclosure_text: record.getString("employee_disclosure_text")',
    );
    expect(helpers).toContain(
      'employee_disclosure_disabled: recordBool(record, "employee_disclosure_disabled")',
    );
  });

  it("keeps the team-member line out of the canonical Reg Z/M disclosure block", () => {
    // pb_hooks/requestPolicies.js requires posts.disclosures to equal the exact
    // canonical block, so the employee line has to live in the caption body.
    // A caption that leads with it must still validate.
    const prepared = prepareCaptionForDelivery(
      "Posted by a Bob Maxey Ford team member.\n\nDrive home today with 4.9% APR on approved credit.",
    );
    expect(prepared.caption.startsWith("Posted by a Bob Maxey Ford team member.")).toBe(
      true,
    );
    expect(prepared.disclosures).not.toContain("team member");
    expect(prepared.disclosures).toBeTruthy();
  });
});
