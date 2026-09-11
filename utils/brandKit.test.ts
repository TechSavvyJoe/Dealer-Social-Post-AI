import { describe, expect, it } from "vitest";
import {
  AGENCY_DISCOVERY_HASHTAGS,
  applyDealerBrandKit,
  TARGET_HASHTAG_COUNT,
} from "./brandKit";

describe("applyDealerBrandKit", () => {
  it("appends missing footer and brand hashtags", () => {
    const out = applyDealerBrandKit(
      "Keys in hand after a smooth delivery day with their new SUV.\nReady for the open road this weekend.\n#HappyCustomer",
      {
        name: "Sunrise Ford of Howell",
        default_hashtags: "New Car Delivery, LocalDealer",
        default_footer: "Visit us this week!",
      },
    );
    expect(out).toContain("Visit us this week!");
    expect(out).toContain("#SunriseFordOfHowell");
    expect(out).toContain("#NewCarDelivery");
    expect(out).toContain("#LocalDealer");
    expect(out).toContain("#HappyCustomer");
  });

  it("keeps every dealer hashtag when required_hashtags_locked is set", () => {
    const out = applyDealerBrandKit("Keys handed over. #Sunday #Weekend", {
      name: "Bob Maxey Ford",
      default_hashtags:
        "#BobMaxeyFord, #HowellMI, #FordFamily, #NewFord, #FordTrucks, #Built4Ford",
      required_hashtags_locked: true,
    });
    const tags = out.split("\n").pop() || "";
    for (const required of [
      "#BobMaxeyFord",
      "#HowellMI",
      "#FordFamily",
      "#NewFord",
      "#FordTrucks",
      "#Built4Ford",
    ]) {
      expect(tags).toContain(required);
    }
    // Discovery tags never displace a locked dealer tag.
    expect(tags).not.toContain("#NewCarDelivery");
  });

  it("still trims a long dealer list to the target when the lock is off", () => {
    const out = applyDealerBrandKit("Keys handed over.", {
      name: "Bob Maxey Ford",
      default_hashtags:
        "#HowellMI, #FordFamily, #NewFord, #FordTrucks, #Built4Ford, #Extra",
    });
    const tags = (out.split("\n").pop() || "").split(/\s+/).filter(Boolean);
    expect(tags).toHaveLength(5);
  });

  it("does not double-append the same footer", () => {
    const once = applyDealerBrandKit(
      "Hello from the delivery bay — another happy owner just got their keys.\nVisit us this week!",
      {
        name: "Acme Motors",
        default_footer: "Visit us this week!",
      },
    );
    const twice = applyDealerBrandKit(once, {
      name: "Acme Motors",
      default_footer: "Visit us this week!",
    });
    expect(twice.match(/Visit us this week!/g)?.length).toBe(1);
  });

  it("normalizes spaced dealer hashtags to PascalCase", () => {
    const out = applyDealerBrandKit(
      "Congrats on the new ride and a great day at the dealership.",
      {
        name: "Bob Maxey Ford of Howell",
        default_hashtags: "#Bob Maxey",
      },
    );
    expect(out).toMatch(/#BobMaxeyFordOfHowell/);
    // "#Bob Maxey" becomes #BobMaxey after format
    expect(out).toMatch(/#BobMaxey\b/);
  });

  it("fills thin captions to a marketing body floor and agency hashtag pack", () => {
    const out = applyDealerBrandKit("Nice car!", {
      name: "Sunrise Ford of Howell",
    });
    // Body expanded so salespeople never paste a stub
    expect(out.length).toBeGreaterThan(80);
    expect(out).toContain("Sunrise Ford of Howell");
    // Brand + agency discovery tags
    expect(out).toMatch(/#SunriseFordOfHowell/);
    const tags = out.match(/#[A-Za-z0-9_]+/g) || [];
    expect(tags.length).toBeGreaterThanOrEqual(4);
    expect(tags.length).toBeLessThanOrEqual(TARGET_HASHTAG_COUNT);
    expect(
      tags.some((t) => (AGENCY_DISCOVERY_HASHTAGS as readonly string[]).includes(t)),
    ).toBe(true);
  });

  it("produces a full paste-ready caption when AI returns empty text", () => {
    const out = applyDealerBrandKit("", { name: "Lakeside Auto Group" });
    expect(out).toContain("Lakeside Auto Group");
    const tags = out.match(/#[A-Za-z0-9_]+/g) || [];
    expect(tags.length).toBeGreaterThanOrEqual(4);
  });

  describe("deliveryLanguageAllowed", () => {
    // A Recall Completion or Customer Testimonial caption involves a real
    // customer but never a vehicle purchase/delivery. Before this, ANY short
    // caption for those scenarios — AI-written or a salesperson's own typed
    // text under the 120-char floor — got a vehicle-shopping CTA appended
    // ("...let's get you behind the wheel") regardless of scenario.
    it("does not append a vehicle-shopping CTA to a short caption when false", () => {
      const out = applyDealerBrandKit(
        "Sarah's recall was completed today. Thanks for trusting our service team!",
        { name: "Sunrise Ford of Howell" },
        false,
      );
      expect(out).not.toMatch(/behind the wheel|find the ride|delivery day|keys/i);
      expect(out).toContain("Sunrise Ford of Howell");
    });

    it("still appends the vehicle-shopping CTA when true or unset (unchanged default behavior)", () => {
      const withoutFlag = applyDealerBrandKit(
        "Sarah's recall was completed today. Thanks for trusting our service team!",
        { name: "Sunrise Ford of Howell" },
      );
      const explicitTrue = applyDealerBrandKit(
        "Sarah's recall was completed today. Thanks for trusting our service team!",
        { name: "Sunrise Ford of Howell" },
        true,
      );
      for (const out of [withoutFlag, explicitTrue]) {
        expect(out).toMatch(/behind the wheel/i);
      }
    });

    it("fills a completely empty caption with a non-delivery gratitude template when false", () => {
      const out = applyDealerBrandKit("", { name: "Lakeside Auto Group" }, false);
      expect(out).not.toMatch(/drove off|delivery day|keys in hand|behind the wheel/i);
      expect(out).toContain("Lakeside Auto Group");
    });

    it("never fills discovery hashtags with delivery tags when false, even once the body floor is already satisfied", () => {
      // Isolates the hashtag-merge path specifically: a caption already at
      // (or past) the 120-char body floor still went through
      // AGENCY_DISCOVERY_HASHTAGS unconditionally before this fix, since the
      // hashtag loops never read deliveryLanguageAllowed at all.
      const longEnough =
        "Sarah's recall was completed today after our service team diagnosed and resolved the issue same-day. Thanks for trusting us with your vehicle!";
      expect(longEnough.length).toBeGreaterThanOrEqual(120);
      const out = applyDealerBrandKit(
        longEnough,
        { name: "Bob Maxey Ford of Howell" },
        false,
      );
      const tags = out.match(/#[A-Za-z0-9_]+/g) || [];
      expect(tags).not.toEqual(
        expect.arrayContaining(["#NewCarDelivery", "#JustDelivered", "#KeysInHand"]),
      );
      expect(
        tags.some((t) =>
          ["#HappyCustomer", "#CustomerLove", "#TrustedService", "#ThankYou"].includes(
            t,
          ),
        ),
      ).toBe(true);
    });
  });
});
