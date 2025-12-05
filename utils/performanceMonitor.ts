/**
 * Performance monitoring utility
 * Tracks key metrics and user journeys
 */

interface PerformanceMark {
  name: string;
  timestamp: number;
}

class PerformanceMonitor {
  private marks: Map<string, PerformanceMark> = new Map();
  private measures: Map<string, number> = new Map();

  /**
   * Mark the start of a performance measurement
   */
  mark(name: string): void {
    if (typeof performance !== "undefined" && performance.mark) {
      performance.mark(name);
    }
    this.marks.set(name, {
      name,
      timestamp: Date.now(),
    });
  }

  /**
   * Measure the time between two marks
   */
  measure(name: string, startMark: string, endMark?: string): number | null {
    const start = this.marks.get(startMark);
    if (!start) {
      console.warn(`Performance mark "${startMark}" not found`);
      return null;
    }

    const endTime = endMark
      ? this.marks.get(endMark)?.timestamp || Date.now()
      : Date.now();

    const duration = endTime - start.timestamp;
    this.measures.set(name, duration);

    // Use native Performance API if available
    if (typeof performance !== "undefined" && performance.measure) {
      try {
        performance.measure(name, startMark, endMark);
      } catch (e) {
        // Silently fail if marks don't exist in native API
      }
    }

    return duration;
  }

  /**
   * Log slow operations (over threshold)
   */
  logSlowOperation(
    name: string,
    duration: number,
    threshold: number = 1000
  ): void {
    if (duration > threshold) {
      console.warn(
        `[Performance] Slow operation detected: ${name} took ${duration}ms`
      );
    }
  }

  /**
   * Get all measures
   */
  getMeasures(): Record<string, number> {
    return Object.fromEntries(this.measures);
  }

  /**
   * Clear all marks and measures
   */
  clear(): void {
    this.marks.clear();
    this.measures.clear();
    if (typeof performance !== "undefined" && performance.clearMarks) {
      performance.clearMarks();
      performance.clearMeasures();
    }
  }
}

// Singleton instance
export const performanceMonitor = new PerformanceMonitor();

// Helper functions for common patterns
export const measureAsyncOperation = async <T>(
  name: string,
  operation: () => Promise<T>
): Promise<T> => {
  performanceMonitor.mark(`${name}-start`);
  try {
    const result = await operation();
    const duration = performanceMonitor.measure(name, `${name}-start`) || 0;
    performanceMonitor.logSlowOperation(name, duration);
    return result;
  } catch (error) {
    performanceMonitor.measure(`${name}-error`, `${name}-start`);
    throw error;
  }
};
