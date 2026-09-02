export type ErrorKind =
  | "network"
  | "timeout"
  | "quota"
  | "unauthorized"
  | "model_unavailable"
  | "validation"
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
  unknown: "Something went wrong.",
};

export const normalizeError = (error: unknown): NormalizedError => {
  if (typeof error === "object" && error !== null && "kind" in (error as any)) {
    const existing = error as NormalizedError;
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

  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown error";
  const lower = message.toLowerCase();

  let kind: ErrorKind = "unknown";
  let retryable = true;

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
    default:
      return "Please try again.";
  }
};

export const formatErrorForToast = (error: NormalizedError): string => {
  return `${error.message} ${recoveryHint(error)}`.trim();
};
