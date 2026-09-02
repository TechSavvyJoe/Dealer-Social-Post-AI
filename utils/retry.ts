/**
 * Retry utility with exponential backoff
 * Automatically retries failed operations with increasing delays
 */

interface RetryOptions {
  maxAttempts?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  onRetry?: (attempt: number, error: Error) => void;
  /**
   * Predicate deciding whether an error is worth retrying. Defaults to
   * "retry unless the error is clearly permanent" (4xx / auth / validation).
   * Retrying those wastes attempts and, for non-idempotent operations, risks
   * duplicate side effects (e.g. double image generations / double charges).
   */
  shouldRetry?: (error: Error) => boolean;
  /** Cancels both the active attempt (when the operation observes it) and backoff. */
  signal?: AbortSignal;
}

/**
 * Heuristic for errors that will never succeed on retry, so we should fail
 * fast instead of burning the backoff budget.
 */
function isPermanentError(error: Error): boolean {
  const m = error.message.toLowerCase();
  return (
    m.includes("400") ||
    m.includes("401") ||
    m.includes("403") ||
    m.includes("404") ||
    m.includes("422") ||
    m.includes("unauthorized") ||
    m.includes("forbidden") ||
    m.includes("not found") ||
    m.includes("invalid") ||
    m.includes("validation")
  );
}

export class RetryError extends Error {
  constructor(
    message: string,
    public readonly lastError: Error,
    public readonly attempts: number,
  ) {
    super(message);
    this.name = "RetryError";
  }
}

const abortReason = (signal: AbortSignal): unknown =>
  signal.reason ?? new DOMException("Operation cancelled", "AbortError");

const waitForRetry = (delay: number, signal?: AbortSignal): Promise<void> => {
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, delay));
  }

  return new Promise((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(abortReason(signal));
    };

    if (signal.aborted) {
      onAbort();
      return;
    }

    timeoutId = setTimeout(() => {
      cleanup();
      resolve();
    }, delay);
    signal.addEventListener("abort", onAbort, { once: true });

    // Close the small race between the first aborted check and listener setup.
    if (signal.aborted) onAbort();
  });
};

/**
 * Retry an async operation with exponential backoff
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    backoffMultiplier = 2,
    onRetry,
    shouldRetry = (e: Error) => !isPermanentError(e),
    signal,
  } = options;

  let lastError: Error = new Error("Unknown error");

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) throw abortReason(signal);

    try {
      return await operation();
    } catch (error) {
      if (
        error !== null &&
        typeof error === "object" &&
        "name" in error &&
        error.name === "AbortError"
      ) {
        throw error;
      }
      lastError = error instanceof Error ? error : new Error(String(error));

      // Fail fast on errors that can't succeed on retry — surface the real
      // error immediately rather than after N pointless attempts.
      if (!shouldRetry(lastError)) {
        throw lastError;
      }

      if (attempt === maxAttempts) {
        throw new RetryError(
          `Operation failed after ${maxAttempts} attempts`,
          lastError,
          maxAttempts,
        );
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(
        initialDelay * Math.pow(backoffMultiplier, attempt - 1),
        maxDelay,
      );

      onRetry?.(attempt, lastError);

      // Wait before retrying
      await waitForRetry(delay, signal);
    }
  }

  throw lastError;
}

/**
 * Check if an error is retryable (network errors, timeouts, 5xx errors)
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("network") ||
      message.includes("timeout") ||
      message.includes("503") ||
      message.includes("502") ||
      message.includes("500")
    );
  }
  return false;
}
