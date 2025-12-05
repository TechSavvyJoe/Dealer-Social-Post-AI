import React from "react";
import { motion } from "framer-motion";
import { cn } from "../../utils/classNames";

interface LoadingDotsProps {
  size?: "sm" | "md" | "lg";
  color?: string;
  className?: string;
}

/**
 * Animated loading dots
 */
export const LoadingDots: React.FC<LoadingDotsProps> = ({
  size = "md",
  color = "bg-primary-500",
  className,
}) => {
  const sizes = {
    sm: "w-1.5 h-1.5",
    md: "w-2 h-2",
    lg: "w-3 h-3",
  };

  const dotSize = sizes[size];

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className={cn("rounded-full", dotSize, color)}
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.5, 1, 0.5],
          }}
          transition={{
            duration: 1,
            repeat: Infinity,
            delay: i * 0.2,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
};

interface PulseRingProps {
  size?: number;
  color?: string;
  className?: string;
}

/**
 * Pulsing ring animation for active states
 */
export const PulseRing: React.FC<PulseRingProps> = ({
  size = 40,
  color = "rgba(59, 130, 246, 0.4)",
  className,
}) => {
  return (
    <motion.div
      className={cn("absolute rounded-full pointer-events-none", className)}
      style={{
        width: size,
        height: size,
        backgroundColor: color,
      }}
      animate={{
        scale: [1, 1.5, 2],
        opacity: [0.6, 0.3, 0],
      }}
      transition={{
        duration: 2,
        repeat: Infinity,
        ease: "easeOut",
      }}
    />
  );
};

interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

/**
 * Premium spinning loader
 */
export const Spinner: React.FC<SpinnerProps> = ({ size = "md", className }) => {
  const sizes = {
    sm: "w-4 h-4 border-2",
    md: "w-6 h-6 border-2",
    lg: "w-8 h-8 border-3",
  };

  return (
    <motion.div
      className={cn(
        "rounded-full border-primary-500/30 border-t-primary-500",
        sizes[size],
        className
      )}
      animate={{ rotate: 360 }}
      transition={{
        duration: 0.8,
        repeat: Infinity,
        ease: "linear",
      }}
    />
  );
};

interface GlowProps {
  color?: string;
  size?: number;
  className?: string;
}

/**
 * Animated glow effect
 */
export const AnimatedGlow: React.FC<GlowProps> = ({
  color = "rgba(59, 130, 246, 0.5)",
  size = 200,
  className,
}) => {
  return (
    <motion.div
      className={cn(
        "absolute rounded-full blur-3xl pointer-events-none",
        className
      )}
      style={{
        width: size,
        height: size,
        backgroundColor: color,
      }}
      animate={{
        scale: [1, 1.2, 1],
        opacity: [0.3, 0.5, 0.3],
      }}
      transition={{
        duration: 4,
        repeat: Infinity,
        ease: "easeInOut",
      }}
    />
  );
};
