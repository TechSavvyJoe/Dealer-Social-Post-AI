import React, { useState } from "react";
import { cn } from "../../utils/classNames";

interface TooltipProps {
  label: string;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}

export const Tooltip: React.FC<TooltipProps> = ({ label, children, side = "top" }) => {
  const [open, setOpen] = useState(false);
  const [isTouchDevice] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(hover: none)").matches;
  });

  const positionClasses: Record<typeof side, string> = {
    top: "bottom-full left-1/2 -translate-x-1/2 -translate-y-2",
    bottom: "top-full left-1/2 -translate-x-1/2 translate-y-2",
    left: "right-full top-1/2 -translate-y-1/2 -translate-x-2",
    right: "left-full top-1/2 -translate-y-1/2 translate-x-2",
  };

  // Don't render tooltip content on touch devices
  if (isTouchDevice) {
    return <>{children}</>;
  }

  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      <div
        className={cn(
          "pointer-events-none absolute z-40 whitespace-nowrap rounded-md bg-slate-950/90 px-2 py-1 text-xs font-medium text-white shadow-lg transition-opacity",
          open ? "opacity-100" : "opacity-0",
          positionClasses[side],
        )}
        role="tooltip"
      >
        {label}
      </div>
    </div>
  );
};
