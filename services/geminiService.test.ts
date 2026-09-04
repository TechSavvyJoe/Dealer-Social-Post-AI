import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createVideoBlobUrl,
  editSocialPostTextDetailed,
  fetchVideoThroughProxy,
  generateFunSocialPostImage,
  generatePlatformCaptionPack,
  generateSocialPost,
  generateSocialPostTextDetailed,
  generatePostVideo,
  generateWebsiteDraftMetadata,
  resetStructuredJsonSupport,
  reviewGeneratedImageText,
  type GeneratedImageTextReview,
} from "./geminiService";
import { setProxyCapabilities } from "./proxyCapabilities";
import { parsePlatformCaptionPack } from "./platformCopy";
import { StyleOption, ToneOption, VideoStyle } from "../types";
import {
  FLAGS,
  MODEL_POLICY,
  MODEL_POLICY_VERSION,
  MODELS,
  TASKS,
} from "./modelConfig";
import { generateTextViaClaude } from "./claudeAdapter";
import { generateImageViaOpenAI } from "./openaiAdapter";
import {
  createBlockedContentError,
  normalizeError,
  type NormalizedError,
} from "../utils/errorHandler";

// Hoist the mocks so they can be used in the mock factory
const { mockGenerateContent, mockGenerateVideos, mockGetVideosOperation } = vi.hoisted(
  () => {
    return {
      mockGenerateContent: vi.fn(),
      mockGenerateVideos: vi.fn(),
      mockGetVideosOperation: vi.fn(),
    };
  },
);

type ProxyPolicies = {
  buildGeminiProxyRequest: (
    path: string,
    input: unknown,
    requestedTaskName?: string,
  ) => Record<string, unknown> | null;
};

const loadPocketBaseRequestPolicies = (): ProxyPolicies => {
  const source = readFileSync(
    resolve(process.cwd(), "pb_hooks/requestPolicies.js"),
    "utf8",
  );
  const commonJsModule = { exports: {} as ProxyPolicies };
  new Function("module", "exports", source)(commonJsModule, commonJsModule.exports);
  return commonJsModule.exports;
};

// Mock dependencies
vi.mock("./geminiClient", () => ({
  getGeminiClient: () => ({
    models: {
      generateContent: mockGenerateContent,
      generateVideos: mockGenerateVideos,
    },
    operations: {
      getVideosOperation: mockGetVideosOperation,
    },
  }),
  requireGeminiApiKey: () => "fake-api-key",
}));

// Keep the real `shouldFallbackTo*` predicates; only the network calls are
// stubbed so the fallback decision itself is what gets exercised.
vi.mock("./claudeAdapter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./claudeAdapter")>();
  return { ...actual, generateTextViaClaude: vi.fn() };
});

vi.mock("./openaiAdapter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./openaiAdapter")>();
  return { ...actual, generateImageViaOpenAI: vi.fn() };
});

vi.mock("../utils/imageUtils", () => ({
  parseDataUrl: (source: string) => {
    const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(source);
    if (!match) throw new Error("Invalid data URL");
    return { mimeType: match[1], data: match[2].replace(/\s/g, "") };
  },
  urlToDataUrl: () => Promise.resolve("data:image/jpeg;base64,fake-data"),
  letterboxImageForVideo: (dataUrl: string) => Promise.resolve(dataUrl),
  resolveVeoAspect: () => "9:16" as const,
}));

const makeMp4Bytes = (size = 2048): Uint8Array => {
  const bytes = new Uint8Array(size);
  // ISO-BMFF file-type box: 4-byte box size followed by "ftyp" + major brand.
  bytes.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  return bytes;
};

const stubLoadedVideoImage = () => {
  vi.stubGlobal(
    "Image",
    class {
      onload: () => void = () => {};
      onerror: () => void = () => {};
      width = 100;
      height = 100;
      private value = "";

      set src(value: string) {
        this.value = value;
        queueMicrotask(() => this.onload());
      }

      get src(): string {
        return this.value;
      }
    },
  );
};

const compliantImageTextReview: GeneratedImageTextReview = {
  compliant: true,
  uncertain: false,
  detectedMarketingText: ["WELCOME HOME"],
  marketingWordCount: 2,
  marketingCharacterCount: 12,
  hasFullSentence: false,
  hasHashtag: false,
  hasUrlOrPhone: false,
  logoPresent: false,
  logoMatchesSuppliedAsset: true,
  hasUnexpectedPersonalName: false,
  detectedPersonalNames: [],
  dealershipNamePresent: true,
  dealershipNameCorrect: true,
  hasFabricatedBrandMark: false,
  hasInstructionText: false,
  hasSocialUiChrome: false,
  isIllustrationOrCharacterRender: false,
  preservesSourceSubjects: true,
  preservesVehicleIdentity: true,
  preservesSourceComposition: true,
  isRespectfulAndFlattering: true,
  isPlatformAppropriate: true,
  visualQualityScore: 4,
  hasDistinctStyleSignature: true,
  hasCleanTypography: true,
  violations: [],
};

const imageTextReviewResponse = (
  review: GeneratedImageTextReview = compliantImageTextReview,
) => ({
  text: () => JSON.stringify(review),
  candidates: [{ content: { parts: [{ text: JSON.stringify(review) }] } }],
});

const isImageTextReviewRequest = (request: {
  contents?: { parts?: Array<{ text?: string }> };
}) =>
  request.contents?.parts?.some((part) =>
    part.text?.includes("strict visual quality-control inspector"),
  ) === true;

const generatedImageResponse = (data = "generated-image-data") => ({
  candidates: [
    {
      content: {
        parts: [{ inlineData: { mimeType: "image/png", data } }],
      },
    },
  ],
});

/**
 * These tests pin the model-routing behaviour after the 2026-05-27 refactor
 * that moved hardcoded model IDs into `services/modelConfig.ts`. The asserts
 * now check that calls hit *whatever* model the config declares as primary
 * for each task, so if Joe bumps a model in modelConfig the tests follow.
 */
describe("GeminiService model routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The structured-output latch is per session, not per call: reset it so a
    // test that proves the old-server fallback cannot disarm later tests.
    resetStructuredJsonSupport();

    mockGenerateContent.mockImplementation((request) => {
      if (isImageTextReviewRequest(request)) return imageTextReviewResponse();
      return Promise.resolve({
        text: () =>
          "A fresh set of keys and a picture-perfect delivery day at Test Dealer. Congratulations on the new ride! #TestDealer",
        ...generatedImageResponse(),
      });
    });

    mockGenerateVideos.mockResolvedValue({
      done: true,
      response: {
        generatedVideos: [{ video: { uri: "http://fake-video-url.com/video.mp4" } }],
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("routes text generation through the caption task's primary model", async () => {
    await generateSocialPost(
      "data:image/jpeg;base64,fake",
      StyleOption.Modern,
      ToneOption.Professional,
      "Test Dealer",
    );

    const expected = TASKS.caption.primary;
    // Match on the task, not just the model id: the vision-QC review runs on
    // the same primary model and would otherwise be picked up here.
    const textCall = mockGenerateContent.mock.calls.find(
      (call) => call[0].task === "caption" && call[0].model === expected,
    );
    expect(textCall, `expected a caption call with model=${expected}`).toBeDefined();
    expect(textCall?.[0].generationConfig).toEqual({
      maxOutputTokens: 2048,
      thinkingConfig: { thinkingLevel: "low" },
    });
    expect(textCall?.[0].generationConfig).not.toHaveProperty("temperature");
    expect(textCall?.[0].generationConfig).not.toHaveProperty("topK");
    expect(textCall?.[0].generationConfig).not.toHaveProperty("topP");

    // P1-1: the invariant compliance and identity rules ride in the system
    // instruction; only per-post facts stay in the user turn.
    const systemText = (
      textCall?.[0].systemInstruction?.parts as Array<{ text: string }> | undefined
    )
      ?.map((part) => part.text)
      .join("\n");
    expect(systemText).toContain(
      "Never invent prices, APR, availability, condition, ownership history, service work, quotes, or outcomes.",
    );
    expect(systemText).toContain(
      "Do not use: guaranteed, lowest price, no credit check, 0% APR, best deal.",
    );
    expect(systemText).toContain(
      "The customer identity must obey the Identity rule exactly.",
    );
    const userText = (
      textCall?.[0].contents?.parts as Array<{ text?: string }> | undefined
    )?.[0]?.text;
    expect(userText).toContain("Store: Test Dealer");
    expect(userText).not.toContain("Never invent prices");

    // The split request must still satisfy the server allowlist verbatim.
    expect(
      loadPocketBaseRequestPolicies().buildGeminiProxyRequest(
        `v1beta/models/${textCall?.[0].model}:generateContent`,
        {
          contents: [textCall?.[0].contents],
          generationConfig: textCall?.[0].generationConfig,
          systemInstruction: textCall?.[0].systemInstruction,
        },
        textCall?.[0].task,
      ),
    ).not.toBeNull();
  });

  it("routes standard image generation through Pro Image first", async () => {
    await generateSocialPost(
      "data:image/jpeg;base64,fake",
      StyleOption.Modern,
      ToneOption.Professional,
      "Test Dealer",
    );

    const expected = TASKS.image_standard.primary;
    const imageCall = mockGenerateContent.mock.calls.find(
      (call) => call[0].model === expected,
    );
    expect(imageCall, `expected a call with model=${expected}`).toBeDefined();
    expect(imageCall?.[0].generationConfig).toMatchObject({
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: { imageSize: "2K" },
      maxOutputTokens: 4096,
    });
  });

  it("uses the final generated image instead of an interim thought image", async () => {
    mockGenerateContent.mockImplementation((request) => {
      if (isImageTextReviewRequest(request)) return imageTextReviewResponse();
      return Promise.resolve({
        candidates: [
          {
            content: {
              parts: [
                {
                  thought: true,
                  inlineData: {
                    mimeType: "image/png",
                    data: "interim-thought-image",
                  },
                },
                {
                  inlineData: {
                    mimeType: "image/jpeg",
                    data: "final-publishable-image",
                  },
                },
              ],
            },
          },
        ],
      });
    });

    await expect(
      generateFunSocialPostImage("data:image/jpeg;base64,fake", "Final Image Dealer"),
    ).resolves.toBe("data:image/jpeg;base64,final-publishable-image");
  });

  it("accepts a generated image after one strict compliant vision result", async () => {
    let imageCalls = 0;
    let reviewCalls = 0;
    mockGenerateContent.mockImplementation((request) => {
      if (isImageTextReviewRequest(request)) {
        reviewCalls += 1;
        return imageTextReviewResponse();
      }
      if (request.generationConfig?.responseModalities?.includes("IMAGE")) {
        imageCalls += 1;
        return Promise.resolve(generatedImageResponse("compliant-first-image"));
      }
      return Promise.resolve({
        text: () => "A compliant delivery caption for Test Dealer. #DeliveryDay",
      });
    });

    const result = await generateSocialPost(
      "data:image/jpeg;base64,original-photo",
      StyleOption.Modern,
      ToneOption.Professional,
      "Test Dealer",
    );

    expect(result.image).toBe("data:image/png;base64,compliant-first-image");
    expect(imageCalls).toBe(1);
    expect(reviewCalls).toBe(1);
    const reviewRequest = mockGenerateContent.mock.calls.find(([request]) =>
      isImageTextReviewRequest(request),
    )?.[0];
    // The QC review is the one text call that pays for "medium" reasoning:
    // it decides whether a flawed render reaches a customer's feed. Captions
    // stay at "low" because thinking tokens bill as output.
    expect(reviewRequest?.task).toBe("vision_review");
    expect(reviewRequest?.purpose).toBe("vision_review");
    // The QC verdict is schema-bound JSON: the browser sends only the
    // registry id and the proxy injects the schema body.
    expect(reviewRequest?.generationConfig).toEqual({
      maxOutputTokens: 2048,
      thinkingConfig: { thinkingLevel: "medium" },
      responseMimeType: "application/json",
      schemaId: "vision_review_v1",
    });
    const captionRequest = mockGenerateContent.mock.calls.find(
      ([request]) => request.task === "caption",
    )?.[0];
    // Captions stay prose; only the JSON-shaped calls opt into a schema.
    expect(captionRequest?.generationConfig).toEqual({
      maxOutputTokens: 2048,
      thinkingConfig: { thinkingLevel: "low" },
    });
    // A schema BODY must never leave the browser — only the id.
    expect(reviewRequest?.generationConfig).not.toHaveProperty("responseSchema");
    expect(reviewRequest?.generationConfig).not.toHaveProperty("responseJsonSchema");
    expect(
      mockGenerateContent.mock.calls.some(([request]) =>
        request.contents?.parts?.some(
          (part: { text?: string }) =>
            part.text?.includes("text_compliance_retry") ||
            part.text?.includes("Reduce the AI-added marketing overlay text"),
        ),
      ),
    ).toBe(false);
  });

  it("fails before the provider call when source and output cannot fit the proxy review budget", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    const perImageBudget = Math.floor(
      MODEL_POLICY.requestLimits.maxTotalInlineImageChars / 2,
    );
    const oversizedLength = Math.ceil((perImageBudget + 1) / 4) * 4;
    const oversized = `data:image/png;base64,${"A".repeat(oversizedLength)}`;

    await expect(
      reviewGeneratedImageText(oversized, "Payload Test Dealer", {
        sourceImageBase64Url: oversized,
      }),
    ).rejects.toThrow("secure proxy payload budget");
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it("re-renders a noncompliant image with tighter copy before reducing text", async () => {
    let imageCalls = 0;
    let reviewCalls = 0;
    const noncompliantReview: GeneratedImageTextReview = {
      ...compliantImageTextReview,
      compliant: false,
      detectedMarketingText: [
        "Big smiles all around as the family celebrates their new vehicle today",
      ],
      marketingWordCount: 11,
      marketingCharacterCount: 68,
      hasFullSentence: true,
      violations: ["too_many_words", "too_many_characters", "full_sentence"],
    };
    mockGenerateContent.mockImplementation((request) => {
      if (isImageTextReviewRequest(request)) {
        reviewCalls += 1;
        return imageTextReviewResponse(
          reviewCalls === 1 ? noncompliantReview : compliantImageTextReview,
        );
      }
      if (request.generationConfig?.responseModalities?.includes("IMAGE")) {
        imageCalls += 1;
        return Promise.resolve(
          generatedImageResponse(
            imageCalls === 1 ? "long-text-image" : "tighter-copy-rerender",
          ),
        );
      }
      return Promise.resolve({
        text: () => "A compliant delivery caption for Test Dealer. #DeliveryDay",
      });
    });

    const result = await generateSocialPost(
      "data:image/jpeg;base64,original-photo",
      StyleOption.Modern,
      ToneOption.Professional,
      "Test Dealer",
    );

    expect(result.image).toBe("data:image/png;base64,tighter-copy-rerender");
    expect(imageCalls).toBe(2);
    expect(reviewCalls).toBe(2);
    const retryCall = mockGenerateContent.mock.calls.find(([request]) =>
      request.contents?.parts?.some((part: { text?: string }) =>
        part.text?.includes("text_compliance_retry"),
      ),
    );
    expect(retryCall).toBeDefined();
  });

  it("rejects a personal name burned into regular image pixels", async () => {
    let imageCalls = 0;
    let reviewCalls = 0;
    const wrongNameReview: GeneratedImageTextReview = {
      ...compliantImageTextReview,
      compliant: false,
      detectedMarketingText: ["WELCOME HOME, LISA"],
      marketingWordCount: 3,
      marketingCharacterCount: 18,
      hasUnexpectedPersonalName: true,
      detectedPersonalNames: ["Lisa"],
      violations: ["unexpected_personal_name"],
    };
    mockGenerateContent.mockImplementation((request) => {
      if (isImageTextReviewRequest(request)) {
        reviewCalls += 1;
        return imageTextReviewResponse(
          reviewCalls === 1 ? wrongNameReview : compliantImageTextReview,
        );
      }
      if (request.generationConfig?.responseModalities?.includes("IMAGE")) {
        imageCalls += 1;
        return Promise.resolve(
          generatedImageResponse(
            imageCalls === 1 ? "wrong-name-image" : "name-free-rerender",
          ),
        );
      }
      return Promise.resolve({
        text: () => "A clean customer delivery caption for Test Dealer this week.",
      });
    });

    const result = await generateSocialPost(
      "data:image/jpeg;base64,original-photo",
      StyleOption.Friendly,
      ToneOption.Professional,
      "Test Dealer",
      "Beth",
    );

    expect(result.image).toBe("data:image/png;base64,name-free-rerender");
    expect(imageCalls).toBe(2);
    const reviewPrompt = mockGenerateContent.mock.calls
      .filter(([request]) => isImageTextReviewRequest(request))
      .at(0)?.[0]
      .contents?.parts?.find((part: { text?: string }) =>
        part.text?.includes("strict visual quality-control inspector"),
      )?.text;
    expect(reviewPrompt).toContain("Customer or personal names are forbidden");
    expect(reviewPrompt).toContain("regular photo-overlay style");
  });

  it("allows Fun Mode illustration while still reviewing names and fake marks", async () => {
    let imageCalls = 0;
    const creativeBrief = [
      "Post scenario: Service Promotion.",
      "Scenario: Service department promotion.",
      "Target platforms (dealership priority):",
      "- Instagram Story (≤400 chars recommended for the hook): Prefer 9:16.",
      "Always name the store exactly as Test Dealer.",
    ].join(" ");
    mockGenerateContent.mockImplementation((request) => {
      if (isImageTextReviewRequest(request)) {
        return imageTextReviewResponse({
          ...compliantImageTextReview,
          isIllustrationOrCharacterRender: true,
          visualQualityScore: 4,
          hasDistinctStyleSignature: true,
          hasCleanTypography: true,
        });
      }
      if (request.generationConfig?.responseModalities?.includes("IMAGE")) {
        imageCalls += 1;
        return Promise.resolve(generatedImageResponse("fun-character-image"));
      }
      return Promise.resolve({ text: () => "unused" });
    });

    const image = await generateFunSocialPostImage(
      "data:image/jpeg;base64,original-photo",
      "Test Dealer",
      undefined,
      "pixar",
      "standard",
      undefined,
      creativeBrief,
    );

    expect(image).toBe("data:image/png;base64,fun-character-image");
    expect(imageCalls).toBe(1);
    const reviewPrompt = mockGenerateContent.mock.calls
      .find(([request]) => isImageTextReviewRequest(request))?.[0]
      .contents?.parts?.find((part: { text?: string }) =>
        part.text?.includes("strict visual quality-control inspector"),
      )?.text;
    expect(reviewPrompt).toContain("This is Fun Mode");
    expect(reviewPrompt).toContain("Any added dealership badge");
    expect(reviewPrompt).toContain("Premium 3D Family Animation");
    expect(reviewPrompt?.toLocaleLowerCase()).not.toContain("pixar");
    const generationPrompt = mockGenerateContent.mock.calls
      .find(
        ([request]) =>
          request.generationConfig?.responseModalities?.includes("IMAGE") &&
          !isImageTextReviewRequest(request),
      )?.[0]
      .contents?.parts?.find((part: { text?: string }) => part.text)?.text;
    expect(generationPrompt).toContain("Scenario class: Service promotion");
    expect(generationPrompt).toContain("Compose for 9:16");
  });

  it("fails closed after every correction remains over the image-text budget", async () => {
    let imageCalls = 0;
    let reviewCalls = 0;
    const noncompliantReview: GeneratedImageTextReview = {
      ...compliantImageTextReview,
      compliant: false,
      detectedMarketingText: ["Call today for your new vehicle and visit us online"],
      marketingWordCount: 10,
      marketingCharacterCount: 52,
      hasFullSentence: true,
      violations: ["too_many_words", "too_many_characters", "full_sentence"],
    };
    mockGenerateContent.mockImplementation((request) => {
      if (isImageTextReviewRequest(request)) {
        reviewCalls += 1;
        return imageTextReviewResponse(noncompliantReview);
      }
      if (request.generationConfig?.responseModalities?.includes("IMAGE")) {
        imageCalls += 1;
        return Promise.resolve(generatedImageResponse(`still-long-${imageCalls}`));
      }
      return Promise.resolve({
        text: () => "A compliant delivery caption for Test Dealer. #DeliveryDay",
      });
    });

    const result = await generateSocialPost(
      "data:image/jpeg;base64,original-photo",
      StyleOption.Modern,
      ToneOption.Professional,
      "Test Dealer",
    );

    expect(result.image).toBe("data:image/jpeg;base64,original-photo");
    expect(result.aiMeta.image.provider).toBe("original");
    expect(imageCalls).toBe(3);
    expect(reviewCalls).toBe(3);
    const reductionCall = mockGenerateContent.mock.calls.find(([request]) =>
      request.contents?.parts?.some((part: { text?: string }) =>
        part.text?.includes("Reduce the AI-added marketing overlay text"),
      ),
    );
    expect(reductionCall).toBeDefined();
  });

  it("rejects a text-correction render that introduces a blocking craft defect", async () => {
    let imageCalls = 0;
    let reviewCalls = 0;
    const lengthReview: GeneratedImageTextReview = {
      ...compliantImageTextReview,
      compliant: false,
      detectedMarketingText: ["YOUR NEW ADVENTURE STARTS HERE TODAY"],
      marketingWordCount: 6,
      marketingCharacterCount: 36,
      hasFullSentence: true,
      violations: ["full_sentence"],
    };
    const blandCorrectionReview: GeneratedImageTextReview = {
      ...compliantImageTextReview,
      compliant: false,
      visualQualityScore: 2,
      hasDistinctStyleSignature: false,
      violations: ["bland_or_unstyled"],
    };
    mockGenerateContent.mockImplementation((request) => {
      if (isImageTextReviewRequest(request)) {
        reviewCalls += 1;
        return imageTextReviewResponse(
          reviewCalls < 3 ? lengthReview : blandCorrectionReview,
        );
      }
      if (request.generationConfig?.responseModalities?.includes("IMAGE")) {
        imageCalls += 1;
        return Promise.resolve(generatedImageResponse(`craft-${imageCalls}`));
      }
      return Promise.resolve({
        text: () => "A compliant delivery caption for Test Dealer. #DeliveryDay",
      });
    });

    const result = await generateSocialPost(
      "data:image/jpeg;base64,original-photo",
      StyleOption.Modern,
      ToneOption.Professional,
      "Test Dealer",
    );

    expect(result.image).toBe("data:image/jpeg;base64,original-photo");
    expect(result.aiMeta.image.provider).toBe("original");
    expect(imageCalls).toBe(3);
    expect(reviewCalls).toBe(3);
  });

  it("fails closed to the original photo when vision safety review fails", async () => {
    let imageCalls = 0;
    mockGenerateContent.mockImplementation((request) => {
      if (isImageTextReviewRequest(request)) {
        return Promise.resolve({
          text: () => "I could not inspect this image, sorry — no JSON from me.",
        });
      }
      if (request.generationConfig?.responseModalities?.includes("IMAGE")) {
        imageCalls += 1;
        return Promise.resolve(generatedImageResponse("styled-overlay-image"));
      }
      return Promise.resolve({
        text: () => "A compliant delivery caption for Test Dealer. #DeliveryDay",
      });
    });

    const result = await generateSocialPost(
      "data:image/jpeg;base64,original-photo",
      StyleOption.Modern,
      ToneOption.Professional,
      "Test Dealer",
    );

    // A generated image cannot ship when names and branding were not verified.
    expect(result.image).toBe("data:image/jpeg;base64,original-photo");
    expect(result.aiMeta.image.provider).toBe("original");
    expect(imageCalls).toBe(1);
  });

  it("does not accept a reviewer response that omits identity and brand checks", async () => {
    let imageCalls = 0;
    const incompleteReview: GeneratedImageTextReview = {
      compliant: true,
      uncertain: false,
      detectedMarketingText: ["WELCOME HOME"],
      marketingWordCount: 2,
      marketingCharacterCount: 12,
      hasFullSentence: false,
      hasHashtag: false,
      hasUrlOrPhone: false,
      violations: [],
    };
    mockGenerateContent.mockImplementation((request) => {
      if (isImageTextReviewRequest(request)) {
        return imageTextReviewResponse(incompleteReview);
      }
      if (request.generationConfig?.responseModalities?.includes("IMAGE")) {
        imageCalls += 1;
        return Promise.resolve(generatedImageResponse(`unverified-${imageCalls}`));
      }
      return Promise.resolve({
        text: () => "A compliant delivery caption for Test Dealer. #DeliveryDay",
      });
    });

    const result = await generateSocialPost(
      "data:image/jpeg;base64,original-photo",
      StyleOption.Modern,
      ToneOption.Professional,
      "Test Dealer",
    );

    expect(result.image).toBe("data:image/jpeg;base64,original-photo");
    expect(result.aiMeta.image.provider).toBe("original");
    expect(imageCalls).toBeGreaterThan(1);
  });

  it("never returns a known substandard render when a retry review is unavailable", async () => {
    let imageCalls = 0;
    let reviewCalls = 0;
    const missingDealerReview: GeneratedImageTextReview = {
      ...compliantImageTextReview,
      compliant: false,
      dealershipNamePresent: false,
      violations: ["missing_dealership_identity"],
    };
    mockGenerateContent.mockImplementation((request) => {
      if (isImageTextReviewRequest(request)) {
        reviewCalls += 1;
        return reviewCalls === 1
          ? imageTextReviewResponse(missingDealerReview)
          : Promise.resolve({ text: () => "review unavailable" });
      }
      if (request.generationConfig?.responseModalities?.includes("IMAGE")) {
        imageCalls += 1;
        return Promise.resolve(
          generatedImageResponse(`unverified-retry-${imageCalls}`),
        );
      }
      return Promise.resolve({
        text: () => "A compliant delivery caption for Test Dealer. #DeliveryDay",
      });
    });

    const result = await generateSocialPost(
      "data:image/jpeg;base64,original-photo",
      StyleOption.Modern,
      ToneOption.Professional,
      "Test Dealer",
    );

    expect(result.image).toBe("data:image/jpeg;base64,original-photo");
    expect(result.aiMeta.image.provider).toBe("original");
    expect(imageCalls).toBe(3);
    expect(reviewCalls).toBeGreaterThanOrEqual(3);
  });

  it("compares the source and regenerates when a customer subject changes", async () => {
    let imageCalls = 0;
    let reviewCalls = 0;
    const changedSubjectReview: GeneratedImageTextReview = {
      ...compliantImageTextReview,
      compliant: false,
      preservesSourceSubjects: false,
      violations: ["subject_identity_changed"],
    };
    mockGenerateContent.mockImplementation((request) => {
      if (isImageTextReviewRequest(request)) {
        reviewCalls += 1;
        return imageTextReviewResponse(
          reviewCalls === 1 ? changedSubjectReview : compliantImageTextReview,
        );
      }
      if (request.generationConfig?.responseModalities?.includes("IMAGE")) {
        imageCalls += 1;
        return Promise.resolve(
          generatedImageResponse(imageCalls === 1 ? "changed-face" : "faithful-face"),
        );
      }
      return Promise.resolve({
        text: () => "A compliant delivery caption for Test Dealer. #DeliveryDay",
      });
    });

    const result = await generateSocialPost(
      "data:image/jpeg;base64,original-photo",
      StyleOption.Friendly,
      ToneOption.Professional,
      "Test Dealer",
    );

    expect(result.image).toBe("data:image/png;base64,faithful-face");
    const reviewParts = mockGenerateContent.mock.calls.find(([request]) =>
      isImageTextReviewRequest(request),
    )?.[0].contents.parts;
    const reviewTextParts = reviewParts?.filter(
      (part: { text?: string }) => typeof part.text === "string",
    );
    expect(reviewTextParts).toHaveLength(1);
    expect(reviewTextParts?.[0]?.text).toContain("IMAGE 1: REFERENCE SOURCE IMAGE");
    expect(reviewTextParts?.[0]?.text).toContain("IMAGE 2: GENERATED OUTPUT IMAGE");
    expect(
      reviewParts?.filter((part: { inlineData?: unknown }) => part.inlineData),
    ).toHaveLength(2);
  });

  it("requires environmental 3D integration for Depth Pop", async () => {
    let imageCalls = 0;
    let reviewCalls = 0;
    const flatDepthReview: GeneratedImageTextReview = {
      ...compliantImageTextReview,
      compliant: false,
      hasEnvironmentalDepthIntegration: false,
      violations: ["unintegrated_3d_graphics"],
    };
    const integratedDepthReview: GeneratedImageTextReview = {
      ...compliantImageTextReview,
      hasEnvironmentalDepthIntegration: true,
    };
    mockGenerateContent.mockImplementation((request) => {
      if (isImageTextReviewRequest(request)) {
        reviewCalls += 1;
        return imageTextReviewResponse(
          reviewCalls < 3 ? flatDepthReview : integratedDepthReview,
        );
      }
      if (request.generationConfig?.responseModalities?.includes("IMAGE")) {
        imageCalls += 1;
        return Promise.resolve(generatedImageResponse(`depth-${imageCalls}`));
      }
      return Promise.resolve({
        text: () => "A compliant delivery caption for Test Dealer. #DeliveryDay",
      });
    });

    const result = await generateSocialPost(
      "data:image/jpeg;base64,original-photo",
      StyleOption.DepthPop,
      ToneOption.Professional,
      "Test Dealer",
    );

    expect(result.image).toBe("data:image/png;base64,depth-3");
    expect(imageCalls).toBe(3);
    expect(
      mockGenerateContent.mock.calls.some(([request]) =>
        request.contents?.parts?.some((part: { text?: string }) =>
          part.text?.includes("<final_creative_recovery>"),
        ),
      ),
    ).toBe(true);
  });

  it("reports an original-photo fallback at error level so the server sees it", async () => {
    // Only error-level telemetry is beaconed to /api/telemetry and counted in
    // the admin health panel's recentErrors. Shipping the untouched photo is
    // the product silently doing nothing, so it has to reach the server —
    // as an info event this degradation was invisible outside the browser.
    const telemetry = await import("../utils/telemetry");
    const errorSpy = vi.spyOn(telemetry, "logError");

    mockGenerateContent.mockImplementation((request) => {
      if (request.generationConfig?.responseModalities?.includes("IMAGE")) {
        return Promise.reject(new Error("503 model unavailable"));
      }
      return Promise.resolve({
        text: () => "A compliant delivery caption for Test Dealer. #DeliveryDay",
      });
    });

    const result = await generateSocialPost(
      "data:image/jpeg;base64,original-photo",
      StyleOption.Modern,
      ToneOption.Professional,
      "Test Dealer",
    );

    expect(result.aiMeta.image.provider).toBe("original");
    const degraded = errorSpy.mock.calls.find(
      ([name]) => name === "image.fallback.original",
    );
    expect(degraded).toBeDefined();
    // Both keys are on the server-side payload allowlist, so they survive
    // sanitization and make the stored event actionable.
    expect(degraded?.[1]).toMatchObject({ task: "image_standard" });
    expect(typeof degraded?.[1]?.fallbackCount).toBe("number");
    errorSpy.mockRestore();
  });

  it("retries and then rejects a merely usable score-three creative", async () => {
    let imageCalls = 0;
    let reviewCalls = 0;
    mockGenerateContent.mockImplementation((request) => {
      if (isImageTextReviewRequest(request)) {
        reviewCalls += 1;
        return imageTextReviewResponse({
          ...compliantImageTextReview,
          compliant: true,
          visualQualityScore: 3,
          violations: [],
        });
      }
      if (request.generationConfig?.responseModalities?.includes("IMAGE")) {
        imageCalls += 1;
        return Promise.resolve(generatedImageResponse(`render-${imageCalls}`));
      }
      return Promise.resolve({
        text: () => "A compliant delivery caption for Test Dealer. #DeliveryDay",
      });
    });

    const result = await generateSocialPost(
      "data:image/jpeg;base64,original-photo",
      StyleOption.Modern,
      ToneOption.Professional,
      "Test Dealer",
    );

    expect(result.image).toBe("data:image/jpeg;base64,original-photo");
    expect(result.aiMeta.image.provider).toBe("original");
    expect(imageCalls).toBe(3);
    expect(reviewCalls).toBe(3);
    expect(
      mockGenerateContent.mock.calls.some(([request]) =>
        request.contents?.parts?.some((part: { text?: string }) =>
          part.text?.includes("<final_creative_recovery>"),
        ),
      ),
    ).toBe(true);
  });

  it("still refuses an overlay carrying a phone number or link", async () => {
    mockGenerateContent.mockImplementation((request) => {
      if (isImageTextReviewRequest(request)) {
        return imageTextReviewResponse({
          ...compliantImageTextReview,
          compliant: false,
          uncertain: false,
          detectedMarketingText: ["CALL 555-0142"],
          marketingWordCount: 2,
          marketingCharacterCount: 13,
          hasUrlOrPhone: true,
          violations: ["url_or_phone"],
        });
      }
      if (request.generationConfig?.responseModalities?.includes("IMAGE")) {
        return Promise.resolve(generatedImageResponse("phone-overlay"));
      }
      return Promise.resolve({
        text: () => "A compliant delivery caption for Test Dealer. #DeliveryDay",
      });
    });

    const result = await generateSocialPost(
      "data:image/jpeg;base64,original-photo",
      StyleOption.Modern,
      ToneOption.Professional,
      "Test Dealer",
    );

    // Unsafe overlay content is the one case where falling back to the
    // untouched photo is the correct outcome.
    expect(result.image).toBe("data:image/jpeg;base64,original-photo");
  });

  it("parses a fenced JSON review response instead of failing it", async () => {
    let imageCalls = 0;
    mockGenerateContent.mockImplementation((request) => {
      if (isImageTextReviewRequest(request)) {
        return Promise.resolve({
          text: () => "```json\n" + JSON.stringify(compliantImageTextReview) + "\n```",
        });
      }
      if (request.generationConfig?.responseModalities?.includes("IMAGE")) {
        imageCalls += 1;
        return Promise.resolve(generatedImageResponse("fenced-review-image"));
      }
      return Promise.resolve({
        text: () => "A compliant delivery caption for Test Dealer. #DeliveryDay",
      });
    });

    const result = await generateSocialPost(
      "data:image/jpeg;base64,original-photo",
      StyleOption.Modern,
      ToneOption.Professional,
      "Test Dealer",
    );

    expect(result.image).toBe("data:image/png;base64,fenced-review-image");
    expect(imageCalls).toBe(1);
  });

  it("fails closed when repeated visual review remains uncertain", async () => {
    let imageCalls = 0;
    const uncertainReview: GeneratedImageTextReview = {
      ...compliantImageTextReview,
      compliant: false,
      uncertain: true,
      detectedMarketingText: [],
      marketingWordCount: 0,
      marketingCharacterCount: 0,
      violations: ["unreadable_or_uncertain"],
    };
    mockGenerateContent.mockImplementation((request) => {
      if (isImageTextReviewRequest(request)) {
        return imageTextReviewResponse(uncertainReview);
      }
      if (request.generationConfig?.responseModalities?.includes("IMAGE")) {
        imageCalls += 1;
        return Promise.resolve(generatedImageResponse("stylized-type-image"));
      }
      return Promise.resolve({
        text: () => "A compliant delivery caption for Test Dealer. #DeliveryDay",
      });
    });

    const result = await generateSocialPost(
      "data:image/jpeg;base64,original-photo",
      StyleOption.Modern,
      ToneOption.Professional,
      "Test Dealer",
    );

    expect(result.image).toBe("data:image/jpeg;base64,original-photo");
    expect(result.aiMeta.image.provider).toBe("original");
    expect(imageCalls).toBeGreaterThan(1);
  });

  it("accepts a headline with display punctuation and a badge as separate blocks", async () => {
    let imageCalls = 0;
    const multiBlockReview: GeneratedImageTextReview = {
      ...compliantImageTextReview,
      detectedMarketingText: ["SOLD!", "KEYS DAY", "Your turn next"],
      marketingWordCount: 6,
      marketingCharacterCount: 27,
    };
    mockGenerateContent.mockImplementation((request) => {
      if (isImageTextReviewRequest(request)) {
        return imageTextReviewResponse(multiBlockReview);
      }
      if (request.generationConfig?.responseModalities?.includes("IMAGE")) {
        imageCalls += 1;
        return Promise.resolve(generatedImageResponse("headline-badge-image"));
      }
      return Promise.resolve({
        text: () => "A compliant delivery caption for Test Dealer. #DeliveryDay",
      });
    });

    const result = await generateSocialPost(
      "data:image/jpeg;base64,original-photo",
      StyleOption.Modern,
      ToneOption.Professional,
      "Test Dealer",
    );

    expect(result.image).toBe("data:image/png;base64,headline-badge-image");
    expect(imageCalls).toBe(1);
  });

  it("restores a missing dealership logo with one bounded retry", async () => {
    let imageCalls = 0;
    let reviewCalls = 0;
    const logoMissingReview: GeneratedImageTextReview = {
      ...compliantImageTextReview,
      logoPresent: false,
      logoMatchesSuppliedAsset: false,
    };
    const exactLogoReview: GeneratedImageTextReview = {
      ...compliantImageTextReview,
      logoPresent: true,
      logoMatchesSuppliedAsset: true,
    };
    const bytes = new Uint8Array([1, 2, 3]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        blob: async () => ({
          type: "image/png",
          arrayBuffer: async () => bytes.buffer,
        }),
      })),
    );
    mockGenerateContent.mockImplementation((request) => {
      if (isImageTextReviewRequest(request)) {
        reviewCalls += 1;
        return imageTextReviewResponse(
          reviewCalls === 1 ? logoMissingReview : exactLogoReview,
        );
      }
      if (request.generationConfig?.responseModalities?.includes("IMAGE")) {
        imageCalls += 1;
        return Promise.resolve(
          generatedImageResponse(
            imageCalls === 1
              ? "bG9nby1taXNzaW5nLWltYWdl"
              : "bG9nby1yZXN0b3JlZC1pbWFnZQ==",
          ),
        );
      }
      return Promise.resolve({
        text: () => "A compliant delivery caption for Test Dealer. #DeliveryDay",
      });
    });

    const result = await generateSocialPost(
      "data:image/jpeg;base64,b3JpZ2luYWwtcGhvdG8=",
      StyleOption.Modern,
      ToneOption.Professional,
      "Test Dealer",
      undefined,
      "/api/files/dealers/dealer-id/logo.png",
    );

    expect(result.image).toBe("data:image/png;base64,bG9nby1yZXN0b3JlZC1pbWFnZQ==");
    expect(imageCalls).toBe(2);
    const restoreCall = mockGenerateContent.mock.calls.find(([request]) =>
      request.contents?.parts?.some((part: { text?: string }) =>
        part.text?.includes("Use the supplied dealership logo"),
      ),
    );
    expect(restoreCall).toBeDefined();
    const logoReviewCall = mockGenerateContent.mock.calls.find(
      ([request]) =>
        isImageTextReviewRequest(request) &&
        request.contents?.parts?.some((part: { text?: string }) =>
          part.text?.includes("IMAGE 3: APPROVED DEALERSHIP LOGO"),
        ),
    );
    expect(logoReviewCall).toBeDefined();
    expect(
      logoReviewCall?.[0].contents.parts.filter(
        (part: { inlineData?: unknown }) => part.inlineData,
      ),
    ).toHaveLength(3);
    expect(
      logoReviewCall?.[0].contents.parts.filter(
        (part: { text?: string }) => typeof part.text === "string",
      ),
    ).toHaveLength(1);
    const reviewImageChars = logoReviewCall?.[0].contents.parts
      .filter((part: { inlineData?: { data?: string } }) => part.inlineData)
      .reduce(
        (total: number, part: { inlineData?: { data?: string } }) =>
          total + (part.inlineData?.data?.length || 0),
        0,
      );
    expect(reviewImageChars).toBeLessThanOrEqual(
      MODEL_POLICY.requestLimits.maxTotalInlineImageChars,
    );
    expect(
      logoReviewCall?.[0].contents.parts.find(
        (part: { text?: string }) => typeof part.text === "string",
      )?.text.length,
    ).toBeLessThanOrEqual(MODEL_POLICY.requestLimits.maxPromptChars);
    const exactReviewRequest = logoReviewCall?.[0];
    if (!exactReviewRequest)
      throw new Error("Expected a captured vision review request.");
    expect(
      loadPocketBaseRequestPolicies().buildGeminiProxyRequest(
        `v1beta/models/${exactReviewRequest.model}:generateContent`,
        {
          contents: [exactReviewRequest.contents],
          generationConfig: exactReviewRequest.generationConfig,
        },
        exactReviewRequest.task,
      ),
    ).not.toBeNull();
  });

  it("fails closed when a supplied logo is still missing after repair", async () => {
    let imageCalls = 0;
    let reviewCalls = 0;
    const logoStillMissing: GeneratedImageTextReview = {
      ...compliantImageTextReview,
      compliant: true,
      logoPresent: false,
      // Deliberately inconsistent provider output: missing must fail even when
      // the model claims the unseen asset matches.
      logoMatchesSuppliedAsset: true,
      violations: [],
    };
    const bytes = new Uint8Array([1, 2, 3]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        blob: async () => ({
          type: "image/png",
          arrayBuffer: async () => bytes.buffer,
        }),
      })),
    );
    mockGenerateContent.mockImplementation((request) => {
      if (isImageTextReviewRequest(request)) {
        reviewCalls += 1;
        return imageTextReviewResponse(logoStillMissing);
      }
      if (request.generationConfig?.responseModalities?.includes("IMAGE")) {
        imageCalls += 1;
        return Promise.resolve(generatedImageResponse(`missing-logo-${imageCalls}`));
      }
      return Promise.resolve({
        text: () => "A compliant delivery caption for Test Dealer. #DeliveryDay",
      });
    });

    const result = await generateSocialPost(
      "data:image/jpeg;base64,original-photo",
      StyleOption.Modern,
      ToneOption.Professional,
      "Test Dealer",
      undefined,
      "/api/files/dealers/dealer-id/logo.png",
    );

    expect(result.image).toBe("data:image/jpeg;base64,original-photo");
    expect(result.aiMeta.image.provider).toBe("original");
    expect(imageCalls).toBe(2);
    expect(reviewCalls).toBe(2);
  });

  it("keeps website metadata requests inside the server text-policy contract", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: () =>
        '{"title":"Community update","body":"A private community update for review.","altText":"A dealership community image.","category":"community","privacyFlags":[]}',
    });

    await generateWebsiteDraftMetadata(
      "data:image/jpeg;base64,source-photo",
      "Return the website metadata JSON.",
    );

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    // Website metadata runs under the caption_regenerate text task, bound to
    // the server-side `website_draft_v1` response schema.
    expect(mockGenerateContent.mock.calls[0]?.[0].generationConfig).toEqual({
      maxOutputTokens: 2048,
      thinkingConfig: { thinkingLevel: "low" },
      responseMimeType: "application/json",
      schemaId: "website_draft_v1",
    });
  });

  it("retries in prose mode when the proxy predates the schema registry", async () => {
    // A server without the response-schema registry sees `responseMimeType`
    // and `schemaId` as unknown generationConfig keys and answers 400. The
    // retry must reuse the same model and prompt, and the kept heuristic
    // parser must still recover the pack.
    const proseAnswer =
      '```json\n{"captions":[{"platformId":"tiktok","caption":"TikTok body"}]}\n```';
    mockGenerateContent.mockImplementation((request) => {
      if (request.generationConfig?.schemaId) {
        return Promise.reject(
          new Error("The AI service could not complete this request (error 400)."),
        );
      }
      return Promise.resolve({ text: () => proseAnswer });
    });

    const raw = await generatePlatformCaptionPack(
      "data:image/jpeg;base64,source-photo",
      "Return the caption pack.",
      undefined,
      false,
    );

    expect(raw).toBe(proseAnswer);
    expect(parsePlatformCaptionPack(raw, ["tiktok"])).toEqual({
      tiktok: "TikTok body",
    });
    const calls = mockGenerateContent.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]?.[0].generationConfig.schemaId).toBe("caption_pack_v1");
    // Same model: the structured retry is not a fallback-chain step.
    expect(calls[1]?.[0].model).toBe(calls[0]?.[0].model);
    expect(calls[1]?.[0].generationConfig).not.toHaveProperty("schemaId");
    expect(calls[1]?.[0].generationConfig).not.toHaveProperty("responseMimeType");
    expect(calls[1]?.[0].contents).toEqual(calls[0]?.[0].contents);

    // The latch is per session: the next structured call skips the doomed
    // structured attempt entirely.
    mockGenerateContent.mockClear();
    await generateWebsiteDraftMetadata(
      "data:image/jpeg;base64,source-photo",
      "Return the website metadata JSON.",
    );
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(mockGenerateContent.mock.calls[0]?.[0].generationConfig).not.toHaveProperty(
      "schemaId",
    );
  });

  it("preserves structured caption-pack JSON and binds it to the public customer label", async () => {
    const structured = JSON.stringify({
      facebook_feed: "Congratulations to Lisa at Test Dealer.",
      instagram_feed: "Lisa's delivery day at Test Dealer. #TestDealer",
    });
    mockGenerateContent.mockResolvedValueOnce({ text: () => structured });

    const raw = await generatePlatformCaptionPack(
      "data:image/jpeg;base64,source-photo",
      'Return JSON with keys ["facebook_feed","instagram_feed"].',
      "Lisa Marie Sample",
      true,
    );

    expect(raw).toBe(structured);
    expect(parsePlatformCaptionPack(raw, ["facebook_feed", "instagram_feed"])).toEqual({
      facebook_feed: "Congratulations to Lisa at Test Dealer.",
      instagram_feed: "Lisa's delivery day at Test Dealer. #TestDealer",
    });
    const requestParts = mockGenerateContent.mock.calls[0]?.[0].contents
      .parts as Array<{
      text?: string;
      inlineData?: unknown;
    }>;
    // Text-first ordering: the shared prompt precedes the per-post image bytes.
    expect(requestParts[0]).toHaveProperty("text");
    expect(requestParts[1]).toHaveProperty("inlineData");
    const requestPrompt = requestParts[0].text as string;
    expect(requestPrompt).toContain(
      'the only customer label allowed in any value is exactly "Lisa"',
    );
    expect(requestPrompt).not.toContain("Lisa Marie Sample");
  });

  it("forwards the selected primary canvas as a Gemini image aspect ratio", async () => {
    await generateSocialPost(
      "data:image/jpeg;base64,fake",
      StyleOption.Modern,
      ToneOption.Professional,
      "Vertical Test Dealer",
      undefined,
      undefined,
      undefined,
      undefined,
      "standard",
      "9:16",
    );

    const imageCall = mockGenerateContent.mock.calls.find(
      (call) => call[0].model === TASKS.image_standard.primary,
    );
    expect(imageCall?.[0].generationConfig.imageConfig).toEqual({
      imageSize: "2K",
      aspectRatio: "9:16",
    });
  });

  it("loads a same-origin dealer logo with the authenticated session", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const fetchMock = vi.fn(async () =>
      Promise.resolve({
        ok: true,
        status: 200,
        blob: async () => ({
          type: "image/png",
          arrayBuffer: async () => bytes.buffer,
        }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await generateSocialPost(
      "data:image/jpeg;base64,fake",
      StyleOption.Modern,
      ToneOption.Professional,
      "Test Dealer",
      undefined,
      "/api/files/dealers/dealer-id/logo.png",
    );

    expect(fetchMock).toHaveBeenCalledWith("/api/files/dealers/dealer-id/logo.png", {
      credentials: "include",
    });
    const imageCall = mockGenerateContent.mock.calls.find(
      (call) => call[0].model === TASKS.image_standard.primary,
    );
    expect(imageCall?.[0].contents.parts).toHaveLength(3);
  });

  it("fails closed before any provider call when a configured logo cannot be decoded", async () => {
    await expect(
      generateSocialPost(
        "data:image/jpeg;base64,fake",
        StyleOption.Modern,
        ToneOption.Professional,
        "Test Dealer",
        undefined,
        "data:text/plain;base64,bm90LWFuLWltYWdl",
      ),
    ).rejects.toThrow("configured dealership logo could not be loaded");

    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it("routes the single studio preference through Pro Image first", async () => {
    await generateSocialPost(
      "data:image/jpeg;base64,fake",
      StyleOption.Modern,
      ToneOption.Professional,
      "Studio Test Dealer",
      undefined,
      undefined,
      undefined,
      undefined,
      "studio",
    );

    const firstImageCall = mockGenerateContent.mock.calls.find((call) =>
      call[0].generationConfig?.responseModalities?.includes("IMAGE"),
    );
    expect(firstImageCall?.[0].model).toBe(TASKS.image_studio.primary);
    expect(firstImageCall?.[0].generationConfig.imageConfig.imageSize).toBe("4K");
  });

  it("keeps the Lite image fallback on its supported 1K output", async () => {
    mockGenerateContent.mockImplementation((request) => {
      if (isImageTextReviewRequest(request)) return imageTextReviewResponse();
      const { model } = request;
      if (model !== MODELS.image.emergency) {
        return Promise.reject(new Error("503 model unavailable"));
      }
      return Promise.resolve(generatedImageResponse());
    });

    await generateFunSocialPostImage("data:image/jpeg;base64,fake", "Test Dealer");

    const liteCall = mockGenerateContent.mock.calls.find(
      (call) => call[0].model === MODELS.image.emergency,
    );
    expect(liteCall?.[0].generationConfig).toMatchObject({
      imageConfig: { imageSize: "1K" },
    });
  });

  it("uses production-stable Google model identifiers", () => {
    expect(MODELS.text.primary).toBe("gemini-3.6-flash");
    expect(MODELS.text.fallback).toBe("gemini-3.5-flash-lite");
    expect(MODELS.image.primary).toBe("gemini-3-pro-image");
    expect(MODELS.image.studio).toBe("gemini-3-pro-image");
    expect(MODELS.image.fallback).toBe("gemini-3.1-flash-image");
    expect(MODELS.image.emergency).toBe("gemini-3.1-flash-lite-image");
    expect(MODELS.video.primary).toBe("veo-3.1-fast-generate-preview");
    expect(MODELS.video.fallback).toBe("veo-3.1-generate-preview");

    expect(JSON.stringify(MODELS.text)).not.toContain("preview");
    expect(JSON.stringify(MODELS.image)).not.toContain("preview");
    expect(JSON.stringify(MODELS)).not.toContain("gemini-2.5");
  });

  it("records fallback provenance without exposing prompts or credentials", async () => {
    mockGenerateContent.mockImplementation((request) => {
      if (isImageTextReviewRequest(request)) return imageTextReviewResponse();
      const { model, generationConfig } = request;
      if (generationConfig?.responseModalities?.includes("IMAGE")) {
        return Promise.resolve(generatedImageResponse());
      }
      if (model === TASKS.caption.primary) {
        return Promise.reject(new Error("503 model unavailable"));
      }
      return Promise.resolve({
        text: () =>
          "New keys, a new adventure, and one very happy driver at Provenance Motors. Congratulations on your beautiful new ride! #ProvenanceMotors",
      });
    });

    const result = await generateSocialPost(
      "data:image/jpeg;base64,fake",
      StyleOption.Modern,
      ToneOption.Professional,
      "Provenance Motors",
    );

    expect(result.captionSource).toBe("ai");
    expect(result.aiMeta).toMatchObject({
      captionSource: "ai",
      selectedTier: "standard",
      model: TASKS.caption.fallback,
      fallbackCount: 1,
      modelPolicyVersion: MODEL_POLICY_VERSION,
      caption: {
        provider: "gemini",
        model: TASKS.caption.fallback,
        fallbackCount: 1,
      },
      image: {
        provider: "gemini",
        model: TASKS.image_standard.primary,
        fallbackCount: 0,
      },
    });
    expect(result.aiMeta.lastSuccessfulGenerationAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(JSON.stringify(result.aiMeta)).not.toContain("Provenance Motors");
    expect(JSON.stringify(result.aiMeta).toLowerCase()).not.toContain("key");
  });

  it("labels a safe local caption as a basic fallback", async () => {
    mockGenerateContent.mockImplementation((request) => {
      if (isImageTextReviewRequest(request)) return imageTextReviewResponse();
      const { generationConfig } = request;
      if (generationConfig?.responseModalities?.includes("IMAGE")) {
        return Promise.resolve(generatedImageResponse());
      }
      return Promise.reject(new Error("503 upstream unavailable"));
    });

    const result = await generateSocialPost(
      "data:image/jpeg;base64,fake",
      StyleOption.Modern,
      ToneOption.Professional,
      "Fallback Motors",
    );

    expect(result.captionSource).toBe("basic_fallback");
    expect(result.aiMeta.captionSource).toBe("basic_fallback");
    expect(result.aiMeta.caption.provider).toBe("basic_fallback");
    expect(result.aiMeta.caption.fallbackCount).toBe(TASKS.caption.models.length);
    expect(result.text).toContain("Fallback Motors");
  });

  it("rejects an AI edit that returns the original caption unchanged", async () => {
    const original = "Congratulations on your new vehicle! #DeliveryDay";
    mockGenerateContent.mockResolvedValue({
      text: () => `  ${original.toLocaleUpperCase()}  `,
    });

    await expect(
      editSocialPostTextDetailed(
        original,
        "Make it warmer and thank the customer.",
        ToneOption.Family,
      ),
    ).rejects.toThrow("AI returned the caption without applying the requested edit");

    expect(mockGenerateContent).toHaveBeenCalledTimes(TASKS.caption_edit.models.length);
    expect(mockGenerateContent.mock.calls.map(([request]) => request.model)).toEqual(
      TASKS.caption_edit.models,
    );
  });

  it("hits the Veo predictLongRunning endpoint for video generation", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              name: "operations/test-operation-123",
              done: false,
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              name: "operations/test-operation-123",
              done: true,
              response: {
                generateVideoResponse: {
                  generatedSamples: [
                    {
                      // `uri` is the documented Gemini Developer API spelling
                      // (the only one both official SDKs' mldev converters
                      // read). The old `downloadUri` probe was speculative.
                      video: {
                        uri: "https://generativelanguage.googleapis.com/v1beta/files/test-video",
                      },
                    },
                  ],
                },
              },
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          blob: () =>
            Promise.resolve(
              new Blob([makeMp4Bytes().buffer as ArrayBuffer], {
                type: "video/mp4",
              }),
            ),
        }),
    );
    vi.spyOn(global.URL, "createObjectURL").mockReturnValue("blob:fake-video-url");

    vi.stubGlobal(
      "Image",
      class {
        onload: () => void = () => {};
        src: string = "";
        width: number = 100;
        height: number = 100;
        constructor() {
          setTimeout(() => this.onload(), 10);
        }
      },
    );

    const result = await generatePostVideo(
      "data:image/jpeg;base64,fake",
      VideoStyle.GoldenRadiance,
      {
        durationSeconds: 8,
        aspectPreference: "auto",
        resolution: "720p",
        soundtrack: "none",
        pacing: "snappy",
      },
    );

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(MODELS.video.primary),
      expect.any(Object),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("predictLongRunning"),
      expect.any(Object),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(MODELS.video.primary),
      expect.objectContaining({
        body: expect.stringMatching(
          /"image":\{"bytesBase64Encoded":"[^"]+","mimeType":"image\/jpeg"\}/,
        ),
      }),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(MODELS.video.primary),
      expect.objectContaining({
        body: expect.stringContaining('"resolution":"720p"'),
      }),
    );
    expect(vi.mocked(global.fetch).mock.calls[0]?.[1]?.body).not.toContain(
      "inlineData",
    );
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/proxy/v1beta/files/test-video:download?alt=media",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
    expect(result).toBe("blob:fake-video-url");
  }, 30000);

  it("does not issue a second billable start after an ambiguous network failure", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    stubLoadedVideoImage();

    await expect(
      generatePostVideo("data:image/jpeg;base64,fake", VideoStyle.GoldenRadiance, {
        durationSeconds: 8,
        aspectPreference: "auto",
        resolution: "720p",
        soundtrack: "none",
        pacing: "snappy",
      }),
    ).rejects.toThrow(
      "The start request was not retried to prevent a duplicate paid video job.",
    );

    const startCalls = fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).includes(":predictLongRunning") && init?.method === "POST",
    );
    expect(startCalls).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [502, "Bad Gateway", "Could not secure provider resource"],
    [503, "Service Unavailable", "provider overloaded"],
  ])(
    "does not retry a start when the proxy returns ambiguous %s",
    async (status, statusText, responseText) => {
      const fetchMock = vi.fn().mockResolvedValueOnce({
        ok: false,
        status,
        statusText,
        text: async () => responseText,
      });
      vi.stubGlobal("fetch", fetchMock);
      stubLoadedVideoImage();

      await expect(
        generatePostVideo("data:image/jpeg;base64,fake", VideoStyle.GoldenRadiance, {
          durationSeconds: 8,
          aspectPreference: "auto",
          resolution: "720p",
          soundtrack: "none",
          pacing: "snappy",
        }),
      ).rejects.toThrow(
        // Users get the curated outage copy; the raw provider text stays in
        // the console. The load-bearing assertion is the single start call.
        /Video generation did not start safely: The AI model is temporarily unavailable\./,
      );

      const startCalls = fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).includes(":predictLongRunning") && init?.method === "POST",
      );
      expect(startCalls).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("retries polling for the accepted operation without restarting Veo", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ name: "operations/poll-retry-123" }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => "temporary poll failure",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: "operations/poll-retry-123",
          done: true,
          response: {
            generateVideoResponse: {
              generatedSamples: [
                {
                  video: {
                    uri: "https://generativelanguage.googleapis.com/v1beta/files/poll-retry-video:download",
                  },
                },
              ],
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        blob: async () =>
          new Blob([makeMp4Bytes().buffer as ArrayBuffer], {
            type: "video/mp4",
          }),
      });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(global.URL, "createObjectURL").mockReturnValue("blob:poll-retry-video");
    stubLoadedVideoImage();

    const generation = generatePostVideo(
      "data:image/jpeg;base64,fake",
      VideoStyle.GoldenRadiance,
      {
        durationSeconds: 8,
        aspectPreference: "auto",
        resolution: "720p",
        soundtrack: "none",
        pacing: "snappy",
      },
    );

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(5000);
    await expect(generation).resolves.toBe("blob:poll-retry-video");

    const startCalls = fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).includes(":predictLongRunning") && init?.method === "POST",
    );
    const pollCalls = fetchMock.mock.calls.filter(
      ([url, init]) => String(url).includes("/operations/") && init?.method === "GET",
    );
    expect(startCalls).toHaveLength(1);
    expect(pollCalls).toHaveLength(2);
  });

  it("sends the identity locks as a real negativePrompt and suppresses audio when the salesperson picks Silent", async () => {
    const startVideo = async (soundtrack: "none" | "cinematic") => {
      setProxyCapabilities({ veoNegativePrompt: true });
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ name: "operations/negative-prompt-123" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            name: "operations/negative-prompt-123",
            done: true,
            response: {
              generateVideoResponse: {
                generatedSamples: [
                  {
                    video: {
                      uri: "https://generativelanguage.googleapis.com/v1beta/files/negative-prompt-video",
                    },
                  },
                ],
              },
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          blob: async () =>
            new Blob([makeMp4Bytes().buffer as ArrayBuffer], { type: "video/mp4" }),
        });
      vi.stubGlobal("fetch", fetchMock);
      vi.spyOn(global.URL, "createObjectURL").mockReturnValue("blob:negative-prompt");
      stubLoadedVideoImage();

      await expect(
        generatePostVideo("data:image/jpeg;base64,fake", VideoStyle.GoldenRadiance, {
          durationSeconds: 8,
          aspectPreference: "auto",
          resolution: "720p",
          soundtrack,
          pacing: "snappy",
        }),
      ).resolves.toBe("blob:negative-prompt");

      const startBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
      return startBody.parameters as Record<string, unknown>;
    };

    const silent = await startVideo("none");
    expect(typeof silent.negativePrompt).toBe("string");
    // The visual locks stop being prose the model can weigh away.
    for (const lock of ["second car", "vehicle morphing", "warped badges"]) {
      expect(silent.negativePrompt).toContain(lock);
    }
    // "Silent" is deterministic through the one parameter this endpoint accepts.
    for (const audio of ["music", "soundtrack", "score", "voiceover", "dialogue"]) {
      expect(silent.negativePrompt).toContain(audio);
    }
    // generateAudio is Vertex/GEAP-only; sending it here risks a 400 per clip.
    expect(silent).not.toHaveProperty("generateAudio");
    expect(
      MODEL_POLICY.allowedRequestFields.veo.parameters as readonly string[],
    ).not.toContain("generateAudio");

    const scored = await startVideo("cinematic");
    expect(scored.negativePrompt).toContain("second car");
    expect(scored.negativePrompt).not.toContain("music");
    expect(scored.negativePrompt).not.toContain("voiceover");
  });

  it("omits negativePrompt until the session advertised the proxy capability", async () => {
    setProxyCapabilities(undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ name: "operations/no-capability-123" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: "operations/no-capability-123",
          done: true,
          response: {
            generateVideoResponse: {
              generatedSamples: [
                {
                  video: {
                    uri: "https://generativelanguage.googleapis.com/v1beta/files/no-capability-video",
                  },
                },
              ],
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        blob: async () =>
          new Blob([makeMp4Bytes().buffer as ArrayBuffer], { type: "video/mp4" }),
      });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(global.URL, "createObjectURL").mockReturnValue("blob:no-capability");
    stubLoadedVideoImage();

    await expect(
      generatePostVideo("data:image/jpeg;base64,fake", VideoStyle.GoldenRadiance, {
        durationSeconds: 8,
        aspectPreference: "auto",
        resolution: "720p",
        soundtrack: "none",
        pacing: "snappy",
      }),
    ).resolves.toBe("blob:no-capability");

    const start = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    // Byte-identical to what a pre-capability backend already validates.
    expect(Object.keys(start.parameters).sort()).toEqual([
      "aspectRatio",
      "durationSeconds",
      "personGeneration",
      "resolution",
    ]);
  });

  it("re-issues the start once without negativePrompt when the proxy's own validation rejects it, on the same model", async () => {
    setProxyCapabilities({ veoNegativePrompt: true });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({ error: "Invalid or unsupported generation request" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ name: "operations/mixed-version-123" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: "operations/mixed-version-123",
          done: true,
          response: {
            generateVideoResponse: {
              generatedSamples: [
                {
                  video: {
                    uri: "https://generativelanguage.googleapis.com/v1beta/files/mixed-version-video",
                  },
                },
              ],
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        blob: async () =>
          new Blob([makeMp4Bytes().buffer as ArrayBuffer], { type: "video/mp4" }),
      });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(global.URL, "createObjectURL").mockReturnValue("blob:mixed-version");
    stubLoadedVideoImage();

    await expect(
      generatePostVideo("data:image/jpeg;base64,fake", VideoStyle.GoldenRadiance, {
        durationSeconds: 8,
        aspectPreference: "auto",
        resolution: "720p",
        soundtrack: "none",
        pacing: "snappy",
      }),
    ).resolves.toBe("blob:mixed-version");

    const [firstUrl, firstInit] = fetchMock.mock.calls[0];
    const [secondUrl, secondInit] = fetchMock.mock.calls[1];
    expect(secondUrl).toBe(firstUrl);
    expect(JSON.parse(String(firstInit.body)).parameters).toHaveProperty(
      "negativePrompt",
    );
    expect(JSON.parse(String(secondInit.body)).parameters).not.toHaveProperty(
      "negativePrompt",
    );
    expect(secondInit.headers["X-Generation-Attempt-ID"]).toBe(
      firstInit.headers["X-Generation-Attempt-ID"],
    );
    // Both rejections and the accepted start share one model: the ladder never advanced.
    expect(fetchMock.mock.calls.filter(([url]) => url === firstUrl)).toHaveLength(2);
  });

  it("never re-issues a start for a relayed provider 400, which may already have been billed", async () => {
    setProxyCapabilities({ veoNegativePrompt: true });
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () =>
        JSON.stringify({
          error: { code: 400, message: "Invalid argument", status: "INVALID_ARGUMENT" },
        }),
    });
    vi.stubGlobal("fetch", fetchMock);
    stubLoadedVideoImage();

    await expect(
      generatePostVideo("data:image/jpeg;base64,fake", VideoStyle.GoldenRadiance, {
        durationSeconds: 8,
        aspectPreference: "auto",
        resolution: "720p",
        soundtrack: "none",
        pacing: "snappy",
      }),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces a content-filtered video as a blocked error without trying another model", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ name: "operations/rai-filtered-123" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: "operations/rai-filtered-123",
          done: true,
          // A refusal arrives on a *successful* operation with no sample; only
          // these fields separate it from an empty result.
          response: {
            generateVideoResponse: {
              raiMediaFilteredCount: 1,
              raiMediaFilteredReasons: [
                "Video generation blocked by our responsible AI filters.",
              ],
            },
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    stubLoadedVideoImage();

    const failure = await generatePostVideo(
      "data:image/jpeg;base64,fake",
      VideoStyle.GoldenRadiance,
      {
        durationSeconds: 8,
        aspectPreference: "auto",
        resolution: "720p",
        soundtrack: "none",
        pacing: "snappy",
      },
    ).catch((error: unknown) => error);

    const normalized = normalizeError(failure);
    expect(normalized.kind).toBe("blocked");
    expect(normalized.retryable).toBe(false);
    // Curated copy only — no provider reason text in the toast.
    expect(normalized.message).not.toContain("responsible AI");

    const startCalls = fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).includes(":predictLongRunning") && init?.method === "POST",
    );
    // One billable start, and the model ladder never advanced.
    expect(startCalls).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      label: "a provider rename of the sample's video field",
      // Structurally valid, but nothing readable — the case that used to
      // surface as the generic "no video found".
      response: {
        generateVideoResponse: {
          generatedSamples: [{ clip: { downloadUri: "https://example.test/x" } }],
        },
      },
    },
    {
      label: "a wrongly typed documented field",
      // Must fail fast rather than read as a transient poll blip and spin
      // until the six-minute timeout.
      response: { generateVideoResponse: { generatedSamples: "one video" } },
    },
  ])(
    "names an unrecognized Veo response shape ($label) instead of reporting no video found",
    async ({ response }) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ name: "operations/mangled-shape-123" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            name: "operations/mangled-shape-123",
            done: true,
            response,
          }),
        });
      vi.stubGlobal("fetch", fetchMock);
      stubLoadedVideoImage();

      const failure = await generatePostVideo(
        "data:image/jpeg;base64,fake",
        VideoStyle.GoldenRadiance,
        {
          durationSeconds: 8,
          aspectPreference: "auto",
          resolution: "720p",
          soundtrack: "none",
          pacing: "snappy",
        },
      ).catch((error: unknown) => error);

      const normalized = normalizeError(failure);
      expect(normalized.kind).toBe("validation");
      expect(normalized.retryable).toBe(false);
      // The diagnostic names what arrived; the toast copy stays curated.
      expect(String((normalized.original as Error)?.message ?? "")).toContain(
        "did not match the documented shape",
      );
      expect(normalized.message).not.toContain("generatedSamples");
      // One start, one poll — no ladder advance and no polling until timeout.
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it("accepts inline base64 only when it contains an MP4 ftyp header", () => {
    const createObjectUrl = vi
      .spyOn(global.URL, "createObjectURL")
      .mockReturnValue("blob:valid-inline-video");
    const encoded = Buffer.from(makeMp4Bytes()).toString("base64");

    expect(createVideoBlobUrl(encoded)).toBe("blob:valid-inline-video");
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(createObjectUrl.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
    expect((createObjectUrl.mock.calls[0]?.[0] as Blob).type).toBe("video/mp4");
  });

  it("normalizes a valid MP4 data URI to a CSP-safe blob URL", async () => {
    const createObjectUrl = vi
      .spyOn(global.URL, "createObjectURL")
      .mockReturnValue("blob:validated-data-uri");
    const encoded = Buffer.from(makeMp4Bytes()).toString("base64");

    await expect(
      fetchVideoThroughProxy(`data:video/mp4;base64,${encoded}`, 0),
    ).resolves.toBe("blob:validated-data-uri");
    expect(createObjectUrl).toHaveBeenCalledWith(
      expect.objectContaining({ type: "video/mp4" }),
    );
  });

  it("rejects a non-video data URI instead of returning a CSP-blocked URL", async () => {
    const encoded = Buffer.from(
      JSON.stringify({ error: "no video" }).repeat(80),
    ).toString("base64");

    await expect(
      fetchVideoThroughProxy(`data:application/json;base64,${encoded}`, 0),
    ).rejects.toThrow("Generated video data is not valid MP4 media.");
  });

  it.each([
    ["JSON", JSON.stringify({ error: "provider unavailable" }).repeat(80)],
    ["plain text", "upstream gateway failure ".repeat(100)],
  ])("rejects %s disguised as inline base64 video", (_label, payload) => {
    const encoded = Buffer.from(payload).toString("base64");

    expect(() => createVideoBlobUrl(encoded)).toThrow(
      "Generated video data is not valid MP4 media.",
    );
  });

  it("validates only a 16-byte slice and never reads the full video Blob", async () => {
    const header = makeMp4Bytes().slice(0, 16);
    const fullArrayBuffer = vi.fn(async () => {
      throw new Error("full video must not be read");
    });
    const headerArrayBuffer = vi.fn(async () => header.buffer);
    const retypedBlob = {
      size: 5_000_000,
      type: "video/mp4",
    } as Blob;
    const slice = vi.fn((start?: number, end?: number, type?: string) => {
      if (start === 0 && end === 16) {
        return {
          size: 16,
          type: "",
          arrayBuffer: headerArrayBuffer,
        } as unknown as Blob;
      }
      if (start === 0 && end === 5_000_000 && type === "video/mp4") {
        return retypedBlob;
      }
      throw new Error("unexpected Blob slice");
    });
    const rawBlob = {
      size: 5_000_000,
      type: "application/octet-stream",
      arrayBuffer: fullArrayBuffer,
      slice,
    } as unknown as Blob;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        blob: async () => rawBlob,
      })),
    );
    const createObjectUrl = vi
      .spyOn(global.URL, "createObjectURL")
      .mockReturnValue("blob:validated-proxy-video");

    await expect(
      fetchVideoThroughProxy(
        "https://generativelanguage.googleapis.com/v1beta/files/test-video:download",
        0,
      ),
    ).resolves.toBe("blob:validated-proxy-video");

    expect(fullArrayBuffer).not.toHaveBeenCalled();
    expect(headerArrayBuffer).toHaveBeenCalledTimes(1);
    expect(slice).toHaveBeenNthCalledWith(1, 0, 16);
    expect(slice).toHaveBeenNthCalledWith(2, 0, rawBlob.size, "video/mp4");
    expect(createObjectUrl).toHaveBeenCalledWith(retypedBlob);
  });

  it("canonicalizes a trusted suffixless Veo file URI before proxy download", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        blob: async () =>
          new Blob([makeMp4Bytes().buffer as ArrayBuffer], {
            type: "video/mp4",
          }),
      })),
    );
    vi.spyOn(global.URL, "createObjectURL").mockReturnValue(
      "blob:suffixless-provider-video",
    );

    await expect(
      fetchVideoThroughProxy(
        "https://generativelanguage.googleapis.com/v1beta/files/suffixless-video",
        0,
      ),
    ).resolves.toBe("blob:suffixless-provider-video");

    expect(fetch).toHaveBeenCalledWith(
      "/api/proxy/v1beta/files/suffixless-video:download?alt=media",
      expect.objectContaining({
        method: "GET",
        credentials: "include",
      }),
    );
  });

  it("retries a transient video-download proxy failure without starting another job", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        body: null,
        text: async () => "temporary proxy failure",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        blob: async () =>
          new Blob([makeMp4Bytes().buffer as ArrayBuffer], {
            type: "application/octet-stream",
          }),
      });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(global.URL, "createObjectURL").mockReturnValue(
      "blob:retried-provider-video",
    );

    const download = fetchVideoThroughProxy(
      "https://generativelanguage.googleapis.com/v1beta/files/retry-video:download",
      0,
    );

    await expect(download).resolves.toBe("blob:retried-provider-video");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toMatchObject({
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: {
          Accept: "video/mp4, application/octet-stream;q=0.9",
        },
      });
    }
  });

  it("fails clearly without retrying when provider media has expired", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 410,
      text: async () => "gone",
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchVideoThroughProxy(
        "https://generativelanguage.googleapis.com/v1beta/files/expired-video:download",
        0,
      ),
    ).rejects.toThrow(/no longer available.*Generate the video again/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    "https://generativelanguage.googleapis.com.attacker.example/v1beta/files/video",
    "https://generativelanguage.googleapis.com/v1beta/files/video/extra",
    "https://generativelanguage.googleapis.com/v1beta/models/video",
  ])("rejects an untrusted provider video URI shape: %s", async (uri) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchVideoThroughProxy(uri, 0)).rejects.toThrow(/not trusted/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["JSON", new Blob([JSON.stringify({ error: "unavailable" }).repeat(8)])],
    ["plain text", new Blob(["upstream gateway failure ".repeat(10)])],
  ])(
    "rejects a proxy %s payload even when the response is 200",
    async (_label, blob) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          status: 200,
          blob: async () => blob,
        })),
      );

      await expect(
        fetchVideoThroughProxy(
          "https://generativelanguage.googleapis.com/v1beta/files/test-video:download",
          0,
        ),
      ).rejects.toThrow("Video proxy returned invalid MP4 media.");
    },
  );

  describe("blocked-content handling", () => {
    const originalClaudeFlag = FLAGS.enableClaudeFallback;
    const originalOpenAIFlag = FLAGS.enableOpenAIFallback;
    const usableCaption =
      "A fresh set of keys and a picture-perfect delivery day at Test Dealer. Congratulations on the new ride! #TestDealer";
    // What services/geminiProxy.ts actually throws once a 5xx has exhausted
    // its retries: curated copy plus a typed `kind`. The message deliberately
    // contains no status code or vendor token, which is exactly why the
    // cross-vendor fallbacks classify on `kind` instead of substrings.
    const vendorOutage = () => {
      const error = new Error(
        "The AI service is temporarily unavailable.",
      ) as NormalizedError;
      error.kind = "model_unavailable";
      error.retryable = true;
      return error;
    };
    const isImageRequest = (request: {
      generationConfig?: { responseModalities?: string[] };
    }) => request.generationConfig?.responseModalities?.includes("IMAGE") === true;

    beforeEach(() => {
      vi.mocked(generateTextViaClaude).mockReset();
      vi.mocked(generateImageViaOpenAI).mockReset();
    });

    afterEach(() => {
      FLAGS.enableClaudeFallback = originalClaudeFlag;
      FLAGS.enableOpenAIFallback = originalOpenAIFlag;
    });

    it("stops the caption ladder on a SAFETY block and never routes it to Claude", async () => {
      FLAGS.enableClaudeFallback = true;
      mockGenerateContent.mockImplementation(() =>
        Promise.reject(createBlockedContentError("finishReason=SAFETY")),
      );

      const error: unknown = await generateSocialPostTextDetailed(
        "data:image/jpeg;base64,blocked-caption-photo",
        ToneOption.Professional,
        "Test Dealer",
      ).catch((err) => err);

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        "This photo or wording can't be used for an AI post.",
      );
      expect(normalizeError(error)).toMatchObject({
        kind: "blocked",
        retryable: false,
      });
      // One model only: the second model would be shown the same photo.
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      expect(generateTextViaClaude).not.toHaveBeenCalled();
    });

    it("surfaces a blocked caption from generateSocialPost as a typed blocked error", async () => {
      FLAGS.enableClaudeFallback = true;
      mockGenerateContent.mockImplementation((request) => {
        if (isImageTextReviewRequest(request)) return imageTextReviewResponse();
        if (isImageRequest(request)) return Promise.resolve(generatedImageResponse());
        return Promise.reject(
          createBlockedContentError("finishReason=PROHIBITED_CONTENT"),
        );
      });

      const error: unknown = await generateSocialPost(
        "data:image/jpeg;base64,blocked-post-photo",
        StyleOption.Modern,
        ToneOption.Professional,
        "Test Dealer",
      ).catch((err) => err);

      expect((error as Error).message).toContain("Failed to generate text content");
      const normalized = normalizeError(error);
      expect(normalized.kind).toBe("blocked");
      expect(normalized.retryable).toBe(false);
      expect(normalized.message).toBe(
        "This photo or wording can't be used for an AI post.",
      );
      expect(generateTextViaClaude).not.toHaveBeenCalled();
      const captionCalls = mockGenerateContent.mock.calls.filter(
        ([request]) => request.task === "caption",
      );
      expect(captionCalls).toHaveLength(1);
    });

    it("advances the ladder after a MAX_TOKENS reasoning-only response", async () => {
      const maxTokensError = new Error(
        "Gemini stopped at MAX_TOKENS before producing any output (only reasoning parts were returned).",
      );
      expect(normalizeError(maxTokensError).retryable).toBe(true);
      expect(normalizeError(maxTokensError).kind).not.toBe("blocked");
      mockGenerateContent
        .mockImplementationOnce(() => Promise.reject(maxTokensError))
        .mockImplementationOnce(() => Promise.resolve({ text: () => usableCaption }));

      const result = await generateSocialPostTextDetailed(
        "data:image/jpeg;base64,max-tokens-photo",
        ToneOption.Professional,
        "Test Dealer",
      );

      expect(result.captionSource).toBe("ai");
      expect(result.aiMeta.provider).toBe("gemini");
      expect(result.aiMeta.model).toBe(TASKS.caption.fallback);
      expect(result.aiMeta.fallbackCount).toBe(1);
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    });

    it("still routes a vendor outage to Claude and sends the source photo", async () => {
      FLAGS.enableClaudeFallback = true;
      mockGenerateContent.mockImplementation(() => Promise.reject(vendorOutage()));
      vi.mocked(generateTextViaClaude).mockResolvedValue(usableCaption);

      const result = await generateSocialPostTextDetailed(
        "data:image/jpeg;base64,claude-fallback-photo",
        ToneOption.Professional,
        "Test Dealer",
      );

      expect(mockGenerateContent).toHaveBeenCalledTimes(TASKS.caption.models.length);
      expect(result.captionSource).toBe("ai");
      expect(result.aiMeta.provider).toBe("anthropic");
      expect(result.aiMeta.model).toBe(TASKS.caption.claudeFallback);
      expect(generateTextViaClaude).toHaveBeenCalledTimes(1);
      const [prompt, options] = vi.mocked(generateTextViaClaude).mock.calls[0];
      expect(prompt).not.toContain("image was not transmitted");
      expect(options).toMatchObject({
        task: "caption",
        model: TASKS.caption.claudeFallback,
        temperature: TASKS.caption.claudeTemperature,
        maxTokens: TASKS.caption.params.maxOutputTokens,
        image: { mimeType: "image/jpeg", data: "claude-fallback-photo" },
      });
    });

    it("ships the original photo on an image block without calling OpenAI", async () => {
      FLAGS.enableOpenAIFallback = true;
      let imageCalls = 0;
      mockGenerateContent.mockImplementation((request) => {
        if (isImageTextReviewRequest(request)) return imageTextReviewResponse();
        if (isImageRequest(request)) {
          imageCalls += 1;
          return Promise.reject(createBlockedContentError("finishReason=IMAGE_SAFETY"));
        }
        return Promise.resolve({ text: () => usableCaption });
      });

      const result = await generateSocialPost(
        "data:image/jpeg;base64,blocked-image-photo",
        StyleOption.Modern,
        ToneOption.Professional,
        "Test Dealer",
      );

      expect(result.image).toBe("data:image/jpeg;base64,blocked-image-photo");
      expect(result.aiMeta.image.provider).toBe("original");
      expect(result.text).toBe(usableCaption);
      expect(imageCalls).toBe(1);
      expect(generateImageViaOpenAI).not.toHaveBeenCalled();
    });

    it("still falls back to OpenAI for a vendor outage on the image ladder", async () => {
      FLAGS.enableOpenAIFallback = true;
      let imageCalls = 0;
      mockGenerateContent.mockImplementation((request) => {
        if (isImageTextReviewRequest(request)) return imageTextReviewResponse();
        if (isImageRequest(request)) {
          imageCalls += 1;
          return Promise.reject(vendorOutage());
        }
        return Promise.resolve({ text: () => usableCaption });
      });
      vi.mocked(generateImageViaOpenAI).mockResolvedValue(
        "data:image/png;base64,openai-fallback-image",
      );

      const result = await generateSocialPost(
        "data:image/jpeg;base64,openai-fallback-photo",
        StyleOption.Modern,
        ToneOption.Professional,
        "Test Dealer",
      );

      expect(imageCalls).toBe(TASKS.image_standard.models.length);
      expect(generateImageViaOpenAI).toHaveBeenCalledTimes(1);
      expect(result.image).toBe("data:image/png;base64,openai-fallback-image");
      expect(result.aiMeta.image.provider).toBe("openai");
    });

    it("sends the prompt text before the image bytes on caption and image requests", async () => {
      await generateSocialPost(
        "data:image/jpeg;base64,text-first-photo",
        StyleOption.Modern,
        ToneOption.Professional,
        "Test Dealer",
      );

      const orderedCalls = mockGenerateContent.mock.calls.filter(
        ([request]) => request.task === "caption" || isImageRequest(request),
      );
      expect(orderedCalls.length).toBeGreaterThanOrEqual(2);
      for (const [request] of orderedCalls) {
        const parts = request.contents.parts as Array<{
          text?: string;
          inlineData?: unknown;
        }>;
        expect(parts[0]).toHaveProperty("text");
        expect(parts[1]).toHaveProperty("inlineData");
      }
    });
  });
});
