import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  StyleOption,
  ToneOption,
  VideoStyle,
  type GeneratedPost,
  type GenerationParams,
} from "../types";
import type { StoreDefaults } from "../services/storeDefaults";

const mocks = vi.hoisted(() => ({ toastWarning: vi.fn() }));
vi.mock("../components/ui/Toast", () => ({
  useToast: () => ({ warning: mocks.toastWarning, success: vi.fn(), error: vi.fn() }),
}));

import { usePostCreativeTools } from "./usePostCreativeTools";
import { useAppStore } from "../stores/appStore";

const basePost: GeneratedPost = {
  postId: "post-1",
  image: "image-clean",
  text: "Caption",
};
const defaults: StoreDefaults = {
  releaseRequired: false,
  vehicleRelevant: true,
  channels: [{ id: "facebook_feed", label: "Facebook" }],
  defaultChannelId: "facebook_feed",
  generationPlatformIds: ["facebook_feed"],
  primaryProfile: {
    primaryFormatId: "feed_portrait",
    imageAspectRatio: "4:5",
    label: "Feed portrait · 4:5",
  },
  looks: [
    { id: "showroom", label: "Clean", style: StyleOption.Modern },
    { id: "turbo", label: "Bold", style: StyleOption.Sporty },
  ],
  defaultLookId: "showroom",
  videoAllowed: true,
  motion: {
    style: VideoStyle.GoldenRadiance,
    aspects: ["9:16"],
    audio: "cinematic",
  },
  playfulStyleId: "comic-book",
  facebookTag: "",
  employeeDisclosure: "",
  requiresApproval: false,
  websiteChannel: false,
  style: StyleOption.Modern,
  tone: ToneOption.Excited,
};

/** The brief Details rendered with: the showroom Look's style. */
const paramsA: GenerationParams = {
  style: StyleOption.Modern,
  tone: ToneOption.Excited,
  customerName: "",
  creativeBrief: "brief-A",
};
/** What a successful Look render writes for the turbo Look. */
const paramsB: GenerationParams = {
  style: StyleOption.Sporty,
  tone: ToneOption.Excited,
  customerName: "",
  creativeBrief: "brief-B",
};

const setup = (overrides: Record<string, unknown> = {}) => {
  const onRegenerateImage = vi.fn(async () => undefined);
  const onRegenerateText = vi.fn(async () => undefined);
  const onChangeLook = vi.fn(async () => {
    useAppStore.getState().setGeneratedPost({ ...basePost, image: "image-bold" });
  });
  const onFunMode = vi.fn(async () => {
    useAppStore.getState().setGeneratedPost({ ...basePost, image: "image-playful" });
  });
  const startVideoJob = vi.fn(async () => undefined);
  const options = {
    post: basePost,
    defaults,
    locked: false,
    lockReason: "Locked",
    hasOriginalCapture: true,
    onRegenerateImage,
    onRegenerateText,
    onChangeLook,
    onFunMode,
    video: {
      startVideoJob,
      houseMotionOptions: {
        durationSeconds: 6 as const,
        soundtrack: "cinematic" as const,
        aspectPreference: "9:16" as const,
        resolution: "720p" as const,
        pacing: "cinematic" as const,
      },
      isVideoLoading: false,
    },
    ...overrides,
  };
  return {
    options,
    onRegenerateImage,
    onRegenerateText,
    onChangeLook,
    onFunMode,
    startVideoJob,
  };
};

describe("usePostCreativeTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      generatedPost: basePost,
      generationParams: paramsA,
      error: null,
    });
  });

  it("spends Try another once and keeps that budget after a remount", async () => {
    const first = setup();
    const hook = renderHook(() => usePostCreativeTools(first.options));
    await act(async () => hook.result.current.tryAnother());
    expect(first.onRegenerateImage).toHaveBeenCalledTimes(1);
    expect(first.onRegenerateText).toHaveBeenCalledTimes(1);
    expect(
      (
        useAppStore.getState().generatedPost as GeneratedPost & {
          tryAnotherUsed?: boolean;
        }
      )?.tryAnotherUsed,
    ).toBe(true);
    hook.unmount();

    const persisted = useAppStore.getState().generatedPost!;
    const second = setup({ post: persisted });
    const remount = renderHook(() => usePostCreativeTools(second.options));
    await act(async () => remount.result.current.tryAnother());
    expect(second.onRegenerateImage).not.toHaveBeenCalled();
    expect(mocks.toastWarning).toHaveBeenCalledWith(
      "Already used once on this post. A manager can regenerate it for you.",
    );
  });

  it("does not start caption work when image work completes in a replacement workspace", async () => {
    let resolveImage!: () => void;
    const imagePending = new Promise<void>((resolve) => {
      resolveImage = resolve;
    });
    const test = setup({ onRegenerateImage: vi.fn(() => imagePending) });
    const replacement: GeneratedPost = {
      ...basePost,
      postId: "post-2",
      image: "replacement-image",
    };
    const { result, rerender } = renderHook(
      ({ activePost }) => usePostCreativeTools({ ...test.options, post: activePost }),
      { initialProps: { activePost: basePost } },
    );

    let operation!: Promise<void>;
    act(() => {
      operation = result.current.tryAnother();
    });
    expect(test.options.onRegenerateImage).toHaveBeenCalledTimes(1);

    act(() => {
      useAppStore.setState({ generatedPost: replacement });
      rerender({ activePost: replacement });
      resolveImage();
    });
    await act(async () => operation);

    expect(test.onRegenerateText).not.toHaveBeenCalled();
    expect(useAppStore.getState().generatedPost).toEqual(replacement);
  });

  it("renders each Look at most once and restores the cached master", async () => {
    const test = setup();
    const { result } = renderHook(() => usePostCreativeTools(test.options));
    await act(async () => result.current.changeLook(defaults.looks[1]));
    expect(test.onChangeLook).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().generatedPost?.image).toBe("image-bold");

    await act(async () => result.current.changeLook(defaults.looks[0]));
    expect(test.onChangeLook).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().generatedPost?.image).toBe("image-clean");
  });

  it("blocks every provider tool once the creative is locked", async () => {
    const test = setup({ locked: true });
    const { result } = renderHook(() => usePostCreativeTools(test.options));
    await act(async () => {
      await result.current.tryAnother();
      await result.current.changeLook(defaults.looks[1]);
      await result.current.togglePlayful();
      await result.current.addVideo();
    });
    expect(test.onRegenerateImage).not.toHaveBeenCalled();
    expect(test.onRegenerateText).not.toHaveBeenCalled();
    expect(test.onChangeLook).not.toHaveBeenCalled();
    expect(test.onFunMode).not.toHaveBeenCalled();
    expect(test.startVideoJob).not.toHaveBeenCalled();
  });

  it("keeps the playful master and switches between the pair without another render", async () => {
    const test = setup();
    const { result } = renderHook(() => usePostCreativeTools(test.options));
    await act(async () => result.current.togglePlayful());
    expect(result.current.playfulPair).toEqual({
      master: "image-clean",
      playful: "image-playful",
    });
    expect(test.onFunMode).toHaveBeenCalledTimes(1);

    await act(async () => result.current.togglePlayful());
    expect(useAppStore.getState().generatedPost?.image).toBe("image-clean");
    expect(test.onFunMode).toHaveBeenCalledTimes(1);
  });

  it("does not offer paid video work when the category disallows it", async () => {
    const test = setup({ defaults: { ...defaults, videoAllowed: false } });
    const { result } = renderHook(() => usePostCreativeTools(test.options));
    await act(async () => result.current.addVideo());
    expect(test.startVideoJob).not.toHaveBeenCalled();
    expect(mocks.toastWarning).toHaveBeenCalledWith(
      "Video is not available for this type of post.",
    );
  });

  it("bounds the complete tool slate to its documented provider calls", async () => {
    const test = setup();
    const { result } = renderHook(() => usePostCreativeTools(test.options));
    await act(async () => result.current.tryAnother());
    await act(async () => result.current.changeLook(defaults.looks[1]));
    await act(async () => result.current.changeLook(defaults.looks[0]));
    await act(async () => result.current.togglePlayful());
    await act(async () => result.current.togglePlayful());
    await act(async () => result.current.addVideo());

    expect(test.onRegenerateImage).toHaveBeenCalledTimes(1);
    expect(test.onRegenerateText).toHaveBeenCalledTimes(1);
    expect(test.onChangeLook).toHaveBeenCalledTimes(1);
    expect(test.onFunMode).toHaveBeenCalledTimes(1);
    expect(test.startVideoJob).toHaveBeenCalledTimes(1);
  });

  it("opens on the Look whose style the post was rendered with", async () => {
    useAppStore.setState({ generationParams: paramsB });
    const test = setup();
    const { result } = renderHook(() => usePostCreativeTools(test.options));
    expect(result.current.selectedLookId).toBe("turbo");

    // The render on screen belongs to turbo, so showroom has never been made.
    await act(async () => result.current.changeLook(defaults.looks[0]));
    expect(test.onChangeLook).toHaveBeenCalledWith("showroom");

    await act(async () => result.current.changeLook(defaults.looks[1]));
    expect(test.onChangeLook).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().generatedPost?.image).toBe("image-clean");
  });

  it("falls back to the store's default Look when the brief matches none", () => {
    useAppStore.setState({
      generationParams: { ...paramsA, style: StyleOption.DepthPop },
    });
    const test = setup();
    const { result } = renderHook(() => usePostCreativeTools(test.options));
    expect(result.current.selectedLookId).toBe(defaults.defaultLookId);
  });

  it("puts the selection back when a Look change fails and lets it be retried", async () => {
    const onChangeLook = vi
      .fn<(look: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("This Look is not enabled by your store."))
      .mockImplementationOnce(async () => {
        useAppStore.getState().setGeneratedPost({ ...basePost, image: "image-bold" });
      });
    const test = setup({ onChangeLook });
    const { result } = renderHook(() => usePostCreativeTools(test.options));

    await act(async () => result.current.changeLook(defaults.looks[1]));
    expect(result.current.selectedLookId).toBe("showroom");
    expect(result.current.busy).toBe(false);
    expect(useAppStore.getState().generatedPost?.image).toBe("image-clean");
    expect(mocks.toastWarning).toHaveBeenCalledWith(
      "This Look is not enabled by your store.",
    );

    await act(async () => result.current.changeLook(defaults.looks[1]));
    expect(onChangeLook).toHaveBeenCalledTimes(2);
    expect(result.current.selectedLookId).toBe("turbo");
    expect(useAppStore.getState().generatedPost?.image).toBe("image-bold");
  });

  it("does not repeat a failure the generation pipeline already announced", async () => {
    const onChangeLook = vi.fn(async () => {
      // useGeneration's onError sets the store error and shows its own toast.
      useAppStore
        .getState()
        .setError("Failed to regenerate image. Something went wrong.");
      throw new Error("provider 503");
    });
    const test = setup({ onChangeLook });
    const { result } = renderHook(() => usePostCreativeTools(test.options));

    await act(async () => result.current.changeLook(defaults.looks[1]));
    expect(result.current.selectedLookId).toBe("showroom");
    expect(mocks.toastWarning).not.toHaveBeenCalled();
  });

  it("gives a technical failure a plain message", async () => {
    const onChangeLook = vi.fn(async () => {
      throw new TypeError("Failed to fetch dynamically imported module");
    });
    const test = setup({ onChangeLook });
    const { result } = renderHook(() => usePostCreativeTools(test.options));

    await act(async () => result.current.changeLook(defaults.looks[1]));
    expect(mocks.toastWarning).toHaveBeenCalledWith("Couldn't apply Bold. Try again.");
  });

  it("renders Try another from the selected Look's brief after a cached switch", async () => {
    const briefsUsed: (string | undefined)[] = [];
    const onChangeLook = vi.fn(async () => {
      // A successful Look render stores that Look's brief, then its image.
      useAppStore.getState().setGenerationParams(paramsB);
      useAppStore.getState().setGeneratedPost({ ...basePost, image: "image-bold" });
    });
    const onRegenerateImage = vi.fn(async () => {
      briefsUsed.push(useAppStore.getState().generationParams?.creativeBrief);
      const current = useAppStore.getState().generatedPost!;
      useAppStore.getState().setGeneratedPost({ ...current, image: "image-another" });
    });
    const test = setup({ onChangeLook, onRegenerateImage });
    const { result } = renderHook(() => usePostCreativeTools(test.options));

    await act(async () => result.current.changeLook(defaults.looks[1]));
    expect(useAppStore.getState().generationParams).toEqual(paramsB);

    await act(async () => result.current.changeLook(defaults.looks[0]));
    expect(useAppStore.getState().generatedPost?.image).toBe("image-clean");
    expect(useAppStore.getState().generationParams).toEqual(paramsA);

    await act(async () => result.current.tryAnother());
    expect(briefsUsed).toEqual(["brief-A"]);

    // The new version is cached under showroom, the Look it was rendered for.
    await act(async () => result.current.changeLook(defaults.looks[1]));
    expect(useAppStore.getState().generatedPost?.image).toBe("image-bold");
    expect(useAppStore.getState().generationParams).toEqual(paramsB);
    await act(async () => result.current.changeLook(defaults.looks[0]));
    expect(useAppStore.getState().generatedPost?.image).toBe("image-another");
    expect(useAppStore.getState().generationParams).toEqual(paramsA);
    expect(onChangeLook).toHaveBeenCalledTimes(1);
  });

  it("settles a failed Try another without an unhandled rejection", async () => {
    const onRegenerateImage = vi.fn(async () => {
      throw new TypeError("network down");
    });
    const test = setup({ onRegenerateImage });
    const { result } = renderHook(() => usePostCreativeTools(test.options));

    await act(async () => {
      await expect(result.current.tryAnother()).resolves.toBeUndefined();
    });
    expect(test.onRegenerateText).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(false);
    // The one-shot budget stays spent: a provider failure buys no retry.
    expect(
      (
        useAppStore.getState().generatedPost as GeneratedPost & {
          tryAnotherUsed?: boolean;
        }
      )?.tryAnotherUsed,
    ).toBe(true);
    expect(mocks.toastWarning).toHaveBeenCalledWith("Couldn't create another version.");
  });
});
