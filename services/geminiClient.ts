import { fetchFromProxy } from "./geminiProxy";

// This is a mock/proxy implementation that mimics the @google/genai SDK
// It ensures that all API calls are routed through our secure backend proxy,
// so the API key never leaves the server.

class MockVideoOperation {
  name: string;
  done: boolean;
  response?: any;
  error?: any;

  constructor(initialResponse: any) {
    this.name = initialResponse.name;
    this.done = initialResponse.done;
    this.response = initialResponse.response;
    this.error = initialResponse.error;
  }
}

class MockGeminiClient {
  get models() {
    return {
      generateContent: async (params: {
        model: string;
        [key: string]: any;
      }) => {
        // The SDK's `generateContent` returns a response with a `text()` method.
        // The raw API response is what our proxy will return. We need to wrap it.
        // Route preview models and latest Gemini models to v1alpha, BUT keep gemini-2.0-flash-exp and gemini-2.5-flash on v1beta
        const version =
          (params.model.includes("gemini-3") ||
            params.model.includes("preview")) &&
          !params.model.includes("gemini-2.0-flash-exp") &&
          !params.model.includes("gemini-2.5-flash")
            ? "v1alpha"
            : "v1beta";
        const rawResponse = await fetchFromProxy(
          "POST",
          `${version}/models/${params.model}:generateContent`,
          params
        );
        return {
          ...rawResponse,
          text: () =>
            rawResponse.candidates?.[0]?.content?.parts?.[0]?.text || "",
        };
      },
      generateVideos: async (params: { model: string; [key: string]: any }) => {
        // Try known API permutations: prefer v1beta and the plural endpoint, but
        // fall back to v1alpha or the singular endpoint if the service returns 404.
        const candidates = [
          { version: "v1beta", method: "generateVideos" },
          { version: "v1alpha", method: "generateVideos" },
          { version: "v1beta", method: "generateVideo" },
          { version: "v1alpha", method: "generateVideo" },
        ];

        let lastError: unknown;
        for (const candidate of candidates) {
          try {
            return await fetchFromProxy(
              "POST",
              `${candidate.version}/models/${params.model}:${candidate.method}`,
              params
            );
          } catch (error) {
            lastError = error;
            const msg =
              error instanceof Error
                ? error.message.toLowerCase()
                : String(error);
            // Only continue on 404/not found; otherwise bubble up immediately.
            if (!msg.includes("404") && !msg.includes("not found")) {
              throw error;
            }
          }
        }

        // All attempts failed; surface the last error.
        throw lastError instanceof Error
          ? lastError
          : new Error("Failed to generate video via Gemini API.");
      },
    };
  }

  get operations() {
    return {
      getVideosOperation: async (params: { operation: { name: string } }) => {
        const operationName = params.operation.name;
        if (!operationName) {
          throw new Error("Missing operation name for video polling.");
        }

        // Ensure the path includes an API version prefix for the proxy. If the
        // operation name doesn't include a version, try v1beta then v1alpha.
        const normalized = operationName.replace(/^\/+/, "");
        const candidates = normalized.startsWith("v1")
          ? [normalized]
          : [`v1beta/${normalized}`, `v1alpha/${normalized}`];

        let lastError: unknown;
        for (const candidate of candidates) {
          try {
            const response = await fetchFromProxy("GET", candidate, {});
            return new MockVideoOperation(response);
          } catch (error) {
            lastError = error;
            const msg =
              error instanceof Error
                ? error.message.toLowerCase()
                : String(error);
            if (!msg.includes("404") && !msg.includes("not found")) {
              throw error;
            }
          }
        }

        throw lastError instanceof Error
          ? lastError
          : new Error("Failed to poll video operation status.");
      },
    };
  }
}

// --- Singleton instance of our mock client ---
const memoizedClient = new MockGeminiClient();

/**
 * This function is now a no-op because the API key is handled on the server.
 * We keep the function to avoid having to refactor the components that call it.
 */
export const configureGeminiClient = (apiKey?: string | null) => {
  // No-op
};

/**
 * Returns the singleton instance of our proxied Gemini client.
 */
export const getGeminiClient = (): MockGeminiClient => {
  return memoizedClient;
};

/**
 * This function now returns a static string. The original purpose was to throw
 * an error if the key was missing. We now always return a truthy value
 * to satisfy checks, because the key is managed on the server.
 */
export const requireGeminiApiKey = (): string => {
  return "CONFIGURED_ON_SERVER";
};
