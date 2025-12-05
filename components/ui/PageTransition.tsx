import React from "react";
import { motion, AnimatePresence, Easing } from "framer-motion";

interface PageTransitionProps {
  children: React.ReactNode;
  pageKey: string;
  direction?: "forward" | "backward";
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
}) => {
  const variants = {
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
        ease: easeSmooth, // iOS smooth ease
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
      <motion.div
        key={pageKey}
        variants={variants}
        initial="initial"
        animate="animate"
        exit="exit"
        style={{ width: "100%", height: "100%" }}
      >
        {children}
      </motion.div>
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
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration }}
        >
          {children}
        </motion.div>
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
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: origin === "top" ? -10 : 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: origin === "top" ? -10 : 10 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
};
