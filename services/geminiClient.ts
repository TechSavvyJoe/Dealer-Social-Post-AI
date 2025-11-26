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
        // Route preview models and latest Gemini models to v1alpha
        const version =
          params.model.includes("gemini-3") ||
          params.model.includes("gemini-2") ||
          params.model.includes("preview")
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
      generateVideos: (params: { model: string; [key: string]: any }) => {
        const version = "v1beta"; // Try v1beta for Veo
        return fetchFromProxy(
          "POST",
          `${version}/models/${params.model}:generateVideos`,
          params
        );
      },
    };
  }

  get operations() {
    return {
      getVideosOperation: async (params: { operation: { name: string } }) => {
        const operationName = params.operation.name;
        const response = await fetchFromProxy("GET", `${operationName}`, {});
        return new MockVideoOperation(response);
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
