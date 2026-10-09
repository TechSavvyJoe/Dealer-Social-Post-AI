import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifySpinVideo } from "./vehicleSpinExport";

const NativeURL = URL;

describe("spin export verification", () => {
  const expected = { width: 1080, height: 1920, duration: 8 };
  let revoke: ReturnType<typeof vi.fn<(url: string) => void>>;
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    revoke = vi.fn<(url: string) => void>();
    vi.stubGlobal(
      "URL",
      class extends NativeURL {
        static createObjectURL = vi.fn(() => "blob:export-test");
        static revokeObjectURL = revoke;
      },
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  const probe = (duration: number, width = 1080) => {
    const video = document.querySelector("video")!;
    Object.defineProperties(video, {
      videoWidth: { value: width, configurable: true },
      videoHeight: { value: 1920, configurable: true },
      duration: { value: duration, configurable: true },
    });
    return video;
  };
  const file = () => new File(["synthetic"], "vehicle.mp4", { type: "video/mp4" });
  it("only accepts a decoded output with matching dimensions and measured length", async () => {
    const result = verifySpinVideo(file(), expected, new AbortController().signal);
    probe(8).dispatchEvent(new Event("loadeddata"));
    await expect(result).resolves.toBeUndefined();
    expect(document.querySelector("video")).toBeNull();
    expect(revoke).toHaveBeenCalledWith("blob:export-test");
  });
  it.each([
    [8, 1920],
    [2, 1080],
    [12, 1080],
  ])("rejects incorrect output (%s seconds, %s wide)", async (duration, width) => {
    const result = verifySpinVideo(file(), expected, new AbortController().signal);
    probe(duration, width).dispatchEvent(new Event("loadeddata"));
    await expect(result).rejects.toThrow(/wrong layout|incomplete/);
    expect(document.querySelector("video")).toBeNull();
    expect(revoke).toHaveBeenCalledOnce();
  });
  it("repairs unknown WebM duration before accepting the file", async () => {
    const result = verifySpinVideo(file(), expected, new AbortController().signal);
    const video = probe(Infinity);
    video.dispatchEvent(new Event("loadeddata"));
    expect(video.currentTime).toBe(1e10);
    Object.defineProperty(video, "duration", { value: 8 });
    video.dispatchEvent(new Event("durationchange"));
    await expect(result).resolves.toBeUndefined();
  });
  it("cancels a pending decoder and releases its URL and element", async () => {
    const controller = new AbortController();
    const result = verifySpinVideo(file(), expected, controller.signal);
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(document.querySelector("video")).toBeNull();
    expect(revoke).toHaveBeenCalledOnce();
  });
});
