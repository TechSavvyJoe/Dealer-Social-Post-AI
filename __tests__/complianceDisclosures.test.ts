import { describe, expect, it } from "vitest";
import {
  analyzeCaptionForDelivery,
  prepareCaptionForDelivery,
} from "../utils/complianceDisclosures";

describe("delivery compliance", () => {
  it("attaches required financing disclosures to the delivered caption", () => {
    const result = prepareCaptionForDelivery(
      "Drive home today with 4.9% APR on approved credit.",
    );

    expect(result.caption).toContain("4.9% APR");
    expect(result.disclosures).toContain(
      "Financing subject to credit approval",
    );
    expect(result.disclosureCategories).toContain("financing_apr");
  });

  it("rebuilds an empty or forged disclosure marker instead of trusting it", () => {
    const result = prepareCaptionForDelivery(
      "Drive home with 4.9% APR.\n\n— Disclosures —",
    );

    expect(result.disclosures).toContain(
      "Financing subject to credit approval",
    );
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
      prepareCaptionForDelivery("A refined carpeted interior.", "car")
        .compliance.prohibited,
    ).toHaveLength(0);
  });
});
