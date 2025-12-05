import React from "react";
import { cn } from "../../utils/classNames";

interface ShimmerProps {
  className?: string;
  width?: string | number;
  height?: string | number;
  rounded?: string;
}

export const Shimmer: React.FC<ShimmerProps> = ({
  className,
  width,
  height,
  rounded = "rounded-lg",
}) => {
  return (
    <div
      className={cn(
        "relative overflow-hidden bg-surface-800/50",
        rounded,
        className
      )}
      style={{
        width: width,
        height: height,
      }}
      role="status"
      aria-label="Loading..."
    >
      <div
        className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite]"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.08) 50%, transparent 100%)",
        }}
      />
    </div>
  );
};
