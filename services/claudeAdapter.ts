/**
 * Anthropic Claude adapter — cross-vendor fallback for text generation.
 *
 * When Gemini returns a non-retryable failure (rate limit ceiling, content
 * block, or persistent server error) and `VITE_ENABLE_CLAUDE_FALLBACK=true`,
 * the geminiService routes the call here instead. Joe runs Claude Max so this
 * is essentially free overflow capacity.
 *
 * Server-side: requires `ANTHROPIC_API_KEY` in PocketBase secrets. The hook in
 * `pb_hooks/main.pb.js` adds a /api/proxy/anthropic/* route that forwards to
 * api.anthropic.com so the key never reaches the browser.
 */
import { CLAUDE_MODELS, FLAGS } from "./modelConfig";

const PROXY_PATH = "/api/proxy/anthropic/v1/messages";

interface ClaudeMessageOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Optional system prompt (preferred over stuffing it into user content). */
  system?: string;
}

interface ClaudeMessageResponse {
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string;
  usage?: { input_tokens: number; output_tokens: number };
  error?: { type: string; message: string };
}

// Auth: HttpOnly session cookie attached via credentials:"include" at the
// fetch call site. VITE_PROXY_ACCESS_TOKEN removed 2026-05-28 (bundled
// secret → bypassable per-dealer rate limits).
const proxyHeaders = (): Record<string, string> => ({
  "Content-Type": "application/json",
});

/**
 * Generate text via Claude through the PocketBase proxy.
 *
 * Throws if `VITE_ENABLE_CLAUDE_FALLBACK` is not set OR if the proxy returns a
 * non-200. Callers should treat failure as "Claude unavailable" and surface
 * the original Gemini error to the user.
 */
export const generateTextViaClaude = async (
  prompt: string,
  options: ClaudeMessageOptions = {}
): Promise<string> => {
  if (!FLAGS.enableClaudeFallback) {
    throw new Error("Claude fallback is disabled (set VITE_ENABLE_CLAUDE_FALLBACK=true)");
  }

  const body = {
    model: options.model || CLAUDE_MODELS.text_fast,
    max_tokens: options.maxTokens ?? 1024,
    temperature: options.temperature ?? 0.9,
    ...(options.system ? { system: options.system } : {}),
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: prompt }],
      },
    ],
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
      /* response wasn't JSON; ignore */
    }
    throw new Error(`Claude proxy error: ${detail}`);
  }

  const payload: ClaudeMessageResponse = await res.json();
  if (payload.error) {
    throw new Error(`Claude API error: ${payload.error.message}`);
  }

  const text = (payload.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text || "")
    .join("\n")
    .trim();

  if (!text) {
    throw new Error("Claude returned an empty response");
  }

  return text;
};

/**
 * Detects whether an error from Gemini is "vendor failure" severe enough to
 * justify a Claude fallback attempt. Quota/billing errors qualify; transient
 * network blips do not (those should retry on Gemini first).
 */
export const shouldFallbackToClaude = (err: unknown): boolean => {
  if (!FLAGS.enableClaudeFallback) return false;
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
