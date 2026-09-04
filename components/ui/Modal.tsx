import React, { useEffect, useRef } from "react";
import { m, AnimatePresence, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { createPortal } from "react-dom";
import { cn } from "../../utils/classNames";

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  showCloseButton?: boolean;
  /** Prevent dismissal while an authoritative mutation is committing. */
  disableClose?: boolean;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  className,
  size = "md",
  showCloseButton = true,
  disableClose = false,
}) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = React.useId();
  const descriptionId = React.useId();
  const shouldReduceMotion = useReducedMotion();

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  // Move focus into the dialog on open and restore it to the trigger on close.
  // Without this, keyboard/AT users keep focus on the page behind the dialog.
  useEffect(() => {
    if (!isOpen) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const raf = requestAnimationFrame(() => {
      const root = contentRef.current;
      if (!root) return;
      const active = document.activeElement;
      // A fast keyboard/pointer interaction can move focus into the dialog
      // before this frame runs. Never steal that intentional focus back to the
      // first control (especially after inline validation focuses a field).
      if (active instanceof HTMLElement && root.contains(active) && active !== root) {
        return;
      }
      const first = root.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (first ?? root).focus();
    });
    return () => {
      cancelAnimationFrame(raf);
      previouslyFocused.current?.focus?.();
    };
  }, [isOpen]);

  // Escape to close + Tab focus trap so focus can't leave the dialog.
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (!disableClose) onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const root = contentRef.current;
      if (!root) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !root.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [disableClose, isOpen, onClose]);

  const sizeClasses = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-2xl",
    full: "max-w-full m-4",
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="modal-viewport fixed inset-0 z-[100] flex items-end justify-center sm:items-center">
          {/* Backdrop */}
          <m.div
            initial={shouldReduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.2 }}
            className="absolute inset-0 bg-surface-950/80 backdrop-blur-sm"
            onClick={disableClose ? undefined : onClose}
            aria-hidden="true"
          />

          {/* Modal Content */}
          <m.div
            ref={contentRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            aria-label={title ? undefined : "Dialog"}
            aria-describedby={description ? descriptionId : undefined}
            aria-busy={disableClose || undefined}
            tabIndex={-1}
            initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={
              shouldReduceMotion
                ? { duration: 0 }
                : { type: "spring", duration: 0.4, bounce: 0 }
            }
            className={cn(
              "relative w-full bg-surface-900 border border-hairline shadow-2xl overflow-hidden flex flex-col",
              "rounded-t-2xl sm:rounded-2xl", // Sheet-like on mobile
              "max-h-[calc(100dvh_-_var(--header-safe-top))] sm:max-h-[90vh]",
              sizeClasses[size],
              className,
            )}
          >
            {/* No mobile grabber. The sheet is dismissed with the close button,
                the backdrop, or Escape — never by dragging — so a grabber would
                promise a swipe gesture this dialog does not implement. */}

            {/* Header */}
            {(title || description || showCloseButton) && (
              <div className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-3 sm:items-center sm:px-6 sm:py-4">
                <div className="min-w-0">
                  {title && (
                    <h2
                      id={titleId}
                      className="text-lg font-semibold text-surface-50 sm:text-xl"
                    >
                      {title}
                    </h2>
                  )}
                  {description && (
                    <p
                      id={descriptionId}
                      className="mt-0.5 text-xs text-surface-400 sm:mt-1 sm:text-sm"
                    >
                      {description}
                    </p>
                  )}
                </div>
                {showCloseButton && (
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={disableClose}
                    aria-label="Close dialog"
                    className="min-h-11 min-w-11 shrink-0 -mr-1 rounded-full p-2 text-surface-400 transition-colors hover:bg-fill-subtle hover:text-surface-50 disabled:cursor-wait disabled:opacity-45 sm:-mr-2"
                  >
                    <X className="w-5 h-5" />
                  </button>
                )}
              </div>
            )}

            {/* Body */}
            <div
              className={cn(
                "relative overflow-y-auto px-4 py-4 custom-scrollbar sm:p-6",
                !footer && "pb-[max(1rem,var(--sab))]",
              )}
            >
              {children}
            </div>

            {/* Footer */}
            {footer && (
              <div className="flex flex-wrap justify-end gap-2 rounded-b-2xl border-t border-hairline bg-surface-950/30 px-4 pt-3 pb-[max(1rem,var(--sab))] sm:gap-3 sm:px-6 sm:pt-4">
                {footer}
              </div>
            )}
          </m.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
};
