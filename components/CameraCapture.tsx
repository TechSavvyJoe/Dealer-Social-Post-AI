import React, { useState, useRef, useEffect, useCallback, memo } from "react";
import { Camera, Upload } from "lucide-react";
import { fileToNormalizedDataUrl } from "../utils/imageUtils";
import { WebcamCapture } from "./WebcamCapture";
import { triggerHapticFeedback } from "../utils/haptics";
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
        setError(
          /HEI[CF]/i.test(message)
            ? message
            : "Could not read the selected image file. Please try again.",
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
          <div className="mb-3 flex items-center gap-3 text-xs font-semibold tracking-[0.14em] text-primary-300">
            <span className="h-px w-10 bg-primary-400" aria-hidden="true" />
            SHOWROOM STUDIO
          </div>
          <h1 className="text-3xl font-semibold tracking-[-0.035em] text-surface-50 sm:text-5xl">
            Capture the handoff.
          </h1>
          <p className="capture-intro-copy mt-3 max-w-xl text-sm leading-6 text-surface-300 sm:text-base">
            Start with one clear customer or vehicle photo. We’ll prepare the framing,
            caption, and channel-ready creative next.
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

      <div className="capture-studio-grid grid min-h-0 overflow-hidden rounded-[1.5rem] border border-hairline bg-surface-900 shadow-2xl shadow-black/25 sm:min-h-[480px] sm:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.65fr)] lg:min-h-[540px] lg:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.7fr)] lg:rounded-[1.75rem]">
        <aside className="capture-studio-sidebar flex flex-col justify-between bg-surface-900 p-4 sm:col-start-2 sm:row-start-1 sm:p-6 lg:p-10">
          <div>
            <span className="text-xs font-semibold tracking-[0.14em] text-primary-300">
              PHOTO SOURCE
            </span>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-surface-50">
              Add a photo
            </h2>
            <p className="mt-2 text-sm leading-6 text-surface-300">
              Use the rear camera for a new handoff, or select an existing photo.
            </p>

            <div className="mt-7 space-y-3">
              <Button
                onClick={handleOpenCamera}
                disabled={isProcessing}
                fullWidth
                size="lg"
                leftIcon={<Camera className="h-5 w-5" />}
              >
                Take photo
              </Button>
              <Button
                onClick={handleUploadPhoto}
                disabled={isProcessing}
                variant="outline"
                fullWidth
                size="lg"
                leftIcon={<Upload className="h-5 w-5" />}
              >
                Choose from device
              </Button>
            </div>
          </div>

          <div className="capture-studio-tips mt-8 hidden border-t border-hairline pt-6 sm:block">
            <p className="text-xs font-semibold text-surface-200">
              For the cleanest result
            </p>
            <ul className="mt-3 space-y-2 text-sm text-surface-400">
              <li>Keep faces and the vehicle fully in frame.</li>
              <li>Avoid harsh backlight and visible paperwork.</li>
              <li>You’ll review the photo before anything is generated.</li>
              <li>* HEIC opens when the current device/browser supports it.</li>
            </ul>
          </div>
        </aside>

        <section
          className={`capture-studio-preview relative flex min-h-[260px] items-center justify-center overflow-hidden border-t border-hairline bg-surface-950 p-4 transition-colors sm:col-start-1 sm:row-start-1 sm:min-h-[480px] sm:border-r sm:border-t-0 sm:p-5 lg:min-h-[640px] lg:p-6 ${
            isDraggingOver ? "border-primary-400 bg-primary-950/30" : ""
          }`}
          aria-label="Photo drop zone"
        >
          {isProcessing && (
            <div
              className="absolute inset-0 z-20 grid place-items-center bg-surface-950/90"
              role="status"
              aria-live="polite"
            >
              <div className="text-center">
                <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-strong border-t-primary-300" />
                <p className="mt-4 font-medium text-surface-50">
                  Preparing your photo…
                </p>
              </div>
            </div>
          )}

          {isDraggingOver && (
            <div className="absolute inset-4 z-10 grid place-items-center rounded-2xl border-2 border-dashed border-primary-300 bg-primary-950/85 pointer-events-none">
              <div className="text-center">
                <Upload className="mx-auto h-10 w-10 text-primary-200" />
                <p className="mt-3 text-lg font-semibold text-white">Drop image here</p>
              </div>
            </div>
          )}

          <div className="absolute left-6 right-6 top-6 flex items-center justify-between text-[11px] font-medium tracking-[0.12em] text-surface-400">
            <span>MEDIA BAY 01</span>
            <span>JPG · PNG · WEBP · HEIC*</span>
          </div>

          <div
            className="absolute inset-x-[8%] top-[42%] h-px bg-primary-300/55 shadow-[0_0_22px_rgba(96,165,250,0.7)]"
            aria-hidden="true"
          />
          <div className="relative max-w-sm text-center">
            <div className="mx-auto grid h-20 w-20 place-items-center rounded-full border border-strong bg-fill-subtle shadow-[0_20px_70px_rgba(0,0,0,0.5)]">
              <Camera className="h-8 w-8 text-primary-200" />
            </div>
            <p className="mt-6 text-xl font-semibold tracking-tight text-surface-50">
              Ready for the delivery moment
            </p>
            <p className="mt-2 text-sm leading-6 text-surface-400">
              Drag a photo anywhere onto this studio, or choose a source from the panel.
            </p>
          </div>
        </section>
      </div>
      {dealerId ? (
        <RecentCaptureShelf dealerId={dealerId} onSelect={onImageSelected} />
      ) : null}
    </div>
  );
});
