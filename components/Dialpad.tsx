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
      // Fill the grid cell — height comes from parent remaining space
      "flex h-full min-h-0 w-full touch-manipulation select-none items-center justify-center rounded-2xl",
      "text-[clamp(1.1rem,2.8dvh,1.5rem)] font-semibold tabular-nums text-surface-50",
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

/**
 * Height-aware keypad: 4 equal rows fill the parent (`minmax(0,1fr)` chain).
 * Never forces overflow via aspect-square keys.
 */
export const Dialpad: React.FC<DialpadProps> = ({ onKeyPress }) => (
  <div
    className="mx-auto grid h-full min-h-0 w-full max-w-[min(20rem,86vw)] grid-rows-[repeat(4,minmax(0,1fr))] gap-[clamp(0.4rem,1.2dvh,0.7rem)]"
    role="group"
    aria-label="Four digit access code keypad"
  >
    <div className="grid min-h-0 grid-cols-3 gap-[clamp(0.4rem,1.2dvh,0.7rem)]">
      {DIGITS.slice(0, 3).map((digit) => (
        <DialpadButton
          key={digit}
          onClick={() => onKeyPress(digit)}
          ariaLabel={`Digit ${digit}`}
        >
          {digit}
        </DialpadButton>
      ))}
    </div>
    <div className="grid min-h-0 grid-cols-3 gap-[clamp(0.4rem,1.2dvh,0.7rem)]">
      {DIGITS.slice(3, 6).map((digit) => (
        <DialpadButton
          key={digit}
          onClick={() => onKeyPress(digit)}
          ariaLabel={`Digit ${digit}`}
        >
          {digit}
        </DialpadButton>
      ))}
    </div>
    <div className="grid min-h-0 grid-cols-3 gap-[clamp(0.4rem,1.2dvh,0.7rem)]">
      {DIGITS.slice(6, 9).map((digit) => (
        <DialpadButton
          key={digit}
          onClick={() => onKeyPress(digit)}
          ariaLabel={`Digit ${digit}`}
        >
          {digit}
        </DialpadButton>
      ))}
    </div>
    <div className="grid min-h-0 grid-cols-3 gap-[clamp(0.4rem,1.2dvh,0.7rem)]">
      <DialpadButton
        onClick={() => onKeyPress("clear")}
        ariaLabel="Clear code"
        className="text-[clamp(0.65rem,1.8dvh,0.8rem)] font-semibold uppercase tracking-[0.14em] text-surface-400"
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
        <Icon type="backspace" className="h-[1.35em] w-[1.35em]" />
      </DialpadButton>
    </div>
  </div>
);
