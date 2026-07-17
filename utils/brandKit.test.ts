import { describe, expect, it } from "vitest";
import { applyDealerBrandKit } from "./brandKit";

describe("applyDealerBrandKit", () => {
  it("appends missing footer and brand hashtags", () => {
    const out = applyDealerBrandKit("Keys in hand.\n#HappyCustomer", {
      name: "Sunrise Ford of Howell",
      default_hashtags: "New Car Delivery, LocalDealer",
      default_footer: "Visit us this week!",
    });
    expect(out).toContain("Visit us this week!");
    expect(out).toContain("#SunriseFordOfHowell");
    expect(out).toContain("#NewCarDelivery");
    expect(out).toContain("#LocalDealer");
    expect(out).toContain("#HappyCustomer");
  });

  it("does not double-append the same footer", () => {
    const once = applyDealerBrandKit("Hello\nVisit us this week!", {
      name: "Acme Motors",
      default_footer: "Visit us this week!",
    });
    const twice = applyDealerBrandKit(once, {
      name: "Acme Motors",
      default_footer: "Visit us this week!",
    });
    expect(twice.match(/Visit us this week!/g)?.length).toBe(1);
  });

  it("normalizes spaced dealer hashtags to PascalCase", () => {
    const out = applyDealerBrandKit("Congrats!", {
      name: "Bob Maxey Ford of Howell",
      default_hashtags: "#Bob Maxey",
    });
    expect(out).toMatch(/#BobMaxeyFordOfHowell/);
    // "#Bob Maxey" becomes #BobMaxey after format
    expect(out).toMatch(/#BobMaxey\b/);
  });
});
