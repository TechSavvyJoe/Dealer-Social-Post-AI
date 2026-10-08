/** Keep an installed phone app on the visible screen after launch or rotation. */
export const installViewportShell = (): (() => void) => {
  const displayMode = window.matchMedia("(display-mode: standalone)");
  const viewport = window.visualViewport;
  const update = () => {
    const installed =
      displayMode.matches ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    const root = document.documentElement;
    root.dataset.appDisplay = installed ? "standalone" : "browser";
    // Pinch zoom must retain its enlarged canvas and normal accessibility behavior.
    if (!installed) {
      root.style.removeProperty("--app-viewport-height");
      return;
    }
    if (viewport && viewport.scale !== 1) return;
    const height = viewport?.height || window.innerHeight;
    if (height > 0) root.style.setProperty("--app-viewport-height", `${height}px`);
  };
  update();
  viewport?.addEventListener("resize", update);
  window.addEventListener("resize", update);
  window.addEventListener("orientationchange", update);
  displayMode.addEventListener?.("change", update);
  return () => {
    viewport?.removeEventListener("resize", update);
    window.removeEventListener("resize", update);
    window.removeEventListener("orientationchange", update);
    displayMode.removeEventListener?.("change", update);
  };
};
