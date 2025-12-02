import React, { useState, useRef, useEffect, useCallback, memo } from "react";
import { Icon } from "./Icons";
import { fileToNormalizedDataUrl } from "../utils/imageUtils";
import { WebcamCapture } from "./WebcamCapture";
import { triggerHapticFeedback } from "../utils/haptics";
import { ImagePreviewModal } from "./ImagePreviewModal";

interface ImageInputProps {
  onImageSelected: (imageSrc: string) => void;
  onClose: () => void;
}

const isMobileDevice = () => {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
};

export const ImageInput: React.FC<ImageInputProps> = memo(({
  onImageSelected,
  onClose,
}) => {
  const [error, setError] = useState<string | null>(null);
  const [showWebcam, setShowWebcam] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [lastSource, setLastSource] = useState<
    "upload" | "camera-mobile" | "camera-webcam" | null
  >(null);

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (file) {
      const source: "upload" | "camera-mobile" =
        event.target === cameraInputRef.current ? "camera-mobile" : "upload";
      processFile(file, source);
    }
    event.target.value = "";
  };

  const processFile = useCallback(
    async (file: File, source: "upload" | "camera-mobile") => {
      if (!file.type.startsWith("image/")) {
        setError("Invalid file type. Please use an image file.");
        return;
      }

      // Validate file size (max 20MB)
      const maxSizeInBytes = 20 * 1024 * 1024;
      if (file.size > maxSizeInBytes) {
        setError(
          "Image file is too large. Please use an image smaller than 20MB."
        );
        return;
      }

      try {
        setError(null);
        setIsProcessing(true);
        
        // Process and normalize orientation - this handles EXIF rotation
        const dataUrl = await fileToNormalizedDataUrl(file);

        // Show preview - skip dimension validation for speed
        setPendingImage(dataUrl);
        setLastSource(source);
      } catch (err) {
        console.error("Error reading file:", err);
        setError("Could not read the selected image file. Please try again.");
      } finally {
        setIsProcessing(false);
      }
    },
    []
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
        processFile(file, "upload");
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

  if (error) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-red-900/50 border border-red-700 text-red-300 p-8 text-center rounded-2xl">
        <Icon type="error" className="w-16 h-16 text-red-400 mb-4" />
        <p className="text-red-300 text-lg">{error}</p>
        <button
          onClick={() => {
            triggerHapticFeedback();
            setError(null);
          }}
          className="mt-6 bg-indigo-600 text-white font-bold py-2 px-6 rounded-lg hover:bg-indigo-500 transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (showWebcam) {
    return (
      <>
        <WebcamCapture
          onImageSelected={(imageSrc) => {
            setShowWebcam(false);
            setPendingImage(imageSrc);
            setLastSource("camera-webcam");
          }}
          onClose={() => setShowWebcam(false)}
        />
        <ImagePreviewModal
          isOpen={Boolean(pendingImage)}
          imageSrc={pendingImage || ""}
          onClose={() => {
            setPendingImage(null);
            setLastSource(null);
          }}
          onConfirm={() => {
            if (pendingImage) {
              onImageSelected(pendingImage);
              setPendingImage(null);
              setLastSource(null);
            }
          }}
          confirmLabel="Use Photo"
          onRetake={() => {
            if (lastSource === "camera-webcam") {
              setPendingImage(null);
              setShowWebcam(true);
            } else if (lastSource === "camera-mobile") {
              setPendingImage(null);
              handleOpenCamera();
            } else if (lastSource === "upload") {
              setPendingImage(null);
              fileInputRef.current?.click();
            } else {
              setPendingImage(null);
            }
          }}
        />
      </>
    );
  }

  return (
    <>
      <div
        className={`relative w-full max-w-2xl mx-auto p-2 sm:p-4 mt-4 sm:mt-0 bg-white/10 backdrop-blur-lg rounded-2xl shadow-2xl border transition-all duration-150 ${
          isDraggingOver ? "border-indigo-400 scale-[1.02]" : "border-white/20"
        }`}
      >
        {/* Processing overlay */}
        {isProcessing && (
          <div className="absolute inset-0 bg-black/60 rounded-2xl flex items-center justify-center z-20">
            <div className="text-center">
              <div className="w-10 h-10 border-3 border-white/30 border-t-white rounded-full animate-spin mx-auto" />
              <p className="mt-3 text-white font-medium">Processing...</p>
            </div>
          </div>
        )}
        
        {isDraggingOver && (
          <div className="absolute inset-0 bg-indigo-600/50 rounded-2xl flex items-center justify-center pointer-events-none z-10">
            <div className="text-center">
              <Icon
                type="upload"
                className="w-12 h-12 text-white mx-auto"
              />
              <p className="mt-2 text-xl font-bold text-white">
                Drop Image Here
              </p>
            </div>
          </div>
        )}
        <button
          onClick={() => {
            triggerHapticFeedback();
            onClose();
          }}
          className="absolute top-2 right-2 sm:top-4 sm:right-4 p-2 text-white/50 hover:text-white transition-colors z-20 rounded-full hover:bg-white/10 touch-manipulation"
          aria-label="Close"
        >
          <Icon type="close" className="w-6 h-6" />
        </button>
        <div className="relative border-2 border-dashed border-white/20 rounded-xl p-4 sm:p-6">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="image/*"
            className="hidden"
            aria-label="Upload photo from your device"
          />
          {/* Native camera - uses device's full camera capabilities */}
          <input
            type="file"
            ref={cameraInputRef}
            onChange={handleFileChange}
            accept="image/*"
            capture="environment"
            className="hidden"
            aria-label="Take photo using device camera"
          />

          <div className="text-center py-4 sm:py-6">
            <h2 className="text-xl sm:text-2xl font-bold text-white mb-1">
              Add a Photo
            </h2>
            <p className="text-indigo-300/80 mb-5 text-sm">
              Take a photo or upload from your gallery
            </p>
            <div className="flex flex-col sm:flex-row justify-center items-center gap-3">
              <button
                onClick={handleOpenCamera}
                disabled={isProcessing}
                className="w-full sm:w-auto flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 
                         text-white font-semibold py-3.5 px-6 rounded-xl transition-all shadow-lg
                         active:scale-95 touch-manipulation disabled:opacity-50"
              >
                <Icon type="camera" className="w-5 h-5" />
                <span>Take Photo</span>
              </button>
              <button
                onClick={handleUploadPhoto}
                disabled={isProcessing}
                className="w-full sm:w-auto flex items-center justify-center gap-2 bg-white/10 border border-white/20 
                         text-white font-semibold py-3.5 px-6 rounded-xl transition-all
                         hover:bg-white/15 active:scale-95 touch-manipulation disabled:opacity-50"
              >
                <Icon type="upload" className="w-5 h-5" />
                <span>Upload</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      {/* Preview modal for mobile/native or upload flow */}
      <ImagePreviewModal
        isOpen={Boolean(pendingImage)}
        imageSrc={pendingImage || ""}
        onClose={() => {
          setPendingImage(null);
          setLastSource(null);
        }}
        onConfirm={() => {
          if (pendingImage) {
            onImageSelected(pendingImage);
            setPendingImage(null);
            setLastSource(null);
          }
        }}
        confirmLabel="Use Photo"
        onRetake={() => {
          if (lastSource === "camera-webcam") {
            setPendingImage(null);
            setShowWebcam(true);
          } else if (lastSource === "camera-mobile") {
            setPendingImage(null);
            handleOpenCamera();
          } else if (lastSource === "upload") {
            setPendingImage(null);
            fileInputRef.current?.click();
          } else {
            setPendingImage(null);
          }
        }}
      />
    </>
  );
});
