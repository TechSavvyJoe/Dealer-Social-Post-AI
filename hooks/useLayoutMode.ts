import { useState, useEffect } from 'react';

export const useLayoutMode = () => {
  const [isDesktopLayout, setIsDesktopLayout] = useState(() => {
    if (typeof window === 'undefined') return true;
    const pointerFine = typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: fine)').matches : true;
    const canHover = typeof window.matchMedia === 'function' ? window.matchMedia('(hover: hover)').matches : true;
    const uaIsMobile = typeof navigator !== 'undefined'
      ? /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
      : false;
    const hasTouch = ('ontouchstart' in window || navigator.maxTouchPoints > 0);
    const isWideScreen = window.innerWidth >= 1200;
    return isWideScreen && pointerFine && canHover && !uaIsMobile && (!hasTouch || window.innerWidth >= 1440);
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const updateLayoutMode = () => {
      const uaIsMobile = /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      const hasTouch = ('ontouchstart' in window || navigator.maxTouchPoints > 0);
      const isWideScreen = window.innerWidth >= 1200;
      const isDesktop = isWideScreen && !uaIsMobile && (!hasTouch || window.innerWidth >= 1440);
      setIsDesktopLayout(isDesktop);
    };
    window.addEventListener('resize', updateLayoutMode);
    return () => window.removeEventListener('resize', updateLayoutMode);
  }, []);

  return isDesktopLayout;
};
