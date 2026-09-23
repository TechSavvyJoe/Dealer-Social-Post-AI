import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PLATFORM_LIMITS, evaluate } from "../utils/platformLimits";
import { fitPublishCaptionToBudget } from "../services/publishTargets";
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

  it("does not append a vehicle-shopping CTA to a short Recall Completion caption when deliveryLanguageAllowed is false", () => {
    // A Recall Completion involves a real customer but no vehicle
    // purchase/delivery — the fourth parameter must reach the body-length
    // floor filler in utils/brandKit.ts, not just gate the identity check.
    const result = prepareCaptionForDelivery(
      "Sarah's recall was completed today. Thanks for trusting our service team!",
      undefined,
      { name: "Bob Maxey Ford of Howell" },
      false,
    );
    expect(result.caption).not.toMatch(/behind the wheel|find the ride|delivery day/i);
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

/**
 * The character meter on the result screen has to measure the string that
 * actually reaches the destination, and the phone preview has to show it.
 *
 * Both were fed body + compliance footer and nothing else, while every
 * delivery path prepends the team-member disclosure as a protected prefix. For
 * a typical dealership name that is about 45 characters, or 16% of X's budget:
 * the meter said a caption fit, the destination truncated it, and the
 * salesperson found out from the published post.
 */
describe("the meter measures what is actually delivered", () => {
  const dealer = { name: "Bob Maxey Ford of Howell" };
  const disclosure = buildEmployeeDisclosure(dealer);
  const x = PLATFORM_LIMITS.find((limit) => limit.id === "x")!;

  it("counts a caption as over budget once the disclosure is included", () => {
    // Comfortably inside 280 on its own, over it once the prefix is added.
    const body = "A".repeat(x.maxChars - 20);

    expect(evaluate(body, x).state).toBe("ok");
    expect(evaluate(prependEmployeeDisclosure(body, dealer), x).state).toBe("over");
  });

  it("and the destination really does truncate it, so the old count was a lie", () => {
    const body = "A".repeat(x.maxChars - 20);
    const delivered = fitPublishCaptionToBudget(
      { text: body, requiredPrefix: disclosure },
      x.maxChars,
    );

    expect(delivered.startsWith(disclosure)).toBe(true);
    expect(delivered.length).toBeLessThanOrEqual(x.maxChars);
    // The body lost characters to make room. Measuring the body alone would
    // have reported "ok" for a caption that arrives cut short.
    expect(delivered).not.toContain(body);
  });

  it("does not double-count a disclosure the salesperson typed themselves", () => {
    const body = `${disclosure}\n\nCome see this one today.`;
    expect(prependEmployeeDisclosure(body, dealer)).toBe(body);
  });

  it("keeps the result screen wired to the delivered string, not the body", () => {
    // A source guard, because the defect was a prop pointing one variable to
    // the left. Both consumers claim to show or measure what gets posted.
    // `deliveredCaption`'s computation moved into
    // services/deliveryCaptions.ts's deliveredCaptionFor; the prop wiring
    // below stays pinned in components/PostResult.tsx.
    const source = readFileSync(
      resolve(process.cwd(), "components/PostResult.tsx"),
      "utf8",
    );
    expect(source).toContain("text={deliveredCaption}");
    expect(source).toContain("caption={deliveredCaption}");
    expect(source).toMatch(
      /const deliveredCaption = deliveredCaptionFor\(\s*editedText,\s*activeDisclosures,\s*currentDealer,?\s*\)/,
    );
    const deliveryCaptionsSource = readFileSync(
      resolve(process.cwd(), "services/deliveryCaptions.ts"),
      "utf8",
    );
    expect(deliveryCaptionsSource).toMatch(
      /export const deliveredCaptionFor = \([\s\S]*?prependEmployeeDisclosure\(appendDisclosureText\(editedText, disclosures\), dealer\)/,
    );
  });

  it("the delivered-string guard actually fails on a body-only wiring (planted mutant)", () => {
    const source = readFileSync(
      resolve(process.cwd(), "components/PostResult.tsx"),
      "utf8",
    );
    const mutated = source.replace("text={deliveredCaption}", "text={editedText}");
    expect(mutated).not.toContain("text={deliveredCaption}");
  });
});

/**
 * A destination-specific caption that already carries the disclosure, combined
 * with `requiredPrefix` for the same disclosure, must never publish it twice.
 *
 * The share flow builds one caption per destination
 * (services/deliveryCaptions.ts's buildShareCaptions) and separately threads
 * `requiredPrefix` through
 * every PublishContent so the fitter can protect it from truncation. Those
 * two channels briefly disagreed: the per-destination caption had the
 * disclosure baked in AND `requiredPrefix` carried it too, so
 * fitPublishCaptionToBudget added it a second time — corrupting the
 * published post and silently truncating real caption content to make room
 * for the duplicate.
 */
describe("a caption and requiredPrefix never publish the disclosure twice", () => {
  const dealer = { name: "Bob Maxey Ford" };
  const disclosure = buildEmployeeDisclosure(dealer);

  it("does not double the disclosure when the caption text already carries it", () => {
    const body = "Brand-new 2026 F-150 XLT just rolled onto the lot. ".repeat(4);
    // This is the exact shape a regressed caller would produce: a
    // destination caption built with the disclosure already prepended,
    // handed to the fitter alongside requiredPrefix for the same disclosure.
    const textAlreadyPrefixed = prependEmployeeDisclosure(body, dealer);
    const fitted = fitPublishCaptionToBudget(
      { text: textAlreadyPrefixed, requiredPrefix: disclosure },
      280,
    );
    expect(fitted.split(disclosure).length - 1).toBe(1);
    expect(fitted.length).toBeLessThanOrEqual(280);
  });

  it("still adds the disclosure exactly once for the correct body-only shape", () => {
    const body = "Brand-new 2026 F-150 XLT just rolled onto the lot.";
    const fitted = fitPublishCaptionToBudget(
      { text: body, requiredPrefix: disclosure },
      280,
    );
    expect(fitted.split(disclosure).length - 1).toBe(1);
    expect(fitted).toContain(body);
  });

  it("keeps services/deliveryCaptions.ts's share-caption pack body-only", () => {
    // A source guard for the actual regression site: buildShareCaptions
    // (moved out of components/PostResult.tsx's former sharePlatformCaptions
    // memo) must store the pre-prepend caption, not the disclosure-prepended
    // one, because requiredPrefix is the single channel every downstream
    // consumer (ShareDialog's contentForTarget, the fitter) already relies
    // on.
    const source = readFileSync(
      resolve(process.cwd(), "services/deliveryCaptions.ts"),
      "utf8",
    );
    const fnStart = source.indexOf("export const buildShareCaptions");
    const fnEnd = source.indexOf("export interface BuildCopyTextInput", fnStart);
    const fn = source.slice(fnStart, fnEnd);
    expect(fn).toContain("text: scanned.caption");
    expect(fn).not.toContain("text: prepared.caption");
  });

  it("the body-only guard actually fails on the regressed shape (planted mutant)", () => {
    // Proves the guard above is load-bearing rather than vacuous: swapping
    // the real source's `text: scanned.caption` for the regressed
    // `text: prepared.caption` must flip both assertions.
    const source = readFileSync(
      resolve(process.cwd(), "services/deliveryCaptions.ts"),
      "utf8",
    );
    const fnStart = source.indexOf("export const buildShareCaptions");
    const fnEnd = source.indexOf("export interface BuildCopyTextInput", fnStart);
    const fn = source.slice(fnStart, fnEnd);
    const mutated = fn.replace("text: scanned.caption", "text: prepared.caption");
    expect(mutated).not.toContain("text: scanned.caption");
    expect(mutated).toContain("text: prepared.caption");
  });
});
