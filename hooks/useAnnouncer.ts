import { useEffect, useRef } from "react";

/**
 * Hook for screen reader announcements
 * Creates and manages a live region for dynamic content updates
 */
export const useAnnouncer = () => {
  const liveRegionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Create live region if it doesn't exist
    if (!liveRegionRef.current) {
      const liveRegion = document.createElement("div");
      liveRegion.setAttribute("role", "status");
      liveRegion.setAttribute("aria-live", "polite");
      liveRegion.setAttribute("aria-atomic", "true");
      liveRegion.className = "sr-only";
      document.body.appendChild(liveRegion);
      liveRegionRef.current = liveRegion;
    }

    return () => {
      // Cleanup
      if (liveRegionRef.current) {
        document.body.removeChild(liveRegionRef.current);
        liveRegionRef.current = null;
      }
    };
  }, []);

  /**
   * Announce a message to screen readers
   * @param message - The message to announce
   * @param priority - 'polite' (default) or 'assertive'
   */
  const announce = (message: string, priority: "polite" | "assertive" = "polite") => {
    if (!liveRegionRef.current) return;

    // Update aria-live attribute
    liveRegionRef.current.setAttribute("aria-live", priority);

    // Clear previous message
    liveRegionRef.current.textContent = "";

    // Small delay to ensure screen readers pick up the change
    setTimeout(() => {
      if (liveRegionRef.current) {
        liveRegionRef.current.textContent = message;
      }
    }, 100);
  };

  return { announce };
};
