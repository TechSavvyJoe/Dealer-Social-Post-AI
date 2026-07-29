import { normalizeError } from "../utils/errorHandler";
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
 * A wrapper for the fetch API to communicate with our backend proxy for Gemini.
 * Now includes retry logic, performance monitoring, and enhanced error handling.
 * @param method 'GET' or 'POST'
 * @param path The path for the Google API (e.g., 'v1beta/models/gemini-3.6-flash:generateContent')
 * @param body The request body to be sent to the Gemini API.
 * @returns The JSON response from the API.
 */
export async function fetchFromProxy(
  method: "GET" | "POST",
  path: string,
  body: unknown,
  task?: ModelTaskName,
  attemptId?: string,
  requestAuthEpoch: number = captureAuthEpoch(),
) {
  assertAuthEpoch(requestAuthEpoch);
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw normalizeError(new Error("Offline: please reconnect to the internet."));
  }

  const requestId = ++requestCounter;
  const markName = `proxy-${requestId}`;
  performanceMonitor.mark(`${markName}-start`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 300000); // 300 second timeout (5 minutes)

  try {
    console.log(`[GeminiProxy] [${requestId}] Requesting ${method} ${path}`);

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
                  }
                : {}),
            },
            body: method === "POST" ? JSON.stringify(body) : undefined,
            signal: controller.signal,
          });

          if (res.status >= 500) {
            throw new Error(`Server error ${res.status} - retrying...`);
          }

          return res;
        },
        {
          maxAttempts: 3,
          initialDelay: 1000,
          onRetry: (attempt, error) => {
            console.warn(
              `[GeminiProxy] [${requestId}] Retry ${attempt}:`,
              error.message,
            );
          },
        },
      );
    });

    console.log(`[GeminiProxy] [${requestId}] Response ${response.status} for ${path}`);

    const responseText = await response.text();
    assertAuthEpoch(requestAuthEpoch);

    if (!response.ok) {
      if (response.status === 401) notifySessionRejected(requestAuthEpoch);
      // Prefer Google's structured error message when the body is JSON; fall
      // back to the raw text. (Parsing is isolated so the parse-failure catch
      // doesn't swallow the message we want to surface.)
      let message: string;
      try {
        const errorJson = JSON.parse(responseText);
        message = errorJson?.error?.message || JSON.stringify(errorJson);
      } catch {
        message =
          responseText ||
          `Proxy request to ${path} failed with status ${response.status}`;
      }
      if (response.status === 401) {
        message = "Session expired or missing — please log in again.";
      } else if (response.status === 429) {
        message = "Too many requests — try again in a minute.";
      }
      throw new Error(`Proxy request failed (${response.status}): ${message}`);
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
      error instanceof Error &&
      error.name === "AbortError" &&
      controller.signal.aborted
    ) {
      throw new Error(`Request to ${path} timed out after 300 seconds.`);
    }
    throw normalizeError(error);
  } finally {
    clearTimeout(timeoutId);
  }
}
