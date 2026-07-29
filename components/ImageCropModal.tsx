import React, { useEffect, useRef, useState } from "react";
import {
  Check,
  CheckCircle2,
  Download,
  ImageIcon,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { triggerHapticFeedback } from "../utils/haptics";
import { Modal } from "./ui/Modal";
import {
  isMobilePhotoDevice,
  prepareMediaForSave,
  savePreparedMediaToLibrary,
  saveResultToastMessage,
  type PreparedMediaSave,
} from "../utils/mediaSave";
import { useToast } from "./ui/Toast";

interface ImageCropModalProps {
  isOpen: boolean;
  imageSrc: string | null;
  originalSource?: string | Blob | null;
  originalFilename?: string;
  onConfirm: (croppedImage: string) => void;
  onClose: () => void;
  originalBackupStatus?: "idle" | "saving" | "saved" | "unavailable";
}

export const MAX_EXPORT_DIMENSION = 2048;
const JPEG_EXPORT_QUALITY = 0.9;

export const constrainImageDimensions = (
  width: number,
  height: number,
  maxDimension = MAX_EXPORT_DIMENSION,
) => {
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

/**
 * Legacy component name retained to avoid changing the app controller. This is
 * the single authoritative photo review surface for every capture source.
 */
export const ImageCropModal: React.FC<ImageCropModalProps> = ({
  isOpen,
  imageSrc,
  originalSource,
  originalFilename,
  onConfirm,
  onClose,
  originalBackupStatus = "idle",
}) => {
  const toast = useToast();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [loadedImageSrc, setLoadedImageSrc] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [reviewError, setReviewError] = useState<{
    imageSrc: string;
    message: string;
  } | null>(null);
  const [preparedOriginal, setPreparedOriginal] = useState<PreparedMediaSave | null>(
    null,
  );
  const [isPreparingOriginal, setIsPreparingOriginal] = useState(false);
  const [isSavingOriginal, setIsSavingOriginal] = useState(false);

  const isImageReady = Boolean(isOpen && imageSrc && loadedImageSrc === imageSrc);
  const previewError = reviewError?.imageSrc === imageSrc ? reviewError.message : null;

  useEffect(() => {
    if (!isOpen) setIsExporting(false);
  }, [isOpen]);

  useEffect(() => {
    let active = true;
    setPreparedOriginal(null);
    if (!isOpen || !imageSrc) {
      setIsPreparingOriginal(false);
      return;
    }
    setIsPreparingOriginal(true);
    void prepareMediaForSave({
      sourceUrl: originalSource || imageSrc,
      kind: "image",
      basename:
        originalFilename ||
        `dealer-photo-original-${new Date().toISOString().slice(0, 10)}`,
    })
      .then((prepared) => {
        if (active) setPreparedOriginal(prepared);
      })
      .catch(() => {
        if (active) setPreparedOriginal(null);
      })
      .finally(() => {
        if (active) setIsPreparingOriginal(false);
      });
    return () => {
      active = false;
    };
  }, [imageSrc, isOpen, originalFilename, originalSource]);

  const handleSaveOriginal = async () => {
    triggerHapticFeedback();
    if (!preparedOriginal || isSavingOriginal) return;
    setIsSavingOriginal(true);
    try {
      // Prepared before this click so WebKit receives navigator.share() during
      // the fresh user activation.
      const result = await savePreparedMediaToLibrary(preparedOriginal);
      if (result.method === "error") {
        toast.error(saveResultToastMessage(result));
      } else if (result.method === "cancelled") {
        toast.warning(saveResultToastMessage(result));
      } else {
        toast.success(saveResultToastMessage(result));
      }
    } finally {
      setIsSavingOriginal(false);
    }
  };

  const handleConfirm = async () => {
    triggerHapticFeedback();

    const image = imageRef.current;
    const canvas = canvasRef.current;
    if (!imageSrc || !image || !canvas || !isImageReady || isExporting) return;

    setIsExporting(true);
    setReviewError(null);

    try {
      if (typeof image.decode === "function") {
        await image.decode().catch(() => undefined);
      }

      if (!image.naturalWidth || !image.naturalHeight) {
        throw new Error("The selected photo has not finished loading.");
      }

      const dimensions = constrainImageDimensions(
        image.naturalWidth,
        image.naturalHeight,
      );
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Photo processing is unavailable in this browser.");
      }

      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, dimensions.width, dimensions.height);
      context.drawImage(image, 0, 0, dimensions.width, dimensions.height);

      onConfirm(canvas.toDataURL("image/jpeg", JPEG_EXPORT_QUALITY));
    } catch (error) {
      setReviewError({
        imageSrc,
        message:
          error instanceof Error
            ? error.message
            : "This photo could not be prepared. Choose another photo and try again.",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleChooseAnother = () => {
    triggerHapticFeedback();
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen && Boolean(imageSrc)}
      onClose={onClose}
      title="Review photo"
      description="Check the framing before creating the post. The original aspect ratio is preserved."
      size="xl"
      className="bg-[#0b1017]"
      footer={
        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-[auto_1fr_auto] sm:items-center">
          <button
            type="button"
            onClick={handleChooseAnother}
            disabled={isExporting}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-5 py-3 text-sm font-semibold text-surface-100 transition-colors hover:border-white/25 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Choose another
          </button>
          <button
            type="button"
            onClick={() => void handleSaveOriginal()}
            disabled={!preparedOriginal || isPreparingOriginal || isSavingOriginal}
            aria-busy={isPreparingOriginal || isSavingOriginal}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-success-400/30 bg-success-500/10 px-5 py-3 text-sm font-semibold text-success-100 transition-colors hover:border-success-300/50 hover:bg-success-500/15 disabled:cursor-not-allowed disabled:opacity-50 sm:justify-self-center"
          >
            {isPreparingOriginal || isSavingOriginal ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="h-4 w-4" aria-hidden="true" />
            )}
            {isPreparingOriginal
              ? "Preparing original"
              : isSavingOriginal
                ? "Opening Photos"
                : isMobilePhotoDevice()
                  ? "Save original to Photos"
                  : "Download original"}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!isImageReady || isExporting || Boolean(previewError)}
            aria-busy={isExporting}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-black/20 transition-colors hover:bg-primary-500 disabled:cursor-not-allowed disabled:bg-surface-700 disabled:text-surface-400"
          >
            {isExporting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Check className="h-4 w-4" aria-hidden="true" />
            )}
            {isExporting ? "Preparing photo" : "Use photo"}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="relative flex min-h-[16rem] items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black sm:min-h-[24rem]">
          {imageSrc && (
            <img
              ref={imageRef}
              src={imageSrc}
              alt="Selected vehicle photo preview"
              className="max-h-[58vh] w-full object-contain"
              decoding="async"
              onLoad={() => {
                setLoadedImageSrc(imageSrc);
                setReviewError(null);
              }}
              onError={() => {
                setLoadedImageSrc(null);
                setReviewError({
                  imageSrc,
                  message:
                    "This photo could not be displayed. Choose another photo and try again.",
                });
              }}
            />
          )}

          {!isImageReady && !previewError && (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/75 text-surface-300"
              role="status"
            >
              <Loader2 className="h-7 w-7 animate-spin" aria-hidden="true" />
              <span className="text-sm font-medium">Loading photo</span>
            </div>
          )}

          {/* Framing rails echo platform-safe crop guides without applying a crop. */}
          <div className="pointer-events-none absolute inset-4" aria-hidden="true">
            <span className="absolute left-0 top-0 h-8 w-8 border-l-2 border-t-2 border-white/70" />
            <span className="absolute right-0 top-0 h-8 w-8 border-r-2 border-t-2 border-white/70" />
            <span className="absolute bottom-0 left-0 h-8 w-8 border-b-2 border-l-2 border-white/70" />
            <span className="absolute bottom-0 right-0 h-8 w-8 border-b-2 border-r-2 border-white/70" />
          </div>
        </div>

        {previewError ? (
          <p
            className="flex items-start gap-2 rounded-xl border border-error-500/30 bg-error-500/10 px-4 py-3 text-sm text-error-200"
            role="alert"
          >
            <ImageIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {previewError}
          </p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-surface-400">
            <span>Original ratio retained · working copy max 2048 px</span>
            <span
              className={
                originalBackupStatus === "saved"
                  ? "inline-flex items-center gap-1.5 font-semibold text-success-300"
                  : "text-surface-400"
              }
              role="status"
            >
              {originalBackupStatus === "saving" ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  Backing up original in app…
                </>
              ) : originalBackupStatus === "saved" ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Original backed up in app
                </>
              ) : originalBackupStatus === "unavailable" ? (
                "Local backup unavailable — use Save original"
              ) : (
                "Use Save original for your Photos library"
              )}
            </span>
          </div>
        )}

        <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
      </div>
    </Modal>
  );
};
