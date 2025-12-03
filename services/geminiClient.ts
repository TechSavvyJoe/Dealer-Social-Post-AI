import { fetchFromProxy } from "./geminiProxy";

// This is a mock/proxy implementation that mimics the @google/genai SDK
// It ensures that all API calls are routed through our secure backend proxy,
// so the API key never leaves the server.

// Models that require Vertex AI (OAuth) instead of API key auth
// Note: Only Imagen and Veo models truly require Vertex AI
// Gemini models work with API key auth
const VERTEX_ONLY_MODELS = [
  'imagen-3',
  'imagen-3.0-generate-002',
  'veo-3.1-generate-preview',
];

// Helper to determine if model needs Vertex AI
const needsVertexAI = (model: string): boolean => {
  return VERTEX_ONLY_MODELS.some(m => model.includes(m));
};

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
        // Check if model requires Vertex AI
        if (needsVertexAI(params.model)) {
          // Route through Vertex AI
          const projectId = 'gen-lang-client-0994987899'; // From your service account
          const location = 'us-central1';
          const vertexPath = `vertex/v1beta1/projects/${projectId}/locations/${location}/publishers/google/models/${params.model}:generateContent`;
          
          // Transform request format for Vertex AI
          const vertexBody = {
            contents: params.contents ? (Array.isArray(params.contents) ? params.contents : [params.contents]) : [],
            generationConfig: params.generationConfig,
          };
          
          const rawResponse = await fetchFromProxy('POST', vertexPath, vertexBody);
          return {
            ...rawResponse,
            text: () => rawResponse.candidates?.[0]?.content?.parts?.[0]?.text || '',
          };
        }
        
        // Standard Gemini API path
        // All Gemini models should use v1beta endpoint per official docs
        // https://ai.google.dev/gemini-api/docs/image-generation
        const version = "v1beta";
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
      // Imagen 3 image generation via Vertex AI predict endpoint
      generateImages: async (params: {
        model: string;
        prompt: string;
        config?: {
          numberOfImages?: number;
          aspectRatio?: string;
          outputMimeType?: string;
        };
      }) => {
        const projectId = 'gen-lang-client-0994987899';
        const location = 'us-central1';
        const model = params.model || 'imagen-3.0-generate-002';
        const vertexPath = `vertex/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:predict`;
        
        const vertexBody = {
          instances: [{ prompt: params.prompt }],
          parameters: {
            sampleCount: params.config?.numberOfImages || 1,
            aspectRatio: params.config?.aspectRatio || '1:1',
            outputMimeType: params.config?.outputMimeType || 'image/png',
          },
        };
        
        const rawResponse = await fetchFromProxy('POST', vertexPath, vertexBody);
        
        // Transform response to match expected format
        const predictions = rawResponse.predictions || [];
        return {
          images: predictions.map((pred: any) => ({
            mimeType: pred.mimeType || 'image/png',
            data: pred.bytesBase64Encoded,
          })),
        };
      },
      generateVideos: async (params: { model: string; [key: string]: any }) => {
        // Try known API permutations: prefer v1beta, fall back to v1alpha.
        // We intentionally skip the singular generateVideo variant to avoid
        // spamming the proxy with duplicate calls when models are unavailable.
        const candidates = [
          { version: "v1beta", method: "generateVideos" },
          { version: "v1alpha", method: "generateVideos" },
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
