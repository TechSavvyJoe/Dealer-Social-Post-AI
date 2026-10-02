import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StyleOption, ToneOption, VideoStyle, type GeneratedPost } from "../types";
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
    useAppStore.setState({ generatedPost: basePost });
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
});
