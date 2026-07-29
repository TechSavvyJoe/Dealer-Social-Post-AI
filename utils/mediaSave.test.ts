import { describe, expect, it, vi, afterEach } from "vitest";
import {
  isMobilePhotoDevice,
  prepareMediaForSave,
  savePreparedMediaToLibrary,
  saveResultToastMessage,
} from "./mediaSave";

afterEach(() => {
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
    await expect(resultPromise).resolves.toEqual({
      method: "photos-share",
      kind: "image",
    });
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
});
