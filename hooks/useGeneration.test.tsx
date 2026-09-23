import React from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppStep, StyleOption, ToneOption, type GeneratedPost } from "../types";
import type { CapturedRelease } from "../services/photoReleases";
import { createBlockedContentError } from "../utils/errorHandler";
import { logEvent } from "../utils/telemetry";
import {
  isReleaseAlreadyLinked,
  useGeneration,
  type GenerationCancelResult,
  type GenerationStage,
} from "./useGeneration";

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
  generatePlatformCaptionPack: vi.fn(),
  generateWebsiteDraftMetadata: vi.fn(),
  editSocialPostText: vi.fn(),
  editSocialPostTextDetailed: vi.fn(),
  generatePostVideo: vi.fn(),
  loadGeminiService: vi.fn(),
  logPost: vi.fn(),
  linkReleaseToPostWithRetry: vi.fn(),
  renderFormat: vi.fn(async (source: string) => source),
  /** The signature upload inside the consent gate; resolves `{ id }` or nothing. */
  saveRelease: vi.fn<(captured: unknown) => Promise<{ id: string } | undefined>>(
    async () => undefined,
  ),
  // Mirrors enqueueTask: a caller's abort rejects at once and aborts the
  // task's own signal, whether or not the task honours it.
  runGeminiTask: vi.fn(
    async (
      _name: string,
      task: (signal: AbortSignal) => Promise<unknown>,
      _metadata?: Record<string, unknown>,
      signal?: AbortSignal,
    ) => {
      const controller = new AbortController();
      if (!signal) return task(controller.signal);
      return new Promise((resolve, reject) => {
        const abort = () => {
          controller.abort();
          reject(signal.reason ?? new DOMException("Task aborted", "AbortError"));
        };
        if (signal.aborted) {
          abort();
          return;
        }
        signal.addEventListener("abort", abort, { once: true });
        task(controller.signal).then(resolve, reject);
      });
    },
  ),
}));

vi.mock("../stores/appStore", () => ({
  useAppStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.store),
    { getState: () => mocks.store },
  ),
}));

vi.mock("./useGemini", () => ({
  useGemini: () => ({
    runGeminiTask: mocks.runGeminiTask,
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
  // Mirrors the real gate: a captured signature is durably stored (and given
  // an id, kept on the captured object) before the provider task ever runs.
  runWithPersistedPhotoRelease: async (
    captured: { releaseId?: string } | undefined,
    _dealerName: string,
    providerTask: () => Promise<unknown>,
  ) => {
    if (captured && !captured.releaseId) {
      const saved = await mocks.saveRelease(captured);
      captured.releaseId = saved?.id ?? "release-stored-1";
    }
    return {
      result: await providerTask(),
      ...(captured ? { releaseId: captured.releaseId } : {}),
    };
  },
  linkReleaseToPost: vi.fn(),
  linkReleaseToPostWithRetry: mocks.linkReleaseToPostWithRetry,
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

const renderGeneration = (
  onRender?: (value: ReturnType<typeof useGeneration>) => void,
) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const rendered = renderHook(
    () => {
      const value = useGeneration();
      onRender?.(value);
      return value;
    },
    { wrapper },
  );
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
        creativeBrief:
          "Post scenario: Service Promotion. Target platforms (dealership priority): Instagram Story.",
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
    mocks.linkReleaseToPostWithRetry.mockResolvedValue({
      id: "release-stored-1",
      post_id: "post-77",
      has_release: true,
    });
    mocks.loadGeminiService.mockResolvedValue({
      generateSocialPost: mocks.generateSocialPost,
      generateFunSocialPostImage: mocks.generateFunSocialPostImage,
      editSocialPostImage: mocks.editSocialPostImage,
      generateSocialPostText: mocks.generateSocialPostText,
      generateSocialPostTextDetailed: mocks.generateSocialPostTextDetailed,
      generatePlatformCaptionPack: mocks.generatePlatformCaptionPack,
      generateWebsiteDraftMetadata: mocks.generateWebsiteDraftMetadata,
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
    // The first call is the staged Create post: it carries onPartReady after
    // the signal, so its tail positions sit one further from the end.
    expect(mocks.generateSocialPost.mock.calls[0].at(-5)).toBe("studio");
    expect(mocks.generateSocialPost.mock.calls[1].at(-4)).toBe("studio");
    expect(mocks.generateSocialPost.mock.calls[0].at(-4)).toBe("1:1");
    expect(mocks.generateSocialPost.mock.calls[1].at(-3)).toBe("1:1");
    expect(mocks.generateSocialPost.mock.calls[0].at(-2)).toBeInstanceOf(AbortSignal);
    expect(mocks.generateSocialPost.mock.calls[0].at(-1)).toBeTypeOf("function");
    expect(mocks.generateFunSocialPostImage.mock.calls[0].slice(4)).toEqual([
      "studio",
      "1:1",
      "Post scenario: Service Promotion. Target platforms (dealership priority): Instagram Story.",
      expect.any(AbortSignal),
    ]);
    expect(mocks.editSocialPostImage.mock.calls[0].at(-3)).toBe("studio");
    expect(mocks.editSocialPostImage.mock.calls[0].at(-2)).toBe("1:1");
    expect(mocks.editSocialPostImage.mock.calls[0].at(-1)).toBeInstanceOf(AbortSignal);
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
        { customerIdentityRequired: true },
        ["gbp"],
      );
    });

    expect(mocks.generateSocialPost.mock.calls[0].at(-4)).toBe("4:3");
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

    expect(mocks.generateSocialPost.mock.calls[0].at(-4)).toBe("16:9");
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
    mocks.generatePlatformCaptionPack.mockResolvedValue(
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
    expect(mocks.generatePlatformCaptionPack).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("CAPTION PACK"),
      "Alex",
      true,
      expect.any(AbortSignal),
    );

    cleanup();
  });

  it("threads the customer-identity requirement into generated caption variants", async () => {
    mocks.store.generatedPost = {
      ...existingPost,
      customerDisplayName: "Alex",
      customerIdentityRequired: true,
    };
    mocks.store.generationParams = {
      ...(mocks.store.generationParams as Record<string, unknown>),
      customerName: "Alex Example",
      customerIdentityRequired: true,
    };
    mocks.generateSocialPostText.mockResolvedValue(
      "Congratulations to Alex on a wonderful delivery day at Example Motors.",
    );
    const { result, cleanup } = renderGeneration();

    const variant = await result.current.generateCaptionVariant();
    expect(variant.caption).toContain("Congratulations to Alex");
    expect(mocks.generateSocialPostText.mock.calls[0].at(-2)).toBe(true);
    expect(mocks.generateSocialPostText.mock.calls[0].at(-1)).toBeInstanceOf(
      AbortSignal,
    );

    cleanup();
  });

  it("fails legacy missing identity flags closed and preserves explicit non-customer false", async () => {
    mocks.generateSocialPostText.mockResolvedValue(
      "A polished update from Example Motors for the community.",
    );
    const { result, cleanup } = renderGeneration();

    const firstVariant = await result.current.generateCaptionVariant();
    expect(firstVariant.caption).toContain("Example Motors");
    expect(mocks.generateSocialPostText.mock.calls.at(-1)?.at(-2)).toBe(true);

    mocks.store.generatedPost = {
      ...existingPost,
      customerIdentityRequired: false,
    };
    mocks.store.generationParams = {
      ...(mocks.store.generationParams as Record<string, unknown>),
      customerIdentityRequired: undefined,
    };
    const secondVariant = await result.current.generateCaptionVariant();
    expect(secondVariant.caption).toContain("Example Motors");
    expect(mocks.generateSocialPostText.mock.calls.at(-1)?.at(-2)).toBe(false);

    cleanup();
  });

  it("prepares the private website draft from the exact finished creative", async () => {
    mocks.generateWebsiteDraftMetadata.mockResolvedValue(
      JSON.stringify({
        title: "Welcome, Alex",
        body: "Alex is ready for the road ahead with a vehicle chosen just for them.",
        altText: "Finished customer delivery creative for Example Motors.",
        category: "deliveries",
        privacyFlags: ["faces_visible"],
      }),
    );
    const { result, cleanup } = renderGeneration();

    await act(async () => {
      await result.current.handleGenerate(
        StyleOption.Modern,
        ToneOption.Professional,
        "Alex Morgan",
        undefined,
        undefined,
        {
          scenarioId: "customer_delivery",
          websiteEnabled: true,
          websiteVehicleDescription: "2025 Ford Explorer ST",
        },
      );
    });

    expect(mocks.generateWebsiteDraftMetadata).not.toHaveBeenCalled();
    expect(mocks.logPost).toHaveBeenCalledWith(
      expect.objectContaining({
        websiteDraft: expect.objectContaining({
          enabled: true,
          kind: "customer_story",
          category: "deliveries",
          customerDisplayName: "Alex",
          vehicleDescription: "2025 Ford Explorer ST",
          schemaVersion: 1,
        }),
      }),
      1,
    );

    cleanup();
  });

  it("uses explicit safe review metadata and warns when final website AI fails", async () => {
    mocks.generateWebsiteDraftMetadata.mockRejectedValueOnce(
      new Error("metadata provider unavailable"),
    );
    const { result, cleanup } = renderGeneration();

    const prepared = await result.current.handlePrepareFinalWebsiteDraft({
      caption: "The final community caption after editing.",
      image: generatedResult.image,
      currentDraft: {
        enabled: true,
        kind: "site_update",
        category: "community",
        title: "Stale initial title",
        body: "Stale initial body.",
        altText: "Stale description for an earlier image.",
        schemaVersion: 1,
      },
    });

    expect(prepared).toMatchObject({
      title: "Community update",
      body: "The final community caption after editing.",
    });
    expect(prepared?.altText).toContain("review the final image");
    expect(prepared?.altText).not.toContain("earlier image");
    expect(mocks.toastWarning).toHaveBeenCalledWith(
      expect.stringContaining("safe review placeholders"),
    );

    cleanup();
  });

  it("uses deterministic first-name-only metadata for a final customer story", async () => {
    mocks.generateWebsiteDraftMetadata.mockResolvedValueOnce("not valid json");
    const { result, cleanup } = renderGeneration();

    const prepared = await result.current.handlePrepareFinalWebsiteDraft({
      caption: "The final delivery caption after editing.",
      image: generatedResult.image,
      currentDraft: {
        enabled: true,
        kind: "customer_story",
        category: "deliveries",
        title: "Stale initial title",
        body: "Stale initial body.",
        altText: "Stale description for an earlier image.",
        customerDisplayName: "Alex",
        schemaVersion: 1,
      },
    });

    expect(prepared).toMatchObject({
      title: "Welcome, Alex",
      body: "The final delivery caption after editing.",
    });
    expect(mocks.generateWebsiteDraftMetadata).not.toHaveBeenCalled();

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
      expect.stringContaining('the only customer label allowed is exactly "Alex"'),
      ToneOption.Professional,
      expect.any(AbortSignal),
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

  it("keeps the current caption when an AI edit adds a second customer", async () => {
    mocks.editSocialPostTextDetailed.mockResolvedValue({
      text: "Congratulations to Alex and Jordan! Alex and Jordan just celebrated a delivery day.",
      captionSource: "ai",
      aiMeta: {
        task: "caption_edit",
        tier: "fast",
        provider: "gemini",
        model: "gemini-3.5-flash-lite",
        fallbackCount: 0,
        lastSuccessAt: "2026-08-14T12:00:00.000Z",
      },
    });
    const { result, cleanup } = renderGeneration();

    await expect(
      act(async () =>
        result.current.handleEditText(
          "Make this warmer.",
          "Alex is celebrating a wonderful delivery day.",
        ),
      ),
    ).rejects.toThrow("not authorized");
    expect(mocks.setGeneratedPost).not.toHaveBeenCalled();

    cleanup();
  });

  it("shows the curated blocked-content copy when the provider refuses the post", async () => {
    mocks.generateSocialPost.mockRejectedValueOnce(
      createBlockedContentError("finishReason=SAFETY"),
    );
    const { result, cleanup } = renderGeneration();

    await expect(
      act(async () =>
        result.current.handleGenerate(
          StyleOption.Modern,
          ToneOption.Professional,
          "Alex",
        ),
      ),
    ).rejects.toThrow("This photo or wording can't be used for an AI post.");

    const expectedMessage =
      "Failed to generate your post. This photo or wording can't be used for an AI post. Try a different photo or adjust the details.";
    expect(mocks.toastError).toHaveBeenCalledWith(expectedMessage);
    expect(mocks.setError).toHaveBeenCalledWith(expectedMessage);
    expect(mocks.setGeneratedPost).not.toHaveBeenCalled();

    cleanup();
  });

  describe("photo release linking", () => {
    const capturedRelease = {
      customerName: "Alex Rivera",
      signaturePngDataUrl: "data:image/png;base64,c2ln",
    };

    const generateWithRelease = async (result: {
      current: ReturnType<typeof useGeneration>;
    }) => {
      await act(async () => {
        await result.current.handleGenerate(
          StyleOption.Modern,
          ToneOption.Professional,
          "Alex",
          undefined,
          undefined,
          { capturedRelease: { ...capturedRelease } },
        );
      });
      return mocks.setGeneratedPost.mock.calls.at(-1)?.[0] as GeneratedPost | undefined;
    };

    it("marks a failed link as recoverable and carries the ids a retry needs", async () => {
      mocks.logPost.mockResolvedValue({ id: "post-77" });
      mocks.linkReleaseToPostWithRetry.mockRejectedValue(
        new Error("Photo release link failed: Service Unavailable"),
      );
      const { result, cleanup } = renderGeneration();

      const finalPost = await generateWithRelease(result);

      expect(mocks.linkReleaseToPostWithRetry).toHaveBeenCalledWith(
        "release-stored-1",
        "post-77",
        expect.objectContaining({ requestAuthEpoch: 1 }),
      );
      // Delivery stays locked, but as the repairable variant.
      expect(finalPost?.releaseStatus).toBe("save_failed");
      expect(finalPost?.releaseLinkStatus).toBe("link_failed");
      expect(finalPost?.releaseId).toBe("release-stored-1");
      expect(finalPost?.postId).toBe("post-77");
      // The banner on the result screen is the single place this is stated.
      expect(mocks.toastError).not.toHaveBeenCalled();

      cleanup();
    });

    it("unlocks delivery when the link succeeds", async () => {
      mocks.logPost.mockResolvedValue({ id: "post-77" });
      const { result, cleanup } = renderGeneration();

      const finalPost = await generateWithRelease(result);

      expect(finalPost?.releaseStatus).toBe("saved");
      expect(finalPost?.releaseLinkStatus).toBeUndefined();
      expect(finalPost?.releaseId).toBeUndefined();

      cleanup();
    });

    it("leaves a post with no stored release id on the strict, non-recoverable path", async () => {
      mocks.logPost.mockResolvedValue({
        id: "post-78",
        release_required: true,
        release_status: "pending",
      });
      const { result, cleanup } = renderGeneration();

      await act(async () => {
        await result.current.handleGenerate(
          StyleOption.Modern,
          ToneOption.Professional,
          "Alex",
        );
      });
      const finalPost = mocks.setGeneratedPost.mock.calls.at(-1)?.[0] as
        GeneratedPost | undefined;

      expect(mocks.linkReleaseToPostWithRetry).not.toHaveBeenCalled();
      expect(finalPost?.releaseStatus).toBe("save_failed");
      expect(finalPost?.releaseLinkStatus).toBeUndefined();
      expect(finalPost?.releaseId).toBeUndefined();

      cleanup();
    });
  });

  describe("Creating stages and Cancel", () => {
    const deferred = <T,>() => {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((settle) => {
        resolve = settle;
      });
      return { promise, resolve };
    };

    const signedRelease = (): CapturedRelease => ({
      customerName: "Alex Rivera",
      signaturePngDataUrl: "data:image/png;base64,c2ln",
    });

    /** Start Create post outside act so the run can be stepped through. */
    const startGeneration = (
      result: { current: ReturnType<typeof useGeneration> },
      meta: Parameters<ReturnType<typeof useGeneration>["handleGenerate"]>[5] = {},
      platformIds?: Parameters<ReturnType<typeof useGeneration>["handleGenerate"]>[6],
    ) => {
      let run!: Promise<void>;
      act(() => {
        run = result.current.handleGenerate(
          StyleOption.Modern,
          ToneOption.Professional,
          "Alex",
          undefined,
          undefined,
          { customerIdentityRequired: true, ...meta },
          platformIds,
        );
      });
      return run;
    };

    /** Let the run advance inside act until `condition` holds, then flush. */
    const advanceUntil = async (condition: () => void) => {
      await act(async () => {
        await vi.waitFor(condition);
      });
    };

    const cancel = (result: {
      current: ReturnType<typeof useGeneration>;
    }): GenerationCancelResult => {
      let outcome!: GenerationCancelResult;
      act(() => {
        outcome = result.current.cancelGeneration();
      });
      return outcome;
    };

    it("advances signature, design, checks and saving in order and marks each part as it lands", async () => {
      const stages: GenerationStage[] = [];
      const signature = deferred<{ id: string } | undefined>();
      const provider = deferred<typeof generatedResult>();
      const pack = deferred<string>();
      const saving = deferred<{ id: string } | null>();
      mocks.saveRelease.mockImplementationOnce(() => signature.promise);
      mocks.generateSocialPost.mockImplementationOnce(() => provider.promise);
      mocks.generatePlatformCaptionPack.mockImplementationOnce(() => pack.promise);
      mocks.logPost.mockImplementationOnce(() => saving.promise);
      const { result, cleanup } = renderGeneration(({ generationStage }) => {
        if (stages.at(-1) !== generationStage) stages.push(generationStage);
      });

      const run = startGeneration(result, { capturedRelease: signedRelease() }, [
        "facebook_feed",
        "instagram_feed",
      ]);

      await advanceUntil(() => expect(mocks.saveRelease).toHaveBeenCalledTimes(1));
      expect(result.current.generationStage).toBe("signature");
      // The release is stored before any provider call.
      expect(mocks.generateSocialPost).not.toHaveBeenCalled();
      expect(result.current.partsReady).toEqual({ image: false, caption: false });

      signature.resolve(undefined);
      await advanceUntil(() =>
        expect(mocks.generateSocialPost).toHaveBeenCalledTimes(1),
      );
      expect(result.current.generationStage).toBe("design");

      const onPartReady = mocks.generateSocialPost.mock.calls[0].at(-1) as (
        part: "caption" | "image",
      ) => void;
      act(() => onPartReady("caption"));
      expect(result.current.partsReady).toEqual({ image: false, caption: true });
      act(() => onPartReady("image"));
      expect(result.current.partsReady).toEqual({ image: true, caption: true });

      provider.resolve(generatedResult);
      await advanceUntil(() =>
        expect(mocks.generatePlatformCaptionPack).toHaveBeenCalledTimes(1),
      );
      expect(result.current.generationStage).toBe("checks");
      expect(mocks.logPost).not.toHaveBeenCalled();

      pack.resolve(
        JSON.stringify({
          facebook_feed: "A great delivery day at Example Motors.",
          instagram_feed: "Delivery day at Example Motors.",
        }),
      );
      await advanceUntil(() => expect(mocks.logPost).toHaveBeenCalledTimes(1));
      expect(result.current.generationStage).toBe("saving");

      await act(async () => {
        saving.resolve({ id: "post-80" });
        await run;
      });

      expect(stages).toEqual([
        "idle",
        "signature",
        "design",
        "checks",
        "saving",
        "idle",
      ]);
      expect(result.current.partsReady).toEqual({ image: false, caption: false });
      expect(mocks.setStep).toHaveBeenLastCalledWith(AppStep.RESULT);
      expect(mocks.setGeneratedPost.mock.calls.at(-1)?.[0]).toMatchObject({
        postId: "post-80",
        releaseStatus: "saved",
      });
      // The legacy overlay still gets its values until Creating replaces it.
      expect(result.current.generationProgress).toBe(100);
      expect(result.current.progressMessage).toBe("Finishing destination copy...");

      cleanup();
    });

    it("goes straight to design when the release was already stored", async () => {
      const stages: GenerationStage[] = [];
      const { result, cleanup } = renderGeneration(({ generationStage }) => {
        if (stages.at(-1) !== generationStage) stages.push(generationStage);
      });

      await act(async () => {
        await result.current.handleGenerate(
          StyleOption.Modern,
          ToneOption.Professional,
          "Alex",
          undefined,
          undefined,
          { capturedRelease: { ...signedRelease(), releaseId: "release-kept-1" } },
        );
      });

      expect(mocks.saveRelease).not.toHaveBeenCalled();
      expect(stages).not.toContain("signature");

      cleanup();
    });

    it("Cancel before logPost aborts the provider task, returns to Details with no error and keeps the release for a retry", async () => {
      const captured = signedRelease();
      mocks.saveRelease.mockResolvedValueOnce({ id: "release-cancel-1" });
      const provider = deferred<typeof generatedResult>();
      mocks.generateSocialPost.mockImplementationOnce(() => provider.promise);
      const { result, cleanup } = renderGeneration();

      const run = startGeneration(result, { capturedRelease: captured });
      await advanceUntil(() =>
        expect(mocks.generateSocialPost).toHaveBeenCalledTimes(1),
      );
      expect(result.current.generationStage).toBe("design");
      const providerCall = mocks.runGeminiTask.mock.calls.find(
        ([name]) => name === "ai.generate",
      );
      const cancelSignal = providerCall?.[3];
      expect(cancelSignal).toBeInstanceOf(AbortSignal);
      mocks.setStep.mockClear();
      mocks.setError.mockClear();

      expect(cancel(result)).toEqual({ status: "cancelled" });
      expect(cancelSignal?.aborted).toBe(true);
      // The run settles quietly: a cancel is not an error.
      await act(async () => {
        await expect(run).resolves.toBeUndefined();
        // A provider that ignored the abort answers late; nothing listens.
        provider.resolve(generatedResult);
      });

      expect(mocks.setStep.mock.calls).toEqual([[AppStep.CUSTOMIZE]]);
      expect(mocks.setError.mock.calls).toEqual([[null]]);
      expect(mocks.toastError).not.toHaveBeenCalled();
      expect(mocks.setGeneratedPost).not.toHaveBeenCalled();
      expect(mocks.logPost).not.toHaveBeenCalled();
      expect(logEvent).toHaveBeenCalledWith("ai.generate.cancelled", {
        stage: "design",
        saving: false,
      });
      expect(result.current.generationStage).toBe("idle");
      // Details keeps its values and the release keeps its stored id.
      expect(mocks.setGenerationParams).not.toHaveBeenCalledWith(null);
      expect(captured.releaseId).toBe("release-cancel-1");
      expect(isReleaseAlreadyLinked(captured)).toBe(false);

      // Try again: nothing is re-signed and the same release backs the post.
      mocks.logPost.mockResolvedValueOnce({ id: "post-81" });
      await act(async () => {
        await result.current.handleGenerate(
          StyleOption.Modern,
          ToneOption.Professional,
          "Alex",
          undefined,
          undefined,
          { customerIdentityRequired: true, capturedRelease: captured },
        );
      });
      expect(mocks.saveRelease).toHaveBeenCalledTimes(1);
      expect(mocks.linkReleaseToPostWithRetry).toHaveBeenCalledWith(
        "release-cancel-1",
        "post-81",
        expect.objectContaining({ requestAuthEpoch: 1 }),
      );
      expect(mocks.setStep).toHaveBeenLastCalledWith(AppStep.RESULT);
      // A1: once linked, the signature is spent, and so is a copy of it.
      expect(isReleaseAlreadyLinked(captured)).toBe(true);
      expect(isReleaseAlreadyLinked({ ...captured })).toBe(true);

      cleanup();
    });

    it("Cancel during checks discards the late result and creates nothing", async () => {
      const pack = deferred<string>();
      mocks.generatePlatformCaptionPack.mockImplementationOnce(() => pack.promise);
      const { result, cleanup } = renderGeneration();

      const run = startGeneration(result, {}, ["facebook_feed", "instagram_feed"]);
      await advanceUntil(() =>
        expect(mocks.generatePlatformCaptionPack).toHaveBeenCalledTimes(1),
      );
      expect(result.current.generationStage).toBe("checks");
      mocks.setStep.mockClear();

      expect(cancel(result)).toEqual({ status: "cancelled" });
      await act(async () => {
        await run;
        pack.resolve("{}");
      });

      expect(mocks.logPost).not.toHaveBeenCalled();
      expect(mocks.setGeneratedPost).not.toHaveBeenCalled();
      expect(mocks.setStep.mock.calls).toEqual([[AppStep.CUSTOMIZE]]);
      expect(mocks.toastError).not.toHaveBeenCalled();
      expect(mocks.toastWarning).not.toHaveBeenCalled();

      cleanup();
    });

    it.each([
      { requiresApproval: false, label: "a draft" },
      { requiresApproval: true, label: "a post waiting for approval" },
    ])(
      "a cancel after logPost started lets $label finish saving and discards the result",
      async ({ requiresApproval }) => {
        mocks.store.currentDealer = {
          id: "dealer-1",
          name: "Example Motors",
          requires_approval: requiresApproval,
        };
        const captured = signedRelease();
        mocks.saveRelease.mockResolvedValueOnce({
          id: `release-saving-${requiresApproval}`,
        });
        const saving = deferred<{ id: string } | null>();
        mocks.logPost.mockImplementationOnce(() => saving.promise);
        const { result, cleanup } = renderGeneration();

        const run = startGeneration(result, { capturedRelease: captured });
        await advanceUntil(() => expect(mocks.logPost).toHaveBeenCalledTimes(1));
        expect(result.current.generationStage).toBe("saving");
        // Spent from the moment its post starts saving, so a quick retry
        // cannot race this save for the same signature.
        expect(isReleaseAlreadyLinked(captured)).toBe(true);
        mocks.setStep.mockClear();
        mocks.setError.mockClear();

        const outcome = cancel(result);
        expect(outcome).toMatchObject({ status: "saving", requiresApproval });
        expect(mocks.setStep.mock.calls).toEqual([[AppStep.CUSTOMIZE]]);

        await act(async () => {
          saving.resolve({ id: "post-82" });
          await run;
        });

        expect(outcome.status === "saving" && (await outcome.saved)).toBe(true);
        expect(mocks.logPost).toHaveBeenCalledTimes(1);
        expect(mocks.logPost).toHaveBeenCalledWith(
          expect.objectContaining({ requiresApproval }),
          1,
        );
        // The saved post keeps its release.
        expect(mocks.linkReleaseToPostWithRetry).toHaveBeenCalledWith(
          `release-saving-${requiresApproval}`,
          "post-82",
          expect.anything(),
        );
        expect(mocks.setGeneratedPost).not.toHaveBeenCalled();
        expect(mocks.setStep.mock.calls).toEqual([[AppStep.CUSTOMIZE]]);
        expect(mocks.setError.mock.calls).toEqual([[null]]);
        expect(mocks.toastError).not.toHaveBeenCalled();
        expect(logEvent).toHaveBeenCalledWith("ai.generate.cancelled", {
          stage: "saving",
          saving: true,
        });

        cleanup();
      },
    );

    it("Cancel with nothing running changes nothing", () => {
      const { result, cleanup } = renderGeneration();

      expect(cancel(result)).toEqual({ status: "idle" });
      expect(mocks.setStep).not.toHaveBeenCalled();
      expect(logEvent).not.toHaveBeenCalledWith(
        "ai.generate.cancelled",
        expect.anything(),
      );

      cleanup();
    });

    it("ignores a second Create post while one is in flight", async () => {
      const { result, cleanup } = renderGeneration();

      await act(async () => {
        const first = result.current.handleGenerate(
          StyleOption.Modern,
          ToneOption.Professional,
          "Alex",
        );
        const second = result.current.handleGenerate(
          StyleOption.Modern,
          ToneOption.Professional,
          "Alex",
        );
        await Promise.all([first, second]);
      });
      expect(mocks.generateSocialPost).toHaveBeenCalledTimes(1);
      expect(mocks.logPost).toHaveBeenCalledTimes(1);

      // The guard is handed back once the run settles.
      await act(async () => {
        await result.current.handleGenerate(
          StyleOption.Modern,
          ToneOption.Professional,
          "Alex",
        );
      });
      expect(mocks.generateSocialPost).toHaveBeenCalledTimes(2);

      cleanup();
    });

    it("a Create post after the step changed detaches the running generation instead of ignoring it (a second Generate always ran before the guard existed)", async () => {
      let releaseFirst!: () => void;
      mocks.generateSocialPost.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirst = () => resolve(generatedResult);
          }),
      );
      const { result, cleanup } = renderGeneration();

      let first!: Promise<void>;
      await act(async () => {
        first = result.current.handleGenerate(
          StyleOption.Modern,
          ToneOption.Professional,
          "Alex",
        );
        await vi.waitFor(() =>
          expect(mocks.setStep).toHaveBeenCalledWith(AppStep.GENERATING),
        );
      });

      // The first run is past onMutate and still waiting on the provider; the
      // salesperson has reopened a post from My work and come back around to
      // Generate. That tap must start its own run, not silently do nothing.
      await act(async () => {
        await result.current.handleGenerate(
          StyleOption.Modern,
          ToneOption.Professional,
          "Alex",
        );
      });
      expect(mocks.generateSocialPost).toHaveBeenCalledTimes(2);
      expect(
        mocks.setStep.mock.calls.filter(([step]) => step === AppStep.GENERATING),
      ).toHaveLength(2);

      // The detached run settles on its own without disturbing the new one.
      await act(async () => {
        releaseFirst();
        await first;
      });
      expect(result.current.generationStage).toBe("idle");

      cleanup();
    });

    it("returns an identity-guard failure to Details with its message and leaves the release unspent", async () => {
      const captured = signedRelease();
      mocks.saveRelease.mockResolvedValueOnce({ id: "release-identity-1" });
      mocks.generateSocialPost.mockResolvedValueOnce({
        ...generatedResult,
        text: "Congratulations to Alex and Jordan! Alex and Jordan just celebrated a delivery day.",
      });
      const { result, cleanup } = renderGeneration();

      await act(async () => {
        await result.current.handleGenerate(
          StyleOption.Modern,
          ToneOption.Professional,
          "Alex",
          undefined,
          undefined,
          { customerIdentityRequired: true, capturedRelease: captured },
        );
      });

      expect(mocks.setError).toHaveBeenLastCalledWith(
        expect.stringContaining('not authorized for this post ("Jordan")'),
      );
      expect(mocks.setStep).toHaveBeenLastCalledWith(AppStep.CUSTOMIZE);
      expect(mocks.logPost).not.toHaveBeenCalled();
      expect(result.current.generationStage).toBe("idle");
      expect(isReleaseAlreadyLinked(captured)).toBe(false);

      cleanup();
    });

    it("leaves the release unspent when no post came back to link it to", async () => {
      const captured = signedRelease();
      mocks.saveRelease.mockResolvedValueOnce({ id: "release-no-post-1" });
      mocks.logPost.mockResolvedValueOnce(null);
      const { result, cleanup } = renderGeneration();

      await act(async () => {
        await result.current.handleGenerate(
          StyleOption.Modern,
          ToneOption.Professional,
          "Alex",
          undefined,
          undefined,
          { customerIdentityRequired: true, capturedRelease: captured },
        );
      });

      expect(mocks.linkReleaseToPostWithRetry).not.toHaveBeenCalled();
      expect(isReleaseAlreadyLinked(captured)).toBe(false);

      cleanup();
    });

    it("discards a result that lands after the signed-in workspace changed", async () => {
      const provider = deferred<typeof generatedResult>();
      mocks.generateSocialPost.mockImplementationOnce(() => provider.promise);
      const { result, cleanup } = renderGeneration();

      const run = startGeneration(result);
      await advanceUntil(() =>
        expect(mocks.generateSocialPost).toHaveBeenCalledTimes(1),
      );
      mocks.setStep.mockClear();
      mocks.store.authEpoch = 2;

      await act(async () => {
        provider.resolve(generatedResult);
        await expect(run).rejects.toThrow("signed-in workspace changed");
      });

      expect(mocks.setGeneratedPost).not.toHaveBeenCalled();
      expect(mocks.setStep).not.toHaveBeenCalled();
      expect(mocks.logPost).not.toHaveBeenCalled();
      expect(result.current.generationStage).toBe("idle");

      cleanup();
    });

    it("hands the Create post guard back at a sign-in boundary so the new workspace can start at once", async () => {
      const staleProvider = deferred<typeof generatedResult>();
      mocks.generateSocialPost.mockImplementationOnce(() => staleProvider.promise);
      const { result, rerender, cleanup } = renderGeneration();

      const staleRun = startGeneration(result);
      await advanceUntil(() =>
        expect(mocks.generateSocialPost).toHaveBeenCalledTimes(1),
      );
      expect(result.current.generationStage).toBe("design");
      const onStalePartReady = mocks.generateSocialPost.mock.calls[0].at(-1) as (
        part: "caption" | "image",
      ) => void;

      // Sign-out and sign-in (or another tab's session change) bump the epoch.
      mocks.store.authEpoch = 2;
      rerender();
      expect(result.current.generationStage).toBe("idle");
      expect(result.current.partsReady).toEqual({ image: false, caption: false });
      mocks.setStep.mockClear();

      const newProvider = deferred<typeof generatedResult>();
      mocks.generateSocialPost.mockImplementationOnce(() => newProvider.promise);
      mocks.logPost.mockResolvedValueOnce({ id: "post-new-workspace" });
      const newRun = startGeneration(result);
      await advanceUntil(() =>
        expect(mocks.generateSocialPost).toHaveBeenCalledTimes(2),
      );
      // The tap reached onMutate and the provider, as it did before the guard.
      expect(mocks.setStep.mock.calls[0]).toEqual([AppStep.GENERATING]);
      expect(result.current.generationStage).toBe("design");

      // The previous workspace's late callbacks and result change nothing here.
      act(() => onStalePartReady("image"));
      expect(result.current.partsReady).toEqual({ image: false, caption: false });
      await act(async () => {
        staleProvider.resolve(generatedResult);
        await expect(staleRun).rejects.toThrow("signed-in workspace changed");
      });
      expect(result.current.generationStage).toBe("design");
      expect(mocks.logPost).not.toHaveBeenCalled();

      await act(async () => {
        newProvider.resolve(generatedResult);
        await newRun;
      });
      expect(mocks.logPost).toHaveBeenCalledTimes(1);
      expect(mocks.logPost).toHaveBeenCalledWith(expect.anything(), 2);
      expect(mocks.setGeneratedPost).toHaveBeenCalledTimes(1);
      expect(mocks.setGeneratedPost.mock.calls[0][0]).toMatchObject({
        postId: "post-new-workspace",
      });
      expect(mocks.setStep).toHaveBeenLastCalledWith(AppStep.RESULT);
      expect(result.current.generationStage).toBe("idle");

      cleanup();
    });

    it("a Create post that lands before the sign-in boundary re-renders is not blocked by the previous workspace's run", async () => {
      const staleProvider = deferred<typeof generatedResult>();
      mocks.generateSocialPost.mockImplementationOnce(() => staleProvider.promise);
      const { result, cleanup } = renderGeneration();

      const staleRun = startGeneration(result);
      await advanceUntil(() =>
        expect(mocks.generateSocialPost).toHaveBeenCalledTimes(1),
      );
      mocks.store.authEpoch = 2;
      mocks.setStep.mockClear();

      const newRun = startGeneration(result);
      await advanceUntil(() =>
        expect(mocks.generateSocialPost).toHaveBeenCalledTimes(2),
      );
      expect(mocks.setStep.mock.calls[0]).toEqual([AppStep.GENERATING]);

      await act(async () => {
        staleProvider.resolve(generatedResult);
        await expect(staleRun).rejects.toThrow("signed-in workspace changed");
        await newRun;
      });
      expect(mocks.setGeneratedPost).toHaveBeenCalledTimes(1);
      expect(mocks.setStep).toHaveBeenLastCalledWith(AppStep.RESULT);

      cleanup();
    });

    it("a retry right after a Cancel during the signature upload waits for that upload instead of storing the signature again", async () => {
      const captured = signedRelease();
      const upload = deferred<{ id: string } | undefined>();
      mocks.saveRelease.mockImplementationOnce(() => upload.promise);
      const { result, cleanup } = renderGeneration();

      const cancelledRun = startGeneration(result, { capturedRelease: captured });
      await advanceUntil(() => expect(mocks.saveRelease).toHaveBeenCalledTimes(1));
      expect(result.current.generationStage).toBe("signature");
      expect(cancel(result)).toEqual({ status: "cancelled" });
      expect(logEvent).toHaveBeenCalledWith("ai.generate.cancelled", {
        stage: "signature",
        saving: false,
      });
      mocks.setStep.mockClear();

      // Create post again at once, before the first upload has answered.
      mocks.logPost.mockResolvedValueOnce({ id: "post-retry-1" });
      const retry = startGeneration(result, { capturedRelease: captured });
      await act(async () => {
        await new Promise((settle) => setTimeout(settle, 20));
      });
      expect(mocks.setStep.mock.calls[0]).toEqual([AppStep.GENERATING]);
      expect(result.current.generationStage).toBe("signature");
      expect(mocks.saveRelease).toHaveBeenCalledTimes(1);
      expect(mocks.generateSocialPost).not.toHaveBeenCalled();

      await act(async () => {
        upload.resolve({ id: "release-first-1" });
        await expect(cancelledRun).resolves.toBeUndefined();
        await retry;
      });

      // One signature on the server, and it is the one the post is linked to.
      expect(mocks.saveRelease).toHaveBeenCalledTimes(1);
      expect(captured.releaseId).toBe("release-first-1");
      expect(mocks.generateSocialPost).toHaveBeenCalledTimes(1);
      expect(mocks.logPost).toHaveBeenCalledTimes(1);
      expect(mocks.linkReleaseToPostWithRetry).toHaveBeenCalledTimes(1);
      expect(mocks.linkReleaseToPostWithRetry).toHaveBeenCalledWith(
        "release-first-1",
        "post-retry-1",
        expect.anything(),
      );
      expect(mocks.setStep).toHaveBeenLastCalledWith(AppStep.RESULT);
      expect(isReleaseAlreadyLinked(captured)).toBe(true);
      expect(isReleaseAlreadyLinked({ ...captured })).toBe(true);

      cleanup();
    });

    it("a retry stores the signature itself when the cancelled attempt's upload failed", async () => {
      const captured = signedRelease();
      let failUpload!: (reason: unknown) => void;
      mocks.saveRelease.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            failUpload = reject;
          }),
      );
      mocks.saveRelease.mockImplementationOnce(async () => ({ id: "release-retry-2" }));
      const { result, cleanup } = renderGeneration();

      const cancelledRun = startGeneration(result, { capturedRelease: captured });
      await advanceUntil(() => expect(mocks.saveRelease).toHaveBeenCalledTimes(1));
      expect(cancel(result)).toEqual({ status: "cancelled" });

      mocks.logPost.mockResolvedValueOnce({ id: "post-retry-2" });
      const retry = startGeneration(result, { capturedRelease: captured });
      await act(async () => {
        failUpload(new Error("Photo release upload failed"));
        await expect(cancelledRun).resolves.toBeUndefined();
        await retry;
      });

      expect(mocks.saveRelease).toHaveBeenCalledTimes(2);
      expect(captured.releaseId).toBe("release-retry-2");
      expect(mocks.linkReleaseToPostWithRetry).toHaveBeenCalledWith(
        "release-retry-2",
        "post-retry-2",
        expect.anything(),
      );
      expect(mocks.setStep).toHaveBeenLastCalledWith(AppStep.RESULT);
      expect(mocks.toastError).not.toHaveBeenCalled();

      cleanup();
    });

    it("keeps an approval store's failed submission locked on the result", async () => {
      mocks.store.currentDealer = {
        id: "dealer-1",
        name: "Example Motors",
        requires_approval: true,
      };
      mocks.logPost.mockResolvedValueOnce(null);
      const { result, cleanup } = renderGeneration();

      await act(async () => {
        await result.current.handleGenerate(
          StyleOption.Modern,
          ToneOption.Professional,
          "Alex",
        );
      });

      expect(mocks.setGeneratedPost.mock.calls.at(-1)?.[0]).toMatchObject({
        approvalStatus: "submission_failed",
      });
      expect(mocks.setError).toHaveBeenLastCalledWith(
        expect.stringContaining("could not be submitted for manager approval"),
      );
      expect(mocks.setStep).toHaveBeenLastCalledWith(AppStep.RESULT);

      cleanup();
    });
  });
});
