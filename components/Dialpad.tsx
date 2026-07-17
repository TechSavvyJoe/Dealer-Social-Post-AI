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
}

/**
 * Fluid keypad: keys scale with viewport so phones stay tappable and balanced
 * without looking tiny on large screens or overflowing short ones.
 */
const DialpadButton: React.FC<{
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
  ariaLabel: string;
}> = ({ onClick, children, className, ariaLabel }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={ariaLabel}
    className={cn(
      "flex w-full touch-manipulation select-none items-center justify-center rounded-2xl",
      // Fluid size: ~48–64px keys depending on viewport width/height
      "aspect-square min-h-[2.75rem]",
      "text-[clamp(1.15rem,4.2vmin,1.55rem)] font-semibold tabular-nums text-surface-50",
      "border border-white/[0.09] bg-[#171d29]",
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

export const Dialpad: React.FC<DialpadProps> = ({ onKeyPress }) => (
  <div
    className={cn(
      "mx-auto flex w-full flex-col items-stretch",
      "max-w-[min(20.5rem,88vw)] gap-[clamp(0.5rem,1.6vmin,0.75rem)]",
    )}
    role="group"
    aria-label="Four digit access code keypad"
  >
    <div className="grid grid-cols-3 gap-[clamp(0.5rem,1.6vmin,0.75rem)]">
      {DIGITS.map((digit) => (
        <DialpadButton
          key={digit}
          onClick={() => onKeyPress(digit)}
          ariaLabel={`Digit ${digit}`}
        >
          {digit}
        </DialpadButton>
      ))}
    </div>

    <div className="grid grid-cols-3 gap-[clamp(0.5rem,1.6vmin,0.75rem)]">
      <DialpadButton
        onClick={() => onKeyPress("clear")}
        ariaLabel="Clear code"
        className="text-[clamp(0.65rem,2.4vmin,0.8rem)] font-semibold uppercase tracking-[0.16em] text-surface-400"
      >
        Clear
      </DialpadButton>
      <DialpadButton onClick={() => onKeyPress("0")} ariaLabel="Digit 0">
        0
      </DialpadButton>
      <DialpadButton
        onClick={() => onKeyPress("backspace")}
        ariaLabel="Delete last digit"
      >
        <Icon
          type="backspace"
          className="h-[clamp(1.25rem,4vmin,1.5rem)] w-[clamp(1.25rem,4vmin,1.5rem)]"
        />
      </DialpadButton>
    </div>
  </div>
);
