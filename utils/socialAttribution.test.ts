import { describe, expect, it } from "vitest";
import {
  appendDealershipMention,
  captionIncludesDealershipMention,
  dealershipMentionFor,
  normalizeDealerSocialProfileValue,
  normalizeSocialTag,
} from "./socialAttribution";

const dealer = {
  facebook_page_tag: "@Bob Maxey Ford of Howell",
  instagram_handle: "bobmaxeyford",
  tiktok_handle: "@bobmaxeyford",
  x_handle: "BobMaxeyFord",
  linkedin_company_tag: "https://www.linkedin.com/company/bob-maxey-ford/",
};

describe("dealership social attribution", () => {
  it("normalizes pasted handles and supported profile URLs", () => {
    expect(normalizeSocialTag(" @@Dealer\nPage ")).toBe("@Dealer Page");
    expect(normalizeSocialTag("https://www.linkedin.com/company/bob-maxey-ford/")).toBe(
      "@bob-maxey-ford",
    );
  });

  it("uses only the handle belonging to the selected destination", () => {
    expect(dealershipMentionFor("facebook_feed", dealer)).toBe(
      "@Bob Maxey Ford of Howell",
    );
    expect(dealershipMentionFor("marketplace", dealer)).toBe(
      "@Bob Maxey Ford of Howell",
    );
    expect(dealershipMentionFor("instagram_reel", dealer)).toBe("@bobmaxeyford");
    expect(dealershipMentionFor("tiktok", dealer)).toBe("@bobmaxeyford");
    expect(dealershipMentionFor("x_twitter", dealer)).toBe("@BobMaxeyFord");
    expect(dealershipMentionFor("linkedin", dealer)).toBe("@bob-maxey-ford");
    expect(dealershipMentionFor("gbp", dealer)).toBe("");
  });

  it("normalizes platform usernames without mistaking content URLs for handles", () => {
    const pastedProfiles = {
      ...dealer,
      instagram_handle: "https://instagram.com/Bob.Maxey_Ford/reel/not-a-handle",
      tiktok_handle: "https://www.tiktok.com/@bob.maxey_ford/video/123456",
      x_handle: "https://x.com/Bob-Maxey_Ford/status/123456",
    };

    expect(dealershipMentionFor("instagram_feed", pastedProfiles)).toBe(
      "@Bob.Maxey_Ford",
    );
    expect(dealershipMentionFor("tiktok", pastedProfiles)).toBe("@bob.maxey_ford");
    expect(dealershipMentionFor("x_twitter", pastedProfiles)).toBe("@BobMaxey_Ford");
  });

  it("returns canonical profile values for dealer settings storage", () => {
    expect(
      normalizeDealerSocialProfileValue(
        "facebook_page_tag",
        "https://facebook.com/BobMaxeyFord/posts/123",
      ),
    ).toBe("BobMaxeyFord");
    expect(
      normalizeDealerSocialProfileValue(
        "instagram_handle",
        "https://instagram.com/Bob Maxey.Ford/reel/123",
      ),
    ).toBe("BobMaxey.Ford");
    expect(
      normalizeDealerSocialProfileValue(
        "tiktok_handle",
        "https://tiktok.com/@bob.maxey_ford/video/123",
      ),
    ).toBe("bob.maxey_ford");
    expect(normalizeDealerSocialProfileValue("x_handle", "@Bob-Maxey_Ford")).toBe(
      "BobMaxey_Ford",
    );
    expect(
      normalizeDealerSocialProfileValue(
        "linkedin_company_tag",
        "https://linkedin.com/company/bob-maxey-ford/",
      ),
    ).toBe("bob-maxey-ford");
    expect(
      normalizeDealerSocialProfileValue(
        "instagram_handle",
        "https://instagram.com/reel/not-a-profile",
      ),
    ).toBe("");
  });

  it.each([
    "https://facebook.com/pages/Bob-Maxey-Ford/123456",
    "https://facebook.com/profile.php?id=123456",
    "https://facebook.com/groups/howell-cars",
    "https://facebook.com/watch/?v=123456",
    "https://facebook.com/reel/123456",
    "https://example.com/BobMaxeyFord",
  ])("rejects ambiguous or non-Facebook Page URLs: %s", (value) => {
    expect(normalizeDealerSocialProfileValue("facebook_page_tag", value)).toBe("");
  });

  it("accepts a Facebook vanity Page URL on an official mobile host", () => {
    expect(
      normalizeDealerSocialProfileValue(
        "facebook_page_tag",
        "https://m.facebook.com/BobMaxeyFord/posts/123456",
      ),
    ).toBe("BobMaxeyFord");
  });

  it("matches only the complete configured mention", () => {
    expect(
      captionIncludesDealershipMention(
        "Thanks @BobMaxeyFord for a great delivery!",
        "@BobMaxeyFord",
      ),
    ).toBe(true);
    expect(
      captionIncludesDealershipMention("@BobMaxeyFordHowell", "@BobMaxeyFord"),
    ).toBe(false);
    expect(
      captionIncludesDealershipMention(
        "sales@bobmaxeyford is not a social mention",
        "@bobmaxeyford",
      ),
    ).toBe(false);
    expect(
      captionIncludesDealershipMention("@Bob Maxey Ford of Howell", "@Bob Maxey Ford"),
    ).toBe(false);
  });

  it("appends a mention once without altering the original copy", () => {
    expect(appendDealershipMention("Delivery day!", "facebook_feed", dealer)).toBe(
      "Delivery day!\n\n@Bob Maxey Ford of Howell",
    );
    expect(
      appendDealershipMention(
        "Delivery day!\n\n@Bob Maxey Ford of Howell",
        "facebook_feed",
        dealer,
      ),
    ).toBe("Delivery day!\n\n@Bob Maxey Ford of Howell");
  });

  it("does not treat a longer handle as the configured dealership mention", () => {
    expect(
      appendDealershipMention(
        "Delivery day with @BobMaxeyFordHowell!",
        "instagram_feed",
        dealer,
      ),
    ).toBe("Delivery day with @BobMaxeyFordHowell!\n\n@bobmaxeyford");
  });
});
