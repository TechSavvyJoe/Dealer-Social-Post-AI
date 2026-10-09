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
  Object.defineProperty(video, "readyState", {
    value: HTMLMediaElement.HAVE_CURRENT_DATA,
    configurable: true,
  });
  video.play = vi.fn().mockResolvedValue(undefined);
  video.pause = vi.fn();
  video.requestVideoFrameCallback = vi.fn((callback: VideoFrameRequestCallback) => {
    presented = callback;
    return 7;
  });
  video.cancelVideoFrameCallback = vi.fn();
  return {
    video,
    callback: () => presented!,
    present: (
      mediaTime = video.currentTime,
      presentationTime = performance.now() + 1,
    ) => presented?.(0, { mediaTime, presentationTime } as VideoFrameCallbackMetadata),
  };
};

describe("walkaround decoded frame boundary", () => {
  it("rejects queued old presentations while priming a drawable surface", async () => {
    const { video, present } = decodingVideo();
    const finished = vi.fn();
    const waiting = waitForSpinFrame(video).then(finished);
    present(0, -1);
    await Promise.resolve();
    expect(finished).not.toHaveBeenCalled();
    expect(video.requestVideoFrameCallback).toHaveBeenCalledTimes(2);
    present(0);
    await waiting;
    expect(finished).toHaveBeenCalledOnce();
  });
  it.each(["before", "after"])(
    "does not let a previous pipeline presentation delivered %s seeked bypass the active seek and paint boundary",
    async (delivery) => {
      vi.useFakeTimers();
      const { video, present, callback } = decodingVideo();
      const prime = waitForSpinFrame(video);
      const stale = callback();
      present();
      await prime;
      const finished = vi.fn();
      const waiting = waitForSpinFrame(video, undefined, 1 / 12).then(finished);
      const oldPresentation = () =>
        stale(0, {
          mediaTime: 0,
          presentationTime: performance.now() + 1,
        } as VideoFrameCallbackMetadata);
      if (delivery === "before") oldPresentation();
      await vi.advanceTimersByTimeAsync(40);
      expect(finished).not.toHaveBeenCalled();
      video.dispatchEvent(new Event("seeked"));
      if (delivery === "after") oldPresentation();
      await Promise.resolve();
      expect(finished).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(40);
      await waiting;
      expect(video.requestVideoFrameCallback).toHaveBeenCalledOnce();
      expect(video.play).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it.each([1 / 12, 1 / 6, 47 / 12])(
    "accepts quantized same-frame or final-frame sample %s with no new presentation or playback",
    async (target) => {
      vi.useFakeTimers();
      const { video } = decodingVideo();
      const waiting = waitForSpinFrame(video, undefined, target);
      expect(video.currentTime).toBe(target);
      video.dispatchEvent(new Event("seeked"));
      await vi.advanceTimersByTimeAsync(40);
      await waiting;
      expect(video.play).not.toHaveBeenCalled();
      expect(video.requestVideoFrameCallback).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it("requires target data and rejects a mismatched seeked event", async () => {
    vi.useFakeTimers();
    const { video } = decodingVideo();
    const finished = vi.fn();
    const waiting = waitForSpinFrame(video, undefined, 1.25).then(finished);
    video.currentTime = 0;
    video.dispatchEvent(new Event("seeked"));
    await vi.advanceTimersByTimeAsync(40);
    expect(finished).not.toHaveBeenCalled();
    video.currentTime = 1.25;
    Object.defineProperty(video, "readyState", {
      value: HTMLMediaElement.HAVE_METADATA,
      configurable: true,
    });
    video.dispatchEvent(new Event("seeked"));
    await vi.advanceTimersByTimeAsync(40);
    expect(finished).not.toHaveBeenCalled();
    Object.defineProperty(video, "readyState", {
      value: HTMLMediaElement.HAVE_CURRENT_DATA,
    });
    video.dispatchEvent(new Event("seeked"));
    await vi.advanceTimersByTimeAsync(40);
    await waiting;
  });
  it("does not accept an initial callback before drawable decoded data exists", async () => {
    const { video, present } = decodingVideo();
    Object.defineProperty(video, "readyState", {
      value: HTMLMediaElement.HAVE_METADATA,
      configurable: true,
    });
    const finished = vi.fn();
    const waiting = waitForSpinFrame(video).then(finished);
    present();
    await Promise.resolve();
    expect(finished).not.toHaveBeenCalled();
    Object.defineProperty(video, "readyState", {
      value: HTMLMediaElement.HAVE_CURRENT_DATA,
    });
    present();
    await waiting;
    expect(finished).toHaveBeenCalledOnce();
  });
  it("ignores a canceled operation's callback after another prime begins", async () => {
    const { video, present, callback } = decodingVideo();
    const controller = new AbortController();
    const previous = waitForSpinFrame(video, controller.signal);
    const stale = callback();
    const rejected = expect(previous).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejected;
    const finished = vi.fn();
    const next = waitForSpinFrame(video).then(finished);
    stale(0, {
      mediaTime: 0,
      presentationTime: performance.now() + 1,
    } as VideoFrameCallbackMetadata);
    await Promise.resolve();
    expect(finished).not.toHaveBeenCalled();
    present();
    await next;
    expect(finished).toHaveBeenCalledOnce();
  });
  it("waits beyond loadeddata until the initial decoder presents a frame", async () => {
    const { video, present } = decodingVideo();
    const finished = vi.fn();
    const waiting = waitForSpinFrame(video).then(finished);
    video.dispatchEvent(new Event("loadeddata"));
    await Promise.resolve();
    expect(finished).not.toHaveBeenCalled();
    expect(video.play).toHaveBeenCalledOnce();
    present();
    await waiting;
    expect(finished).toHaveBeenCalledOnce();
    expect(video.pause).toHaveBeenCalledTimes(2);
    expect(video.cancelVideoFrameCallback).toHaveBeenCalledWith(7);
  });
  it("cancels paint turns if a paused seek is aborted", async () => {
    vi.useFakeTimers();
    const { video } = decodingVideo();
    const controller = new AbortController();
    const waiting = waitForSpinFrame(video, controller.signal, 47 / 12);
    const rejected = expect(waiting).rejects.toThrow("cancelled");
    video.dispatchEvent(new Event("seeked"));
    await vi.advanceTimersByTimeAsync(17);
    controller.abort();
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    video.dispatchEvent(new Event("seeked"));
    expect(vi.getTimerCount()).toBe(0);
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
      expect(video.pause).toHaveBeenCalledTimes(2);
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
