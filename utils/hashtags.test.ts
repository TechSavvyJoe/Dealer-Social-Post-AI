import { describe, expect, it } from "vitest";
import {
  brandHashtagFromName,
  collapseSpacedHashtags,
  formatHashtag,
  normalizeCaptionHashtags,
  sanitizeHashtagBody,
  separateGluedHashtags,
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
