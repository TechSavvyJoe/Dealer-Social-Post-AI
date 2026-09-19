import React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "../../utils/classNames";
import { triggerHapticFeedback } from "../../utils/haptics";

/**
 * Button variants — Light Table system: flat token fills, hairline borders,
 * no gradients, no glow, motion limited to a CSS tap compression. The
 * historical variant names are kept as aliases so no call site churns:
 * - filled / primary: solid brand action
 * - tinted / outline / secondary: raised panel with a strong border
 * - plain / ghost: text-only tertiary action
 * - danger: destructive action (error fill)
 * - gradient-sky / gradient-teal: legacy aliases of primary
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
  | "ghost"
  | "key";

/**
 * Size options. `md` and `lg` meet the 44px minimum touch target; `xl` is
 * the 64px keypad numeral size.
 */
type Size = "sm" | "md" | "lg" | "icon" | "xs" | "xl";

interface ButtonProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "size"
> {
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
  "rounded-sm",
  "transition-[color,background-color,border-color,opacity,transform] duration-120 ease-out",
  "active:scale-[0.98] motion-reduce:transform-none",
  "disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none",
  "select-none touch-manipulation",
);

const primaryStyles = cn("bg-brand-fill text-brand-foreground", "hover:opacity-90");

const secondaryStyles = cn(
  "bg-panel-raised border border-strong text-ink",
  "hover:border-strong hover:opacity-90",
);

const ghostStyles = cn("bg-transparent text-ink-2", "hover:bg-fill-subtle");

const dangerStyles = cn("bg-error-fill text-error-ink border border-error-ink/40");

// Variant styles — flat token fills, aliased so no call site churns.
// Keypad keys: a raised key with a quiet edge; the press shows in the brand tint.
const keyStyles =
  "bg-panel-raised border border-hairline text-ink hover:border-strong active:bg-brand-tint";

const variantStyles: Record<Variant, string> = {
  primary: primaryStyles,
  filled: primaryStyles,
  "gradient-sky": primaryStyles,
  "gradient-teal": primaryStyles,
  secondary: secondaryStyles,
  tinted: secondaryStyles,
  outline: secondaryStyles,
  ghost: ghostStyles,
  plain: ghostStyles,
  danger: dangerStyles,
  key: keyStyles,
};

// Size styles with proper touch targets.
const sizeStyles: Record<Size, string> = {
  xs: "text-xs px-3 py-1.5 min-h-[32px]",
  sm: "text-sm font-semibold px-4 py-2 min-h-[36px]",
  md: "text-base font-semibold px-5 py-2.5 min-h-[44px]",
  lg: "text-base font-semibold px-6 py-3 min-h-[52px]",
  icon: "p-2 min-h-[44px] min-w-[44px]",
  xl: "font-display text-3xl font-medium tabular-nums min-h-[64px] min-w-[64px] px-6",
};

/**
 * Button component: plain element, tokens only.
 *
 * @example
 * <Button variant="primary" leftIcon={<Plus />}>
 *   Create post
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
      variant = "primary",
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
      <button
        ref={ref}
        className={cn(
          baseStyles,
          variantStyles[variant],
          sizeStyles[size],
          fullWidth && "w-full",
          className,
        )}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        onClick={handleClick}
        {...rest}
      >
        {/* Loading spinner replaces the left icon; the label stays visible */}
        {loading && (
          <Loader2
            className={cn(
              "animate-spin",
              size === "sm" && "h-4 w-4",
              (size === "md" || size === "lg") && "h-5 w-5",
              size === "xl" && "h-6 w-6",
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
        <span>{children}</span>

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
      </button>
    );
  },
);

Button.displayName = "Button";
