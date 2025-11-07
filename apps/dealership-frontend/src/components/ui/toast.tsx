import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useUIStore } from '../../stores/uiStore';

export interface ToastProps {
  id: string;
  title?: string;
  description?: string;
  variant?: 'default' | 'destructive' | 'success';
  onClose: () => void;
}

const Toast = React.forwardRef<HTMLDivElement, ToastProps>(
  ({ id, title, description, variant = 'default', onClose }, ref) => {
    return (
      <motion.div
        ref={ref}
        layout
        initial={{ opacity: 0, y: -20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -20, scale: 0.95 }}
        className={cn(
          'pointer-events-auto w-full max-w-sm overflow-hidden rounded-lg border shadow-lg',
          {
            'bg-background border-border': variant === 'default',
            'bg-destructive border-destructive text-destructive-foreground':
              variant === 'destructive',
            'bg-green-500 border-green-600 text-white': variant === 'success',
          }
        )}
      >
        <div className="flex items-start gap-3 p-4">
          <div className="flex-1">
            {title && <div className="text-sm font-semibold">{title}</div>}
            {description && (
              <div className={cn('text-sm', title && 'mt-1', 'opacity-90')}>
                {description}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 hover:bg-black/10 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </motion.div>
    );
  }
);
Toast.displayName = 'Toast';

export const Toaster = () => {
  const { toasts, removeToast } = useUIStore();

  return (
    <div className="fixed top-0 right-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:top-auto sm:bottom-0 sm:right-0 sm:flex-col md:max-w-[420px]">
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            {...toast}
            onClose={() => removeToast(toast.id)}
          />
        ))}
      </AnimatePresence>
    </div>
  );
};

export { Toast };
