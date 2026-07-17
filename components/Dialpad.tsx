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
      "flex aspect-square w-full min-h-[var(--spacing-touch-target,2.75rem)] touch-manipulation select-none items-center justify-center rounded-2xl",
      "border border-white/[0.09] bg-[#171d29] text-2xl font-semibold tabular-nums text-surface-50",
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
    className="mx-auto flex w-full max-w-[20rem] flex-col items-stretch gap-3 sm:max-w-[22rem]"
    role="group"
    aria-label="Four digit access code keypad"
  >
    <div className="grid grid-cols-3 gap-3">
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

    <div className="grid grid-cols-3 gap-3">
      <DialpadButton
        onClick={() => onKeyPress("clear")}
        ariaLabel="Clear code"
        className="text-[11px] font-semibold uppercase tracking-[0.16em] text-surface-400 sm:text-xs"
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
        <Icon type="backspace" className="h-6 w-6" />
      </DialpadButton>
    </div>
  </div>
);
