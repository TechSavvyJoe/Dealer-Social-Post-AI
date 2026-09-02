import React from "react";
import { m } from "framer-motion";
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
  <m.div
    role="alert"
    initial={{ opacity: 0, y: -4 }}
    animate={{ opacity: 1, y: 0 }}
    className={cn(
      "flex items-start gap-2.5 rounded-xl border border-error-500/30 bg-error-500/10",
      // The error scale is static hex, not theme-inverted; light ink needs the
      // deep ramp in Sunlight Mode.
      "px-3.5 py-2.5 text-xs text-error-200 [.theme-light_&]:text-error-800",
      className,
    )}
  >
    <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5 text-error-400 [.theme-light_&]:text-error-600" />
    <span className="flex-1 leading-relaxed">{message}</span>
    {onRetry && (
      <button
        type="button"
        onClick={onRetry}
        className={cn(
          "flex-shrink-0 inline-flex items-center gap-1 font-semibold text-error-100",
          "[.theme-light_&]:text-error-800",
          "hover:text-content-primary transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error-400/70 rounded",
        )}
      >
        <RefreshCw className="h-3 w-3" />
        Try again
      </button>
    )}
  </m.div>
);
