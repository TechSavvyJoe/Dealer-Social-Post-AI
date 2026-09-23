import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VideoStyle } from "../types";
import { derivePlatformDeliveryPlan } from "../services/platformOutputs";
import type { PreparedMediaSave } from "../utils/mediaSave";
import type { VideoJob } from "./useVideoJobs";

const mocks = vi.hoisted(() => ({
  prepareMediaForSave: vi.fn(),
  validateVideoMetadata: vi.fn(),
  renderFormatIfNeeded: vi.fn(),
  triggerHapticFeedback: vi.fn(),
}));

vi.mock("../utils/mediaSave", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/mediaSave")>();
  return {
    ...actual,
    prepareMediaForSave: mocks.prepareMediaForSave,
    validateVideoMetadata: mocks.validateVideoMetadata,
  };
});

vi.mock("../utils/multiFormatExport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/multiFormatExport")>();
  return { ...actual, renderFormatIfNeeded: mocks.renderFormatIfNeeded };
});

vi.mock("../utils/haptics", () => ({
  triggerHapticFeedback: mocks.triggerHapticFeedback,
}));

import {
  usePreparedDelivery,
  type UsePreparedDeliveryOptions,
} from "./usePreparedDelivery";

type Video = UsePreparedDeliveryOptions["video"];

const IMAGE = "data:image/png;base64,aW1hZ2U=";

const preparedFile = (options: {
  kind: "image" | "video";
  basename?: string;
}): PreparedMediaSave => {
  const filename = `${options.basename || "dealer-social-post"}.${
    options.kind === "video" ? "mp4" : "jpg"
  }`;
  return {
    kind: options.kind,
    filename,
    file: new File(["prepared"], filename, {
      type: options.kind === "video" ? "video/mp4" : "image/jpeg",
    }),
  };
};

const makeVideo = (overrides: Partial<Video> = {}): Video => ({
  videoJobs: [],
  videoUrl: null,
  adoptVideoUrl: vi.fn(),
  manualVideoSelected: false,
  setManualVideoSelected: vi.fn(),
  currentVideoCreativeKey: "post-1:0",
  videoJobForDelivery: () => undefined,
  ...overrides,
});

const reelJob = (overrides: Partial<VideoJob> = {}): VideoJob => ({
  id: "video-1",
  style: VideoStyle.GoldenRadiance,
  status: "completed",
  duration: 8,
  soundtrack: "cinematic",
  aspectPreference: "9:16",
  resolution: "1080p",
  pacing: "cinematic",
  createdAt: "2026-09-23T10:00:00.000Z",
  sourceCreativeKey: "post-1:0",
  url: "blob:reel",
  ...overrides,
});

const baseOptions = (
  overrides: Partial<UsePreparedDeliveryOptions> = {},
): UsePreparedDeliveryOptions => ({
  post: {
    image: IMAGE,
    platformIds: ["instagram_feed", "gbp"],
    mediaOutputMode: "photo",
    postId: "post-1",
  },
  resultIdentity: "post-1",
  websiteEnabled: false,
  video: makeVideo(),
  ...overrides,
});

/** Basename the hook asks prepareMediaForSave for, from the plan itself. */
const basenameFor = (deliveryId: string, platformIds: string[], mode = "photo") =>
  derivePlatformDeliveryPlan(platformIds, mode as "photo", "dealer-social-post-1")
    .deliveries.find((delivery) => delivery.id === deliveryId)!
    .filename.replace(/\.[^.]+$/, "");

let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

beforeEach(() => {
  mocks.prepareMediaForSave.mockReset();
  mocks.prepareMediaForSave.mockImplementation(
    async (options: { kind: "image" | "video"; basename?: string }) =>
      preparedFile(options),
  );
  mocks.validateVideoMetadata.mockReset();
  mocks.validateVideoMetadata.mockResolvedValue({
    width: 1080,
    height: 1920,
    durationSeconds: 8,
  });
  mocks.renderFormatIfNeeded.mockReset();
  mocks.renderFormatIfNeeded.mockImplementation(
    async (source: string, format: { id: string }) => `${source}#${format.id}`,
  );
  mocks.triggerHapticFeedback.mockReset();
  let previewCount = 0;
  createObjectURL = vi.fn(() => `blob:preview-${++previewCount}`);
  revokeObjectURL = vi.fn();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: revokeObjectURL,
  });
});

afterEach(() => {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: originalCreate,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: originalRevoke,
  });
});

describe("usePreparedDelivery", () => {
  it("prepares the exact size and aspect for the first destination row", async () => {
    const options = baseOptions();
    const { result, unmount } = renderHook(() => usePreparedDelivery(options));

    await waitFor(() => expect(result.current.activePreparedSave).not.toBeNull());

    expect(result.current.deliveryPlan.deliveries.map((d) => d.id)).toEqual([
      "instagram_feed:photo",
      "gbp:photo",
    ]);
    expect(result.current.selectedDeliveryId).toBe("instagram_feed:photo");
    expect(result.current.activeImageFormat?.id).toBe("feed_portrait");
    expect(mocks.renderFormatIfNeeded).toHaveBeenCalledWith(
      IMAGE,
      expect.objectContaining({ id: "feed_portrait", width: 1080, height: 1350 }),
    );
    expect(mocks.prepareMediaForSave).toHaveBeenLastCalledWith({
      sourceUrl: `${IMAGE}#feed_portrait`,
      kind: "image",
      basename: basenameFor("instagram_feed:photo", ["instagram_feed", "gbp"]),
    });
    expect(result.current.isPreparingSave).toBe(false);
    expect(result.current.websiteOnly).toBe(false);
    unmount();
  });

  it("drops the old prepared file the moment another destination is selected", async () => {
    const video = makeVideo();
    const options = baseOptions({ video });
    const { result, unmount } = renderHook(() => usePreparedDelivery(options));
    await waitFor(() =>
      expect(result.current.activePreparedSave?.filename).toBe(
        `${basenameFor("instagram_feed:photo", ["instagram_feed", "gbp"])}.jpg`,
      ),
    );

    let finishSecond!: () => void;
    mocks.prepareMediaForSave.mockImplementationOnce(
      (options: { kind: "image" | "video"; basename?: string }) =>
        new Promise<PreparedMediaSave>((resolve) => {
          finishSecond = () => resolve(preparedFile(options));
        }),
    );
    act(() => result.current.selectDeliveryById("gbp:photo"));

    expect(mocks.triggerHapticFeedback).toHaveBeenCalledTimes(1);
    expect(result.current.selectedDeliveryId).toBe("gbp:photo");
    expect(result.current.activePreparedSave).toBeNull();
    expect(result.current.isPreparingSave).toBe(true);
    expect(video.setManualVideoSelected).toHaveBeenCalledWith(false);
    expect(video.adoptVideoUrl).toHaveBeenCalledWith(null);

    await waitFor(() => expect(typeof finishSecond).toBe("function"));
    expect(result.current.activePreparedSave).toBeNull();
    await act(async () => {
      finishSecond();
    });
    await waitFor(() =>
      expect(result.current.activePreparedSave?.filename).toBe(
        `${basenameFor("gbp:photo", ["instagram_feed", "gbp"])}.jpg`,
      ),
    );
    expect(result.current.activeImageFormat?.id).toBe("gbp");
    expect(mocks.renderFormatIfNeeded).toHaveBeenLastCalledWith(
      IMAGE,
      expect.objectContaining({ id: "gbp", width: 1200, height: 900 }),
    );
    unmount();
  });

  it("never returns a prepared file under a different row's key", async () => {
    const seen: Array<{ selected: string | null; file: string | null }> = [];
    const options = baseOptions();
    const { result, unmount } = renderHook(() => {
      const state = usePreparedDelivery(options);
      seen.push({
        selected: state.selectedDeliveryId,
        file: state.activePreparedSave?.filename ?? null,
      });
      return state;
    });
    const feedFile = `${basenameFor("instagram_feed:photo", ["instagram_feed", "gbp"])}.jpg`;
    await waitFor(() =>
      expect(result.current.activePreparedSave?.filename).toBe(feedFile),
    );
    const feed = result.current.deliveriesById.get("instagram_feed:photo")!;
    expect(result.current.preparationKeyForDelivery(feed)).toBe(
      "delivery:instagram_feed:photo:asset",
    );
    expect(result.current.preparedSaveForKey).toBe(
      "delivery:instagram_feed:photo:asset",
    );

    // Bypass selectDeliveryById's own clearing: the key check alone must hide
    // the feed file from the Facebook row on the very first render.
    seen.length = 0;
    act(() => result.current.setSelectedDeliveryId("gbp:photo"));

    const gbpRenders = seen.filter((entry) => entry.selected === "gbp:photo");
    expect(gbpRenders.length).toBeGreaterThan(0);
    expect(gbpRenders.every((entry) => entry.file !== feedFile)).toBe(true);
    expect(gbpRenders[0].file).toBeNull();
    unmount();
  });

  it("plans no platform files for a website-only post", async () => {
    const websiteOptions = baseOptions({
      post: { image: IMAGE, platformIds: undefined, postId: "post-1" },
      websiteEnabled: true,
    });
    const websiteOnly = renderHook(() => usePreparedDelivery(websiteOptions));
    expect(websiteOnly.result.current.deliveryPlan.deliveries).toEqual([]);
    expect(websiteOnly.result.current.websiteOnly).toBe(true);
    expect(websiteOnly.result.current.selectedDeliveryId).toBeNull();
    // The neutral primary file is still prepared under the primary key.
    await waitFor(() =>
      expect(websiteOnly.result.current.preparedSaveForKey).toBe("primary:post-1"),
    );
    websiteOnly.unmount();

    // Without the website channel an unsaved platform list falls back to a row.
    const fallbackOptions = baseOptions({
      post: { image: IMAGE, platformIds: undefined, postId: "post-1" },
      websiteEnabled: false,
    });
    const fallback = renderHook(() => usePreparedDelivery(fallbackOptions));
    expect(fallback.result.current.deliveryPlan.deliveries.map((d) => d.id)).toEqual([
      "instagram_story:photo",
    ]);
    expect(fallback.result.current.websiteOnly).toBe(false);
    fallback.unmount();
  });

  it("never substitutes the still image for a selected video row, and validates the clip first", async () => {
    const post = {
      image: IMAGE,
      platformIds: ["instagram_reel"],
      mediaOutputMode: "video" as const,
      postId: "post-1",
    };
    const initial = baseOptions({ post });
    const { result, rerender, unmount } = renderHook(
      (props: UsePreparedDeliveryOptions) => usePreparedDelivery(props),
      { initialProps: initial },
    );
    expect(result.current.selectedDeliveryId).toBe("instagram_reel:video");
    await waitFor(() => expect(result.current.isPreparingSave).toBe(false));
    // The mount-time primary preparation (before the row was selected) is
    // discarded; with no finished clip the video row has no file at all.
    await act(async () => undefined);
    expect(result.current.activePreparedSave).toBeNull();
    expect(mocks.prepareMediaForSave).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "video" }),
    );
    mocks.prepareMediaForSave.mockClear();

    // The clip exists but does not match the exact output: nothing is prepared.
    mocks.validateVideoMetadata.mockRejectedValueOnce(new Error("wrong size"));
    const job = reelJob();
    rerender(
      baseOptions({
        post,
        video: makeVideo({ videoJobs: [job], videoJobForDelivery: () => job }),
      }),
    );
    await waitFor(() => expect(result.current.mediaPreparationError).toBeTruthy());
    expect(mocks.validateVideoMetadata).toHaveBeenCalledWith("blob:reel", {
      width: 1080,
      height: 1920,
      durationSeconds: 8,
    });
    expect(mocks.prepareMediaForSave).not.toHaveBeenCalled();
    expect(result.current.activePreparedSave).toBeNull();

    // The retry nonce re-runs preparation of the same row.
    act(() => result.current.retryPreparation());
    await waitFor(() => expect(result.current.activePreparedSave).not.toBeNull());
    expect(mocks.prepareMediaForSave).toHaveBeenCalledWith({
      sourceUrl: "blob:reel",
      kind: "video",
      basename: basenameFor("instagram_reel:video", ["instagram_reel"], "video"),
    });
    expect(result.current.activePreparedSave?.kind).toBe("video");
    expect(result.current.preparedSaveForKey).toBe(
      "delivery:instagram_reel:video:video-1",
    );
    expect(result.current.mediaPreparationError).toBeNull();
    // A video file never gets an image preview URL.
    expect(result.current.formattedPreviewUrl).toBeNull();
    unmount();
  });

  it("moves the selection to the exact row of an adopted clip, and drops a stale clip", async () => {
    const post = {
      image: IMAGE,
      platformIds: ["instagram_feed"],
      mediaOutputMode: "photo" as const,
      postId: "post-1",
    };
    const job = reelJob();
    const current = makeVideo({
      videoJobs: [job],
      videoUrl: "blob:reel",
      videoJobForDelivery: () => job,
    });
    const { result, rerender, unmount } = renderHook(
      (props: UsePreparedDeliveryOptions) => usePreparedDelivery(props),
      { initialProps: baseOptions({ post, video: current }) },
    );
    // A job exists, so the photo plan widens to photo + video.
    expect(result.current.deliveryPlan.deliveries.map((d) => d.id)).toEqual([
      "instagram_feed:photo",
      "instagram_reel:video",
    ]);
    await waitFor(() =>
      expect(result.current.selectedDeliveryId).toBe("instagram_reel:video"),
    );
    expect(current.adoptVideoUrl).not.toHaveBeenCalled();

    // The same clip from an older creative revision is dropped from preview.
    const stale = makeVideo({
      videoJobs: [job],
      videoUrl: "blob:reel",
      currentVideoCreativeKey: "post-1:1",
    });
    rerender(baseOptions({ post, video: stale }));
    expect(stale.setManualVideoSelected).toHaveBeenCalledWith(false);
    expect(stale.adoptVideoUrl).toHaveBeenCalledWith(null);
    unmount();
  });

  it("selects a row by channel and media kind, following the requesting platform", async () => {
    const job = reelJob();
    const video = makeVideo({ videoJobs: [job], videoJobForDelivery: () => job });
    const options = baseOptions({
      post: {
        image: IMAGE,
        platformIds: ["instagram_feed", "gbp"],
        mediaOutputMode: "photo",
        postId: "post-1",
      },
      video,
    });
    const { result, unmount } = renderHook(() => usePreparedDelivery(options));
    await waitFor(() =>
      expect(result.current.selectedDeliveryId).toBe("instagram_feed:photo"),
    );

    let selected = false;
    act(() => {
      selected = result.current.selectDelivery("instagram_feed", "video");
    });
    expect(selected).toBe(true);
    expect(result.current.selectedDeliveryId).toBe("instagram_reel:video");
    expect(video.adoptVideoUrl).toHaveBeenLastCalledWith("blob:reel");

    act(() => {
      selected = result.current.selectDelivery("gbp", "photo");
    });
    expect(selected).toBe(true);
    expect(result.current.selectedDeliveryId).toBe("gbp:photo");

    act(() => {
      selected = result.current.selectDelivery("tiktok", "photo");
    });
    expect(selected).toBe(false);
    expect(result.current.selectedDeliveryId).toBe("gbp:photo");
    unmount();
  });

  it("owns one preview object URL at a time and revokes it when it is replaced or unmounted", async () => {
    const options = baseOptions();
    const { result, unmount } = renderHook(() => usePreparedDelivery(options));
    await waitFor(() =>
      expect(result.current.formattedPreviewUrl).toBe("blob:preview-1"),
    );
    expect(createObjectURL).toHaveBeenCalledWith(
      result.current.activePreparedSave?.file,
    );

    act(() => result.current.selectDeliveryById("gbp:photo"));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview-1");
    expect(result.current.formattedPreviewUrl).toBeNull();
    await waitFor(() =>
      expect(result.current.formattedPreviewUrl).toBe("blob:preview-2"),
    );

    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview-2");
  });
});
