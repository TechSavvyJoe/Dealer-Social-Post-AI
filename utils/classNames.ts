import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Utility for merging Tailwind CSS classes with proper conflict resolution.
 * Uses clsx for conditional classes and tailwind-merge to handle Tailwind conflicts.
 *
 * @example
 * cn('px-2 py-1', condition && 'bg-primary-500')
 * cn('px-4', 'px-2') // Returns 'px-2' (later value wins)
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
