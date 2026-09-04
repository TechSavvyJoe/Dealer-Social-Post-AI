/**
 * Anthropic Claude adapter — cross-vendor fallback for text generation.
 *
 * When Gemini returns a non-retryable vendor failure (rate limit ceiling or a
 * persistent server error) and `VITE_ENABLE_CLAUDE_FALLBACK=true`, the
 * geminiService routes the call here instead. A content refusal is never
 * retried here: the same photo and wording would be refused again. Anthropic
 * API usage is separately metered from any consumer Claude subscription.
 *
 * Server-side: requires `ANTHROPIC_API_KEY` in PocketBase secrets. The hook in
 * `pb_hooks/main.pb.js` adds a /api/proxy/anthropic/* route that forwards to
 * api.anthropic.com so the key never reaches the browser. The proxy validates
 * every body with `buildAnthropicMessageRequest` (pb_hooks/requestPolicies.js),
 * so the shape produced by `buildClaudeMessageBody` must stay inside that
 * contract — `services/claudeAdapter.test.ts` runs it through the real policy.
 */
import { CLAUDE_MODELS, FLAGS, MODEL_POLICY_VERSION, TASKS } from "./modelConfig";
import {
  assertAuthEpoch,
  captureAuthEpoch,
  notifySessionRejected,
} from "../utils/authBoundary";
import { normalizeError } from "../utils/errorHandler";

const PROXY_PATH = "/api/proxy/anthropic/v1/messages";

/** Inline image media types the Messages API accepts. */
const CLAUDE_IMAGE_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

/** Mirrors the caption task's Gemini output budget; the proxy cap is aligned. */
const DEFAULT_MAX_TOKENS = TASKS.caption.params.maxOutputTokens ?? 2048;

export type ClaudeTaskName = "caption" | "caption_regenerate" | "caption_edit";

export interface ClaudeInlineImage {
  mimeType: string;
  /** Raw base64 payload (no data-URL prefix). */
  data: string;
}

interface ClaudeMessageOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Overrides the task's static system rules. */
  system?: string;
  task?: ClaudeTaskName;
  /** Source photo, sent as an image content block when Claude accepts the type. */
  image?: ClaudeInlineImage;
  attemptId?: string;
  /** Originating authenticated workspace for cross-provider failover. */
  requestAuthEpoch?: number;
  signal?: AbortSignal;
}

type ClaudeContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
    };

export interface ClaudeMessageBody {
  model: string;
  max_tokens: number;
  temperature: number;
  system: string;
  messages: Array<{ role: "user"; content: ClaudeContentBlock[] }>;
}

interface ClaudeMessageResponse {
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string;
  usage?: { input_tokens: number; output_tokens: number };
  error?: { type: string; message: string };
}

/**
 * Static rules shared by every caption request. They live in `system` so the
 * user turn carries only the dealer-specific prompt (store, scenario, voice,
 * facts) plus the photo. Keep well under the proxy's 5,000-character cap.
 */
const CAPTION_SYSTEM_PROMPT = `You write social-media captions for a car dealership salesperson.
Output ONLY the caption as plain text: no titles, labels, bullets, markdown, XML, or quotes around the post.
Use real English sentences only. Follow the structure, identity rule, and hashtag line given in the request exactly.
Mention a make, model, or equipment detail only when it is verified in the supplied facts or unmistakable in the photo.
Never invent prices, APR, financing terms, availability, condition, ownership history, service work, quotes, or outcomes.
Never use: guaranteed, lowest price, no credit check, 0% APR, best deal.
Use at most one emoji, never at the start.`;

const EDIT_SYSTEM_PROMPT = `You edit an existing dealership social-media caption.
Apply ONLY the edit the user requested and leave untouched portions exactly as they are.
Return ONLY the edited caption as plain text: no preamble, diff markers, labels, markdown, or commentary.
Keep hashtags as #PascalCase tokens separated by single spaces.
Do not introduce compliance triggers such as 0% APR, $0 down, or guaranteed.`;

export const claudeSystemPromptForTask = (task?: ClaudeTaskName): string =>
  task === "caption_edit" ? EDIT_SYSTEM_PROMPT : CAPTION_SYSTEM_PROMPT;

/** Whether the adapter will transmit this image as a Claude content block. */
export const claudeAcceptsImage = (
  image?: ClaudeInlineImage,
): image is ClaudeInlineImage =>
  Boolean(image && image.data && CLAUDE_IMAGE_MEDIA_TYPES.has(image.mimeType));

/**
 * Build the Messages API body. Pure so tests can run the exact request
 * through the PocketBase policy (`buildAnthropicMessageRequest`).
 */
export const buildClaudeMessageBody = (
  prompt: string,
  options: ClaudeMessageOptions = {},
): ClaudeMessageBody => {
  const content: ClaudeContentBlock[] = [];
  if (claudeAcceptsImage(options.image)) {
    // Anthropic recommends placing images before the text that refers to them.
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: options.image.mimeType,
        data: options.image.data,
      },
    });
  }
  content.push({ type: "text", text: prompt });
  return {
    model: options.model || CLAUDE_MODELS.text_fast,
    max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: options.temperature ?? 0.9,
    system: options.system ?? claudeSystemPromptForTask(options.task),
    messages: [{ role: "user", content }],
  };
};

// Auth: HttpOnly session cookie attached via credentials:"include" at the
// fetch call site. VITE_PROXY_ACCESS_TOKEN removed 2026-05-28 (bundled
// secret → bypassable per-dealer rate limits).
const proxyHeaders = (
  task?: ClaudeMessageOptions["task"],
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
 * Generate text via Claude through the PocketBase proxy.
 *
 * Throws if `VITE_ENABLE_CLAUDE_FALLBACK` is not set OR if the proxy returns a
 * non-200. Callers should treat failure as "Claude unavailable" and surface
 * the original Gemini error to the user.
 */
export const generateTextViaClaude = async (
  prompt: string,
  options: ClaudeMessageOptions = {},
): Promise<string> => {
  const requestAuthEpoch = options.requestAuthEpoch ?? captureAuthEpoch();
  if (!FLAGS.enableClaudeFallback) {
    throw new Error(
      "Claude fallback is disabled (set VITE_ENABLE_CLAUDE_FALLBACK=true)",
    );
  }

  const body = buildClaudeMessageBody(prompt, options);

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
      /* response wasn't JSON; ignore */
    }
    throw new Error(`Claude proxy error: ${detail}`);
  }

  const payload: ClaudeMessageResponse = await res.json();
  assertAuthEpoch(requestAuthEpoch);
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

  assertAuthEpoch(requestAuthEpoch);
  return text;
};

/** A caller cancellation, not a provider failure. */
const isAbortError = (err: unknown): boolean =>
  typeof err === "object" &&
  err !== null &&
  "name" in err &&
  (err as { name?: unknown }).name === "AbortError";

/**
 * Detects whether a Gemini failure is a vendor problem another vendor could
 * actually solve.
 *
 * Classification is by `normalizeError(...).kind`, never by scanning the
 * message: the proxy now throws curated product copy ("Too many requests —
 * try again in a minute."), so a substring hunt for "quota" or "429" matched
 * nothing and the fallback was unreachable for the exact failure it exists
 * for. `normalizeError` also walks `cause`/`lastError`, so the model-ladder
 * wrapper still resolves to the provider's own typed failure.
 *
 * Only two kinds qualify. `quota` is Gemini's rate ceiling and
 * `model_unavailable` is a Gemini outage or retired model id — Anthropic has
 * its own capacity and catalog. Everything else is declined on purpose:
 * `blocked` is a verdict on the photo and wording that Claude would repeat,
 * `unauthorized` is our own credential, `outdated` needs an app update, and
 * `network`/`timeout`/`validation`/`unknown` either retry on Gemini first or
 * would fail identically here.
 */
export const shouldFallbackToClaude = (err: unknown): boolean => {
  if (!FLAGS.enableClaudeFallback) return false;
  if (isAbortError(err)) return false;
  const kind = normalizeError(err).kind;
  return kind === "quota" || kind === "model_unavailable";
};
