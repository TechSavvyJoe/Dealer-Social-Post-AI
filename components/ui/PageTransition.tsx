import React from "react";
import { m, AnimatePresence, Easing, useReducedMotion } from "framer-motion";

interface PageTransitionProps {
  children: React.ReactNode;
  pageKey: string;
  direction?: "forward" | "backward";
  layout?: "viewport" | "content";
  /**
   * A route that owns its own reveal (e.g. the login mark + panel moment)
   * passes this so the page transition never overlaps it.
   */
  skipInitial?: boolean;
}

const ease: Easing = [0.2, 0.8, 0.2, 1] as unknown as Easing;

const variants = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: { duration: 0.18, ease },
  },
  exit: {
    opacity: 0,
    transition: { duration: 0.18, ease },
  },
};

/**
 * Opacity-only page transition. Both layouts use the same variants — spatial
 * motion (slide/scale) is gone.
 */
export const PageTransition: React.FC<PageTransitionProps> = ({
  children,
  pageKey,
  layout = "viewport",
  skipInitial = false,
}) => {
  const prefersReducedMotion = useReducedMotion();

  return (
    <AnimatePresence mode="wait">
      <m.div
        key={pageKey}
        variants={variants}
        initial={skipInitial || prefersReducedMotion ? false : "initial"}
        animate="animate"
        exit="exit"
        className={
          layout === "viewport"
            ? "flex h-full min-h-0 w-full flex-1 flex-col"
            : "flex min-h-full w-full flex-none flex-col"
        }
        data-page-transition-layout={layout}
      >
        {children}
      </m.div>
    </AnimatePresence>
  );
};

interface FadeTransitionProps {
  children: React.ReactNode;
  show: boolean;
  duration?: number;
}

/**
 * Simple fade transition for overlays and modals — 180ms opacity only.
 */
export const FadeTransition: React.FC<FadeTransitionProps> = ({
  children,
  show,
  duration = 0.18,
}) => {
  return (
    <AnimatePresence>
      {show && (
        <m.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration, ease }}
        >
          {children}
        </m.div>
      )}
    </AnimatePresence>
  );
};

interface ScaleTransitionProps {
  children: React.ReactNode;
  show: boolean;
  origin?: string;
}

/**
 * Scale transition for dropdowns and popovers — 180ms opacity + 2% scale.
 */
export const ScaleTransition: React.FC<ScaleTransitionProps> = ({ children, show }) => {
  return (
    <AnimatePresence>
      {show && (
        <m.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.18, ease }}
        >
          {children}
        </m.div>
      )}
    </AnimatePresence>
  );
};
