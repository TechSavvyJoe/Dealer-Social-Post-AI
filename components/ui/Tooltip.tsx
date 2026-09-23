import React, { useEffect, useId, useState } from "react";
import { cn } from "../../utils/classNames";

interface TooltipProps {
  label: string;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}

export const Tooltip: React.FC<TooltipProps> = ({ label, children, side = "top" }) => {
  const [open, setOpen] = useState(false);
  const descriptionId = useId();
  const [isTouchDevice] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(hover: none)").matches;
  });

  // WCAG 1.4.13 — hover/focus content must be dismissible without moving the
  // pointer or focus.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // The label doubles as the trigger's accessible description so screen
  // readers announce it even when the visual tooltip is closed, suppressed
  // (touch devices), or unreachable (native-disabled triggers never fire
  // focus/hover). aria-describedby must sit on the trigger element itself —
  // a wrapper would not be announced.
  const trigger = React.isValidElement(children)
    ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
        "aria-describedby": descriptionId,
      })
    : children;

  const description = (
    <span id={descriptionId} className="sr-only">
      {label}
    </span>
  );

  const positionClasses: Record<typeof side, string> = {
    top: "bottom-full left-1/2 -translate-x-1/2 -translate-y-2",
    bottom: "top-full left-1/2 -translate-x-1/2 translate-y-2",
    left: "right-full top-1/2 -translate-y-1/2 -translate-x-2",
    right: "left-full top-1/2 -translate-y-1/2 translate-x-2",
  };

  // No visual tooltip on touch devices — the sr-only description still ships.
  if (isTouchDevice) {
    return (
      <>
        {trigger}
        {description}
      </>
    );
  }

  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {trigger}
      {description}
      {open ? (
        <div
          className={cn(
            "pointer-events-none absolute z-40 max-w-[min(18rem,calc(100vw-2rem))] whitespace-normal rounded-md border border-hairline bg-overlay px-2 py-1 text-center text-2xs font-medium text-ink",
            positionClasses[side],
          )}
          role="tooltip"
          aria-hidden="true"
        >
          {label}
        </div>
      ) : null}
    </div>
  );
};
