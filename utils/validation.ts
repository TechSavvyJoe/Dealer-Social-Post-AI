import { z } from "zod";

/**
 * Unified validation feedback utilities
 * Provides consistent error messages across all form components
 */

// Common validation schemas
export const validationSchemas = {
  required: z.string().min(1, "This field is required"),
  email: z.string().email("Please enter a valid email address"),
  phone: z
    .string()
    .regex(/^\+?[\d\s-()]{10,}$/, "Please enter a valid phone number"),
  url: z.string().url("Please enter a valid URL"),
  minLength: (min: number) =>
    z.string().min(min, `Must be at least ${min} characters`),
  maxLength: (max: number) =>
    z.string().max(max, `Must be no more than ${max} characters`),
};

// Validation state type
export interface ValidationState {
  isValid: boolean;
  error?: string;
  touched: boolean;
}

/**
 * Validate a value against a schema
 */
export function validateField<T>(
  value: T,
  schema: z.ZodSchema<T>
): ValidationState {
  const result = schema.safeParse(value);
  return {
    isValid: result.success,
    error: result.success ? undefined : result.error.issues[0]?.message,
    touched: true,
  };
}

/**
 * Format validation error for display
 */
export function formatValidationError(error: string | undefined): string {
  if (!error) return "";
  // Capitalize first letter
  return error.charAt(0).toUpperCase() + error.slice(1);
}

/**
 * Combine multiple validation states
 */
export function combineValidationStates(
  states: ValidationState[]
): ValidationState {
  const hasError = states.some((s) => !s.isValid && s.touched);
  const firstError = states.find((s) => !s.isValid && s.touched);

  return {
    isValid: !hasError,
    error: firstError?.error,
    touched: states.some((s) => s.touched),
  };
}
