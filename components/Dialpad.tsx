import React from "react";
import { Icon } from "./Icons";
import { cn } from "../utils/classNames";

export type DialpadKey =
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "0"
  | "backspace"
  | "clear";

interface DialpadProps {
  onKeyPress: (key: DialpadKey) => void;
  /** Compact for short mobile viewports so the full pad fits without scroll. */
  compact?: boolean;
}

const DialpadButton: React.FC<{
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
  ariaLabel: string;
  compact?: boolean;
}> = ({ onClick, children, className, ariaLabel, compact }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={ariaLabel}
    className={cn(
      "flex w-full touch-manipulation select-none items-center justify-center rounded-2xl",
      compact
        ? "min-h-[3rem] aspect-square max-h-[4.25rem] text-xl"
        : "aspect-square min-h-[var(--spacing-touch-target,2.75rem)] text-2xl",
      "border border-white/[0.09] bg-[#171d29] font-semibold tabular-nums text-surface-50",
      "shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-[background-color,border-color,transform] duration-150",
      "hover:border-white/20 hover:bg-[#202838] active:translate-y-px active:bg-[#252e40]",
      "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b1017]",
      className,
    )}
  >
    {children}
  </button>
);

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

export const Dialpad: React.FC<DialpadProps> = ({
  onKeyPress,
  compact = false,
}) => (
  <div
    className={cn(
      "mx-auto flex w-full flex-col items-stretch",
      compact
        ? "max-w-[17.5rem] gap-2 sm:max-w-[20rem] sm:gap-3"
        : "max-w-[20rem] gap-3 sm:max-w-[22rem]",
    )}
    role="group"
    aria-label="Four digit access code keypad"
  >
    <div className={cn("grid grid-cols-3", compact ? "gap-2 sm:gap-3" : "gap-3")}>
      {DIGITS.map((digit) => (
        <DialpadButton
          key={digit}
          compact={compact}
          onClick={() => onKeyPress(digit)}
          ariaLabel={`Digit ${digit}`}
        >
          {digit}
        </DialpadButton>
      ))}
    </div>

    <div className={cn("grid grid-cols-3", compact ? "gap-2 sm:gap-3" : "gap-3")}>
      <DialpadButton
        compact={compact}
        onClick={() => onKeyPress("clear")}
        ariaLabel="Clear code"
        className="text-[10px] font-semibold uppercase tracking-[0.16em] text-surface-400 sm:text-xs"
      >
        Clear
      </DialpadButton>
      <DialpadButton
        compact={compact}
        onClick={() => onKeyPress("0")}
        ariaLabel="Digit 0"
      >
        0
      </DialpadButton>
      <DialpadButton
        compact={compact}
        onClick={() => onKeyPress("backspace")}
        ariaLabel="Delete last digit"
      >
        <Icon type="backspace" className={compact ? "h-5 w-5" : "h-6 w-6"} />
      </DialpadButton>
    </div>
  </div>
);
