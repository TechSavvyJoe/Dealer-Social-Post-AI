import { describe, expect, it } from "vitest";
import {
  buildSafeMarketingCaption,
  cleanSocialCaption,
  ensureUsableCaption,
  isLowQualityCaption,
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
    expect(
      isLowQualityCaption("xqzplm vrrntqplk asdfghjkl qwertyuiop zxcvbnm"),
    ).toBe(true);
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
    });
    expect(usedFallback).toBe(false);
    expect(caption).toContain("Sam");
  });
});
