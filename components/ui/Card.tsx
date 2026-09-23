import React from "react";
import { cn } from "../../utils/classNames";

/**
 * Card — Light Table system: a flat panel, no shadow, no motion. Interactive
 * cards get a border-strong emphasis on hover instead of a lift.
 */
export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Enable hover effects for interactive cards */
  interactive?: boolean;
  /** Deprecated: cards are flat now; accepted and ignored for call-site compatibility */
  elevation?: 1 | 2 | 3 | 4 | 5;
  /** Deprecated: cards are always solid now; kept for call-site compatibility */
  solid?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  (
    {
      className,
      interactive = false,
      elevation: _elevation,
      solid: _solid = false,
      children,
      ...props
    },
    ref,
  ) => {
    return (
      <div
        ref={ref}
        className={cn(
          "rounded-md overflow-hidden",
          "bg-panel border border-hairline",
          "transition-colors duration-120 ease-out",
          interactive && "hover:border-strong cursor-pointer",
          className,
        )}
        {...props}
      >
        {children}
      </div>
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
      className={cn("font-semibold text-lg text-ink", className)}
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
    className={cn("text-sm text-ink-2 mt-1.5 leading-relaxed", className)}
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
