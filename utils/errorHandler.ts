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

  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
      ? error
      : "Unknown error";
  const lower = message.toLowerCase();

  let kind: ErrorKind = "unknown";
  let retryable = true;

  if (lower.includes("network") || lower.includes("failed to fetch") || lower.includes("offline")) {
    kind = "network";
  } else if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("abort")) {
    kind = "timeout";
  } else if (lower.includes("quota") || lower.includes("429")) {
    kind = "quota";
    retryable = false;
  } else if (lower.includes("unauthorized") || lower.includes("forbidden") || lower.includes("401") || lower.includes("403")) {
    kind = "unauthorized";
    retryable = false;
  } else if (lower.includes("unavailable") || lower.includes("overloaded") || lower.includes("busy")) {
    kind = "model_unavailable";
  } else if (lower.includes("invalid") || lower.includes("bad request") || lower.includes("400")) {
    kind = "validation";
    retryable = false;
  }

  const friendly = `${baseMessageForKind[kind]} ${message}`;
  const normalized = new Error(friendly) as NormalizedError;
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
      return "Try again later or reduce concurrent requests.";
    case "unauthorized":
      return "Verify your API credentials or login status.";
    case "model_unavailable":
      return "The model is busy. Retrying usually fixes this.";
    case "validation":
      return "Adjust the request parameters and retry.";
    default:
      return "Please try again.";
  }
};

export const formatErrorForToast = (error: NormalizedError): string => {
  return `${error.message} ${recoveryHint(error)}`.trim();
};
