import React from "react";
import { triggerHapticFeedback } from "../utils/haptics";
import { Icon } from "./Icons";
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
      <div className="flex flex-col items-center text-center">
        <div className="flex items-center justify-center h-16 w-16 rounded-full bg-red-900/20 mb-4">
          <Icon type="error" className="h-8 w-8 text-red-400" />
        </div>
        <p className="text-sm text-surface-300">
          Are you sure? This action cannot be undone and will permanently remove
          this item.
        </p>
      </div>
    </Modal>
  );
};
