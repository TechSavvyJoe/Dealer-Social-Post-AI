import React from "react";
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
 * Input component: label above the control, light-table tokens.
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
      "aria-describedby": ariaDescribedBy,
      "aria-invalid": ariaInvalid,
      ...props
    },
    ref,
  ) => {
    const generatedId = React.useId().replace(/:/g, "");

    const inputId = id || `input-${generatedId}`;
    const messageId = `${inputId}-message`;
    const describedBy =
      [ariaDescribedBy, error || helperText ? messageId : undefined]
        .filter(Boolean)
        .join(" ") || undefined;

    return (
      <div className={cn("relative", fullWidth && "w-full")}>
        {label && (
          <label
            htmlFor={inputId}
            className="mb-1.5 block text-sm font-medium text-ink-2"
          >
            {label}
          </label>
        )}

        <div className="relative">
          {/* Left icon */}
          {leftIcon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-hint pointer-events-none">
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
              "w-full min-h-11 rounded-sm",
              "bg-panel-raised border",
              "px-3",
              "text-base text-ink",
              "placeholder:text-ink-hint",
              "transition-colors duration-120 ease-out",

              error ? "border-error-ink" : "border-strong focus:border-brand-ink",

              "disabled:opacity-50 disabled:cursor-not-allowed",

              leftIcon && "pl-11",
              (rightIcon || rightAction || error) && "pr-12",

              className,
            )}
            onChange={onChange}
          />

          {/* Right icon or error icon */}
          {(error || rightIcon) && !rightAction && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-hint pointer-events-none">
              {error ? (
                <AlertCircle className="h-5 w-5 text-error-ink" aria-hidden="true" />
              ) : (
                <span className="[&>svg]:h-5 [&>svg]:w-5">{rightIcon}</span>
              )}
            </div>
          )}
          {rightAction && !error ? (
            <div className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-hint">
              {rightAction}
            </div>
          ) : null}
        </div>

        {/* Helper text or error message */}
        {(error || helperText) && (
          <p
            id={messageId}
            role={error ? "alert" : undefined}
            className={cn(
              "mt-1.5 text-caption px-1",
              error ? "text-error-ink" : "text-ink-hint",
            )}
          >
            {error || helperText}
          </p>
        )}
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
      "aria-describedby": ariaDescribedBy,
      "aria-invalid": ariaInvalid,
      ...props
    },
    ref,
  ) => {
    const generatedId = React.useId().replace(/:/g, "");

    const textareaId = id || `textarea-${generatedId}`;
    const messageId = `${textareaId}-message`;
    const describedBy =
      [ariaDescribedBy, error || helperText ? messageId : undefined]
        .filter(Boolean)
        .join(" ") || undefined;

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      // Auto-resize
      if (autoResize) {
        e.target.style.height = "auto";
        e.target.style.height = `${e.target.scrollHeight}px`;
      }

      onChange?.(e);
    };

    return (
      <div className={cn("relative", fullWidth && "w-full")}>
        {label && (
          <label
            htmlFor={textareaId}
            className="mb-1.5 block text-sm font-medium text-ink-2"
          >
            {label}
          </label>
        )}

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
              "w-full min-h-11 rounded-sm",
              "bg-panel-raised border",
              "px-3 py-2.5",
              "text-base text-ink",
              "placeholder:text-ink-hint",
              "transition-colors duration-120 ease-out",
              "resize-none",

              error ? "border-error-ink" : "border-strong focus:border-brand-ink",

              "disabled:opacity-50 disabled:cursor-not-allowed",

              error && "pr-11",

              className,
            )}
            onChange={handleChange}
          />

          {/* Error icon */}
          {error && (
            <div className="absolute right-3 top-3 text-error-ink">
              <AlertCircle className="h-5 w-5" aria-hidden="true" />
            </div>
          )}
        </div>

        {/* Helper text or error message */}
        {(error || helperText) && (
          <p
            id={messageId}
            role={error ? "alert" : undefined}
            className={cn(
              "mt-1.5 text-caption px-1",
              error ? "text-error-ink" : "text-ink-hint",
            )}
          >
            {error || helperText}
          </p>
        )}
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
      "aria-describedby": ariaDescribedBy,
      "aria-invalid": ariaInvalid,
      ...props
    },
    ref,
  ) => {
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
        {label && (
          <label
            htmlFor={selectId}
            className="mb-1.5 block text-sm font-medium text-ink-2"
          >
            {label}
          </label>
        )}

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
              "w-full min-h-11 rounded-sm appearance-none",
              "bg-panel-raised border",
              "px-3 pr-10",
              "text-base text-ink",
              "transition-colors duration-120 ease-out",

              error ? "border-error-ink" : "border-strong focus:border-brand-ink",

              "disabled:opacity-50 disabled:cursor-not-allowed",

              className,
            )}
            onChange={handleChange}
          >
            {children}
          </select>

          {/* Custom Chevron icon for select */}
          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-ink-hint">
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

          {/* Error icon */}
          {error && (
            <div className="absolute right-9 top-1/2 -translate-y-1/2 text-error-ink pointer-events-none">
              <AlertCircle className="h-5 w-5" aria-hidden="true" />
            </div>
          )}
        </div>

        {/* Helper text or error message */}
        {(error || helperText) && (
          <p
            id={messageId}
            role={error ? "alert" : undefined}
            className={cn(
              "mt-1.5 text-caption px-1",
              error ? "text-error-ink" : "text-ink-hint",
            )}
          >
            {error || helperText}
          </p>
        )}
      </div>
    );
  },
);

Select.displayName = "Select";
