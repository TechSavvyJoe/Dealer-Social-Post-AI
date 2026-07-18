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

export const ToastProvider: React.FC<ToastProviderProps> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Track auto-dismiss timers so we can clear them on manual close and on
  // unmount — otherwise they fire setState after the provider is gone.
  const timersRef = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: string) => {
    const handle = timersRef.current.get(id);
    if (handle) {
      clearTimeout(handle);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (type: ToastType, message: string, duration: number = 3000) => {
      const id = Math.random().toString(36).substring(2, 9);
      const newToast: Toast = { id, type, message, duration };

      setToasts((prev) => [...prev, newToast]);
      triggerHapticFeedback();

      if (duration > 0) {
        const handle = setTimeout(() => removeToast(id), duration);
        timersRef.current.set(id, handle);
      }
    },
    [removeToast],
  );

  // Clear any still-pending dismiss timers when the provider unmounts.
  React.useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((handle) => clearTimeout(handle));
      timers.clear();
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
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
};

interface ToastContainerProps {
  toasts: Toast[];
  onRemove: (id: string) => void;
}

const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onRemove }) => {
  return (
    <div
      className="fixed bottom-0 right-0 z-[100] p-4 pointer-events-none"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="flex flex-col gap-3 items-end">
        <AnimatePresence mode="popLayout">
          {toasts.map((toast) => (
            <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
};

interface ToastItemProps {
  toast: Toast;
  onRemove: (id: string) => void;
}

const ToastItem: React.FC<ToastItemProps> = ({ toast, onRemove }) => {
  const icons: Record<ToastType, ReactNode> = {
    success: <CheckCircle2 className="w-5 h-5 text-success-500" />,
    error: <XCircle className="w-5 h-5 text-error-500" />,
    warning: <AlertCircle className="w-5 h-5 text-warning-500" />,
    info: <Info className="w-5 h-5 text-info-500" />,
  };

  const typeStyles: Record<ToastType, string> = {
    success: "border-success-500/30 bg-success-500/10",
    error: "border-error-500/30 bg-error-500/10",
    warning: "border-warning-500/30 bg-warning-500/10",
    info: "border-info-500/30 bg-info-500/10",
  };

  return (
    <motion.div
      {...fadeInUp}
      exit={{ opacity: 0, scale: 0.95, y: -10 }}
      transition={{ duration: ANIMATION_DURATIONS.standard }}
      layout
      className={cn(
        "flex items-center gap-3 px-4 py-3 rounded-xl",
        "border backdrop-blur-lg glass pointer-events-auto",
        "shadow-elevation-3 min-w-[280px] max-w-md",
        typeStyles[toast.type],
      )}
      role="alert"
    >
      <div className="flex-shrink-0">{icons[toast.type]}</div>
      <p className="flex-1 text-sm font-medium text-surface-50">{toast.message}</p>
      <button
        onClick={() => onRemove(toast.id)}
        className="flex-shrink-0 text-surface-400 hover:text-surface-200 transition-colors"
        aria-label="Close notification"
      >
        <X className="w-4 h-4" />
      </button>
    </motion.div>
  );
};
