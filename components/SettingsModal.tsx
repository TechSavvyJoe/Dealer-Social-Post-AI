import React from "react";
import { Settings, Sparkles } from "lucide-react";
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
      description="Tune the workspace for your sales floor."
      size="lg"
      footer={
        <>
          <span className="mr-auto self-center text-xs text-surface-400">
            Build {releaseSha.slice(0, 7)}
          </span>
          <Button variant="outline" onClick={handleClose}>
            Close
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* Sunlight Mode (Theme) */}
        <div className="rounded-2xl border border-hairline bg-fill-subtle p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary-500/25 bg-primary-500/10">
              <Sparkles className="h-5 w-5 text-primary-300" />
            </div>
            <div>
              <p className="font-semibold text-surface-50">Theme (Sunlight Mode)</p>
              <p className="mt-1 text-sm leading-relaxed text-surface-400">
                Light theme provides higher contrast for use outdoors in bright
                sunlight.
              </p>
            </div>
          </div>
          <div
            className="mt-4 grid grid-cols-3 gap-1 rounded-xl border border-hairline bg-surface-950/70 p-1"
            role="group"
            aria-label="Theme"
          >
            {(["system", "dark", "light"] as const).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={theme === t}
                onClick={() => {
                  triggerHapticFeedback();
                  onThemeChange(t);
                }}
                className={`min-h-11 rounded-lg px-3 text-sm font-semibold capitalize transition-colors ${
                  theme === t
                    ? "bg-primary-600 text-white"
                    : "text-surface-400 hover:text-surface-100"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-hairline bg-fill-subtle p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary-500/25 bg-primary-500/10">
              <Sparkles className="h-5 w-5 text-primary-300" />
            </div>
            <div>
              <p className="font-semibold text-surface-50">Image quality</p>
              <p className="mt-1 text-sm leading-relaxed text-surface-400">
                Standard (2K) is quicker and looks sharp on social feeds. Studio (4K)
                takes longer to generate — use it when you need maximum detail.
              </p>
            </div>
          </div>
          <div
            className="mt-4 grid grid-cols-2 gap-1 rounded-xl border border-hairline bg-surface-950/70 p-1"
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
