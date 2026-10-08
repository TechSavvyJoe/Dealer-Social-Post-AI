const editingText = (): boolean => {
  const element = document.activeElement;
  return (
    element instanceof HTMLElement &&
    (element.isContentEditable ||
      element instanceof HTMLTextAreaElement ||
      (element instanceof HTMLInputElement &&
        ["text", "search", "email", "tel", "url", "password", "number"].includes(
          element.type,
        )))
  );
};

/** Keep an installed app on the full screen, including iOS cold-start/resume. */
export const installViewportShell = (): (() => void) => {
  const displayMode = window.matchMedia("(display-mode: standalone)");
  const viewport = window.visualViewport;
  const appleInstalled = Boolean(
    (navigator as Navigator & { standalone?: boolean }).standalone,
  );
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
    const visibleHeight = viewport?.height || window.innerHeight;
    let height = visibleHeight;
    if (appleInstalled) {
      // iOS standalone can under-report both viewport heights by the status
      // bar/browser inset after launch, resume or rotation. Its screen is the
      // full-screen canvas; safe insets belong to the root and action bars.
      // Do not infer orientation from innerHeight: the keyboard changes it.
      const shortSide = Math.min(window.screen.width, window.screen.height);
      const longSide = Math.max(window.screen.width, window.screen.height);
      // Orientation events/angles can also remain stale during resume. Width
      // identifies the long axis without depending on the keyboard's height.
      const landscape = shortSide > 0 && window.innerWidth > shortSide * 1.2;
      const screenHeight = landscape ? shortSide : longSide;
      if (screenHeight > 0) {
        // Only a focused editor and a substantial reduction mean a keyboard.
        // A stale short viewport with no editor must not shrink the whole app.
        const keyboardVisible = editingText() && screenHeight - visibleHeight > 150;
        height = keyboardVisible ? visibleHeight : screenHeight;
      }
    }
    if (height > 0) root.style.setProperty("--app-viewport-height", `${height}px`);
  };
  const resume = () => {
    if (document.visibilityState !== "hidden") update();
  };
  const focus = () => {
    update();
    // WebKit may pan the document to an editor despite the inner scrollport.
    // Keep the outer shell at its origin; the editor's own scrollport scrolls.
    if (appleInstalled && viewport?.scale === 1) window.scrollTo(0, 0);
  };
  update();
  viewport?.addEventListener("resize", update);
  window.addEventListener("resize", update);
  window.addEventListener("orientationchange", update);
  window.addEventListener("pageshow", update);
  document.addEventListener("visibilitychange", resume);
  document.addEventListener("focusin", focus);
  document.addEventListener("focusout", focus);
  displayMode.addEventListener?.("change", update);
  return () => {
    viewport?.removeEventListener("resize", update);
    window.removeEventListener("resize", update);
    window.removeEventListener("orientationchange", update);
    window.removeEventListener("pageshow", update);
    document.removeEventListener("visibilitychange", resume);
    document.removeEventListener("focusin", focus);
    document.removeEventListener("focusout", focus);
    displayMode.removeEventListener?.("change", update);
  };
};
