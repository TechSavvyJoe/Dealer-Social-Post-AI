/**
 * Model configuration + routing.
 *
 * Each task has a primary model, a fallback model, and a set of tuned
 * generation parameters (temperature, topK, topP, max output tokens, thinking
 * budget). The router prefers `primary`; on transient failure or rate limit it
 * automatically retries with `fallback`. An emergency model is used as a last
 * resort.
 *
 * "Thinking budget" applies to Gemini 2.5/3.x models that support extended
 * reasoning. Higher budgets = better quality at the cost of latency + cost.
 * For real-time showroom use (a salesperson holding an iPad) we keep budgets
 * low on captions (snappy) and moderate on image generation (worth the wait).
 */

export type ModelTier = "fast" | "quality" | "premium";

export interface GenerationParams {
  temperature?: number;
  topK?: number;
  topP?: number;
  maxOutputTokens?: number;
  /** Tokens of reasoning the model is allowed to spend internally before producing the answer. 0 = disabled, -1 = unlimited. */
  thinkingBudget?: number;
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
}

/**
 * Canonical model identifiers. Keep this list in sync with what Google has
 * actually released — picking nonexistent ids breaks generation silently.
 *
 * Current as of 2026-05. Update when a new model GAs.
 */
export const MODELS = {
  // ---- Text + multimodal reasoning ----
  text: {
    primary: "gemini-3-flash-preview",
    fallback: "gemini-3.1-flash-lite",
    // 2.5 series stays available as emergency long-tail fallback in case 3.x has an outage.
    emergency: "gemini-2.5-flash",
  },
  // ---- Image editing (multimodal: input image + prompt → image) ----
  // Primary = "Nano Banana 2" / Gemini 3 Pro Image — leads CNET 2026 image-
  // model rankings for character consistency and UGC ad creatives, which is
  // exactly what dealer delivery posts need (preserve the customer's face).
  image: {
    primary: "gemini-3-pro-image-preview",
    fallback: "gemini-3.1-flash-image-preview",
    emergency: "gemini-2.5-flash-image",
  },
  // ---- Pure text-to-image (Imagen, Vertex) ----
  imagen: {
    primary: "imagen-4.0-generate-001",
    fallback: "imagen-3.0-generate-002",
  },
  // ---- Video (Veo, Vertex) ----
  // Veo video generation.
  // veo-3.1-generate-preview is the latest available in v1beta.
  video: {
    primary: "veo-3.1-generate-preview",
    fallback: "veo-3.0-generate-001",
    fast: "veo-3.1-fast-generate-preview",
    lite: "veo-3.1-lite-generate-preview",
    emergency: "veo-2.0-generate-001",
  },
} as const;

/**
 * Anthropic Claude fallback ids. Text-only — Claude doesn't generate images.
 * Used when Gemini text generation paths fail AND
 * `VITE_ENABLE_CLAUDE_FALLBACK` / server-side `ANTHROPIC_API_KEY` is set.
 * Joe runs Claude Max, so this is essentially free overflow capacity.
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
 * block). GPT Image 2 (released April 2026, surfaced via the
 * `gpt-image-1` API id) is currently the strongest cross-vendor image model
 * for text-rendered-on-image, which is exactly what social posts need.
 *
 * Requires server-side `OPENAI_API_KEY` and client flag
 * `VITE_ENABLE_OPENAI_FALLBACK=true` to enable.
 */
export const OPENAI_MODELS = {
  image: "gpt-image-1",
} as const;

/**
 * Per-task tuned parameters. These are starting points — Joe can adjust live
 * by editing this file (no DB migration needed) and redeploying.
 */
export const TASK_PARAMS: Record<string, GenerationParams> = {
  // Caption generation: punchy, varied, low repetition.
  text_caption: {
    temperature: 0.9,
    topK: 40,
    topP: 0.95,
    maxOutputTokens: 600,
  },
  // Caption regenerate: turn up temperature so variant isn't a paraphrase.
  text_caption_regenerate: {
    temperature: 1.05,
    topK: 60,
    topP: 0.98,
    maxOutputTokens: 600,
  },
  // Caption edit: low temperature so user's intent dominates.
  text_caption_edit: {
    temperature: 0.6,
    topK: 30,
    topP: 0.9,
    maxOutputTokens: 600,
  },
  // Image generation (Gemini image preview): moderate temperature, no thinking.
  image_generate: {
    temperature: 0.85,
    topP: 0.95,
    maxOutputTokens: 4096,
  },
  // Image edit (e.g. "make the text gold"): tighter so intent dominates.
  image_edit: {
    temperature: 0.65,
    topP: 0.9,
    maxOutputTokens: 4096,
  },
  // Fun-mode artistic transform: high temperature, more creativity.
  image_fun: {
    temperature: 1.05,
    topP: 0.98,
    maxOutputTokens: 4096,
  },
  // Video prompt distillation (text → Veo prompt).
  video_prompt: {
    temperature: 0.75,
    topK: 32,
    topP: 0.92,
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
    params: TASK_PARAMS.text_caption,
  },
  caption_regenerate: {
    primary: MODELS.text.primary,
    fallback: MODELS.text.fallback,
    emergency: MODELS.text.emergency,
    claudeFallback: CLAUDE_MODELS.text_fast,
    params: TASK_PARAMS.text_caption_regenerate,
  },
  caption_edit: {
    primary: MODELS.text.fallback, // small model is plenty for edits; cheaper + faster
    fallback: MODELS.text.primary,
    emergency: MODELS.text.emergency,
    claudeFallback: CLAUDE_MODELS.text_fast,
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
    emergency: MODELS.video.lite,
    params: TASK_PARAMS.video_prompt,
  },
};

/**
 * Resolve a model id by type + variant. Preserved from the original API so
 * existing imports (`getModel('text', 'primary')`) keep working.
 */
export const getModel = (
  type: keyof typeof MODELS,
  variant: "primary" | "fallback" | "fast" | "lite" | "emergency" = "primary"
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
