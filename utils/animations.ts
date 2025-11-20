/**
 * Centralized animation constants and utilities for consistent motion design
 */

// Standard animation durations (in seconds)
export const ANIMATION_DURATIONS = {
  quick: 0.2,      // Micro-interactions (hover, focus)
  standard: 0.3,   // Form feedback, simple state changes
  smooth: 0.4,     // Page transitions, modal open/close
  extended: 0.6,   // Complex animations, emphasis
} as const;

// Spring animation configurations
export const SPRING_CONFIGS = {
  gentle: { stiffness: 300, damping: 30 },
  standard: { stiffness: 400, damping: 25 },
  snappy: { stiffness: 500, damping: 30 },
  bouncy: { stiffness: 600, damping: 20 },
} as const;

// Easing functions
export const EASINGS = {
  easeOut: [0.0, 0.0, 0.2, 1],
  easeIn: [0.4, 0.0, 1, 1],
  easeInOut: [0.4, 0.0, 0.2, 1],
  sharp: [0.4, 0.0, 0.6, 1],
} as const;

// Common animation variants for Framer Motion
export const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: ANIMATION_DURATIONS.standard },
};

export const fadeInUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -20 },
  transition: { duration: ANIMATION_DURATIONS.smooth },
};

export const scaleIn = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.95 },
  transition: { duration: ANIMATION_DURATIONS.standard },
};

export const slideInRight = {
  initial: { opacity: 0, x: 20 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -20 },
  transition: { duration: ANIMATION_DURATIONS.smooth },
};

// Hover and tap animations
export const hoverScale = {
  whileHover: { scale: 1.02 },
  whileTap: { scale: 0.98 },
  transition: { type: 'spring', ...SPRING_CONFIGS.snappy },
};

export const hoverLift = {
  whileHover: { y: -2, transition: { duration: ANIMATION_DURATIONS.quick } },
  whileTap: { y: 0, transition: { duration: ANIMATION_DURATIONS.quick } },
};

// Check if user prefers reduced motion
export const shouldReduceMotion = (): boolean => {
  if (typeof window === 'undefined') return false;
  if (!window.matchMedia) return false; // Handle test environments
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
};

// Helper to create motion props that respect reduced motion preference
export const createMotionProps = (animationProps: Record<string, any>) => {
  if (shouldReduceMotion()) {
    return {
      initial: false,
      animate: false,
      exit: false,
      transition: { duration: 0 },
    };
  }
  return animationProps;
};
