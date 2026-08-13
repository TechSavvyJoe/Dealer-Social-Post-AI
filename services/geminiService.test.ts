import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createVideoBlobUrl,
  editSocialPostTextDetailed,
  fetchVideoThroughProxy,
  generateFunSocialPostImage,
  generateSocialPost,
  generatePostVideo,
  generateWebsiteDraftMetadata,
  type GeneratedImageTextReview,
} from "./geminiService";
import { StyleOption, ToneOption, VideoStyle } from "../types";
import { MODEL_POLICY_VERSION, MODELS, TASKS } from "./modelConfig";

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

vi.mock("../utils/imageUtils", () => ({
  parseDataUrl: () => ({ mimeType: "image/jpeg", data: "fake-data" }),
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
    const textCall = mockGenerateContent.mock.calls.find(
      (call) => call[0].model === expected,
    );
    expect(textCall, `expected a call with model=${expected}`).toBeDefined();
    expect(textCall?.[0].generationConfig).toEqual({
      maxOutputTokens: 2048,
    });
    expect(textCall?.[0].generationConfig).not.toHaveProperty("temperature");
    expect(textCall?.[0].generationConfig).not.toHaveProperty("topK");
    expect(textCall?.[0].generationConfig).not.toHaveProperty("topP");
  });

  it("routes standard image generation through Flash Image first", async () => {
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
    expect(reviewRequest?.generationConfig).toEqual({ maxOutputTokens: 2048 });
    expect(reviewRequest?.generationConfig).not.toHaveProperty("responseMimeType");
    expect(reviewRequest?.generationConfig).not.toHaveProperty("responseSchema");
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

  it("runs the full ladder for repeat craft violations but still ships a render", async () => {
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

    // Ladder still runs in full: initial render, tighter-copy re-render, then
    // the text-reduction edit. But an overlay that is merely too wordy is a
    // craft problem, not an unsafe one, so the last render ships instead of
    // the untouched photo — losing the whole creative reads to the user as the
    // app having done nothing. Unsafe overlays (phone/link/hashtag) still fall
    // back; that is covered by its own test below.
    expect(result.image).toBe("data:image/png;base64,still-long-3");
    expect(result.aiMeta.image.provider).not.toBe("original");
    expect(imageCalls).toBe(3);
    expect(reviewCalls).toBe(3);
    const reductionCall = mockGenerateContent.mock.calls.find(([request]) =>
      request.contents?.parts?.some((part: { text?: string }) =>
        part.text?.includes("Reduce the AI-added marketing overlay text"),
      ),
    );
    expect(reductionCall).toBeDefined();
  });

  it("passes the image through when the vision review itself fails", async () => {
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

    // A broken reviewer must never destroy a finished creative.
    expect(result.image).toBe("data:image/png;base64,styled-overlay-image");
    expect(imageCalls).toBe(1);
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

  it("keeps the rendered creative when every rung is flagged only on craft grounds", async () => {
    // The reviewer stays unhappy through regeneration and correction, but only
    // ever reports word-count/sentence findings. Discarding the render here
    // drops the salesperson back to their raw camera photo, which is the exact
    // "it did nothing to my image" failure this ladder exists to prevent.
    let imageCalls = 0;
    mockGenerateContent.mockImplementation((request) => {
      if (isImageTextReviewRequest(request)) {
        return imageTextReviewResponse({
          ...compliantImageTextReview,
          compliant: false,
          uncertain: false,
          detectedMarketingText: ["YOUR NEW ADVENTURE STARTS HERE TODAY"],
          marketingWordCount: 6,
          marketingCharacterCount: 36,
          hasFullSentence: true,
          hasHashtag: false,
          hasUrlOrPhone: false,
          violations: ["full_sentence"],
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

    expect(result.image).not.toBe("data:image/jpeg;base64,original-photo");
    expect(result.image).toMatch(/^data:image\/png;base64,render-/);
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

  it("passes an uncertain-only review through without correction", async () => {
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

    expect(result.image).toBe("data:image/png;base64,stylized-type-image");
    expect(imageCalls).toBe(1);
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
    const logoMissingReview: GeneratedImageTextReview = {
      ...compliantImageTextReview,
      logoPresent: false,
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
        return imageTextReviewResponse(logoMissingReview);
      }
      if (request.generationConfig?.responseModalities?.includes("IMAGE")) {
        imageCalls += 1;
        return Promise.resolve(
          generatedImageResponse(
            imageCalls === 1 ? "logo-missing-image" : "logo-restored-image",
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
      undefined,
      "/api/files/dealers/dealer-id/logo.png",
    );

    expect(result.image).toBe("data:image/png;base64,logo-restored-image");
    expect(imageCalls).toBe(2);
    const restoreCall = mockGenerateContent.mock.calls.find(([request]) =>
      request.contents?.parts?.some((part: { text?: string }) =>
        part.text?.includes("missing from the design"),
      ),
    );
    expect(restoreCall).toBeDefined();
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
    expect(mockGenerateContent.mock.calls[0]?.[0].generationConfig).toEqual({
      maxOutputTokens: 2048,
    });
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
    expect(MODELS.image.primary).toBe("gemini-3.1-flash-image");
    expect(MODELS.image.studio).toBe("gemini-3-pro-image");
    expect(MODELS.image.fallback).toBe("gemini-3-pro-image");
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
                      video: {
                        downloadUri:
                          "https://generativelanguage.googleapis.com/v1beta/files/test-video",
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
      ).rejects.toThrow(`Video generation failed (${status})`);

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
});
