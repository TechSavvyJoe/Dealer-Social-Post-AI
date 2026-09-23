import { describe, expect, it } from "vitest";
import {
  appendDisclosureText,
  buildCopyText,
  buildShareCaptions,
  deliveredCaptionFor,
  effectivePackFor,
  withPackEdit,
} from "./deliveryCaptions";
import type { CaptionIdentityContext } from "../utils/postLocks";

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
  it("attributes, scans, prepends the disclosure, then appends the footer", () => {
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
