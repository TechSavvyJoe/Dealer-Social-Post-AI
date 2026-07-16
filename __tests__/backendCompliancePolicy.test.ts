import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { prepareCaptionForDelivery } from "../utils/complianceDisclosures";

type ComplianceResult = {
  ok: boolean;
  error: string;
  categories: string[];
  required_disclosures: string;
  legal_prohibited: boolean;
  dealer_blocked_phrases: string[];
};

type Policies = {
  canonicalPostCompliance(
    caption: string,
    bannedPhrases?: string,
  ): ComplianceResult;
  validatePostCompliance(
    caption: string,
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
    expect(policies.validatePostCompliance(caption, clientCanonical).ok).toBe(
      true,
    );
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
      policies.validatePostCompliance("A refined carpeted interior.", "", "car")
        .ok,
    ).toBe(true);
  });

  it("enforces compliance both on queue creation and before approval", () => {
    const hook = readFileSync(
      resolve(process.cwd(), "pb_hooks/main.pb.js"),
      "utf8",
    );
    const firstValidation = hook.indexOf("policies.validatePostCompliance(");
    const secondValidation = hook.lastIndexOf(
      "policies.validatePostCompliance(",
    );
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
});
