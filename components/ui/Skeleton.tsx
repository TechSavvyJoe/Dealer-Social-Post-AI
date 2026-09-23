import React from "react";
import { cn } from "../../utils/classNames";

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Skeleton shape variant */
  variant?: "text" | "circular" | "rectangular";
  /** Width of the skeleton */
  width?: string | number;
  /** Height of the skeleton */
  height?: string | number;
}

/**
 * Skeleton loader component for better perceived performance.
 * Shows animated placeholder while content is loading.
 *
 * @example
 * <Skeleton variant="text" />
 * <Skeleton variant="circular" width={40} height={40} />
 * <Skeleton variant="rectangular" width="100%" height={200} />
 */
export const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  ({ className, variant = "text", width, height, style, ...props }, ref) => {
    const variantStyles = {
      text: "h-4 w-full rounded",
      circular: "rounded-full",
      rectangular: "rounded-lg",
    };

    return (
      <div
        ref={ref}
        className={cn(
          "animate-pulse-soft bg-panel-raised",
          variantStyles[variant],
          className,
        )}
        style={{
          width: width,
          height: height || (variant === "text" ? undefined : height),
          ...style,
        }}
        aria-hidden="true"
        {...props}
      />
    );
  },
);

Skeleton.displayName = "Skeleton";

/**
 * Skeleton group for complex loading states
 */
interface SkeletonGroupProps {
  /** Number of skeleton lines to display */
  lines?: number;
  /** Spacing between lines */
  spacing?: "tight" | "normal" | "relaxed";
  /** Show avatar skeleton */
  avatar?: boolean;
}

export const SkeletonGroup: React.FC<SkeletonGroupProps> = ({
  lines = 3,
  spacing = "normal",
  avatar = false,
}) => {
  const spacingStyles = {
    tight: "space-y-2",
    normal: "space-y-3",
    relaxed: "space-y-4",
  };

  return (
    <div className={cn("w-full", spacingStyles[spacing])}>
      {avatar && (
        <div className="flex items-center gap-3">
          <Skeleton variant="circular" width={40} height={40} />
          <div className="flex-1 space-y-2">
            <Skeleton width="40%" />
            <Skeleton width="60%" />
          </div>
        </div>
      )}
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? "70%" : "100%"} />
      ))}
    </div>
  );
};
