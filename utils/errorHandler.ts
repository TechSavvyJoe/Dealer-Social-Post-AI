export type ErrorKind =
  | "network"
  | "timeout"
  | "quota"
  | "unauthorized"
  | "model_unavailable"
  | "validation"
  | "blocked"
  | "outdated"
  | "unknown";

export interface NormalizedError extends Error {
  kind: ErrorKind;
  retryable: boolean;
  original?: unknown;
}

const baseMessageForKind: Record<ErrorKind, string> = {
  network: "We lost connection to the server.",
  timeout: "The request took too long.",
  quota: "You have hit the current generation quota.",
  unauthorized: "The request was not authorized.",
  model_unavailable: "The AI model is temporarily unavailable.",
  validation: "The request was rejected. Please check your inputs.",
  blocked: "This photo or wording can't be used for an AI post.",
  outdated: "This version of the app is out of date.",
  unknown: "Something went wrong.",
};

const isTypedError = (value: unknown): value is NormalizedError =>
  typeof value === "object" && value !== null && "kind" in value;

/**
 * Follow `cause` links until an already-typed error appears. Wrappers such as
 * the model-ladder failure and the "Failed to generate text content" prefix
 * keep the provider failure as their cause; without this walk a terminal
 * blocked-content error would be re-classified from its curated, token-free
 * message and downgraded to a retryable "unknown".
 */
const findTypedCause = (error: unknown, depth = 0): NormalizedError | null => {
  if (depth > 8 || typeof error !== "object" || error === null) return null;
  if (isTypedError(error)) return error;
  const cause = (error as { cause?: unknown }).cause;
  if (cause === undefined || cause === error) return null;
  return findTypedCause(cause, depth + 1);
};

/**
 * The provider refused the request on content grounds (Gemini SAFETY,
 * PROHIBITED_CONTENT, IMAGE_SAFETY, a prompt-level blockReason, or an empty
 * RECITATION stop). Retrying the same photo and wording on another model or
 * vendor cannot change the verdict, so the error is terminal and carries the
 * curated copy directly. The technical reason rides along on `original`.
 */
export const createBlockedContentError = (reason: string): NormalizedError => {
  const error = new Error(baseMessageForKind.blocked) as NormalizedError;
  error.name = "BlockedContentError";
  error.kind = "blocked";
  error.retryable = false;
  error.original = new Error(`AI provider blocked the request (${reason}).`);
  return error;
};

export const isBlockedContentError = (error: unknown): boolean =>
  normalizeError(error).kind === "blocked";

/**
 * The proxy refused the request with 409 POLICY_VERSION_MISMATCH: the
 * installed app was built against an older model policy than the server now
 * enforces. No retry, fallback model, or other vendor can help — only an app
 * update — so the error is terminal and carries the curated copy directly.
 * Version numbers ride along on `original` for diagnostics only.
 */
export const createOutdatedClientError = (
  clientVersion: string,
  serverVersion: string,
): NormalizedError => {
  const error = new Error(baseMessageForKind.outdated) as NormalizedError;
  error.name = "OutdatedClientError";
  error.kind = "outdated";
  error.retryable = false;
  error.original = new Error(
    `Model policy version mismatch (client ${clientVersion || "unknown"}, server ${
      serverVersion || "unknown"
    }).`,
  );
  return error;
};

export const isOutdatedClientError = (error: unknown): boolean =>
  normalizeError(error).kind === "outdated";

export const normalizeError = (error: unknown): NormalizedError => {
  if (isTypedError(error)) {
    const existing = error;
    const normalized = new Error(existing.message) as NormalizedError;
    normalized.kind = existing.kind;
    normalized.retryable = existing.retryable;
    normalized.original = existing.original ?? error;
    return normalized;
  }

  // RetryError intentionally carries the last provider failure separately
  // from its generic "failed after N attempts" wrapper. Classify that terminal
  // failure so a real outage does not get downgraded to an unknown error.
  if (
    typeof error === "object" &&
    error !== null &&
    "lastError" in error &&
    (error as { lastError?: unknown }).lastError !== error
  ) {
    const terminal = normalizeError((error as { lastError?: unknown }).lastError);
    terminal.original = error;
    return terminal;
  }

  // Plain wrappers keep their typed provider failure on `cause`; adopt that
  // classification instead of guessing from the wrapper's message.
  const typedCause = findTypedCause(error);
  if (typedCause) {
    const normalized = normalizeError(typedCause);
    normalized.original = error;
    return normalized;
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown error";
  const lower = message.toLowerCase();

  let kind: ErrorKind = "unknown";
  let retryable = true;

  // No substring token exists for `blocked` or `outdated` on purpose: "AI
  // caption blocked by quality gate" is a retryable Gemini-side failure, and a
  // content refusal or stale-client rejection always arrives typed via
  // `createBlockedContentError` / `createOutdatedClientError`.
  if (
    lower.includes("network") ||
    lower.includes("failed to fetch") ||
    lower.includes("offline")
  ) {
    kind = "network";
  } else if (lower.includes("404") || lower.includes("not found")) {
    kind = "model_unavailable";
    retryable = false;
  } else if (
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("abort")
  ) {
    kind = "timeout";
  } else if (lower.includes("quota") || lower.includes("429")) {
    kind = "quota";
    retryable = false;
  } else if (
    lower.includes("unauthorized") ||
    lower.includes("forbidden") ||
    lower.includes("401") ||
    lower.includes("403")
  ) {
    kind = "unauthorized";
    retryable = false;
  } else if (
    lower.includes("unavailable") ||
    lower.includes("overloaded") ||
    lower.includes("busy")
  ) {
    kind = "model_unavailable";
  } else if (
    lower.includes("invalid") ||
    lower.includes("bad request") ||
    lower.includes("400")
  ) {
    kind = "validation";
    retryable = false;
  }

  // User-facing message stays curated; the raw technical text rides along on
  // `original` for telemetry and console diagnostics only.
  const normalized = new Error(baseMessageForKind[kind]) as NormalizedError;
  normalized.kind = kind;
  normalized.retryable = retryable;
  normalized.original = error;
  return normalized;
};

export const recoveryHint = (error: NormalizedError): string => {
  switch (error.kind) {
    case "network":
      return "Check your internet connection and try again.";
    case "timeout":
      return "The AI took too long to respond. Try again in a moment.";
    case "quota":
      return "The studio is busy right now — try again in a few minutes.";
    case "unauthorized":
      return "Your session may have ended — sign in again.";
    case "model_unavailable":
      return "The model is busy. Retrying usually fixes this.";
    case "validation":
      return "Adjust your photo or details and try again.";
    case "blocked":
      return "Try a different photo or adjust the details.";
    case "outdated":
      return "Update the app from your Home Screen, then try again.";
    default:
      return "Please try again.";
  }
};

export const formatErrorForToast = (error: NormalizedError): string => {
  return `${error.message} ${recoveryHint(error)}`.trim();
};
