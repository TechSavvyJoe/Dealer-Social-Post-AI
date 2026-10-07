import React from "react";
import { Check } from "lucide-react";
import { extendTailwindMerge } from "tailwind-merge";
import { cn } from "../../utils/classNames";

// tailwind-merge only knows t-shirt font sizes, so plain cn() reads the
// project's `text-caption` (13 px, tailwind.config.js) as a text color and
// drops the variant's ink when the two meet, which left every size="lg"
// badge in the inherited color. This merge knows the custom size. It can go
// once utils/classNames.ts teaches cn() the same thing for every component.
const mergeBadgeClasses = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: ["caption"] }] } },
});

type Variant = "primary" | "success" | "warning" | "error" | "info" | "neutral";
type Size = "sm" | "md" | "lg";

const variantStyles: Record<Variant, string> = {
  primary: "bg-brand-fill text-brand-foreground border border-brand-fill",
  success: "bg-success-fill text-success-ink border border-success-ink/30",
  warning: "bg-warning-fill text-warning-ink border border-warning-ink/30",
  error: "bg-error-fill text-error-ink border border-error-ink/30",
  info: "bg-info-fill text-info-ink border border-info-ink/30",
  // A translucent fill always steps off whatever it sits on, and the control
  // edge clears 3:1 on canvas, panel and raised rows in both themes. The old
  // raised fill and hairline vanished on a raised row (1.00:1 fill, 1.23:1
  // edge) and in Sunlight Mode (1.26:1 edge on the canvas).
  neutral: "bg-fill-subtle text-ink-2 border border-strong",
};

const sizeStyles: Record<Size, string> = {
  sm: "text-2xs px-2 py-0.5 gap-1",
  md: "text-2xs px-2.5 py-1 gap-1.5",
  lg: "text-caption px-3 py-1.5 gap-2",
};

const dotStyles: Record<Variant, string> = {
  primary: "bg-brand-ink",
  success: "bg-success-ink",
  warning: "bg-warning-ink",
  error: "bg-error-ink",
  info: "bg-info-ink",
  neutral: "bg-ink-2",
};

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Badge color variant */
  variant?: Variant;
  /** Badge size */
  size?: Size;
  /** Show a dot indicator instead of the automatic success check icon */
  dot?: boolean;
  /** No-op (spec §4.4): kept for call-site compatibility. Only loading
   *  placeholders (Skeleton, Shimmer) may pulse; a status dot never does. */
  pulse?: boolean;
  /** Uppercase the label. Defaults to false — sentence case is the norm; when
   *  true this applies nothing more than tracking-normal uppercase. */
  uppercase?: boolean;
}

/**
 * Badge component for status indicators and labels. Tokens only, no motion.
 *
 * @example
 * <Badge variant="success">Active</Badge>
 * <Badge variant="warning" dot pulse>Pending</Badge>
 */
export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  (
    {
      className,
      variant = "neutral",
      size = "md",
      dot = false,
      pulse: _pulse = false,
      uppercase = false,
      children,
      ...props
    },
    ref,
  ) => (
    <span
      ref={ref}
      className={mergeBadgeClasses(
        "inline-flex items-center",
        "rounded-full",
        "font-medium",
        uppercase && "uppercase tracking-normal",
        variantStyles[variant],
        sizeStyles[size],
        className,
      )}
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
          )}
          aria-hidden="true"
        />
      )}
      {!dot && variant === "success" && (
        <Check className="h-3 w-3 shrink-0" aria-hidden="true" />
      )}
      {children as React.ReactNode}
    </span>
  ),
);

Badge.displayName = "Badge";
