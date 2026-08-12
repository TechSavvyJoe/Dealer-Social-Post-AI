import React, { useEffect, useState } from "react";
import { triggerHapticFeedback } from "../utils/haptics";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";

interface EditTextModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (prompt: string) => Promise<void>;
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
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setPrompt("");
      setSubmitError(null);
    }
  }, [isOpen]);

  const handleSubmit = async () => {
    triggerHapticFeedback();
    if (prompt.trim() && !isLoading) {
      setSubmitError(null);
      try {
        await onSubmit(prompt.trim());
      } catch (error) {
        setSubmitError(
          error instanceof Error
            ? error.message
            : "The caption could not be changed. Try again.",
        );
      }
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
            onClick={() => void handleSubmit()}
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
          <div className="w-full bg-surface-800/50 text-surface-400 border border-hairline rounded-xl px-4 py-3 text-sm max-h-32 overflow-y-auto custom-scrollbar">
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
            className="w-full bg-surface-800/50 text-surface-50 border-2 border-strong rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary-400 focus:border-primary-400 outline-none transition h-32 resize-none placeholder:text-surface-500"
          />
          {submitError ? (
            <p
              className="mt-3 rounded-xl border border-error-500/30 bg-error-500/10 px-3 py-2 text-sm text-error-100"
              role="alert"
            >
              {submitError}
            </p>
          ) : null}
        </div>
      </div>
    </Modal>
  );
};
