import { useCallback, useRef } from "react";

interface SwipeHandlers {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
}

interface TouchGesturesOptions extends SwipeHandlers {
  threshold?: number;
  axisLockRatio?: number;
  maxDurationMs?: number;
  enabled?: boolean;
}

interface TouchPoint {
  x: number;
  y: number;
  startedAt: number;
}

const INTERACTIVE_SELECTOR =
  'button, a, input, textarea, select, [contenteditable="true"], [data-swipe-ignore]';

/**
 * Detects deliberate one-finger swipes on non-interactive space. Axis locking,
 * a time limit, and form-control exclusions prevent normal scrolling or text
 * editing from unexpectedly navigating the app.
 */
export const useTouchGestures = ({
  onSwipeLeft,
  onSwipeRight,
  onSwipeUp,
  onSwipeDown,
  threshold = 64,
  axisLockRatio = 1.25,
  maxDurationMs = 650,
  enabled = true,
}: TouchGesturesOptions = {}) => {
  const touchStart = useRef<TouchPoint | null>(null);
  const touchEnd = useRef<{ x: number; y: number } | null>(null);

  const resetGesture = useCallback(() => {
    touchStart.current = null;
    touchEnd.current = null;
  }, []);

  const handleTouchStart = useCallback(
    (event: TouchEvent) => {
      resetGesture();
      if (!enabled || event.touches.length !== 1) return;

      const target = event.target;
      if (target instanceof Element && target.closest(INTERACTIVE_SELECTOR)) return;

      const touch = event.touches[0];
      touchStart.current = {
        x: touch.clientX,
        y: touch.clientY,
        startedAt: Date.now(),
      };
    },
    [enabled, resetGesture],
  );

  const handleTouchMove = useCallback(
    (event: TouchEvent) => {
      if (!touchStart.current || event.touches.length !== 1) {
        resetGesture();
        return;
      }
      const touch = event.touches[0];
      touchEnd.current = { x: touch.clientX, y: touch.clientY };
    },
    [resetGesture],
  );

  const handleTouchEnd = useCallback(() => {
    const start = touchStart.current;
    const end = touchEnd.current;
    resetGesture();

    if (!start || !end || Date.now() - start.startedAt > maxDurationMs) return;

    const xDiff = start.x - end.x;
    const yDiff = start.y - end.y;
    const horizontalDistance = Math.abs(xDiff);
    const verticalDistance = Math.abs(yDiff);

    if (
      horizontalDistance >= threshold &&
      horizontalDistance >= verticalDistance * axisLockRatio
    ) {
      if (xDiff > 0) onSwipeLeft?.();
      else onSwipeRight?.();
      return;
    }

    if (
      verticalDistance >= threshold &&
      verticalDistance >= horizontalDistance * axisLockRatio
    ) {
      if (yDiff > 0) onSwipeUp?.();
      else onSwipeDown?.();
    }
  }, [
    axisLockRatio,
    maxDurationMs,
    onSwipeDown,
    onSwipeLeft,
    onSwipeRight,
    onSwipeUp,
    resetGesture,
    threshold,
  ]);

  return {
    onTouchStart: handleTouchStart,
    onTouchMove: handleTouchMove,
    onTouchEnd: handleTouchEnd,
    onTouchCancel: resetGesture,
  };
};
