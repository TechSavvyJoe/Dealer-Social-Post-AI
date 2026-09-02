import React from "react";
import { m, AnimatePresence, Easing } from "framer-motion";

interface PageTransitionProps {
  children: React.ReactNode;
  pageKey: string;
  direction?: "forward" | "backward";
  layout?: "viewport" | "content";
}

// iOS-style ease curves
const easeSmooth: Easing = [0.16, 1, 0.3, 1] as unknown as Easing;
const easeOut: Easing = [0.4, 0, 1, 1] as unknown as Easing;

/**
 * Premium page transition wrapper
 * Provides smooth, iOS-style page transitions
 */
export const PageTransition: React.FC<PageTransitionProps> = ({
  children,
  pageKey,
  direction = "forward",
  layout = "viewport",
}) => {
  // Long pages live inside #main-content, the app's one scrollport. Safari can
  // clip or blank overflowing descendants while an ancestor is transformed,
  // so content-sized pages use an opacity-only transition. Viewport-owned
  // screens remain bounded and can safely keep the spatial transition.
  const variants =
    layout === "content"
      ? {
          initial: { opacity: 0 },
          animate: {
            opacity: 1,
            transition: { duration: 0.25, ease: easeSmooth },
          },
          exit: {
            opacity: 0,
            transition: { duration: 0.18, ease: easeOut },
          },
        }
      : {
          initial: {
            opacity: 0,
            x: direction === "forward" ? 20 : -20,
            scale: 0.98,
          },
          animate: {
            opacity: 1,
            x: 0,
            scale: 1,
            transition: {
              duration: 0.35,
              ease: easeSmooth,
            },
          },
          exit: {
            opacity: 0,
            x: direction === "forward" ? -20 : 20,
            scale: 0.98,
            transition: {
              duration: 0.25,
              ease: easeOut,
            },
          },
        };

  return (
    <AnimatePresence mode="wait">
      <m.div
        key={pageKey}
        variants={variants}
        initial="initial"
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
 * Simple fade transition for overlays and modals
 */
export const FadeTransition: React.FC<FadeTransitionProps> = ({
  children,
  show,
  duration = 0.2,
}) => {
  return (
    <AnimatePresence>
      {show && (
        <m.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration }}
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
 * Scale transition for dropdowns and popovers
 */
export const ScaleTransition: React.FC<ScaleTransitionProps> = ({
  children,
  show,
  origin = "top",
}) => {
  return (
    <AnimatePresence>
      {show && (
        <m.div
          initial={{ opacity: 0, scale: 0.95, y: origin === "top" ? -10 : 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: origin === "top" ? -10 : 10 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          {children}
        </m.div>
      )}
    </AnimatePresence>
  );
};
