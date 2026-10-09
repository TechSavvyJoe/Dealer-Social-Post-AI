import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkSpinVideo,
  spinFrameAt,
  spinSampleTimes,
  spinZoom,
  waitForSpinFrame,
} from "./vehicleSpin";

afterEach(() => vi.useRealTimers());

const decodingVideo = () => {
  const video = document.createElement("video");
  let presented: VideoFrameRequestCallback | undefined;
  video.play = vi.fn().mockResolvedValue(undefined);
  video.pause = vi.fn();
  video.requestVideoFrameCallback = vi.fn((callback: VideoFrameRequestCallback) => {
    presented = callback;
    return 7;
  });
  video.cancelVideoFrameCallback = vi.fn();
  return {
    video,
    present: (mediaTime = video.currentTime) =>
      presented?.(0, { mediaTime } as VideoFrameCallbackMetadata),
  };
};

describe("walkaround decoded frame boundary", () => {
  it("ignores a late previous angle and completes only the requested decoded timestamp", async () => {
    const { video, present } = decodingVideo();
    const finished = vi.fn();
    const waiting = waitForSpinFrame(video, undefined, 0.125).then(finished);
    present(0);
    await Promise.resolve();
    expect(finished).not.toHaveBeenCalled();
    expect(video.requestVideoFrameCallback).toHaveBeenCalledTimes(2);
    present(0.125);
    await waiting;
    expect(finished).toHaveBeenCalledOnce();
  });
  it("registers a presentation callback before a paused seek without starting playback", async () => {
    const { video, present } = decodingVideo();
    const waiting = waitForSpinFrame(video, undefined, 1.25);
    expect(video.currentTime).toBe(1.25);
    expect(video.requestVideoFrameCallback).toHaveBeenCalledOnce();
    expect(video.play).not.toHaveBeenCalled();
    present();
    await waiting;
    expect(video.pause).toHaveBeenCalledOnce();
  });
  it("waits beyond loadeddata and seeked until the decoder presents a frame", async () => {
    const { video, present } = decodingVideo();
    const finished = vi.fn();
    const waiting = waitForSpinFrame(video).then(finished);
    video.dispatchEvent(new Event("loadeddata"));
    video.dispatchEvent(new Event("seeked"));
    await Promise.resolve();
    expect(finished).not.toHaveBeenCalled();
    expect(video.play).toHaveBeenCalledOnce();
    present();
    await waiting;
    expect(finished).toHaveBeenCalledOnce();
    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.cancelVideoFrameCallback).toHaveBeenCalledWith(7);
  });

  it.each(["abort", "timeout"])(
    "stops decoding and clears the callback after %s",
    async (reason) => {
      vi.useFakeTimers();
      const { video, present } = decodingVideo();
      const controller = new AbortController();
      const waiting = waitForSpinFrame(video, controller.signal);
      const rejected = expect(waiting).rejects.toThrow(
        reason === "abort" ? "cancelled" : "too long",
      );
      if (reason === "abort") controller.abort();
      else await vi.advanceTimersByTimeAsync(20000);
      await rejected;
      present();
      expect(video.pause).toHaveBeenCalledOnce();
      expect(video.cancelVideoFrameCallback).toHaveBeenCalledWith(7);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});

describe("walkaround frame planning", () => {
  it("samples one full turn without repeating the last angle", () => {
    const times = spinSampleTimes(4, 28, 30);
    expect(times).toHaveLength(48);
    expect(times[0]).toBe(4);
    expect(times[47]).toBe(27.5);
    expect(new Set(times).size).toBe(48);
  });
  it.each([
    [-1, 12, 20],
    [0, 25, 20],
    [2, 3, 20],
    [0, 181, 181],
    [NaN, 12, 20],
    [0, Infinity, 20],
    [0, 12, 0],
  ])("rejects invalid capture range %s–%s (%s)", (start, end, duration) => {
    expect(() => spinSampleTimes(start, end, duration)).toThrow();
  });
  it("wraps both rotation directions and clamps zoom", () => {
    expect(spinFrameAt(-1, 48)).toBe(47);
    expect(spinFrameAt(50, 48)).toBe(2);
    expect(spinFrameAt(1, 0)).toBe(0);
    expect(spinZoom(0.5)).toBe(1);
    expect(spinZoom(5)).toBe(3);
    expect(spinZoom(NaN)).toBe(1);
  });
  it("accepts phone MOV files without a supplied MIME and rejects other uploads", () => {
    expect(() => checkSpinVideo(new File(["test"], "walkaround.MOV"))).not.toThrow();
    expect(() =>
      checkSpinVideo(new File(["test"], "notes.txt", { type: "text/plain" })),
    ).toThrow();
    expect(() =>
      checkSpinVideo(new File([], "empty.mp4", { type: "video/mp4" })),
    ).toThrow();
  });
});
