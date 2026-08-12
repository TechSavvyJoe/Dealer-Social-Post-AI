import React from "react";
import { motion, type HTMLMotionProps } from "framer-motion";
import { cn } from "../../utils/classNames";

/**
 * Card — DEALER TRUST system: solid theme-aware surface with a hairline
 * border. Flat by default; interactive cards get border/background emphasis
 * instead of lift, and elevation maps to the calm shadow tokens.
 */
export interface CardProps extends HTMLMotionProps<"div"> {
  /** Enable hover effects for interactive cards */
  interactive?: boolean;
  /** Elevation level (1-5), mapped onto the flat shadow token scale */
  elevation?: 1 | 2 | 3 | 4 | 5;
  /** Deprecated: cards are always solid now; kept for call-site compatibility */
  solid?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  (
    {
      className,
      interactive = false,
      elevation = 2,
      solid: _solid = false,
      children,
      ...props
    },
    ref,
  ) => {
    return (
      <motion.div
        ref={ref}
        className={cn(
          // Base styles — solid surface, hairline border, token radius
          "rounded-lg overflow-hidden",
          "bg-surface-overlay border border-hairline",
          "transition-colors duration-[var(--duration-base)] ease-apple",

          // Elevation shadows (flat token scale)
          elevation <= 2 && "shadow-elevation-1",
          elevation === 3 && "shadow-elevation-3",
          elevation >= 4 && "shadow-elevation-5",

          // Interactive states — emphasis, not lift
          interactive && "card-hover cursor-pointer",

          className,
        )}
        initial={false}
        whileTap={interactive ? { scale: 0.99 } : undefined}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
        {...props}
      >
        {children}
      </motion.div>
    );
  },
);

Card.displayName = "Card";

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
        "border-b border-hairline",
        padded ? "px-6 py-5" : "px-5 py-4",
        className,
      )}
      {...props}
    />
  ),
);

CardHeader.displayName = "CardHeader";

/**
 * Card title - semantic heading with proper typography
 */
export interface CardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  /** Heading level */
  as?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
}

export const CardTitle = React.forwardRef<HTMLHeadingElement, CardTitleProps>(
  ({ className, as: Component = "h3", ...props }, ref) => (
    <Component
      ref={ref}
      className={cn(
        "font-semibold text-lg text-content-primary tracking-tight",
        className,
      )}
      {...props}
    />
  ),
);

CardTitle.displayName = "CardTitle";

/**
 * Card description - subtle subtitle text
 */
export const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm text-content-secondary mt-1.5 leading-relaxed", className)}
    {...props}
  />
));

CardDescription.displayName = "CardDescription";

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
      className={cn(noPadding ? "" : padded ? "px-6 py-5" : "px-5 py-4", className)}
      {...props}
    />
  ),
);

CardContent.displayName = "CardContent";

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
        "border-t border-hairline",
        "flex items-center gap-3",
        padded ? "px-6 py-5" : "px-5 py-4",
        className,
      )}
      {...props}
    />
  ),
);

CardFooter.displayName = "CardFooter";
