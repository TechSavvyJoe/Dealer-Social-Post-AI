import modelPolicyJson from "../config/gemini-model-policy.json";
import type { ImageAspectRatio, LogoCornerCheck } from "../types";

export type ModelTaskName =
  | "caption"
  | "caption_regenerate"
  | "caption_edit"
  | "vision_review"
  | "image_standard"
  | "image_studio"
  | "video_standard"
  | "video_quality";
export type ModelTier = "fast" | "quality" | "standard" | "studio";
export type ImageSize = "1K" | "2K" | "4K";
/**
 * Gemini 3.x `thinkingConfig.thinkingLevel` values. `thinkingBudget` is
 * deprecated and `includeThoughts` is never sent; the proxy rejects both.
 */
export type ThinkingLevel = "minimal" | "low" | "medium" | "high";

interface ModelPolicyTask {
  kind: "text" | "image" | "video";
  tier: ModelTier;
  models: readonly string[];
  maxOutputTokens?: number;
  /** Text tasks only: reasoning effort, billed as output tokens. */
  thinkingLevel?: ThinkingLevel;
  imageSizes?: Readonly<Record<string, ImageSize>>;
  resolution?: "720p" | "1080p";
}

interface ModelPolicyDocument {
  version: number;
  verifiedAt: string;
  models: {
    textQuality: string;
    textFast: string;
    imageStandard: string;
    imageStudio: string;
    imageFallback: string;
    imageLite: string;
    videoStandard: string;
    videoQuality: string;
  };
  /** Thinking levels each pinned text model supports (proxy-enforced). */
  thinkingLevels: Readonly<Record<string, readonly ThinkingLevel[]>>;
  tasks: Record<ModelTaskName, ModelPolicyTask>;
  allowedImageAspectRatios: readonly string[];
  allowedRequestFields: Record<string, Record<string, readonly string[]>>;
  requestLimits: Record<string, number>;
  safetySettings: ReadonlyArray<{
    category: string;
    threshold: "BLOCK_MEDIUM_AND_ABOVE";
  }>;
}

/**
 * Runtime model policy. The JSON document is the language-neutral source of
 * truth shared with the PocketBase policy contract and its drift checker.
 */
export const MODEL_POLICY = modelPolicyJson as ModelPolicyDocument;
export const MODEL_POLICY_VERSION = String(MODEL_POLICY.version);
export const ALLOWED_IMAGE_ASPECT_RATIOS =
  MODEL_POLICY.allowedImageAspectRatios as readonly ImageAspectRatio[];

export const isAllowedImageAspectRatio = (value: unknown): value is ImageAspectRatio =>
  typeof value === "string" &&
  ALLOWED_IMAGE_ASPECT_RATIOS.includes(value as ImageAspectRatio);

export type ImageGenerationTier = "standard" | "studio";
export type ModelProvider =
  "gemini" | "anthropic" | "openai" | "custom" | "basic_fallback" | "original";
export type CaptionSource = "ai" | "custom" | "basic_fallback";

export interface ModelExecutionMetadata {
  task: ModelTaskName;
  tier: ModelTier;
  provider: ModelProvider;
  model: string | null;
  /** Opaque correlation id for the exact server-recorded generation attempt. */
  attemptId?: string;
  /** Number of failed upstream choices traversed before this result. */
  fallbackCount: number;
  /** Most recent successful upstream response for this task in this session. */
  lastSuccessAt: string | null;
  /**
   * Images only, and only when the store set a logo corner and a logo was
   * supplied: where the image review saw the logo. Never a pass/fail signal.
   */
  logoCorner?: LogoCornerCheck;
}

/**
 * Create a prompt-free correlation id for one logical model ladder. The id is
 * not an authorization token; PocketBase accepts it only alongside the current
 * HttpOnly session and uses it to prevent an older success from being attached
 * to a later safe-template fallback.
 */
export const createGenerationAttemptId = (): string => {
  const webCrypto = globalThis.crypto;
  if (webCrypto?.randomUUID) return webCrypto.randomUUID().replace(/-/g, "");
  if (webCrypto?.getRandomValues) {
    const bytes = webCrypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`.padEnd(
    24,
    "0",
  );
};

export interface CaptionGenerationResult {
  text: string;
  captionSource: CaptionSource;
  aiMeta: ModelExecutionMetadata;
}

export interface SocialPostGenerationMetadata {
  /** Flattened compatibility fields persisted on GeneratedPost. */
  captionSource: CaptionSource;
  selectedTier: ImageGenerationTier;
  model?: string;
  fallbackCount: number;
  lastSuccessfulGenerationAt?: string;
  modelPolicyVersion: string;
  /** Detailed per-modality provenance for internal diagnostics. */
  caption: ModelExecutionMetadata;
  image: ModelExecutionMetadata;
}

export interface SocialPostGenerationResult {
  image: string;
  text: string;
  captionSource: CaptionSource;
  aiMeta: SocialPostGenerationMetadata;
}

export interface GenerationParams {
  maxOutputTokens?: number;
  /** Text tasks only: Gemini 3.x reasoning effort, mirrored from the policy. */
  thinkingConfig?: { thinkingLevel: ThinkingLevel };
  /** Stop sequences that cut the response short. */
  stopSequences?: string[];
}

export interface TaskConfig {
  kind: "text" | "image" | "video";
  tier: ModelTier;
  models: readonly string[];
  primary: string;
  fallback?: string;
  emergency?: string;
  params: GenerationParams;
  imageSizes?: Readonly<Record<string, ImageSize>>;
  resolution?: "720p" | "1080p";
  /** Optional Anthropic Claude model id used as cross-vendor fallback (set via env). */
  claudeFallback?: string;
  /** Claude-only sampling control; never forwarded to Gemini 3.x. */
  claudeTemperature?: number;
}

/**
 * Canonical model identifiers. Keep this list in sync with what Google has
 * actually released — picking nonexistent ids breaks generation silently.
 *
 * Video transport verified on 2026-10-10 against the stable Omni API. The
 * backend preserves the installed-client contract while owning provider I/O.
 */
export const MODELS = {
  // ---- Text + multimodal reasoning ----
  text: {
    primary: MODEL_POLICY.models.textQuality,
    fallback: MODEL_POLICY.models.textFast,
  },
  // ---- Image editing (multimodal: input image + prompt → image) ----
  // Both customer-facing tiers start on Pro Image for reliable typography.
  // Studio uses the same bounded fallback ladder but requests 4K from Pro.
  image: {
    primary: MODEL_POLICY.models.imageStandard,
    standard: MODEL_POLICY.models.imageStandard,
    studio: MODEL_POLICY.models.imageStudio,
    fallback: MODEL_POLICY.models.imageFallback,
    emergency: MODEL_POLICY.models.imageLite,
  },
  // ---- Video (Omni, translated by the server) ----
  // Output resolution distinguishes the tiers; there is one model and no
  // automatic second billable attempt on a duplicate fallback rung.
  video: {
    primary: MODEL_POLICY.models.videoStandard,
    fast: MODEL_POLICY.models.videoStandard,
    quality: MODEL_POLICY.models.videoQuality,
  },
} as const;

/**
 * Anthropic Claude fallback ids. Text-only — Claude doesn't generate images.
 * Used when Gemini text generation paths fail AND
 * `VITE_ENABLE_CLAUDE_FALLBACK` / server-side `ANTHROPIC_API_KEY` is set.
 * Anthropic API usage is separately metered; a Claude subscription does not
 * cover these server-side API calls.
 *
 * Advertise only ids the proxy accepts: `pb_hooks/requestPolicies.js`
 * `buildAnthropicMessageRequest` pins exactly `ANTHROPIC_FALLBACK_MODEL` and
 * returns 400 for anything else, so listing Sonnet/Opus here would only
 * create a guaranteed-failure path.
 */
export const CLAUDE_MODELS = {
  // The single-turn caption + edit fallback runs on Haiku.
  text_fast: "claude-haiku-4-5-20251001",
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

type TextTaskName = "caption" | "caption_regenerate" | "caption_edit" | "vision_review";

/**
 * Text tasks emit the policy's `maxOutputTokens` plus its per-task
 * `thinkingConfig.thinkingLevel`. Gemini 3.x defaults to `medium` and bills
 * thinking as output tokens, so captions pin a cheaper level. `vision_review`
 * is the deliberate exception: it is the one call where reasoning quality
 * decides whether a flawed render ships, so it keeps `medium`.
 */
const textGenerationParams = (task: TextTaskName): GenerationParams => {
  const policyTask = MODEL_POLICY.tasks[task];
  return {
    maxOutputTokens: policyTask.maxOutputTokens,
    ...(policyTask.thinkingLevel
      ? { thinkingConfig: { thinkingLevel: policyTask.thinkingLevel } }
      : {}),
  };
};

/**
 * Per-task output limits. Prompt instructions carry the tone and variation;
 * Google recommends leaving Gemini 3.x sampling parameters at their defaults.
 */
export const TASK_PARAMS: Record<ModelTaskName, GenerationParams> = {
  // Caption text is short, but Gemini 3.x may spend tokens on internal
  // reasoning before the visible caption — keep headroom so MAX_TOKENS
  // never truncates the actual post body to empty.
  caption: textGenerationParams("caption"),
  caption_regenerate: textGenerationParams("caption_regenerate"),
  caption_edit: textGenerationParams("caption_edit"),
  vision_review: textGenerationParams("vision_review"),
  // Image models manage their own reasoning and composition defaults.
  image_standard: {
    maxOutputTokens: MODEL_POLICY.tasks.image_standard.maxOutputTokens,
  },
  image_studio: {
    maxOutputTokens: MODEL_POLICY.tasks.image_studio.maxOutputTokens,
  },
  video_standard: {},
  video_quality: {},
};

/**
 * Full per-task config: model id + params + fallback ladder.
 */
export const TASKS: Record<ModelTaskName, TaskConfig> = {
  caption: {
    kind: "text",
    tier: "quality",
    models: MODEL_POLICY.tasks.caption.models,
    primary: MODEL_POLICY.tasks.caption.models[0],
    fallback: MODEL_POLICY.tasks.caption.models[1],
    claudeFallback: CLAUDE_MODELS.text_fast,
    claudeTemperature: 0.8,
    params: TASK_PARAMS.caption,
  },
  caption_regenerate: {
    kind: "text",
    tier: "quality",
    models: MODEL_POLICY.tasks.caption_regenerate.models,
    primary: MODEL_POLICY.tasks.caption_regenerate.models[0],
    fallback: MODEL_POLICY.tasks.caption_regenerate.models[1],
    claudeFallback: CLAUDE_MODELS.text_fast,
    claudeTemperature: 1,
    params: TASK_PARAMS.caption_regenerate,
  },
  caption_edit: {
    kind: "text",
    tier: "fast",
    models: MODEL_POLICY.tasks.caption_edit.models,
    primary: MODEL_POLICY.tasks.caption_edit.models[0],
    fallback: MODEL_POLICY.tasks.caption_edit.models[1],
    claudeFallback: CLAUDE_MODELS.text_fast,
    claudeTemperature: 0.4,
    params: TASK_PARAMS.caption_edit,
  },
  // Second-pass quality control on a generated image. Same ladder as a
  // regenerated caption, but its own task so the request carries
  // thinkingLevel "medium" and the server's usage ledger records a review
  // instead of a caption. No cross-vendor fallback: Claude cannot answer the
  // structured verdict this reviewer returns.
  vision_review: {
    kind: "text",
    tier: "quality",
    models: MODEL_POLICY.tasks.vision_review.models,
    primary: MODEL_POLICY.tasks.vision_review.models[0],
    fallback: MODEL_POLICY.tasks.vision_review.models[1],
    params: TASK_PARAMS.vision_review,
  },
  image_standard: {
    kind: "image",
    tier: "standard",
    models: MODEL_POLICY.tasks.image_standard.models,
    primary: MODEL_POLICY.tasks.image_standard.models[0],
    fallback: MODEL_POLICY.tasks.image_standard.models[1],
    emergency: MODEL_POLICY.tasks.image_standard.models[2],
    params: TASK_PARAMS.image_standard,
    imageSizes: MODEL_POLICY.tasks.image_standard.imageSizes,
  },
  image_studio: {
    kind: "image",
    tier: "studio",
    models: MODEL_POLICY.tasks.image_studio.models,
    primary: MODEL_POLICY.tasks.image_studio.models[0],
    fallback: MODEL_POLICY.tasks.image_studio.models[1],
    emergency: MODEL_POLICY.tasks.image_studio.models[2],
    params: TASK_PARAMS.image_studio,
    imageSizes: MODEL_POLICY.tasks.image_studio.imageSizes,
  },
  video_standard: {
    kind: "video",
    tier: "standard",
    models: MODEL_POLICY.tasks.video_standard.models,
    primary: MODEL_POLICY.tasks.video_standard.models[0],
    // The lite rung is reached only on a 404 from the primary's start call —
    // the poller never re-issues a paid start for any other failure.
    fallback: MODEL_POLICY.tasks.video_standard.models[1],
    emergency: MODEL_POLICY.tasks.video_standard.models[2],
    params: TASK_PARAMS.video_standard,
    resolution: "720p",
  },
  video_quality: {
    kind: "video",
    tier: "quality",
    models: MODEL_POLICY.tasks.video_quality.models,
    primary: MODEL_POLICY.tasks.video_quality.models[0],
    // The lite rung is reached only on a 404 from the primary's start call —
    // the poller never re-issues a paid start for any other failure.
    fallback: MODEL_POLICY.tasks.video_quality.models[1],
    emergency: MODEL_POLICY.tasks.video_quality.models[2],
    params: TASK_PARAMS.video_quality,
    resolution: "1080p",
  },
};

/**
 * Resolve a model id by type + variant. Preserved from the original API so
 * existing imports (`getModel('text', 'primary')`) keep working.
 */
export const getModel = (
  type: keyof typeof MODELS,
  variant:
    | "primary"
    | "fallback"
    | "fast"
    | "quality"
    | "standard"
    | "studio"
    | "lite"
    | "emergency" = "primary",
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
  return [...t.models];
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
