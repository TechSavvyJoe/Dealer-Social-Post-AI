import { afterEach, describe, expect, it, vi } from "vitest";
import type { Dealer } from "../../types";
import {
  appendDisclosureText,
  buildCopyText,
  type BuildCopyTextInput,
  type CopyTextResult,
} from "../../services/deliveryCaptions";
import { resolveStoreDefaults } from "../../services/storeDefaults";
import { applyDealerBrandKit } from "../../utils/brandKit";
import {
  analyzeCaptionForDelivery,
  prependEmployeeDisclosure,
  prohibitedClaimsMessage,
} from "../../utils/complianceDisclosures";
import { appendDealershipMention } from "../../utils/socialAttribution";
import {
  composeSampleCaption,
  joinSampleCaption,
  sampleApproval,
  sampleBody,
  sampleChannels,
  sampleLogo,
  sampleLook,
  sampleNotes,
  sampleSummary,
  type SampleCaption,
} from "./sampleProof";

/**
 * Lets a test run the sample against a given shape of the Facebook copy path
 * (null: the real `buildCopyText`), so these tests hold whichever shape ships
 * and cover both.
 */
const copyPath = vi.hoisted(() => ({
  override: null as null | ((input: BuildCopyTextInput) => CopyTextResult),
}));

vi.mock("../../services/deliveryCaptions", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../services/deliveryCaptions")>();
  return {
    ...actual,
    buildCopyText: (input: BuildCopyTextInput) =>
      copyPath.override ? copyPath.override(input) : actual.buildCopyText(input),
  };
});

afterEach(() => {
  copyPath.override = null;
});

type Destination = Parameters<typeof appendDealershipMention>[1];

/**
 * One shape of the Facebook copy path, built from the same exported steps
 * `buildCopyText` uses. `tagFirst`: the page tag is added and then the whole
 * caption is scanned (the scan's brand-kit pass can write a hashtag line
 * under the tag); otherwise the caption is scanned and the tag added last.
 */
const copyShape =
  (tagFirst: boolean) =>
  (input: BuildCopyTextInput): CopyTextResult => {
    const tag = (text: string) =>
      appendDealershipMention(
        text,
        input.copyDestinationId as Destination,
        input.dealer,
      );
    const scanned = analyzeCaptionForDelivery(
      tagFirst ? tag(input.editedText) : input.editedText,
      input.bannedPhrases,
      undefined,
      input.deliveryLanguageAllowed,
    );
    if (scanned.compliance.prohibited.length > 0) {
      return {
        text: "",
        blockedReason: prohibitedClaimsMessage(scanned.compliance.prohibited),
      };
    }
    const caption = tagFirst ? scanned.caption : tag(scanned.caption);
    return {
      text: appendDisclosureText(
        prependEmployeeDisclosure(caption, input.dealer),
        scanned.disclosures,
      ),
    };
  };
const tagThenScan = copyShape(true);
const scanThenTag = copyShape(false);

/** A store with everything the sample can show. */
const full: Dealer = {
  id: "dealer-1",
  name: "Bob Maxey Ford of Howell",
  logo: "/api/files/dealers/dealer-1/logo.png",
  logo_placement: { corner: "bottom_right", scale: 0.2 },
  brand_color: "#1e40af",
  facebook_page_tag: "BobMaxeyFordHowell",
  instagram_handle: "bobmaxeyford",
  default_footer: "Visit us at 2798 E Grand River Ave, Howell.",
  default_hashtags: "#FordHowell, #HowellMI",
  signature_look: "showroom",
  creative_system_v2: true,
  requires_approval: true,
  approval_policy: { mode: "per_category", categories: ["deliveries", "promotions"] },
  employee_disclosure_disabled: false,
};

const nothing: Dealer = { id: "dealer-0", name: "" };

/** What the real path copies, computed here without the module under test. */
const realCopy = (dealer: Dealer): string => {
  const edited = analyzeCaptionForDelivery(
    sampleBody(dealer),
    dealer.banned_phrases,
    {
      name: dealer.name,
      default_hashtags: dealer.default_hashtags,
      default_footer: dealer.default_footer,
      required_hashtags_locked: dealer.required_hashtags_locked === true,
    },
    true,
  ).caption;
  return buildCopyText({
    editedText: edited,
    copyDestinationId: "facebook_feed",
    dealer,
    bannedPhrases: dealer.banned_phrases,
    deliveryLanguageAllowed: true,
  }).text;
};

const parityCases: Array<[string, Dealer]> = [
  ["a fully set-up dealer", full],
  ["a dealer with nothing set", nothing],
  ["the disclosure off", { ...full, employee_disclosure_disabled: true }],
  [
    "a custom disclosure wording",
    {
      ...full,
      employee_disclosure_text: "Shared by a proud member of the {dealer} team.",
    },
  ],
  ["no page tag", { ...full, facebook_page_tag: "" }],
  [
    "a footer only",
    {
      id: "dealer-3",
      name: "Lakeside Kia",
      default_footer: "Stop by Lakeside Kia today.",
    },
  ],
  [
    "hashtags locked",
    {
      ...full,
      default_hashtags: "#A1, #B2, #C3, #D4, #E5, #F6",
      required_hashtags_locked: true,
    },
  ],
  [
    "a footer that triggers a compliance disclosure",
    { ...full, default_footer: "Ask about 0.9% APR financing." },
  ],
  [
    "a footer that already carries the page tag",
    { ...full, default_footer: "Follow @BobMaxeyFordHowell for more." },
  ],
  ["a multi-line footer", { ...full, default_footer: "Open late.\nCall us today." }],
];

describe("composeSampleCaption: the copy path, taken apart", () => {
  it.each(parityCases)("rebuilds exactly what is copied for %s", (_label, dealer) => {
    const caption = composeSampleCaption(dealer);
    expect(caption.blockedReason).toBeUndefined();
    expect(caption.full).toBe(realCopy(dealer));
    expect(caption.full.length).toBeGreaterThan(0);
    expect(joinSampleCaption(caption)).toBe(caption.full);
  });

  it("passes the sample body through unchanged for a typical dealer", () => {
    for (const [, dealer] of parityCases) {
      expect(composeSampleCaption(dealer).body).toBe(sampleBody(dealer));
    }
    expect(sampleBody(full)).toBe(
      "Congratulations on your new SUV! Thank you for choosing Bob Maxey Ford of Howell. We loved helping you find the right one, and we hope you enjoy every mile.",
    );
    expect(sampleBody(nothing)).toContain("Thank you for choosing our dealership.");
    // Long enough that the marketing-length floor never adds a line.
    expect(sampleBody(nothing).length).toBeGreaterThanOrEqual(120);
  });

  it("finds each part of a fully set-up dealer's caption", () => {
    const caption = composeSampleCaption(full);
    expect(caption.disclosure).toBe(
      "Posted by a Bob Maxey Ford of Howell team member.",
    );
    expect(caption.footer).toBe("Visit us at 2798 E Grand River Ave, Howell.");
    expect(caption.hashtags).toMatch(/^#BobMaxeyFordOfHowell #FordHowell #HowellMI\b/);
    expect(caption.mention).toBe("@BobMaxeyFordHowell");
    expect(caption.compliance).toBe("");
    expect(caption.full.startsWith(`${caption.disclosure}\n\n${caption.body}`)).toBe(
      true,
    );
  });

  it("reflects the disclosure settings", () => {
    expect(
      composeSampleCaption({ ...full, employee_disclosure_disabled: true }).disclosure,
    ).toBe("");
    expect(
      composeSampleCaption({
        ...full,
        employee_disclosure_text: "Shared by a proud member of the {dealer} team.",
      }).disclosure,
    ).toBe("Shared by a proud member of the Bob Maxey Ford of Howell team.");
  });

  it("has no page tag line without a tag, and none of its own when the footer carries it", () => {
    const untagged = composeSampleCaption({ ...full, facebook_page_tag: "" });
    expect(untagged.mention).toBe("");
    expect(untagged.afterMention).toBe("");
    const inFooter = composeSampleCaption({
      ...full,
      default_footer: "Follow @BobMaxeyFordHowell for more.",
    });
    expect(inFooter.mention).toBe("");
    expect(inFooter.footer).toBe("Follow @BobMaxeyFordHowell for more.");
    // A footer that is the tag alone is still the footer, not an added tag line.
    const tagFooter = composeSampleCaption({
      ...full,
      default_footer: "@BobMaxeyFordHowell",
    });
    expect(tagFooter.footer).toBe("@BobMaxeyFordHowell");
    expect(tagFooter.mention).toBe("");
    expect(tagFooter.afterMention).toBe("");
    expect(tagFooter.hashtags.startsWith("#BobMaxeyFordOfHowell")).toBe(true);
    expect(joinSampleCaption(tagFooter)).toBe(tagFooter.full);
  });

  it("keeps a footer-only store's footer and the tags the brand kit adds", () => {
    const caption = composeSampleCaption(parityCases[5][1]);
    expect(caption.footer).toBe("Stop by Lakeside Kia today.");
    expect(caption.hashtags.startsWith("#LakesideKia ")).toBe(true);
    expect(caption.disclosure).toBe("Posted by a Lakeside Kia team member.");
  });

  it("keeps the store's locked hashtags first", () => {
    const caption = composeSampleCaption(parityCases[6][1]);
    expect(caption.hashtags.startsWith("#BobMaxeyFordOfHowell #A1 #B2")).toBe(true);
  });

  it("shows the compliance block the copy path appends", () => {
    const caption = composeSampleCaption({
      ...full,
      default_footer: "Ask about 0.9% APR financing.",
    });
    expect(
      caption.compliance.startsWith("— Disclosures —\nFinancing subject to credit"),
    ).toBe(true);
    expect(caption.footer).toBe("Ask about 0.9% APR financing.");
  });

  it("matches applyDealerBrandKit's own order: footer, then the hashtag line", () => {
    const branded = applyDealerBrandKit(sampleBody(full), {
      name: full.name,
      default_footer: full.default_footer,
      default_hashtags: full.default_hashtags,
    });
    const caption = composeSampleCaption(full);
    expect(branded).toBe(
      `${caption.body}\n\n${caption.footer}\n${branded.split("\n").pop()}`,
    );
  });

  it("never shows a caption the real path would refuse", () => {
    const blocked: Dealer = { ...full, banned_phrases: "new SUV" };
    const caption = composeSampleCaption(blocked);
    expect(caption.blockedReason).toContain("“new SUV”");
    expect(caption).toMatchObject<Partial<SampleCaption>>({
      full: "",
      body: sampleBody(blocked),
      disclosure: "",
      footer: "",
      hashtags: "",
      mention: "",
      afterMention: "",
      compliance: "",
    });
    const notes = sampleNotes(blocked, "closing");
    expect(notes[0]).toEqual({
      glyph: "none",
      text: `Your team could not share this caption. ${caption.blockedReason}`,
    });
  });
});

describe("the sample follows either shape of the Facebook copy path", () => {
  const shapes: Array<[string, (input: BuildCopyTextInput) => CopyTextResult]> = [
    ["the page tag added before the scan", tagThenScan],
    ["the page tag added after the scan", scanThenTag],
  ];

  it.each(shapes)("rebuilds exactly what is copied with %s", (_label, shape) => {
    copyPath.override = shape;
    for (const [label, dealer] of parityCases) {
      const caption = composeSampleCaption(dealer);
      expect(caption.blockedReason, label).toBeUndefined();
      expect(caption.full, label).toBe(realCopy(dealer));
      expect(joinSampleCaption(caption), label).toBe(caption.full);
      expect(caption.body, label).toBe(sampleBody(dealer));
    }
  });

  it("shows a hashtag line written under the page tag, and says so", () => {
    copyPath.override = tagThenScan;
    const caption = composeSampleCaption(full);
    expect(caption.mention).toBe("@BobMaxeyFordHowell");
    expect(caption.afterMention).toMatch(/^#NewCarDelivery\b/);
    expect(
      caption.full.endsWith(`\n\n${caption.mention}\n${caption.afterMention}`),
    ).toBe(true);
    expect(sampleNotes(full, "closing")[1]).toEqual({
      glyph: "none",
      text: "In this Facebook caption, your page tag and a second line of common delivery hashtags come after the hashtag line.",
    });
  });

  it("ends with the page tag when the copy path does, and says so", () => {
    copyPath.override = scanThenTag;
    const caption = composeSampleCaption(full);
    expect(caption.mention).toBe("@BobMaxeyFordHowell");
    expect(caption.afterMention).toBe("");
    expect(caption.full.endsWith(`\n\n${caption.mention}`)).toBe(true);
    expect(caption.hashtags).toMatch(/^#BobMaxeyFordOfHowell #FordHowell #HowellMI\b/);
    expect(sampleNotes(full, "closing")[1]).toEqual({
      glyph: "none",
      text: "In this Facebook caption, your page tag comes after the hashtag line.",
    });
  });
});

describe("sampleApproval mirrors initialApprovalStatus for a customer delivery", () => {
  const withPolicy = (
    policy: unknown,
    requiresApproval = true,
  ): ReturnType<typeof sampleApproval> =>
    sampleApproval({
      ...full,
      requires_approval: requiresApproval,
      approval_policy: policy as Dealer["approval_policy"],
    });

  it("shares at once when approval is off, whatever the policy", () => {
    const off = {
      held: false,
      note: "Posts can be shared as soon as they are created.",
    };
    expect(withPolicy(null, false)).toEqual(off);
    expect(
      withPolicy({ mode: "per_category", categories: ["deliveries"] }, false),
    ).toEqual(off);
    expect(sampleApproval({ ...full, requires_approval: undefined })).toEqual(off);
  });

  it("holds every post when the policy cannot narrow", () => {
    const every = { held: true, note: "Every post waits for your approval." };
    for (const policy of [
      null,
      undefined,
      "per_category",
      ["deliveries"],
      { mode: "always" },
      { mode: "none" },
      { mode: "mystery" },
      { mode: "first_n" },
      { mode: "first_n", firstN: 0 },
      { mode: "first_n", firstN: 2.5 },
      { mode: "first_n", firstN: "abc" },
      { mode: "per_category" },
      { mode: "per_category", categories: [] },
      { mode: "per_category", categories: "deliveries" },
    ]) {
      expect(withPolicy(policy), JSON.stringify(policy)).toEqual(every);
    }
  });

  it("holds a person's posts until N of them are approved", () => {
    expect(withPolicy({ mode: "first_n", firstN: 3 })).toEqual({
      held: true,
      note: "A person's posts wait for your approval until you have approved 3 of them.",
    });
    expect(withPolicy({ mode: "first_n", firstN: 1 })).toEqual({
      held: true,
      note: "A person's posts wait for your approval until you have approved one.",
    });
  });

  it("holds a delivery only when Deliveries is checked", () => {
    expect(
      withPolicy({ mode: "per_category", categories: ["promotions", "deliveries"] }),
    ).toEqual({
      held: true,
      note: "This is a delivery, and Deliveries is checked, so it cannot be shared until you approve it.",
    });
    expect(
      withPolicy({ mode: "per_category", categories: ["service", "team"] }),
    ).toEqual({
      held: false,
      note: "Deliveries is not checked, so this delivery can be shared right away.",
    });
  });
});

describe("sampleNotes", () => {
  it("mention: the page tag, or a prompt to add one", () => {
    // "Every caption" is true because PostScreen builds a caption for every
    // channel it offers (__tests__/PostScreen.test.tsx, "tags the store on
    // every channel, even when the post has no per-channel captions") and
    // both builders add the tag after the scan (services/deliveryCaptions).
    expect(sampleNotes(full, "mention")).toEqual([
      {
        glyph: "line",
        text: "Your Facebook page tag. It is added, on its own line, to every Facebook and Marketplace caption your team shares.",
      },
    ]);
    expect(sampleNotes({ ...full, facebook_page_tag: "" }, "mention")).toEqual([
      { glyph: "none", text: "No page tag yet. Add one and it appears here." },
    ]);
    expect(
      sampleNotes(
        { ...full, default_footer: "Follow @BobMaxeyFordHowell for more." },
        "mention",
      ),
    ).toEqual([
      {
        glyph: "none",
        text: "Your Facebook page tag is already in your footer, so it is not added again.",
      },
    ]);
  });

  it("mention: a refused sample still tells a tag in the footer from an added one", () => {
    // The refused sample has no parts (mention is ""), so the note cannot be
    // read from them. appendDealershipMention adds nothing when the footer
    // carries the tag, refused or not.
    const tagInFooter: Dealer = {
      ...full,
      default_footer: "Follow @BobMaxeyFordHowell for more.",
      banned_phrases: "new SUV",
    };
    const refusedInFooter = composeSampleCaption(tagInFooter);
    expect(refusedInFooter.blockedReason).toContain("“new SUV”");
    expect(sampleNotes(tagInFooter, "mention")).toEqual([
      {
        glyph: "none",
        text: `Your team could not share this caption. ${refusedInFooter.blockedReason}`,
      },
      {
        glyph: "none",
        text: "Your Facebook page tag is already in your footer, so it is not added again.",
      },
    ]);

    const tagAdded: Dealer = { ...full, banned_phrases: "new SUV" };
    const refusedAdded = composeSampleCaption(tagAdded);
    expect(sampleNotes(tagAdded, "mention")).toEqual([
      {
        glyph: "none",
        text: `Your team could not share this caption. ${refusedAdded.blockedReason}`,
      },
      {
        glyph: "none",
        text: "Your Facebook page tag. It is added, on its own line, to every Facebook and Marketplace caption your team shares.",
      },
    ]);
  });

  it("disclosure: the line, then the approval rule with the strip only when held", () => {
    expect(sampleNotes(full, "disclosure")).toEqual([
      {
        glyph: "line",
        text: "The team-member disclosure. It opens every post your team shares.",
      },
      {
        glyph: "strip",
        text: "This is a delivery, and Deliveries is checked, so it cannot be shared until you approve it.",
      },
    ]);
    expect(
      sampleNotes(
        { ...full, employee_disclosure_disabled: true, requires_approval: false },
        "disclosure",
      ),
    ).toEqual([
      {
        glyph: "none",
        text: "The disclosure is off. Posts carry no team-member line.",
      },
      { glyph: "none", text: "Posts can be shared as soon as they are created." },
    ]);
  });

  it("closing: names only what is saved, and what the brand kit adds anyway", () => {
    // No page tag, so nothing follows the hashtag line in these captions.
    const untagged = { ...full, facebook_page_tag: "" };
    const text = (dealer: Dealer) => sampleNotes(dealer, "closing").map((n) => n.text);
    expect(text(untagged)).toEqual([
      "Your footer and hashtags. Every caption gets them after its body; the hashtag line starts with your store's tag, then yours.",
    ]);
    expect(text({ ...untagged, default_hashtags: "" })).toEqual([
      "Your footer. Every caption gets it after its body, above a hashtag line that starts with your store's tag.",
    ]);
    expect(text({ ...untagged, default_footer: "" })).toEqual([
      "Your hashtags. Every caption gets a hashtag line after its body: your store's tag, then yours.",
    ]);
    expect(text({ ...untagged, default_footer: "", default_hashtags: " , " })).toEqual([
      "No footer or hashtags saved yet. Every caption still gets a hashtag line after its body, starting with your store's tag.",
    ]);
    expect(text(nothing)).toEqual([
      "No footer or hashtags saved yet. Every caption still gets a hashtag line after its body.",
    ]);
    expect(
      text({
        id: "d",
        name: "",
        default_footer: "Open late.",
        default_hashtags: "#A1",
      }),
    ).toEqual(["Your footer and hashtags. Every caption gets them after its body."]);
    expect(text({ id: "d", name: "", default_footer: "Open late." })).toEqual([
      "Your footer. Every caption gets it after its body, above a hashtag line the app adds.",
    ]);
    expect(text({ id: "d", name: "", default_hashtags: "#A1" })).toEqual([
      "Your hashtags. Every caption gets them after its body.",
    ]);
    expect(sampleNotes(untagged, "closing")[0].glyph).toBe("line");
  });

  it("closing: says what the Facebook copy puts after them, never that they close it", () => {
    // The fully set-up store's real Facebook copy puts the page tag (and any
    // hashtag line the copy path writes under it) after the footer and hashtags.
    const caption = composeSampleCaption(full);
    expect(caption.mention).toBe("@BobMaxeyFordHowell");
    expect(sampleNotes(full, "closing")).toEqual([
      {
        glyph: "line",
        text: "Your footer and hashtags. Every caption gets them after its body; the hashtag line starts with your store's tag, then yours.",
      },
      {
        glyph: "none",
        text: caption.afterMention
          ? "In this Facebook caption, your page tag and a second line of common delivery hashtags come after the hashtag line."
          : "In this Facebook caption, your page tag comes after the hashtag line.",
      },
    ]);
    // A footer that already carries the tag: nothing is appended after it.
    expect(
      sampleNotes(
        { ...full, default_footer: "Follow @BobMaxeyFordHowell for more." },
        "closing",
      ),
    ).toHaveLength(1);
    // No variant claims the footer or hashtags close the caption.
    const variants: Dealer[] = [
      full,
      nothing,
      { ...full, default_hashtags: "" },
      { ...full, default_footer: "" },
      { ...full, default_footer: "", default_hashtags: "" },
      { ...full, default_footer: "Ask about 0.9% APR financing." },
    ];
    for (const dealer of variants) {
      for (const note of sampleNotes(dealer, "closing")) {
        expect(note.text).not.toMatch(/\bclose|come first/i);
      }
      expect(sampleSummary(dealer, "closing")).not.toMatch(/\bclose/i);
    }
  });

  it("look: the Look in force and the logo, never a placement the designer is not told", () => {
    expect(sampleNotes(full, "look")).toEqual([
      {
        glyph: "line",
        text: "The Showroom headline. The signature Look sets its type and the photo finish.",
      },
      { glyph: "dash", text: "Your logo. Designed photos carry it." },
    ]);
    expect(sampleNotes({ ...full, signature_look: "" }, "look")[0]).toEqual({
      glyph: "line",
      text: "The Showroom headline. No signature Look is chosen, so posts use Showroom.",
    });
    // System off: the sample draws no headline, so the note points at none.
    expect(
      sampleNotes(
        { ...full, signature_look: "turbo", creative_system_v2: false },
        "look",
      )[0],
    ).toEqual({
      glyph: "none",
      text: "Your Turbo Look is saved. Posts use the classic styles until a system administrator turns on the signature Look for your store.",
    });
    expect(sampleNotes(nothing, "look")).toEqual([
      { glyph: "none", text: "No signature Look yet. Posts use the classic styles." },
      {
        glyph: "none",
        text: "No logo yet. Designed photos show your store name as text instead.",
      },
    ]);
    // No saved corner: the logo still reaches every designed photo, and the
    // sample still draws it, so the note points at it.
    expect(sampleNotes({ ...full, logo_placement: null }, "look")[1]).toEqual({
      glyph: "dash",
      text: "Your logo. Designed photos carry it.",
    });
  });

  it("none: what the profile does, and that nothing is stamped", () => {
    expect(sampleNotes(full, "none")).toEqual([
      {
        glyph: "none",
        text: "The caption writer knows your website, phone, address and hours and can mention them. Nothing here is stamped on every post.",
      },
    ]);
  });
});

describe("sampleSummary", () => {
  it("gives one true line per mark", () => {
    expect(sampleSummary(full, "mention")).toBe(
      "Your Facebook page tag is @BobMaxeyFordHowell",
    );
    expect(sampleSummary({ ...full, facebook_page_tag: "" }, "mention")).toBe(
      "No page tag yet",
    );
    expect(sampleSummary(full, "disclosure")).toBe(sampleApproval(full).note);
    expect(sampleSummary(full, "closing")).toBe(
      "Your footer and hashtags follow every caption's body.",
    );
    expect(sampleSummary({ ...full, default_hashtags: "" }, "closing")).toBe(
      "Your footer follows every caption's body.",
    );
    expect(sampleSummary({ ...full, default_footer: "" }, "closing")).toBe(
      "Your hashtags follow every caption's body.",
    );
    expect(sampleSummary(nothing, "closing")).toBe("No footer or hashtags saved yet");
    expect(sampleSummary(full, "look")).toBe("Showroom Look with your logo");
    expect(sampleSummary({ ...full, logo: "" }, "look")).toBe("Showroom Look");
    expect(sampleSummary({ ...full, signature_look: "" }, "look")).toBe(
      "Showroom Look until you choose one",
    );
    expect(sampleSummary({ ...full, creative_system_v2: false }, "look")).toBe(
      "Showroom Look, not on posts yet",
    );
    expect(sampleSummary(nothing, "look")).toBe(
      "Classic styles, no signature Look yet",
    );
    expect(sampleSummary(full, "none")).toBe(
      "The caption writer can mention your contact details.",
    );
  });
});

describe("sampleLook", () => {
  it("draws only the Look posts use, as resolveCreative decides it", () => {
    expect(sampleLook(full)).toBe("showroom");
    expect(sampleLook({ ...full, signature_look: "turbo" })).toBe("turbo");
    expect(sampleLook({ ...full, signature_look: "" })).toBe("showroom");
    // System off: posts use the classic styles, so a saved Look is not drawn.
    for (const look of ["showroom", "hometown", "turbo", ""] as const) {
      expect(
        sampleLook({ ...full, signature_look: look, creative_system_v2: false }),
      ).toBeUndefined();
    }
    expect(sampleLook(nothing)).toBeUndefined();
  });
});

describe("sampleChannels", () => {
  const fromDefaults = (dealer: Dealer) =>
    resolveStoreDefaults({
      dealer,
      person: null,
      categoryId: "deliveries",
      scenarioId: "customer_delivery",
      websiteReady: false,
    }).channels.map((channel) => channel.label);

  it("lists the channels resolveStoreDefaults offers for a delivery", () => {
    expect(sampleChannels(full)).toEqual(["Facebook", "Instagram"]);
    const facebookOnly: Dealer = {
      ...full,
      category_destinations: {
        deliveries: { platformIds: ["facebook_feed"], formatIds: [], video: false },
      },
    };
    expect(sampleChannels(facebookOnly)).toEqual(["Facebook"]);
    for (const dealer of [
      full,
      nothing,
      facebookOnly,
      { ...full, creative_system_v2: false },
    ]) {
      expect(sampleChannels(dealer)).toEqual(fromDefaults(dealer));
    }
  });
});

describe("sampleLogo", () => {
  it("draws the saved logo in its saved corner, at the settings' scale bounds", () => {
    expect(sampleLogo(full)).toEqual({
      src: "/api/files/dealers/dealer-1/logo.png",
      corner: "bottom_right",
      scale: 0.2,
    });
    const at = (scale: unknown) =>
      sampleLogo({
        ...full,
        logo_placement: { corner: "top_left", scale } as Dealer["logo_placement"],
      })?.scale;
    expect(at(0.01)).toBe(0.04);
    expect(at(0.9)).toBe(0.5);
    expect(at(undefined)).toBe(0.18);
    expect(at("wide")).toBe(0.18);
  });

  it("draws nothing without a logo, and the notes and summary agree", () => {
    for (const dealer of [
      { ...full, logo: "" },
      { ...full, logo: "   " },
      { ...full, logo: undefined, logo_placement: null },
    ]) {
      expect(sampleLogo(dealer)).toBeNull();
      expect(sampleNotes(dealer, "look").some((note) => note.glyph === "dash")).toBe(
        false,
      );
      expect(sampleSummary(dealer, "look")).toBe("Showroom Look");
    }
  });

  it("draws a logo with no saved corner bottom-right at the default size, and says so", () => {
    // Generation never reads logo_placement: every designed photo carries the
    // logo, so a store that saved a logo but no corner still sees it.
    for (const placement of [
      null,
      undefined,
      { corner: "middle", scale: 0.3 },
      { scale: 0.3 },
    ] as unknown as Array<Dealer["logo_placement"]>) {
      const dealer: Dealer = { ...full, logo_placement: placement };
      expect(sampleLogo(dealer), JSON.stringify(placement)).toEqual({
        src: "/api/files/dealers/dealer-1/logo.png",
        corner: "bottom_right",
        scale: 0.18,
      });
      expect(sampleNotes(dealer, "look")[1]).toEqual({
        glyph: "dash",
        text: "Your logo. Designed photos carry it.",
      });
      expect(sampleSummary(dealer, "look")).toBe("Showroom Look with your logo");
    }
  });
});
