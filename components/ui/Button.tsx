import React from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { cn } from '../../utils/classNames';
import { triggerHapticFeedback } from '../../utils/haptics';

/**
 * Button variants following Apple's hierarchy:
 * - filled: Primary action (solid background)
 * - tinted: Secondary action (tinted background)
 * - plain: Tertiary action (text only)
 * - outline: Alternative action (bordered)
 * - danger: Destructive action (red)
 */
type Variant = 'filled' | 'tinted' | 'plain' | 'outline' | 'danger';

/**
 * Size options following Apple HIG (44px minimum touch target)
 */
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'size'> {
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

// Base styles - accessibility and layout
const baseStyles = cn(
  'inline-flex items-center justify-center gap-2',
  'font-semibold tracking-tight',
  'rounded-xl',
  'transition-all duration-200 ease-apple',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-950',
  'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none',
  'select-none touch-manipulation',
  'will-change-transform'
);

// Variant styles with Apple-inspired colors
const variantStyles: Record<Variant, string> = {
  filled: cn(
    'bg-gradient-to-b from-primary-500 to-primary-600',
    'text-white',
    'shadow-elevation-2',
    'hover:shadow-elevation-3 hover:shadow-glow-primary',
    'hover:from-primary-600 hover:to-primary-700',
    'active:scale-[0.98]'
  ),
  tinted: cn(
    'bg-primary-500/15',
    'text-primary-400',
    'border border-primary-500/20',
    'hover:bg-primary-500/25 hover:border-primary-500/30',
    'active:scale-[0.98]'
  ),
  plain: cn(
    'text-primary-400',
    'hover:bg-primary-500/10',
    'active:bg-primary-500/15',
    'active:scale-[0.98]'
  ),
  outline: cn(
    'border-2 border-surface-700',
    'text-surface-100',
    'hover:border-surface-600 hover:bg-surface-800/50',
    'active:scale-[0.98]'
  ),
  danger: cn(
    'bg-gradient-to-b from-error-500 to-error-600',
    'text-white',
    'shadow-elevation-2',
    'hover:shadow-elevation-3 hover:shadow-glow-error',
    'hover:from-error-600 hover:to-error-700',
    'active:scale-[0.98]'
  ),
};

// Size styles with proper touch targets (Apple HIG: min 44px)
const sizeStyles: Record<Size, string> = {
  sm: 'text-sm px-4 py-2 min-h-[36px]',
  md: 'text-base px-5 py-2.5 min-h-[44px]',
  lg: 'text-lg px-6 py-3 min-h-[52px]',
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
      variant = 'filled',
      size = 'md',
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
    ref
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
          fullWidth && 'w-full',
          className
        )}
        disabled={disabled || loading}
        onClick={handleClick}
        whileTap={!disabled && !loading ? { scale: 0.98 } : undefined}
        whileHover={!disabled && !loading ? { scale: 1.02 } : undefined}
        transition={{
          type: 'spring',
          stiffness: 400,
          damping: 25,
        }}
        {...rest}
      >
        {/* Loading spinner */}
        {loading && (
          <Loader2
            className={cn(
              'animate-spin',
              size === 'sm' && 'h-4 w-4',
              size === 'md' && 'h-5 w-5',
              size === 'lg' && 'h-6 w-6'
            )}
            aria-hidden="true"
          />
        )}

        {/* Left icon */}
        {!loading && leftIcon && (
          <span
            className={cn(
              'inline-flex shrink-0',
              size === 'sm' && '[&>svg]:h-4 [&>svg]:w-4',
              size === 'md' && '[&>svg]:h-5 [&>svg]:w-5',
              size === 'lg' && '[&>svg]:h-6 [&>svg]:w-6'
            )}
            aria-hidden="true"
          >
            {leftIcon}
          </span>
        )}

        {/* Button text */}
        <span className={cn(loading && 'opacity-0')}>{children}</span>

        {/* Right icon */}
        {!loading && rightIcon && (
          <span
            className={cn(
              'inline-flex shrink-0',
              size === 'sm' && '[&>svg]:h-4 [&>svg]:w-4',
              size === 'md' && '[&>svg]:h-5 [&>svg]:w-5',
              size === 'lg' && '[&>svg]:h-6 [&>svg]:w-6'
            )}
            aria-hidden="true"
          >
            {rightIcon}
          </span>
        )}
      </motion.button>
    );
  }
);

Button.displayName = 'Button';
