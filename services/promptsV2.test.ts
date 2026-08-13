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

describe("image layout art direction", () => {
  const prompt = () =>
    generateImagePromptV2(StyleOption.Modern, "Bob Maxey Ford of Howell", false);

  // Each assertion below pins a defect observed in a real render against the
  // production image model. Removing any of these rules reintroduces a
  // specific, verified failure — not a hypothetical style preference.
  it("forbids the fabricated-OEM-emblem render defect", () => {
    // A render invented a Ford blue-oval badge when no logo image was supplied.
    // Fabricating a manufacturer trademark is a legal exposure, not a style bug.
    expect(prompt()).toContain("NEVER draw, redraw, recreate, or approximate a");
    expect(prompt()).toContain("render the store identity as TEXT ONLY");
  });

  it("forbids the drawn-frame render defect", () => {
    // A render read "margin on all four sides" as a literal white border and
    // inset the photograph inside it.
    expect(prompt()).toContain("The margin is interior breathing room only");
    expect(prompt()).toContain(
      "photograph always bleeds fully to all four canvas edges",
    );
  });

  it("forbids the edge-to-edge headline defect", () => {
    // A render stretched the headline to the canvas edge instead of sizing it
    // to fit inside the margin.
    expect(prompt()).toContain("SIZE TO FIT THE MARGIN");
  });

  it("requires a single grid, real type hierarchy, and no invented icons", () => {
    // The first render placed default-weight type at the edge, parked the store
    // name in an unrelated corner, and floated a clip-art key.
    const built = prompt();
    expect(built).toContain("layout_and_type_craft");
    expect(built).toContain("Never set two elements at nearly the same size");
    expect(built).toContain("NEVER INVENT GRAPHICS");
  });
});
