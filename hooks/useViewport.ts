import { useState, useEffect, useRef } from "react";

interface ViewportInfo {
  width: number;
  height: number;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  safeAreaInsets: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
}

/**
 * Hook for tracking viewport and safe area information
 * Useful for responsive layouts and mobile optimization
 */
export const useViewport = (): ViewportInfo => {
  const [viewport, setViewport] = useState<ViewportInfo>(() => getViewportInfo());

  useEffect(() => {
    const handleResize = () => {
      setViewport(getViewportInfo());
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);

    // Initial update
    handleResize();

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
    };
  }, []);

  return viewport;
};

function getViewportInfo(): ViewportInfo {
  const width = typeof window !== "undefined" ? window.innerWidth : 1024;
  const height = typeof window !== "undefined" ? window.innerHeight : 768;

  // Get safe area insets from CSS variables
  const computedStyle =
    typeof document !== "undefined" ? getComputedStyle(document.documentElement) : null;

  const getSafeArea = (property: string): number => {
    if (!computedStyle) return 0;
    const value = computedStyle.getPropertyValue(property);
    return parseInt(value) || 0;
  };

  return {
    width,
    height,
    isMobile: width < 768,
    isTablet: width >= 768 && width < 1024,
    isDesktop: width >= 1024,
    safeAreaInsets: {
      top: getSafeArea("--sat"),
      bottom: getSafeArea("--sab"),
      left: getSafeArea("--sal"),
      right: getSafeArea("--sar"),
    },
  };
}

interface ScrollInfo {
  scrollY: number;
  scrollX: number;
  scrollDirection: "up" | "down" | "none";
  isAtTop: boolean;
  isAtBottom: boolean;
}

/**
 * Hook for tracking scroll position and direction
 */
export const useScrollInfo = (
  elementRef?: React.RefObject<HTMLElement>,
): ScrollInfo => {
  const [scrollInfo, setScrollInfo] = useState<ScrollInfo>({
    scrollY: 0,
    scrollX: 0,
    scrollDirection: "none",
    isAtTop: true,
    isAtBottom: false,
  });
  const lastScrollY = useRef(0);

  useEffect(() => {
    const element = elementRef?.current || window;

    const handleScroll = () => {
      const scrollY = elementRef?.current?.scrollTop ?? window.scrollY;
      const scrollX = elementRef?.current?.scrollLeft ?? window.scrollX;

      const direction =
        scrollY > lastScrollY.current
          ? "down"
          : scrollY < lastScrollY.current
            ? "up"
            : "none";

      const scrollHeight =
        elementRef?.current?.scrollHeight ?? document.documentElement.scrollHeight;
      const clientHeight = elementRef?.current?.clientHeight ?? window.innerHeight;

      setScrollInfo({
        scrollY,
        scrollX,
        scrollDirection: direction,
        isAtTop: scrollY <= 0,
        isAtBottom: scrollY + clientHeight >= scrollHeight - 10,
      });

      lastScrollY.current = scrollY;
    };

    element.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll(); // Initial call

    return () => {
      element.removeEventListener("scroll", handleScroll);
    };
  }, [elementRef]);

  return scrollInfo;
};
