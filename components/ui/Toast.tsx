import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  ReactNode,
} from "react";
import { m, AnimatePresence } from "framer-motion";
import { Check, AlertCircle, AlertTriangle, X } from "lucide-react";
import { cn } from "../../utils/classNames";
import { triggerHapticFeedback } from "../../utils/haptics";

type ToastType = "success" | "error" | "warning" | "info";

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
  revision: number;
}

interface ToastContextValue {
  showToast: (type: ToastType, message: string, duration?: number) => void;
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  warning: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
};

interface ToastProviderProps {
  children: ReactNode;
}

interface ToastTimer {
  handle: ReturnType<typeof setTimeout> | null;
  remaining: number;
  startedAt: number;
  paused: boolean;
}

const DEFAULT_TOAST_DURATIONS: Record<ToastType, number> = {
  success: 5000,
  info: 6000,
  warning: 8000,
  // Errors stay until the user acknowledges them.
  error: 0,
};

export const ToastProvider: React.FC<ToastProviderProps> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Track auto-dismiss timers so we can clear them on manual close and on
  // unmount — otherwise they fire setState after the provider is gone.
  const timersRef = React.useRef<Map<string, ToastTimer>>(new Map());
  const pauseDepthRef = React.useRef<Map<string, number>>(new Map());
  const toastIdsByKeyRef = React.useRef<Map<string, string>>(new Map());
  const toastKeysByIdRef = React.useRef<Map<string, string>>(new Map());
  const toastRevisionsRef = React.useRef<Map<string, number>>(new Map());

  const removeToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer?.handle) {
      clearTimeout(timer.handle);
    }
    timersRef.current.delete(id);
    pauseDepthRef.current.delete(id);
    toastRevisionsRef.current.delete(id);
    const key = toastKeysByIdRef.current.get(id);
    if (key) {
      toastKeysByIdRef.current.delete(id);
      if (toastIdsByKeyRef.current.get(key) === id) {
        toastIdsByKeyRef.current.delete(key);
      }
    }
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (type: ToastType, message: string, duration?: number) => {
      const resolvedDuration = duration ?? DEFAULT_TOAST_DURATIONS[type];
      const key = `${type}\u0000${message}`;
      const existingId = toastIdsByKeyRef.current.get(key);
      const id = existingId || Math.random().toString(36).substring(2, 9);
      const revision = (toastRevisionsRef.current.get(id) || 0) + 1;
      const newToast: Toast = {
        id,
        type,
        message,
        duration: resolvedDuration,
        revision,
      };

      const existingTimer = timersRef.current.get(id);
      const remainsPaused =
        (pauseDepthRef.current.get(id) || 0) > 0 || existingTimer?.paused === true;
      if (existingTimer?.handle) {
        clearTimeout(existingTimer.handle);
      }
      timersRef.current.delete(id);
      if (!existingId) pauseDepthRef.current.delete(id);
      toastIdsByKeyRef.current.set(key, id);
      toastKeysByIdRef.current.set(id, key);
      toastRevisionsRef.current.set(id, revision);
      setToasts((prev) => [...prev.filter((toast) => toast.id !== id), newToast]);
      triggerHapticFeedback();

      if (resolvedDuration > 0) {
        const handle = remainsPaused
          ? null
          : setTimeout(() => removeToast(id), resolvedDuration);
        timersRef.current.set(id, {
          handle,
          remaining: resolvedDuration,
          startedAt: Date.now(),
          paused: remainsPaused,
        });
      }
    },
    [removeToast],
  );

  const pauseToast = useCallback((id: string) => {
    const pauseDepth = (pauseDepthRef.current.get(id) || 0) + 1;
    pauseDepthRef.current.set(id, pauseDepth);
    if (pauseDepth > 1) return;
    const timer = timersRef.current.get(id);
    if (!timer || timer.paused) return;
    if (timer.handle) clearTimeout(timer.handle);
    timersRef.current.set(id, {
      ...timer,
      handle: null,
      remaining: Math.max(0, timer.remaining - (Date.now() - timer.startedAt)),
      paused: true,
    });
  }, []);

  const resumeToast = useCallback(
    (id: string) => {
      const pauseDepth = Math.max(0, (pauseDepthRef.current.get(id) || 0) - 1);
      if (pauseDepth > 0) {
        pauseDepthRef.current.set(id, pauseDepth);
        return;
      }
      pauseDepthRef.current.delete(id);
      const timer = timersRef.current.get(id);
      if (!timer || !timer.paused) return;
      if (timer.remaining <= 0) {
        removeToast(id);
        return;
      }
      if (timer.handle) clearTimeout(timer.handle);
      const handle = setTimeout(() => removeToast(id), timer.remaining);
      timersRef.current.set(id, {
        handle,
        remaining: timer.remaining,
        startedAt: Date.now(),
        paused: false,
      });
    },
    [removeToast],
  );

  // Clear any still-pending dismiss timers when the provider unmounts.
  React.useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => {
        if (timer.handle) clearTimeout(timer.handle);
      });
      timers.clear();
      toastIdsByKeyRef.current.clear();
      toastKeysByIdRef.current.clear();
      toastRevisionsRef.current.clear();
    };
  }, []);

  const success = useCallback(
    (message: string, duration?: number) => showToast("success", message, duration),
    [showToast],
  );

  const error = useCallback(
    (message: string, duration?: number) => showToast("error", message, duration),
    [showToast],
  );

  const warning = useCallback(
    (message: string, duration?: number) => showToast("warning", message, duration),
    [showToast],
  );

  const info = useCallback(
    (message: string, duration?: number) => showToast("info", message, duration),
    [showToast],
  );

  // Memoized so toast state changes (show/auto-dismiss) don't hand every
  // useToast consumer a fresh context value and re-render the whole app.
  const contextValue = useMemo(
    () => ({ showToast, success, error, warning, info }),
    [showToast, success, error, warning, info],
  );

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <ToastContainer
        toasts={toasts}
        onRemove={removeToast}
        onPause={pauseToast}
        onResume={resumeToast}
      />
    </ToastContext.Provider>
  );
};

interface ToastContainerProps {
  toasts: Toast[];
  onRemove: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
}

/** Below lg (1024px) the Post screen is a single column with a fixed share
 *  bar, so a bottom-docked toast lands on the creative rather than beside it. */
const PHONE_VIEWPORT_QUERY = "(max-width: 1023px)";
/**
 * The result screen's media preview declares itself. Toasts are the only
 * fixed overlay that can land on it, so they measure it and step aside — a
 * salesperson must never be shown a notification sitting on the customers'
 * faces in the photo they are about to post.
 */
const MEDIA_PREVIEW_SELECTOR = '[role="region"][aria-label="Media preview"]';
const MEDIA_PREVIEW_GAP = 10;
/** Below this, a docked stack would be clipped to nothing; keep the default. */
const MIN_TOAST_SPACE = 72;

type ToastOffsets = Pick<
  React.CSSProperties,
  "top" | "bottom" | "maxHeight" | "overflow"
>;

const usePhoneViewport = (): boolean => {
  const readMatches = () =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(PHONE_VIEWPORT_QUERY).matches;
  const [isPhone, setIsPhone] = useState(readMatches);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mql = window.matchMedia(PHONE_VIEWPORT_QUERY);
    const update = () => setIsPhone(mql.matches);
    update();
    mql.addEventListener?.("change", update);
    return () => mql.removeEventListener?.("change", update);
  }, []);

  return isPhone;
};

/**
 * Dock the stack into whichever gap around the media preview is larger, so it
 * can never overlap. Returns null when there is nothing to avoid, which leaves
 * the `.toast-viewport` stylesheet rule (bottom-docked, clear of the sticky
 * delivery bar) in charge.
 */
const computeMediaSafeOffsets = (): ToastOffsets | null => {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  const preview = document.querySelector(MEDIA_PREVIEW_SELECTOR);
  if (!preview) return null;
  const rect = preview.getBoundingClientRect();
  const viewportHeight = window.innerHeight || 0;
  if (!viewportHeight || (rect.width === 0 && rect.height === 0)) return null;

  const spaceAbove = rect.top;
  const spaceBelow = viewportHeight - rect.bottom;
  // Nothing usable on either side (the preview fills the screen): showing a
  // clipped sliver would be worse than the default placement.
  if (Math.max(spaceAbove, spaceBelow) < MIN_TOAST_SPACE) return null;
  if (spaceBelow >= spaceAbove) {
    return {
      top: Math.max(MEDIA_PREVIEW_GAP, rect.bottom + MEDIA_PREVIEW_GAP),
      bottom: "auto",
      // A tall stack must clip rather than grow back over the creative.
      maxHeight: Math.max(0, spaceBelow - MEDIA_PREVIEW_GAP * 2),
      overflow: "hidden",
    };
  }
  return {
    top: "auto",
    bottom: Math.max(MEDIA_PREVIEW_GAP, viewportHeight - rect.top + MEDIA_PREVIEW_GAP),
    maxHeight: Math.max(0, spaceAbove - MEDIA_PREVIEW_GAP * 2),
    overflow: "hidden",
  };
};

const ToastContainer: React.FC<ToastContainerProps> = ({
  toasts,
  onRemove,
  onPause,
  onResume,
}) => {
  const isPhone = usePhoneViewport();
  const [mediaSafeOffsets, setMediaSafeOffsets] = useState<ToastOffsets | null>(null);
  const hasToasts = toasts.length > 0;

  useEffect(() => {
    if (!isPhone || !hasToasts) {
      setMediaSafeOffsets(null);
      return;
    }
    const measure = () => setMediaSafeOffsets(computeMediaSafeOffsets());
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("orientationchange", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("orientationchange", measure);
    };
  }, [hasToasts, isPhone]);

  return (
    <div
      className="toast-viewport pointer-events-none fixed z-[100]"
      style={{
        width:
          "min(28rem, calc(100vw - max(1rem, var(--sal)) - max(1rem, var(--sar))))",
        right: "max(1rem, var(--sar))",
        ...(mediaSafeOffsets ?? {}),
      }}
    >
      <div className="flex flex-col gap-3 items-end">
        <AnimatePresence mode="popLayout">
          {toasts.map((toast) => (
            <ToastItem
              key={toast.id}
              toast={toast}
              onRemove={onRemove}
              onPause={onPause}
              onResume={onResume}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
};

interface ToastItemProps {
  toast: Toast;
  onRemove: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
}

const ToastItem: React.FC<ToastItemProps> = ({
  toast,
  onRemove,
  onPause,
  onResume,
}) => {
  const icons: Partial<Record<ToastType, ReactNode>> = {
    success: <Check className="w-5 h-5 text-success-ink" />,
    error: <AlertCircle className="w-5 h-5 text-error-ink" />,
    // A warning (prohibited-claims, delivery/share gates) must not read as an
    // info notice; the icon is what separates them, the surface stays neutral.
    warning: <AlertTriangle className="w-5 h-5 text-warning-ink" />,
  };

  return (
    <m.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.18 }}
      onMouseEnter={() => onPause(toast.id)}
      onMouseLeave={() => onResume(toast.id)}
      onFocusCapture={() => onPause(toast.id)}
      onBlurCapture={() => onResume(toast.id)}
      className={cn(
        "flex items-center gap-3 px-4 py-3 rounded-md",
        "border border-hairline bg-overlay pointer-events-auto",
        "w-full max-w-md shadow-dialog text-ink",
      )}
      role={toast.type === "error" || toast.type === "warning" ? "alert" : "status"}
      aria-live={
        toast.type === "error" || toast.type === "warning" ? "assertive" : "polite"
      }
      aria-atomic="true"
    >
      {icons[toast.type] && <div className="flex-shrink-0">{icons[toast.type]}</div>}
      <p className="flex-1 text-sm font-medium text-ink">
        {toast.message}
        {toast.revision > 1 ? (
          <span className="sr-only">
            {" "}
            Notification repeated {toast.revision} times.
          </span>
        ) : null}
      </p>
      <button
        type="button"
        onClick={() => onRemove(toast.id)}
        className="-my-2 -mr-2 inline-flex min-h-11 min-w-11 flex-shrink-0 items-center justify-center rounded-sm text-ink-hint transition-colors duration-120 ease-out hover:bg-fill-hover hover:text-ink"
        aria-label="Close notification"
      >
        <X className="w-4 h-4" />
      </button>
    </m.div>
  );
};
