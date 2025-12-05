import React, { useState } from "react";
import { Icon } from "./Icons";
import { triggerHapticFeedback } from "../utils/haptics";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";

interface EditTextModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (prompt: string) => void;
  originalText: string;
  isLoading: boolean;
}

export const EditTextModal: React.FC<EditTextModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  originalText,
  isLoading,
}) => {
  const [prompt, setPrompt] = useState("");

  const handleSubmit = () => {
    triggerHapticFeedback();
    if (prompt.trim() && !isLoading) {
      onSubmit(prompt);
    }
  };

  const handleClose = () => {
    triggerHapticFeedback();
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Edit Post Text with AI"
      description="Use AI to rewrite or refine your post's caption."
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant="filled"
            onClick={handleSubmit}
            disabled={!prompt.trim() || isLoading}
            loading={isLoading}
            className="w-40"
          >
            Submit Edit
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <div>
          <label className="block text-sm font-medium text-surface-300 mb-2">
            Original Text
          </label>
          <div className="w-full bg-surface-800/50 text-surface-400 border border-white/10 rounded-xl px-4 py-3 text-sm max-h-32 overflow-y-auto custom-scrollbar">
            {originalText.split("\n").map((line, i) => (
              <span key={i}>
                {line}
                <br />
              </span>
            ))}
          </div>
        </div>

        <div>
          <label
            htmlFor="editPrompt"
            className="block text-sm font-medium text-surface-300 mb-2"
          >
            How would you like to change it?
          </label>
          <textarea
            id="editPrompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g., Make it funnier, or add a question at the end..."
            className="w-full bg-surface-800/50 text-surface-50 border-2 border-white/20 rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary-400 focus:border-primary-400 outline-none transition h-32 resize-none placeholder:text-surface-500"
          />
        </div>
      </div>
    </Modal>
  );
};
