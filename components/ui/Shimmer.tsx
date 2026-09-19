import React from "react";
import { cn } from "../../utils/classNames";

interface ShimmerProps {
  className?: string;
  width?: string | number;
  height?: string | number;
  rounded?: string;
}

/**
 * A quiet loading placeholder — a flat panel-raised block with a soft CSS
 * opacity pulse. No shimmer sweep.
 */
export const Shimmer: React.FC<ShimmerProps> = ({
  className,
  width,
  height,
  rounded = "rounded-md",
}) => {
  return (
    <div
      className={cn("animate-pulse-soft bg-panel-raised", rounded, className)}
      style={{
        width: width,
        height: height,
      }}
      role="status"
      aria-label="Loading"
    />
  );
};
