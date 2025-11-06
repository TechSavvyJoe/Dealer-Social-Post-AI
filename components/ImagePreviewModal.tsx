import React, { useEffect } from 'react';
import { Icon } from './Icons';
import { triggerHapticFeedback } from '../utils/haptics';

interface ImagePreviewModalProps {
  isOpen: boolean;
  onClose: () => void; // Treat as "retake" when confirm button is present
  imageSrc: string;
  onConfirm?: () => void;
  confirmLabel?: string;
}

export const ImagePreviewModal: React.FC<ImagePreviewModalProps> = ({ isOpen, onClose, imageSrc, onConfirm, confirmLabel = 'Use Photo' }) => {
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
      className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-label="Image Preview"
    >
      <div
        className="relative max-w-5xl w-full max-h-[95vh] flex flex-col items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={imageSrc}
          alt="Captured preview"
          className="object-contain w-auto h-auto max-w-full max-h-[75vh] rounded-lg shadow-2xl"
        />
        <div className="mt-6 flex gap-4">
          <button
            onClick={handleClose}
            className="px-5 py-2.5 rounded-full bg-white/10 border border-white/20 text-white hover:bg-white/20 transition-colors shadow focus:outline-none focus:ring-2 focus:ring-white/40"
          >
            Retake
          </button>
          {onConfirm && (
            <button
              onClick={() => { triggerHapticFeedback(); onConfirm(); }}
              className="px-5 py-2.5 rounded-full bg-primary-500 text-white font-semibold shadow-lg hover:bg-primary-400 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-300"
            >
              {confirmLabel}
            </button>
          )}
        </div>
        <button
          onClick={handleClose}
          className="absolute top-2 right-2 text-white bg-black/50 rounded-full p-2 hover:bg-black/75 transition-colors focus:outline-none focus:ring-2 focus:ring-white"
          aria-label="Close preview"
        >
          <Icon type="close" className="w-7 h-7" />
        </button>
      </div>
    </div>
  );
};