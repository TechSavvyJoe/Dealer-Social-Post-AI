import { describe, expect, it } from "vitest";
import {
  brandHashtagFromName,
  collapseSpacedHashtags,
  fitCaptionToBudget,
  formatHashtag,
  joinCaptionBodyAndTags,
  normalizeCaptionHashtags,
  parseHashtagInput,
  sanitizeHashtagBody,
  separateGluedHashtags,
  splitCaptionBodyAndTags,
} from "./hashtags";

describe("sanitizeHashtagBody / formatHashtag", () => {
  it("collapses multi-word phrases to PascalCase", () => {
    expect(sanitizeHashtagBody("New Car Delivery")).toBe("NewCarDelivery");
    expect(formatHashtag("happy customer")).toBe("#HappyCustomer");
  });

  it("preserves existing CamelCase tokens", () => {
    expect(formatHashtag("#NewCarDelivery")).toBe("#NewCarDelivery");
    expect(formatHashtag("SunriseFord")).toBe("#SunriseFord");
  });
});

describe("separateGluedHashtags", () => {
  it("inserts spaces between glued tags", () => {
    expect(separateGluedHashtags("#A#B#C")).toBe("#A #B #C");
    expect(separateGluedHashtags("Love it! #Sold#Happy")).toBe(
      "Love it! #Sold #Happy",
    );
  });
});

describe("collapseSpacedHashtags", () => {
  it("removes spaces inside a hashtag so platforms recognize the full tag", () => {
    expect(collapseSpacedHashtags("#New Car Delivery today")).toBe(
      "#NewCarDelivery today",
    );
    expect(collapseSpacedHashtags("#Happy Customer #Car Shopping")).toBe(
      "#HappyCustomer #CarShopping",
    );
  });
});

describe("normalizeCaptionHashtags", () => {
  it("fixes glued and spaced hashtags on a caption", () => {
    const input = `Keys in hand.
Visit Sunrise Ford today.
#Sunrise Ford#New Car Delivery#Happy Customer`;
    const out = normalizeCaptionHashtags(input);
    expect(out).toContain("#SunriseFord");
    expect(out).toContain("#NewCarDelivery");
    expect(out).toContain("#HappyCustomer");
    expect(out).not.toMatch(/#Sunrise\s+Ford/);
    expect(out).not.toMatch(/#\w+#\w+/);
  });

  it("rebuilds a pure hashtag line with single spaces", () => {
    const out = normalizeCaptionHashtags(
      "Congrats!\n#TagOne   #TagTwo  #TagOne",
    );
    expect(out.endsWith("#TagOne #TagTwo")).toBe(true);
  });

  it("strips trailing punctuation from tags", () => {
    expect(normalizeCaptionHashtags("#Sold.")).toContain("#Sold");
    expect(normalizeCaptionHashtags("#Sold.")).not.toContain("#Sold.");
  });
});

describe("brandHashtagFromName", () => {
  it("builds a continuous brand tag from a store name", () => {
    expect(brandHashtagFromName("Sunrise Ford of Howell")).toBe(
      "#SunriseFordOfHowell",
    );
  });
});

describe("fitCaptionToBudget", () => {
  it("drops trailing hashtags before cutting the body", () => {
    const body = "Short hook.\nVisit the store today.";
    const caption = `${body}\n#Brand #One #Two #Three #Four`;
    const fitted = fitCaptionToBudget(caption, body.length + 12);
    expect(fitted.startsWith("Short hook")).toBe(true);
    expect(fitted.length).toBeLessThanOrEqual(body.length + 12);
  });

  it("returns unchanged text when under budget", () => {
    const t = "Hello\n#A #B";
    expect(fitCaptionToBudget(t, 500)).toBe(t);
  });
});

describe("splitCaptionBodyAndTags / joinCaptionBodyAndTags", () => {
  it("splits a pure trailing hashtag line from the body", () => {
    const { body, tags } = splitCaptionBodyAndTags(
      "Keys ready.\nVisit us today.\n#SunriseFord #HappyCustomer #NewCar",
    );
    expect(body).toBe("Keys ready.\nVisit us today.");
    expect(tags).toEqual(["#SunriseFord", "#HappyCustomer", "#NewCar"]);
  });

  it("peels trailing tags from the last prose line", () => {
    const { body, tags } = splitCaptionBodyAndTags(
      "Come see us today #LocalDealer #TestDrive",
    );
    expect(body).toBe("Come see us today");
    expect(tags).toEqual(["#LocalDealer", "#TestDrive"]);
  });

  it("round-trips body + tags", () => {
    const joined = joinCaptionBodyAndTags("Hook line.\nCTA here.", [
      "#Brand",
      "happy customer",
    ]);
    expect(joined).toBe("Hook line.\nCTA here.\n#Brand #HappyCustomer");
    const again = splitCaptionBodyAndTags(joined);
    expect(again.body).toBe("Hook line.\nCTA here.");
    expect(again.tags).toEqual(["#Brand", "#HappyCustomer"]);
  });
});

describe("parseHashtagInput", () => {
  it("treats a plain phrase as one PascalCase tag", () => {
    expect(parseHashtagInput("New Car Delivery")).toEqual(["#NewCarDelivery"]);
  });

  it("splits comma-separated and # tokens", () => {
    expect(parseHashtagInput("New Car, Local Dealer")).toEqual([
      "#NewCar",
      "#LocalDealer",
    ]);
    expect(parseHashtagInput("#HappyCustomer #TestDrive")).toEqual([
      "#HappyCustomer",
      "#TestDrive",
    ]);
  });
});
