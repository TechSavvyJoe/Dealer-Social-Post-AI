import React from "react";
import { Building2, Check, MonitorCog, Moon, Sun } from "lucide-react";
import { triggerHapticFeedback } from "../utils/haptics";
import { Button } from "./ui/Button";
import { Modal } from "./ui/Modal";
import type { ImageQualityTier } from "../types";
import { useAppStore } from "../stores/appStore";
import { resolveImageQualityTier } from "../utils/imageQualityTier";

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
  onOpenDealerSetup?: () => void;
}

const themeOptions: Array<{ value: "dark" | "light" | "system"; label: string }> = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Sunlight" },
  { value: "system", label: "Match device" },
];

// Descriptions, not advice: when the store sets the tier both choices are
// locked, so neither may tell this person when to pick it.
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
    helper: "Studio (4K) takes longer to generate and shows more detail.",
  },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  imageQualityTier,
  onImageQualityTierChange,
  theme,
  onThemeChange,
  onOpenDealerSetup,
}) => {
  const role = useAppStore((state) => state.role);
  const dealer = useAppStore((state) => state.currentDealer);
  const hasActualDealer = Boolean(
    dealer && dealer.name?.trim().toUpperCase() !== "SYSTEM ADMIN",
  );
  // Generation uses the same rule: a store tier wins over this device's choice.
  const imageQuality = resolveImageQualityTier(
    dealer?.image_quality_tier,
    imageQualityTier,
  );
  const imageQualityHelperId = React.useId();
  const handleClose = () => {
    triggerHapticFeedback();
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Settings"
      description="Personal preferences for this device. Store-wide brand and workflow choices live in manager setup."
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
        {onOpenDealerSetup &&
        hasActualDealer &&
        (role === "dealer_admin" || role === "super_admin") ? (
          <button
            type="button"
            onClick={() => {
              triggerHapticFeedback();
              onOpenDealerSetup();
            }}
            className="flex min-h-16 w-full items-center gap-3 rounded-md border border-strong bg-brand-tint px-4 text-left text-ink hover:border-brand-ink"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-sm bg-panel-raised text-brand-ink">
              <Building2 className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">Open dealership setup</span>
              <span className="block text-xs text-ink-2">
                Brand voice, channels, approvals and team permissions
              </span>
            </span>
          </button>
        ) : null}
        <div>
          <h3 className="text-lg font-semibold text-ink">Appearance</h3>
          <p className="mt-1 text-sm text-ink-2">Saved only on this device.</p>
          <div
            className="mt-3 grid gap-2 sm:grid-cols-3"
            role="group"
            aria-label="Appearance"
          >
            {themeOptions.map((option) => {
              const Icon =
                option.value === "dark"
                  ? Moon
                  : option.value === "light"
                    ? Sun
                    : MonitorCog;
              const selected = theme === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    triggerHapticFeedback();
                    onThemeChange(option.value);
                  }}
                  className={`relative flex min-h-24 w-full flex-col items-start justify-between rounded-md border p-3 text-sm font-medium transition-colors ${
                    selected
                      ? "border-brand-ink bg-brand-tint text-ink"
                      : "border-hairline bg-panel-raised text-ink hover:border-strong"
                  }`}
                >
                  <Icon className="h-5 w-5 text-ink-2" aria-hidden="true" />
                  {option.label}
                  {selected ? (
                    <Check
                      className="absolute right-3 top-3 h-4 w-4 text-brand-ink"
                      aria-hidden="true"
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <h3 className="text-lg font-semibold text-ink">Image quality</h3>
          <p id={imageQualityHelperId} className="mt-1 text-sm text-ink-2">
            {imageQuality.setByStore
              ? "Your store sets image quality. A manager can change it in Dealership settings."
              : "Your device preference."}
          </p>
          <div
            className="mt-3 grid gap-2 sm:grid-cols-2"
            role="group"
            aria-label="Image quality"
            aria-describedby={imageQualityHelperId}
          >
            {imageQualityOptions.map((option) => {
              const selected = imageQuality.tier === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  disabled={imageQuality.setByStore}
                  onClick={() => {
                    triggerHapticFeedback();
                    onImageQualityTierChange(option.value);
                  }}
                  className={`relative flex min-h-24 w-full flex-col items-start justify-center gap-1 rounded-md border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed ${
                    selected
                      ? "border-brand-ink bg-brand-tint text-ink"
                      : "border-hairline bg-panel-raised text-ink enabled:hover:border-strong disabled:text-ink-2"
                  }`}
                >
                  <span className="text-sm font-medium">{option.label}</span>
                  <span
                    className={`text-2xs ${selected ? "text-ink-2" : "text-ink-hint"}`}
                  >
                    {option.helper}
                  </span>
                  {selected ? (
                    <Check
                      className="absolute right-3 top-3 h-4 w-4 text-brand-ink"
                      aria-hidden="true"
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
};
