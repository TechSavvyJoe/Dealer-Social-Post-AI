import React from "react";
import { motion } from "framer-motion";
import { Icon } from "./Icons";
import { cn } from "../utils/classNames";

interface DialpadProps {
  onKeyPress: (
    key:
      | "1"
      | "2"
      | "3"
      | "4"
      | "5"
      | "6"
      | "7"
      | "8"
      | "9"
      | "0"
      | "backspace"
      | "clear"
  ) => void;
}

const DialpadButton: React.FC<{
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
  delay?: number;
  ariaLabel?: string;
}> = ({ onClick, children, className = "", delay = 0, ariaLabel }) => (
  <motion.button
    type="button"
    onClick={onClick}
    aria-label={ariaLabel}
    className={cn(
      // Base styles
      "flex items-center justify-center",
      "w-16 h-16 sm:w-20 sm:h-20",
      "rounded-2xl",
      // Colors with glass effect
      "bg-white/[0.06] backdrop-blur-sm",
      "border border-white/[0.08]",
      // Text styles
      "text-white font-semibold text-xl sm:text-2xl",
      // Hover states
      "hover:bg-white/[0.12] hover:border-white/[0.15]",
      "hover:shadow-lg hover:shadow-white/[0.05]",
      // Active/pressed state
      "active:bg-white/[0.18] active:scale-[0.96]",
      // Transitions
      "transition-all duration-200 ease-out",
      // Focus state
      "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-900",
      // Touch handling
      "touch-manipulation select-none",
      className
    )}
    initial={{ opacity: 0, scale: 0.8 }}
    animate={{ opacity: 1, scale: 1 }}
    transition={{
      delay,
      duration: 0.2,
      type: "spring",
      stiffness: 400,
      damping: 25,
    }}
    whileTap={{ scale: 0.94 }}
    whileHover={{ scale: 1.05 }}
  >
    {children}
  </motion.button>
);

export const Dialpad: React.FC<DialpadProps> = ({ onKeyPress }) => {
  const buttons = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

  return (
    <div
      className="flex flex-col items-center gap-3"
      role="group"
      aria-label="Dealer code keypad"
    >
      {/* Number grid */}
      <div className="grid grid-cols-3 gap-3">
        {buttons.map((num, index) => (
          <DialpadButton
            key={num}
            onClick={() => onKeyPress(num as any)}
            delay={0.05 + index * 0.02}
            ariaLabel={`Digit ${num}`}
          >
            {num}
          </DialpadButton>
        ))}
      </div>

      {/* Bottom row with 0 and backspace */}
      <div className="grid grid-cols-3 gap-3">
        {/* Empty cell */}
        <div className="w-16 h-16 sm:w-20 sm:h-20" aria-hidden="true" />

        {/* Zero button */}
        <DialpadButton
          onClick={() => onKeyPress("0")}
          delay={0.25}
          ariaLabel="Digit 0"
        >
          0
        </DialpadButton>

        {/* Backspace button */}
        <DialpadButton
          onClick={() => onKeyPress("backspace")}
          delay={0.27}
          ariaLabel="Delete last digit"
          className="text-surface-400 hover:text-white"
        >
          <Icon type="backspace" className="w-6 h-6" aria-hidden="true" />
        </DialpadButton>
      </div>
    </div>
  );
};
