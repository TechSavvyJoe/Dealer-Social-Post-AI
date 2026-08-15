import { describe, expect, it } from "vitest";
import {
  buildSafeMarketingCaption,
  cleanSocialCaption,
  ensureUsableCaption,
  isLowQualityCaption,
  captionUsesExpectedCustomer,
  captionUsesOnlyExpectedCustomer,
} from "./captionQuality";

describe("cleanSocialCaption", () => {
  it("strips HOOK/STORY labels and XML junk", () => {
    const raw = `HOOK: Wow keys!
STORY: They are happy.
CTA: Visit us
#TagOne #TagTwo`;
    const out = cleanSocialCaption(raw);
    expect(out).not.toMatch(/HOOK/i);
    expect(out).not.toMatch(/STORY/i);
    expect(out).toContain("Wow keys");
  });

  it("strips preamble lines", () => {
    const out = cleanSocialCaption(
      "Here is your caption:\nKeys ready for Jordan.\nVisit Sunrise Ford.\n#SunriseFord #HappyCustomer",
    );
    expect(out.toLowerCase()).not.toContain("here is");
    expect(out).toContain("Keys ready");
  });
});

describe("isLowQualityCaption", () => {
  it("rejects gibberish and accepts a normal post", () => {
    expect(isLowQualityCaption("xqzplm vrrntqplk asdfghjkl qwertyuiop zxcvbnm")).toBe(
      true,
    );
    expect(
      isLowQualityCaption(
        "Keys in hand and big smiles — Jordan just drove off in their new ride.\n\nMoments like this are why we love Sunrise Ford.\n\nVisit Sunrise Ford this week.\n#SunriseFord #NewCarDelivery #HappyCustomer",
      ),
    ).toBe(false);
  });
});

describe("ensureUsableCaption", () => {
  it("returns a clean template when model output is garbage", () => {
    const { caption, usedFallback } = ensureUsableCaption("HOOK: xxxxx zzzz", {
      storeName: "Sunrise Ford of Howell",
      customerName: "Alex",
    });
    expect(usedFallback).toBe(true);
    expect(caption).toContain("Sunrise Ford of Howell");
    expect(caption).toContain("Alex");
    expect(caption).toMatch(/#SunriseFordOfHowell/);
    expect(caption).toMatch(/#NewCarDelivery/);
    expect(isLowQualityCaption(caption)).toBe(false);
  });

  it("keeps good model captions", () => {
    const good = buildSafeMarketingCaption({
      storeName: "Lakeside Auto",
      customerName: "Sam",
    });
    const { caption, usedFallback } = ensureUsableCaption(good, {
      storeName: "Lakeside Auto",
      customerName: "Sam",
    });
    expect(usedFallback).toBe(false);
    expect(caption).toContain("Sam");
  });

  it("rejects a fluent caption naming the wrong customer", () => {
    const wrong = buildSafeMarketingCaption({
      storeName: "Lakeside Auto",
      customerName: "Jordan",
    });
    const { caption, usedFallback } = ensureUsableCaption(wrong, {
      storeName: "Lakeside Auto",
      customerName: "Lisa Marie Sample",
    });

    expect(captionUsesExpectedCustomer(wrong, "Lisa Marie Sample")).toBe(false);
    expect(usedFallback).toBe(true);
    expect(caption).toContain("Lisa");
    expect(caption).not.toContain("Lisa Marie Sample");
    expect(caption).not.toContain("Jordan");
  });

  it("rejects a fluent caption that includes both the approved and an invented name", () => {
    const mixed =
      "Congratulations to Lisa and Jordan! Lisa and Jordan just found the perfect new ride at Lakeside Auto. We loved celebrating this delivery day with them. #LakesideAuto #DeliveryDay";

    expect(captionUsesExpectedCustomer(mixed, "Lisa Marie Sample")).toBe(false);
    expect(
      captionUsesOnlyExpectedCustomer(mixed, "Lisa", {
        allowedPhrases: ["Lakeside Auto"],
      }),
    ).toBe(false);

    const { caption, usedFallback } = ensureUsableCaption(mixed, {
      storeName: "Lakeside Auto",
      customerName: "Lisa Marie Sample",
    });
    expect(usedFallback).toBe(true);
    expect(caption).toContain("Lisa");
    expect(caption).not.toContain("Jordan");
  });

  it.each([
    "Congratulations to Lisa + Jordan! They are celebrating a wonderful delivery day at Lakeside Auto today.",
    "Congratulations to Lisa/Jordan! They are celebrating a wonderful delivery day at Lakeside Auto today.",
    "Welcome Lisa Jordan! The whole team is excited to celebrate this delivery day at Lakeside Auto.",
    "Welcome Lisa S.! The whole team is excited to celebrate this delivery day at Lakeside Auto.",
    "Welcome home, Jordan! The whole team is excited to celebrate this delivery day at Lakeside Auto.",
    "Jordan, welcome home! The whole team is excited to celebrate this delivery day at Lakeside Auto.",
    "Jordan — new car day! The whole team is excited to celebrate this delivery day at Lakeside Auto.",
    "A special moment for Jordan at Lakeside Auto, and the whole team is excited.",
    "Lisa is celebrating with Jordan at Lakeside Auto after a wonderful delivery.",
    "We loved helping Jordan at Lakeside Auto during this special delivery day.",
    "Congratulations to Joe! The whole team is excited to celebrate at Lakeside Auto.",
  ])("rejects an invented name joined with an adversarial separator: %s", (caption) => {
    expect(
      captionUsesOnlyExpectedCustomer(caption, "Lisa", {
        allowedPhrases: ["Lakeside Auto"],
      }),
    ).toBe(false);
  });

  it("allows a salesperson to help the approved customer without becoming the customer", () => {
    expect(
      captionUsesOnlyExpectedCustomer(
        "Joe just helped Lisa find the perfect vehicle at Lakeside Auto.",
        "Lisa",
        { allowedPhrases: ["Lakeside Auto"] },
      ),
    ).toBe(true);
  });

  it("rejects customer-like names when the post has no approved customer label", () => {
    const caption =
      "Meet Jordan! A memorable delivery day is underway at Lakeside Auto, and the whole team is excited.";

    expect(
      captionUsesOnlyExpectedCustomer(caption, undefined, {
        allowedPhrases: ["Lakeside Auto"],
        rejectAnyCustomerIdentity: true,
      }),
    ).toBe(false);

    const result = ensureUsableCaption(caption, {
      storeName: "Lakeside Auto",
    });
    expect(result.usedFallback).toBe(true);
    expect(result.caption).not.toContain("Jordan");
  });

  it("accepts grounded inventory copy when the structured scenario opts out", () => {
    const inventory =
      "Bronco just arrived at Lakeside Auto, and the showroom team is ready to share the details with local shoppers.";
    const result = ensureUsableCaption(inventory, {
      storeName: "Lakeside Auto",
      vehiclePhrase: "Bronco",
      customerIdentityRequired: false,
    });
    expect(result).toEqual({ caption: inventory, usedFallback: false });

    const fallback = ensureUsableCaption("HOOK: x", {
      storeName: "Lakeside Auto",
      vehiclePhrase: "2026 Ford Bronco",
      customerIdentityRequired: false,
    });
    expect(fallback.usedFallback).toBe(true);
    expect(fallback.caption).toContain("2026 Ford Bronco");
    expect(fallback.caption).not.toContain("our newest customer");
    expect(fallback.caption).toContain("#DealershipUpdate");
    expect(fallback.caption).not.toMatch(
      /#(?:NewCarDelivery|HappyCustomer|JustDelivered)/,
    );
  });

  it("allows grounded dealership and vehicle proper nouns", () => {
    const caption =
      "Welcome to Bob Maxey Ford! Lisa just chose a 2025 Ford Explorer and is ready for the road ahead. We loved celebrating this delivery day in Howell. #BobMaxeyFord #DeliveryDay";
    expect(
      captionUsesOnlyExpectedCustomer(caption, "Lisa", {
        allowedPhrases: ["Bob Maxey Ford", "2025 Ford Explorer"],
        requireExpected: true,
      }),
    ).toBe(true);
  });

  it("does not treat a longer invented name as the approved first name", () => {
    expect(
      captionUsesOnlyExpectedCustomer(
        "LisaMarie just celebrated a special delivery day.",
        "Lisa",
      ),
    ).toBe(false);
  });
});
