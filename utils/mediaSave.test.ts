import { describe, expect, it, vi, afterEach } from "vitest";
import {
  downloadPreparedMediaFile,
  isMobilePhotoDevice,
  prepareMediaForSave,
  savePreparedMediaToLibrary,
  saveResultToastMessage,
  validateVideoMetadata,
} from "./mediaSave";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isMobilePhotoDevice", () => {
  const original = { ...navigator };

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      value: original,
      configurable: true,
      writable: true,
    });
  });

  it("detects iPhone user agents", () => {
    Object.defineProperty(globalThis, "navigator", {
      value: {
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
        platform: "iPhone",
        maxTouchPoints: 5,
      },
      configurable: true,
    });
    expect(isMobilePhotoDevice()).toBe(true);
  });

  it("detects Android user agents", () => {
    Object.defineProperty(globalThis, "navigator", {
      value: {
        userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36",
        platform: "Linux armv8l",
        maxTouchPoints: 5,
      },
      configurable: true,
    });
    expect(isMobilePhotoDevice()).toBe(true);
  });
});

describe("saveResultToastMessage", () => {
  it("guides users to Save Image / Save Video in the share sheet", () => {
    expect(saveResultToastMessage({ method: "photos-share", kind: "image" })).toMatch(
      /Save Image/i,
    );
    expect(saveResultToastMessage({ method: "photos-share", kind: "video" })).toMatch(
      /Save Video/i,
    );
  });
});

describe("downloadPreparedMediaFile", () => {
  it("returns false instead of throwing when object URL creation fails", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      throw new Error("blob URLs unavailable");
    });

    expect(
      downloadPreparedMediaFile(
        new File(["video"], "delivery.mp4", { type: "video/mp4" }),
      ),
    ).toBe(false);
  });

  it("keeps a successful large-media object URL alive for the deferred download", () => {
    vi.useFakeTimers();
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:large-video");
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    expect(
      downloadPreparedMediaFile(
        new File(["video"], "delivery.mp4", { type: "video/mp4" }),
      ),
    ).toBe(true);
    expect(revoke).not.toHaveBeenCalled();

    vi.advanceTimersByTime(59_999);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revoke).toHaveBeenCalledWith("blob:large-video");
  });
});

describe("validateVideoMetadata", () => {
  const installDecodedVideo = (width: number, height: number, duration: number) => {
    const createElement = document.createElement.bind(document);
    const video = createElement("video");
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: width },
      videoHeight: { configurable: true, value: height },
      duration: { configurable: true, value: duration },
    });
    vi.spyOn(video, "pause").mockImplementation(() => undefined);
    vi.spyOn(video, "load").mockImplementation(() => {
      if (video.isConnected && (video.getAttribute("src") || video.src)) {
        queueMicrotask(() => video.dispatchEvent(new Event("loadedmetadata")));
      }
    });
    vi.spyOn(document, "createElement").mockImplementation(((
      tagName: string,
      options?: ElementCreationOptions,
    ) =>
      tagName.toLowerCase() === "video"
        ? video
        : createElement(tagName, options)) as typeof document.createElement);
    return video;
  };

  it("accepts exact vertical video pixels and duration", async () => {
    const video = installDecodedVideo(1080, 1920, 8.1);
    await expect(
      validateVideoMetadata("blob:vertical", {
        width: 1080,
        height: 1920,
        durationSeconds: 8,
      }),
    ).resolves.toEqual({
      width: 1080,
      height: 1920,
      durationSeconds: 8.1,
    });
    expect(video.playsInline).toBe(true);
    expect(video.isConnected).toBe(false);
    expect(video.getAttribute("src")).toBeNull();
  });

  it.each([
    {
      label: "vertical clip with landscape pixels",
      actual: { width: 1920, height: 1080, duration: 8 },
      expected: { width: 1080, height: 1920, durationSeconds: 8 },
    },
    {
      label: "landscape clip with the wrong duration",
      actual: { width: 1920, height: 1080, duration: 6 },
      expected: { width: 1920, height: 1080, durationSeconds: 8 },
    },
  ])("rejects a $label", async ({ actual, expected }) => {
    const video = installDecodedVideo(actual.width, actual.height, actual.duration);
    await expect(validateVideoMetadata("blob:mismatch", expected)).rejects.toThrow(
      /did not match/,
    );
    expect(video.isConnected).toBe(false);
  });

  it("removes a connected probe and releases its blob URL after a timeout", async () => {
    vi.useFakeTimers();
    const video = installDecodedVideo(1080, 1920, 8);
    vi.mocked(video.load).mockImplementation(() => undefined);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:verification");
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const pending = validateVideoMetadata(
      new Blob(["clip"], { type: "video/mp4" }),
      { width: 1080, height: 1920, durationSeconds: 8 },
      50,
    );
    const rejection = expect(pending).rejects.toThrow(/verification timed out/);
    expect(video.isConnected).toBe(true);
    await vi.advanceTimersByTimeAsync(50);
    await rejection;
    expect(video.isConnected).toBe(false);
    expect(revoke).toHaveBeenCalledWith("blob:verification");
  });
});

describe("savePreparedMediaToLibrary", () => {
  const original = { ...navigator };

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      value: original,
      configurable: true,
      writable: true,
    });
  });

  it("invokes navigator.share synchronously from the save action", async () => {
    const share = vi.fn((_data: ShareData) => Promise.resolve());
    Object.defineProperty(globalThis, "navigator", {
      value: {
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15",
        platform: "iPhone",
        maxTouchPoints: 5,
        canShare: () => true,
        share,
      },
      configurable: true,
      writable: true,
    });
    const file = new File(["photo"], "delivery.jpg", { type: "image/jpeg" });

    const resultPromise = savePreparedMediaToLibrary({
      kind: "image",
      filename: file.name,
      file,
    });

    // This assertion deliberately runs before awaiting the returned promise.
    // WebKit requires share() to begin inside the fresh Save button activation.
    expect(share).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ files: [file] }));
    expect(share.mock.calls[0]?.[0]).not.toHaveProperty("text");
    expect(share.mock.calls[0]?.[0]).not.toHaveProperty("title");
    await expect(resultPromise).resolves.toEqual({
      method: "photos-share",
      kind: "image",
    });
  });

  it("does not claim success when a WebKit share call returns no Promise", async () => {
    const share = vi.fn(() => undefined);
    Object.defineProperty(globalThis, "navigator", {
      value: {
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15",
        platform: "iPhone",
        maxTouchPoints: 5,
        canShare: () => true,
        share,
      },
      configurable: true,
      writable: true,
    });
    const file = new File(["photo"], "delivery.jpg", { type: "image/jpeg" });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:share-fallback");
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    await expect(
      savePreparedMediaToLibrary({
        kind: "image",
        filename: file.name,
        file,
      }),
    ).resolves.toEqual({ method: "download", kind: "image" });

    expect(share).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("bounds a WebKit share promise that never settles after Save Video", async () => {
    vi.useFakeTimers();
    const share = vi.fn(() => new Promise<void>(() => undefined));
    Object.defineProperty(globalThis, "navigator", {
      value: {
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15",
        platform: "iPhone",
        maxTouchPoints: 5,
        canShare: () => true,
        share,
      },
      configurable: true,
      writable: true,
    });
    const file = new File(["video"], "delivery.mp4", { type: "video/mp4" });

    const result = savePreparedMediaToLibrary({
      kind: "video",
      filename: file.name,
      file,
    });
    expect(share).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    await expect(result).resolves.toEqual({
      method: "photos-share-pending",
      kind: "video",
    });
  });

  it("reports a cancelled native share without downloading a duplicate", async () => {
    const abort = new DOMException("cancelled", "AbortError");
    const share = vi.fn(() => Promise.reject(abort));
    Object.defineProperty(globalThis, "navigator", {
      value: {
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15",
        platform: "iPhone",
        maxTouchPoints: 5,
        canShare: () => true,
        share,
      },
      configurable: true,
      writable: true,
    });
    const file = new File(["video"], "delivery.mp4", { type: "video/mp4" });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    await expect(
      savePreparedMediaToLibrary({
        kind: "video",
        filename: file.name,
        file,
      }),
    ).resolves.toEqual({ method: "cancelled", kind: "video" });
    expect(click).not.toHaveBeenCalled();
  });

  it("downloads a valid MP4 when mobile canShare throws instead of failing Save", async () => {
    const share = vi.fn();
    Object.defineProperty(globalThis, "navigator", {
      value: {
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15",
        platform: "iPhone",
        maxTouchPoints: 5,
        canShare: () => {
          throw new TypeError("unsupported file");
        },
        share,
      },
      configurable: true,
      writable: true,
    });
    const file = new File(
      [new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])],
      "delivery.mp4",
      { type: "video/mp4" },
    );
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:video-download-fallback");
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    await expect(
      savePreparedMediaToLibrary({
        kind: "video",
        filename: file.name,
        file,
      }),
    ).resolves.toEqual({ method: "download", kind: "video" });

    expect(share).not.toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalledWith(file);
    expect(click).toHaveBeenCalledTimes(1);
  });
});

describe("prepareMediaForSave", () => {
  const readBytes = (blob: Blob): Promise<Uint8Array> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.readAsArrayBuffer(blob);
    });

  it("normalizes valid provider bytes to an .mp4 file with video/mp4 MIME", async () => {
    const bytes = new Uint8Array(2048);
    bytes.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);

    const prepared = await prepareMediaForSave({
      sourceUrl: new Blob([bytes], { type: "application/octet-stream" }),
      kind: "video",
      basename: "delivery-video.mov",
    });

    expect(prepared.filename).toBe("delivery-video.mp4");
    expect(prepared.file.name).toBe("delivery-video.mp4");
    expect(prepared.file.type).toBe("video/mp4");
    expect(prepared.file.size).toBe(bytes.byteLength);
  });

  it.each([
    ["heic", "image/heic"],
    ["heif", "image/heif"],
  ] as const)(
    "preserves untyped .%s source files without relabeling their bytes as JPEG",
    async (extension, expectedMime) => {
      const bytes = new Uint8Array([
        0, 0, 0, 24, 102, 116, 121, 112, 104, 101, 105, 99,
      ]);
      const source = new File([bytes], `customer-original.${extension}`, {
        type: "",
      });

      const prepared = await prepareMediaForSave({
        sourceUrl: source,
        kind: "image",
        basename: "delivery-original",
      });

      expect(prepared.filename).toBe(`delivery-original.${extension}`);
      expect(prepared.file.name).toBe(`delivery-original.${extension}`);
      expect(prepared.file.type).toBe(expectedMime);
      await expect(readBytes(prepared.file)).resolves.toEqual(bytes);
    },
  );

  it("rejects a non-video response instead of exporting a broken MP4", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        blob: async () =>
          new Blob([JSON.stringify({ error: "session expired" })], {
            type: "application/json",
          }),
      })),
    );

    await expect(
      prepareMediaForSave({
        sourceUrl: "/api/video/download",
        kind: "video",
        basename: "dealer-social-video",
      }),
    ).rejects.toThrow("playable MP4 media");
  });

  it("rejects a non-success video download before creating a File", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 401,
      })),
    );

    await expect(
      prepareMediaForSave({
        sourceUrl: "/api/video/download",
        kind: "video",
      }),
    ).rejects.toThrow("Could not read media (401)");
  });

  it("includes the session cookie for same-origin protected media", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      blob: async () => new Blob(["image"], { type: "image/jpeg" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await prepareMediaForSave({
      sourceUrl: "/api/app/protected-media/example",
      kind: "image",
      basename: "delivery",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/app/protected-media/example",
      expect.objectContaining({
        credentials: "include",
        cache: "no-store",
      }),
    );
  });

  it("sanitizes generated download names without changing the media bytes", async () => {
    const source = new Blob(["image"], { type: "image/jpeg" });

    const prepared = await prepareMediaForSave({
      sourceUrl: source,
      kind: "image",
      basename: "../Customer: Delivery?.jpg",
    });

    expect(prepared.filename).toBe("Customer- Delivery.jpg");
    expect(prepared.file.type).toBe("image/jpeg");
  });
});
