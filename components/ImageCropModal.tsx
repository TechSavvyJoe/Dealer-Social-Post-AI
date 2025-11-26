import React, { useState, useRef, useEffect } from "react";
import { Icon } from "./Icons";
import { triggerHapticFeedback } from "../utils/haptics";

interface ImageCropModalProps {
  isOpen: boolean;
  imageSrc: string | null;
  onConfirm: (croppedImage: string) => void;
  onClose: () => void;
}

export const ImageCropModal: React.FC<ImageCropModalProps> = ({
  isOpen,
  imageSrc,
  onConfirm,
  onClose,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "auto";
    }
    return () => {
      document.body.style.overflow = "auto";
    };
  }, [isOpen]);

  const handleConfirm = async () => {
    triggerHapticFeedback();

    // If we have the image source, just pass it through
    // No cropping or processing needed
    if (imageSrc) {
      onConfirm(imageSrc);
    }
  };

  const handleRetake = () => {
    triggerHapticFeedback();
    onClose();
  };

  if (!isOpen || !imageSrc) return null;

  return (
    <div
      className="fixed inset-0 bg-black/95 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl bg-surface-900/95 rounded-2xl shadow-2xl border border-white/20 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/20 flex justify-between items-center bg-surface-800/50">
          <h2 className="text-xl font-bold text-white">Preview Image</h2>
          <button
            onClick={onClose}
            className="text-white/70 hover:text-white transition-colors"
            aria-label="Close"
          >
            <Icon type="close" className="w-6 h-6" />
          </button>
        </div>

        {/* Image Preview Area - Improved visibility */}
        <div
          className="relative w-full bg-black flex items-center justify-center p-8"
          style={{ minHeight: "60vh" }}
        >
          <img
            ref={imageRef}
            src={imageSrc}
            alt="Preview"
            className="max-w-full max-h-[60vh] object-contain rounded-lg shadow-2xl"
          />
                </div>

                {/* Action Buttons - Enhanced visibility */}
                <div className="px-6 py-6 bg-surface-800/80 border-t border-white/20">
                    <p className="text-center text-surface-300 text-sm mb-4">
                        Confirm this photo or retake; cropping is not applied in this preview.
                    </p>
                    <div className="flex gap-4 justify-center">
                        <button
                            onClick={handleRetake}
                            className="px-8 py-4 rounded-xl bg-white/15 hover:bg-white/25 text-white font-bold text-lg
                                     transition-all shadow-lg hover:shadow-xl border border-white/20 hover:border-white/30
                                     min-w-[160px]"
            >
              Retake Photo
            </button>
            <button
              onClick={handleConfirm}
              className="px-8 py-4 rounded-xl bg-primary-500 hover:bg-primary-400 text-white font-bold text-lg
                                     shadow-2xl transition-all hover:shadow-primary-500/50 hover:scale-105
                                     min-w-[160px]"
            >
              Confirm Photo
            </button>
          </div>
        </div>

        {/* Hidden canvas (kept for potential future use) */}
        <canvas ref={canvasRef} className="hidden" />
      </div>
    </div>
  );
};
