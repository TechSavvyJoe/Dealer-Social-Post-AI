import { describe, expect, it } from "vitest";
import {
  buildSafeMarketingCaption,
  cleanSocialCaption,
  ensureUsableCaption,
  isLowQualityCaption,
  captionUsesExpectedCustomer,
  captionUsesOnlyExpectedCustomer,
  unauthorizedCustomerNames,
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
        // Production always masks the signed-in salesperson; an unmasked
        // "Joe" helping someone is a person the guard cannot vouch for.
        { allowedPhrases: ["Lakeside Auto"], maskedPhrases: ["Joe"] },
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

  describe("shortened references to a multi-word dealership name", () => {
    // Bob Maxey Ford of Howell (a real dealer name shape): a caption almost
    // never repeats the configured dealer name verbatim. "Ford" or "Maxey
    // Ford" alone, immediately followed by a verb like "is"/"has", has the
    // exact grammar this scan exists to catch in a real customer name — so
    // without allowing the dealer's own name words, every delivery caption
    // for this dealer failed the identity check, whether or not a customer
    // name was ever supplied.
    const dealerName = "Bob Maxey Ford of Howell";

    it.each([
      "Our team at Bob Maxey Ford of Howell is proud to hand over the keys.",
      "Big smiles today! Our team at Bob Maxey Ford is proud to hand over the keys.",
      "Big smiles today! Ford is proud to help another family find their next ride.",
      "Maxey Ford has done it again — another vehicle delivered with a smile.",
    ])(
      "allows the dealership's own name however the caption shortens it: %s",
      (caption) => {
        expect(
          captionUsesOnlyExpectedCustomer(caption, undefined, {
            allowedPhrases: [dealerName],
            rejectAnyCustomerIdentity: true,
          }),
        ).toBe(true);
      },
    );

    it("still rejects a genuine unauthorized customer name for that same dealer", () => {
      expect(
        captionUsesOnlyExpectedCustomer(
          "Congrats to Sarah Jenkins on her brand new Bronco!",
          undefined,
          { allowedPhrases: [dealerName], rejectAnyCustomerIdentity: true },
        ),
      ).toBe(false);
    });

    it("does not let adjacent dealer-name-word placeholders collide into a false leftover-name match", () => {
      // Three consecutive allowed words ("Bob", "Maxey", "Ford") each scrub to
      // the same placeholder; a naive implementation can make those
      // placeholders themselves look like "Customer <Capitalized>", the
      // pattern that is supposed to catch a real leaked surname.
      expect(
        captionUsesOnlyExpectedCustomer(
          "Bob Maxey Ford is proud to help every driver in town.",
          undefined,
          { allowedPhrases: [dealerName], rejectAnyCustomerIdentity: true },
        ),
      ).toBe(true);
    });

    it("end to end: the exact model behavior that blocked every delivery post falls back cleanly when it still fails", () => {
      const shortened =
        "Big smiles today! Ford is proud to help another family find their next ride home.\n\n#BobMaxeyFordOfHowell";
      const result = ensureUsableCaption(shortened, {
        storeName: dealerName,
        customerIdentityRequired: true,
      });
      expect(result.usedFallback).toBe(false);
      expect(result.caption).toBe(shortened);
    });

    it.each([
      // A dealership is routinely named after real people, so a bare word
      // wide enough to excuse "Ford is proud..." is also a plausible real
      // first or last name. The exemption therefore only ever forgives the
      // dealer/OEM/vehicle word itself — the moment an unrelated capitalized
      // word sits directly before or after it, that word is the other half
      // of a real personal name and the whole thing is rejected.
      "Congrats to Bob Maxey Smith on his brand new Explorer!",
      "Congrats to Sarah Ford on her brand new Explorer!",
      "Meet Michelle Maxey! The whole team is excited to celebrate this delivery day.",
      "Congratulations, Bob Smith!",
      "Welcome home, Jordan Howell!",
    ])(
      "still rejects a real customer whose name shares a word with the dealer's name: %s",
      (caption) => {
        expect(
          captionUsesOnlyExpectedCustomer(caption, undefined, {
            allowedPhrases: [dealerName],
            rejectAnyCustomerIdentity: true,
          }),
        ).toBe(false);
      },
    );

    it("still rejects a real customer whose name shares a word with the vehicle phrase", () => {
      expect(
        captionUsesOnlyExpectedCustomer(
          "Congrats to Explorer Jones on the big purchase today!",
          undefined,
          {
            allowedPhrases: [dealerName, "2025 Ford Explorer"],
            rejectAnyCustomerIdentity: true,
          },
        ),
      ).toBe(false);
    });

    it.each([
      // Real marketing copy puts the dealer's own words, the OEM it sells,
      // and the town in exactly the grammar slots a customer name would
      // occupy. None of these name anyone, and every one of them blocked a
      // Customer Delivery post for Bob Maxey Ford of Howell.
      "Congrats, Ford family! Another happy delivery.",
      "Meet Howell's newest Bronco Sport owner!",
      "Huge shout-out to Bob Maxey Ford's delivery team!",
      "Shout-out to the Maxey Ford team!",
      "Thank you from Ford of Howell!",
      "Straight from Ford, built for Michigan roads.",
      "Delivered: Ford Bronco Sport. Another happy customer at Bob Maxey Ford of Howell.",
      "Congratulations to the Howell family on their new Expedition!",
    ])(
      "forgives the dealer's own name, OEM, and town wherever they stand alone: %s",
      (caption) => {
        expect(
          captionUsesOnlyExpectedCustomer(caption, undefined, {
            allowedPhrases: [dealerName, "Ford"],
            rejectAnyCustomerIdentity: true,
          }),
        ).toBe(true);
      },
    );

    it.each([
      // The caption model describes the photo, and the photo has a vehicle in
      // it — so it names the model, which this guard has never heard of
      // unless a VIN happened to be scanned. A determiner in front is the
      // tell: English never puts "this"/"your"/"our" before a given name.
      "This Bronco is ready for its first adventure with its proud new owner.",
      "The Explorer is heading home today. Congratulations on the new ride!",
      "Your new Mustang has every option you asked for.",
      "Her shiny new Escape just found its forever home.",
      "Big smiles as this Maverick takes its first drive home.",
      "Their gorgeous new Expedition is loaded and ready.",
    ])(
      "forgives a vehicle named after a determiner in the bare 'X is/has' shape: %s",
      (caption) => {
        expect(
          captionUsesOnlyExpectedCustomer(caption, undefined, {
            allowedPhrases: [dealerName],
            rejectAnyCustomerIdentity: true,
          }),
        ).toBe(true);
      },
    );

    it.each([
      // Everything the adversarial review found leaking through the first
      // draft of the widened exemption: dealer/OEM words used as HALF of a
      // real name, a real name handed off after a forgiven business run, a
      // possessive family name after "the", person-praising adjectives in
      // front of a name, and a new sentence on the next line.
      "Congrats to Ford Johnson on his brand new Explorer!",
      "Meet Ford Johnson, our newest Bronco owner!",
      "Welcome home, Ford Johnson!",
      "Congrats to Bob Howell on his brand new Explorer!",
      "Congrats to Bob Ford on his brand new Explorer!",
      "Welcome home, Bob Howell!",
      "Meet Bob Ford, the newest member of the family!",
      "Congrats to Maxey Howell on the new truck!",
      "Congrats to Bob on his brand new Explorer!",
      "Congrats to Bob Maxey on his brand new Explorer!",
      "Welcome to the family, Bob!",
      "Congratulations Bob! Enjoy the new Explorer.",
      "Congrats to Ford Bronco owner Sarah!",
      "Delivered: Ford Bronco Sport to Michelle Johnson!",
      "Congrats to Bob Maxey Ford's newest customer, Michelle!",
      "Meet Howell's newest owner Sarah!",
      "The Johnson's are all smiles today!",
      "The Smiths' are all smiles today!",
      "Our very own Sarah just took home her dream Bronco!",
      "Our amazing Sarah is all smiles with her new Explorer.",
      "Our own Michelle is officially a Bronco owner.",
      "Nothing beats a delivery like this\nMichelle is officially a Bronco owner!",
      "Sarah Smith is thrilled with her new Bronco.",
      "Our Sarah Ford is thrilled with her Explorer.",
      "The Johnsons love their new Explorer.",
      "Sarah and Mike love their new Explorer.",
    ])(
      "still refuses a person who shares words with the store or hides behind one: %s",
      (caption) => {
        expect(
          captionUsesOnlyExpectedCustomer(caption, undefined, {
            allowedPhrases: [dealerName, "Ford"],
            rejectAnyCustomerIdentity: true,
          }),
        ).toBe(false);
      },
    );

    it("refuses a second person handed off after the authorized first name", () => {
      expect(
        unauthorizedCustomerNames(
          "Congrats to Michelle and Bob Howell on their new Explorer!",
          "Michelle Johnson",
          { allowedPhrases: [dealerName, "Ford"] },
        ),
      ).not.toEqual([]);
    });

    it("refuses a customer whose name starts with the OEM the store sells", () => {
      expect(
        captionUsesOnlyExpectedCustomer(
          "Congrats to Lincoln Nguyen on her new Corsair!",
          undefined,
          {
            allowedPhrases: [dealerName, "Ford Lincoln"],
            rejectAnyCustomerIdentity: true,
          },
        ),
      ).toBe(false);
    });

    it.each([
      // Ordinary name-free copy the review found still refused.
      "Big smiles today! This Bronco Sport is ready for every Michigan adventure.",
      "Your new Bronco Sport is ready.",
      "This F-150 Lariat is ready for work.",
      "This Mustang Mach-E is ready.",
      "Your all-new 2025 Bronco is here.",
      "This Ford Bronco is heading home.",
      "This Ford Bronco Sport is heading home!",
      "Today is a great day for a new ride. Visit us in Howell.",
      "Everything is ready for delivery day.",
      "With love from Howell.",
      "Much love, Howell!",
      "Sending love from Bob Maxey Ford of Howell!",
      "Welcome to the Bob Maxey Ford of Howell Family!",
      "Bob Maxey Ford of Howell Team is proud.",
      "Thanks for choosing Bob Maxey Ford of Howell\nStop by and see us!",
      "Big smiles today!\nThis Bronco is heading home.",
      "Keys are in hand and the adventure begins.",
    ])("accepts ordinary name-free copy: %s", (caption) => {
      expect(
        unauthorizedCustomerNames(caption, undefined, {
          allowedPhrases: [dealerName, "Ford"],
          rejectAnyCustomerIdentity: true,
        }),
      ).toEqual([]);
    });

    it("does not treat the salesperson as the celebrated customer, but lets them appear in prose", () => {
      const options = {
        allowedPhrases: [dealerName, "Ford"],
        maskedPhrases: ["Joe Gallant", "Joe"],
        rejectAnyCustomerIdentity: true,
      };
      expect(
        captionUsesOnlyExpectedCustomer(
          "Joe Gallant is here to help. Ask for Joe Gallant at the store.",
          undefined,
          options,
        ),
      ).toBe(true);
      expect(
        captionUsesOnlyExpectedCustomer(
          "Congratulations to Joe Gallant on the new Bronco!",
          undefined,
          options,
        ),
      ).toBe(false);
    });

    it.each([
      // The determiner exemption must not reach past the words that can
      // legitimately sit between a determiner and a noun, and must not treat
      // "the" + pluralized surname (the exact shape a name read off a SOLD
      // sign in the photo takes) or conjunction-"that" as a determiner.
      "Her friend Michelle is thrilled with the new Bronco.",
      "We're thrilled that Sarah is part of the family.",
      "The Johnsons are all smiles today.",
      "Congrats to Michelle on her new Bronco!",
      "Michelle is officially taking the wheel today.",
    ])("still rejects a person in the bare 'X is/has' shape: %s", (caption) => {
      expect(
        captionUsesOnlyExpectedCustomer(caption, undefined, {
          allowedPhrases: [dealerName, "Ford"],
          rejectAnyCustomerIdentity: true,
        }),
      ).toBe(false);
    });

    // A dealer-name word forgiven in the bare "word, then verb" shape must not
    // shield an unrelated name joined next to it in the same list — the
    // exemption has to be applied per-token against the unmodified caption,
    // never by erasing the dealer word from the text before matching (that
    // breaks the list match itself and loses the other name along with it).
    it.each([
      "Jordan and Ford are picking up their new Explorer today.",
      "For Jordan and Ford are celebrating today.",
    ])(
      "still catches an unrelated unauthorized name list-joined next to a forgiven dealer word: %s",
      (caption) => {
        expect(
          captionUsesOnlyExpectedCustomer(caption, undefined, {
            allowedPhrases: [dealerName],
            rejectAnyCustomerIdentity: true,
          }),
        ).toBe(false);
      },
    );

    it("still catches a real two-word personal name with no list separator ('Sarah Ford is...')", () => {
      // CUSTOMER_NAME_TOKEN only spans a single capitalized word for the
      // bare-action pattern — a plain space never joins two words into one
      // candidate the way "and"/"&" does. So "Sarah Ford is thrilled..."
      // only ever yields "Ford" as a candidate, and "Sarah" is invisible to
      // the match entirely; forgiving "Ford" there would ship the whole real
      // name. This is the single most ordinary way to phrase a name, and the
      // surname alone coinciding with a dealer/vehicle word is realistic.
      expect(
        captionUsesOnlyExpectedCustomer(
          "Sarah Ford is thrilled with her new Explorer!",
          undefined,
          { allowedPhrases: [dealerName], rejectAnyCustomerIdentity: true },
        ),
      ).toBe(false);
    });

    it("still forgives two consecutive dealer-name words together ('Maxey Ford has...')", () => {
      // The preceding-word check must not reject a legitimate two-word (or
      // longer) run of the dealer's OWN name just because it is more than
      // one word — only an unrelated word ahead of the forgiven one should
      // block the exemption.
      expect(
        captionUsesOnlyExpectedCustomer(
          "Maxey Ford has done it again — another vehicle delivered with a smile.",
          undefined,
          { allowedPhrases: [dealerName], rejectAnyCustomerIdentity: true },
        ),
      ).toBe(true);
    });

    it("still catches a real name hiding behind a legitimate two-word dealer-name chain ('Sarah Maxey Ford is...')", () => {
      // "[Founder first] [Founder last] [Brand]" is a standard car-dealer
      // naming convention, so the allowed dealer name is itself routinely
      // two consecutive words ("Maxey Ford"). A single lookback hop isn't
      // enough to guard that: a genuinely unrelated third word one step
      // further back ("Sarah") must still be caught, not hidden behind the
      // already-legitimate two-word run sitting right in front of it.
      expect(
        captionUsesOnlyExpectedCustomer(
          "Sarah Maxey Ford is thrilled with her new Explorer!",
          undefined,
          { allowedPhrases: [dealerName], rejectAnyCustomerIdentity: true },
        ),
      ).toBe(false);
    });

    it("still catches a comma-separated direct address before a forgiven dealer word ('Sarah, Ford is...')", () => {
      // A vocative opener ("Name, sentence.") is at least as natural a
      // caption shape as the plain-space "Firstname Lastname" case above,
      // and the comma broke the original lookback (it only tolerated plain
      // whitespace between the preceding word and the match).
      expect(
        captionUsesOnlyExpectedCustomer(
          "Sarah, Ford is proud to help you find your next vehicle.",
          undefined,
          { allowedPhrases: [dealerName], rejectAnyCustomerIdentity: true },
        ),
      ).toBe(false);
    });

    it("does not misread a comma-separated opener from the OTHER customer-naming patterns as an unrelated name ('Helping, Ford is...')", () => {
      // Tolerating a comma before the forgiven word means a caption opener
      // like "Helping," or "Congratulations," can now sit right before it
      // too. Those words are the same opener vocabulary every OTHER pattern
      // in this file already matches on — treating them as an unrelated
      // customer would falsely reject a caption naming no one.
      expect(
        captionUsesOnlyExpectedCustomer(
          "Helping, Ford is thrilled to be part of your family!",
          undefined,
          { allowedPhrases: [dealerName], rejectAnyCustomerIdentity: true },
        ),
      ).toBe(true);
    });

    // The comma fix above only tolerated a comma before the forgiven word.
    // This file already trusts a wider headline-punctuation set elsewhere
    // (customerContextPatterns[6]/[7]: comma, colon, "!", en/em dash, hyphen —
    // "Jordan — new car day!" is an existing test), so a vocative opener
    // written with any of THOSE separators must be caught too, not just a
    // comma.
    it.each([
      "Sarah — Ford is proud to help you find your next vehicle.",
      "Sarah: Ford is proud to help you find your next vehicle.",
      "Sarah! Ford is proud to help you find your next vehicle.",
      "Sarah – Ford is proud to help you find your next vehicle.",
      "Sarah - Ford is proud to help you find your next vehicle.",
    ])(
      "still catches a direct address opener punctuated with something other than a comma: %s",
      (caption) => {
        expect(
          captionUsesOnlyExpectedCustomer(caption, undefined, {
            allowedPhrases: [dealerName],
            rejectAnyCustomerIdentity: true,
          }),
        ).toBe(false);
      },
    );
  });

  describe("deliveryLanguageAllowed", () => {
    // Recall Completion and Customer Testimonial both require a customer
    // (customerIdentityRequired: true) but neither is a vehicle
    // purchase/delivery — the app's own live prompt (services/promptsV2.ts,
    // deliveryLanguageAllowed: false for both) already forbids "just drove
    // off in..." language for them. The deterministic fallback used when AI
    // output fails the quality/identity gate must not contradict that.
    it("omits delivery/keys-in-hand language and hashtags when false", () => {
      const caption = buildSafeMarketingCaption({
        storeName: "Bob Maxey Ford of Howell",
        customerName: "Sarah",
        customerIdentityRequired: true,
        deliveryLanguageAllowed: false,
      });
      expect(caption).not.toMatch(/drove off|delivery day|keys in hand/i);
      expect(caption).not.toMatch(
        /#(?:NewCarDelivery|JustDelivered|KeysInHand|NewRide)/,
      );
      expect(caption).toContain("Sarah");
    });

    it("keeps today's delivery language when true or unset (customer_delivery, sold_by_salesperson)", () => {
      const explicit = buildSafeMarketingCaption({
        storeName: "Bob Maxey Ford of Howell",
        customerName: "Sarah",
        vehiclePhrase: "Ford Bronco",
        customerIdentityRequired: true,
        deliveryLanguageAllowed: true,
      });
      const defaulted = buildSafeMarketingCaption({
        storeName: "Bob Maxey Ford of Howell",
        customerName: "Sarah",
        vehiclePhrase: "Ford Bronco",
        customerIdentityRequired: true,
      });
      for (const caption of [explicit, defaulted]) {
        expect(caption).toMatch(/drove off/i);
        expect(caption).toContain("Ford Bronco");
      }
    });

    it("end to end via ensureUsableCaption/geminiService's deliveryLanguageAllowedForBrief wiring: a Recall Completion brief never falls back to delivery language", async () => {
      const { classifyCreativeBrief } = await import("../services/creativeSkills");
      const { ensureUsableCaption } = await import("./captionQuality");
      const recallBrief =
        "Post scenario: Recall Completion.\nScenario: Recall completion — a customer brought their vehicle in for a manufacturer recall and we resolved it the same day.";
      const scenario = classifyCreativeBrief(recallBrief).scenario;
      expect(scenario).toBe("recall_complete");

      const { deliveryLanguageAllowedForBrief } = await import("../services/promptsV2");
      const deliveryLanguageAllowed = deliveryLanguageAllowedForBrief(
        recallBrief,
        true,
      );
      expect(deliveryLanguageAllowed).toBe(false);

      const result = ensureUsableCaption("HOOK: x", {
        storeName: "Bob Maxey Ford of Howell",
        customerName: "Sarah",
        customerIdentityRequired: true,
        deliveryLanguageAllowed,
      });
      expect(result.usedFallback).toBe(true);
      expect(result.caption).not.toMatch(/drove off|delivery day/i);
    });
  });
});
