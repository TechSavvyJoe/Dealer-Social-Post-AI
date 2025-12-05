import { useCallback, useEffect, useRef } from "react";

interface SwipeHandlers {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
}

interface TouchGesturesOptions extends SwipeHandlers {
  threshold?: number; // Minimum distance in pixels to trigger swipe
}

/**
 * Hook for detecting touch gestures (swipe, pinch, long-press)
 * Provides mobile-first interaction patterns
 */
export const useTouchGestures = (options: TouchGesturesOptions = {}) => {
  const {
    onSwipeLeft,
    onSwipeRight,
    onSwipeUp,
    onSwipeDown,
    threshold = 50,
  } = options;

  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const touchEnd = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    touchEnd.current = null;
    touchStart.current = {
      x: e.targetTouches[0].clientX,
      y: e.targetTouches[0].clientY,
    };
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    touchEnd.current = {
      x: e.targetTouches[0].clientX,
      y: e.targetTouches[0].clientY,
    };
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!touchStart.current || !touchEnd.current) return;

    const xDiff = touchStart.current.x - touchEnd.current.x;
    const yDiff = touchStart.current.y - touchEnd.current.y;

    // Determine if horizontal or vertical swipe
    if (Math.abs(xDiff) > Math.abs(yDiff)) {
      // Horizontal swipe
      if (Math.abs(xDiff) > threshold) {
        if (xDiff > 0) {
          onSwipeLeft?.();
        } else {
          onSwipeRight?.();
        }
      }
    } else {
      // Vertical swipe
      if (Math.abs(yDiff) > threshold) {
        if (yDiff > 0) {
          onSwipeUp?.();
        } else {
          onSwipeDown?.();
        }
      }
    }
  }, [threshold, onSwipeLeft, onSwipeRight, onSwipeUp, onSwipeDown]);

  const handlers = {
    onTouchStart: handleTouchStart,
    onTouchMove: handleTouchMove,
    onTouchEnd: handleTouchEnd,
  };

  return handlers;
};
