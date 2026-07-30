import { describe, expect, it } from "vitest";
import {
  analyzeCaptionForDelivery,
  analyzeCaptionSetForDelivery,
  prepareCaptionForDelivery,
} from "../utils/complianceDisclosures";

describe("delivery compliance", () => {
  it("attaches required financing disclosures to the delivered caption", () => {
    const result = prepareCaptionForDelivery(
      "Drive home today with 4.9% APR on approved credit.",
    );

    expect(result.caption).toContain("4.9% APR");
    expect(result.disclosures).toContain("Financing subject to credit approval");
    expect(result.disclosureCategories).toContain("financing_apr");
  });

  it("rebuilds an empty or forged disclosure marker instead of trusting it", () => {
    const result = prepareCaptionForDelivery(
      "Drive home with 4.9% APR.\n\n— Disclosures —",
    );

    expect(result.disclosures).toContain("Financing subject to credit approval");
    expect(result.caption).toBe("Drive home with 4.9% APR.");
  });

  it("fails closed on prohibited credit claims", () => {
    expect(() =>
      prepareCaptionForDelivery("Everyone approved. No credit check."),
    ).toThrow(/Remove prohibited advertising claims?/i);
  });

  it("enforces dealer phrases with normalized, case-insensitive matching", () => {
    const analysis = analyzeCaptionForDelivery(
      "Our BIGGEST—SALE is live now.",
      "biggest sale, lowest price",
    );

    expect(analysis.compliance.prohibited).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "dealer_banned_phrase",
          triggerPhrase: "biggest sale",
        }),
      ]),
    );
    expect(() =>
      prepareCaptionForDelivery(
        "Our BIGGEST—SALE is live now.",
        "biggest sale, lowest price",
      ),
    ).toThrow(/dealership has blocked/i);
  });

  it("does not match a configured word inside an unrelated longer word", () => {
    expect(
      prepareCaptionForDelivery("A refined carpeted interior.", "car").compliance
        .prohibited,
    ).toHaveLength(0);
  });

  it("retains disclosures triggered only by a destination-specific caption", () => {
    const result = analyzeCaptionSetForDelivery([
      "Congratulations on your new vehicle!",
      "Lease for $299/mo with approved credit.",
    ]);

    expect(result.disclosures).toContain("— Disclosures —");
    expect(result.disclosures).toContain("Lease offer with approved credit");
    expect(result.disclosureCategories).toContain("lease");
  });

  it("uses canonical rule order regardless of which destination triggers first", () => {
    const result = analyzeCaptionSetForDelivery([
      "Lease for $299/mo with approved credit.",
      "Qualified buyers can ask about 4.9% APR.",
    ]);

    expect(result.disclosureCategories).toEqual(["financing_apr", "lease"]);
    expect(
      result.disclosures.indexOf("Financing subject to credit approval"),
    ).toBeLessThan(result.disclosures.indexOf("Lease offer with approved credit"));
  });
});
