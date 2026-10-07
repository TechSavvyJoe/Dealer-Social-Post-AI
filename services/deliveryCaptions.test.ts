import { describe, expect, it, vi } from "vitest";
import {
  appendDisclosureText,
  buildCopyText,
  buildShareCaptions,
  deliveredCaptionFor,
  effectivePackFor,
  withPackEdit,
} from "./deliveryCaptions";
import { checkCaptionIdentity, type CaptionIdentityContext } from "../utils/postLocks";
import { applyDealerBrandKit } from "../utils/brandKit";

// The real identity guard, watched, so a test can read the exact text it was
// asked to judge. Every other test gets its real verdicts.
vi.mock("../utils/postLocks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/postLocks")>();
  return { ...actual, checkCaptionIdentity: vi.fn(actual.checkCaptionIdentity) };
});

const DEALER = { id: "dealer-1", name: "Bob Maxey Ford of Howell" };

const permissiveIdentity: CaptionIdentityContext = {
  customerDisplayName: undefined,
  dealerName: DEALER.name,
  oemAffiliation: "Ford",
  vehicleDescription: undefined,
  currentPersonName: "Joe Gallant",
  customerIdentityRequired: false,
  isCustomerStory: false,
};

describe("appendDisclosureText", () => {
  it("returns the caption unchanged when there is no disclosure", () => {
    expect(appendDisclosureText("Big smiles today!", "")).toBe("Big smiles today!");
  });

  it("appends the disclosure block with the canonical marker once", () => {
    const result = appendDisclosureText(
      "Big smiles today!",
      "Financing subject to credit approval through dealer-participating lenders.",
    );
    expect(result).toBe(
      "Big smiles today!\n\n— Disclosures —\nFinancing subject to credit approval through dealer-participating lenders.",
    );
    expect(result.split("— Disclosures —").length - 1).toBe(1);
  });

  it("does not double the marker when the disclosure text already carries it", () => {
    const result = appendDisclosureText(
      "Big smiles today!",
      "— Disclosures —\nSome disclosure.",
    );
    expect(result.split("— Disclosures —").length - 1).toBe(1);
  });
});

describe("deliveredCaptionFor", () => {
  it("prepends the employee disclosure and appends the compliance footer", () => {
    const dealer = {
      ...DEALER,
      employee_disclosure_text: "Posted by a {dealer} team member.",
    };
    const result = deliveredCaptionFor(
      "Big smiles today!",
      "— Disclosures —\nSome disclosure.",
      dealer,
    );
    expect(result.startsWith("Posted by a Bob Maxey Ford of Howell team member.")).toBe(
      true,
    );
    expect(result).toContain("Big smiles today!");
    expect(result).toContain("— Disclosures —\nSome disclosure.");
  });

  it("is idempotent when the employee disclosure is already present", () => {
    const dealer = {
      ...DEALER,
      employee_disclosure_text: "Posted by a {dealer} team member.",
    };
    const once = deliveredCaptionFor("Big smiles today!", "", dealer);
    const twice = deliveredCaptionFor(once, "", dealer);
    expect(twice).toBe(once);
    expect(
      twice.split("Posted by a Bob Maxey Ford of Howell team member.").length - 1,
    ).toBe(1);
  });
});

describe("effectivePackFor", () => {
  it("returns undefined when there is no saved pack and no override", () => {
    expect(effectivePackFor(undefined, {})).toBeUndefined();
  });

  it("returns the overrides alone when there is no saved pack", () => {
    expect(effectivePackFor(undefined, { facebook_feed: "Edited." })).toEqual({
      facebook_feed: "Edited.",
    });
  });

  it("merges overrides on top of the saved pack, override wins", () => {
    expect(
      effectivePackFor(
        { facebook_feed: "Saved.", instagram_feed: "Saved insta." },
        { facebook_feed: "Edited." },
      ),
    ).toEqual({ facebook_feed: "Edited.", instagram_feed: "Saved insta." });
  });

  it("returns the saved pack unchanged when there are no overrides", () => {
    const pack = { facebook_feed: "Saved." };
    expect(effectivePackFor(pack, {})).toEqual(pack);
  });
});

describe("withPackEdit", () => {
  it("is a no-op when there is no active platform", () => {
    const prev = { facebook_feed: "Saved." };
    expect(withPackEdit(prev, null, "New text")).toBe(prev);
  });

  it("is a no-op when the trimmed text is empty", () => {
    const prev = { facebook_feed: "Saved." };
    expect(withPackEdit(prev, "facebook_feed", "   ")).toBe(prev);
  });

  it("is a no-op (same reference) when the trimmed text is unchanged", () => {
    const prev = { facebook_feed: "Saved." };
    expect(withPackEdit(prev, "facebook_feed", "Saved.  ")).toBe(prev);
  });

  it("merges the trimmed edit into the active platform's slot", () => {
    const prev = { facebook_feed: "Saved.", instagram_feed: "Other." };
    expect(withPackEdit(prev, "facebook_feed", "  Edited text.  ")).toEqual({
      facebook_feed: "Edited text.",
      instagram_feed: "Other.",
    });
  });

  it("creates a new slot for a platform not yet in the pack", () => {
    expect(withPackEdit({}, "facebook_feed", "Fresh edit.")).toEqual({
      facebook_feed: "Fresh edit.",
    });
  });
});

describe("buildShareCaptions", () => {
  it("stores the body only, not the disclosure-prepended caption", () => {
    const dealer = {
      ...DEALER,
      employee_disclosure_text: "Posted by a {dealer} team member.",
    };
    const out = buildShareCaptions({
      effectivePack: { facebook_feed: "Big smiles today! Drive home with 4.9% APR." },
      activeCaptionPlatform: null,
      editedText: "",
      dealer,
      bannedPhrases: undefined,
      deliveryLanguageAllowed: true,
      identity: permissiveIdentity,
      identityBlockedMessage: "blocked",
    });
    expect(out?.facebook_feed.text).not.toContain("Posted by a");
    expect(out?.facebook_feed.text).toContain("Big smiles today!");
    expect(out?.facebook_feed.disclosures).toContain(
      "Financing subject to credit approval",
    );
  });

  it("mirrors instagram_feed onto instagram_reel when absent", () => {
    const out = buildShareCaptions({
      effectivePack: { instagram_feed: "New arrivals this week!" },
      activeCaptionPlatform: null,
      editedText: "",
      dealer: DEALER,
      bannedPhrases: undefined,
      deliveryLanguageAllowed: true,
      identity: permissiveIdentity,
      identityBlockedMessage: "blocked",
    });
    expect(out?.instagram_reel).toEqual(out?.instagram_feed);
  });

  it("does not overwrite an explicit instagram_reel variant", () => {
    const out = buildShareCaptions({
      effectivePack: {
        instagram_feed: "New arrivals this week!",
        instagram_reel: "Reel-specific caption.",
      },
      activeCaptionPlatform: null,
      editedText: "",
      dealer: DEALER,
      bannedPhrases: undefined,
      deliveryLanguageAllowed: true,
      identity: permissiveIdentity,
      identityBlockedMessage: "blocked",
    });
    expect(out?.instagram_reel.text).toContain("Reel-specific caption.");
  });

  it("sets blockedReason to the identity message when a variant names the wrong customer", () => {
    const out = buildShareCaptions({
      effectivePack: { facebook_feed: "Congrats to Michelle on her new Bronco!" },
      activeCaptionPlatform: null,
      editedText: "",
      dealer: DEALER,
      bannedPhrases: undefined,
      deliveryLanguageAllowed: true,
      identity: { ...permissiveIdentity, customerIdentityRequired: true },
      identityBlockedMessage: "This copy names the wrong customer.",
    });
    expect(out?.facebook_feed.blockedReason).toBe(
      "This copy names the wrong customer.",
    );
  });

  it("sets blockedReason to the prohibited-claims message for a banned claim", () => {
    const out = buildShareCaptions({
      effectivePack: {
        facebook_feed: "Guaranteed approval for everyone, no credit check!",
      },
      activeCaptionPlatform: null,
      editedText: "",
      dealer: DEALER,
      bannedPhrases: undefined,
      deliveryLanguageAllowed: true,
      identity: permissiveIdentity,
      identityBlockedMessage: "identity blocked",
    });
    expect(out?.facebook_feed.blockedReason).toContain("prohibited advertising claim");
  });

  it("appends the dealership's Facebook mention", () => {
    const dealer = { ...DEALER, facebook_page_tag: "BobMaxeyFordHowell" };
    const out = buildShareCaptions({
      effectivePack: { facebook_feed: "Big smiles today!" },
      activeCaptionPlatform: null,
      editedText: "",
      dealer,
      bannedPhrases: undefined,
      deliveryLanguageAllowed: true,
      identity: permissiveIdentity,
      identityBlockedMessage: "blocked",
    });
    expect(out?.facebook_feed.text).toContain("@BobMaxeyFordHowell");
  });

  it("uses the live editor text for the active platform", () => {
    const out = buildShareCaptions({
      effectivePack: { facebook_feed: "Stale saved caption." },
      activeCaptionPlatform: "facebook_feed",
      editedText: "Fresh in-progress edit.",
      dealer: DEALER,
      bannedPhrases: undefined,
      deliveryLanguageAllowed: true,
      identity: permissiveIdentity,
      identityBlockedMessage: "blocked",
    });
    expect(out?.facebook_feed.text).toContain("Fresh in-progress edit.");
  });

  it("returns undefined when there is no pack", () => {
    expect(
      buildShareCaptions({
        effectivePack: undefined,
        activeCaptionPlatform: null,
        editedText: "",
        dealer: DEALER,
        bannedPhrases: undefined,
        deliveryLanguageAllowed: true,
        identity: permissiveIdentity,
        identityBlockedMessage: "blocked",
      }),
    ).toBeUndefined();
  });

  // B3: an edit to the shared body must invalidate every per-channel pack,
  // never ship the stale AI variant next to an edited body. This is a PR2b
  // opt-in (`bodyEditSupersedesPack`) — the old multi-tab screen never sets
  // it, so its behaviour is covered by the parity test below.
  describe("bodyEditSupersedesPack (PR2b opt-in)", () => {
    it("old default (flag omitted): editing the body with no active platform leaves every channel's stale AI variant untouched", () => {
      const out = buildShareCaptions({
        effectivePack: {
          facebook_feed: "Stale AI variant for Facebook.",
          instagram_feed: "Stale AI variant for Instagram.",
        },
        activeCaptionPlatform: null,
        editedText: "A brand-new body the salesperson just typed.",
        dealer: DEALER,
        bannedPhrases: undefined,
        deliveryLanguageAllowed: true,
        identity: permissiveIdentity,
        identityBlockedMessage: "blocked",
      });
      expect(out?.facebook_feed.text).toContain("Stale AI variant for Facebook.");
      expect(out?.instagram_feed.text).toContain("Stale AI variant for Instagram.");
      expect(out?.facebook_feed.text).not.toContain("brand-new body");
    });

    it("opt-in mode: body edit with no active platform → no channel carries the stale AI variant", () => {
      const out = buildShareCaptions({
        effectivePack: {
          facebook_feed: "Stale AI variant for Facebook.",
          instagram_feed: "Stale AI variant for Instagram.",
        },
        activeCaptionPlatform: null,
        editedText: "A brand-new body the salesperson just typed.",
        dealer: DEALER,
        bannedPhrases: undefined,
        deliveryLanguageAllowed: true,
        identity: permissiveIdentity,
        identityBlockedMessage: "blocked",
        bodyEditSupersedesPack: true,
      });
      expect(out?.facebook_feed.text).toContain(
        "A brand-new body the salesperson just typed.",
      );
      expect(out?.instagram_feed.text).toContain(
        "A brand-new body the salesperson just typed.",
      );
      expect(out?.facebook_feed.text).not.toContain("Stale AI variant");
      expect(out?.instagram_feed.text).not.toContain("Stale AI variant");
    });

    it("opt-in mode still defers to the live editor text when a specific channel tab is active", () => {
      const out = buildShareCaptions({
        effectivePack: {
          facebook_feed: "Stale saved caption.",
          instagram_feed: "Stale AI variant for Instagram.",
        },
        activeCaptionPlatform: "facebook_feed",
        editedText: "Fresh in-progress edit for Facebook only.",
        dealer: DEALER,
        bannedPhrases: undefined,
        deliveryLanguageAllowed: true,
        identity: permissiveIdentity,
        identityBlockedMessage: "blocked",
        bodyEditSupersedesPack: true,
      });
      expect(out?.facebook_feed.text).toContain(
        "Fresh in-progress edit for Facebook only.",
      );
      // Not editing the shared body (a specific tab is active), so other
      // channels are untouched even in opt-in mode.
      expect(out?.instagram_feed.text).toContain("Stale AI variant for Instagram.");
    });

    it("opt-in mode re-appends each channel's own disclosure to the edited body", () => {
      const dealer = {
        ...DEALER,
        employee_disclosure_text: "Posted by a {dealer} team member.",
      };
      const out = buildShareCaptions({
        effectivePack: {
          facebook_feed: "Stale variant.",
          instagram_feed: "Stale variant.",
        },
        activeCaptionPlatform: null,
        editedText: "Drive home with 4.9% APR today!",
        dealer,
        bannedPhrases: undefined,
        deliveryLanguageAllowed: true,
        identity: permissiveIdentity,
        identityBlockedMessage: "blocked",
        bodyEditSupersedesPack: true,
      });
      expect(out?.facebook_feed.disclosures).toContain(
        "Financing subject to credit approval",
      );
      expect(out?.facebook_feed.text).not.toContain("Posted by a");
    });
  });
});

describe("buildCopyText", () => {
  it("scans, adds the page tag, prepends the disclosure, then appends the footer", () => {
    const dealer = {
      ...DEALER,
      employee_disclosure_text: "Posted by a {dealer} team member.",
      facebook_page_tag: "BobMaxeyFordHowell",
    };
    const result = buildCopyText({
      editedText: "Drive home with 4.9% APR today!",
      copyDestinationId: "facebook_feed",
      dealer,
      bannedPhrases: undefined,
      deliveryLanguageAllowed: true,
    });
    expect(result.blockedReason).toBeUndefined();
    expect(
      result.text.startsWith("Posted by a Bob Maxey Ford of Howell team member."),
    ).toBe(true);
    expect(result.text).toContain("@BobMaxeyFordHowell");
    expect(result.text).toContain("— Disclosures —");
    expect(result.text.split("— Disclosures —").length - 1).toBe(1);
  });

  it("blocks a prohibited claim instead of returning text", () => {
    const result = buildCopyText({
      editedText: "Guaranteed approval, no credit check!",
      copyDestinationId: "facebook_feed",
      dealer: DEALER,
      bannedPhrases: undefined,
      deliveryLanguageAllowed: true,
    });
    expect(result.text).toBe("");
    expect(result.blockedReason).toContain("prohibited advertising claim");
  });

  it("skips attribution when there is no destination", () => {
    const result = buildCopyText({
      editedText: "Big smiles today!",
      copyDestinationId: undefined,
      dealer: DEALER,
      bannedPhrases: undefined,
      deliveryLanguageAllowed: true,
    });
    expect(result.blockedReason).toBeUndefined();
    expect(result.text).toContain("Big smiles today!");
  });
});

/**
 * The page tag is added after the compliance scan. The scan's brand-kit pass
 * reads hashtags from the last line only, so scanning a caption that already
 * ended in "@Tag" wrote a second line of filler hashtags under the tag.
 */
describe("the page tag closes the caption, after its one hashtag line", () => {
  const TAGGED = {
    ...DEALER,
    facebook_page_tag: "BobMaxeyFordHowell",
    instagram_handle: "bobmaxeyford",
  };
  // What generation stores: the body, then the brand kit's one hashtag line.
  const GENERATED = applyDealerBrandKit(
    "Congratulations on your new SUV! Thank you for choosing Bob Maxey Ford of Howell. We loved helping you find the right one, and we hope you enjoy every mile.",
    { name: TAGGED.name, default_hashtags: "#HowellMI" },
    true,
  );
  const hashtagLines = (text: string) =>
    text.split("\n").filter((line) => /^#\w+(?:\s+#\w+)*$/.test(line.trim()));
  const hashtags = (text: string) =>
    (text.match(/#\w+/g) || []).map((tag) => tag.toLowerCase());

  it("starts from one hashtag line (the fixture is what generation stores)", () => {
    expect(hashtagLines(GENERATED)).toHaveLength(1);
  });

  it.each([
    ["facebook_feed", "@BobMaxeyFordHowell"],
    ["marketplace", "@BobMaxeyFordHowell"],
    ["instagram_feed", "@bobmaxeyford"],
  ])(
    "share caption for %s: one hashtag line, no tag repeated, page tag last",
    (id, tag) => {
      const out = buildShareCaptions({
        effectivePack: { [id]: GENERATED },
        activeCaptionPlatform: null,
        editedText: GENERATED,
        dealer: TAGGED,
        bannedPhrases: undefined,
        deliveryLanguageAllowed: true,
        identity: permissiveIdentity,
        identityBlockedMessage: "blocked",
        bodyEditSupersedesPack: true,
      });
      const text = out?.[id]?.text || "";
      expect(hashtagLines(text)).toHaveLength(1);
      expect(new Set(hashtags(text)).size).toBe(hashtags(text).length);
      expect(text.endsWith(`\n\n${tag}`)).toBe(true);
      expect(text.split(tag)).toHaveLength(2);
      expect(out?.[id]?.blockedReason).toBeUndefined();
    },
  );

  it("copy text: disclosure, body, one hashtag line, then the page tag", () => {
    const result = buildCopyText({
      editedText: GENERATED,
      copyDestinationId: "facebook_feed",
      dealer: TAGGED,
      bannedPhrases: undefined,
      deliveryLanguageAllowed: true,
    });
    expect(result.blockedReason).toBeUndefined();
    expect(
      result.text.startsWith("Posted by a Bob Maxey Ford of Howell team member.\n\n"),
    ).toBe(true);
    expect(hashtagLines(result.text)).toHaveLength(1);
    expect(new Set(hashtags(result.text)).size).toBe(hashtags(result.text).length);
    expect(result.text.endsWith("\n\n@BobMaxeyFordHowell")).toBe(true);
  });

  it("keeps the disclosures block after the page tag", () => {
    const result = buildCopyText({
      editedText: `Drive home with 4.9% APR today!\n${hashtagLines(GENERATED)[0]}`,
      copyDestinationId: "facebook_feed",
      dealer: TAGGED,
      bannedPhrases: undefined,
      deliveryLanguageAllowed: true,
    });
    const [beforeBlock] = result.text.split("— Disclosures —");
    expect(beforeBlock.trimEnd().endsWith("@BobMaxeyFordHowell")).toBe(true);
    expect(hashtagLines(beforeBlock)).toHaveLength(1);
  });

  const shareOne = (id: string, caption: string, dealer = TAGGED) =>
    buildShareCaptions({
      effectivePack: { [id]: caption },
      activeCaptionPlatform: null,
      editedText: caption,
      dealer,
      bannedPhrases: undefined,
      deliveryLanguageAllowed: true,
      identity: permissiveIdentity,
      identityBlockedMessage: "blocked",
      bodyEditSupersedesPack: true,
    })?.[id];
  const copyFor = (id: string | undefined, caption: string) =>
    buildCopyText({
      editedText: caption,
      copyDestinationId: id,
      dealer: TAGGED,
      bannedPhrases: undefined,
      deliveryLanguageAllowed: true,
    });
  const count = (text: string, part: string) =>
    text.toLowerCase().split(part.toLowerCase()).length - 1;

  // A salesperson typed the tag, or pasted a shared caption back in. The scan
  // reads hashtags from the last line only, so a tag left there turned the
  // real hashtag line into prose and got a filler line written under the tag.
  it("does not add the tag again when the caption already carries it", () => {
    const already = `${GENERATED}\n\n@BobMaxeyFordHowell`;
    const text = shareOne("facebook_feed", already)?.text || "";
    expect(text.split("@BobMaxeyFordHowell")).toHaveLength(2);
    expect(hashtagLines(text)).toHaveLength(1);
    expect(new Set(hashtags(text)).size).toBe(hashtags(text).length);
    expect(text.endsWith(`${hashtagLines(GENERATED)[0]}\n\n@BobMaxeyFordHowell`)).toBe(
      true,
    );
  });

  it("copy text: a caption already closing with the tag keeps one hashtag line", () => {
    const result = copyFor("facebook_feed", `${GENERATED}\n\n@BobMaxeyFordHowell`);
    expect(result.blockedReason).toBeUndefined();
    expect(result.text.split("@BobMaxeyFordHowell")).toHaveLength(2);
    expect(hashtagLines(result.text)).toHaveLength(1);
    expect(new Set(hashtags(result.text)).size).toBe(hashtags(result.text).length);
    expect(result.text.endsWith("\n\n@BobMaxeyFordHowell")).toBe(true);
  });

  it("copy text with no destination keeps the typed tag and one hashtag line", () => {
    const result = copyFor(undefined, `${GENERATED}\n\n@BobMaxeyFordHowell`);
    expect(result.text.split("@BobMaxeyFordHowell")).toHaveLength(2);
    expect(hashtagLines(result.text)).toHaveLength(1);
    expect(result.text.endsWith("\n\n@BobMaxeyFordHowell")).toBe(true);
  });

  it("matches the typed tag whatever its case, and still tags once", () => {
    const text =
      shareOne("facebook_feed", `${GENERATED}\n@bobmaxeyfordhowell`)?.text || "";
    expect(count(text, "@BobMaxeyFordHowell")).toBe(1);
    expect(hashtagLines(text)).toHaveLength(1);
    expect(text.endsWith("\n\n@bobmaxeyfordhowell")).toBe(true);
  });

  // One caption on screen feeds every channel, so the Facebook tag a
  // salesperson typed also reaches the Instagram scan.
  it("Instagram: keeps a typed Facebook tag, one hashtag line, its own handle last", () => {
    const text =
      shareOne("instagram_feed", `${GENERATED}\n\n@BobMaxeyFordHowell`)?.text || "";
    expect(hashtagLines(text)).toHaveLength(1);
    expect(new Set(hashtags(text)).size).toBe(hashtags(text).length);
    expect(count(text, "@BobMaxeyFordHowell")).toBe(1);
    expect(text.endsWith("\n\n@BobMaxeyFordHowell\n\n@bobmaxeyford")).toBe(true);
  });

  it("never drops anyone else's @handle on the last line", () => {
    const text = shareOne("facebook_feed", `${GENERATED}\n\n@SomeoneElse`)?.text || "";
    expect(count(text, "@SomeoneElse")).toBe(1);
    expect(text.endsWith("\n\n@BobMaxeyFordHowell")).toBe(true);
  });

  it("leaves a caption that is only the tag whole", () => {
    const text = shareOne("facebook_feed", "@BobMaxeyFordHowell")?.text || "";
    expect(count(text, "@BobMaxeyFordHowell")).toBe(1);
  });

  it("still scans the body when the caption closes with the tag", () => {
    const financed = shareOne(
      "facebook_feed",
      "Drive home with 4.9% APR today!\n\n@BobMaxeyFordHowell",
    );
    expect(financed?.disclosures).toContain("Financing subject to credit approval");
    expect(financed?.text.endsWith("\n\n@BobMaxeyFordHowell")).toBe(true);

    const claim =
      "Guaranteed approval for everyone, no credit check!\n\n@BobMaxeyFordHowell";
    expect(shareOne("facebook_feed", claim)?.blockedReason).toContain(
      "prohibited advertising claim",
    );
    expect(copyFor("facebook_feed", claim).blockedReason).toContain(
      "prohibited advertising claim",
    );
  });

  // The identity guard must judge what is posted: the disclosure the delivery
  // path prefixes, then the body, then the page tag.
  it.each([
    ["facebook_feed", "@BobMaxeyFordHowell", GENERATED],
    ["instagram_feed", "@bobmaxeyford", GENERATED],
    ["facebook_feed", "@BobMaxeyFordHowell", `${GENERATED}\n\n@BobMaxeyFordHowell`],
  ])("the identity check reads the whole %s caption, ending %s", (id, tag, caption) => {
    const judge = vi.mocked(checkCaptionIdentity);
    judge.mockClear();
    const out = shareOne(id, caption);
    expect(judge).toHaveBeenCalledTimes(1);
    const [judged] = judge.mock.calls[0];
    expect(judged).toBe(
      `Posted by a Bob Maxey Ford of Howell team member.\n\n${out?.text}`,
    );
    expect(judged.endsWith(`\n\n${tag}`)).toBe(true);
  });
});
