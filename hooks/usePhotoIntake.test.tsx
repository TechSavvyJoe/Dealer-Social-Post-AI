import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as imageUtils from "../utils/imageUtils";
import { usePhotoIntake } from "./usePhotoIntake";

vi.mock("../utils/imageUtils", () => ({
  fileToNormalizedDataUrl: vi.fn(),
}));

describe("usePhotoIntake", () => {
  const onImageSelected = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (imageUtils.fileToNormalizedDataUrl as any).mockResolvedValue(
      "data:image/jpeg;base64,dummydata",
    );
  });

  it("rejects a non-image file with the curated copy and never normalizes it", async () => {
    const { result } = renderHook(() => usePhotoIntake({ onImageSelected }));
    const file = new File(["dummy"], "notes.txt", { type: "text/plain" });

    await act(async () => {
      await result.current.processFile(file);
    });

    expect(result.current.error).toBe("Invalid file type. Please use an image file.");
    expect(imageUtils.fileToNormalizedDataUrl).not.toHaveBeenCalled();
    expect(onImageSelected).not.toHaveBeenCalled();
  });

  it("accepts a file with an image extension even without an image/* MIME type", async () => {
    const { result } = renderHook(() => usePhotoIntake({ onImageSelected }));
    // Some mobile browsers hand over HEIC files with an empty/octet-stream type.
    const file = new File(["dummy"], "photo.heic", { type: "" });

    await act(async () => {
      await result.current.processFile(file);
    });

    expect(imageUtils.fileToNormalizedDataUrl).toHaveBeenCalledWith(file);
    expect(onImageSelected).toHaveBeenCalledWith({
      workingImage: "data:image/jpeg;base64,dummydata",
      originalSource: file,
      originalFilename: "photo.heic",
    });
  });

  it("rejects a file over the 12 MB cap before attempting to decode it", async () => {
    const { result } = renderHook(() => usePhotoIntake({ onImageSelected }));
    const oversized = new File([new Uint8Array(13 * 1024 * 1024)], "big.jpg", {
      type: "image/jpeg",
    });

    await act(async () => {
      await result.current.processFile(oversized);
    });

    expect(result.current.error).toBe(
      "That photo is too large. Choose an image smaller than 12 MB.",
    );
    expect(imageUtils.fileToNormalizedDataUrl).not.toHaveBeenCalled();
  });

  it("processes a valid image file and forwards the normalized selection", async () => {
    const { result } = renderHook(() => usePhotoIntake({ onImageSelected }));
    const file = new File(["dummy"], "car.jpg", { type: "image/jpeg" });

    await act(async () => {
      await result.current.processFile(file);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.isProcessing).toBe(false);
    expect(onImageSelected).toHaveBeenCalledWith({
      workingImage: "data:image/jpeg;base64,dummydata",
      originalSource: file,
      originalFilename: "car.jpg",
    });
  });

  it("shows the curated HEIC copy when the decoder rejects an unreadable HEIC file", async () => {
    (imageUtils.fileToNormalizedDataUrl as any).mockRejectedValue(
      new Error("This browser cannot preview this HEIC photo."),
    );
    const { result } = renderHook(() => usePhotoIntake({ onImageSelected }));
    const file = new File(["dummy"], "photo.heic", { type: "image/heic" });

    await act(async () => {
      await result.current.processFile(file);
    });

    expect(result.current.error).toBe(
      "This photo is in Apple's HEIC/HEIF format, which this browser cannot read. Take the photo again with 'Most Compatible' format enabled, or use a JPEG/PNG.",
    );
    expect(onImageSelected).not.toHaveBeenCalled();
  });

  it("routes a non-HEIC decode failure through toUiMessage's curated fallback", async () => {
    (imageUtils.fileToNormalizedDataUrl as any).mockRejectedValue(
      new Error("Failed to fetch"),
    );
    const { result } = renderHook(() => usePhotoIntake({ onImageSelected }));
    const file = new File(["dummy"], "car.jpg", { type: "image/jpeg" });

    await act(async () => {
      await result.current.processFile(file);
    });

    // toUiMessage has its own curated copy for a dropped connection; the
    // hook's own fallback only applies when toUiMessage has none.
    expect(result.current.error).toBe(
      "Unable to connect to the server. Please check your internet connection.",
    );
    expect(onImageSelected).not.toHaveBeenCalled();
  });

  it("hands fileToNormalizedDataUrl's PNG output through unchanged on the default (non-flattening) path", async () => {
    // CameraCapture's path: no flattenToJpeg opt-in, so the PNG a screenshot
    // produces is handed straight to onImageSelected byte-for-byte, exactly
    // as it was before this hook existed. ImageCropModal is the one that
    // flattens PNG on confirm for this path, so flattening here too would
    // double-encode. This must hold regardless of canvas support in the
    // environment, because the flatten step is never invoked at all.
    (imageUtils.fileToNormalizedDataUrl as any).mockResolvedValue(
      "data:image/png;base64,dummydata",
    );
    const canvasSpy = vi.spyOn(document, "createElement");
    const { result } = renderHook(() => usePhotoIntake({ onImageSelected }));
    const file = new File(["dummy"], "screenshot.png", { type: "image/png" });

    await act(async () => {
      await result.current.processFile(file);
    });

    expect(onImageSelected).toHaveBeenCalledWith({
      workingImage: "data:image/png;base64,dummydata",
      originalSource: file,
      originalFilename: "screenshot.png",
    });
    expect(canvasSpy).not.toHaveBeenCalledWith("canvas");
    canvasSpy.mockRestore();
  });

  describe("flattenToJpeg (opt-in)", () => {
    /** Minimal 2D context stub: records what handleConfirm-equivalent code draws. */
    const makeFakeCtx = () => ({
      fillStyle: "",
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    });

    it("flattens a PNG onto white and re-encodes it as JPEG, capped at 2048px", async () => {
      (imageUtils.fileToNormalizedDataUrl as any).mockResolvedValue(
        "data:image/png;base64,dummydata",
      );

      const fakeCtx = makeFakeCtx();
      const toDataURL = vi.fn(() => "data:image/jpeg;base64,flattened");
      const realCreateElement = document.createElement.bind(document);
      const canvasSpy = vi
        .spyOn(document, "createElement")
        .mockImplementation((tag: string, ...rest: unknown[]) => {
          if (tag === "canvas") {
            return {
              width: 0,
              height: 0,
              getContext: () => fakeCtx,
              toDataURL,
            } as unknown as HTMLCanvasElement;
          }
          return (realCreateElement as any)(tag, ...rest);
        });

      // A 4000x2000 source exercises the 2048px cap (scale = 2048/4000).
      const ImageStub = class {
        naturalWidth = 4000;
        naturalHeight = 2000;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_value: string) {
          queueMicrotask(() => this.onload?.());
        }
      };
      const originalImage = globalThis.Image;
      // @ts-expect-error test stub
      globalThis.Image = ImageStub;

      const { result } = renderHook(() =>
        usePhotoIntake({ onImageSelected, flattenToJpeg: true }),
      );
      const file = new File(["dummy"], "screenshot.png", { type: "image/png" });

      await act(async () => {
        await result.current.processFile(file);
      });

      globalThis.Image = originalImage;
      canvasSpy.mockRestore();

      expect(fakeCtx.fillStyle).toBe("white");
      expect(fakeCtx.fillRect).toHaveBeenCalledWith(0, 0, 2048, 1024);
      expect(fakeCtx.drawImage).toHaveBeenCalledWith(
        expect.any(ImageStub),
        0,
        0,
        2048,
        1024,
      );
      expect(toDataURL).toHaveBeenCalledWith("image/jpeg", 0.9);
      expect(onImageSelected).toHaveBeenCalledWith({
        workingImage: "data:image/jpeg;base64,flattened",
        originalSource: file,
        originalFilename: "screenshot.png",
      });
    });

    it("fails closed (never forwards the PNG) when no 2D canvas context is available", async () => {
      (imageUtils.fileToNormalizedDataUrl as any).mockResolvedValue(
        "data:image/png;base64,dummydata",
      );
      const realCreateElement1 = document.createElement.bind(document);
      const canvasSpy = vi
        .spyOn(document, "createElement")
        .mockImplementation((tag: string, ...rest: unknown[]) => {
          if (tag === "canvas") {
            return { getContext: () => null } as unknown as HTMLCanvasElement;
          }
          return (realCreateElement1 as any)(tag, ...rest);
        });

      const { result } = renderHook(() =>
        usePhotoIntake({ onImageSelected, flattenToJpeg: true }),
      );
      const file = new File(["dummy"], "screenshot.png", { type: "image/png" });

      await act(async () => {
        await result.current.processFile(file);
      });

      canvasSpy.mockRestore();

      expect(onImageSelected).not.toHaveBeenCalled();
      expect(result.current.error).toBe(
        "This photo could not be prepared. Choose another photo and try again.",
      );
    });

    it("fails closed (never forwards the PNG) when the image fails to decode", async () => {
      (imageUtils.fileToNormalizedDataUrl as any).mockResolvedValue(
        "data:image/png;base64,dummydata",
      );
      const fakeCtx = makeFakeCtx();
      const realCreateElement2 = document.createElement.bind(document);
      const canvasSpy = vi
        .spyOn(document, "createElement")
        .mockImplementation((tag: string, ...rest: unknown[]) => {
          if (tag === "canvas") {
            return { getContext: () => fakeCtx } as unknown as HTMLCanvasElement;
          }
          return (realCreateElement2 as any)(tag, ...rest);
        });

      const ImageStub = class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_value: string) {
          queueMicrotask(() => this.onerror?.());
        }
      };
      const originalImage = globalThis.Image;
      // @ts-expect-error test stub
      globalThis.Image = ImageStub;

      const { result } = renderHook(() =>
        usePhotoIntake({ onImageSelected, flattenToJpeg: true }),
      );
      const file = new File(["dummy"], "screenshot.png", { type: "image/png" });

      await act(async () => {
        await result.current.processFile(file);
      });

      globalThis.Image = originalImage;
      canvasSpy.mockRestore();

      expect(onImageSelected).not.toHaveBeenCalled();
      expect(result.current.error).toBe(
        "This photo could not be prepared. Choose another photo and try again.",
      );
    });
  });

  it("drops the window-level listeners on unmount", async () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = renderHook(() => usePhotoIntake({ onImageSelected }));

    const addedTypes = addSpy.mock.calls.map(([type]) => type);
    expect(addedTypes).toEqual(
      expect.arrayContaining(["dragover", "dragenter", "dragleave", "drop"]),
    );

    unmount();

    const removedTypes = removeSpy.mock.calls.map(([type]) => type);
    expect(removedTypes).toEqual(
      expect.arrayContaining(["dragover", "dragenter", "dragleave", "drop"]),
    );

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("never registers window listeners when enableDrop is false", () => {
    const addSpy = vi.spyOn(window, "addEventListener");

    renderHook(() => usePhotoIntake({ onImageSelected, enableDrop: false }));

    const addedTypes = addSpy.mock.calls.map(([type]) => type);
    expect(addedTypes).not.toEqual(expect.arrayContaining(["drop"]));

    addSpy.mockRestore();
  });

  it("processes a file dropped on the window", async () => {
    renderHook(() => usePhotoIntake({ onImageSelected }));
    const file = new File(["dummy"], "car.jpg", { type: "image/jpeg" });

    await act(async () => {
      const dropEvent = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(dropEvent, "dataTransfer", {
        value: { files: [file] },
      });
      window.dispatchEvent(dropEvent);
      // Flush the async processFile chain kicked off by the drop handler.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onImageSelected).toHaveBeenCalledWith({
      workingImage: "data:image/jpeg;base64,dummydata",
      originalSource: file,
      originalFilename: "car.jpg",
    });
  });
});
