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

export const motion = new Proxy(motionFactory, {
  get: (_target, element: string | symbol) =>
    settledComponent(String(element) as React.ElementType),
});

export const AnimatePresence = ({ children }: { children?: React.ReactNode }) =>
  React.createElement(React.Fragment, null, children);

export const useReducedMotion = () => true;

// Some components import these as values even though they are used only for
// typing. Keeping stable runtime exports makes the test adapter fail-safe.
export const MotionGlobalConfig = { skipAnimations: true };
