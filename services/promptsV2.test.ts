import { afterEach, describe, expect, it } from "vitest";
import { StyleOption } from "../types";
import { FLAGS } from "./modelConfig";
import { editImagePrompt, generateImagePrompt } from "./promptConfig";
import {
  editImagePromptV2,
  generateImagePromptV2,
  isSafeOnImageHeadline,
} from "./promptsV2";

const longCustomCopy =
  "Thank you for trusting our team with your new vehicle. Call 555-867-5309 or visit example.com today! #HappyCustomer #NewRide";

describe("on-image headline guard", () => {
  it("keeps genuinely short, safe custom headlines exact", () => {
    const prompt = generateImagePromptV2(
      StyleOption.Modern,
      "Bob Maxey Ford of Howell",
      false,
      "SOLD TODAY",
    );

    expect(isSafeOnImageHeadline("SOLD TODAY")).toBe(true);
    expect(prompt).toContain(
      "<approved_exact_headline>SOLD TODAY</approved_exact_headline>",
    );
    expect(isSafeOnImageHeadline("You bought a car")).toBe(false);
  });

  it("withholds long caption copy, hashtags, URLs, and phone numbers", () => {
    const prompt = generateImagePromptV2(
      StyleOption.Friendly,
      "Bob Maxey Ford of Howell",
      false,
      longCustomCopy,
    );

    expect(isSafeOnImageHeadline(longCustomCopy)).toBe(false);
    expect(prompt).not.toContain(longCustomCopy);
    expect(prompt).not.toContain("#HappyCustomer");
    expect(prompt).not.toContain("555-867-5309");
    expect(prompt).not.toContain("example.com");
    expect(prompt).toContain("1-4 words");
    expect(prompt).toContain("40 characters");
    expect(prompt).toContain("Never render hashtags, URLs, phone numbers");
  });

  it("sanitizes unsafe text payloads in image edit requests", () => {
    const prompt = editImagePromptV2(
      `Change the headline to "${longCustomCopy}"`,
      "Bob Maxey Ford of Howell",
      false,
    );

    expect(prompt).not.toContain(longCustomCopy);
    expect(prompt).not.toContain("#NewRide");
    expect(prompt).toContain("newly summarized compliant headline");
    expect(prompt).not.toContain("<approved_exact_headline>");
    expect(prompt).toContain("1-4 words");

    const directCopyPrompt = editImagePromptV2(
      longCustomCopy,
      "Bob Maxey Ford of Howell",
      false,
    );
    expect(directCopyPrompt).not.toContain(longCustomCopy);

    const conversationalPrompt = editImagePromptV2(
      `Make it say ${longCustomCopy}`,
      "Bob Maxey Ford of Howell",
      false,
    );
    expect(conversationalPrompt).not.toContain(longCustomCopy);
    expect(conversationalPrompt).not.toContain("555-867-5309");
    expect(conversationalPrompt).not.toContain("example.com");
    expect(conversationalPrompt).not.toContain("#HappyCustomer");
    expect(conversationalPrompt).toContain("newly summarized compliant headline");
  });

  it("preserves an explicitly requested safe edit headline", () => {
    const prompt = editImagePromptV2(
      'Change the words on the image to "WELCOME HOME"',
      "Bob Maxey Ford of Howell",
      true,
    );

    expect(prompt).toContain(
      "<approved_exact_headline>\nWELCOME HOME\n</approved_exact_headline>",
    );
    expect(prompt).not.toContain('to "WELCOME HOME"');
  });

  it("does not mistake a short visual edit for headline copy", () => {
    const prompt = editImagePromptV2(
      "Make image brighter",
      "Bob Maxey Ford of Howell",
      false,
    );

    expect(prompt).toContain("Make image brighter");
    expect(prompt).not.toContain("<approved_exact_headline>");
  });
});

describe("legacy image prompt fallback", () => {
  const originalFlag = FLAGS.useV2Prompts;

  afterEach(() => {
    FLAGS.useV2Prompts = originalFlag;
  });

  it("uses the same guard for generation and editing", () => {
    FLAGS.useV2Prompts = false;

    const generationPrompt = generateImagePrompt(
      StyleOption.Luxury,
      "Bob Maxey Ford of Howell",
      false,
      longCustomCopy,
    );
    const editPrompt = editImagePrompt(
      `Replace the text with "${longCustomCopy}"`,
      "Bob Maxey Ford of Howell",
    );

    expect(generationPrompt).not.toContain(longCustomCopy);
    expect(editPrompt).not.toContain(longCustomCopy);
    expect(generationPrompt).toContain("HEADLINE COPY CONTRACT");
    expect(editPrompt).toContain("HEADLINE COPY CONTRACT");
    expect(editPrompt).toContain("NO EXACT HEADLINE IS APPROVED");
  });
});
