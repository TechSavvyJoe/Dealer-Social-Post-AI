import { afterEach, describe, expect, it, vi } from "vitest";
import {
  computeContainRect,
  EXPORT_FORMATS,
  imageMatchesExportFormat,
  renderFormatIfNeeded,
} from "./multiFormatExport";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("computeContainRect", () => {
  it("letterboxes a landscape creative into 9:16 without cropping", () => {
    const r = computeContainRect(1920, 1080, 1080, 1920);
    // Full width of destination used (landscape is width-limited into tall frame)
    expect(r.drawW).toBe(1080);
    expect(r.drawH).toBeLessThan(1920);
    expect(r.dx).toBe(0);
    expect(r.dy).toBeGreaterThan(0);
    // Entire source aspect preserved
    expect(r.drawW / r.drawH).toBeCloseTo(1920 / 1080, 2);
  });

  it("letterboxes a square creative into marketplace 1.91:1 without cropping", () => {
    const r = computeContainRect(1080, 1080, 1200, 628);
    expect(r.drawH).toBe(628);
    expect(r.drawW).toBeLessThan(1200);
    expect(r.dy).toBe(0);
    expect(r.dx).toBeGreaterThan(0);
    expect(r.drawW / r.drawH).toBeCloseTo(1, 2);
  });

  it("fills feed 1:1 when source is already square", () => {
    const r = computeContainRect(1080, 1080, 1080, 1080);
    expect(r.drawW).toBe(1080);
    expect(r.drawH).toBe(1080);
    expect(r.dx).toBe(0);
    expect(r.dy).toBe(0);
  });
});

describe("computeCoverRect", () => {
  it("fills 9:16 from landscape by overflowing height (backdrop only)", async () => {
    const { computeCoverRect } = await import("./multiFormatExport");
    const r = computeCoverRect(1920, 1080, 1080, 1920);
    expect(r.drawW).toBeGreaterThanOrEqual(1080);
    expect(r.drawH).toBeGreaterThanOrEqual(1920);
  });
});

describe("EXPORT_FORMATS", () => {
  it("lists story before feed for mobile-first dealership traffic", () => {
    expect(EXPORT_FORMATS[0].id).toBe("story_vertical");
    expect(EXPORT_FORMATS[1].id).toBe("feed_square");
  });
});

describe("renderFormatIfNeeded", () => {
  const installDecodedImage = (width: number, height: number) => {
    class DecodedImage {
      crossOrigin = "";
      width = 0;
      height = 0;
      naturalWidth = width;
      naturalHeight = height;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }

    vi.stubGlobal("Image", DecodedImage);
  };

  it("returns an already exact source without allocating an export canvas", async () => {
    const format = EXPORT_FORMATS.find(({ id }) => id === "story_vertical")!;
    installDecodedImage(format.width, format.height);
    const canvasSpy = vi.spyOn(document, "createElement");
    const source = "data:image/png;base64,already-exact";

    await expect(renderFormatIfNeeded(source, format)).resolves.toBe(source);
    expect(canvasSpy).not.toHaveBeenCalledWith("canvas");
  });

  it("renders legacy media whose decoded pixels do not match the profile", async () => {
    const format = EXPORT_FORMATS.find(({ id }) => id === "story_vertical")!;
    installDecodedImage(1080, 1080);

    const gradient = { addColorStop: vi.fn() };
    const context = {
      createRadialGradient: vi.fn(() => gradient),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray(8 * 8 * 4).fill(64),
      })),
      restore: vi.fn(),
      save: vi.fn(),
      strokeRect: vi.fn(),
      fillStyle: "",
      globalAlpha: 1,
      imageSmoothingEnabled: true,
      imageSmoothingQuality: "high",
      lineWidth: 1,
      shadowBlur: 0,
      shadowColor: "",
      shadowOffsetY: 0,
      strokeStyle: "",
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/jpeg;base64,rendered-exact",
    );

    await expect(
      renderFormatIfNeeded("data:image/jpeg;base64,legacy-square", format),
    ).resolves.toBe("data:image/jpeg;base64,rendered-exact");
    expect(context.drawImage).toHaveBeenCalled();
    expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledWith(
      "image/jpeg",
      0.94,
    );
  });

  it("compares exact width and height rather than aspect ratio alone", () => {
    const story = EXPORT_FORMATS.find(({ id }) => id === "story_vertical")!;
    expect(imageMatchesExportFormat(1080, 1920, story)).toBe(true);
    expect(imageMatchesExportFormat(540, 960, story)).toBe(false);
    expect(imageMatchesExportFormat(1920, 1080, story)).toBe(false);
  });
});
