import { FilesetResolver, InteractiveSegmenter } from "@mediapipe/tasks-vision";

interface SegmentRequest {
  frames: Blob[];
  points: { x: number; y: number; remove?: boolean }[];
  origin: string;
}

self.onmessage = async (event: MessageEvent<SegmentRequest>) => {
  let segmenter: InteractiveSegmenter | undefined;
  try {
    const { frames, points, origin } = event.data;
    const assets = new URL("/vehicle-spin-v1", origin).href;
    const files = await FilesetResolver.forVisionTasks(assets, true);
    segmenter = await InteractiveSegmenter.createFromOptions(files, {
      baseOptions: {
        modelAssetPath: assets + "/interactive_segmentation.task",
        delegate: "CPU",
      },
    });
    for (let index = 0; index < frames.length; index++) {
      const bitmap = await createImageBitmap(frames[index]);
      let mask: ReturnType<InteractiveSegmenter["segment"]> | undefined;
      try {
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Your browser cannot edit vehicle backgrounds.");
        context.drawImage(bitmap, 0, 0);
        segmenter.setImage(bitmap);
        mask = segmenter.segment(
          points.map(({ x, y, remove }) => ({
            // MediaPipe 1.1.0 omits BrushMode from its runtime exports.
            brushMode: remove ? 2 : 1,
            point: [{ x, y }],
            isCompleted: true,
          })),
        );
        const confidence = mask.getAsFloat32Array();
        const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
        let kept = 0;
        for (let y = 0; y < bitmap.height; y++) {
          for (let x = 0; x < bitmap.width; x++) {
            const score =
              confidence[
                Math.min(
                  mask.height - 1,
                  Math.floor((y * mask.height) / bitmap.height),
                ) *
                  mask.width +
                  Math.min(mask.width - 1, Math.floor((x * mask.width) / bitmap.width))
              ];
            const alpha = Math.round(
              Math.max(0, Math.min(1, (score - 0.35) / 0.3)) * 255,
            );
            pixels.data[(y * bitmap.width + x) * 4 + 3] = alpha;
            if (alpha > 127) kept++;
          }
        }
        const coverage = kept / (bitmap.width * bitmap.height);
        if (coverage < 0.04 || coverage > 0.94)
          throw new Error(
            "The vehicle could not be separated at angle " +
              (index + 1) +
              ". Try a different point on the vehicle or keep the original background.",
          );
        context.putImageData(pixels, 0, 0);
        const blob = await canvas.convertToBlob({ type: "image/png" });
        self.postMessage({ kind: "frame", index, blob });
      } finally {
        mask?.close();
        bitmap.close();
      }
    }
    self.postMessage({ kind: "complete" });
  } catch (error) {
    self.postMessage({
      kind: "error",
      message:
        error instanceof Error
          ? error.message
          : "Vehicle background processing failed.",
    });
  } finally {
    segmenter?.close();
  }
};
