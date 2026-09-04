import {
  createOutdatedClientError,
  normalizeError,
  type NormalizedError,
} from "../utils/errorHandler";
import { retryWithBackoff } from "../utils/retry";
import { performanceMonitor } from "../utils/performanceMonitor";
import { withCircuitBreaker } from "../utils/circuitBreaker";
import { MODEL_POLICY_VERSION, type ModelTaskName } from "./modelConfig";
import {
  assertAuthEpoch,
  captureAuthEpoch,
  notifySessionRejected,
} from "../utils/authBoundary";

// Request tracking for debugging
let requestCounter = 0;

/**
 * Per-request tracing is a local debugging affordance, not production
 * telemetry. Every generation used to log a request line and a response line
 * unconditionally, which buried the `console.error` a support session is
 * actually looking for (and put paths and status codes in a salesperson's
 * console). Genuine failures below still use `console.error`; real telemetry
 * goes through `utils/telemetry`.
 */
const traceProxy = (message: string) => {
  if (import.meta.env.DEV) console.log(message);
};

/**
 * What the browser is doing with a generation request, sent as
 * `X-Generation-Purpose` so the server's usage ledger can tell a vision-QC
 * review or caption pack apart from a plain caption. Accounting metadata
 * only: the proxy ignores unknown values and defaults by task kind (text →
 * caption, image → image, video → video). Mirrors GENERATION_PURPOSES in
 * pb_hooks/helpers.js.
 */
export type GenerationPurpose =
  "caption" | "vision_review" | "caption_pack" | "website_draft" | "image" | "video";

/**
 * The proxy answers a stale installed client with 409 POLICY_VERSION_MISMATCH
 * before validating the body. Shared by the JSON proxy path and the raw Veo
 * start request so both surface the same terminal "update the app" error.
 */
export const outdatedClientErrorFromResponse = (
  status: number,
  bodyText: string,
): NormalizedError | null => {
  if (status !== 409) return null;
  try {
    const json = JSON.parse(bodyText) as { code?: unknown; currentVersion?: unknown };
    if (json?.code !== "POLICY_VERSION_MISMATCH") return null;
    const serverVersion =
      typeof json.currentVersion === "string" || typeof json.currentVersion === "number"
        ? String(json.currentVersion)
        : "";
    return createOutdatedClientError(MODEL_POLICY_VERSION, serverVersion);
  } catch {
    return null;
  }
};

// Errors thrown to the UI must read like product copy, but the retry/toast
// machinery still routes on `kind`. Building the NormalizedError here keeps
// classification exact without leaking status codes into the message.
const normalizedProxyError = (
  message: string,
  kind: NormalizedError["kind"],
  retryable: boolean,
  original: unknown,
): NormalizedError => {
  const err = new Error(message) as NormalizedError;
  err.kind = kind;
  err.retryable = retryable;
  err.original = original;
  return err;
};

/**
 * A wrapper for the fetch API to communicate with our backend proxy for Gemini.
 * Now includes retry logic, performance monitoring, and enhanced error handling.
 * @param method 'GET' or 'POST'
 * @param path The path for the Google API (e.g., 'v1beta/models/gemini-3.6-flash:generateContent')
 * @param body The request body to be sent to the Gemini API.
 * @param purpose Usage-ledger label (see GenerationPurpose); sent only with a task.
 * @returns The JSON response from the API.
 */
export async function fetchFromProxy(
  method: "GET" | "POST",
  path: string,
  body: unknown,
  task?: ModelTaskName,
  attemptId?: string,
  requestAuthEpoch: number = captureAuthEpoch(),
  externalSignal?: AbortSignal,
  purpose?: GenerationPurpose,
) {
  assertAuthEpoch(requestAuthEpoch);
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw normalizeError(new Error("Offline: please reconnect to the internet."));
  }

  const requestId = ++requestCounter;
  const markName = `proxy-${requestId}`;
  performanceMonitor.mark(`${markName}-start`);

  const controller = new AbortController();
  let didTimeout = false;
  const timeoutId = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, 300000); // 300 second timeout (5 minutes)
  const relayExternalAbort = () => controller.abort();
  if (externalSignal?.aborted) relayExternalAbort();
  else externalSignal?.addEventListener("abort", relayExternalAbort, { once: true });

  try {
    traceProxy(`[GeminiProxy] [${requestId}] Requesting ${method} ${path}`);

    // Auth is the HttpOnly session cookie. Provider credentials never enter
    // the browser bundle.
    let serviceKey = "gemini-api";
    if (path.includes("image")) serviceKey = "gemini-image-api";
    else if (path.includes("veo") || path.includes("video")) serviceKey = "veo-api";

    // Only network errors and 5xx responses count against the circuit and get
    // retried. A 4xx means the service answered successfully, so it is parsed
    // below and surfaced immediately without poisoning service health.
    const response = await withCircuitBreaker(serviceKey, async () => {
      return await retryWithBackoff(
        async () => {
          assertAuthEpoch(requestAuthEpoch);
          const res = await fetch(`/api/proxy/${path}`, {
            method,
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              ...(task
                ? {
                    "X-Generation-Task": task,
                    "X-Model-Policy-Version": MODEL_POLICY_VERSION,
                    ...(attemptId ? { "X-Generation-Attempt-ID": attemptId } : {}),
                    ...(purpose ? { "X-Generation-Purpose": purpose } : {}),
                  }
                : {}),
            },
            body: method === "POST" ? JSON.stringify(body) : undefined,
            signal: controller.signal,
          });

          if (res.status >= 500) {
            throw normalizedProxyError(
              "The AI service is temporarily unavailable.",
              "model_unavailable",
              true,
              { status: res.status },
            );
          }

          return res;
        },
        {
          maxAttempts: 3,
          initialDelay: 1000,
          signal: controller.signal,
          shouldRetry: (error) => error.name !== "AbortError",
          onRetry: (attempt, error) => {
            console.warn(
              `[GeminiProxy] [${requestId}] Retry ${attempt}:`,
              error.message,
            );
          },
        },
      );
    });

    traceProxy(`[GeminiProxy] [${requestId}] Response ${response.status} for ${path}`);

    const responseText = await response.text();
    assertAuthEpoch(requestAuthEpoch);

    if (!response.ok) {
      if (response.status === 401) notifySessionRejected(requestAuthEpoch);
      // Prefer Google's structured error message when the body is JSON; fall
      // back to the raw text. The technical detail stays in the console — the
      // thrown message is what a salesperson reads in the toast.
      let detail: string;
      try {
        const errorJson = JSON.parse(responseText);
        detail = errorJson?.error?.message || JSON.stringify(errorJson);
      } catch {
        detail = responseText || `status ${response.status}`;
      }
      console.error(
        `[GeminiProxy] [${requestId}] ${method} ${path} failed (${response.status}): ${detail}`,
      );
      // A stale installed app: terminal, never retried, and already outside
      // the circuit breaker (only 5xx/network failures count against it).
      const outdated = outdatedClientErrorFromResponse(response.status, responseText);
      if (outdated) throw outdated;
      if (response.status === 401) {
        throw normalizedProxyError(
          "Session expired — please sign in again.",
          "unauthorized",
          false,
          detail,
        );
      }
      if (response.status === 429) {
        throw normalizedProxyError(
          "Too many requests — try again in a minute.",
          "quota",
          false,
          detail,
        );
      }
      // The numeric status doubles as normalizeError's classification token
      // (400 → validation, 404 → model_unavailable).
      throw new Error(
        `The AI service could not complete this request (error ${response.status}).`,
      );
    }

    // Log performance
    const duration = performanceMonitor.measure(markName, `${markName}-start`) || 0;
    if (duration > 10000) {
      console.warn(`[GeminiProxy] [${requestId}] Slow request: ${duration}ms`);
    }

    try {
      const parsed = JSON.parse(responseText);
      assertAuthEpoch(requestAuthEpoch);
      return parsed;
    } catch {
      // If the successful response is not JSON, return the raw text
      assertAuthEpoch(requestAuthEpoch);
      return responseText;
    }
  } catch (error) {
    performanceMonitor.measure(`${markName}-error`, `${markName}-start`);

    if (
      error !== null &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "AbortError" &&
      controller.signal.aborted
    ) {
      if (!didTimeout && externalSignal?.aborted) {
        throw externalSignal.reason instanceof Error
          ? externalSignal.reason
          : new DOMException("Request cancelled", "AbortError");
      }
      console.error(
        `[GeminiProxy] [${requestId}] ${method} ${path} timed out after 300 seconds.`,
      );
      throw new Error("The request timed out. Please try again.");
    }
    throw normalizeError(error);
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener("abort", relayExternalAbort);
  }
}
