import React from "react";
import { Icon } from "./Icons";
import { triggerHapticFeedback } from "../utils/haptics";
import { Button } from "./ui/Button";
import { Modal } from "./ui/Modal";
import type { ImageQualityTier } from "../types";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  compactMode: boolean;
  onToggleCompactMode: (value: boolean) => void;
  imageQualityTier: ImageQualityTier;
  onImageQualityTierChange: (value: ImageQualityTier) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  compactMode,
  onToggleCompactMode,
  imageQualityTier,
  onImageQualityTierChange,
}) => {
  const handleClose = () => {
    triggerHapticFeedback();
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Settings"
      description="Tune the workspace for your sales floor."
      size="lg"
      footer={
        <Button variant="outline" onClick={handleClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-5">
        <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary-500/25 bg-primary-500/10">
            <Icon type="settings" className="w-5 h-5 text-primary-300" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-surface-50">Compact mode</p>
            <p className="mt-1 text-sm leading-relaxed text-surface-400">
              Reduce spacing on desktop for a denser layout.
            </p>
          </div>
          <label className="relative inline-flex h-8 w-14 shrink-0 cursor-pointer items-center">
            <span className="sr-only">Toggle compact mode</span>
            <input
              type="checkbox"
              checked={compactMode}
              onChange={(e) => {
                triggerHapticFeedback();
                onToggleCompactMode(e.target.checked);
              }}
              className="peer sr-only"
            />
            <span className="absolute inset-0 rounded-full border border-white/10 bg-surface-800 transition-colors peer-checked:bg-primary-600" />
            <span className="relative ml-1 h-6 w-6 rounded-full bg-white shadow-md transition-transform peer-checked:translate-x-6" />
          </label>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary-500/25 bg-primary-500/10">
              <Icon type="sparkles" className="h-5 w-5 text-primary-300" />
            </div>
            <div>
              <p className="font-semibold text-surface-50">Image quality</p>
              <p className="mt-1 text-sm leading-relaxed text-surface-400">
                Standard is fast and polished. Studio starts with the premium Pro image
                model for hero creative.
              </p>
            </div>
          </div>
          <div
            className="mt-4 grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-surface-950/70 p-1"
            role="group"
            aria-label="Image quality"
          >
            {(["standard", "studio"] as const).map((tier) => (
              <button
                key={tier}
                type="button"
                aria-pressed={imageQualityTier === tier}
                onClick={() => {
                  triggerHapticFeedback();
                  onImageQualityTierChange(tier);
                }}
                className={`min-h-11 rounded-lg px-3 text-sm font-semibold transition-colors ${
                  imageQualityTier === tier
                    ? "bg-primary-600 text-white"
                    : "text-surface-400 hover:text-surface-100"
                }`}
              >
                {tier === "standard" ? "Standard" : "Studio"}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
};
