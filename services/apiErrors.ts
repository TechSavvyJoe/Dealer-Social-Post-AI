export type SessionErrorCode =
  "INVALID_CODE" | "CHALLENGE_REQUIRED" | "LOCKED" | "UNAVAILABLE";

export interface ApiErrorPayload {
  code?: string;
  error?: string;
  message?: string;
  retryAfterSeconds?: number;
  retry_after_seconds?: number;
}

const SESSION_CODES = new Set<SessionErrorCode>([
  "INVALID_CODE",
  "CHALLENGE_REQUIRED",
  "LOCKED",
  "UNAVAILABLE",
]);

export class ApiError extends Error {
  readonly code?: string;
  readonly status: number;
  readonly retryAfterSeconds?: number;

  constructor(
    message: string,
    options: { code?: string; status: number; retryAfterSeconds?: number },
  ) {
    super(message);
    this.name = "ApiError";
    this.code = options.code;
    this.status = options.status;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

const normalizeCode = (
  payload: ApiErrorPayload,
  status: number,
): string | undefined => {
  const candidate = (payload.code || payload.error || "").toUpperCase();
  if (candidate && /^[A-Z][A-Z0-9_]+$/.test(candidate)) return candidate;
  if (status === 429) return "LOCKED";
  if (status >= 500) return "UNAVAILABLE";
  if (status === 400 || status === 401) return "INVALID_CODE";
  return undefined;
};

export const readApiError = async (response: Response): Promise<ApiError> => {
  let payload: ApiErrorPayload = {};
  try {
    payload = (await response.json()) as ApiErrorPayload;
  } catch {
    // A proxy or offline response may not be JSON. Status still gives us a
    // stable, user-safe failure category.
  }

  const code = normalizeCode(payload, response.status);
  const retryAfterHeader = Number(response.headers.get("Retry-After") || 0);
  const retryAfterSeconds =
    payload.retryAfterSeconds ??
    payload.retry_after_seconds ??
    (retryAfterHeader > 0 ? retryAfterHeader : undefined);
  const message =
    payload.message ||
    (payload.error && payload.error !== code ? payload.error : undefined) ||
    response.statusText ||
    "Request failed";

  return new ApiError(message, {
    code,
    status: response.status,
    retryAfterSeconds,
  });
};

export const asSessionErrorCode = (value: string | undefined): SessionErrorCode =>
  value && SESSION_CODES.has(value as SessionErrorCode)
    ? (value as SessionErrorCode)
    : "UNAVAILABLE";
