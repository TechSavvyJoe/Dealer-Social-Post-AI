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
import { FLAGS, OPENAI_MODELS } from "./modelConfig";

const PROXY_PATH = "/api/proxy/openai/v1/images/generations";

interface OpenAIImageOptions {
  prompt: string;
  /** Standard GPT Image sizes; GPT Image 2 also supports bounded custom sizes. */
  size?: "1024x1024" | "1024x1536" | "1536x1024";
  /** GPT Image quality tier. */
  quality?: "low" | "medium" | "high";
}

interface OpenAIImageResponse {
  data?: Array<{ b64_json?: string; revised_prompt?: string }>;
  error?: { type?: string; message?: string };
}

// Auth: HttpOnly session cookie attached via credentials:"include" at the
// fetch call site. VITE_PROXY_ACCESS_TOKEN removed 2026-05-28.
const proxyHeaders = (): Record<string, string> => ({
  "Content-Type": "application/json",
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

  const res = await fetch(PROXY_PATH, {
    method: "POST",
    credentials: "include",
    headers: proxyHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
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
  if (payload.error) {
    throw new Error(`OpenAI image error: ${payload.error.message}`);
  }
  const b64 = payload.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error("OpenAI returned no image data");
  }
  return `data:image/png;base64,${b64}`;
};

/**
 * Detects whether an error from Gemini image generation is severe enough to
 * try the OpenAI fallback. Mirrors the Claude fallback heuristic.
 */
export const shouldFallbackToOpenAI = (err: unknown): boolean => {
  if (!FLAGS.enableOpenAIFallback) return false;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (
    msg.includes("quota") ||
    msg.includes("rate limit") ||
    msg.includes("rate_limit") ||
    msg.includes("503") ||
    msg.includes("500") ||
    msg.includes("unavailable") ||
    msg.includes("safety") ||
    msg.includes("blocked")
  ) {
    return true;
  }
  return false;
};
