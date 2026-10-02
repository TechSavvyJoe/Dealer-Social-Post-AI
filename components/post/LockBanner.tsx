import React from "react";
import { AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";

export interface LockBannerProps {
  title: string;
  message: string;
  tone?: "warning" | "success" | "info";
  actionLabel?: string;
  actionBusy?: boolean;
  onAction?: () => void;
}

export const LockBanner: React.FC<LockBannerProps> = ({
  title,
  message,
  tone = "warning",
  actionLabel,
  actionBusy = false,
  onAction,
}) => {
  const success = tone === "success";
  return (
    <section
      data-testid="post-status-banner"
      role="status"
      aria-live="polite"
      className={
        "flex items-start gap-3 rounded-lg border px-4 py-3 " +
        (success
          ? "border-success-ink/30 bg-success-fill text-success-ink"
          : tone === "info"
            ? "border-brand-ink/25 bg-brand-tint text-brand-ink"
            : "border-warning-ink/30 bg-warning-fill text-warning-ink")
      }
    >
      {success ? (
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      ) : (
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        <p className="mt-0.5 text-sm leading-5 opacity-90">{message}</p>
        {actionLabel && onAction ? (
          <button
            type="button"
            disabled={actionBusy}
            onClick={onAction}
            className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-md border border-current px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/60 disabled:cursor-wait disabled:opacity-60"
          >
            {actionBusy ? (
              <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : null}
            {actionLabel}
          </button>
        ) : null}
      </div>
    </section>
  );
};
