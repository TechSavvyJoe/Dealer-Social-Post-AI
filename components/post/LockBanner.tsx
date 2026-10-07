import React from "react";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { Button } from "../ui/Button";

export interface LockBannerProps {
  title: string;
  message: string;
  tone?: "warning" | "success" | "info";
  actionLabel?: string;
  actionBusy?: boolean;
  onAction?: () => void;
}

const TONE_CLASSES: Record<NonNullable<LockBannerProps["tone"]>, string> = {
  warning: "border-warning-ink/30 bg-warning-fill text-warning-ink",
  success: "border-success-ink/30 bg-success-fill text-success-ink",
  info: "border-info-ink/30 bg-info-fill text-info-ink",
};

/** The Post screen's one status banner: a lock, a problem, or a share result. */
export const LockBanner: React.FC<LockBannerProps> = ({
  title,
  message,
  tone = "warning",
  actionLabel,
  actionBusy = false,
  onAction,
}) => {
  const Icon = tone === "success" ? CheckCircle2 : tone === "info" ? Info : AlertCircle;
  return (
    <section
      data-testid="post-status-banner"
      role="status"
      aria-live="polite"
      className={`flex items-start gap-3 rounded-md border px-4 py-3 ${TONE_CLASSES[tone]}`}
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        <p className="mt-0.5 text-sm leading-5">{message}</p>
        {actionLabel && onAction ? (
          <Button
            variant="secondary"
            size="md"
            className="mt-3"
            loading={actionBusy}
            onClick={onAction}
          >
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </section>
  );
};
