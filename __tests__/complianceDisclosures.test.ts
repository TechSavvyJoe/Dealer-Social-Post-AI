import { describe, expect, it } from "vitest";
import {
  DEFAULT_EMPLOYEE_DISCLOSURE_TEMPLATE,
  analyzeCaptionForDelivery,
  analyzeCaptionSetForDelivery,
  buildEmployeeDisclosure,
  prepareCaptionForDelivery,
  prependEmployeeDisclosure,
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

describe("FTC 16 CFR 255 team-member disclosure", () => {
  const dealer = { name: "Bob Maxey Ford" };

  it("uses the default template and substitutes the dealership name", () => {
    expect(buildEmployeeDisclosure(dealer)).toBe(
      "Posted by a Bob Maxey Ford team member.",
    );
    expect(DEFAULT_EMPLOYEE_DISCLOSURE_TEMPLATE).toContain("{dealer}");
  });

  it("is ON for a dealership that predates the setting", () => {
    // PocketBase reports an unset bool as false. The field is an opt-OUT, so an
    // untouched dealership must still get the disclosure; an `enabled` flag
    // would have silently switched it off for every existing store.
    expect(buildEmployeeDisclosure({ name: "Lakeside Chevrolet" })).toBe(
      "Posted by a Lakeside Chevrolet team member.",
    );
    expect(
      buildEmployeeDisclosure({
        name: "Lakeside Chevrolet",
        employee_disclosure_disabled: false,
      }),
    ).toBe("Posted by a Lakeside Chevrolet team member.");
  });

  it("returns nothing only when the dealership explicitly opts out", () => {
    expect(
      buildEmployeeDisclosure({ ...dealer, employee_disclosure_disabled: true }),
    ).toBe("");
    expect(buildEmployeeDisclosure(null)).toBe("");
    expect(buildEmployeeDisclosure(undefined)).toBe("");
  });

  it("honors a custom template and substitutes {dealer} case-insensitively", () => {
    expect(
      buildEmployeeDisclosure({
        ...dealer,
        employee_disclosure_text: "I work at {DEALER}. #ad",
      }),
    ).toBe("I work at Bob Maxey Ford. #ad");
  });

  it("falls back to a readable phrase when the dealership has no name", () => {
    expect(buildEmployeeDisclosure({ name: "   " })).toBe(
      "Posted by a our dealership team member.",
    );
  });

  it("leads the caption rather than trailing it", () => {
    const caption = prependEmployeeDisclosure("Congrats on the new truck!", dealer);
    expect(caption.startsWith("Posted by a Bob Maxey Ford team member.")).toBe(true);
    expect(caption).toContain("Congrats on the new truck!");
  });

  it("never stacks on repeated delivery preparation", () => {
    const once = prependEmployeeDisclosure("Congrats!", dealer);
    const twice = prependEmployeeDisclosure(once, dealer);
    const thrice = prependEmployeeDisclosure(twice, dealer);
    expect(thrice).toBe(once);
    expect(thrice.match(/team member/g)).toHaveLength(1);
  });

  it("treats a hand-edited disclosure line as already present", () => {
    const edited = "posted by a  BOB MAXEY FORD   team member.\n\nCongrats!";
    expect(prependEmployeeDisclosure(edited, dealer)).toBe(edited.trim());
  });

  it("leaves the caption untouched when the dealership opted out", () => {
    expect(
      prependEmployeeDisclosure("Congrats!", {
        ...dealer,
        employee_disclosure_disabled: true,
      }),
    ).toBe("Congrats!");
  });
});

describe("the disclosure survives the caption sanitizer", () => {
  /**
   * analyzeCaptionForDelivery runs cleanSocialCaption, whose assistant-preamble
   * heuristic (utils/captionQuality.ts:34) deletes an entire first line
   * beginning "here's", "sure", "certainly", "of course", "i have", "i've" or
   * "as an ai". That is exactly how a compliance officer words a
   * material-connection line, so prepending the disclosure BEFORE the scan
   * silently deleted it for four of five realistic wordings — including
   * "I have a paid position at {dealer}.", the most FTC-appropriate one.
   *
   * The fix is ordering: scan the body, then prepend. These cases pin it.
   */
  const SWALLOWED_BY_THE_SANITIZER = [
    "I have a paid position at {dealer}.",
    "I've worked at {dealer} for 12 years.",
    "Here's a post from a {dealer} team member.",
    "Sure, I work at {dealer}.",
    "Certainly — a {dealer} team member posted this.",
    "Of course, I work at {dealer}.",
  ];

  it.each(SWALLOWED_BY_THE_SANITIZER)(
    "keeps a disclosure worded %j",
    (employee_disclosure_text) => {
      const dealer = { name: "Bob Maxey Ford", employee_disclosure_text };
      const disclosure = buildEmployeeDisclosure(dealer);
      expect(disclosure).not.toBe("");

      // The order the delivery paths now use: sanitize the body, then prepend.
      const scanned = analyzeCaptionForDelivery("Great truck, come see it today!");
      const delivered = prependEmployeeDisclosure(scanned.caption, dealer);

      expect(delivered.startsWith(disclosure)).toBe(true);
    },
  );

  it("demonstrates why the order matters, so nobody reverts it", () => {
    const dealer = {
      name: "Bob Maxey Ford",
      employee_disclosure_text: "I have a paid position at {dealer}.",
    };
    const disclosure = buildEmployeeDisclosure(dealer);

    // Prepending first: the sanitizer eats the whole first line.
    const wrongOrder = analyzeCaptionForDelivery(
      prependEmployeeDisclosure("Great truck, come see it today!", dealer),
    ).caption;
    expect(wrongOrder).not.toContain(disclosure);

    // Prepending after: it survives.
    const rightOrder = prependEmployeeDisclosure(
      analyzeCaptionForDelivery("Great truck, come see it today!").caption,
      dealer,
    );
    expect(rightOrder).toContain(disclosure);
  });
});
