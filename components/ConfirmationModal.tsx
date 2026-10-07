import React from "react";
import { triggerHapticFeedback } from "../utils/haptics";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  itemName: string;
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  itemName,
}) => {
  const handleConfirm = () => {
    triggerHapticFeedback();
    onConfirm();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="sm"
      title={`Delete "${itemName}"?`}
      showCloseButton={false}
      footer={
        <>
          <Button variant="outline" onClick={onClose} fullWidth>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleConfirm} fullWidth>
            Delete
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-2">
        Are you sure? This action cannot be undone and will permanently remove this
        item.
      </p>
    </Modal>
  );
};
