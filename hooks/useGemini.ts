import { useCallback } from "react";
import { enqueueTask } from "../services/requestQueue";
import { logEvent, logError } from "../utils/telemetry";

// Since the Gemini API key is now handled by the server-side proxy,
// this hook is greatly simplified. It no longer needs to manage the key.

type GeminiServiceModule = typeof import("../services/geminiService");
let geminiServiceModulePromise: Promise<GeminiServiceModule> | null = null;

const loadGeminiService = (): Promise<GeminiServiceModule> => {
  if (!geminiServiceModulePromise) {
    geminiServiceModulePromise = import("../services/geminiService");
  }
  return geminiServiceModulePromise;
};

export const useGemini = () => {
  // The API is always considered configured because the key is on the server.
  const isApiKeyConfigured = true;

  const runGeminiTask = useCallback(
    async <T>(
      name: string,
      task: () => Promise<T>,
      metadata?: Record<string, unknown>,
    ) => {
      logEvent(`${name}.start`, metadata);
      try {
        // maxRetries:0 — the queue only serializes AI calls; it must NOT retry.
        // Transient retries are owned by the proxy (retryWithBackoff ×3) and
        // model failover by withFallbackChain (×N models). A queue-level retry
        // here re-ran that entire stack, multiplying one user action into up to
        // ~27 upstream requests during an outage (self-inflicted DDoS + cost).
        const result = await enqueueTask(task, { maxRetries: 0 });
        logEvent(`${name}.success`, metadata);
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logError(`${name}.failure`, { ...metadata, message });
        throw error;
      }
    },
    [],
  );

  return {
    isApiKeyConfigured,
    runGeminiTask,
    loadGeminiService,
  };
};
