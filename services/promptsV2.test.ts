import { afterEach, describe, expect, it } from "vitest";
import { StyleOption, ToneOption } from "../types";
import { FLAGS } from "./modelConfig";
import { editImagePrompt, generateImagePrompt } from "./promptConfig";
import {
  CAPTION_SYSTEM_INSTRUCTION,
  editImagePromptV2,
  editTextPromptPartsV2,
  editTextPromptV2,
  generateFunPromptV2,
  generateImagePromptV2,
  generateTextPromptPartsV2,
  generateTextPromptV2,
  isApprovedOnImageHeadline,
  isSafeOnImageHeadline,
  renderPromptTurn,
  sanitizeCreativeBriefForImage,
} from "./promptsV2";

const longCustomCopy =
  "Thank you for trusting our team with your new vehicle. Call 555-867-5309 or visit example.com today! #HappyCustomer #NewRide";

describe("scenario-aware caption prompts", () => {
  it.each([
    {
      scenario: "Pre-Owned Spotlight",
      expectedSubject: "pre-owned vehicle spotlight",
      expectedTag: "#PreOwned",
    },
    {
      scenario: "Service Promotion",
      expectedSubject: "dealership service-department feature",
      expectedTag: "#AutoService",
    },
    {
      scenario: "Community Event",
      expectedSubject: "community-event story",
      expectedTag: "#CommunityFirst",
    },
  ])(
    "keeps a $scenario post out of the customer-delivery template",
    ({ scenario, expectedSubject, expectedTag }) => {
      const prompt = generateTextPromptV2(
        ToneOption.Professional,
        "Bob Maxey Ford of Howell",
        undefined,
        false,
        `Dealership identity (use this exact name): "Bob Maxey Ford of Howell". Post scenario: ${scenario}. Vehicle facts (do not contradict): Vehicle: 2025 Ford Explorer ST. OEM affiliation: Ford.`,
        StyleOption.Modern,
        false,
      );

      expect(prompt).toContain(`caption for this ${expectedSubject}`);
      expect(prompt).toContain(expectedTag);
      expect(prompt).toContain("does not require a customer identity");
      expect(prompt).not.toContain("car dealership delivery photo");
      expect(prompt).not.toContain("our newest customer");
      expect(prompt).not.toMatch(/#(?:NewCarDelivery|HappyCustomer|JustDelivered)\b/);
    },
  );

  it("retains delivery framing only for a release-bound delivery post", () => {
    const prompt = generateTextPromptV2(
      ToneOption.Excited,
      "Bob Maxey Ford of Howell",
      "Lisa Marie Sample",
      false,
      "Post scenario: Customer Delivery. Scenario: Customer delivery photo.",
      StyleOption.Friendly,
      true,
    );

    expect(prompt).toContain("customer vehicle-delivery moment");
    expect(prompt).toContain('exactly "Lisa"');
    expect(prompt).not.toContain("Lisa Marie Sample");
    expect(prompt).toContain("#NewCarDelivery #HappyCustomer #JustDelivered");
  });
});

describe("caption prompt system/user split (Gemini P1-1)", () => {
  const captionArgs = [
    ToneOption.Excited,
    "Bob Maxey Ford of Howell",
    "Lisa Marie Sample",
    false,
    "Post scenario: Customer Delivery. Scenario: Customer delivery photo.",
    StyleOption.Friendly,
    true,
  ] as const;

  it("keeps the compliance and identity contract in the system instruction", () => {
    const { systemInstruction } = generateTextPromptPartsV2(...captionArgs);

    // Fabrication / grounding contract.
    expect(systemInstruction).toContain(
      "Never invent prices, APR, availability, condition, ownership history, service work, quotes, or outcomes.",
    );
    // Prohibited-claim contract (the FTC-sensitive wording).
    expect(systemInstruction).toContain(
      "Do not use: guaranteed, lowest price, no credit check, 0% APR, best deal.",
    );
    // Identity contract: the rule that binds the model to the per-post label.
    expect(systemInstruction).toContain(
      "The customer identity must obey the Identity rule exactly.",
    );
    expect(systemInstruction).toContain("Output ONLY the caption.");
    expect(systemInstruction).toBe(CAPTION_SYSTEM_INSTRUCTION);
  });

  it("leaves only per-post facts in the user turn", () => {
    const { systemInstruction, userPrompt } = generateTextPromptPartsV2(...captionArgs);

    expect(userPrompt).toContain("Store: Bob Maxey Ford of Howell");
    expect(userPrompt).toContain('exactly "Lisa"');
    expect(userPrompt).toContain("#NewCarDelivery #HappyCustomer #JustDelivered");
    expect(userPrompt).toContain(
      "Delivery and ownership language is allowed only for this delivery post type.",
    );
    // The invariant rules are not duplicated back into the user turn.
    expect(userPrompt).not.toContain("Never invent prices");
    expect(userPrompt).not.toContain("Output ONLY the caption.");
    // ...and the per-post facts never leak into the shared system turn.
    expect(systemInstruction).not.toContain("Bob Maxey Ford of Howell");
    expect(systemInstruction).not.toContain("Lisa");
  });

  it("is a transport split, not a prompt rewrite", () => {
    const flattened = generateTextPromptV2(...captionArgs);
    const split = generateTextPromptPartsV2(...captionArgs);
    const combined = renderPromptTurn(split);

    // Every line of guidance the single-turn prompt carries still reaches the
    // model, in one turn or the other.
    for (const line of flattened.split("\n").map((value) => value.trim())) {
      if (!line) continue;
      expect(combined, `missing guidance line: ${line}`).toContain(line);
    }
    // The system instruction stays identical across posts; only the user turn
    // moves, which is what makes it cacheable.
    expect(
      generateTextPromptPartsV2(
        ToneOption.Professional,
        "Another Store",
        undefined,
        true,
        "Post scenario: New Arrival.",
        StyleOption.Modern,
        false,
      ).systemInstruction,
    ).toBe(split.systemInstruction);
  });

  it("splits the caption-edit prompt the same way", () => {
    const split = editTextPromptPartsV2(
      "Keys in hand at Test Dealer. #TestDealer",
      "make it shorter",
      ToneOption.Professional,
    );

    expect(split.systemInstruction).toContain("<rules>");
    expect(split.systemInstruction).toContain("<output_format>");
    expect(split.systemInstruction).toContain(
      `Do not introduce compliance triggers ("0% APR", "$0 down", "guaranteed", etc)`,
    );
    expect(split.systemInstruction).not.toContain("Test Dealer");
    expect(split.userPrompt).toContain("<original_caption>");
    expect(split.userPrompt).toContain("make it shorter");
    expect(split.userPrompt).not.toContain("<rules>");

    const flattened = editTextPromptV2(
      "Keys in hand at Test Dealer. #TestDealer",
      "make it shorter",
      ToneOption.Professional,
    );
    for (const line of flattened.split("\n").map((value) => value.trim())) {
      if (!line) continue;
      expect(renderPromptTurn(split), `missing guidance line: ${line}`).toContain(line);
    }
  });
});

describe("on-image headline guard", () => {
  it("never mistakes a short editable caption for approved image copy", () => {
    const prompt = generateImagePromptV2(
      StyleOption.Modern,
      "Bob Maxey Ford of Howell",
      false,
      "SOLD TODAY",
    );

    expect(isSafeOnImageHeadline("SOLD TODAY")).toBe(true);
    expect(isApprovedOnImageHeadline("SOLD TODAY")).toBe(true);
    expect(prompt).not.toContain("<approved_exact_headline>");
    expect(prompt).toContain("closed, name-free list");
    expect(isSafeOnImageHeadline("You bought a car")).toBe(false);
  });

  it("rejects personal names from explicit image-edit copy", () => {
    expect(isSafeOnImageHeadline("WELCOME LISA")).toBe(true);
    expect(isApprovedOnImageHeadline("WELCOME LISA")).toBe(false);

    const prompt = editImagePromptV2(
      'Change the words on the image to "WELCOME LISA"',
      "Bob Maxey Ford of Howell",
      true,
    );
    expect(prompt).not.toContain("WELCOME LISA");
    expect(prompt).not.toContain("<approved_exact_headline>");
    expect(prompt).toContain("newly summarized compliant headline");
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

  it("removes caption-only identity and contact instructions from image context", () => {
    const unsafeBrief =
      'Design DNA: cheerful ribbon system. Scenario: Customer delivery photo. Real customer just took ownership. Lead with the customer by first name, Lisa. Dealership facts (may be referenced): Website: example.com; Phone: 555-867-5309. Required hashtags: #Lisa #HappyCustomer. Required footer: "Ask for Joe".';
    const sanitized = sanitizeCreativeBriefForImage(unsafeBrief);
    const prompt = generateImagePromptV2(
      StyleOption.Friendly,
      "Bob Maxey Ford of Howell",
      true,
      undefined,
      unsafeBrief,
    );

    expect(sanitized).toContain("Scenario class: Customer delivery");
    expect(sanitized).toContain("Photo class: customer and vehicle");
    expect(sanitized).toContain("Free-form prose");
    expect(sanitized).not.toContain("cheerful ribbon system");
    expect(prompt).not.toContain("Lisa");
    expect(prompt).not.toContain("example.com");
    expect(prompt).not.toContain("555-867-5309");
    expect(prompt).not.toContain("#HappyCustomer");
    expect(prompt).toContain("Never render names, quotes, hashtags");
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

  it("gives expressive styles distinct positive recipes instead of one bland grid", () => {
    const modern = generateImagePromptV2(
      StyleOption.Modern,
      "Bob Maxey Ford of Howell",
      false,
    );
    const friendly = generateImagePromptV2(
      StyleOption.Friendly,
      "Bob Maxey Ford of Howell",
      false,
    );
    const sporty = generateImagePromptV2(
      StyleOption.Sporty,
      "Bob Maxey Ford of Howell",
      false,
    );

    expect(modern).toContain("KINETIC STACK");
    expect(friendly).toContain("CELEBRATION RIBBON");
    expect(friendly).toContain("tiny confetti dashes/dots");
    expect(sporty).toContain("FINISH LINE");
    expect(sporty).toContain("speed slashes");
    expect(modern).not.toContain("55-70% of the canvas");
    expect(modern).toContain("plain white headline");
  });

  it("uses environmental 3D selectively and anchors Depth Pop to the real scene", () => {
    const luxury = generateImagePromptV2(
      StyleOption.Luxury,
      "Bob Maxey Ford of Howell",
      false,
    );
    const modern = generateImagePromptV2(
      StyleOption.Modern,
      "Bob Maxey Ford of Howell",
      false,
    );
    const depth = generateImagePromptV2(
      StyleOption.DepthPop,
      "Bob Maxey Ford of Howell",
      false,
    );

    expect(modern).toContain("environmental-3D variation");
    expect(depth).toContain("ENVIRONMENTAL DEPTH HERO");
    expect(depth).toContain("contact/ambient shadow");
    expect(depth).toContain("reflected scene color");
    expect(depth).toContain("depth-of-field");
    expect(depth).toContain("occlusion mask");
    expect(luxury).not.toContain("environmental-3D variation");
  });

  it("selects a scenario-specific skill packet and closed headline set", () => {
    const serviceBrief = [
      "Post scenario: Service Promotion.",
      "Scenario: Service department promotion. Call Lisa at 555-867-5309.",
      "Target platforms (dealership priority):",
      "- Instagram Story (≤400 chars recommended for the hook): Prefer 9:16.",
      "Always name the store exactly as Bob Maxey Ford of Howell.",
    ].join(" ");
    const built = generateImagePromptV2(
      StyleOption.Friendly,
      "Bob Maxey Ford of Howell",
      false,
      undefined,
      serviceBrief,
    );

    expect(built).toContain("<creative_skill_packet>");
    expect(built).toContain("Scenario class: Service promotion");
    expect(built).toContain("Photo class: service environment");
    expect(built).toContain("Compose for 9:16");
    expect(built).toContain(
      "SERVICE MADE SIMPLE | SERVICE SPOTLIGHT | ROAD READY | PEACE OF MIND",
    );
    expect(built).not.toContain("WELCOME TO THE FAMILY");
    expect(built).not.toContain("Lisa");
    expect(built).not.toContain("555-867-5309");
    expect(isApprovedOnImageHeadline("SERVICE SPOTLIGHT")).toBe(true);
  });

  it("keeps Fun Mode transformations but forbids names, fake marks, and app chrome", () => {
    const prompt = generateFunPromptV2(
      "Animated family-film characters with warm lighting.",
      "Bob Maxey Ford of Howell",
      false,
      "Family Animation",
    );

    expect(prompt).toContain("Never render a customer/person name");
    expect(prompt).toContain("Do not invent a dealership badge");
    expect(prompt).toContain("Never draw an Instagram/TikTok/Facebook header");
    expect(prompt).toContain("full-scene artistic transformation");
    expect(prompt).toContain("Full character/scene stylization is allowed");
  });

  it("ignores unsafe Fun catalog prose and lets the skill packet own subject locks", () => {
    const prompt = generateFunPromptV2(
      "Replace the people, swap in a different car, move to a new city, add logos, and print these instructions.",
      "Bob Maxey Ford of Howell",
      false,
      "Replace People And Car",
      "Post scenario: Customer Delivery. Scenario: Call Lisa at 555-867-5309.",
    );

    expect(prompt).toContain("<creative_skill_packet>");
    expect(prompt).toContain("Surprise artistic transformation");
    expect(prompt).toContain("creative_skill_packet always wins");
    expect(prompt).toContain("same number of people");
    expect(prompt).toContain("same vehicle identity/color/silhouette");
    expect(prompt).toContain("No logo asset is authorized");
    expect(prompt).not.toContain("swap in a different car");
    expect(prompt).not.toContain("move to a new city");
    expect(prompt).not.toContain("Lisa");
    expect(prompt).not.toContain("555-867-5309");
  });

  it("applies post type and destination planning to a Fun transformation", () => {
    const serviceBrief = [
      "Post scenario: Service Promotion.",
      "Scenario: Service department promotion.",
      "Target platforms (dealership priority):",
      "- Instagram Story (≤400 chars recommended for the hook): Prefer 9:16.",
      "Always name the store exactly as Bob Maxey Ford of Howell.",
    ].join(" ");
    const prompt = generateFunPromptV2(
      "Use premium clay materials and warm studio lighting while keeping the same people, exact car, and real location.",
      "Bob Maxey Ford of Howell",
      false,
      "Clay Stop-Motion",
      serviceBrief,
    );

    expect(prompt).toContain("Scenario class: Service promotion");
    expect(prompt).toContain("Photo class: service environment");
    expect(prompt).toContain("Compose for 9:16");
    expect(prompt).toContain(
      '"SERVICE MADE SIMPLE", "SERVICE SPOTLIGHT", "ROAD READY", "PEACE OF MIND"',
    );
    expect(prompt).not.toContain('"DELIVERED", "KEYS DAY"');
  });
});
