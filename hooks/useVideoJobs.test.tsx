import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VideoStyle, type VideoRequestOptions } from "../types";
import { derivePlatformDeliveryPlan } from "../services/platformOutputs";

const mocks = vi.hoisted(() => ({
  toastWarning: vi.fn(),
  toastSuccess: vi.fn(),
  markPostVideoGenerated: vi.fn(async (_postId: string) => ({ has_video: true })),
  archiveDealerMedia: vi.fn(async () => undefined),
}));

vi.mock("../components/ui/Toast", () => ({
  useToast: () => ({
    warning: mocks.toastWarning,
    success: mocks.toastSuccess,
    error: vi.fn(),
  }),
}));

vi.mock("../services/posts", () => ({
  markPostVideoGenerated: mocks.markPostVideoGenerated,
}));

vi.mock("../utils/creativeStorage", () => ({
  archiveDealerMedia: mocks.archiveDealerMedia,
}));

import { useVideoJobs, type UseVideoJobsOptions } from "./useVideoJobs";

const REEL: VideoRequestOptions = {
  durationSeconds: 8,
  soundtrack: "cinematic",
  aspectPreference: "9:16",
  resolution: "1080p",
  pacing: "cinematic",
};

const reelDelivery = derivePlatformDeliveryPlan(["instagram_reel"], "video")
  .deliveries[0];

const options = (
  overrides: Partial<UseVideoJobsOptions> = {},
): UseVideoJobsOptions => ({
  post: { image: "data:image/png;base64,aW1hZ2U=", postId: "post-1" },
  resultIdentity: "post-1",
  dealerId: "dealer-1",
  motion: null,
  onGenerateVideo: vi.fn(async () => "blob:clip-1"),
  ...overrides,
});

/** Renders that stay in flight until the test settles every one of them. */
const deferredRender = () => {
  const pending: Array<{
    resolve: (url: string) => void;
    reject: (error: unknown) => void;
  }> = [];
  const onGenerateVideo = vi.fn(
    () =>
      new Promise<string>((resolve, reject) => {
        pending.push({ resolve, reject });
      }),
  );
  return {
    onGenerateVideo,
    settle: (url: string) => pending.forEach((render) => render.resolve(url)),
    fail: (e: unknown) => pending.forEach((render) => render.reject(e)),
  };
};

let revokeObjectURL: ReturnType<typeof vi.fn>;
const originalRevoke = URL.revokeObjectURL;

beforeEach(() => {
  mocks.toastWarning.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.markPostVideoGenerated.mockReset();
  mocks.markPostVideoGenerated.mockResolvedValue({ has_video: true });
  mocks.archiveDealerMedia.mockReset();
  revokeObjectURL = vi.fn();
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: revokeObjectURL,
  });
});

afterEach(() => {
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: originalRevoke,
  });
});

describe("useVideoJobs", () => {
  it("lets only one paid render start when two taps land in the same frame", async () => {
    const render = deferredRender();
    const { result, unmount } = renderHook(() =>
      useVideoJobs(options({ onGenerateVideo: render.onGenerateVideo })),
    );

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.startVideoJob(VideoStyle.GoldenRadiance, REEL);
      second = result.current.startVideoJob(VideoStyle.GoldenRadiance, REEL);
    });
    // Checked before awaiting anything: a second paid render would already
    // have been requested synchronously by the second tap.
    expect(render.onGenerateVideo).toHaveBeenCalledTimes(1);
    await act(async () => {
      await second;
    });

    expect(mocks.toastWarning).toHaveBeenCalledWith(
      "A video is already rendering. Wait for it to finish first.",
    );
    expect(result.current.videoJobs).toHaveLength(1);
    expect(result.current.videoJobs[0].status).toBe("processing");
    expect(result.current.isVideoLoading).toBe(true);
    expect(result.current.atRisk).toBe(true);

    await act(async () => {
      render.settle("blob:clip-1");
      await first;
    });

    expect(result.current.isVideoLoading).toBe(false);
    expect(result.current.videoGenerationActiveRef.current).toBe(false);
    expect(result.current.videoJobs[0]).toMatchObject({
      status: "completed",
      url: "blob:clip-1",
      sourceCreativeKey: "post-1:0",
    });
    expect(result.current.videoUrl).toBe("blob:clip-1");
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Video ready — tap play if it does not start.",
    );
    unmount();
  });

  it("keeps the two newest jobs and revokes a clip only once it leaves that window", async () => {
    const urls = ["blob:clip-1", "blob:clip-2", "blob:clip-3"];
    const onGenerateVideo = vi.fn(async () => urls.shift() as string);
    const { result, unmount } = renderHook(() =>
      useVideoJobs(options({ onGenerateVideo })),
    );

    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        await result.current.startVideoJob(VideoStyle.GoldenRadiance, REEL);
      });
    }

    expect(result.current.videoJobs.map((job) => job.url)).toEqual([
      "blob:clip-2",
      "blob:clip-3",
    ]);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:clip-1");
    unmount();
  });

  it("never revokes a finished clip when the preview switches away; only unmount does", async () => {
    const { result, unmount } = renderHook(() => useVideoJobs(options()));
    await act(async () => {
      await result.current.startVideoJob(VideoStyle.GoldenRadiance, REEL);
    });
    expect(result.current.videoUrl).toBe("blob:clip-1");

    act(() => {
      result.current.setManualVideoSelected(false);
      result.current.adoptVideoUrl(null);
    });
    expect(result.current.videoUrl).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();

    // Switching back still plays the same, un-revoked clip.
    act(() => result.current.adoptVideoUrl("blob:clip-1"));
    expect(result.current.videoUrl).toBe("blob:clip-1");
    expect(result.current.videoMuted).toBe(true);
    expect(result.current.isVideoBuffering).toBe(true);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    unmount();
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:clip-1");
  });

  it("revokes a removed clip at once and drops it from the preview", async () => {
    const { result, unmount } = renderHook(() => useVideoJobs(options()));
    await act(async () => {
      await result.current.startVideoJob(VideoStyle.GoldenRadiance, REEL);
    });
    act(() => result.current.setManualVideoSelected(true));
    const jobId = result.current.videoJobs[0].id;

    act(() => result.current.removeVideoJob(jobId));

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:clip-1");
    expect(result.current.videoJobs).toHaveLength(0);
    expect(result.current.videoUrl).toBeNull();
    expect(result.current.manualVideoSelected).toBe(false);
    expect(result.current.atRisk).toBe(false);
    unmount();
  });

  it("binds each clip to the creative revision it was rendered from", async () => {
    const onGenerateVideo = vi
      .fn()
      .mockResolvedValueOnce("blob:first-image")
      .mockResolvedValueOnce("blob:second-image");
    const { result, rerender, unmount } = renderHook(
      (props: UseVideoJobsOptions) => useVideoJobs(props),
      { initialProps: options({ onGenerateVideo }) },
    );
    await act(async () => {
      await result.current.startVideoJob(VideoStyle.GoldenRadiance, REEL);
    });
    expect(result.current.currentVideoCreativeKey).toBe("post-1:0");
    expect(result.current.videoJobForDelivery(reelDelivery)?.url).toBe(
      "blob:first-image",
    );
    const staleJobId = result.current.videoJobs[0].id;

    // An image edit on the same post is a new revision: the old clip no
    // longer satisfies the exact Reel output.
    rerender(
      options({
        onGenerateVideo,
        post: { image: "data:image/png;base64,bmV3", postId: "post-1" },
      }),
    );
    expect(result.current.currentVideoCreativeKey).toBe("post-1:1");
    expect(result.current.videoJobForDelivery(reelDelivery)).toBeUndefined();

    // Retrying the stale job renders a NEW job for the current revision
    // instead of relabelling the old one.
    await act(async () => {
      await result.current.retryVideoJob(staleJobId);
    });
    expect(result.current.videoJobs).toHaveLength(2);
    expect(result.current.videoJobs[1].id).not.toBe(staleJobId);
    expect(result.current.videoJobs[1].sourceCreativeKey).toBe("post-1:1");
    expect(result.current.videoJobForDelivery(reelDelivery)?.url).toBe(
      "blob:second-image",
    );

    // A different result starts its own revision count at 0.
    rerender(
      options({
        onGenerateVideo,
        resultIdentity: "post-2",
        post: { image: "data:image/png;base64,bmV3", postId: "post-2" },
      }),
    );
    expect(result.current.currentVideoCreativeKey).toBe("post-2:0");
    unmount();
  });

  it("records the history metric and archives the clip, keeping it usable if the metric fails", async () => {
    mocks.markPostVideoGenerated.mockRejectedValueOnce(new Error("offline"));
    const { result, unmount } = renderHook(() => useVideoJobs(options()));
    await act(async () => {
      await result.current.startVideoJob(VideoStyle.GoldenRadiance, REEL);
    });

    expect(mocks.markPostVideoGenerated).toHaveBeenCalledWith("post-1");
    expect(mocks.archiveDealerMedia).toHaveBeenCalledWith("dealer-1", {
      kind: "video",
      source: "blob:clip-1",
      label: `${VideoStyle.GoldenRadiance} video`,
    });
    expect(mocks.toastWarning).toHaveBeenCalledWith(
      "Video created, but its history metric could not be updated.",
    );
    expect(result.current.videoJobs[0]).toMatchObject({
      status: "completed",
      url: "blob:clip-1",
    });
    unmount();
  });

  it("records a failed render once, releases the guard, and loses nothing on leave", async () => {
    const render = deferredRender();
    const { result, unmount } = renderHook(() =>
      useVideoJobs(options({ onGenerateVideo: render.onGenerateVideo })),
    );
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.startVideoJob(VideoStyle.GoldenRadiance, REEL);
    });
    await act(async () => {
      render.fail(new Error("Provider unavailable"));
      await pending;
    });

    expect(render.onGenerateVideo).toHaveBeenCalledTimes(1);
    expect(result.current.videoJobs[0].status).toBe("failed");
    expect(result.current.videoJobs[0].error).toMatch(/^Attempt 1 failed: /);
    expect(result.current.videoLoadingMessage).toBe(result.current.videoJobs[0].error);
    expect(result.current.isVideoLoading).toBe(false);
    expect(result.current.videoGenerationActiveRef.current).toBe(false);
    expect(result.current.atRisk).toBe(false);
    expect(mocks.markPostVideoGenerated).not.toHaveBeenCalled();
    unmount();
  });

  it("derives the house motion options from the dealership motion signature", () => {
    const { result, rerender, unmount } = renderHook(
      (props: UseVideoJobsOptions) => useVideoJobs(props),
      { initialProps: options() },
    );
    expect(result.current.houseMotionOptions).toBeNull();

    rerender(
      options({
        motion: { style: VideoStyle.GoldenRadiance, aspects: ["16:9"], audio: "funk" },
      }),
    );
    expect(result.current.houseMotionOptions).toEqual({
      durationSeconds: 6,
      soundtrack: "funk",
      aspectPreference: "16:9",
      resolution: "720p",
      pacing: "cinematic",
    });

    rerender(
      options({
        motion: { style: VideoStyle.GoldenRadiance, aspects: [], audio: "karaoke" },
      }),
    );
    expect(result.current.houseMotionOptions).toMatchObject({
      soundtrack: "cinematic",
      aspectPreference: "9:16",
    });
    unmount();
  });
});
