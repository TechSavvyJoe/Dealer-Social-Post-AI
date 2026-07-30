import { useEffect, useRef } from "react";

interface SpringConfig {
  stiffness?: number;
  damping?: number;
  mass?: number;
}

interface SpringOptions extends SpringConfig {
  onUpdate?: (value: number) => void;
  onComplete?: () => void;
}

/**
 * Custom hook for spring-based animations using velocity and physics
 * Provides smoother, more natural animations than CSS transitions
 */
export const useSpring = (target: number, options: SpringOptions = {}): number => {
  const { stiffness = 170, damping = 26, mass = 1, onUpdate, onComplete } = options;

  const currentValue = useRef(target);
  const velocity = useRef(0);
  const rafId = useRef<number | undefined>(undefined);

  useEffect(() => {
    let animating = true;
    const epsilon = 0.001; // Threshold for completion

    const animate = () => {
      if (!animating) return;

      const spring = -stiffness * (currentValue.current - target);
      const damper = -damping * velocity.current;
      const acceleration = (spring + damper) / mass;

      velocity.current += acceleration;
      currentValue.current += velocity.current;

      // Check if animation is complete
      const isComplete =
        Math.abs(target - currentValue.current) < epsilon &&
        Math.abs(velocity.current) < epsilon;

      if (isComplete) {
        currentValue.current = target;
        velocity.current = 0;
        onUpdate?.(target);
        onComplete?.();
        return;
      }

      onUpdate?.(currentValue.current);
      rafId.current = requestAnimationFrame(animate);
    };

    rafId.current = requestAnimationFrame(animate);

    return () => {
      animating = false;
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
      }
    };
  }, [target, stiffness, damping, mass, onUpdate, onComplete]);

  return currentValue.current;
};
