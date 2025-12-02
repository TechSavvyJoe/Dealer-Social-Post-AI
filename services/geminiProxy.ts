import { normalizeError } from "../utils/errorHandler";

/**
 * A wrapper for the fetch API to communicate with our backend proxy for Gemini.
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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180000); // 180 second timeout (3 minutes)

  try {
    const response = await fetch(`/api/proxy/${path}`, {
      method: method,
      headers: {
        "Content-Type": "application/json",
      },
      // Only include body for POST requests
      body: method === "POST" ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const responseText = await response.text();

    if (!response.ok) {
      let errorJson;
      try {
        errorJson = JSON.parse(responseText);
        // Use the detailed error message from Google if available
        const detailedMessage =
          errorJson?.error?.message || JSON.stringify(errorJson);
        throw new Error(detailedMessage);
      } catch (e) {
        // If the response is not JSON, throw the raw text
        throw new Error(
          responseText ||
            `Proxy request to ${path} failed with status ${response.status}`
        );
      }
    }

    try {
      return JSON.parse(responseText);
    } catch (e) {
      // If the successful response is not JSON, return the raw text
      return responseText;
    }
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request to ${path} timed out after 180 seconds.`);
    }
    throw normalizeError(error);
  }
}
