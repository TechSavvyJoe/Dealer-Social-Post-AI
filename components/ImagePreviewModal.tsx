import React, { useEffect } from 'react';
import { Icon } from './Icons';
import { triggerHapticFeedback } from '../utils/haptics';

interface ImagePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageSrc: string;
}

export const ImagePreviewModal: React.FC<ImagePreviewModalProps> = ({ isOpen, onClose, imageSrc }) => {
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
      <div className="relative max-w-4xl max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <img src={imageSrc} alt="Social media post preview" className="object-contain w-full h-full max-h-[90vh] rounded-lg" />
      </div>
      <button
        onClick={handleClose}
        className="absolute top-4 right-4 text-white bg-black/50 rounded-full p-2 hover:bg-black/75 transition-colors"
        aria-label="Close preview"
      >
        <Icon type="close" className="w-8 h-8" />
      </button>
    </div>
  );
};
