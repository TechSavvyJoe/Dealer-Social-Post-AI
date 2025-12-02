import React, { useEffect, memo } from 'react';
import { Icon } from './Icons';
import { triggerHapticFeedback } from '../utils/haptics';

interface ImagePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageSrc: string;
  onConfirm?: () => void;
  onRetake?: () => void;
  confirmLabel?: string;
}

export const ImagePreviewModal: React.FC<ImagePreviewModalProps> = memo(({ 
  isOpen, 
  onClose, 
  imageSrc, 
  onConfirm, 
  onRetake, 
  confirmLabel = 'Use Photo' 
}) => {
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
      className="fixed inset-0 bg-black/95 flex items-center justify-center z-50 p-4"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-label="Image Preview"
    >
      <div
        className="relative w-full max-w-2xl flex flex-col items-center justify-center gap-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button - Top right */}
        <button
          onClick={handleClose}
          className="absolute -top-2 -right-2 sm:top-0 sm:right-0 text-white bg-black/60 rounded-full p-2 
                   hover:bg-black/80 transition-colors z-10 touch-manipulation"
          aria-label="Close preview"
        >
          <Icon type="close" className="w-6 h-6" />
        </button>

        {/* Image Preview - Respects natural orientation */}
        <div className="relative bg-black rounded-xl overflow-hidden shadow-2xl w-full">
          <img
            src={imageSrc}
            alt="Captured preview"
            className="w-full h-auto max-h-[65vh] object-contain"
            style={{ imageOrientation: 'from-image' }}
          />
        </div>

        {/* Action Buttons - Larger touch targets */}
        <div className="flex gap-3 w-full max-w-md">
          <button
            onClick={() => { triggerHapticFeedback(); (onRetake ?? onClose)(); }}
            className="flex-1 px-6 py-4 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold
                     transition-all border border-white/20 touch-manipulation active:scale-95"
          >
            Retake
          </button>
          {onConfirm && (
            <button
              onClick={() => { triggerHapticFeedback(); onConfirm(); }}
              className="flex-1 px-6 py-4 rounded-xl bg-primary-500 hover:bg-primary-400 text-white font-semibold
                       shadow-lg transition-all touch-manipulation active:scale-95"
            >
              {confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
});