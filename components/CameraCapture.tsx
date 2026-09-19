import React, { useState, useRef, useEffect, useCallback, memo } from "react";
import { Camera, Upload } from "lucide-react";
import { fileToNormalizedDataUrl } from "../utils/imageUtils";
import { WebcamCapture } from "./WebcamCapture";
import { triggerHapticFeedback } from "../utils/haptics";
import { toUiMessage } from "../utils/errorMessages";
import { Button } from "./ui/Button";
import { ErrorBanner } from "./ui/ErrorBanner";
import { useAppStore } from "../stores/appStore";
import { RecentCaptureShelf } from "./RecentCaptureShelf";
import type { ImageSelection } from "../types";

interface ImageInputProps {
  onImageSelected: (selection: ImageSelection) => void;
}

const isMobileDevice = () => {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent,
  );
};

export const ImageInput: React.FC<ImageInputProps> = memo(({ onImageSelected }) => {
  const dealerId = useAppStore((state) => state.currentDealer?.id || "");
  const [error, setError] = useState<string | null>(null);
  const [showWebcam, setShowWebcam] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      processFile(file);
    }
    event.target.value = "";
  };

  const processFile = useCallback(
    async (file: File) => {
      const hasImageExtension = /\.(?:avif|heic|heif|jpe?g|png|webp)$/i.test(file.name);
      if (!file.type.startsWith("image/") && !hasImageExtension) {
        setError("Invalid file type. Please use an image file.");
        return;
      }

      // Keep uploads within a mobile-safe envelope before decoding.
      const maxSizeInBytes = 12 * 1024 * 1024;
      if (file.size > maxSizeInBytes) {
        setError("That photo is too large. Choose an image smaller than 12 MB.");
        return;
      }

      try {
        setError(null);
        setIsProcessing(true);

        // Process and normalize orientation - this handles EXIF rotation
        const dataUrl = await fileToNormalizedDataUrl(file);

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
    [onImageSelected],
  );

  const handleOpenCamera = () => {
    triggerHapticFeedback();
    if (isMobileDevice()) {
      // Open native camera with full controls - user can switch cameras within the app
      if (cameraInputRef.current) {
        cameraInputRef.current.click();
      }
    } else {
      setShowWebcam(true);
    }
  };

  const handleUploadPhoto = () => {
    triggerHapticFeedback();
    fileInputRef.current?.click();
  };

  useEffect(() => {
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
        processFile(file);
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
  }, [processFile]);

  if (showWebcam) {
    return (
      <WebcamCapture
        onImageSelected={(imageSrc) => {
          setShowWebcam(false);
          onImageSelected({
            workingImage: imageSrc,
            originalSource: imageSrc,
            originalFilename: `dealer-photo-${new Date()
              .toISOString()
              .slice(0, 10)}.jpg`,
          });
        }}
        onClose={() => setShowWebcam(false)}
      />
    );
  }

  return (
    <div className="flex-1 w-full py-2 sm:py-5">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/*"
        className="hidden"
        aria-label="Upload photo from your device"
      />
      <input
        type="file"
        ref={cameraInputRef}
        onChange={handleFileChange}
        accept="image/*"
        capture="environment"
        className="hidden"
        aria-label="Take photo using device camera"
      />

      <div className="capture-intro mb-5 flex flex-col gap-4 lg:mb-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <h1 className="font-display text-3xl font-semibold text-ink sm:text-4xl">
            Start with a photo
          </h1>
          <p className="capture-intro-copy mt-3 max-w-[64ch] text-base text-ink-2">
            Take a new photo or choose one from your device. You&apos;ll review it
            before anything is created.
          </p>
        </div>
      </div>

      {/* Recoverable problems (wrong file type, oversized photo) surface here
          without unmounting the studio — the capture buttons stay reachable
          and picking another file clears the message via processFile. */}
      {error && (
        <ErrorBanner
          message={error}
          onRetry={() => {
            triggerHapticFeedback();
            setError(null);
          }}
          className="mb-4 text-sm"
        />
      )}

      <div className="capture-studio-grid flex flex-col gap-4 sm:grid sm:min-h-[480px] sm:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.65fr)] lg:min-h-[540px] lg:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.7fr)]">
        <aside className="capture-studio-sidebar flex flex-col sm:col-start-2 sm:row-start-1">
          <div className="space-y-3">
            <Button
              onClick={handleOpenCamera}
              disabled={isProcessing}
              variant="primary"
              fullWidth
              size="lg"
              leftIcon={<Camera className="h-5 w-5" />}
            >
              Take photo
            </Button>
            <Button
              onClick={handleUploadPhoto}
              disabled={isProcessing}
              variant="secondary"
              fullWidth
              size="lg"
              leftIcon={<Upload className="h-5 w-5" />}
            >
              Choose from device
            </Button>
          </div>

          <div className="capture-studio-tips mt-6 hidden border-t border-hairline pt-6 sm:block">
            <ul className="space-y-2 text-caption text-ink-2">
              <li>Keep the customer and the vehicle fully in frame.</li>
              <li>Avoid backlight and visible paperwork.</li>
              <li>You&apos;ll review the photo before anything is created.</li>
            </ul>
          </div>
        </aside>
        <section
          className={`capture-studio-preview table-lit relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg border border-hairline p-4 transition-colors sm:col-start-1 sm:row-start-1 sm:aspect-[3/2] sm:p-5 lg:p-6 ${
            isDraggingOver ? "border-strong" : ""
          }`}
          aria-label="Photo preview area"
        >
          {isProcessing && (
            <div
              className="absolute inset-0 z-20 grid place-items-center bg-panel/90"
              role="status"
              aria-live="polite"
            >
              <div className="text-center">
                <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-strong border-t-brand-ink" />
                <p className="mt-4 text-base font-medium text-ink">
                  Preparing your photo…
                </p>
              </div>
            </div>
          )}

          {isDraggingOver && (
            <div className="pointer-events-none absolute inset-4 z-10 grid place-items-center rounded-lg border-2 border-dashed border-strong bg-panel/90">
              <div className="text-center">
                <Upload className="mx-auto h-10 w-10 text-ink-3" aria-hidden="true" />
                <p className="mt-3 text-lg font-semibold text-ink">Drop a photo here</p>
              </div>
            </div>
          )}

          <div className="relative max-w-sm text-center">
            <Camera className="mx-auto h-8 w-8 text-ink-3" aria-hidden="true" />
            <p className="mt-4 text-base font-medium text-ink">Add a photo to start</p>
          </div>
        </section>
      </div>
      {dealerId ? (
        <RecentCaptureShelf dealerId={dealerId} onSelect={onImageSelected} />
      ) : null}
    </div>
  );
});
