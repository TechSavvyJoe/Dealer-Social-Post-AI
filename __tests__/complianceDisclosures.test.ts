import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PLATFORM_LIMITS, evaluate } from "../utils/platformLimits";
import { PUBLISH_TARGETS, fitPublishCaptionToBudget } from "../services/publishTargets";
import { buildShareCaptions } from "../services/deliveryCaptions";
import { outboundPreviewParts } from "../components/post/PostPreviewCard";
import type { Dealer } from "../types";
import {
  CANONICAL_DISCLOSURE_HEADER,
  DEFAULT_EMPLOYEE_DISCLOSURE_TEMPLATE,
  analyzeCaptionForDelivery,
  analyzeCaptionSetForDelivery,
  buildEmployeeDisclosure,
  canonicalDisclosureMaterial,
  prepareCaptionForDelivery,
  prependEmployeeDisclosure,
  stripCanonicalDisclosures,
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
 * Source pins for the live posting screen. Disclosure text never lives in the
 * editable caption; it reaches every outgoing caption only through this
 * wiring, and the preview has to show exactly what ships:
 *
 *   PostScreen.tsx      buildShareCaptions({ ..., bodyEditSupersedesPack: true })
 *                       -> selectedCaption -> shareContent { text, disclosures:
 *                       selectedCaption?.disclosures || captionSetAnalysis.disclosures,
 *                       requiredPrefix: employeeDisclosure || undefined }
 *                       -> usePostShare({ content: shareContent })
 *                       -> <PostPreviewCard outboundText employeeDisclosure disclosures />
 *   PostPreviewCard.tsx outboundPreviewParts(outboundText, employeeDisclosure, disclosures)
 *                       -> prefix, body, disclosures block
 *
 * `requiredPrefix` is the one channel the fitter (fitPublishCaptionToBudget)
 * uses to put the team-member disclosure first and protect it from
 * truncation, so dropping it removes the disclosure from every share.
 * `disclosures` is the one channel for the compliance block (financing, lease
 * terms): the selected caption's own scan first, and when that found none,
 * the scan of the whole caption set. That set starts with the caption on
 * screen, so the fallback can only add a disclosure, never lose one the
 * shipped text needs (decided 2026-10-06; this guard is the oracle).
 */
type WiringSources = {
  postScreen: string;
  previewCard: string;
  deliveryCaptions: string;
};

const WIRING_FILES: Record<keyof WiringSources, string> = {
  postScreen: "components/PostScreen.tsx",
  previewCard: "components/post/PostPreviewCard.tsx",
  deliveryCaptions: "services/deliveryCaptions.ts",
};

const readWiringSources = (): WiringSources => ({
  postScreen: readFileSync(resolve(process.cwd(), WIRING_FILES.postScreen), "utf8"),
  previewCard: readFileSync(resolve(process.cwd(), WIRING_FILES.previewCard), "utf8"),
  deliveryCaptions: readFileSync(
    resolve(process.cwd(), WIRING_FILES.deliveryCaptions),
    "utf8",
  ),
});

/**
 * The text from `start` through the first `end` after it, or "" when either is
 * missing, so each pin reads only the call or element it is about and never a
 * look-alike elsewhere in the file.
 */
const sliceAt = (source: string, from: number, start: string, end: string): string => {
  const to = source.indexOf(end, from + start.length);
  return to < 0 ? "" : source.slice(from, to + end.length);
};

const sliceFrom = (source: string, start: string, end: string): string => {
  const from = source.indexOf(start);
  return from < 0 ? "" : sliceAt(source, from, start, end);
};

/**
 * Every `start` ... `end` slice in the file, for calls and elements that can
 * appear more than once. Checking only the first one lets a second copy (a
 * phone/desktop split of the preview, a second share hook) wire the editable
 * body while the guard reads the first and stays green. There must be at
 * least one site, and every site must hold.
 */
const everySite = (
  source: string,
  start: string,
  end: string,
  holds: (site: string) => boolean,
): boolean => {
  const sites: string[] = [];
  for (
    let at = source.indexOf(start);
    at >= 0;
    at = source.indexOf(start, at + start.length)
  ) {
    sites.push(sliceAt(source, at, start, end));
  }
  return sites.length > 0 && sites.every(holds);
};

const shareContentMemo = (source: string) =>
  sliceFrom(source, "const shareContent = useMemo(", "}),");
const captionAnalysisMemo = (source: string) =>
  sliceFrom(source, "const captionAnalysis = useMemo(", "]");
const captionSetAnalysisMemo = (source: string) =>
  sliceFrom(source, "const captionSetAnalysis = useMemo(", "]");

const PIN = {
  oneCaption: "every channel ships from the one caption on screen",
  scannedText: "the shared text is the selected channel's scanned caption",
  requiredPrefix: "the team-member disclosure rides as the required prefix",
  disclosures: "the compliance disclosures ride with the shared text",
  delivered: "the share hook delivers that content",
  previewProps: "the preview is handed what ships",
  captionFit:
    "the preview fits the selected destination budget with protected disclosures",
  previewSplit: "the preview splits the outbound text",
  previewRender: "the preview renders every outbound part, in the order it ships",
  deliveredCaptionFor: "deliveredCaptionFor prepends after appending the disclosures",
} as const;

const DELIVERED_STRING_PINS: ReadonlyArray<{
  id: (typeof PIN)[keyof typeof PIN];
  file: keyof WiringSources;
  holds: (source: string) => boolean;
}> = [
  {
    // A per-channel AI variant the salesperson never saw must not ship.
    id: PIN.oneCaption,
    file: "postScreen",
    holds: (s) =>
      everySite(s, "buildShareCaptions({", "})", (call) =>
        /\bbodyEditSupersedesPack:\s*true\b/.test(call),
      ),
  },
  {
    // The compliance scan and attribution run in buildShareCaptions; the raw
    // editable body skips them. PostScreen gives every channel an entry, so
    // the fallback is reached only when buildShareCaptions has no text for
    // the selected channel, and it is the body run through
    // analyzeCaptionForDelivery, never the body itself. An emptied caption
    // shares nothing (Share then asks for a caption), never the brand-kit
    // filler that analyzeCaptionForDelivery writes for an empty body.
    id: PIN.scannedText,
    file: "postScreen",
    holds: (s) =>
      /const selectedCaption = shareCaptions\?\.\[selectedChannelId\];/.test(s) &&
      /\btext:\s*caption\.trim\(\)\s*\?\s*selectedCaption\?\.text\s*\|\|\s*captionAnalysis\.caption\s*:\s*""\s*,/.test(
        shareContentMemo(s),
      ) &&
      /^const captionAnalysis = useMemo\(\s*\(\)\s*=>\s*analyzeCaptionForDelivery\(\s*caption\s*,/.test(
        captionAnalysisMemo(s),
      ),
  },
  {
    id: PIN.requiredPrefix,
    file: "postScreen",
    holds: (s) =>
      /const employeeDisclosure = useMemo\(\s*\(\) => buildEmployeeDisclosure\(currentDealer\)/.test(
        s,
      ) &&
      /\brequiredPrefix:\s*employeeDisclosure\s*\|\|\s*undefined\s*,/.test(
        shareContentMemo(s),
      ),
  },
  {
    // The selected caption's own disclosures win; the fallback is the scan of
    // the caption set, which must include the caption on screen.
    id: PIN.disclosures,
    file: "postScreen",
    holds: (s) =>
      /\bdisclosures:\s*selectedCaption\?\.disclosures\s*\|\|\s*captionSetAnalysis\.disclosures\s*\|\|\s*undefined\s*,/.test(
        shareContentMemo(s),
      ) &&
      /^const captionSetAnalysis = useMemo\(\s*\(\)\s*=>\s*analyzeCaptionSetForDelivery\(\s*\[\s*caption\s*\]/.test(
        captionSetAnalysisMemo(s),
      ),
  },
  {
    id: PIN.delivered,
    file: "postScreen",
    holds: (s) =>
      everySite(s, "usePostShare({", "});", (call) =>
        /\bcontent:\s*shareContent\s*,/.test(call),
      ),
  },
  {
    id: PIN.previewProps,
    file: "postScreen",
    holds: (s) =>
      everySite(s, "<PostPreviewCard", "/>", (element) =>
        [
          "outboundText={previewOutboundText}",
          "employeeDisclosure={employeeDisclosure}",
          "disclosures={shareContent.disclosures}",
        ].every((prop) => element.includes(prop)),
      ),
  },
  {
    id: PIN.captionFit,
    file: "postScreen",
    holds: (s) =>
      /fitPublishCaptionToBudget\(\s*shareContent,/.test(s) &&
      /PUBLISH_TARGETS\.find\(\(target\) => target\.id === selectedChannelId\)\?\.charBudget/.test(
        s,
      ) &&
      /const preparedCaption = shareContent\.text\.trim\(\) \? fittedCaption : "";/.test(
        s,
      ) &&
      /const previewOutboundText =[\s\S]*?preparedCaption\.slice\(employeeDisclosure\.length\)\.trim\(\)[\s\S]*?: preparedCaption \|\| "";/.test(
        s,
      ),
  },
  {
    id: PIN.previewSplit,
    file: "previewCard",
    holds: (s) =>
      /const parts = outboundPreviewParts\(\s*outboundText,\s*employeeDisclosure,\s*disclosures,?\s*\)/.test(
        s,
      ),
  },
  {
    id: PIN.previewRender,
    file: "previewCard",
    holds: (s) => {
      const view = sliceFrom(s, 'data-testid="post-outbound-preview"', "</div>");
      const present = [
        /\{parts\.prefix\}/,
        /data-outbound-part="body"[^>]*>\s*\{parts\.body\}\s*<\/p>/,
        /\{parts\.disclosureBlock\}/,
      ].every((part) => part.test(view));
      // Same order as fitPublishCaptionToBudget: prefix, body, disclosures.
      const order = ["{parts.prefix}", "{parts.body}", "{parts.disclosureBlock}"].map(
        (part) => view.indexOf(part),
      );
      return present && order[0] < order[1] && order[1] < order[2];
    },
  },
  {
    // Body + compliance footer first, then the protected prefix in front.
    id: PIN.deliveredCaptionFor,
    file: "deliveryCaptions",
    holds: (s) =>
      /prependEmployeeDisclosure\(\s*appendDisclosureText\(\s*editedText,\s*disclosures\s*\),\s*dealer,?\s*\)/.test(
        sliceFrom(s, "export const deliveredCaptionFor = (", ";"),
      ),
  },
];

/**
 * The pins read code, not comments. A line switched off with `//` and left
 * beside its replacement still spells the old wiring, and a raw-text pin
 * would find it there and stay green. Same idiom as
 * backendCompliancePolicy.test.ts: `://` survives so a URL is not cut short.
 */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const deliveredStringWiringFaults = (sources: WiringSources): string[] =>
  DELIVERED_STRING_PINS.filter(
    (pin) => !pin.holds(withoutComments(sources[pin.file])),
  ).map((pin) => pin.id);

const DELIVERED_STRING_MUTANTS: ReadonlyArray<{
  regression: string;
  file: keyof WiringSources;
  from: string;
  to: string;
  fault: (typeof PIN)[keyof typeof PIN];
}> = [
  {
    regression: "drops the required prefix",
    file: "postScreen",
    from: "requiredPrefix: employeeDisclosure || undefined,",
    to: "",
    fault: PIN.requiredPrefix,
  },
  {
    regression: "drops the compliance disclosures",
    file: "postScreen",
    from: "disclosures:\n        selectedCaption?.disclosures || captionSetAnalysis.disclosures || undefined,",
    to: "",
    fault: PIN.disclosures,
  },
  {
    regression: "ships only the stale variants' disclosures",
    file: "postScreen",
    from: "selectedCaption?.disclosures || captionSetAnalysis.disclosures",
    to: "captionSetAnalysis.disclosures",
    fault: PIN.disclosures,
  },
  {
    regression: "falls back to a scan that leaves out the caption on screen",
    file: "postScreen",
    from: "[caption]",
    to: "[]",
    fault: PIN.disclosures,
  },
  {
    regression: "ships each channel's saved AI variant",
    file: "postScreen",
    from: "bodyEditSupersedesPack: true",
    to: "bodyEditSupersedesPack: false",
    fault: PIN.oneCaption,
  },
  {
    regression: "shares the raw editable body",
    file: "postScreen",
    from: 'text: caption.trim() ? selectedCaption?.text || captionAnalysis.caption : ""',
    to: "text: caption",
    fault: PIN.scannedText,
  },
  {
    // Reached when buildShareCaptions has no text for the selected channel.
    regression: "falls back to the raw editable body",
    file: "postScreen",
    from: "|| captionAnalysis.caption :",
    to: "|| caption :",
    fault: PIN.scannedText,
  },
  {
    // analyzeCaptionForDelivery("") writes brand-kit prose and hashtags, so
    // an emptied caption would ship filler with no page tag.
    regression: "shares brand-kit filler for an emptied caption",
    file: "postScreen",
    from: 'text: caption.trim() ? selectedCaption?.text || captionAnalysis.caption : "",',
    to: "text: selectedCaption?.text || captionAnalysis.caption,",
    fault: PIN.scannedText,
  },
  {
    regression: "keeps the fallback's name but stops scanning it",
    file: "postScreen",
    from: "const captionAnalysis = useMemo(",
    to: "const captionAnalysis = useMemo(() => ({ caption }), [caption]);\n  const scannedCaption = useMemo(",
    fault: PIN.scannedText,
  },
  {
    regression: "builds a second caption set that keeps each channel's AI variant",
    file: "postScreen",
    from: "const selectedCaption = shareCaptions?.[selectedChannelId];",
    to: "const variantCaptions = buildShareCaptions({ effectivePack, editedText: caption, bodyEditSupersedesPack: false });\n  const selectedCaption = shareCaptions?.[selectedChannelId];",
    fault: PIN.oneCaption,
  },
  {
    regression: "hands the share hook a prefix-less copy",
    file: "postScreen",
    from: "content: shareContent,",
    to: "content: { ...shareContent, requiredPrefix: undefined },",
    fault: PIN.delivered,
  },
  {
    // After the real call, so a first-site-only read would still pass.
    regression: "adds a second share hook that delivers the editable body",
    file: "postScreen",
    from: "const leaveGuard = usePostLeaveGuard({",
    to: "const bodyShare = usePostShare({ post, content: { text: caption } });\n  const leaveGuard = usePostLeaveGuard({",
    fault: PIN.delivered,
  },
  {
    regression: "previews the editable body",
    file: "postScreen",
    from: "outboundText={previewOutboundText}",
    to: "outboundText={caption}",
    fault: PIN.previewProps,
  },
  {
    // A phone/desktop split: the first element is untouched and the second
    // previews the body, so a first-site-only read would still pass.
    regression: "adds a second preview that shows the editable body",
    file: "postScreen",
    from: "onCaptionBlur={() => setEditingCaption(false)}",
    to: "onCaptionBlur={() => setEditingCaption(false)}\n          />\n          <PostPreviewCard\n            outboundText={caption}\n            employeeDisclosure={employeeDisclosure}\n            disclosures={shareContent.disclosures}",
    fault: PIN.previewProps,
  },
  {
    regression: "fits the preview without its required disclosures",
    file: "postScreen",
    from: "fitPublishCaptionToBudget(\n        shareContent,",
    to: "fitPublishCaptionToBudget(\n        { text: caption },",
    fault: PIN.captionFit,
  },
  {
    regression: "previews a caption before fitting the destination budget",
    file: "postScreen",
    from: 'const preparedCaption = shareContent.text.trim() ? fittedCaption : "";',
    to: 'const preparedCaption = shareContent.text.trim() ? shareContent.text : "";',
    fault: PIN.captionFit,
  },
  {
    regression: "splits the editable body inside the preview",
    file: "previewCard",
    from: "outboundPreviewParts(outboundText,",
    to: "outboundPreviewParts(caption,",
    fault: PIN.previewSplit,
  },
  {
    regression: "renders the editable body in the outbound view",
    file: "previewCard",
    from: "{parts.body}",
    to: "{caption}",
    fault: PIN.previewRender,
  },
  {
    regression: "prepends before appending the disclosures",
    file: "deliveryCaptions",
    from: "prependEmployeeDisclosure(appendDisclosureText(editedText, disclosures), dealer)",
    to: "appendDisclosureText(prependEmployeeDisclosure(editedText, dealer), disclosures)",
    fault: PIN.deliveredCaptionFor,
  },
];

/**
 * The same regressions made the way a line usually gets switched off in a
 * refactor: the old wiring stays behind as a comment beside its replacement.
 * Every row except the rendered-parts one (whose pin already needs the
 * expression right after the tag) went green before the pins read the source
 * with comments removed.
 */
const COMMENTED_OUT_MUTANTS: typeof DELIVERED_STRING_MUTANTS = [
  {
    regression: "comments out the required prefix",
    file: "postScreen",
    from: "requiredPrefix: employeeDisclosure || undefined,",
    to: "// requiredPrefix: employeeDisclosure || undefined,",
    fault: PIN.requiredPrefix,
  },
  {
    regression: "comments out the compliance disclosures",
    file: "postScreen",
    from: "disclosures:\n        selectedCaption?.disclosures || captionSetAnalysis.disclosures || undefined,",
    to: "// disclosures: selectedCaption?.disclosures || captionSetAnalysis.disclosures || undefined,",
    fault: PIN.disclosures,
  },
  {
    regression: "comments out the one-caption rule",
    file: "postScreen",
    from: "bodyEditSupersedesPack: true,",
    to: "// bodyEditSupersedesPack: true,",
    fault: PIN.oneCaption,
  },
  {
    regression: "comments out the scanned caption and shares the body",
    file: "postScreen",
    from: 'text: caption.trim() ? selectedCaption?.text || captionAnalysis.caption : "",',
    to: '// text: caption.trim() ? selectedCaption?.text || captionAnalysis.caption : "",\n      text: caption,',
    fault: PIN.scannedText,
  },
  {
    regression: "comments out the delivered content and hands over a copy",
    file: "postScreen",
    from: "content: shareContent,",
    to: "// content: shareContent,\n    content: { text: caption, imageDataUrl: post.image },",
    fault: PIN.delivered,
  },
  {
    regression: "comments out the outbound preview prop and previews the body",
    file: "postScreen",
    from: "outboundText={previewOutboundText}",
    to: "// outboundText={previewOutboundText}\n            outboundText={caption}",
    fault: PIN.previewProps,
  },
  {
    regression: "comments out the outbound split and splits the body",
    file: "previewCard",
    from: "const parts = outboundPreviewParts(outboundText, employeeDisclosure, disclosures);",
    to: '// const parts = outboundPreviewParts(outboundText, employeeDisclosure, disclosures);\n  const parts = outboundPreviewParts(caption, "", undefined);',
    fault: PIN.previewSplit,
  },
  {
    regression: "comments out the rendered body and renders the editable one",
    file: "previewCard",
    from: "{parts.body}",
    to: "{/* {parts.body} */}{caption}",
    fault: PIN.previewRender,
  },
  {
    regression: "comments out the delivered order and prepends first",
    file: "deliveryCaptions",
    from: "prependEmployeeDisclosure(appendDisclosureText(editedText, disclosures), dealer)",
    to: "// prependEmployeeDisclosure(appendDisclosureText(editedText, disclosures), dealer)\n  appendDisclosureText(prependEmployeeDisclosure(editedText, dealer), disclosures)",
    fault: PIN.deliveredCaptionFor,
  },
];

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

  it("keeps the post screen wired to the delivered string, not the body", () => {
    // A source guard, because the defect was a prop pointing one variable to
    // the left. The live screen is components/PostScreen.tsx with
    // components/post/PostPreviewCard.tsx (PostResult.tsx is no longer
    // mounted); see DELIVERED_STRING_PINS for what each pin protects.
    expect(deliveredStringWiringFaults(readWiringSources())).toEqual([]);
  });

  it.each([...DELIVERED_STRING_MUTANTS, ...COMMENTED_OUT_MUTANTS])(
    "the delivered-string guard fails when the wiring $regression (planted mutant)",
    ({ file, from, to, fault }) => {
      // Applies the regression to the real source in memory. The replaced
      // text must exist, so a refactor cannot turn this into a no-op that
      // "proves" nothing.
      const sources = readWiringSources();
      expect(sources[file], `${file} no longer contains ${from}`).toContain(from);
      const mutated = { ...sources, [file]: sources[file].split(from).join(to) };
      expect(mutated[file]).not.toBe(sources[file]);
      expect(deliveredStringWiringFaults(mutated)).toEqual([fault]);
    },
  );

  it("the delivered-string guard fails when the preview reorders the outbound parts (planted mutant)", () => {
    // Every part still renders, so only the order check can catch it: the
    // compliance block now shows first and the team-member disclosure last.
    const sources = readWiringSources();
    const view = sliceFrom(
      sources.previewCard,
      'data-testid="post-outbound-preview"',
      "</div>",
    );
    expect(view).toContain("{parts.prefix}");
    const swapped = view
      .split("{parts.prefix}")
      .join("\u0000")
      .split("{parts.disclosureBlock}")
      .join("{parts.prefix}")
      .split("\u0000")
      .join("{parts.disclosureBlock}");
    const mutated = {
      ...sources,
      previewCard: sources.previewCard.replace(view, swapped),
    };
    expect(mutated.previewCard).not.toBe(sources.previewCard);
    expect(deliveredStringWiringFaults(mutated)).toEqual([PIN.previewRender]);
  });
});

/**
 * The behavioural half of the guard above: for a real financing caption, the
 * parts the Post preview shows, joined the way the share joins them, are
 * exactly the string fitPublishCaptionToBudget delivers.
 */
describe("the Post preview matches what ships within the channel budget", () => {
  const dealer = {
    id: "dealer-1",
    name: "Bob Maxey Ford of Howell",
    facebook_page_tag: "BobMaxeyFordHowell",
  } as Dealer;
  const employeeDisclosure = buildEmployeeDisclosure(dealer);

  it("joins prefix, body and disclosure block into the delivered caption", () => {
    const captions = buildShareCaptions({
      effectivePack: { facebook_feed: "A saved AI variant nobody sees." },
      activeCaptionPlatform: null,
      editedText: "Drive home today with 4.9% APR on approved credit. #BobMaxeyFord",
      dealer,
      deliveryLanguageAllowed: true,
      identity: { dealerName: dealer.name },
      identityBlockedMessage: "Check the customer's name",
      bodyEditSupersedesPack: true,
    });
    const selected = captions?.facebook_feed;
    expect(selected?.blockedReason).toBeUndefined();
    expect(selected?.disclosures).toContain("Financing subject to credit approval");
    expect(selected?.text).toContain("@BobMaxeyFordHowell");

    const delivered = fitPublishCaptionToBudget(
      {
        text: selected!.text,
        disclosures: selected!.disclosures,
        requiredPrefix: employeeDisclosure,
      },
      10_000,
    );
    const parts = outboundPreviewParts(
      selected!.text,
      employeeDisclosure,
      selected!.disclosures,
    );
    const previewed = [parts.prefix, parts.body, parts.disclosureBlock]
      .filter(Boolean)
      .join("\n\n");

    expect(delivered.startsWith(employeeDisclosure)).toBe(true);
    expect(delivered).toContain("Financing subject to credit approval");
    expect(previewed).toBe(delivered);
  });

  // The share step fits the caption to the chosen channel's real budget
  // (preparePublishShare -> fitPublishCaptionToBudget(content,
  // target.charBudget)). Google Business allows 1,500 characters.
  const gbpBudget = PUBLISH_TARGETS.find((target) => target.id === "gbp")!.charBudget;
  const previewAndDelivered = (editedText: string) => {
    const selected = buildShareCaptions({
      effectivePack: { gbp: "A saved AI variant nobody sees." },
      activeCaptionPlatform: null,
      editedText,
      dealer,
      deliveryLanguageAllowed: true,
      identity: { dealerName: dealer.name },
      identityBlockedMessage: "Check the customer's name",
      bodyEditSupersedesPack: true,
    })?.gbp;
    expect(selected?.blockedReason).toBeUndefined();
    const parts = outboundPreviewParts(
      selected!.text,
      employeeDisclosure,
      selected!.disclosures,
    );
    return {
      previewed: [parts.prefix, parts.body, parts.disclosureBlock]
        .filter(Boolean)
        .join("\n\n"),
      delivered: fitPublishCaptionToBudget(
        {
          text: selected!.text,
          disclosures: selected!.disclosures,
          requiredPrefix: employeeDisclosure,
        },
        gbpBudget,
      ),
    };
  };

  it("matches the delivered caption at a real channel budget when the caption fits", () => {
    expect(gbpBudget).toBe(1500);
    const { previewed, delivered } = previewAndDelivered(
      "Drive home today with 4.9% APR on approved credit. #BobMaxeyFord",
    );
    expect(delivered.length).toBeLessThanOrEqual(gbpBudget);
    expect(previewed).toBe(delivered);
  });

  it("records the known gap: a caption over the channel budget ships shortened, and the preview does not show that yet", () => {
    // KNOWN GAP (verification record, "Posting flow"): PostPreviewCard shows
    // the whole body; the share step shortens it to the budget. When the
    // preview learns the budget (the post unit's proposed
    // fitPublishCaptionParts), flip the last assertion to toBe.
    const longBody = `Drive home today with 4.9% APR on approved credit. ${"Our team walks every buyer through the paperwork, the features and the first service visit. ".repeat(30)}#BobMaxeyFord`;
    const { previewed, delivered } = previewAndDelivered(longBody);
    expect(previewed.length).toBeGreaterThan(gbpBudget);
    // What legally matters still ships: the fitter protects the prefix and
    // the disclosure block and shortens only the body.
    expect(delivered.length).toBeLessThanOrEqual(gbpBudget);
    expect(delivered.startsWith(employeeDisclosure)).toBe(true);
    expect(delivered).toContain("Financing subject to credit approval");
    expect(previewed).not.toBe(delivered);
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
    expect(fn).toContain("text: attributed,");
    expect(fn).not.toContain("text: prepared.caption");
  });

  it("the body-only guard actually fails on the regressed shape (planted mutant)", () => {
    // Proves the guard above is load-bearing rather than vacuous: swapping
    // the real source's `text: attributed,` for the regressed
    // `text: prepared.caption,` must flip both assertions.
    const source = readFileSync(
      resolve(process.cwd(), "services/deliveryCaptions.ts"),
      "utf8",
    );
    const fnStart = source.indexOf("export const buildShareCaptions");
    const fnEnd = source.indexOf("export interface BuildCopyTextInput", fnStart);
    const fn = source.slice(fnStart, fnEnd);
    const mutated = fn.replace("text: attributed,", "text: prepared.caption,");
    expect(mutated).not.toContain("text: attributed,");
    expect(mutated).toContain("text: prepared.caption");
  });
});

describe("canonical disclosure material is one table on both sides", () => {
  type ServerPolicies = {
    canonicalDisclosureMaterial(): string[];
    stripCanonicalDisclosures(text: string): string;
    canonicalPostComplianceSet(
      captions: string[],
      bannedPhrases?: string,
    ): { categories: string[]; required_disclosures: string };
  };
  const loadServerPolicies = (): ServerPolicies => {
    const source = readFileSync(
      resolve(process.cwd(), "pb_hooks/requestPolicies.js"),
      "utf8",
    );
    const module = { exports: {} as ServerPolicies };
    new Function("module", "exports", source)(module, module.exports);
    return module.exports;
  };
  const server = loadServerPolicies();

  // One trigger per rule, in canonical order.
  const triggers = [
    ["financing_apr", "Finance it at 1.9% APR."],
    ["zero_down", "Drive home with $0 down."],
    ["lease", "Lease yours for $299/mo."],
    ["rebate_pricing", "Take $3,000 off MSRP."],
    ["trade_value", "Ask about your trade-in value."],
  ] as const;

  it("has the same header and the same disclosure strings, in the same order", () => {
    const material = canonicalDisclosureMaterial();
    expect(server.canonicalDisclosureMaterial()).toEqual(material);
    expect(material).toHaveLength(1 + triggers.length);
    expect(material[0]).toBe("— Disclosures —");
    expect(CANONICAL_DISCLOSURE_HEADER).toBe(material[0]);
    // Every entry is exactly what each side writes for its rule.
    triggers.forEach(([category, caption], index) => {
      const serverBlock = server.canonicalPostComplianceSet([caption]);
      expect(serverBlock.categories).toEqual([category]);
      expect(serverBlock.required_disclosures).toBe(
        `${material[0]}\n${material[index + 1]}`,
      );
      expect(prepareCaptionForDelivery(caption).disclosures).toBe(
        serverBlock.required_disclosures,
      );
    });
  });

  it("hands out a copy, so a caller cannot edit the table", () => {
    const first = canonicalDisclosureMaterial();
    first.push("Congrats Jessica!");
    first[1] = "edited";
    expect(canonicalDisclosureMaterial()).toEqual(server.canonicalDisclosureMaterial());
    const serverFirst = server.canonicalDisclosureMaterial();
    serverFirst.push("Congrats Jessica!");
    expect(server.canonicalDisclosureMaterial()).toEqual(canonicalDisclosureMaterial());
  });

  const all = triggers.map(([, caption]) => caption);
  const everyBlock = analyzeCaptionSetForDelivery(all).disclosures;
  const material = canonicalDisclosureMaterial();
  const [header, apr, zeroDown, lease, rebate, trade] = material;
  // Every kind of character that may or may not bound material, so a change to
  // either side's boundary lists shows up as a remainder mismatch.
  const separators = [" ", "\n", "\r\n", "\t", "\f", "\v", " ", "", "-", ".", "!"];
  const corpus: string[] = [
    "",
    everyBlock,
    `Congrats Michelle! Lease yours for $299/mo.\n\n${everyBlock}`,
    `\n\n${everyBlock}`,
    everyBlock.replace(lease, `${lease} Congrats Jessica!`),
    everyBlock.replace(apr, `Thanks to Jessica Smith. ${apr}`),
    // Edited or partial legal copy is not canonical and is kept.
    everyBlock.replace("qualified buyers", "qualified buyers like Jessica"),
    "Taxes, title, license, registration, and dealer documentary fees additional.",
    zeroDown.toUpperCase(),
    apr.replace(/ /g, "  "),
    // Adjacent, repeated and header-only material.
    `${header}${header}${trade}${trade}`,
    `${header}\n${header}\n${trade} ${trade}`,
    `Jessica${rebate}Smith`,
    `${header}\n`,
    // Smart-punctuation lookalike header is not the header.
    "- Disclosures -\nCongrats Jessica!",
    // Material used as a separator: glued, spaced, one side glued.
    `Big day${apr}Jessica is loving her new Ford!`,
    `Nothing beats a delivery like this ${apr} Jessica is officially a Bronco owner!`,
    `What a day${trade}Johnson family, enjoy the new Bronco!`,
    `What a day ${trade} Johnson family, enjoy the new Bronco!`,
    `Big day${apr} Jessica is loving her new Ford!`,
    `Big day ${apr}Jessica is loving her new Ford!`,
    // The header mid-line, glued, and on its own line.
    `Congratulations${header}Jessica Smith`,
    `Congratulations ${header} Jessica Smith`,
    `Congratulations\n${header}\nJessica Smith`,
    // A glued occurrence first, then a bounded one of the same text.
    `x${lease}y ${lease} z`,
    `${lease}${lease} ${lease}`,
    ...separators.flatMap((left) =>
      separators.map((right) => `Congrats${left}${apr}${right}Jessica!`),
    ),
    ...separators.flatMap((left) =>
      separators.map((right) => `Congrats${left}${header}${right}Jessica!`),
    ),
  ];

  it.each(corpus.map((text, index) => [index, text]))(
    "strips exactly the same text on the server and the client (row %i)",
    (_index, text) => {
      expect(server.stripCanonicalDisclosures(text)).toBe(
        stripCanonicalDisclosures(text),
      );
    },
  );

  it("removes only exact canonical material and keeps every other character", () => {
    expect(stripCanonicalDisclosures(everyBlock).trim()).toBe("");
    expect(
      stripCanonicalDisclosures(
        everyBlock.replace(lease, `${lease} Congrats Jessica!`),
      ).trim(),
    ).toBe("Congrats Jessica!");
    const edited = everyBlock.replace(
      "qualified buyers",
      "qualified buyers like Jessica",
    );
    expect(stripCanonicalDisclosures(edited)).toContain(
      "qualified buyers like Jessica",
    );
    const fragment =
      "Taxes, title, license, registration, and dealer documentary fees additional.";
    expect(stripCanonicalDisclosures(fragment)).toBe(fragment);
    expect(stripCanonicalDisclosures(zeroDown.toUpperCase())).toBe(
      zeroDown.toUpperCase(),
    );
    expect(stripCanonicalDisclosures(undefined)).toBe("");
    expect(stripCanonicalDisclosures(null)).toBe("");
  });

  it("puts a line break where the legal copy was, so the text on either side never fuses", () => {
    // Replacing material with nothing turned "this <APR text> Jessica" into
    // "this  Jessica" (no sentence break) and "day<APR text>Jessica" into
    // "dayJessica" (one word), and the guard missed the name a reader sees.
    expect(
      stripCanonicalDisclosures(
        `Nothing beats a delivery like this ${apr} Jessica is officially a Bronco owner!`,
      ),
    ).toBe(
      "Nothing beats a delivery like this \n Jessica is officially a Bronco owner!",
    );
    expect(stripCanonicalDisclosures(everyBlock)).toBe("\n\n\n \n \n \n \n");
    expect(stripCanonicalDisclosures(`${lease}`)).toBe("\n");
    expect(stripCanonicalDisclosures(`A\n${header}\nB`)).toBe("A\n\n\nB");
  });

  it("keeps material glued to other text, so it is reviewed as written", () => {
    for (const text of [
      `Big day${apr}Jessica is loving her new Ford!`,
      `What a day${trade}Johnson family, enjoy the new Bronco!`,
      `Big day${apr} Jessica is loving her new Ford!`,
      `Big day ${apr}Jessica is loving her new Ford!`,
      `Jessica${rebate}Smith`,
      `${header}${header}${trade}${trade}`,
      `Congrats ${apr} Jessica!`,
    ]) {
      expect(stripCanonicalDisclosures(text)).toBe(text);
      expect(server.stripCanonicalDisclosures(text)).toBe(text);
    }
    // Only the bounded occurrence of repeated text is taken out.
    expect(stripCanonicalDisclosures(`x${lease}y ${lease} z`)).toBe(`x${lease}y \n z`);
  });

  it("takes the header out only on a line of its own", () => {
    // The header does not end a sentence. Mid-line, a reader reads straight
    // through it, so the guard must too.
    for (const text of [
      `Congratulations ${header} Jessica Smith`,
      `Congratulations${header}Jessica Smith`,
      `Congratulations\t${header}\tJessica Smith`,
      `Congratulations\n${header} Jessica Smith`,
    ]) {
      expect(stripCanonicalDisclosures(text)).toBe(text);
      expect(server.stripCanonicalDisclosures(text)).toBe(text);
    }
    expect(stripCanonicalDisclosures(`Congratulations\r\n${header}\r\nJessica`)).toBe(
      "Congratulations\r\n\n\r\nJessica",
    );
    expect(stripCanonicalDisclosures(`${header}\n${apr}`)).toBe("\n\n\n");
  });
});
