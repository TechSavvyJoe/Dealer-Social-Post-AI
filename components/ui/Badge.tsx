import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../utils/classNames';

type Variant = 'primary' | 'success' | 'warning' | 'error' | 'info' | 'neutral';
type Size = 'sm' | 'md' | 'lg';

const variantStyles: Record<Variant, string> = {
  primary: 'bg-primary-500/15 text-primary-300 border border-primary-500/30',
  success: 'bg-success-500/15 text-success-300 border border-success-500/30',
  warning: 'bg-warning-500/15 text-warning-300 border border-warning-500/30',
  error: 'bg-error-500/15 text-error-300 border border-error-500/30',
  info: 'bg-info-500/15 text-info-300 border border-info-500/30',
  neutral: 'bg-surface-800 text-surface-300 border border-surface-700',
};

const sizeStyles: Record<Size, string> = {
  sm: 'text-[10px] px-2 py-0.5 gap-1',
  md: 'text-xs px-2.5 py-1 gap-1.5',
  lg: 'text-sm px-3 py-1.5 gap-2',
};

const dotStyles: Record<Variant, string> = {
  primary: 'bg-primary-400',
  success: 'bg-success-400',
  warning: 'bg-warning-400',
  error: 'bg-error-400',
  info: 'bg-info-400',
  neutral: 'bg-surface-400',
};

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Badge color variant */
  variant?: Variant;
  /** Badge size */
  size?: Size;
  /** Show animated dot indicator */
  dot?: boolean;
  /** Animate the dot (pulse effect) */
  pulse?: boolean;
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
  ({ className, variant = 'neutral', size = 'md', dot = false, pulse = false, children, ...props }, ref) => (
    <motion.span
      ref={ref}
      className={cn(
        'inline-flex items-center',
        'rounded-full',
        'font-semibold uppercase tracking-wider',
        'transition-all duration-200',
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      {...props}
    >
      {dot && (
        <span
          className={cn(
            'rounded-full',
            size === 'sm' && 'w-1.5 h-1.5',
            size === 'md' && 'w-2 h-2',
            size === 'lg' && 'w-2.5 h-2.5',
            dotStyles[variant],
            pulse && 'animate-pulse-soft'
          )}
          aria-hidden="true"
        />
      )}
      {children}
    </motion.span>
  )
);

Badge.displayName = 'Badge';
