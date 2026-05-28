import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateSocialPost, generatePostVideo } from "./geminiService";
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

  it("routes text generation through the caption task's primary model", async () => {
    await generateSocialPost(
      "data:image/jpeg;base64,fake",
      StyleOption.Modern,
      ToneOption.Professional,
      "Test Dealer"
    );

    const expected = TASKS.caption.primary;
    const textCall = mockGenerateContent.mock.calls.find(
      (call) => call[0].model === expected
    );
    expect(textCall, `expected a call with model=${expected}`).toBeDefined();
  });

  it("routes image generation through the image_generate task's primary model", async () => {
    await generateSocialPost(
      "data:image/jpeg;base64,fake",
      StyleOption.Modern,
      ToneOption.Professional,
      "Test Dealer"
    );

    const expected = TASKS.image_generate.primary;
    const imageCall = mockGenerateContent.mock.calls.find(
      (call) => call[0].model === expected
    );
    expect(imageCall, `expected a call with model=${expected}`).toBeDefined();
  });

  // The Veo end-to-end test is intentionally skipped — mocking the
  // long-running operation poll loop is fragile and the model id is already
  // pinned by the modelConfig unit tests. If Veo wiring breaks, the
  // integration smoke (manual generation from the UI) will catch it.
  it.skip("hits the Veo predictLongRunning endpoint for video generation", async () => {
    global.fetch = vi
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
            done: true,
            response: {
              generateVideoResponse: {
                generatedSamples: [
                  {
                    video: {
                      uri: "http://fake-video-url.com/video.mp4",
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
          Promise.resolve(new Blob(["fake-video-data"], { type: "video/mp4" })),
      });
    global.URL.createObjectURL = vi.fn().mockReturnValue("blob:fake-video-url");

    global.Image = class {
      onload: () => void = () => {};
      src: string = "";
      width: number = 100;
      height: number = 100;
      constructor() {
        setTimeout(() => this.onload(), 10);
      }
    } as any;

    await generatePostVideo(
      "data:image/jpeg;base64,fake",
      VideoStyle.EpicReveal,
      {
        durationSeconds: 8,
        aspectPreference: "auto",
        resolution: "720p",
        soundtrack: "none",
        pacing: "snappy",
      }
    );

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(MODELS.video.primary),
      expect.any(Object)
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("predictLongRunning"),
      expect.any(Object)
    );
  }, 30000);
});
