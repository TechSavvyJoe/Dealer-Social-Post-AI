import React, { useState } from "react";
import { m, AnimatePresence } from "framer-motion";
import { AlertCircle } from "lucide-react";
import { cn } from "../../utils/classNames";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Label text */
  label?: string;
  /** Error message to display */
  error?: string;
  /** Helper text */
  helperText?: string;
  /** Icon element to display on the left */
  leftIcon?: React.ReactNode;
  /** Icon element to display on the right */
  rightIcon?: React.ReactNode;
  /** Interactive control displayed on the right (for example reveal password). */
  rightAction?: React.ReactNode;
  /** Full width input */
  fullWidth?: boolean;
}

/**
 * Input component with floating labels and Apple-style design.
 * Features smooth animations, error states, and icon support.
 *
 * @example
 * <Input label="Email" type="email" />
 * <Input label="Search" leftIcon={<Search />} />
 * <Input label="Password" type="password" error="Invalid password" />
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      label,
      error,
      helperText,
      leftIcon,
      rightIcon,
      rightAction,
      fullWidth = false,
      type = "text",
      id,
      value,
      defaultValue,
      onChange,
      onFocus,
      onBlur,
      placeholder,
      "aria-describedby": ariaDescribedBy,
      "aria-invalid": ariaInvalid,
      ...props
    },
    ref,
  ) => {
    const [isFocused, setIsFocused] = useState(false);
    const [uncontrolledHasValue, setUncontrolledHasValue] = useState(
      () => defaultValue !== undefined && String(defaultValue).length > 0,
    );
    const generatedId = React.useId().replace(/:/g, "");

    const inputId = id || `input-${generatedId}`;
    const messageId = `${inputId}-message`;
    const describedBy =
      [ariaDescribedBy, error || helperText ? messageId : undefined]
        .filter(Boolean)
        .join(" ") || undefined;
    const hasValue =
      value !== undefined ? String(value ?? "").length > 0 : uncontrolledHasValue;
    const showFloatingLabel = isFocused || hasValue;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (value === undefined) {
        setUncontrolledHasValue(e.target.value.length > 0);
      }
      onChange?.(e);
    };

    return (
      <div className={cn("relative", fullWidth && "w-full")}>
        {/* Input container */}
        <div className="relative">
          {/* Left icon */}
          {leftIcon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none">
              <span className="[&>svg]:h-5 [&>svg]:w-5">{leftIcon}</span>
            </div>
          )}

          {/* Input field */}
          <input
            {...props}
            ref={ref}
            id={inputId}
            type={type}
            value={value}
            defaultValue={defaultValue}
            aria-describedby={describedBy}
            aria-invalid={error ? true : ariaInvalid}
            className={cn(
              // Base styles
              "w-full rounded-xl",
              "bg-surface-900/60 border-2",
              "px-4 py-3",
              "text-base text-surface-50",
              "placeholder:text-surface-400",
              "transition-all duration-200 ease-apple",

              // Focus state
              "focus:outline-none focus:ring-0",
              error
                ? "border-error-500/50 focus:border-error-500"
                : "border-surface-700 focus:border-primary-500",

              // Disabled state
              "disabled:opacity-50 disabled:cursor-not-allowed",

              // With icons padding
              leftIcon && "pl-11",
              (rightIcon || rightAction || error) && "pr-12",

              // With floating label
              label && (showFloatingLabel ? "pt-6 pb-2" : "pt-3 pb-3"),

              className,
            )}
            onFocus={(e) => {
              setIsFocused(true);
              onFocus?.(e);
            }}
            onBlur={(e) => {
              setIsFocused(false);
              onBlur?.(e);
            }}
            onChange={handleChange}
            placeholder={
              label ? (showFloatingLabel ? placeholder : undefined) : placeholder
            }
          />

          {/* Floating label */}
          {label && (
            <label
              htmlFor={inputId}
              className={cn(
                "absolute left-4 transition-all duration-200 ease-apple pointer-events-none",
                leftIcon && "left-11",
                showFloatingLabel
                  ? "top-1.5 text-xs text-primary-400 font-medium"
                  : "top-1/2 -translate-y-1/2 text-base text-surface-400",
              )}
            >
              {label}
            </label>
          )}

          {/* Right icon or error icon */}
          {(error || rightIcon) && !rightAction && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none">
              {error ? (
                <AlertCircle className="h-5 w-5 text-error-500" aria-hidden="true" />
              ) : (
                <span className="[&>svg]:h-5 [&>svg]:w-5">{rightIcon}</span>
              )}
            </div>
          )}
          {rightAction && !error ? (
            <div className="absolute right-2 top-1/2 -translate-y-1/2 text-surface-300">
              {rightAction}
            </div>
          ) : null}
        </div>

        {/* Helper text or error message */}
        <AnimatePresence mode="wait">
          {(error || helperText) && (
            <m.p
              id={messageId}
              role={error ? "alert" : undefined}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
              className={cn(
                "mt-1.5 text-sm px-1",
                error ? "text-error-400" : "text-surface-400",
              )}
            >
              {error || helperText}
            </m.p>
          )}
        </AnimatePresence>
      </div>
    );
  },
);

Input.displayName = "Input";

/**
 * Textarea component with similar styling to Input
 */
export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Label text */
  label?: string;
  /** Error message to display */
  error?: string;
  /** Helper text */
  helperText?: string;
  /** Full width textarea */
  fullWidth?: boolean;
  /** Auto-resize based on content */
  autoResize?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      className,
      label,
      error,
      helperText,
      fullWidth = false,
      autoResize = false,
      id,
      value,
      defaultValue,
      onChange,
      onFocus,
      onBlur,
      placeholder,
      "aria-describedby": ariaDescribedBy,
      "aria-invalid": ariaInvalid,
      ...props
    },
    ref,
  ) => {
    const [isFocused, setIsFocused] = useState(false);
    const [uncontrolledHasValue, setUncontrolledHasValue] = useState(
      () => defaultValue !== undefined && String(defaultValue).length > 0,
    );
    const generatedId = React.useId().replace(/:/g, "");

    const textareaId = id || `textarea-${generatedId}`;
    const messageId = `${textareaId}-message`;
    const describedBy =
      [ariaDescribedBy, error || helperText ? messageId : undefined]
        .filter(Boolean)
        .join(" ") || undefined;
    const hasValue =
      value !== undefined ? String(value ?? "").length > 0 : uncontrolledHasValue;
    const showFloatingLabel = isFocused || hasValue;

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (value === undefined) {
        setUncontrolledHasValue(e.target.value.length > 0);
      }

      // Auto-resize
      if (autoResize) {
        e.target.style.height = "auto";
        e.target.style.height = `${e.target.scrollHeight}px`;
      }

      onChange?.(e);
    };

    return (
      <div className={cn("relative", fullWidth && "w-full")}>
        <div className="relative">
          <textarea
            {...props}
            ref={ref}
            id={textareaId}
            value={value}
            defaultValue={defaultValue}
            aria-describedby={describedBy}
            aria-invalid={error ? true : ariaInvalid}
            className={cn(
              // Base styles
              "w-full rounded-xl",
              "bg-surface-900/60 border-2",
              "px-4 py-3",
              "text-base text-surface-50",
              "placeholder:text-surface-400",
              "transition-all duration-200 ease-apple",
              "resize-none",

              // Focus state
              "focus:outline-none focus:ring-0",
              error
                ? "border-error-500/50 focus:border-error-500"
                : "border-surface-700 focus:border-primary-500",

              // Disabled state
              "disabled:opacity-50 disabled:cursor-not-allowed",

              // With floating label
              label && (showFloatingLabel ? "pt-6 pb-2" : "pt-3 pb-3"),
              error && "pr-11",

              className,
            )}
            onFocus={(e) => {
              setIsFocused(true);
              onFocus?.(e);
            }}
            onBlur={(e) => {
              setIsFocused(false);
              onBlur?.(e);
            }}
            onChange={handleChange}
            placeholder={
              label ? (showFloatingLabel ? placeholder : undefined) : placeholder
            }
          />

          {/* Floating label */}
          {label && (
            <label
              htmlFor={textareaId}
              className={cn(
                "absolute left-4 transition-all duration-200 ease-apple pointer-events-none",
                showFloatingLabel
                  ? "top-1.5 text-xs text-primary-400 font-medium"
                  : "top-3 text-base text-surface-400",
              )}
            >
              {label}
            </label>
          )}

          {/* Error icon */}
          {error && (
            <div className="absolute right-3 top-3 text-error-500">
              <AlertCircle className="h-5 w-5" aria-hidden="true" />
            </div>
          )}
        </div>

        {/* Helper text or error message */}
        <AnimatePresence mode="wait">
          {(error || helperText) && (
            <m.p
              id={messageId}
              role={error ? "alert" : undefined}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
              className={cn(
                "mt-1.5 text-sm px-1",
                error ? "text-error-400" : "text-surface-400",
              )}
            >
              {error || helperText}
            </m.p>
          )}
        </AnimatePresence>
      </div>
    );
  },
);

Textarea.displayName = "Textarea";

/**
 * Select component with similar styling to Input
 */
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  helperText?: string;
  fullWidth?: boolean;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      className,
      label,
      error,
      helperText,
      fullWidth = false,
      id,
      children,
      value,
      defaultValue,
      onChange,
      onFocus,
      onBlur,
      "aria-describedby": ariaDescribedBy,
      "aria-invalid": ariaInvalid,
      ...props
    },
    ref,
  ) => {
    const [isFocused, setIsFocused] = useState(false);
    const generatedId = React.useId().replace(/:/g, "");

    const selectId = id || `select-${generatedId}`;
    const messageId = `${selectId}-message`;
    const describedBy =
      [ariaDescribedBy, error || helperText ? messageId : undefined]
        .filter(Boolean)
        .join(" ") || undefined;

    const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
      onChange?.(e);
    };

    return (
      <div className={cn("relative", fullWidth && "w-full")}>
        <div className="relative">
          <select
            {...props}
            ref={ref}
            id={selectId}
            value={value}
            defaultValue={defaultValue}
            aria-describedby={describedBy}
            aria-invalid={error ? true : ariaInvalid}
            className={cn(
              // Base styles
              "w-full rounded-xl appearance-none",
              "bg-surface-900/60 border-2",
              "px-4 py-3",
              "text-base text-surface-50",
              "transition-all duration-200 ease-apple",
              // Focus state
              "focus:outline-none focus:ring-0",
              error
                ? "border-error-500/50 focus:border-error-500"
                : "border-surface-700 focus:border-primary-500",
              // Disabled state
              "disabled:opacity-50 disabled:cursor-not-allowed",
              // With floating label
              label && "pt-6 pb-2",
              className,
            )}
            onFocus={(e) => {
              setIsFocused(true);
              onFocus?.(e);
            }}
            onBlur={(e) => {
              setIsFocused(false);
              onBlur?.(e);
            }}
            onChange={handleChange}
          >
            {children}
          </select>

          {/* Custom Chevron icon for select */}
          <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-surface-400">
            <svg
              width="12"
              height="8"
              viewBox="0 0 12 8"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M1 1.5L6 6.5L11 1.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          {/* Floating label */}
          {label && (
            <label
              htmlFor={selectId}
              className={cn(
                "absolute left-4 transition-all duration-200 ease-apple pointer-events-none",
                "top-1.5 text-xs font-medium",
                isFocused ? "text-primary-400" : "text-surface-400",
              )}
            >
              {label}
            </label>
          )}

          {/* Error icon */}
          {error && (
            <div className="absolute right-10 top-1/2 -translate-y-1/2 text-error-500 pointer-events-none">
              <AlertCircle className="h-5 w-5" aria-hidden="true" />
            </div>
          )}
        </div>

        {/* Helper text or error message */}
        <AnimatePresence mode="wait">
          {(error || helperText) && (
            <m.p
              id={messageId}
              role={error ? "alert" : undefined}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
              className={cn(
                "mt-1.5 text-sm px-1",
                error ? "text-error-400" : "text-surface-400",
              )}
            >
              {error || helperText}
            </m.p>
          )}
        </AnimatePresence>
      </div>
    );
  },
);

Select.displayName = "Select";
