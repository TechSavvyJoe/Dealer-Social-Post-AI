import { normalizeError } from "../utils/errorHandler";
import { retryWithBackoff, isRetryableError } from "../utils/retry";
import { performanceMonitor } from "../utils/performanceMonitor";
import { withCircuitBreaker } from "../utils/circuitBreaker";

// Request tracking for debugging
let requestCounter = 0;

/**
 * A wrapper for the fetch API to communicate with our backend proxy for Gemini.
 * Now includes retry logic, performance monitoring, and enhanced error handling.
 * @param method 'GET' or 'POST'
 * @param path The path for the Google API (e.g., 'v1beta/models/gemini-pro:generateContent')
 * @param body The request body to be sent to the Gemini API.
 * @returns The JSON response from the API.
 */
export async function fetchFromProxy(
  method: "GET" | "POST",
  path: string,
  body: any
) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw normalizeError(
      new Error("Offline: please reconnect to the internet.")
    );
  }

  const requestId = ++requestCounter;
  const markName = `proxy-${requestId}`;
  performanceMonitor.mark(`${markName}-start`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 300000); // 300 second timeout (5 minutes)

    try {
      console.log(`[GeminiProxy] [${requestId}] Requesting ${method} ${path}`);

      // Auth: HttpOnly session cookie (set via POST /api/app/session). The
      // bundled VITE_PROXY_ACCESS_TOKEN was removed 2026-05-28 because it
      // leaked to anyone who viewed the JS bundle and bypassed per-dealer
      // rate limits. credentials:"include" is what attaches the cookie.

      // Group paths by service type for circuit breaking (e.g. gemini-text, imagen, veo)
      let serviceKey = "gemini-api";
      if (path.includes("imagen")) serviceKey = "imagen-api";
      else if (path.includes("veo") || path.includes("video")) serviceKey = "veo-api";

      // Use retry logic for transient failures, wrapped in a circuit breaker for sustained failures
      const response = await withCircuitBreaker(serviceKey, async () => {
        return await retryWithBackoff(
          async () => {
            const res = await fetch(`/api/proxy/${path}`, {
              method: method,
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              // Only include body for POST requests
              body: method === "POST" ? JSON.stringify(body) : undefined,
              signal: controller.signal,
            });

            // 401 → session expired or missing. Don't retry; surface to the
            // caller so the app can route back to the login screen.
            if (res.status === 401) {
              const err = new Error(
                "Session expired or missing — please log in again."
              );
              (err as any).status = 401;
              throw err;
            }

            // 429 → rate limited. Surface immediately; retry would just
            // burn the rest of the budget.
            if (res.status === 429) {
              const err = new Error(
                "Too many requests — slow down and try again in a minute."
              );
              (err as any).status = 429;
              throw err;
            }

            // Retry on 502, 503, 504 errors
            if (res.status === 502 || res.status === 503 || res.status === 504) {
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
                error.message
              );
            },
          }
        );
      });

      console.log(
        `[GeminiProxy] [${requestId}] Response ${response.status} for ${path}`
      );
      clearTimeout(timeoutId);

    const responseText = await response.text();

    if (!response.ok) {
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
      throw new Error(message);
    }

    // Log performance
    const duration =
      performanceMonitor.measure(markName, `${markName}-start`) || 0;
    if (duration > 10000) {
      console.warn(`[GeminiProxy] [${requestId}] Slow request: ${duration}ms`);
    }

    try {
      return JSON.parse(responseText);
    } catch (e) {
      // If the successful response is not JSON, return the raw text
      return responseText;
    }
  } catch (error) {
    clearTimeout(timeoutId);
    performanceMonitor.measure(`${markName}-error`, `${markName}-start`);

    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request to ${path} timed out after 300 seconds.`);
    }
    throw normalizeError(error);
  }
}
