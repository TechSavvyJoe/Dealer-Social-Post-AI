import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, XCircle, AlertCircle, Info, X } from "lucide-react";
import { cn } from "../../utils/classNames";
import { fadeInUp, ANIMATION_DURATIONS } from "../../utils/animations";
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

  return (
    <ToastContext.Provider value={{ showToast, success, error, warning, info }}>
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

const ToastContainer: React.FC<ToastContainerProps> = ({
  toasts,
  onRemove,
  onPause,
  onResume,
}) => {
  return (
    <div
      className="toast-viewport pointer-events-none fixed z-[100]"
      style={{
        width:
          "min(28rem, calc(100vw - max(1rem, var(--sal)) - max(1rem, var(--sar))))",
        right: "max(1rem, var(--sar))",
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
  const icons: Record<ToastType, ReactNode> = {
    success: <CheckCircle2 className="w-5 h-5 text-success-500" />,
    error: <XCircle className="w-5 h-5 text-error-500" />,
    warning: <AlertCircle className="w-5 h-5 text-warning-500" />,
    info: <Info className="w-5 h-5 text-info-500" />,
  };

  const typeStyles: Record<ToastType, string> = {
    success: "border-success-500/40",
    error: "border-error-500/40",
    warning: "border-warning-500/40",
    info: "border-info-500/40",
  };

  return (
    <motion.div
      {...fadeInUp}
      exit={{ opacity: 0, scale: 0.95, y: -10 }}
      transition={{ duration: ANIMATION_DURATIONS.standard }}
      layout
      onMouseEnter={() => onPause(toast.id)}
      onMouseLeave={() => onResume(toast.id)}
      onFocusCapture={() => onPause(toast.id)}
      onBlurCapture={() => onResume(toast.id)}
      className={cn(
        "flex items-center gap-3 px-4 py-3 rounded-xl",
        "border bg-surface-950/95 backdrop-blur-lg pointer-events-auto [.theme-light_&]:bg-white/95",
        "w-full max-w-md shadow-elevation-3",
        typeStyles[toast.type],
      )}
      role={toast.type === "error" || toast.type === "warning" ? "alert" : "status"}
      aria-live={
        toast.type === "error" || toast.type === "warning" ? "assertive" : "polite"
      }
      aria-atomic="true"
    >
      <div className="flex-shrink-0">{icons[toast.type]}</div>
      <p className="flex-1 text-sm font-medium text-white [.theme-light_&]:text-slate-950">
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
        className="-my-2 -mr-2 inline-flex min-h-11 min-w-11 flex-shrink-0 items-center justify-center rounded-lg text-surface-400 transition-colors hover:bg-fill-hover hover:text-surface-200 [.theme-light_&]:text-surface-700"
        aria-label="Close notification"
      >
        <X className="w-4 h-4" />
      </button>
    </motion.div>
  );
};
