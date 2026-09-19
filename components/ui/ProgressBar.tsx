import React from "react";
import { cn } from "../../utils/classNames";

interface ProgressBarProps {
  value: number; // 0-100
  message?: string;
  estimatedTime?: string;
  className?: string;
  loadingLabel?: string;
  /**
   * Deprecated: the fill is a flat token colour now, no shimmer. Accepted
   * and ignored for call-site compatibility.
   */
  showShimmer?: boolean;
  /**
   * Render the percent readout under the track. Disable when a parent
   * already displays the same percentage (e.g. LoadingOverlay's header).
   */
  showPercentage?: boolean;
  /**
   * Size variant
   */
  size?: "sm" | "md" | "lg";
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  message,
  estimatedTime,
  className = "",
  loadingLabel = "Working",
  showShimmer: _showShimmer = true,
  showPercentage = true,
  size = "md",
}) => {
  const clampedValue = Math.min(100, Math.max(0, value));

  const sizeStyles = {
    sm: "h-1",
    md: "h-1",
    lg: "h-1.5",
  };

  return (
    <div className={cn("w-full", className)}>
      {message && <div className="mb-3 text-sm font-medium text-ink">{message}</div>}

      <div
        className={cn(
          "relative bg-panel-raised rounded-full overflow-hidden",
          sizeStyles[size],
        )}
        role="progressbar"
        aria-valuenow={clampedValue}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={loadingLabel}
      >
        <div
          className="absolute inset-y-0 left-0 bg-brand-fill rounded-full transition-[width] duration-180 ease-out"
          style={{ width: `${clampedValue}%` }}
        />
      </div>

      {(showPercentage || estimatedTime) && (
        <div className="mt-2 flex justify-between text-xs text-ink-hint">
          {showPercentage ? (
            <span className="tabular-nums">{Math.round(clampedValue)}%</span>
          ) : (
            <span />
          )}
          {estimatedTime && <span className="font-medium">{estimatedTime}</span>}
        </div>
      )}
    </div>
  );
};
