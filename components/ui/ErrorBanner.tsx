import React from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { cn } from "../../utils/classNames";

interface ErrorBannerProps {
  /** The error message to display. */
  message: string;
  /** Optional retry handler — renders an inline "Try again" affordance. */
  onRetry?: () => void;
  className?: string;
}

/**
 * One canonical inline error treatment for data views. Previously every
 * surface hand-rolled its own error box (bg-error-900/40 vs /50 vs error/10),
 * which read as inconsistent. This is the single source of truth.
 */
export const ErrorBanner: React.FC<ErrorBannerProps> = ({
  message,
  onRetry,
  className,
}) => (
  <div
    role="alert"
    className={cn(
      "flex items-start gap-2.5 rounded-md border border-error-ink/30 bg-error-fill",
      "px-3.5 py-2.5 text-xs text-error-ink",
      className,
    )}
  >
    <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5 text-error-ink" />
    <span className="flex-1 leading-relaxed">{message}</span>
    {onRetry && (
      <button
        type="button"
        onClick={onRetry}
        className={cn(
          "flex-shrink-0 inline-flex items-center gap-1 font-semibold text-error-ink",
          "hover:opacity-80 transition-opacity duration-120 ease-out",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error-ink/70 rounded",
        )}
      >
        <RefreshCw className="h-3 w-3" />
        Try again
      </button>
    )}
  </div>
);
