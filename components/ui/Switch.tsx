import React from "react";

export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name: pass one of these. */
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  disabled?: boolean;
  /** A save is in flight: the control keeps its place and announces aria-busy. */
  busy?: boolean;
  /** Show the word "On" or "Off" to the left of the track. Default true. */
  showState?: boolean;
  id?: string;
  className?: string;
}

const join = (...classes: Array<string | false | null | undefined>): string =>
  classes.filter(Boolean).join(" ");

/**
 * The product's one on/off control: a native button with role="switch", so
 * Space and Enter toggle it and the role announces the state. The track is
 * 48 by 28: on is the dealer's brand fill with a brand-foreground knob at the
 * right, off is a raised panel with a strong edge and an ink-2 knob at the
 * left. The knob slides in 120 ms, not at all under reduced motion.
 *
 * `disabled` is the native attribute (dimmed, unfocusable, no clicks). `busy`
 * is not: a switch whose save is in flight keeps focus and its place, says
 * aria-busy, and ignores presses until the caller clears it.
 */
export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  {
    checked,
    onChange,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    "aria-describedby": ariaDescribedBy,
    disabled = false,
    busy = false,
    showState = true,
    id,
    className,
  },
  ref,
) {
  const handleClick = () => {
    if (disabled || busy) return;
    onChange(!checked);
  };

  return (
    <button
      ref={ref}
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      aria-busy={busy || undefined}
      disabled={disabled}
      onClick={handleClick}
      className={join(
        "inline-flex min-h-11 min-w-12 shrink-0 select-none items-center justify-end gap-3 rounded-sm touch-manipulation",
        "disabled:cursor-not-allowed disabled:opacity-50",
        busy && "cursor-progress",
        className,
      )}
    >
      {showState ? (
        // The role already announces the state; the word is for sighted
        // users, and its width is fixed so the track never shifts.
        <span
          aria-hidden="true"
          className="min-w-7 text-right text-sm font-medium text-ink-2"
        >
          {checked ? "On" : "Off"}
        </span>
      ) : null}
      <span
        aria-hidden="true"
        data-switch-track=""
        className={join(
          "flex h-7 w-12 shrink-0 items-center rounded-full border p-[3px]",
          "transition-colors duration-120 ease-out motion-reduce:transition-none",
          checked ? "border-brand-ink bg-brand-fill" : "border-strong bg-panel-raised",
        )}
      >
        <span
          data-switch-knob=""
          className={join(
            "block h-5 w-5 rounded-full",
            "transition-transform duration-120 ease-out motion-reduce:transition-none",
            checked ? "translate-x-5 bg-brand-foreground" : "translate-x-0 bg-ink-2",
          )}
        />
      </span>
    </button>
  );
});
