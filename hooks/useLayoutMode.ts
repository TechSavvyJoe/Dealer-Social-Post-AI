import { useState, useEffect } from "react";

/**
 * One predicate decides the desktop studio layout, shared by the initial
 * render and every listener (the old code used stricter checks on mount than
 * on resize, so the classification could flip after any window drag).
 *
 * Width is the primary signal. The user-agent veto applies only below 1440px
 * and deliberately excludes iPads: a 12.9" iPad Pro in landscape (1366px)
 * is a desk device for this product and gets the full studio. Touch alone is
 * not a veto — every target device has touch.
 */
const computeIsDesktop = (): boolean => {
  if (typeof window === "undefined") return true;
  const width = window.innerWidth;
  if (width < 1200) return false;
  if (width >= 1440) return true;
  // "Mobi" matches the "Mobile" token every phone UA carries (Android
  // included); Android tablets ship neither "Mobile" nor "Tablet", so any
  // Android-specific clause only misclassifies them.
  const uaIsPhone =
    typeof navigator !== "undefined" &&
    /Mobi|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  return !uaIsPhone;
};

export const useLayoutMode = () => {
  const [isDesktopLayout, setIsDesktopLayout] = useState(computeIsDesktop);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => setIsDesktopLayout(computeIsDesktop());

    const mql =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(min-width: 1200px)")
        : null;
    mql?.addEventListener?.("change", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      mql?.removeEventListener?.("change", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return isDesktopLayout;
};
