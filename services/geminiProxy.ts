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

/**
 * The proxy's own request validation answers 400 with exactly this body before
 * anything is sent upstream (pb_hooks/main.pb.js), so a match proves no paid
 * job was started. A relayed Google 400 carries `{ error: { code, message,
 * status } }` instead and never matches.
 */
export const PROXY_VALIDATION_REJECTION = "Invalid or unsupported generation request";

export const isProxyValidationRejection = (
  status: number,
  bodyText: string,
): boolean => {
  if (status !== 400) return false;
  try {
    const json = JSON.parse(bodyText) as { error?: unknown };
    return json?.error === PROXY_VALIDATION_REJECTION;
  } catch {
    return false;
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

const isAbortException = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "name" in error &&
  error.name === "AbortError";

const indeterminatePostError = (
  kind: "network" | "timeout",
  phase: "fetch" | "response" | "parse",
  status?: number,
): NormalizedError =>
  normalizedProxyError(
    "The request outcome is unknown because the AI service response was incomplete.",
    kind,
    false,
    { phase, ...(status === undefined ? {} : { status }) },
  );

/** A paid generation may have reached the provider despite losing its reply. */
export const isIndeterminateGenerationError = (error: unknown): boolean => {
  const normalized = normalizeError(error);
  return (
    normalized.retryable === false &&
    (normalized.kind === "network" || normalized.kind === "timeout")
  );
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
  const timeoutId = setTimeout(
    () => {
      didTimeout = true;
      controller.abort();
    },
    method === "POST" ? 110000 : 300000,
  ); // POST stays below Vercel's 120-second external proxy limit.
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

    // Network errors and 5xx responses count against the circuit; only GETs
    // may retry. A 4xx means the service answered, so it is parsed
    // below and surfaced immediately without poisoning service health.
    const response = await withCircuitBreaker(serviceKey, async () => {
      return await retryWithBackoff(
        async () => {
          assertAuthEpoch(requestAuthEpoch);
          let res: Response;
          try {
            res = await fetch(`/api/proxy/${path}`, {
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
          } catch (error) {
            if (controller.signal.aborted) {
              throw new DOMException("Request cancelled", "AbortError");
            }
            if (method === "POST" && !isAbortException(error)) {
              // Safari may report only "Load failed"; transport failure
              // classification must not depend on browser-specific wording.
              throw indeterminatePostError("network", "fetch");
            }
            throw error;
          }

          if (res.status >= 500) {
            // Release the unread error body before a safe GET retry or the
            // terminal POST outcome; no provider error text is retained.
            await res.body?.cancel().catch(() => undefined);
            throw normalizedProxyError(
              method === "POST"
                ? "The request outcome is unknown because the AI service did not respond."
                : "The AI service is temporarily unavailable.",
              method === "POST" ? "network" : "model_unavailable",
              method === "GET",
              { status: res.status },
            );
          }

          return res;
        },
        {
          // Generation POSTs can incur cost before a response is lost. Only
          // safe reads such as long-running operation polls may be replayed.
          maxAttempts: method === "GET" ? 3 : 1,
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

    let responseText: string;
    try {
      responseText = await response.text();
    } catch (error) {
      if (controller.signal.aborted) {
        throw new DOMException("Request cancelled", "AbortError");
      }
      if (method === "POST" && response.ok && !isAbortException(error)) {
        throw indeterminatePostError("network", "response", response.status);
      }
      // A completed 4xx response already establishes that the request was
      // rejected. Its body may refine the message (for example 409 policy
      // mismatch), but a lost body must not turn that rejection into a paid
      // unknown outcome.
      if (
        method === "POST" &&
        !response.ok &&
        response.status < 500 &&
        !isAbortException(error)
      ) {
        responseText = "";
      } else {
        throw error;
      }
    }
    assertAuthEpoch(requestAuthEpoch);

    if (!response.ok) {
      if (response.status === 401) notifySessionRejected(requestAuthEpoch);
      console.error(
        `[GeminiProxy] [${requestId}] ${method} ${path} failed (${response.status}).`,
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
          { status: response.status },
        );
      }
      if (response.status === 429) {
        throw normalizedProxyError(
          "Too many requests — try again in a minute.",
          "quota",
          false,
          { status: response.status },
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

    let parsed: unknown;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      if (method === "POST") {
        // The provider may have completed and billed the job even though its
        // response was empty or malformed. Do not send the paid POST again.
        throw indeterminatePostError("network", "parse", response.status);
      }
      // Safe GET callers retain the raw-text behavior for non-JSON responses.
      assertAuthEpoch(requestAuthEpoch);
      return responseText;
    }
    if (
      method === "POST" &&
      (typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed) ||
        Object.keys(parsed).length === 0)
    ) {
      throw indeterminatePostError("network", "parse", response.status);
    }
    assertAuthEpoch(requestAuthEpoch);
    return parsed;
  } catch (error) {
    performanceMonitor.measure(`${markName}-error`, `${markName}-start`);

    if (isAbortException(error) && controller.signal.aborted) {
      if (!didTimeout && externalSignal?.aborted) {
        throw externalSignal.reason instanceof Error
          ? externalSignal.reason
          : new DOMException("Request cancelled", "AbortError");
      }
      console.error(
        `[GeminiProxy] [${requestId}] ${method} ${path} timed out after ${method === "POST" ? 110 : 300} seconds.`,
      );
      throw normalizedProxyError(
        "The request outcome is unknown because the AI service did not respond in time.",
        "timeout",
        false,
        error,
      );
    }
    throw normalizeError(error);
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener("abort", relayExternalAbort);
  }
}
