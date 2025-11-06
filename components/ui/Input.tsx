import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle } from 'lucide-react';
import { cn } from '../../utils/classNames';

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
      fullWidth = false,
      type = 'text',
      id,
      ...props
    },
    ref
  ) => {
    const [isFocused, setIsFocused] = useState(false);
    const [hasValue, setHasValue] = useState(!!props.value || !!props.defaultValue);

    const inputId = id || `input-${label?.toLowerCase().replace(/\s+/g, '-')}`;
    const showFloatingLabel = isFocused || hasValue;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setHasValue(e.target.value.length > 0);
      props.onChange?.(e);
    };

    return (
      <div className={cn('relative', fullWidth && 'w-full')}>
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
            ref={ref}
            id={inputId}
            type={type}
            className={cn(
              // Base styles
              'w-full rounded-xl',
              'bg-surface-900/60 border-2',
              'px-4 py-3',
              'text-base text-surface-50',
              'placeholder:text-surface-500',
              'transition-all duration-200 ease-apple',

              // Focus state
              'focus:outline-none focus:ring-0',
              error
                ? 'border-error-500/50 focus:border-error-500'
                : 'border-surface-700 focus:border-primary-500',

              // Disabled state
              'disabled:opacity-50 disabled:cursor-not-allowed',

              // With icons padding
              leftIcon && 'pl-11',
              rightIcon && 'pr-11',

              // With floating label
              label && (showFloatingLabel ? 'pt-6 pb-2' : 'pt-3 pb-3'),

              className
            )}
            onFocus={(e) => {
              setIsFocused(true);
              props.onFocus?.(e);
            }}
            onBlur={(e) => {
              setIsFocused(false);
              props.onBlur?.(e);
            }}
            onChange={handleChange}
            placeholder={showFloatingLabel ? props.placeholder : label || props.placeholder}
            {...props}
          />

          {/* Floating label */}
          {label && (
            <label
              htmlFor={inputId}
              className={cn(
                'absolute left-4 transition-all duration-200 ease-apple pointer-events-none',
                leftIcon && 'left-11',
                showFloatingLabel
                  ? 'top-1.5 text-xs text-primary-400 font-medium'
                  : 'top-1/2 -translate-y-1/2 text-base text-surface-400'
              )}
            >
              {label}
            </label>
          )}

          {/* Right icon or error icon */}
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none">
            {error ? (
              <AlertCircle className="h-5 w-5 text-error-500" aria-hidden="true" />
            ) : (
              rightIcon && <span className="[&>svg]:h-5 [&>svg]:w-5">{rightIcon}</span>
            )}
          </div>
        </div>

        {/* Helper text or error message */}
        <AnimatePresence mode="wait">
          {(error || helperText) && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
              className={cn(
                'mt-1.5 text-sm px-1',
                error ? 'text-error-400' : 'text-surface-400'
              )}
            >
              {error || helperText}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    );
  }
);

Input.displayName = 'Input';

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
      ...props
    },
    ref
  ) => {
    const [isFocused, setIsFocused] = useState(false);
    const [hasValue, setHasValue] = useState(!!props.value || !!props.defaultValue);

    const textareaId = id || `textarea-${label?.toLowerCase().replace(/\s+/g, '-')}`;
    const showFloatingLabel = isFocused || hasValue;

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setHasValue(e.target.value.length > 0);

      // Auto-resize
      if (autoResize) {
        e.target.style.height = 'auto';
        e.target.style.height = `${e.target.scrollHeight}px`;
      }

      props.onChange?.(e);
    };

    return (
      <div className={cn('relative', fullWidth && 'w-full')}>
        <div className="relative">
          <textarea
            ref={ref}
            id={textareaId}
            className={cn(
              // Base styles
              'w-full rounded-xl',
              'bg-surface-900/60 border-2',
              'px-4 py-3',
              'text-base text-surface-50',
              'placeholder:text-surface-500',
              'transition-all duration-200 ease-apple',
              'resize-none',

              // Focus state
              'focus:outline-none focus:ring-0',
              error
                ? 'border-error-500/50 focus:border-error-500'
                : 'border-surface-700 focus:border-primary-500',

              // Disabled state
              'disabled:opacity-50 disabled:cursor-not-allowed',

              // With floating label
              label && (showFloatingLabel ? 'pt-6 pb-2' : 'pt-3 pb-3'),

              className
            )}
            onFocus={(e) => {
              setIsFocused(true);
              props.onFocus?.(e);
            }}
            onBlur={(e) => {
              setIsFocused(false);
              props.onBlur?.(e);
            }}
            onChange={handleChange}
            placeholder={showFloatingLabel ? props.placeholder : label || props.placeholder}
            {...props}
          />

          {/* Floating label */}
          {label && (
            <label
              htmlFor={textareaId}
              className={cn(
                'absolute left-4 transition-all duration-200 ease-apple pointer-events-none',
                showFloatingLabel
                  ? 'top-1.5 text-xs text-primary-400 font-medium'
                  : 'top-3 text-base text-surface-400'
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
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
              className={cn(
                'mt-1.5 text-sm px-1',
                error ? 'text-error-400' : 'text-surface-400'
              )}
            >
              {error || helperText}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';
