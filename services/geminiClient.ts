import { fetchFromProxy } from "./geminiProxy";
import type { ModelTaskName } from "./modelConfig";

/**
 * Minimal browser-side facade for Gemini GenerateContent.
 *
 * The browser never receives a provider credential. Requests go to the
 * authenticated same-origin PocketBase proxy, which adds the server-side key.
 * Veo uses the Gemini API's long-running prediction protocol and is implemented
 * directly in `geminiService.ts`, so this client exposes no dead video API.
 */
interface GenerateContentParams {
  model: string;
  contents: unknown;
  generationConfig?: Record<string, unknown>;
  task: Extract<
    ModelTaskName,
    | "caption"
    | "caption_regenerate"
    | "caption_edit"
    | "image_standard"
    | "image_studio"
  >;
  attemptId?: string;
  requestAuthEpoch?: number;
  signal?: AbortSignal;
}

class ProxiedGeminiClient {
  get models() {
    return {
      generateContent: async (params: GenerateContentParams) => {
        const {
          model,
          contents,
          generationConfig,
          task,
          attemptId,
          requestAuthEpoch,
          signal,
        } = params;
        if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(model)) {
          throw new Error("Gemini model identifier is invalid.");
        }
        if (contents == null) {
          throw new Error("Gemini contents are required.");
        }
        // SDKs accept a single Content object as shorthand; Google's raw REST
        // contract requires `contents[]`. Normalize here because every current
        // call site supplies one turn and this facade now talks raw REST.
        const body = {
          contents: Array.isArray(contents) ? contents : [contents],
          ...(generationConfig ? { generationConfig } : {}),
        };
        const rawResponse = await fetchFromProxy(
          "POST",
          `v1beta/models/${model}:generateContent`,
          body,
          task,
          attemptId,
          requestAuthEpoch,
          signal,
        );
        if (!rawResponse || typeof rawResponse !== "object") {
          throw new Error("Gemini returned an invalid response.");
        }

        return {
          ...rawResponse,
          text: () => {
            const parts = rawResponse?.candidates?.[0]?.content?.parts ?? [];
            // Gemini 2.5/3 thinking models may return `thought: true` parts —
            // those are internal reasoning, not the caption. Prefer non-thought
            // text; if only thought parts exist, fall back to all text.
            const nonThought = parts.filter(
              (part: { text?: string; thought?: boolean }) =>
                part?.text && !part.thought,
            );
            const useParts = nonThought.length > 0 ? nonThought : parts;
            return useParts
              .map((part: { text?: string }) => part?.text || "")
              .join("")
              .trim();
          },
        };
      },
    };
  }
}

const memoizedClient = new ProxiedGeminiClient();

/** The provider key is server-managed; retained for call-site compatibility. */
export const configureGeminiClient = (_apiKey?: string | null) => undefined;

export const getGeminiClient = (): ProxiedGeminiClient => memoizedClient;

/** Retained for legacy readiness checks; no credential is exposed. */
export const requireGeminiApiKey = (): string => "CONFIGURED_ON_SERVER";
