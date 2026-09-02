/**
 * User-friendly error messages with actionable suggestions
 * Transforms technical errors into helpful guidance
 */

interface ErrorMessage {
  title: string;
  description: string;
  action?: string;
  actionLabel?: string;
}

const ERROR_MESSAGES: Record<string, ErrorMessage> = {
  // Network errors
  NETWORK_ERROR: {
    title: "Connection Issue",
    description:
      "Unable to connect to the server. Please check your internet connection.",
    action: "retry",
    actionLabel: "Try Again",
  },
  TIMEOUT: {
    title: "Request Timed Out",
    description:
      "The server is taking too long to respond. This might be due to high traffic.",
    action: "retry",
    actionLabel: "Retry",
  },

  // Authentication errors
  AUTH_INVALID: {
    title: "Invalid Dealer Code",
    description:
      "The code you entered doesn't match our records. Please check and try again.",
    action: "input",
    actionLabel: "Enter Code",
  },
  AUTH_EXPIRED: {
    title: "Session Expired",
    description: "Your session has expired. Please sign in again to continue.",
    action: "login",
    actionLabel: "Sign In",
  },

  // Generation errors
  GENERATION_FAILED: {
    title: "Generation Failed",
    description:
      "We couldn't generate your content. Please try again or adjust your settings.",
    action: "retry",
    actionLabel: "Try Again",
  },
  RATE_LIMITED: {
    title: "Too Many Requests",
    description:
      "You've made too many requests. Please wait a moment before trying again.",
    action: "wait",
    actionLabel: "Wait 30s",
  },

  // Image errors
  IMAGE_LOAD_FAILED: {
    title: "Image Load Failed",
    description: "We couldn't load the image. Please try uploading a different photo.",
    action: "upload",
    actionLabel: "Upload New",
  },
  IMAGE_TOO_LARGE: {
    title: "Image Too Large",
    description: "The image file is too large. Please use an image under 10MB.",
    action: "upload",
    actionLabel: "Choose Smaller",
  },

  // Generic fallback
  UNKNOWN: {
    title: "Something Went Wrong",
    description: "An unexpected error occurred. Please try again.",
    action: "retry",
    actionLabel: "Try Again",
  },
};

/**
 * Get user-friendly error message from error
 */
export function getErrorMessage(error: unknown): ErrorMessage {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    if (message.includes("network") || message.includes("fetch")) {
      return ERROR_MESSAGES.NETWORK_ERROR;
    }
    if (message.includes("timeout")) {
      return ERROR_MESSAGES.TIMEOUT;
    }
    if (message.includes("invalid") && message.includes("code")) {
      return ERROR_MESSAGES.AUTH_INVALID;
    }
    if (message.includes("expired") || message.includes("401")) {
      return ERROR_MESSAGES.AUTH_EXPIRED;
    }
    if (message.includes("429") || message.includes("rate")) {
      return ERROR_MESSAGES.RATE_LIMITED;
    }
    if (message.includes("generation")) {
      return ERROR_MESSAGES.GENERATION_FAILED;
    }
    if (message.includes("image") && message.includes("load")) {
      return ERROR_MESSAGES.IMAGE_LOAD_FAILED;
    }
    if (message.includes("too large") || message.includes("size")) {
      return ERROR_MESSAGES.IMAGE_TOO_LARGE;
    }
  }

  return ERROR_MESSAGES.UNKNOWN;
}

/**
 * Format error for display with optional custom message
 */
export function formatErrorForDisplay(
  error: unknown,
  customTitle?: string,
): { title: string; description: string } {
  const errorMessage = getErrorMessage(error);
  return {
    title: customTitle || errorMessage.title,
    description: errorMessage.description,
  };
}

/**
 * Raw transport/SDK boilerplate that should never reach the UI verbatim.
 * Matched case-insensitively as substrings. Covers browser fetch failures
 * ("Failed to fetch", iOS Safari's "Load failed"), HTTP statusText fallbacks
 * ("Request failed", "Internal Server Error"), and PocketBase's generic
 * server error.
 */
const RAW_TRANSPORT_SIGNATURES = [
  "fetch",
  "network",
  "timeout",
  "401",
  "429",
  "load failed",
  "request failed",
  "internal server error",
  "something went wrong while processing your request",
];

/**
 * Turn a caught error into copy that is safe to render to salespeople and
 * managers.
 *
 * - Curated NormalizedError copy (utils/errorHandler) passes through.
 * - Server ApiError copy passes through (duck-typed on `name`/`code` to avoid
 *   a utils -> services import) — except its statusText fallbacks, which are
 *   transport boilerplate and get mapped instead.
 * - Errors whose message looks like raw transport/SDK text get the friendly
 *   mapped description.
 * - Any other Error message is curated app copy and passes through.
 * - Non-Error values fall back to the caller's copy.
 */
export function toUiMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    // NormalizedError: message is curated product copy by construction.
    if ("kind" in err) {
      return err.message;
    }

    const lower = err.message.toLowerCase();
    const looksRaw = RAW_TRANSPORT_SIGNATURES.some((signature) =>
      lower.includes(signature),
    );

    // ApiError with a server-assigned code: payload messages are product copy.
    if (err.name === "ApiError" && (err as { code?: unknown }).code && !looksRaw) {
      return err.message;
    }

    if (looksRaw) {
      // iOS Safari reports offline fetches as "Load failed", which
      // getErrorMessage cannot classify — treat it as a network failure.
      if (lower.includes("load failed")) {
        return ERROR_MESSAGES.NETWORK_ERROR.description;
      }
      return getErrorMessage(err).description;
    }

    // Remaining Error messages are curated app copy (internal throws).
    return err.message.trim() ? err.message : fallback;
  }

  return fallback;
}
