import React from "react";
import { triggerHapticFeedback } from "../utils/haptics";
import { Button } from "./ui/Button";
import { Modal } from "./ui/Modal";
import type { ImageQualityTier } from "../types";

// Client bundle identity — same fallback chain the telemetry envelope stamps
// on every event (utils/telemetry.ts). The SystemHealthPanel shows the
// SERVER's SHA; this is the salesperson-facing answer to "am I on the new
// build?" for the bundle actually running on their phone.
const releaseSha =
  import.meta.env.VITE_RELEASE_SHA ||
  import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA ||
  "development";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageQualityTier: ImageQualityTier;
  onImageQualityTierChange: (value: ImageQualityTier) => void;
  theme: "dark" | "light" | "system";
  onThemeChange: (value: "dark" | "light" | "system") => void;
}

const themeOptions: Array<{ value: "dark" | "light" | "system"; label: string }> = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Sunlight" },
  { value: "system", label: "Match device" },
];

const imageQualityOptions: Array<{
  value: ImageQualityTier;
  label: string;
  helper: string;
}> = [
  {
    value: "standard",
    label: "Standard",
    helper: "Standard (2K) is quicker and looks sharp on social feeds.",
  },
  {
    value: "studio",
    label: "Studio",
    helper:
      "Studio (4K) takes longer to generate — use it when you need maximum detail.",
  },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  imageQualityTier,
  onImageQualityTierChange,
  theme,
  onThemeChange,
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
      description="Appearance and image quality on this device."
      size="lg"
      footer={
        <>
          <span className="mr-auto self-center text-2xs text-ink-hint">
            Build {releaseSha.slice(0, 7)}
          </span>
          <Button variant="secondary" onClick={handleClose}>
            Close
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold text-ink">Appearance</h3>
          <div
            className="mt-3 divide-y divide-hairline rounded-md border border-hairline"
            role="group"
            aria-label="Appearance"
          >
            {themeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={theme === option.value}
                onClick={() => {
                  triggerHapticFeedback();
                  onThemeChange(option.value);
                }}
                className={`flex min-h-11 w-full items-center justify-between px-4 text-sm font-medium transition-colors ${
                  theme === option.value
                    ? "bg-brand-fill text-brand-foreground"
                    : "text-ink hover:bg-fill-hover"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-lg font-semibold text-ink">Image quality</h3>
          <div
            className="mt-3 divide-y divide-hairline rounded-md border border-hairline"
            role="group"
            aria-label="Image quality"
          >
            {imageQualityOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={imageQualityTier === option.value}
                onClick={() => {
                  triggerHapticFeedback();
                  onImageQualityTierChange(option.value);
                }}
                className={`flex min-h-11 w-full flex-col items-start justify-center gap-0.5 px-4 py-2 text-left transition-colors ${
                  imageQualityTier === option.value
                    ? "bg-brand-fill text-brand-foreground"
                    : "text-ink hover:bg-fill-hover"
                }`}
              >
                <span className="text-sm font-medium">{option.label}</span>
                <span
                  className={`text-2xs ${
                    imageQualityTier === option.value
                      ? "text-brand-foreground"
                      : "text-ink-hint"
                  }`}
                >
                  {option.helper}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
};
