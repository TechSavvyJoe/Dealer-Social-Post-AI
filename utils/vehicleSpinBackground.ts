import { canvasJpeg, checkSpinAbort, type SpinBackground } from "./vehicleSpin";

export interface SpinSelectionPoint {
  x: number;
  y: number;
  remove?: boolean;
}

export const segmentSpinVehicle = (
  frames: Blob[],
  points: SpinSelectionPoint[],
  options: { signal: AbortSignal; onProgress: (fraction: number) => void },
): Promise<Blob[]> =>
  new Promise((resolve, reject) => {
    checkSpinAbort(options.signal);
    const worker = new Worker(new URL("./vehicleSpin.worker.ts", import.meta.url), {
      type: "module",
    });
    const result: Blob[] = [];
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      options.signal.removeEventListener("abort", aborted);
      worker.terminate();
      if (error) reject(error);
      else resolve(result);
    };
    const aborted = () =>
      finish(new DOMException("Processing cancelled", "AbortError"));
    const timeout = setTimeout(
      () =>
        finish(
          new Error(
            "Background editing took too long. Keep the original background or retry on a computer.",
          ),
        ),
      10 * 60 * 1000,
    );
    options.signal.addEventListener("abort", aborted, { once: true });
    worker.onerror = () =>
      finish(
        new Error(
          "Background editing is unavailable in this browser. Your original frames are safe.",
        ),
      );
    worker.onmessage = (
      event: MessageEvent<{ kind: string; index: number; blob: Blob; message: string }>,
    ) => {
      const data = event.data;
      if (data.kind === "frame") {
        result[data.index] = data.blob;
        options.onProgress((data.index + 1) / frames.length);
      } else if (data.kind === "complete") {
        if (result.length !== frames.length || result.some((frame) => !frame))
          finish(
            new Error(
              "Some angles were not processed. Retry with the original background.",
            ),
          );
        else finish();
      } else if (data.kind === "error") finish(new Error(data.message));
    };
    worker.postMessage({ frames, points, origin: location.origin });
  });

export const composeSpinFrames = async (
  originals: Blob[],
  cutouts: Blob[] | null,
  background: SpinBackground,
  custom: Blob | null,
  signal: AbortSignal,
): Promise<Blob[]> => {
  if (background === "original") return originals;
  if (!cutouts || cutouts.length !== originals.length)
    throw new Error("Separate the vehicle before choosing a studio background.");
  if (background === "custom" && !custom) throw new Error("Choose a background image.");
  const backdrop =
    custom && background === "custom" ? await createImageBitmap(custom) : null;
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Background editor unavailable.");
    const output: Blob[] = [];
    for (const frame of cutouts) {
      checkSpinAbort(signal);
      const image = await createImageBitmap(frame);
      try {
        canvas.width = image.width;
        canvas.height = image.height;
        const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
        gradient.addColorStop(0, background === "pearl" ? "#f2f3f5" : "#303642");
        gradient.addColorStop(1, background === "pearl" ? "#b5beca" : "#090c11");
        context.fillStyle = gradient;
        context.fillRect(0, 0, canvas.width, canvas.height);
        if (backdrop) {
          const scale = Math.max(
            canvas.width / backdrop.width,
            canvas.height / backdrop.height,
          );
          context.drawImage(
            backdrop,
            (canvas.width - backdrop.width * scale) / 2,
            (canvas.height - backdrop.height * scale) / 2,
            backdrop.width * scale,
            backdrop.height * scale,
          );
        }
        // A soft contact shadow keeps the cutout grounded without repainting it.
        const maskCanvas = document.createElement("canvas");
        maskCanvas.width = image.width;
        maskCanvas.height = image.height;
        const maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });
        if (maskContext) {
          maskContext.drawImage(image, 0, 0);
          const pixels = maskContext.getImageData(0, 0, image.width, image.height).data;
          let left = image.width,
            right = 0,
            bottom = 0;
          for (let y = 0; y < image.height; y += 3) {
            for (let x = 0; x < image.width; x += 3) {
              if (pixels[(y * image.width + x) * 4 + 3] > 180) {
                left = Math.min(left, x);
                right = Math.max(right, x);
                bottom = Math.max(bottom, y);
              }
            }
          }
          if (right > left) {
            context.save();
            context.filter = "blur(" + Math.max(4, image.height * 0.015) + "px)";
            context.fillStyle = "rgba(0,0,0,0.34)";
            context.beginPath();
            context.ellipse(
              (left + right) / 2,
              bottom,
              (right - left) * 0.44,
              image.height * 0.024,
              0,
              0,
              Math.PI * 2,
            );
            context.fill();
            context.restore();
          }
        }
        context.drawImage(image, 0, 0);
        let blob = await canvasJpeg(canvas);
        if (blob.size > 450000) blob = await canvasJpeg(canvas, 0.65);
        if (blob.size > 500000) throw new Error("Choose a simpler background image.");
        output.push(blob);
      } finally {
        image.close();
      }
    }
    return output;
  } finally {
    backdrop?.close();
  }
};
