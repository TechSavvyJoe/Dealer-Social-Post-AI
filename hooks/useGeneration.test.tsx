import React from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StyleOption, ToneOption, type GeneratedPost } from "../types";
import { useGeneration } from "./useGeneration";

const mocks = vi.hoisted(() => ({
  store: {} as Record<string, unknown>,
  setGeneratedPost: vi.fn(),
  setGenerationParams: vi.fn(),
  setError: vi.fn(),
  setStep: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
  generateSocialPost: vi.fn(),
  generateFunSocialPostImage: vi.fn(),
  editSocialPostImage: vi.fn(),
  generateSocialPostText: vi.fn(),
  generateSocialPostTextDetailed: vi.fn(),
  editSocialPostText: vi.fn(),
  editSocialPostTextDetailed: vi.fn(),
  generatePostVideo: vi.fn(),
  loadGeminiService: vi.fn(),
  logPost: vi.fn(),
  renderFormat: vi.fn(async (source: string) => source),
}));

vi.mock("../stores/appStore", () => ({
  useAppStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.store),
    { getState: () => mocks.store },
  ),
}));

vi.mock("./useGemini", () => ({
  useGemini: () => ({
    runGeminiTask: async (_name: string, task: () => Promise<unknown>) => task(),
    loadGeminiService: mocks.loadGeminiService,
  }),
}));

vi.mock("../components/ui/Toast", () => ({
  useToast: () => ({ error: mocks.toastError, warning: mocks.toastWarning }),
}));

vi.mock("../services/posts", () => ({
  logPost: mocks.logPost,
}));

vi.mock("../services/photoReleases", () => ({
  runWithPersistedPhotoRelease: async (
    _captured: unknown,
    _dealerName: string,
    providerTask: () => Promise<unknown>,
  ) => ({ result: await providerTask() }),
  linkReleaseToPost: vi.fn(),
}));

vi.mock("../utils/telemetry", () => ({
  logEvent: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("../utils/multiFormatExport", () => ({
  EXPORT_FORMATS: [
    { id: "story_vertical", width: 1080, height: 1920 },
    { id: "feed_portrait", width: 1080, height: 1350 },
    { id: "feed_square", width: 1080, height: 1080 },
    { id: "marketplace", width: 1200, height: 628 },
    { id: "gbp", width: 1200, height: 900 },
  ],
  renderFormat: mocks.renderFormat,
}));

const imageMeta = {
  task: "image_studio",
  tier: "studio" as const,
  provider: "gemini",
  model: "gemini-3-pro-image",
  fallbackCount: 2,
  lastSuccessAt: "2026-07-17T12:00:00.000Z",
};

const existingPost: GeneratedPost = {
  image: "data:image/png;base64,aW1hZ2U=",
  text: "Original caption",
  captionSource: "ai",
  isBasicFallback: false,
  aiMeta: {
    captionSource: "ai",
    selectedTier: "studio",
    model: "gemini-3.6-flash",
    fallbackCount: 2,
    lastSuccessfulGenerationAt: "2026-07-17T12:00:00.000Z",
    caption: {
      task: "caption",
      tier: "quality",
      provider: "gemini",
      model: "gemini-3.6-flash",
      fallbackCount: 0,
      lastSuccessAt: "2026-07-17T11:00:00.000Z",
    },
    image: imageMeta,
    modelPolicyVersion: "2",
  },
};

const generatedResult = {
  image: "data:image/png;base64,bmV3",
  text: "Generated caption",
  captionSource: "ai" as const,
  aiMeta: existingPost.aiMeta!,
};

const renderGeneration = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const rendered = renderHook(() => useGeneration(), { wrapper });
  return {
    ...rendered,
    cleanup: () => {
      rendered.unmount();
      queryClient.clear();
    },
  };
};

describe("useGeneration model-tier and provenance wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(mocks.store, {
      currentDealer: { id: "dealer-1", name: "Example Motors" },
      selectedImage: "data:image/png;base64,b3JpZ2luYWw=",
      generatedPost: existingPost,
      generationParams: {
        style: StyleOption.Modern,
        tone: ToneOption.Professional,
        customerName: "Alex",
        platformIds: [],
      },
      preferredTone: ToneOption.Professional,
      imageQualityTier: "studio",
      authEpoch: 1,
      setGeneratedPost: mocks.setGeneratedPost,
      setGenerationParams: mocks.setGenerationParams,
      setError: mocks.setError,
      setStep: mocks.setStep,
    });
    mocks.generateSocialPost.mockResolvedValue(generatedResult);
    mocks.generateFunSocialPostImage.mockResolvedValue("data:image/png;base64,ZnVu");
    mocks.editSocialPostImage.mockResolvedValue("data:image/png;base64,ZWRpdA==");
    mocks.logPost.mockResolvedValue(null);
    mocks.loadGeminiService.mockResolvedValue({
      generateSocialPost: mocks.generateSocialPost,
      generateFunSocialPostImage: mocks.generateFunSocialPostImage,
      editSocialPostImage: mocks.editSocialPostImage,
      generateSocialPostText: mocks.generateSocialPostText,
      generateSocialPostTextDetailed: mocks.generateSocialPostTextDetailed,
      editSocialPostText: mocks.editSocialPostText,
      editSocialPostTextDetailed: mocks.editSocialPostTextDetailed,
      generatePostVideo: mocks.generatePostVideo,
    });
  });

  it("passes the persisted Studio preference through every image path", async () => {
    const { result, cleanup } = renderGeneration();

    await act(async () => {
      await result.current.handleGenerate(
        StyleOption.Modern,
        ToneOption.Professional,
        "Alex",
      );
      await result.current.handleRegenerateImage();
      await result.current.handleFunMode("Golden Delivery");
      await result.current.handleEditImage("Add a subtle spotlight");
    });

    expect(mocks.generateSocialPost).toHaveBeenCalledTimes(2);
    expect(mocks.generateSocialPost.mock.calls[0].at(-2)).toBe("studio");
    expect(mocks.generateSocialPost.mock.calls[1].at(-2)).toBe("studio");
    expect(mocks.generateSocialPost.mock.calls[0].at(-1)).toBe("9:16");
    expect(mocks.generateSocialPost.mock.calls[1].at(-1)).toBe("9:16");
    expect(mocks.generateFunSocialPostImage.mock.calls[0].at(-2)).toBe("studio");
    expect(mocks.generateFunSocialPostImage.mock.calls[0].at(-1)).toBe("9:16");
    expect(mocks.editSocialPostImage.mock.calls[0].at(-2)).toBe("studio");
    expect(mocks.editSocialPostImage.mock.calls[0].at(-1)).toBe("9:16");
    expect(mocks.renderFormat).toHaveBeenCalledTimes(4);

    cleanup();
  });

  it("derives and persists the native primary image profile from destinations", async () => {
    const { result, cleanup } = renderGeneration();

    await act(async () => {
      await result.current.handleGenerate(
        StyleOption.Modern,
        ToneOption.Professional,
        "Alex",
        undefined,
        undefined,
        undefined,
        ["gbp"],
      );
    });

    expect(mocks.generateSocialPost.mock.calls[0].at(-1)).toBe("4:3");
    expect(mocks.setGenerationParams).toHaveBeenCalledWith(
      expect.objectContaining({
        platformIds: ["gbp"],
        primaryFormatId: "gbp",
        imageAspectRatio: "4:3",
      }),
    );
    expect(mocks.setGeneratedPost.mock.calls.at(-1)?.[0]).toMatchObject({
      primaryFormatId: "gbp",
      imageAspectRatio: "4:3",
    });

    cleanup();
  });

  it("persists an explicit output format and media plan for retry and remix", async () => {
    const { result, cleanup } = renderGeneration();

    await act(async () => {
      await result.current.handleGenerate(
        StyleOption.Modern,
        ToneOption.Professional,
        "Alex",
        undefined,
        undefined,
        { scenarioId: "preowned_spotlight" },
        ["facebook_feed", "gbp"],
        {
          primaryFormatId: "marketplace",
          imageAspectRatio: "16:9",
          label: "Marketplace · 16:9 master",
        },
        "both",
      );
    });

    expect(mocks.generateSocialPost.mock.calls[0].at(-1)).toBe("16:9");
    expect(mocks.setGenerationParams).toHaveBeenCalledWith(
      expect.objectContaining({
        platformIds: ["facebook_feed", "gbp"],
        scenarioId: "preowned_spotlight",
        mediaOutputMode: "both",
        primaryFormatId: "marketplace",
        imageAspectRatio: "16:9",
      }),
    );
    expect(mocks.setGeneratedPost.mock.calls.at(-1)?.[0]).toMatchObject({
      platformIds: ["facebook_feed", "gbp"],
      mediaOutputMode: "both",
      primaryFormatId: "marketplace",
      imageAspectRatio: "16:9",
    });

    cleanup();
  });

  it("persists disclosures triggered only by a platform caption variant", async () => {
    mocks.generateSocialPostText.mockResolvedValue(
      JSON.stringify({
        facebook_feed: "Lease for $299/mo with approved credit.",
        instagram_feed: "A great delivery day at Example Motors.",
      }),
    );
    const { result, cleanup } = renderGeneration();

    await act(async () => {
      await result.current.handleGenerate(
        StyleOption.Modern,
        ToneOption.Professional,
        "Alex",
        undefined,
        undefined,
        undefined,
        ["facebook_feed", "instagram_feed"],
      );
    });

    const finalPost = mocks.setGeneratedPost.mock.calls.at(-1)?.[0] as
      GeneratedPost | undefined;
    expect(finalPost?.text).toContain("Generated caption");
    expect(finalPost?.text).not.toContain("— Disclosures —");
    expect(finalPost?.platformCaptions?.facebook_feed).toContain("$299/mo");
    expect(finalPost?.disclosures).toContain("Lease offer with approved credit");
    expect(mocks.logPost).toHaveBeenCalledWith(
      expect.objectContaining({
        disclosures: expect.stringContaining("Lease offer with approved credit"),
      }),
      1,
    );

    cleanup();
  });

  it.each([
    {
      label: "provider success",
      captionSource: "ai" as const,
      provider: "gemini",
      model: "gemini-3.5-flash-lite",
      fallbackCount: 1,
      lastSuccessAt: "2026-07-17T13:00:00.000Z",
      expectedFallback: false,
      expectedTotalFallbacks: 3,
      expectedLatestSuccess: "2026-07-17T13:00:00.000Z",
    },
    {
      label: "safe template fallback",
      captionSource: "basic_fallback" as const,
      provider: "basic_fallback",
      model: null,
      fallbackCount: 3,
      lastSuccessAt: null,
      expectedFallback: true,
      expectedTotalFallbacks: 5,
      expectedLatestSuccess: "2026-07-17T12:00:00.000Z",
    },
  ])(
    "replaces caption provenance after $label",
    async ({
      captionSource,
      provider,
      model,
      fallbackCount,
      lastSuccessAt,
      expectedFallback,
      expectedTotalFallbacks,
      expectedLatestSuccess,
    }) => {
      mocks.generateSocialPostTextDetailed.mockResolvedValue({
        text:
          captionSource === "basic_fallback"
            ? "A ready-to-share update from Example Motors."
            : "Fresh delivery-day caption.",
        captionSource,
        aiMeta: {
          task: "caption_regenerate",
          tier: "fast",
          provider,
          model,
          fallbackCount,
          lastSuccessAt,
        },
      });
      const { result, cleanup } = renderGeneration();

      await act(async () => {
        await result.current.handleRegenerateText();
      });

      const updated = mocks.setGeneratedPost.mock.calls.at(-1)?.[0] as
        GeneratedPost | undefined;
      expect(updated).toBeDefined();
      expect(updated?.captionSource).toBe(captionSource);
      expect(updated?.isBasicFallback).toBe(expectedFallback);
      expect(updated?.aiMeta).toMatchObject({
        captionSource,
        selectedTier: "studio",
        fallbackCount: expectedTotalFallbacks,
        lastSuccessfulGenerationAt: expectedLatestSuccess,
        caption: {
          task: "caption_regenerate",
          provider,
          model,
          fallbackCount,
          lastSuccessAt,
        },
        image: imageMeta,
        modelPolicyVersion: "2",
      });
      if (model) {
        expect(updated?.aiMeta?.model).toBe(model);
      } else {
        expect(updated?.aiMeta).not.toHaveProperty("model");
      }
      expect(mocks.generateSocialPostTextDetailed).toHaveBeenCalledTimes(1);

      cleanup();
    },
  );

  it("edits the visible caption source and persists the returned replacement", async () => {
    mocks.editSocialPostTextDetailed.mockResolvedValue({
      text: "A warmer thank-you for a wonderful delivery day.",
      captionSource: "ai",
      aiMeta: {
        task: "caption_edit",
        tier: "fast",
        provider: "gemini",
        model: "gemini-3.5-flash-lite",
        fallbackCount: 0,
        lastSuccessAt: "2026-07-28T16:00:00.000Z",
      },
    });
    const { result, cleanup } = renderGeneration();

    let replacement = "";
    await act(async () => {
      replacement = await result.current.handleEditText(
        "Make it warmer and add a thank-you.",
        "The salesperson's current manual caption.",
      );
    });

    expect(mocks.editSocialPostTextDetailed).toHaveBeenCalledWith(
      "The salesperson's current manual caption.",
      "Make it warmer and add a thank-you.",
      ToneOption.Professional,
    );
    expect(replacement).toContain("A warmer thank-you for a wonderful delivery day.");
    expect(mocks.setGeneratedPost.mock.calls.at(-1)?.[0]).toMatchObject({
      text: replacement,
      captionSource: "ai",
      aiMeta: {
        caption: {
          task: "caption_edit",
          model: "gemini-3.5-flash-lite",
        },
      },
    });

    cleanup();
  });
});
