import React, { useEffect } from 'react';
import { Icon } from './Icons';
import { triggerHapticFeedback } from '../utils/haptics';

interface ImagePreviewModalProps {
  isOpen: boolean;
  onClose: () => void; // Close modal without action
  imageSrc: string;
  onConfirm?: () => void;
  onRetake?: () => void; // Explicit retake callback
  confirmLabel?: string;
}

export const ImagePreviewModal: React.FC<ImagePreviewModalProps> = ({ isOpen, onClose, imageSrc, onConfirm, onRetake, confirmLabel = 'Use Photo' }) => {
  const handleClose = () => {
    triggerHapticFeedback();
    onClose();
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    } else {
      document.body.style.overflow = 'auto';
    }

    return () => {
      document.body.style.overflow = 'auto';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 bg-black/95 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-label="Image Preview"
    >
      <div
        className="relative max-w-5xl w-full flex flex-col items-center justify-center gap-8 max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Image Preview - Enhanced visibility with better background */}
        <div className="relative bg-black rounded-xl p-4 shadow-2xl">
          <img
            src={imageSrc}
            alt="Captured preview"
            className="object-contain w-auto h-auto max-w-full max-h-[60vh] rounded-lg"
          />
        </div>

        {/* Action Buttons - Enhanced visibility */}
        <div className="flex gap-4">
          <button
            onClick={() => { triggerHapticFeedback(); (onRetake ?? onClose)(); }}
            className="px-8 py-4 rounded-xl bg-white/15 hover:bg-white/25 text-white font-bold text-lg
                     transition-all shadow-lg hover:shadow-xl border border-white/20 hover:border-white/30
                     min-w-[160px] focus:outline-none focus:ring-2 focus:ring-white/40"
          >
            Retake Photo
          </button>
          {onConfirm && (
            <button
              onClick={() => { triggerHapticFeedback(); onConfirm(); }}
              className="px-8 py-4 rounded-xl bg-primary-500 hover:bg-primary-400 text-white font-bold text-lg
                       shadow-2xl transition-all hover:shadow-primary-500/50 hover:scale-105
                       min-w-[160px] focus:outline-none focus:ring-2 focus:ring-primary-300"
            >
              {confirmLabel}
            </button>
          )}
        </div>

        {/* Close Button */}
        <button
          onClick={handleClose}
          className="absolute top-2 right-2 text-white bg-black/60 rounded-full p-3 hover:bg-black/80 
                   transition-colors focus:outline-none focus:ring-2 focus:ring-white shadow-lg"
          aria-label="Close preview"
        >
          <Icon type="close" className="w-7 h-7" />
        </button>
      </div>
    </div>
  );
};