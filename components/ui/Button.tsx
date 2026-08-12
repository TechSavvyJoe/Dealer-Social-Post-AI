import React from "react";
import { motion, type HTMLMotionProps } from "framer-motion";
import { Loader2 } from "lucide-react";
import { cn } from "../../utils/classNames";
import { triggerHapticFeedback } from "../../utils/haptics";
import { SPRING_CONFIGS, shouldReduceMotion } from "../../utils/animations";

/**
 * Button variants — DEALER TRUST system: flat fills, hairline borders, no
 * gradients, no glow, motion limited to a tap compression. The historical
 * variant names are kept as aliases so no call site churns:
 * - filled / primary: solid brand action
 * - tinted / secondary: brand-tinted secondary action
 * - plain / ghost: text-only tertiary action
 * - outline: hairline-bordered alternative action
 * - danger: destructive action (solid red)
 * - gradient-sky: legacy alias of filled
 * - gradient-teal: legacy alias — now a solid success button
 */
type Variant =
  | "filled"
  | "tinted"
  | "plain"
  | "outline"
  | "danger"
  | "gradient-sky"
  | "gradient-teal"
  | "primary"
  | "secondary"
  | "ghost";

/**
 * Size options following Apple HIG (44px minimum touch target)
 */
type Size = "sm" | "md" | "lg" | "icon" | "xs";

interface ButtonProps extends Omit<HTMLMotionProps<"button">, "size"> {
  /** Button style variant */
  variant?: Variant;
  /** Button size */
  size?: Size;
  /** Show loading spinner */
  loading?: boolean;
  /** Icon element to display before text */
  leftIcon?: React.ReactNode;
  /** Icon element to display after text */
  rightIcon?: React.ReactNode;
  /** Make button full width */
  fullWidth?: boolean;
  /** Disable haptic feedback */
  disableHaptics?: boolean;
}

// Base styles - accessibility and layout. Focus is owned by the global
// brand-aware *:focus-visible rule in globals.css — no per-component ring.
const baseStyles = cn(
  "inline-flex items-center justify-center gap-2",
  "font-semibold tracking-tight",
  "rounded-lg",
  "transition-colors duration-[var(--duration-fast)] ease-apple",
  "disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none",
  "select-none touch-manipulation",
);

const solidBrand = cn(
  "bg-primary-600 text-white shadow-sm",
  "hover:bg-primary-700",
  "active:scale-[0.98]",
);

const tintedBrand = cn(
  "bg-primary-500/15",
  "text-primary-300",
  "border border-primary-500/25",
  "hover:bg-primary-500/25 hover:border-primary-500/35",
  "active:scale-[0.98]",
);

const plainBrand = cn(
  "text-primary-300",
  "hover:bg-primary-500/10",
  "active:bg-primary-500/15",
  "active:scale-[0.98]",
);

// Variant styles — flat DEALER TRUST fills.
const variantStyles: Record<Variant, string> = {
  filled: solidBrand,
  primary: solidBrand,
  tinted: tintedBrand,
  secondary: tintedBrand,
  plain: plainBrand,
  ghost: plainBrand,
  outline: cn(
    "border border-hairline",
    "text-content-primary",
    "hover:border-strong hover:bg-fill-hover",
    "active:scale-[0.98]",
  ),
  danger: cn(
    "bg-error-600 text-white shadow-sm",
    "hover:bg-error-700",
    "active:scale-[0.98]",
  ),
  // Legacy gradient names — flat now, kept so call sites don't churn.
  "gradient-sky": solidBrand,
  "gradient-teal": cn(
    "bg-success-600 text-white shadow-sm",
    "hover:bg-success-700",
    "active:scale-[0.98]",
  ),
};

// Size styles with proper touch targets (Apple HIG: min 44px)
const sizeStyles: Record<Size, string> = {
  xs: "text-xs px-3 py-1.5 min-h-[32px]",
  sm: "text-sm px-4 py-2 min-h-[36px]",
  md: "text-base px-5 py-2.5 min-h-[44px]",
  lg: "text-lg px-6 py-3 min-h-[52px]",
  icon: "p-2 min-h-[44px] min-w-[44px]",
};

/**
 * Button component with Apple-inspired design and smooth animations.
 *
 * @example
 * <Button variant="filled" leftIcon={<Plus />}>
 *   Create Post
 * </Button>
 *
 * @example
 * <Button variant="danger" loading>
 *   Deleting...
 * </Button>
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "filled",
      size = "md",
      loading = false,
      leftIcon,
      rightIcon,
      fullWidth = false,
      disableHaptics = false,
      children,
      disabled,
      onClick,
      ...rest
    },
    ref,
  ) => {
    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      // Trigger haptic feedback on click
      if (!disableHaptics) {
        triggerHapticFeedback();
      }
      onClick?.(e);
    };

    return (
      <motion.button
        ref={ref}
        className={cn(
          baseStyles,
          variantStyles[variant],
          sizeStyles[size],
          fullWidth && "w-full",
          className,
        )}
        disabled={disabled || loading}
        onClick={handleClick}
        whileTap={
          !disabled && !loading && !shouldReduceMotion() ? { scale: 0.98 } : undefined
        }
        transition={{
          type: "spring",
          ...SPRING_CONFIGS.standard,
        }}
        {...rest}
      >
        {/* Loading spinner */}
        {loading && (
          <Loader2
            className={cn(
              "animate-spin",
              size === "sm" && "h-4 w-4",
              size === "md" && "h-5 w-5",
              size === "lg" && "h-6 w-6",
            )}
            aria-hidden="true"
          />
        )}

        {/* Left icon */}
        {!loading && leftIcon && (
          <span
            className={cn(
              "inline-flex shrink-0",
              size === "sm" && "[&>svg]:h-4 [&>svg]:w-4",
              size === "md" && "[&>svg]:h-5 [&>svg]:w-5",
              size === "lg" && "[&>svg]:h-6 [&>svg]:w-6",
            )}
            aria-hidden="true"
          >
            {leftIcon}
          </span>
        )}

        {/* Button text */}
        <motion.span className={cn(loading && "opacity-0")}>{children}</motion.span>

        {/* Right icon */}
        {!loading && rightIcon && (
          <span
            className={cn(
              "inline-flex shrink-0",
              size === "sm" && "[&>svg]:h-4 [&>svg]:w-4",
              size === "md" && "[&>svg]:h-5 [&>svg]:w-5",
              size === "lg" && "[&>svg]:h-6 [&>svg]:w-6",
            )}
            aria-hidden="true"
          >
            {rightIcon}
          </span>
        )}
      </motion.button>
    );
  },
);

Button.displayName = "Button";
