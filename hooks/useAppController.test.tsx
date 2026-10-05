import React from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AppStep,
  StyleOption,
  ToneOption,
  type GeneratedPost,
  type ImageSelection,
} from "../types";
import { useAppStore } from "../stores/appStore";
import { logEvent } from "../utils/telemetry";
import { useAppController } from "./useAppController";

/**
 * The workspace handlers against the real store and the real generation hook
 * (only the provider, persistence and media boundaries are stubbed):
 *  - C1: a photo pick or a reopened post supersedes a run still going, so its
 *    late result can never replace the workspace the salesperson moved to.
 *  - A5: a new photo starts clean; nothing of the previous post rides along.
 *  - B13: a reopened post remembers the surface it was opened from.
 */
const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastWarning: vi.fn(),
  generateSocialPost: vi.fn(),
  loadGeminiService: vi.fn(),
  logPost: vi.fn(),
  renderFormat: vi.fn(async (source: string) => source),
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

vi.mock("./useGemini", () => ({
  useGemini: () => ({
    runGeminiTask: mocks.runGeminiTask,
    loadGeminiService: mocks.loadGeminiService,
  }),
  loadGeminiService: mocks.loadGeminiService,
}));

vi.mock("./useDealerTheme", () => ({ useDealerTheme: () => undefined }));

vi.mock("../components/ui/Toast", () => ({
  useToast: () => ({
    error: mocks.toastError,
    warning: mocks.toastWarning,
    info: vi.fn(),
    success: vi.fn(),
  }),
}));

vi.mock("../services/posts", () => ({ logPost: mocks.logPost }));

vi.mock("../services/photoReleases", () => ({
  runWithPersistedPhotoRelease: async (
    _captured: unknown,
    _dealerName: string,
    providerTask: () => Promise<unknown>,
  ) => ({ result: await providerTask() }),
  linkReleaseToPost: vi.fn(),
  linkReleaseToPostWithRetry: vi.fn(),
}));

vi.mock("../utils/telemetry", () => ({ logEvent: vi.fn(), logError: vi.fn() }));

vi.mock("../utils/creativeStorage", () => ({
  archiveDealerMedia: vi.fn(async () => null),
  clearAllCreatives: vi.fn(async () => true),
  clearDealerCreatives: vi.fn(async () => undefined),
  loadDealerCreative: vi.fn(async () => null),
  saveDealerCreative: vi.fn(async () => undefined),
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

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

const lateResult = {
  image: "data:image/png;base64,bGF0ZQ==",
  text: "A caption from the run that was left behind",
  captionSource: "ai" as const,
};

const savedPost: GeneratedPost = {
  image: "data:image/png;base64,c2F2ZWQ=",
  text: "Saved caption",
  postId: "post-saved-1",
  scenarioId: "new_arrival",
};

const newPhoto: ImageSelection = {
  workingImage: "data:image/jpeg;base64,bmV3LXBob3Rv",
  originalSource: "data:image/jpeg;base64,bmV3LXBob3Rv",
  originalFilename: "arrival.jpg",
};

const release = {
  customerName: "Maria Lopez",
  signaturePngDataUrl: "data:image/png;base64,c2ln",
};

const renderController = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const rendered = renderHook(() => useAppController(), { wrapper });
  return {
    ...rendered,
    cleanup: () => {
      rendered.unmount();
      queryClient.clear();
    },
  };
};

/** Start Create post outside act so the run can be stepped through. */
const startRun = (result: { current: ReturnType<typeof useAppController> }) => {
  let run!: Promise<void>;
  act(() => {
    run = result.current.handleGenerate(
      StyleOption.Modern,
      ToneOption.Professional,
      "Maria Lopez",
      undefined,
      undefined,
      { customerIdentityRequired: true, scenarioId: "customer_delivery" },
    );
  });
  return run;
};

const advanceUntil = async (condition: () => void) => {
  await act(async () => {
    await vi.waitFor(condition, { timeout: 10_000 });
  });
};

describe("useAppController workspace handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useAppStore.setState({
      currentDealer: { id: "dealer-1", name: "Example Motors" },
      currentPerson: null,
      role: "salesperson",
      isImpersonating: false,
      step: AppStep.DETAILS,
      selectedImage: "data:image/jpeg;base64,b2xkLXBob3Rv",
      postDraft: { categoryId: "deliveries", scenarioId: "customer_delivery" },
      pendingRelease: null,
      pendingPhoto: null,
      generatedPost: null,
      generationParams: null,
      postWorkAtRisk: false,
      postBusy: null,
      postReturnStep: null,
      error: null,
      isRestoringSession: false,
      restoreSession: async () => undefined,
    });
    mocks.logPost.mockResolvedValue({ id: "post-should-never-exist" });
    mocks.loadGeminiService.mockResolvedValue({
      generateSocialPost: mocks.generateSocialPost,
    });
  });

  it("a new photo supersedes the run still going, and its late result never lands (C1)", async () => {
    const provider = deferred<typeof lateResult>();
    mocks.generateSocialPost.mockImplementationOnce(() => provider.promise);
    const { result, cleanup } = renderController();

    const run = startRun(result);
    await advanceUntil(() => expect(mocks.generateSocialPost).toHaveBeenCalledTimes(1));
    expect(useAppStore.getState().step).toBe(AppStep.CREATING);

    act(() => result.current.handlePhotoPicked(newPhoto, "inventory", "new_arrival"));
    expect(logEvent).toHaveBeenCalledWith(
      "ai.generate.cancelled",
      expect.objectContaining({ reason: "superseded" }),
    );

    await act(async () => {
      provider.resolve(lateResult);
      await expect(run).resolves.toBeUndefined();
    });

    const state = useAppStore.getState();
    expect(state.step).toBe(AppStep.DETAILS);
    expect(state.selectedImage).toBe(newPhoto.workingImage);
    expect(state.postDraft).toEqual({
      categoryId: "inventory",
      scenarioId: "new_arrival",
    });
    expect(state.generatedPost).toBeNull();
    expect(mocks.logPost).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
    cleanup();
  });

  it("a reopened post supersedes the run still going, and its late result never lands (C1)", async () => {
    const provider = deferred<typeof lateResult>();
    mocks.generateSocialPost.mockImplementationOnce(() => provider.promise);
    const { result, cleanup } = renderController();

    const run = startRun(result);
    await advanceUntil(() => expect(mocks.generateSocialPost).toHaveBeenCalledTimes(1));

    act(() => {
      useAppStore.getState().setStep(AppStep.WORK);
      result.current.handleOpenPost(savedPost);
    });
    expect(logEvent).toHaveBeenCalledWith(
      "ai.generate.cancelled",
      expect.objectContaining({ reason: "superseded" }),
    );

    await act(async () => {
      provider.resolve(lateResult);
      await expect(run).resolves.toBeUndefined();
    });

    const state = useAppStore.getState();
    expect(state.step).toBe(AppStep.POST);
    expect(state.generatedPost).toBe(savedPost);
    expect(state.postReturnStep).toBe(AppStep.WORK);
    expect(mocks.logPost).not.toHaveBeenCalled();
    cleanup();
  });

  it("a new photo clears the previous post before its draft is written (A5)", () => {
    useAppStore.setState({
      generatedPost: savedPost,
      error: "Old failure",
      pendingRelease: release,
      postReturnStep: AppStep.WORK,
      generationParams: {
        style: StyleOption.Modern,
        tone: ToneOption.Excited,
        customerName: "Maria Lopez",
        platformIds: ["facebook_feed"],
      },
    });
    const { result, cleanup } = renderController();

    // The state at the FIRST write of the new draft: anything not yet
    // cleared by then is visible to the new photo's Details.
    let atDraftWrite: Record<string, unknown> | null = null;
    const unsubscribe = useAppStore.subscribe((state, previous) => {
      if (!atDraftWrite && state.postDraft !== previous.postDraft && state.postDraft) {
        atDraftWrite = {
          generatedPost: state.generatedPost,
          error: state.error,
          generationParams: state.generationParams,
          pendingRelease: state.pendingRelease,
          postReturnStep: state.postReturnStep,
        };
      }
    });
    act(() => result.current.handlePhotoPicked(newPhoto, "inventory", "new_arrival"));
    unsubscribe();

    expect(atDraftWrite).toEqual({
      generatedPost: null,
      error: null,
      generationParams: null,
      pendingRelease: null,
      postReturnStep: null,
    });
    expect(useAppStore.getState().step).toBe(AppStep.DETAILS);
    expect(useAppStore.getState().selectedImage).toBe(newPhoto.workingImage);
    cleanup();
  });

  it.each([
    ["Home's My work preview", AppStep.HOME, "salesperson"],
    ["My work", AppStep.WORK, "salesperson"],
    ["the dealership dashboard", AppStep.DEALER_ADMIN, "dealer_admin"],
  ] as const)(
    "a post opened from %s returns there and replaces the whole workspace (B13)",
    (_surface, origin, role) => {
      useAppStore.setState({
        step: origin,
        role,
        pendingRelease: release,
        error: "Old failure",
        generationParams: {
          style: StyleOption.Modern,
          tone: ToneOption.Excited,
          customerName: "",
        },
      });
      const { result, cleanup } = renderController();

      act(() => result.current.handleOpenPost(savedPost));

      const state = useAppStore.getState();
      expect(state.postReturnStep).toBe(origin);
      expect(state.step).toBe(AppStep.POST);
      expect(state.generatedPost).toBe(savedPost);
      expect(state.selectedImage).toBeNull();
      expect(state.generationParams).toBeNull();
      expect(state.postDraft).toBeNull();
      expect(state.pendingRelease).toBeNull();
      expect(state.error).toBeNull();
      cleanup();
    },
  );
});
