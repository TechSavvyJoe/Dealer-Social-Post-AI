import { useState, useCallback, useRef } from "react";

interface PullToRefreshOptions {
  onRefresh: () => Promise<void>;
  threshold?: number;
  maxPull?: number;
}

/**
 * Hook for pull-to-refresh functionality
 * Provides touch handlers and state for implementing pull-to-refresh UI
 */
export const usePullToRefresh = (options: PullToRefreshOptions) => {
  const { onRefresh, threshold = 80, maxPull = 150 } = options;

  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const isPulling = useRef(false);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    // Only trigger if at top of scrollable content
    const element = e.currentTarget as HTMLElement;
    if (element.scrollTop === 0) {
      startY.current = e.touches[0].clientY;
      isPulling.current = true;
    }
  }, []);

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!isPulling.current || startY.current === null || isRefreshing) return;

      const currentY = e.touches[0].clientY;
      const distance = Math.min(currentY - startY.current, maxPull);

      if (distance > 0) {
        e.preventDefault();
        setPullDistance(distance);
      }
    },
    [maxPull, isRefreshing]
  );

  const handleTouchEnd = useCallback(async () => {
    if (!isPulling.current || isRefreshing) return;

    isPulling.current = false;
    startY.current = null;

    if (pullDistance >= threshold) {
      setIsRefreshing(true);
      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
      }
    }

    setPullDistance(0);
  }, [pullDistance, threshold, onRefresh, isRefreshing]);

  const progress = Math.min(pullDistance / threshold, 1);
  const shouldRefresh = pullDistance >= threshold;

  return {
    pullDistance,
    isRefreshing,
    progress,
    shouldRefresh,
    handlers: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
    },
  };
};
