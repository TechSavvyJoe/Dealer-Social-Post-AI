import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus } from "lucide-react";
import { triggerHapticFeedback } from "../../utils/haptics";
import { cn } from "../../utils/classNames";

interface FABAction {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  variant?: "default" | "danger" | "success";
}

interface FABProps {
  mainIcon?: React.ReactNode;
  actions?: FABAction[];
  onClick?: () => void;
  className?: string;
  position?: "bottom-right" | "bottom-left" | "bottom-center";
  show?: boolean;
}

export const FAB: React.FC<FABProps> = ({
  mainIcon = <Plus className="w-6 h-6" />,
  actions = [],
  onClick,
  className,
  position = "bottom-right",
  show = true,
}) => {
  const [isOpen, setIsOpen] = React.useState(false);

  const toggleOpen = () => {
    triggerHapticFeedback();
    if (actions.length > 0) {
      setIsOpen(!isOpen);
    } else {
      onClick?.();
    }
  };

  const positionClasses = {
    "bottom-right": "bottom-6 right-6",
    "bottom-left": "bottom-6 left-6",
    "bottom-center": "bottom-6 left-1/2 -translate-x-1/2",
  };

  return (
    <AnimatePresence>
      {show && (
        <div
          className={cn(
            "fixed z-40 flex flex-col items-end gap-4 pointer-events-none",
            positionClasses[position],
            className,
          )}
        >
          {/* Secondary Actions */}
          <AnimatePresence>
            {isOpen &&
              actions.map((action, index) => (
                <motion.button
                  key={index}
                  initial={{ opacity: 0, scale: 0.8, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.8, y: 10 }}
                  transition={{ delay: index * 0.05 }}
                  onClick={() => {
                    triggerHapticFeedback();
                    action.onClick();
                    setIsOpen(false);
                  }}
                  className={cn(
                    "pointer-events-auto flex items-center gap-3 px-4 py-2 rounded-full shadow-lg backdrop-blur-md border border-white/10",
                    "text-sm font-semibold text-white",
                    action.variant === "danger"
                      ? "bg-error-500/80 hover:bg-error-600"
                      : action.variant === "success"
                        ? "bg-success-500/80 hover:bg-success-600"
                        : "bg-surface-800/80 hover:bg-surface-700",
                  )}
                >
                  {action.label}
                  <div className="w-5 h-5 flex items-center justify-center">
                    {action.icon}
                  </div>
                </motion.button>
              ))}
          </AnimatePresence>

          {/* Main FAB */}
          <motion.button
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            exit={{ scale: 0, rotate: -180 }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={toggleOpen}
            className={cn(
              "pointer-events-auto w-14 h-14 rounded-full flex items-center justify-center shadow-xl shadow-primary-900/20",
              "bg-gradient-to-br from-primary-500 to-secondary-600 text-white",
              "border border-white/20 backdrop-blur-sm transition-shadow hover:shadow-glow-primary",
              actions.length > 0 && isOpen && "rotate-45",
            )}
            style={{ WebkitTapHighlightColor: "transparent" }}
          >
            {mainIcon}
          </motion.button>
        </div>
      )}
    </AnimatePresence>
  );
};
