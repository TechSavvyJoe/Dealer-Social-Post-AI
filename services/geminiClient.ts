import { fetchFromProxy, type GenerationPurpose } from "./geminiProxy";
import type { ModelTaskName } from "./modelConfig";
import { createBlockedContentError } from "../utils/errorHandler";

/**
 * Minimal browser-side facade for Gemini GenerateContent.
 *
 * The browser never receives a provider credential. Requests go to the
 * authenticated same-origin PocketBase proxy, which adds the server-side key.
 * Veo uses the Gemini API's long-running prediction protocol and is implemented
 * directly in `geminiService.ts`, so this client exposes no dead video API.
 */
/**
 * Static, per-task invariant guidance sent out-of-band from the user turn.
 * Text tasks only — the proxy's policy rejects a system instruction on the
 * image models. Shape mirrors Google's REST contract and the server
 * allowlist: `{ parts: [{ text }] }`, text parts only.
 */
export interface GeminiSystemInstruction {
  parts: Array<{ text: string }>;
}

interface GenerateContentParams {
  model: string;
  contents: unknown;
  generationConfig?: Record<string, unknown>;
  /** Omit entirely when there is no static guidance; never send an empty one. */
  systemInstruction?: GeminiSystemInstruction;
  task: Extract<
    ModelTaskName,
    | "caption"
    | "caption_regenerate"
    | "caption_edit"
    | "vision_review"
    | "image_standard"
    | "image_studio"
  >;
  attemptId?: string;
  /** Usage-ledger label; omit to let the proxy default by task kind. */
  purpose?: GenerationPurpose;
  requestAuthEpoch?: number;
  signal?: AbortSignal;
}

interface GeminiResponsePart {
  text?: string;
  thought?: boolean;
  inlineData?: { mimeType?: string; data?: string };
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: GeminiResponsePart[] };
  }>;
  promptFeedback?: { blockReason?: string };
}

/**
 * finishReason values that mean the provider refused on content grounds. The
 * next model in the ladder (or another vendor) would see the same photo and
 * wording and answer the same way, so these become a terminal `blocked`
 * error instead of an empty caption or a "no image" retry.
 */
const BLOCKED_FINISH_REASONS = new Set([
  "SAFETY",
  "PROHIBITED_CONTENT",
  "BLOCKLIST",
  "SPII",
  "IMAGE_SAFETY",
  "IMAGE_PROHIBITED_CONTENT",
]);

/** A recitation stop is only a block when nothing usable came back with it. */
const RECITATION_FINISH_REASONS = new Set(["RECITATION", "IMAGE_RECITATION"]);

const isVisibleTextPart = (part: GeminiResponsePart | undefined): boolean =>
  Boolean(part) && part?.thought !== true && typeof part?.text === "string";

const hasUsableOutput = (parts: GeminiResponsePart[]): boolean =>
  parts.some(
    (part) =>
      part &&
      part.thought !== true &&
      ((typeof part.text === "string" && part.text.trim().length > 0) ||
        Boolean(part.inlineData?.data)),
  );

/**
 * Inspect a raw generateContent payload before any caller reads it. Throws a
 * typed `blocked` error for content refusals and a plain (retryable) error
 * when the model exhausted its output budget while still reasoning.
 */
const assertUsableResponse = (response: GeminiGenerateContentResponse): void => {
  const blockReason = String(response.promptFeedback?.blockReason ?? "").toUpperCase();
  if (blockReason && blockReason !== "BLOCK_REASON_UNSPECIFIED") {
    throw createBlockedContentError(`promptFeedback.blockReason=${blockReason}`);
  }
  const candidate = response.candidates?.[0];
  const finishReason = String(candidate?.finishReason ?? "").toUpperCase();
  const parts = candidate?.content?.parts ?? [];
  if (BLOCKED_FINISH_REASONS.has(finishReason)) {
    throw createBlockedContentError(`finishReason=${finishReason}`);
  }
  if (RECITATION_FINISH_REASONS.has(finishReason) && !hasUsableOutput(parts)) {
    throw createBlockedContentError(`finishReason=${finishReason} with empty content`);
  }
  if (finishReason === "MAX_TOKENS" && !hasUsableOutput(parts)) {
    // Only internal reasoning came back. Returning it as the caption would put
    // the model's scratchpad on a customer's post; let the ladder retry.
    throw new Error(
      "Gemini stopped at MAX_TOKENS before producing any output (only reasoning parts were returned).",
    );
  }
};

class ProxiedGeminiClient {
  get models() {
    return {
      generateContent: async (params: GenerateContentParams) => {
        const {
          model,
          contents,
          generationConfig,
          systemInstruction,
          task,
          attemptId,
          purpose,
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
        // `systemInstruction` is omitted rather than sent empty: the proxy
        // allowlist requires at least one non-blank text part, so an empty
        // object would fail validation for every caller that has no static
        // guidance to send.
        const hasSystemInstruction = Boolean(
          systemInstruction?.parts?.some((part) => part?.text?.trim()),
        );
        const body = {
          contents: Array.isArray(contents) ? contents : [contents],
          ...(generationConfig ? { generationConfig } : {}),
          ...(hasSystemInstruction ? { systemInstruction } : {}),
        };
        const rawResponse = (await fetchFromProxy(
          "POST",
          `v1beta/models/${model}:generateContent`,
          body,
          task,
          attemptId,
          requestAuthEpoch,
          signal,
          purpose,
        )) as GeminiGenerateContentResponse | string | null | undefined;
        if (!rawResponse || typeof rawResponse !== "object") {
          throw new Error("Gemini returned an invalid response.");
        }
        assertUsableResponse(rawResponse);

        return {
          ...rawResponse,
          text: () => {
            const parts = rawResponse.candidates?.[0]?.content?.parts ?? [];
            // Thinking models may return `thought: true` parts — internal
            // reasoning, never the caption. Only visible text is returned; a
            // reasoning-only payload was already rejected above.
            return parts
              .filter(isVisibleTextPart)
              .map((part) => part.text || "")
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
