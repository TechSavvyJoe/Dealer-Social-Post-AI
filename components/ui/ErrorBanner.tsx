import React from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { cn } from "../../utils/classNames";
import { Button } from "./Button";

interface ErrorBannerProps {
  /** The error message to display. */
  message: string;
  /** Optional handler — renders an inline action, "Try again" by default. */
  onRetry?: () => void;
  /**
   * Name the action for what it does. A handler that only clears the message
   * must say "Dismiss"; "Try again" promises a retry.
   */
  actionLabel?: string;
  className?: string;
}

/**
 * One canonical inline error treatment for data views. Previously every
 * surface hand-rolled its own error box (bg-error-900/40 vs /50 vs error/10),
 * which read as inconsistent. This is the single source of truth.
 *
 * The message is 14 px: error text is never 12 px. The action is a full 44 px
 * target, vertically centred on the message. Its negative block margin equals
 * the banner's padding, so on a one-line message the target fills the
 * banner's inner height exactly and adds nothing to it.
 */
export const ErrorBanner: React.FC<ErrorBannerProps> = ({
  message,
  onRetry,
  actionLabel = "Try again",
  className,
}) => (
  <div
    role="alert"
    className={cn(
      "flex items-start gap-2.5 rounded-md border border-error-ink/30 bg-error-fill",
      "px-3.5 py-3 text-sm text-error-ink",
      className,
    )}
  >
    <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
    <span className="min-w-0 flex-1">{message}</span>
    {onRetry && (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disableHaptics
        onClick={onRetry}
        leftIcon={actionLabel === "Try again" ? <RefreshCw /> : undefined}
        className="-my-3 -mr-2.5 min-h-11 flex-shrink-0 self-center px-2.5 text-error-ink"
      >
        {actionLabel}
      </Button>
    )}
  </div>
);
