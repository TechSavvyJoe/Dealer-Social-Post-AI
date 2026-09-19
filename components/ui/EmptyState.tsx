import React from "react";
import { LucideIcon } from "lucide-react";
import { Button } from "./Button";
import { cn } from "../../utils/classNames";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

/**
 * Empty state: a 48px icon tile, a title, one line of body copy, and one
 * primary action. No glow, no stagger, no mount animation.
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  className,
}) => {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center py-12 px-6",
        className,
      )}
    >
      <div className="mb-6 w-12 h-12 rounded-md bg-panel-raised flex items-center justify-center">
        <Icon className="h-6 w-6 text-ink-2" strokeWidth={1.75} />
      </div>

      <h3 className="text-lg font-semibold text-ink mb-2">{title}</h3>

      <p className="text-base text-ink-2 max-w-md mb-6">{description}</p>

      {actionLabel && onAction && (
        <Button variant="primary" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
};
