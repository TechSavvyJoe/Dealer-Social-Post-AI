import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fileToNormalizedDataUrl,
  imageFileExtension,
  resolveVeoAspect,
} from "./imageUtils";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("imageFileExtension", () => {
  it("matches data URL image formats", () => {
    expect(imageFileExtension("data:image/png;base64,abc")).toBe("png");
    expect(imageFileExtension("data:image/jpeg;base64,abc")).toBe("jpg");
    expect(imageFileExtension("data:image/webp;base64,abc")).toBe("webp");
  });

  it("matches supported URL suffixes without trusting query strings", () => {
    expect(imageFileExtension("https://example.com/creative.avif?v=2")).toBe("avif");
    expect(imageFileExtension("https://example.com/creative.jpeg")).toBe("jpg");
  });

  it("uses an interoperable default for unknown sources", () => {
    expect(imageFileExtension("blob:generated-image")).toBe("jpg");
  });
});

describe("resolveVeoAspect", () => {
  it("maps portrait to 9:16 and landscape to 16:9 in auto mode", () => {
    expect(resolveVeoAspect(1080, 1920, "auto")).toBe("9:16");
    expect(resolveVeoAspect(1920, 1080, "auto")).toBe("16:9");
  });

  it("prefers 9:16 for square social posts", () => {
    expect(resolveVeoAspect(1080, 1080, "auto")).toBe("9:16");
  });

  it("honors explicit preference", () => {
    expect(resolveVeoAspect(1080, 1080, "16:9")).toBe("16:9");
    expect(resolveVeoAspect(1920, 1080, "9:16")).toBe("9:16");
    // Legacy square requests resolve truthfully to a real Veo landscape file.
    expect(resolveVeoAspect(1080, 1080, "1:1")).toBe("16:9");
  });
});

describe("fileToNormalizedDataUrl", () => {
  it("fails clearly when the browser cannot decode a HEIC original", async () => {
    class UndecodableImage {
      width = 0;
      height = 0;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_value: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }

    vi.stubGlobal("createImageBitmap", undefined);
    vi.stubGlobal("Image", UndecodableImage);

    const file = new File([new Uint8Array([1, 2, 3, 4])], "delivery.heic", {
      type: "image/heic",
    });

    await expect(fileToNormalizedDataUrl(file)).rejects.toThrow(
      "cannot preview this HEIC photo",
    );
  });
});
