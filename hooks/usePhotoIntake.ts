import { useCallback, useEffect, useState } from "react";
import { fileToNormalizedDataUrl } from "../utils/imageUtils";
import { toUiMessage } from "../utils/errorMessages";
import type { ImageSelection } from "../types";

/**
 * Canvas re-encode target. Mirrors ImageCropModal's constrainImageDimensions
 * (MAX_EXPORT_DIMENSION) and JPEG_EXPORT_QUALITY — the single downstream
 * review/crop surface applies the same cap and quality today, so re-running
 * it here on an already-capped JPEG is a no-op. Kept as a local copy rather
 * than an import so this hook has no dependency on a UI component.
 */
const MAX_EXPORT_DIMENSION = 2048;
const JPEG_EXPORT_QUALITY = 0.9;

const constrainDimensions = (width: number, height: number) => {
  const scale = Math.min(1, MAX_EXPORT_DIMENSION / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

/**
 * Curated error for the opt-in flatten path (see `flattenToJpeg` below). A
 * PNG with alpha must never reach onImageSelected — so unlike a decode
 * failure elsewhere in this hook, this path fails CLOSED: it throws instead
 * of handing the untouched PNG back to the caller. `toUiMessage` treats a
 * plain Error's message as already-curated copy, so the message here is
 * exactly what the user sees.
 */
class PhotoFlattenError extends Error {}

/**
 * fileToNormalizedDataUrl preserves a PNG source as PNG (with alpha) once
 * it is already under the 2048px cap. Only called when the caller opts in
 * (`flattenToJpeg: true`) — the PNG is flattened onto white and re-encoded
 * as JPEG so a screenshot or graphic with transparency never reaches the
 * provider, IndexedDB or the persisted session as PNG+alpha. Every other
 * format is already JPEG by the time it leaves fileToNormalizedDataUrl, so
 * this is a no-op for the overwhelming majority of captures (real camera
 * photos). Any failure here — no 2D canvas context, or the image failing to
 * decode — throws rather than silently forwarding the PNG (fail closed).
 */
const flattenPngToJpeg = async (dataUrl: string): Promise<string> => {
  if (!/^data:image\/png/i.test(dataUrl)) return dataUrl;

  const probe =
    typeof document === "undefined"
      ? null
      : document.createElement("canvas").getContext("2d");
  if (!probe) {
    throw new PhotoFlattenError(
      "This photo could not be prepared. Choose another photo and try again.",
    );
  }

  let image: HTMLImageElement;
  try {
    image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("decode failed"));
      img.src = dataUrl;
    });
  } catch {
    throw new PhotoFlattenError(
      "This photo could not be prepared. Choose another photo and try again.",
    );
  }

  const { width, height } = constrainDimensions(
    image.naturalWidth || image.width,
    image.naturalHeight || image.height,
  );
  if (!width || !height) {
    throw new PhotoFlattenError(
      "This photo could not be prepared. Choose another photo and try again.",
    );
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new PhotoFlattenError(
      "This photo could not be prepared. Choose another photo and try again.",
    );
  }

  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", JPEG_EXPORT_QUALITY);
};

const hasImageExtension = (filename: string) =>
  /\.(?:avif|heic|heif|jpe?g|png|webp)$/i.test(filename);

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

export interface UsePhotoIntakeOptions {
  /** Called with the normalized selection once a file has been processed. */
  onImageSelected: (selection: ImageSelection) => void;
  /**
   * Window-level drag-and-drop listeners. Defaults to on, matching the
   * capture screen's current behavior. A caller with its own drop target
   * (or none) can opt out.
   */
  enableDrop?: boolean;
  /**
   * Flatten a PNG onto white and re-encode it as JPEG (capped at
   * MAX_EXPORT_DIMENSION) before handing the selection to onImageSelected.
   * Off by default: CameraCapture's existing path hands the picked photo to
   * ImageCropModal, which already does this flatten/cap/encode on confirm —
   * doing it twice here would double-compress and change what the review
   * screen shows (a JPEG-on-white instead of the original PNG). A caller
   * that skips ImageCropModal (no downstream flatten) opts in.
   */
  flattenToJpeg?: boolean;
}

export interface UsePhotoIntakeResult {
  error: string | null;
  setError: (error: string | null) => void;
  isProcessing: boolean;
  isDraggingOver: boolean;
  processFile: (file: File) => Promise<void>;
}

/**
 * Validates, EXIF-normalizes and (for PNG) flattens a picked/dropped/dragged
 * photo File into an ImageSelection, with the curated copy for invalid type,
 * oversize and HEIC/HEIF failures. Extracted from CameraCapture.tsx so the
 * intake pipeline has one home; CameraCapture is now a thin consumer.
 */
export function usePhotoIntake({
  onImageSelected,
  enableDrop = true,
  flattenToJpeg = false,
}: UsePhotoIntakeOptions): UsePhotoIntakeResult {
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const processFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/") && !hasImageExtension(file.name)) {
        setError("Invalid file type. Please use an image file.");
        return;
      }

      // Keep uploads within a mobile-safe envelope before decoding.
      if (file.size > MAX_UPLOAD_BYTES) {
        setError("That photo is too large. Choose an image smaller than 12 MB.");
        return;
      }

      try {
        setError(null);
        setIsProcessing(true);

        // Process and normalize orientation - this handles EXIF rotation
        const normalized = await fileToNormalizedDataUrl(file);
        const dataUrl = flattenToJpeg ? await flattenPngToJpeg(normalized) : normalized;

        // The global crop/review dialog is the single review surface for every
        // source. Calling it directly avoids two sequential confirmation steps.
        onImageSelected({
          workingImage: dataUrl,
          originalSource: file,
          originalFilename: file.name,
        });
      } catch (err) {
        console.error("Error reading file:", err);
        const message = err instanceof Error ? err.message : "";
        // HEIC/HEIF gets its own curated copy rather than the raw decoder
        // message, which named the unsupported MIME type, not a next step.
        setError(
          /HEI[CF]/i.test(message)
            ? "This photo is in Apple's HEIC/HEIF format, which this browser cannot read. Take the photo again with 'Most Compatible' format enabled, or use a JPEG/PNG."
            : toUiMessage(
                err,
                "Could not read the selected image file. Please try again.",
              ),
        );
      } finally {
        setIsProcessing(false);
      }
    },
    [onImageSelected, flattenToJpeg],
  );

  useEffect(() => {
    if (!enableDrop) return;

    const handleWindowDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingOver(true);
    };

    const handleWindowDragEnter = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer?.items && e.dataTransfer.items.length > 0) {
        setIsDraggingOver(true);
      }
    };

    const handleWindowDragLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // Only disable if we are leaving the window (clientX/Y are 0 or outside bounds)
      // or if relatedTarget is null (meaning we left the document)
      if (e.clientX === 0 || e.clientY === 0) {
        setIsDraggingOver(false);
      }
    };

    const handleWindowDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingOver(false);

      const file = e.dataTransfer?.files?.[0];
      if (file) {
        void processFile(file);
      }
    };

    window.addEventListener("dragover", handleWindowDragOver);
    window.addEventListener("dragenter", handleWindowDragEnter);
    window.addEventListener("dragleave", handleWindowDragLeave);
    window.addEventListener("drop", handleWindowDrop);

    return () => {
      window.removeEventListener("dragover", handleWindowDragOver);
      window.removeEventListener("dragenter", handleWindowDragEnter);
      window.removeEventListener("dragleave", handleWindowDragLeave);
      window.removeEventListener("drop", handleWindowDrop);
    };
  }, [enableDrop, processFile]);

  return { error, setError, isProcessing, isDraggingOver, processFile };
}
