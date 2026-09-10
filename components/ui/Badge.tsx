import React from "react";
import { m, HTMLMotionProps } from "framer-motion";
import { cn } from "../../utils/classNames";

type Variant = "primary" | "success" | "warning" | "error" | "info" | "neutral";
type Size = "sm" | "md" | "lg";

/**
 * The -300 ink is tuned for the dark theme, where it sits on a dark surface. In
 * Sunlight Mode the 15%-tinted fill resolves to near-white, so -300 ink drops to
 * roughly 1.6:1 and the badge renders as an empty capsule (observed on the
 * "Verified" pill in the customizer). Each variant therefore carries a
 * light-theme override at -800, which clears AA on the same fill.
 */
const variantStyles: Record<Variant, string> = {
  primary:
    "bg-primary-500/15 text-primary-300 border border-primary-500/30 [.theme-light_&]:text-primary-800",
  success:
    "bg-success-500/15 text-success-300 border border-success-500/30 [.theme-light_&]:text-success-800",
  warning:
    "bg-warning-500/15 text-warning-300 border border-warning-500/30 [.theme-light_&]:text-warning-800",
  error:
    "bg-error-500/15 text-error-300 border border-error-500/30 [.theme-light_&]:text-error-800",
  info: "bg-info-500/15 text-info-300 border border-info-500/30 [.theme-light_&]:text-info-800",
  neutral:
    "bg-surface-800 text-surface-300 border border-surface-700 [.theme-light_&]:text-surface-800",
};

const sizeStyles: Record<Size, string> = {
  sm: "text-[10px] px-2 py-0.5 gap-1",
  md: "text-xs px-2.5 py-1 gap-1.5",
  lg: "text-sm px-3 py-1.5 gap-2",
};

const dotStyles: Record<Variant, string> = {
  primary: "bg-primary-400",
  success: "bg-success-400",
  warning: "bg-warning-400",
  error: "bg-error-400",
  info: "bg-info-400",
  neutral: "bg-surface-400",
};

interface BadgeProps extends Omit<HTMLMotionProps<"span">, "ref"> {
  /** Badge color variant */
  variant?: Variant;
  /** Badge size */
  size?: Size;
  /** Show animated dot indicator */
  dot?: boolean;
  /** Animate the dot (pulse effect) */
  pulse?: boolean;
  /** Uppercase the label. Defaults to true for status chips; pass false for
   *  descriptive labels so they don't read as shouty. */
  uppercase?: boolean;
}

/**
 * Badge component for status indicators and labels.
 * Features smooth animations and optional dot indicator.
 *
 * @example
 * <Badge variant="success" dot pulse>Active</Badge>
 * <Badge variant="warning">Pending</Badge>
 */
export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  (
    {
      className,
      variant = "neutral",
      size = "md",
      dot = false,
      pulse = false,
      uppercase = true,
      children,
      ...props
    },
    ref,
  ) => (
    <m.span
      ref={ref}
      className={cn(
        "inline-flex items-center",
        "rounded-full",
        "font-semibold tracking-wider",
        uppercase && "uppercase",
        "transition-all duration-200",
        variantStyles[variant],
        sizeStyles[size],
        className,
      )}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      {...props}
    >
      {dot && (
        <span
          className={cn(
            "rounded-full",
            size === "sm" && "w-1.5 h-1.5",
            size === "md" && "w-2 h-2",
            size === "lg" && "w-2.5 h-2.5",
            dotStyles[variant],
            pulse && "animate-pulse-soft",
          )}
          aria-hidden="true"
        />
      )}
      {children as React.ReactNode}
    </m.span>
  ),
);

Badge.displayName = "Badge";
