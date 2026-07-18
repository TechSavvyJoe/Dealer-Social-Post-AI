import { useCallback, useRef, useState } from "react";

interface PullToRefreshOptions {
  onRefresh: () => Promise<void>;
  threshold?: number;
  maxPull?: number;
  enabled?: boolean;
}

const INTERACTIVE_SELECTOR =
  'button, a, input, textarea, select, [contenteditable="true"], [data-pull-ignore]';

/**
 * Opt-in pull-to-refresh for a dedicated scroll surface. It deliberately
 * ignores form controls and never treats a normal page scroll as a refresh.
 */
export const usePullToRefresh = ({
  onRefresh,
  threshold = 80,
  maxPull = 150,
  enabled = true,
}: PullToRefreshOptions) => {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const pullDistanceRef = useRef(0);
  const isPulling = useRef(false);

  const resetPull = useCallback(() => {
    startY.current = null;
    pullDistanceRef.current = 0;
    isPulling.current = false;
    setPullDistance(0);
  }, []);

  const handleTouchStart = useCallback(
    (event: TouchEvent) => {
      if (!enabled || isRefreshing || event.touches.length !== 1) return;

      const target = event.target;
      if (target instanceof Element && target.closest(INTERACTIVE_SELECTOR)) return;

      const element = event.currentTarget as HTMLElement | null;
      const documentScrollTop = document.scrollingElement?.scrollTop ?? window.scrollY;
      if ((element?.scrollTop ?? 0) > 0 || documentScrollTop > 0) return;

      startY.current = event.touches[0].clientY;
      pullDistanceRef.current = 0;
      isPulling.current = true;
    },
    [enabled, isRefreshing],
  );

  const handleTouchMove = useCallback(
    (event: TouchEvent) => {
      if (
        !isPulling.current ||
        startY.current === null ||
        isRefreshing ||
        event.touches.length !== 1
      ) {
        return;
      }

      const rawDistance = event.touches[0].clientY - startY.current;
      if (rawDistance <= 0) {
        pullDistanceRef.current = 0;
        setPullDistance(0);
        return;
      }

      // Resistance keeps the page anchored and makes an intentional refresh
      // feel different from a normal downward scroll.
      const resistedDistance = Math.min(rawDistance * 0.55, maxPull);
      pullDistanceRef.current = resistedDistance;
      setPullDistance(resistedDistance);
      if (event.cancelable) event.preventDefault();
    },
    [isRefreshing, maxPull],
  );

  const handleTouchEnd = useCallback(async () => {
    if (!isPulling.current || isRefreshing) {
      resetPull();
      return;
    }

    const shouldRunRefresh = pullDistanceRef.current >= threshold;
    resetPull();

    if (!shouldRunRefresh) return;

    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, onRefresh, resetPull, threshold]);

  const progress = Math.min(pullDistance / threshold, 1);

  return {
    pullDistance,
    isRefreshing,
    progress,
    shouldRefresh: pullDistance >= threshold,
    handlers: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
      onTouchCancel: resetPull,
    },
  };
};
