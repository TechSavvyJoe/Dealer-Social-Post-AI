import { useCallback, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check } from "lucide-react";

/**
 * Hook for success state animations
 * Shows visual feedback when operations complete successfully
 */
export const useSuccessAnimation = (duration: number = 2000) => {
  const [isSuccess, setIsSuccess] = useState(false);

  const triggerSuccess = useCallback(() => {
    setIsSuccess(true);
    setTimeout(() => setIsSuccess(false), duration);
  }, [duration]);

  return { isSuccess, triggerSuccess };
};

interface SuccessCheckmarkProps {
  isVisible: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

/**
 * Animated success checkmark component
 */
export const SuccessCheckmark: React.FC<SuccessCheckmarkProps> = ({
  isVisible,
  size = "md",
  className = "",
}) => {
  const sizes = {
    sm: { icon: 16, container: 32 },
    md: { icon: 24, container: 48 },
    lg: { icon: 32, container: 64 },
  };

  const { icon, container } = sizes[size];

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0, opacity: 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 25 }}
          className={`flex items-center justify-center rounded-full bg-success-500 ${className}`}
          style={{ width: container, height: container }}
        >
          <motion.div
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ delay: 0.2, duration: 0.3 }}
          >
            <Check size={icon} className="text-white" strokeWidth={3} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
