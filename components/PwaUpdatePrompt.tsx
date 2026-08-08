import React, { useEffect, useId, useRef, useState } from "react";
import { RefreshCw, X } from "lucide-react";

interface PwaUpdatePromptProps {
  /** Test hook; production callers should use the environment-based default. */
  enabled?: boolean;
  updateTimeoutMs?: number;
  onReload?: () => void;
  /** Test hook: minimum gap between foreground update checks. */
  foregroundCheckIntervalMs?: number;
}

/**
 * Registers the production service worker and presents an accessible update
 * choice. The prompt does not steal focus from in-progress creation work.
 */
export const PwaUpdatePrompt: React.FC<PwaUpdatePromptProps> = ({
  enabled = !import.meta.env.DEV,
  updateTimeoutMs = 15_000,
  onReload = () => window.location.reload(),
  foregroundCheckIntervalMs = 60_000,
}) => {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const titleId = useId();
  const updateCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!enabled || !("serviceWorker" in navigator)) return;

    let disposed = false;
    let registration: ServiceWorkerRegistration | null = null;
    let installingWorker: ServiceWorker | null = null;

    const offerUpdate = (worker: ServiceWorker | null) => {
      if (!disposed && worker && navigator.serviceWorker.controller) {
        setWaitingWorker((current) => current || worker);
      }
    };
    const handleInstallingStateChange = () => {
      if (installingWorker?.state === "installed") offerUpdate(installingWorker);
    };
    const handleUpdateFound = () => {
      installingWorker?.removeEventListener("statechange", handleInstallingStateChange);
      installingWorker = registration?.installing || null;
      installingWorker?.addEventListener("statechange", handleInstallingStateChange);
    };

    // An installed PWA is resumed from the app switcher far more often than it
    // is launched cold, and registration only checks for a new worker once. A
    // resumed app therefore kept serving the previously cached shell with no
    // banner, so a shipped fix looked like it had not worked. Re-check on
    // foreground. This still never activates on its own — the user decides, so
    // an in-progress post is never discarded underneath them.
    let lastCheck = 0;
    const checkForUpdate = () => {
      if (disposed || !registration || document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastCheck < foregroundCheckIntervalMs) return;
      lastCheck = now;
      // A worker that finished installing while we were backgrounded is already
      // waiting and fires no further `updatefound`.
      offerUpdate(registration.waiting);
      void registration.update().catch(() => undefined);
    };

    void navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((nextRegistration) => {
        if (disposed) return;
        registration = nextRegistration;
        lastCheck = Date.now();
        offerUpdate(nextRegistration.waiting);
        nextRegistration.addEventListener("updatefound", handleUpdateFound);
      })
      .catch((error) => console.warn("[sw] registration failed", error));

    document.addEventListener("visibilitychange", checkForUpdate);
    window.addEventListener("focus", checkForUpdate);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", checkForUpdate);
      window.removeEventListener("focus", checkForUpdate);
      registration?.removeEventListener("updatefound", handleUpdateFound);
      installingWorker?.removeEventListener("statechange", handleInstallingStateChange);
      updateCleanupRef.current?.();
    };
  }, [enabled, foregroundCheckIntervalMs]);

  const applyUpdate = () => {
    if (!waitingWorker || isUpdating) return;
    updateCleanupRef.current?.();
    setUpdateError(null);
    setIsUpdating(true);
    let settled = false;
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        handleControllerChange,
      );
      waitingWorker.removeEventListener("statechange", handleWorkerStateChange);
      if (updateCleanupRef.current === cleanup) updateCleanupRef.current = null;
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      setIsUpdating(false);
      setUpdateError("Update could not finish. Check your connection and try again.");
    };
    const handleControllerChange = () => {
      if (settled) return;
      settled = true;
      cleanup();
      onReload();
    };
    const handleWorkerStateChange = () => {
      if (waitingWorker.state === "redundant") fail();
    };
    const timeoutId = window.setTimeout(fail, updateTimeoutMs);
    updateCleanupRef.current = cleanup;
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      handleControllerChange,
    );
    waitingWorker.addEventListener("statechange", handleWorkerStateChange);
    try {
      waitingWorker.postMessage({ type: "SKIP_WAITING" });
    } catch {
      fail();
    }
  };

  if (!waitingWorker) return null;

  return (
    <section
      role="region"
      aria-labelledby={titleId}
      className="fixed left-1/2 z-[110] flex max-w-[30rem] -translate-x-1/2 flex-wrap items-center gap-3 rounded-2xl border border-primary-300/30 bg-surface-900/95 p-3 text-surface-50 shadow-elevation-4 backdrop-blur-xl"
      style={{
        width: "calc(100% - max(1rem, var(--sal)) - max(1rem, var(--sar)))",
        bottom: "max(1rem, var(--sab))",
        marginLeft: "calc((var(--sal) - var(--sar)) / 2)",
      }}
    >
      <span className="sr-only" role="status" aria-live="polite">
        A new application version is ready.
      </span>
      <RefreshCw className="h-5 w-5 shrink-0 text-primary-300" aria-hidden="true" />
      <div className="min-w-32 flex-1">
        <p id={titleId} className="text-sm font-semibold">
          A new version is ready
        </p>
        <p className="text-xs text-surface-300">
          Update now, or finish your current work and update later.
        </p>
        {updateError && (
          <p className="mt-1 text-xs text-error-200" role="alert">
            {updateError}
          </p>
        )}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={applyUpdate}
          disabled={isUpdating}
          className="min-h-11 rounded-xl bg-primary-500 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-400 disabled:cursor-wait disabled:opacity-70"
        >
          {isUpdating ? "Updating…" : "Update"}
        </button>
        <button
          type="button"
          onClick={() => {
            updateCleanupRef.current?.();
            setWaitingWorker(null);
            setIsUpdating(false);
            setUpdateError(null);
          }}
          disabled={isUpdating}
          aria-label="Update later"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-surface-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
};
