/**
 * Model configuration + routing.
 *
 * Each task has a primary model, a fallback model, and a small set of safe
 * generation limits. Gemini 3.x is optimized for its default sampling values,
 * so task behavior comes from explicit prompts instead of legacy temperature,
 * top-k, or top-p overrides. The router prefers `primary`; on transient failure
 * or rate limit it retries with `fallback`, then an emergency model.
 */

export type ModelTier = "fast" | "quality" | "premium";

export interface GenerationParams {
  maxOutputTokens?: number;
  /** Stop sequences that cut the response short. */
  stopSequences?: string[];
}

export interface TaskConfig {
  primary: string;
  fallback?: string;
  emergency?: string;
  params: GenerationParams;
  /** Optional Anthropic Claude model id used as cross-vendor fallback (set via env). */
  claudeFallback?: string;
  /** Claude-only sampling control; never forwarded to Gemini 3.x. */
  claudeTemperature?: number;
}

/**
 * Canonical model identifiers. Keep this list in sync with what Google has
 * actually released — picking nonexistent ids breaks generation silently.
 *
 * Current as of 2026-07-15. Update only after checking Google's live model
 * catalog and deprecation notices. Stable ids are preferred where Google
 * offers them; Veo remains on the Gemini API's documented preview ids because
 * its stable `-001` ids are Vertex-only.
 */
export const MODELS = {
  // ---- Text + multimodal reasoning ----
  text: {
    primary: "gemini-3.5-flash",
    fallback: "gemini-3.1-flash-lite",
    // 2.5 series stays available as emergency long-tail fallback in case 3.x has an outage.
    emergency: "gemini-2.5-flash",
  },
  // ---- Image editing (multimodal: input image + prompt → image) ----
  // Gemini 3 Pro Image is Google's professional-asset model and is the right
  // quality-first default for branded dealer creative. Gemini 3.1 Flash Image
  // is the current all-around, lower-latency fallback.
  image: {
    primary: "gemini-3-pro-image",
    fallback: "gemini-3.1-flash-image",
    emergency: "gemini-3.1-flash-lite-image",
  },
  // ---- Video (Veo through the Gemini API) ----
  // The Gemini API and Vertex expose different IDs. This app calls
  // generativelanguage.googleapis.com, whose current Veo 3.1 IDs retain the
  // `-preview` suffix. The GA `-001` IDs belong to Vertex / Gemini Enterprise
  // Agent Platform and return 404 on this transport.
  video: {
    primary: "veo-3.1-generate-preview",
    fallback: "veo-3.1-fast-generate-preview",
    fast: "veo-3.1-fast-generate-preview",
  },
} as const;

/**
 * Anthropic Claude fallback ids. Text-only — Claude doesn't generate images.
 * Used when Gemini text generation paths fail AND
 * `VITE_ENABLE_CLAUDE_FALLBACK` / server-side `ANTHROPIC_API_KEY` is set.
 * Anthropic API usage is separately metered; a Claude subscription does not
 * cover these server-side API calls.
 */
export const CLAUDE_MODELS = {
  // The single-turn caption + edit task is fast on Haiku and good on Sonnet.
  text_fast: "claude-haiku-4-5-20251001",
  text_quality: "claude-sonnet-4-6",
  text_premium: "claude-opus-4-6",
} as const;

/**
 * OpenAI image fallback. Used as a last-tier fallback when ALL Gemini image
 * models in the chain exhaust (rate limit, outage, or persistent safety
 * block). GPT Image 2 is the current quality-first cross-vendor option for
 * text-rendered social creative.
 *
 * Requires server-side `OPENAI_API_KEY` and client flag
 * `VITE_ENABLE_OPENAI_FALLBACK=true` to enable.
 */
export const OPENAI_MODELS = {
  image: "gpt-image-2",
} as const;

/**
 * Per-task output limits. Prompt instructions carry the tone and variation;
 * Google recommends leaving Gemini 3.x sampling parameters at their defaults.
 */
export const TASK_PARAMS: Record<string, GenerationParams> = {
  // Agency-grade caption: hook + story + CTA + hashtags (~220–420 body chars).
  text_caption: {
    maxOutputTokens: 900,
  },
  // Retry/regenerate needs room for a full alternate draft, not a stub.
  text_caption_regenerate: {
    maxOutputTokens: 900,
  },
  // The edit prompt constrains the model to the user's requested change.
  text_caption_edit: {
    maxOutputTokens: 900,
  },
  // Image models manage their own reasoning and composition defaults.
  image_generate: {
    maxOutputTokens: 4096,
  },
  // Image edit (e.g. "make the text gold").
  image_edit: {
    maxOutputTokens: 4096,
  },
  // Fun-mode creativity is described by the selected art-direction prompt.
  image_fun: {
    maxOutputTokens: 4096,
  },
  // Video prompt distillation (text → Veo prompt).
  video_prompt: {
    maxOutputTokens: 800,
  },
};

/**
 * Full per-task config: model id + params + fallback ladder.
 */
export const TASKS: Record<string, TaskConfig> = {
  caption: {
    primary: MODELS.text.primary,
    fallback: MODELS.text.fallback,
    emergency: MODELS.text.emergency,
    claudeFallback: CLAUDE_MODELS.text_fast,
    claudeTemperature: 0.8,
    params: TASK_PARAMS.text_caption,
  },
  caption_regenerate: {
    primary: MODELS.text.primary,
    fallback: MODELS.text.fallback,
    emergency: MODELS.text.emergency,
    claudeFallback: CLAUDE_MODELS.text_fast,
    claudeTemperature: 1,
    params: TASK_PARAMS.text_caption_regenerate,
  },
  caption_edit: {
    primary: MODELS.text.fallback, // small model is plenty for edits; cheaper + faster
    fallback: MODELS.text.primary,
    emergency: MODELS.text.emergency,
    claudeFallback: CLAUDE_MODELS.text_fast,
    claudeTemperature: 0.4,
    params: TASK_PARAMS.text_caption_edit,
  },
  image_generate: {
    primary: MODELS.image.primary,
    fallback: MODELS.image.fallback,
    emergency: MODELS.image.emergency,
    params: TASK_PARAMS.image_generate,
  },
  image_edit: {
    primary: MODELS.image.primary,
    fallback: MODELS.image.fallback,
    emergency: MODELS.image.emergency,
    params: TASK_PARAMS.image_edit,
  },
  image_fun: {
    primary: MODELS.image.primary,
    fallback: MODELS.image.fallback,
    emergency: MODELS.image.emergency,
    params: TASK_PARAMS.image_fun,
  },
  video: {
    primary: MODELS.video.primary,
    fallback: MODELS.video.fast,
    params: TASK_PARAMS.video_prompt,
  },
};

/**
 * Resolve a model id by type + variant. Preserved from the original API so
 * existing imports (`getModel('text', 'primary')`) keep working.
 */
export const getModel = (
  type: keyof typeof MODELS,
  variant: "primary" | "fallback" | "fast" | "lite" | "emergency" = "primary",
): string => {
  const group = MODELS[type];
  if (!group) return "";
  return ((group as any)[variant] as string) || (group as any).primary;
};

/**
 * Resolve the full task config (model + params + fallback chain) for a named
 * task. New code paths should prefer `getTask` over `getModel`.
 */
export const getTask = (task: keyof typeof TASKS): TaskConfig => {
  return TASKS[task];
};

/**
 * Returns the ordered fallback chain for a task: [primary, fallback, emergency].
 * Filters out undefined entries.
 */
export const getFallbackChain = (task: keyof typeof TASKS): string[] => {
  const t = TASKS[task];
  return [t.primary, t.fallback, t.emergency].filter(Boolean) as string[];
};

/**
 * Feature flags read from Vite env. Wrapped here so non-Vite contexts
 * (PocketBase hooks, scripts) don't crash on `import.meta`.
 */
const readEnv = (key: string): string | undefined => {
  try {
    if (typeof import.meta !== "undefined") {
      return (import.meta as any).env?.[key];
    }
  } catch {
    /* ignore */
  }
  return undefined;
};

export const FLAGS = {
  /** Enable V2 prompt templates (sharper, structured). Defaults ON. */
  useV2Prompts: readEnv("VITE_USE_V2_PROMPTS") !== "false",
  /** Enable Claude cross-vendor fallback when Gemini text generation fails. */
  enableClaudeFallback: readEnv("VITE_ENABLE_CLAUDE_FALLBACK") === "true",
  /** Enable OpenAI cross-vendor fallback when ALL Gemini image models fail. */
  enableOpenAIFallback: readEnv("VITE_ENABLE_OPENAI_FALLBACK") === "true",
  /** Enable response caching for identical text-generation calls. */
  enableResponseCache: readEnv("VITE_DISABLE_RESPONSE_CACHE") !== "true",
};
