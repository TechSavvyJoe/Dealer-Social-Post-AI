import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseVinPhotoResult, prepareVinPhoto, readVinPhoto } from "./vinPhotoReader";
import { TASKS } from "./modelConfig";
import { setActiveAuthEpoch } from "../utils/authBoundary";
const generate = vi.hoisted(() => vi.fn());
vi.mock("./geminiClient", () => ({
  getGeminiClient: () => ({ models: { generateContent: generate } }),
}));
const VIN = "1HGCM82633A004352";
let image: { onload: (() => void) | null; onerror: (() => void) | null; src: string };
const draw = vi.fn();
const photo = () => new File(["synthetic"], "label.jpg", { type: "image/jpeg" });
beforeEach(() => {
  setActiveAuthEpoch(1);
  generate.mockReset().mockResolvedValue({ text: () => VIN });
  vi.stubGlobal(
    "Image",
    class {
      naturalWidth = 4096;
      naturalHeight = 2048;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      src = "";
      constructor() {
        image = this;
      }
    },
  );
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:synthetic"),
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: draw,
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/jpeg;base64,c3ludGhldGlj",
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setActiveAuthEpoch(0);
});
describe("VIN photo reading", () => {
  it.each([
    "UNREADABLE",
    `VIN: ${VIN}`,
    `${VIN}\n${VIN}`,
    "1HGCM82633A00435",
    "1HGCM82633A00435O",
    `\"${VIN}\"`,
    '{"vin":"' + VIN + '"}',
  ])("rejects incomplete, ambiguous, repaired, or prose output %s", (text) => {
    expect(() => parseVinPhotoResult(text)).toThrow("Retake");
  });
  it("accepts only a complete standalone VIN", () =>
    expect(parseVinPhotoResult(" " + VIN.toLowerCase() + "\n")).toBe(VIN));
  it("downsamples a synthetic photo and uses the existing pinned vision policy once", async () => {
    const pending = readVinPhoto(photo());
    image.onload?.();
    expect(await pending).toBe(VIN);
    expect(draw).toHaveBeenCalledWith(image, 0, 0, 2048, 1024);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:synthetic");
    expect(generate).toHaveBeenCalledOnce();
    expect(generate.mock.calls[0][0]).toMatchObject({
      model: TASKS.vision_review.primary,
      task: "vision_review",
      generationConfig: TASKS.vision_review.params,
      requestAuthEpoch: 1,
    });
    expect(generate.mock.calls[0][0].systemInstruction.parts[0].text).toContain(
      "Do not invent",
    );
  });
  it("accepts a decodable camera JPG with no MIME metadata", async () => {
    const pending = readVinPhoto(new File(["synthetic"], "label.JPG"));
    image.onload?.();
    expect(await pending).toBe(VIN);
  });
  it("returns retake guidance for an invalid OCR result without lookup or fallback generation", async () => {
    generate.mockResolvedValue({ text: () => "UNREADABLE" });
    const pending = readVinPhoto(photo());
    image.onload?.();
    await expect(pending).rejects.toThrow("Retake");
    expect(generate).toHaveBeenCalledOnce();
  });
  it("bounds a stalled OCR request and cleans its deadline", async () => {
    vi.useFakeTimers();
    generate.mockImplementation(
      ({ signal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason)),
        ),
    );
    const pending = readVinPhoto(photo());
    image.onload?.();
    const rejected = expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(30000);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
  it("aborts image intake and never sends it", async () => {
    const controller = new AbortController();
    const pending = readVinPhoto(photo(), controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejected;
    expect(image.src).toBe("");
    expect(URL.revokeObjectURL).toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });
  it("rejects an unsupported, failed, or oversized photo without an AI request", async () => {
    await expect(
      prepareVinPhoto(new File(["text"], "label.txt", { type: "text/plain" })),
    ).rejects.toThrow("Choose a photo");
    const oversized = photo();
    Object.defineProperty(oversized, "size", { value: 21 * 1024 * 1024 });
    await expect(readVinPhoto(oversized)).rejects.toThrow("Choose a photo");
    const pending = readVinPhoto(photo());
    image.onerror?.();
    await expect(pending).rejects.toThrow("could not open");
    expect(generate).not.toHaveBeenCalled();
  });
  it("propagates cancellation to OCR and discards a late model response", async () => {
    let finish!: (result: { text: () => string }) => void;
    generate.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const controller = new AbortController();
    const pending = readVinPhoto(photo(), controller.signal);
    image.onload?.();
    await Promise.resolve();
    await Promise.resolve();
    const requestSignal = generate.mock.calls[0][0].signal;
    controller.abort();
    finish({ text: () => VIN });
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(requestSignal.aborted).toBe(true);
  });
  it("rejects a response when the signed-in workspace changes", async () => {
    generate.mockImplementation(async () => {
      setActiveAuthEpoch(2);
      return { text: () => VIN };
    });
    const pending = readVinPhoto(photo());
    image.onload?.();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
