/**
 * OpenAI image-generation adapter — cross-vendor fallback for image tasks.
 *
 * When all Gemini image models in the fallback chain exhaust (rate limits,
 * outage, persistent safety block) and `VITE_ENABLE_OPENAI_FALLBACK=true`,
 * geminiService routes the call here instead. Returns a fresh generated
 * image (not an edit-of-source) — degraded mode but still ships something.
 *
 * Server-side: requires `OPENAI_API_KEY` in PocketBase secrets. The proxy
 * route `/api/proxy/openai/v1/images/generations` in pb_hooks/main.pb.js
 * adds the auth header so the key never reaches the browser.
 */
import { FLAGS, MODEL_POLICY_VERSION, OPENAI_MODELS } from "./modelConfig";
import {
  assertAuthEpoch,
  captureAuthEpoch,
  notifySessionRejected,
} from "../utils/authBoundary";
import { normalizeError } from "../utils/errorHandler";

const PROXY_PATH = "/api/proxy/openai/v1/images/generations";

interface OpenAIImageOptions {
  prompt: string;
  task?: "image_standard" | "image_studio";
  attemptId?: string;
  /** Standard GPT Image sizes; GPT Image 2 also supports bounded custom sizes. */
  size?: "1024x1024" | "1024x1536" | "1536x1024";
  /** GPT Image quality tier. */
  quality?: "low" | "medium" | "high";
  /** Originating authenticated workspace for cross-provider failover. */
  requestAuthEpoch?: number;
  signal?: AbortSignal;
}

interface OpenAIImageResponse {
  data?: Array<{ b64_json?: string; revised_prompt?: string }>;
  error?: { type?: string; message?: string };
}

// Auth: HttpOnly session cookie attached via credentials:"include" at the
// fetch call site. VITE_PROXY_ACCESS_TOKEN removed 2026-05-28.
const proxyHeaders = (
  task?: OpenAIImageOptions["task"],
  attemptId?: string,
): Record<string, string> => ({
  "Content-Type": "application/json",
  ...(task
    ? {
        "X-Generation-Task": task,
        "X-Model-Policy-Version": MODEL_POLICY_VERSION,
        ...(attemptId ? { "X-Generation-Attempt-ID": attemptId } : {}),
      }
    : {}),
});

/**
 * Generate an image via OpenAI GPT Image (model id `gpt-image-2`). Returns
 * a base64 data URL ready to assign as `<img src>`.
 *
 * Throws if the OpenAI fallback flag is disabled or the proxy returns a
 * non-200. Callers should treat failure as "OpenAI unavailable" and bubble
 * up the original Gemini error.
 */
export const generateImageViaOpenAI = async (
  options: OpenAIImageOptions,
): Promise<string> => {
  const requestAuthEpoch = options.requestAuthEpoch ?? captureAuthEpoch();
  if (!FLAGS.enableOpenAIFallback) {
    throw new Error(
      "OpenAI fallback is disabled (set VITE_ENABLE_OPENAI_FALLBACK=true)",
    );
  }

  const body = {
    model: OPENAI_MODELS.image,
    prompt: options.prompt,
    size: options.size || "1024x1024",
    quality: options.quality || "high",
    n: 1,
    output_format: "png",
  };

  assertAuthEpoch(requestAuthEpoch);
  const res = await fetch(PROXY_PATH, {
    method: "POST",
    credentials: "include",
    headers: proxyHeaders(options.task, options.attemptId),
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!res.ok) {
    if (res.status === 401) notifySessionRejected(requestAuthEpoch);
    let detail = `${res.status} ${res.statusText}`;
    try {
      const errBody = await res.json();
      detail += ` — ${errBody?.error?.message || JSON.stringify(errBody)}`;
    } catch {
      /* not json */
    }
    throw new Error(`OpenAI image proxy error: ${detail}`);
  }

  const payload: OpenAIImageResponse = await res.json();
  assertAuthEpoch(requestAuthEpoch);
  if (payload.error) {
    throw new Error(`OpenAI image error: ${payload.error.message}`);
  }
  const b64 = payload.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error("OpenAI returned no image data");
  }
  assertAuthEpoch(requestAuthEpoch);
  return `data:image/png;base64,${b64}`;
};

/** A caller cancellation, not a provider failure. */
const isAbortError = (err: unknown): boolean =>
  typeof err === "object" &&
  err !== null &&
  "name" in err &&
  (err as { name?: unknown }).name === "AbortError";

/**
 * Detects whether a Gemini image failure is severe enough to try OpenAI.
 * Mirrors `shouldFallbackToClaude`, including the reason it stopped matching
 * message substrings: the proxy throws curated product copy, so the old
 * "quota"/"429" scan never fired on a real rate-limit failure.
 *
 * Only `quota` and `model_unavailable` qualify. A typed `blocked` never does
 * — text-to-image would fabricate a scene without the customer's actual
 * photo, so the caller ships the original — and neither do `unauthorized`,
 * `outdated`, or the retry-on-Gemini kinds.
 */
export const shouldFallbackToOpenAI = (err: unknown): boolean => {
  if (!FLAGS.enableOpenAIFallback) return false;
  if (isAbortError(err)) return false;
  const kind = normalizeError(err).kind;
  return kind === "quota" || kind === "model_unavailable";
};
