import React, { useEffect, memo } from "react";
import { Icon } from "./Icons";
import { triggerHapticFeedback } from "../utils/haptics";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";

interface ImagePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageSrc: string;
  onConfirm?: () => void;
  onRetake?: () => void;
  confirmLabel?: string;
}

export const ImagePreviewModal: React.FC<ImagePreviewModalProps> = memo(
  ({
    isOpen,
    onClose,
    imageSrc,
    onConfirm,
    onRetake,
    confirmLabel = "Use Photo",
  }) => {
    const handleClose = () => {
      triggerHapticFeedback();
      onClose();
    };

    return (
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        size="xl"
        className="bg-black/90 border-white/10 p-0 overflow-hidden"
        showCloseButton={true}
        title="Review Photo"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                triggerHapticFeedback();
                (onRetake ?? handleClose)();
              }}
              className="flex-1"
            >
              Retake
            </Button>
            {onConfirm && (
              <Button
                variant="primary"
                onClick={() => {
                  triggerHapticFeedback();
                  onConfirm();
                }}
                className="flex-1"
              >
                {confirmLabel}
              </Button>
            )}
          </>
        }
      >
        <div className="flex items-center justify-center p-4 min-h-[50vh]">
          <img
            src={imageSrc}
            alt="Captured preview"
            className="w-full h-auto max-h-[60vh] object-contain rounded-lg shadow-2xl"
            style={{ imageOrientation: "from-image" }}
          />
        </div>
      </Modal>
    );
  }
);
