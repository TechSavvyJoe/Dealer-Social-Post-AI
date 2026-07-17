import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  generateFunSocialPostImage,
  generateSocialPost,
  generatePostVideo,
} from "./geminiService";
import { StyleOption, ToneOption, VideoStyle } from "../types";
import { MODELS, TASKS } from "./modelConfig";

// Hoist the mocks so they can be used in the mock factory
const { mockGenerateContent, mockGenerateVideos, mockGetVideosOperation } =
  vi.hoisted(() => {
    return {
      mockGenerateContent: vi.fn(),
      mockGenerateVideos: vi.fn(),
      mockGetVideosOperation: vi.fn(),
    };
  });

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

/**
 * These tests pin the model-routing behaviour after the 2026-05-27 refactor
 * that moved hardcoded model IDs into `services/modelConfig.ts`. The asserts
 * now check that calls hit *whatever* model the config declares as primary
 * for each task, so if Joe bumps a model in modelConfig the tests follow.
 */
describe("GeminiService model routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockGenerateContent.mockResolvedValue({
      text: () => "Generated text",
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  mimeType: "image/png",
                  data: "generated-image-data",
                },
              },
            ],
          },
        },
      ],
    });

    mockGenerateVideos.mockResolvedValue({
      done: true,
      response: {
        generatedVideos: [
          { video: { uri: "http://fake-video-url.com/video.mp4" } },
        ],
      },
    });
  });

  afterEach(() => {
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
      maxOutputTokens: 900,
    });
    expect(textCall?.[0].generationConfig).not.toHaveProperty("temperature");
    expect(textCall?.[0].generationConfig).not.toHaveProperty("topK");
    expect(textCall?.[0].generationConfig).not.toHaveProperty("topP");
  });

  it("routes image generation through the image_generate task's primary model", async () => {
    await generateSocialPost(
      "data:image/jpeg;base64,fake",
      StyleOption.Modern,
      ToneOption.Professional,
      "Test Dealer",
    );

    const expected = TASKS.image_generate.primary;
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

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/files/dealers/dealer-id/logo.png",
      { credentials: "include" },
    );
    const imageCall = mockGenerateContent.mock.calls.find(
      (call) => call[0].model === TASKS.image_generate.primary,
    );
    expect(imageCall?.[0].contents.parts).toHaveLength(3);
  });

  it("keeps the Lite image fallback on its supported 1K output", async () => {
    mockGenerateContent.mockImplementation(({ model }) => {
      if (model !== MODELS.image.emergency) {
        return Promise.reject(new Error("503 model unavailable"));
      }
      return Promise.resolve({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: "image/png",
                    data: "generated-image-data",
                  },
                },
              ],
            },
          },
        ],
      });
    });

    await generateFunSocialPostImage(
      "data:image/jpeg;base64,fake",
      "Test Dealer",
    );

    const liteCall = mockGenerateContent.mock.calls.find(
      (call) => call[0].model === MODELS.image.emergency,
    );
    expect(liteCall?.[0].generationConfig).toMatchObject({
      imageConfig: { imageSize: "1K" },
    });
  });

  it("uses production-stable Google model identifiers", () => {
    expect(MODELS.text.primary).toBe("gemini-3.5-flash");
    expect(MODELS.image.primary).toBe("gemini-3-pro-image");
    expect(MODELS.image.fallback).toBe("gemini-3.1-flash-image");
    expect(MODELS.image.emergency).toBe("gemini-3.1-flash-lite-image");
    expect(MODELS.video.primary).toBe("veo-3.1-generate-preview");
    expect(MODELS.video.fallback).toBe("veo-3.1-fast-generate-preview");

    expect(JSON.stringify(MODELS.text)).not.toContain("preview");
    expect(JSON.stringify(MODELS.image)).not.toContain("preview");
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
                        uri: "https://generativelanguage.googleapis.com/v1beta/files/test-video:download",
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
              new Blob(["fake-video-data"], { type: "video/mp4" }),
            ),
        }),
    );
    vi.spyOn(global.URL, "createObjectURL").mockReturnValue(
      "blob:fake-video-url",
    );

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
      expect.stringContaining("veo-3.1-generate-preview"),
      expect.objectContaining({
        body: expect.stringMatching(
          /"image":\{"bytesBase64Encoded":"[^"]+","mimeType":"image\/jpeg"\}/,
        ),
      }),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("veo-3.1-generate-preview"),
      expect.objectContaining({
        body: expect.stringContaining('"resolution":"720p"'),
      }),
    );
    expect(vi.mocked(global.fetch).mock.calls[0]?.[1]?.body).not.toContain(
      "inlineData",
    );
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/proxy/v1beta/files/test-video:download",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
    expect(result).toBe("blob:fake-video-url");
  }, 30000);
});
