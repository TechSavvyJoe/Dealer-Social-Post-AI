import React from "react";

const motionOnlyProps = new Set([
  "animate",
  "custom",
  "drag",
  "dragConstraints",
  "dragElastic",
  "dragMomentum",
  "exit",
  "initial",
  "inherit",
  "layout",
  "layoutDependency",
  "layoutId",
  "onAnimationComplete",
  "onAnimationStart",
  "onDrag",
  "onDragEnd",
  "onDragStart",
  "onViewportEnter",
  "onViewportLeave",
  "transformTemplate",
  "transition",
  "variants",
  "viewport",
  "whileDrag",
  "whileFocus",
  "whileHover",
  "whileInView",
  "whileTap",
]);

type SettledMotionProps = Record<string, unknown> & {
  children?: React.ReactNode;
};

const cache = new Map<React.ElementType, React.ComponentType<SettledMotionProps>>();

const settledComponent = (element: React.ElementType) => {
  const cached = cache.get(element);
  if (cached) return cached;

  const Component = React.forwardRef<HTMLElement, SettledMotionProps>(
    ({ children, ...props }, ref) => {
      const domProps: Record<string, unknown> = { ref };
      for (const [name, value] of Object.entries(props)) {
        if (!motionOnlyProps.has(name)) domProps[name] = value;
      }
      return React.createElement(element, domProps, children as React.ReactNode);
    },
  );
  Component.displayName = `SettledMotion(${String(element)})`;
  cache.set(element, Component);
  return Component;
};

const motionFactory = (element: React.ElementType) => settledComponent(element);

/**
 * `m.*` is the only motion component the app may render: production wraps the
 * tree in <LazyMotion strict>, where any `motion.*` component throws during
 * render. Mirror that here so a regression that reintroduces `motion.*`
 * fails the unit suite instead of crashing a rarely-visited screen in prod.
 */
export const m = new Proxy(motionFactory, {
  get: (_target, element: string | symbol) =>
    settledComponent(String(element) as React.ElementType),
});

const strictViolation = (element: string) => {
  const Violation: React.FC = () => {
    throw new Error(
      `motion.${element} rendered under LazyMotion strict mode — use m.${element} from framer-motion instead.`,
    );
  };
  Violation.displayName = `StrictMotionViolation(${element})`;
  return Violation;
};

export const motion = new Proxy(
  (element: React.ElementType) => strictViolation(String(element)),
  {
    get: (_target, element: string | symbol) => strictViolation(String(element)),
  },
);

type MotionProviderProps = {
  children?: React.ReactNode;
};

export const LazyMotion = ({ children }: MotionProviderProps) =>
  React.createElement(React.Fragment, null, children);

export const MotionConfig = ({ children }: MotionProviderProps) =>
  React.createElement(React.Fragment, null, children);

export const domAnimation = {};

export const AnimatePresence = ({ children }: { children?: React.ReactNode }) =>
  React.createElement(React.Fragment, null, children);

export const useReducedMotion = () => true;

// Some components import these as values even though they are used only for
// typing. Keeping stable runtime exports makes the test adapter fail-safe.
export const MotionGlobalConfig = { skipAnimations: true };
