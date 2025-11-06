import React from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { cn } from '../../utils/classNames';

/**
 * Card component with refined glass morphism and elevation system.
 * Based on Apple's card design with subtle depth and blur effects.
 */
export interface CardProps extends HTMLMotionProps<'div'> {
  /** Enable hover effects for interactive cards */
  interactive?: boolean;
  /** Elevation level (1-5) following Material Design */
  elevation?: 1 | 2 | 3 | 4 | 5;
  /** Disable glass morphism effect */
  solid?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, interactive = false, elevation = 2, solid = false, children, ...props }, ref) => {
    return (
      <motion.div
        ref={ref}
        className={cn(
          // Base styles
          'rounded-2xl overflow-hidden',
          'transition-all duration-300 ease-apple',

          // Glass morphism or solid background
          solid
            ? 'bg-surface-900 border border-surface-800'
            : 'glass', // Using the utility class from globals.css

          // Elevation shadows
          elevation === 1 && 'shadow-elevation-1',
          elevation === 2 && 'shadow-elevation-2',
          elevation === 3 && 'shadow-elevation-3',
          elevation === 4 && 'shadow-elevation-4',
          elevation === 5 && 'shadow-elevation-5',

          // Interactive states
          interactive && 'card-hover cursor-pointer',

          className
        )}
        initial={false}
        whileHover={interactive ? { y: -4, scale: 1.01 } : undefined}
        whileTap={interactive ? { scale: 0.99 } : undefined}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        {...props}
      >
        {children}
      </motion.div>
    );
  }
);

Card.displayName = 'Card';

/**
 * Card header with bottom border and proper spacing
 */
export interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Add extra padding */
  padded?: boolean;
}

export const CardHeader = React.forwardRef<HTMLDivElement, CardHeaderProps>(
  ({ className, padded = false, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'border-b border-white/5',
        padded ? 'px-6 py-5' : 'px-5 py-4',
        className
      )}
      {...props}
    />
  )
);

CardHeader.displayName = 'CardHeader';

/**
 * Card title - semantic heading with proper typography
 */
export interface CardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  /** Heading level */
  as?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
}

export const CardTitle = React.forwardRef<HTMLHeadingElement, CardTitleProps>(
  ({ className, as: Component = 'h3', ...props }, ref) => (
    <Component
      ref={ref}
      className={cn(
        'font-semibold text-lg text-surface-50 tracking-tight',
        className
      )}
      {...props}
    />
  )
);

CardTitle.displayName = 'CardTitle';

/**
 * Card description - subtle subtitle text
 */
export const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p
      ref={ref}
      className={cn(
        'text-sm text-surface-400 mt-1.5 leading-relaxed',
        className
      )}
      {...props}
    />
  )
);

CardDescription.displayName = 'CardDescription';

/**
 * Card content area with consistent padding
 */
export interface CardContentProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Add extra padding */
  padded?: boolean;
  /** Remove vertical padding */
  noPadding?: boolean;
}

export const CardContent = React.forwardRef<HTMLDivElement, CardContentProps>(
  ({ className, padded = false, noPadding = false, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        noPadding
          ? ''
          : padded
          ? 'px-6 py-5'
          : 'px-5 py-4',
        className
      )}
      {...props}
    />
  )
);

CardContent.displayName = 'CardContent';

/**
 * Card footer with top border and button actions
 */
export interface CardFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Add extra padding */
  padded?: boolean;
}

export const CardFooter = React.forwardRef<HTMLDivElement, CardFooterProps>(
  ({ className, padded = false, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'border-t border-white/5',
        'flex items-center gap-3',
        padded ? 'px-6 py-5' : 'px-5 py-4',
        className
      )}
      {...props}
    />
  )
);

CardFooter.displayName = 'CardFooter';
