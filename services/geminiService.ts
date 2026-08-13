import {
  parseDataUrl,
  urlToDataUrl,
  letterboxImageForVideo,
  resolveVeoAspect,
} from "../utils/imageUtils";
import {
  StyleOption,
  ToneOption,
  VideoStyle,
  VideoRequestOptions,
  type ImageAspectRatio,
} from "../types";
import {
  generateImagePrompt,
  generateTextPrompt,
  generateFunPrompt,
  editImagePrompt,
  editTextPrompt,
  generateVideoPrompt,
} from "./promptConfig";
import { normalizeError, recoveryHint } from "../utils/errorHandler";
import { getGeminiClient } from "./geminiClient";
import { GeminiVideoOperationSchema } from "../utils/schemas";
import {
  type CaptionGenerationResult,
  createGenerationAttemptId,
  FLAGS,
  getFallbackChain,
  type ImageGenerationTier,
  isAllowedImageAspectRatio,
  type ModelExecutionMetadata,
  type ModelProvider,
  type ModelTaskName,
  MODEL_POLICY_VERSION,
  MODELS,
  type SocialPostGenerationResult,
  TASKS,
  type GenerationParams,
} from "./modelConfig";
import {
  assertAuthEpoch,
  captureAuthEpoch,
  notifySessionRejected,
} from "../utils/authBoundary";
import { generateTextViaClaude, shouldFallbackToClaude } from "./claudeAdapter";
import { generateImageViaOpenAI, shouldFallbackToOpenAI } from "./openaiAdapter";
import { requestCache } from "../utils/requestCache";
import {
  logEvent as logTelemetry,
  logError as logImageDegraded,
} from "../utils/telemetry";
import { cleanSocialCaption, ensureUsableCaption } from "../utils/captionQuality";
import { z } from "zod";
import { isSafeOnImageHeadline, ON_IMAGE_TEXT_BUDGET } from "./promptsV2";

/**
 * Tries each model in the fallback chain for a given task. The action
 * receives the resolved model id and should perform a single attempt.
 * Returns on first success; throws the last error if every model fails.
 */
interface ModelRun<T> {
  value: T;
  aiMeta: ModelExecutionMetadata;
}

const lastSuccessfulAtByTask = new Map<ModelTaskName, string>();
const lastExecutionByTask = new Map<ModelTaskName, ModelExecutionMetadata>();

const recordExecution = (
  task: ModelTaskName,
  provider: ModelProvider,
  model: string | null,
  fallbackCount: number,
  upstreamSucceeded: boolean,
  attemptId?: string,
): ModelExecutionMetadata => {
  if (upstreamSucceeded) {
    lastSuccessfulAtByTask.set(task, new Date().toISOString());
  }
  const metadata: ModelExecutionMetadata = {
    task,
    tier: TASKS[task].tier,
    provider,
    model,
    ...(attemptId ? { attemptId } : {}),
    fallbackCount,
    lastSuccessAt: lastSuccessfulAtByTask.get(task) ?? null,
  };
  lastExecutionByTask.set(task, metadata);
  return metadata;
};

/** Latest model-layer provenance for diagnostics and fallback-aware UI. */
export const getLastModelExecutionMetadata = (
  task: ModelTaskName,
): ModelExecutionMetadata | null => lastExecutionByTask.get(task) ?? null;

class ModelChainFailure extends Error {
  readonly attemptedModels: number;

  constructor(task: ModelTaskName, attemptedModels: number, cause: unknown) {
    super(cause instanceof Error ? cause.message : `All models failed for ${task}`);
    this.name = "ModelChainFailure";
    this.attemptedModels = attemptedModels;
    Object.defineProperty(this, "cause", { value: cause, enumerable: false });
  }
}

const attemptedModelsFromError = (error: unknown): number =>
  error instanceof ModelChainFailure ? error.attemptedModels : 0;

const attemptIdFromError = (error: unknown): string | undefined =>
  error && typeof error === "object" && "generationAttemptId" in error
    ? String((error as { generationAttemptId?: unknown }).generationAttemptId || "") ||
      undefined
    : undefined;

const latestSuccessfulGenerationAt = (
  ...executions: ModelExecutionMetadata[]
): string | undefined => {
  const timestamps = executions
    .map((execution) => execution.lastSuccessAt)
    .filter((timestamp): timestamp is string => Boolean(timestamp))
    .sort();
  return timestamps.at(-1);
};

async function withFallbackChain<T>(
  task: ModelTaskName,
  attemptId: string,
  action: (modelId: string) => Promise<T>,
): Promise<ModelRun<T>> {
  const chain = getFallbackChain(task);
  let lastErr: unknown;
  let attemptedModels = 0;
  for (let index = 0; index < chain.length; index += 1) {
    const modelId = chain[index];
    try {
      attemptedModels += 1;
      return {
        value: await action(modelId),
        aiMeta: recordExecution(task, "gemini", modelId, index, true, attemptId),
      };
    } catch (err) {
      lastErr = err;
      const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
      // Authentication and malformed requests will fail identically across
      // models, so stop. A 404 can be model-specific (regional rollout or a
      // retired endpoint), so it should advance through the configured chain.
      if (msg.includes("400") || msg.includes("401") || msg.includes("403")) {
        throw new ModelChainFailure(task, attemptedModels, err);
      }
      // Otherwise try the next model.
      console.warn(
        `[withFallbackChain] ${task} on ${modelId} failed; trying next model.`,
        err,
      );
    }
  }
  throw new ModelChainFailure(
    task,
    attemptedModels,
    lastErr ?? new Error(`All models failed for task ${task}`),
  );
}

/**
 * sha-256 of a string, hex-encoded. Used to key the response cache.
 */
async function hashString(input: string): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const buf = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // Non-crypto fallback (test environments without subtle). Good enough for cache key.
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return `nohash:${h.toString(16)}`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const blobToDataUrl = async (blob: Blob): Promise<string> => {
  // Use arrayBuffer() + btoa rather than FileReader so the conversion is
  // independent of which realm produced the Blob. FileReader in jsdom rejects
  // Blobs created by Node's fetch(), which broke logo loading under test.
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const mime = blob.type || "application/octet-stream";
  return `data:${mime};base64,${btoa(binary)}`;
};

const normaliseDataUrl = async (source?: string): Promise<string> => {
  if (!source) {
    throw new Error("No image data provided.");
  }
  if (source.startsWith("data:")) {
    return source;
  }
  if (source.startsWith("http")) {
    return await urlToDataUrl(source);
  }
  if (source.startsWith("/")) {
    const response = await fetch(source, { credentials: "include" });
    if (!response.ok) {
      throw new Error(`Could not load same-origin image (${response.status}).`);
    }
    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) {
      throw new Error("The same-origin resource is not an image.");
    }
    return await blobToDataUrl(blob);
  }
  if (source.startsWith("blob:")) {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`Could not read blob url: ${response.statusText}`);
    }
    return await blobToDataUrl(await response.blob());
  }
  throw new Error(
    "Unsupported image format. Expected a data URL, http(s) URL, or blob URL.",
  );
};

const SUPPORTED_PROVIDER_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const optionalLogoImagePart = async (source?: string) => {
  if (!source) return null;
  try {
    const normalisedLogo = await normaliseDataUrl(source);
    const { mimeType, data } = parseDataUrl(normalisedLogo);
    if (!SUPPORTED_PROVIDER_IMAGE_TYPES.has(mimeType.toLowerCase())) {
      throw new Error(`Unsupported logo format: ${mimeType}`);
    }
    return { inlineData: { mimeType: mimeType.toLowerCase(), data } };
  } catch (error) {
    // A legacy/temporarily unavailable logo should not block the salesperson's
    // entire post. The generated result still carries the dealership name.
    console.warn("[Gemini] Dealer logo could not be included.", error);
    return null;
  }
};

/** Clean model text; never return labeled/XML junk to the UI. */
const cleanGeneratedText = (inputText: string): string => {
  return cleanSocialCaption(inputText ?? "");
};

/** Pull a data-URL image out of a generateContent response, if any. */
const extractGeneratedImageDataUrl = (response: unknown): string | null => {
  const parts =
    (response as { candidates?: Array<{ content?: { parts?: unknown[] } }> })
      ?.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    const typedPart = part as {
      thought?: boolean;
      inlineData?: { mimeType?: string; data?: string };
    };
    // Gemini can return interim thought images before the final composition.
    // Those parts are not publishable output and must never win first-match
    // response selection.
    if (typedPart?.thought === true) continue;
    const inline = typedPart?.inlineData;
    if (inline?.data) {
      return `data:${inline.mimeType || "image/png"};base64,${inline.data}`;
    }
  }
  return null;
};

/** Human-readable reason when a model answers without an image. */
const imageFailureReason = (response: unknown): string => {
  const cand = (
    response as {
      candidates?: Array<{ finishReason?: string; finishMessage?: string }>;
      promptFeedback?: { blockReason?: string };
    }
  )?.candidates?.[0];
  const block = (response as { promptFeedback?: { blockReason?: string } })
    ?.promptFeedback?.blockReason;
  return cand?.finishReason || cand?.finishMessage || block || "empty image response";
};

/**
 * Run image generation across the model ladder. Treats "HTTP 200 but no
 * image bytes" (IMAGE_RECITATION, SAFETY, empty parts) as a failure so the
 * next model is tried — previously that silent empty success aborted the
 * whole post with a generic error.
 */
const generateImageWithFallback = async (
  task: "image_standard" | "image_studio",
  imageParts: unknown[],
  imagePromptForOpenAI?: string,
  imageAspectRatio?: ImageAspectRatio,
  requestAuthEpoch: number = captureAuthEpoch(),
): Promise<ModelRun<string>> => {
  assertAuthEpoch(requestAuthEpoch);
  const client = getGeminiClient();
  const attemptId = createGenerationAttemptId();
  try {
    const response = await withFallbackChain(task, attemptId, async (modelId) => {
      assertAuthEpoch(requestAuthEpoch);
      const res = await client.models.generateContent({
        model: modelId,
        task,
        attemptId,
        contents: { parts: imageParts },
        generationConfig: imageGenerationConfig(
          modelId,
          TASKS[task].params,
          TASKS[task].imageSizes,
          imageAspectRatio,
        ),
        requestAuthEpoch,
      } as any);
      assertAuthEpoch(requestAuthEpoch);
      const dataUrl = extractGeneratedImageDataUrl(res);
      if (!dataUrl) {
        throw new Error(`No image from ${modelId} (${imageFailureReason(res)})`);
      }
      return res;
    });
    const dataUrl = extractGeneratedImageDataUrl(response.value);
    if (dataUrl) return { value: dataUrl, aiMeta: response.aiMeta };
    throw new Error("Image model returned no image data.");
  } catch (err) {
    let terminalError = err;
    if (shouldFallbackToOpenAI(err) && imagePromptForOpenAI) {
      console.warn(
        `[${task}] All Gemini image models exhausted; falling back to OpenAI`,
        err,
      );
      logTelemetry("image.fallback.openai", {
        reason: err instanceof Error ? err.message : String(err),
        task,
      });
      try {
        const openAIImageSize =
          imageAspectRatio === "9:16" || imageAspectRatio === "4:5"
            ? "1024x1536"
            : imageAspectRatio === "4:3" || imageAspectRatio === "16:9"
              ? "1536x1024"
              : "1024x1024";
        const value = await generateImageViaOpenAI({
          prompt: imagePromptForOpenAI,
          task,
          attemptId,
          size: openAIImageSize,
          quality: "high",
          requestAuthEpoch,
        });
        assertAuthEpoch(requestAuthEpoch);
        return {
          value,
          aiMeta: recordExecution(
            task,
            "openai",
            "gpt-image-2",
            attemptedModelsFromError(err),
            true,
            attemptId,
          ),
        };
      } catch (openaiErr) {
        console.warn(`[${task}] OpenAI image fallback also failed`, openaiErr);
        terminalError = new ModelChainFailure(
          task,
          attemptedModelsFromError(err) + 1,
          openaiErr,
        );
      }
    }
    if (terminalError && typeof terminalError === "object") {
      Object.defineProperty(terminalError, "generationAttemptId", {
        value: attemptId,
        configurable: true,
      });
    }
    throw terminalError;
  }
};

const ImageTextViolationSchema = z.enum([
  "too_many_words",
  "too_many_characters",
  "full_sentence",
  "hashtag",
  "url_or_phone",
  "multiple_marketing_blocks",
  "unreadable_or_uncertain",
]);

const GeneratedImageTextReviewSchema = z
  .object({
    compliant: z.boolean(),
    uncertain: z.boolean(),
    detectedMarketingText: z.array(z.string().max(120)).max(8),
    marketingWordCount: z.number().int().min(0).max(1_000),
    marketingCharacterCount: z.number().int().min(0).max(10_000),
    hasFullSentence: z.boolean(),
    hasHashtag: z.boolean(),
    hasUrlOrPhone: z.boolean(),
    violations: z.array(ImageTextViolationSchema).max(8),
    logoPresent: z.boolean().optional(),
  })
  .strict();

export interface GeneratedImageTextReview {
  compliant: boolean;
  uncertain: boolean;
  detectedMarketingText: string[];
  marketingWordCount: number;
  marketingCharacterCount: number;
  hasFullSentence: boolean;
  hasHashtag: boolean;
  hasUrlOrPhone: boolean;
  violations: Array<z.infer<typeof ImageTextViolationSchema>>;
  /** Whether the supplied dealership logo is visible; absent when no logo. */
  logoPresent?: boolean;
}

/**
 * Model responses frequently wrap JSON in Markdown fences or prose because
 * the proxy's text-task allowlist has no JSON response mode. Extract the
 * first balanced object instead of failing the whole review on formatting.
 */
const extractJsonObject = (raw: string): unknown => {
  const direct = raw.trim();
  try {
    return JSON.parse(direct);
  } catch {
    /* fall through to extraction */
  }
  const unfenced = direct.replace(/```(?:json)?/gi, "");
  const start = unfenced.indexOf("{");
  if (start === -1) throw new Error("Image text review returned malformed JSON.");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < unfenced.length; i += 1) {
    const ch = unfenced[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(unfenced.slice(start, i + 1));
        } catch {
          throw new Error("Image text review returned malformed JSON.");
        }
      }
    }
  }
  throw new Error("Image text review returned malformed JSON.");
};

const generatedImageTextReviewPrompt = (
  dealershipName: string,
): string => `You are a strict visual quality-control inspector for an automotive dealership image.

Inspect the image pixels and return only the requested JSON object.

Marketing overlay policy (this matches the design brief the image was created from):
- Up to ${ON_IMAGE_TEXT_BUDGET.maxBlocks} separate overlay text blocks are allowed: one headline of at most ${ON_IMAGE_TEXT_BUDGET.headlineWords} words / ${ON_IMAGE_TEXT_BUDGET.headlineChars} characters, plus up to two short accents (a badge of at most ${ON_IMAGE_TEXT_BUDGET.badgeWords} words and one short support line).
- Across all blocks combined: at most ${ON_IMAGE_TEXT_BUDGET.totalWords} words and ${ON_IMAGE_TEXT_BUDGET.totalChars} characters.
- Reject full sentences, hashtags, URLs, and phone numbers anywhere in overlay copy.
- The exact dealership legal name (${dealershipName}) and a supplied dealership logo are brand identity. Exclude those from the marketing word/character counts and block counts.
- Exclude text naturally photographed in the scene, such as vehicle badges, building signs, clothing, documents, and license plates. Count only designed promotional overlay copy.
- If text is unreadable, ambiguous, or you cannot confidently distinguish promotional overlay from scene text, set uncertain=true. Only set compliant=false when you can identify a concrete violation.
- Set logoPresent=true when a dealership logo graphic is visible anywhere in the image, otherwise false.

detectedMarketingText must contain each overlay text block as its own array entry, exactly as rendered. marketingWordCount and marketingCharacterCount are totals across all blocks. violations must use only the allowed enum values. Return only the JSON object with keys: compliant, uncertain, detectedMarketingText, marketingWordCount, marketingCharacterCount, hasFullSentence, hasHashtag, hasUrlOrPhone, violations, logoPresent. Never include explanations or image details outside the JSON.`;

/**
 * Second-pass vision check for text painted into generated image pixels.
 * Provider credentials remain in the authenticated PocketBase proxy; this
 * browser helper receives only the strict, non-sensitive review result.
 */
export const reviewGeneratedImageText = async (
  imageBase64Url: string,
  dealershipName: string,
  requestAuthEpoch: number = captureAuthEpoch(),
): Promise<GeneratedImageTextReview> => {
  const normalisedImage = await normaliseDataUrl(imageBase64Url);
  assertAuthEpoch(requestAuthEpoch);
  const { mimeType, data } = parseDataUrl(normalisedImage);
  const imagePart = { inlineData: { mimeType, data } };
  const task = "caption_regenerate" as const;
  const taskConfig = TASKS[task];
  const attemptId = createGenerationAttemptId();

  const generated = await withFallbackChain(task, attemptId, async (modelId) => {
    assertAuthEpoch(requestAuthEpoch);
    const response = await getGeminiClient().models.generateContent({
      model: modelId,
      task,
      attemptId,
      contents: {
        parts: [imagePart, { text: generatedImageTextReviewPrompt(dealershipName) }],
      },
      // The server allowlist intentionally accepts only the task policy's
      // exact text-generation config. Strictness comes from the JSON-only
      // prompt plus the Zod boundary below, not extra browser-supplied knobs.
      generationConfig: taskConfig.params,
      requestAuthEpoch,
    } as any);
    assertAuthEpoch(requestAuthEpoch);
    const rawText = typeof response.text === "function" ? response.text() : "";
    const parsedJson = extractJsonObject(rawText);
    const parsed = GeneratedImageTextReviewSchema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new Error("Image text review returned an invalid structured result.");
    }
    return parsed.data;
  });

  const review = generated.value;
  const detectedMarketingText = review.detectedMarketingText
    .map((value) => value.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  const joinedMarketingText = detectedMarketingText.join(" ");
  const derivedWordCount = joinedMarketingText
    ? joinedMarketingText.split(/\s+/).length
    : 0;
  const derivedCharacterCount = joinedMarketingText.length;
  const marketingWordCount = Math.max(review.marketingWordCount, derivedWordCount);
  const marketingCharacterCount = Math.max(
    review.marketingCharacterCount,
    derivedCharacterCount,
  );

  // Per-block evaluation matching the generation contract: each block within
  // headline limits (display punctuation like a trailing "!" is tolerated),
  // bounded block count, bounded totals. Joining all blocks and applying the
  // single-headline rule to the concatenation destroyed compliant renders.
  const blocksSafe = detectedMarketingText.every((block) => {
    const displayNormalized = block.replace(/[!?.]+$/u, "").trim();
    return displayNormalized.length === 0 || isSafeOnImageHeadline(displayNormalized);
  });
  const withinBudget =
    detectedMarketingText.length <= ON_IMAGE_TEXT_BUDGET.maxBlocks &&
    marketingWordCount <= ON_IMAGE_TEXT_BUDGET.totalWords &&
    marketingCharacterCount <= ON_IMAGE_TEXT_BUDGET.totalChars &&
    detectedMarketingText.every(
      (block) =>
        block.split(/\s+/).length <= ON_IMAGE_TEXT_BUDGET.headlineWords &&
        block.length <= ON_IMAGE_TEXT_BUDGET.headlineChars,
    );

  return {
    ...review,
    detectedMarketingText,
    marketingWordCount,
    marketingCharacterCount,
    compliant:
      review.compliant &&
      withinBudget &&
      !review.hasFullSentence &&
      !review.hasHashtag &&
      !review.hasUrlOrPhone &&
      blocksSafe,
  };
};

const TEXT_REDUCTION_CORRECTION_PROMPT = `This is a corrective photo edit of the attached generated image.

Reduce the AI-added marketing overlay text to the allowed budget:
- Keep at most one short headline of up to ${ON_IMAGE_TEXT_BUDGET.headlineWords} words (${ON_IMAGE_TEXT_BUDGET.headlineChars} characters max).
- Keep the supplied dealership logo and the dealership name lockup unchanged — they are brand identity, not marketing copy.
- Remove every additional slogan, caption line, hashtag, URL, phone number, and extra word badge.
Do not add new words. Preserve the exact people, faces, bodies, vehicle, background, crop, lighting, and colors.
Return only the corrected image.`;

const strictTextRetryAddendum = (): string => `

<text_compliance_retry>
A prior render exceeded the on-image text budget. Re-render the same creative direction with tighter copy:
- At most one short headline (${ON_IMAGE_TEXT_BUDGET.headlineWords} words / ${ON_IMAGE_TEXT_BUDGET.headlineChars} characters max)
- At most one ${ON_IMAGE_TEXT_BUDGET.badgeWords}-word badge, only if space allows
- Keep the dealership name lockup and supplied logo
- No sentences, hashtags, URLs, or phone numbers anywhere
</text_compliance_retry>`;

const LOGO_RESTORE_PROMPT = `This is a corrective photo edit of the attached generated image.

The supplied dealership logo (second attached image) is missing from the design. Add it as a small, tasteful watermark in a lower-corner safe zone away from people. Do not distort it.
Change nothing else: preserve all existing text, people, faces, vehicle, background, crop, lighting, and colors.
Return only the corrected image.`;

interface ImageTextComplianceInput {
  candidate: ModelRun<string>;
  dealershipName: string;
  logoImagePart: unknown | null;
  imageTier: ImageGenerationTier;
  imageAspectRatio?: ImageAspectRatio;
  requestAuthEpoch: number;
  /** Original photo + prompt parts, enabling a styled compliant re-render. */
  regenerationParts?: unknown[];
  regenerationPrompt?: string;
}

const concreteViolations = (
  review: GeneratedImageTextReview,
): GeneratedImageTextReview["violations"] =>
  review.violations.filter((violation) => violation !== "unreadable_or_uncertain");

/**
 * Overlay findings that must never ship: a phone number, a URL, or a hashtag
 * burned into the pixels. Everything else the reviewer reports (too many
 * words/characters, "reads like a sentence", multiple blocks) is a craft
 * judgment that must not be allowed to discard a finished render.
 */
const hasUnsafeOverlayContent = (review: GeneratedImageTextReview): boolean =>
  review.hasUrlOrPhone ||
  review.hasHashtag ||
  review.violations.includes("url_or_phone") ||
  review.violations.includes("hashtag");

const imagePartFromDataUrl = async (
  dataUrl: string,
  requestAuthEpoch: number,
): Promise<{ inlineData: { mimeType: string; data: string } }> => {
  const normalised = await normaliseDataUrl(dataUrl);
  assertAuthEpoch(requestAuthEpoch);
  const { mimeType, data } = parseDataUrl(normalised);
  return { inlineData: { mimeType, data } };
};

/**
 * Bounded compliance ladder for AI-added overlay text.
 *
 * Review errors and pure uncertainty pass the image through with telemetry —
 * the generation prompt already enforces the text contract, and destroying a
 * finished creative because a *reviewer* failed is worse than shipping it.
 * Only confirmed violations trigger correction: first a styled re-render with
 * tighter copy, then a text-reduction edit, and only a repeat confirmed
 * violation fails closed.
 */
const enforceGeneratedImageTextCompliance = async ({
  candidate,
  dealershipName,
  logoImagePart,
  imageTier,
  imageAspectRatio,
  requestAuthEpoch,
  regenerationParts,
  regenerationPrompt,
}: ImageTextComplianceInput): Promise<ModelRun<string>> => {
  const reviewOrNull = async (
    image: string,
    stage: string,
  ): Promise<GeneratedImageTextReview | null> => {
    try {
      return await reviewGeneratedImageText(image, dealershipName, requestAuthEpoch);
    } catch (error) {
      logTelemetry("image.text_compliance.review_failed", {
        stage,
        reason: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  };

  const restoreLogoIfMissing = async (
    result: ModelRun<string>,
    review: GeneratedImageTextReview | null,
  ): Promise<ModelRun<string>> => {
    if (!logoImagePart || review?.logoPresent !== false) return result;
    logTelemetry("image.text_compliance.logo_restore", {});
    try {
      const sourcePart = await imagePartFromDataUrl(result.value, requestAuthEpoch);
      return await generateImageWithFallback(
        imageTaskForTier(imageTier),
        [sourcePart, { text: LOGO_RESTORE_PROMPT }, logoImagePart],
        undefined,
        imageAspectRatio,
        requestAuthEpoch,
      );
    } catch (error) {
      logTelemetry("image.text_compliance.logo_restore_failed", {
        reason: error instanceof Error ? error.message : String(error),
      });
      return result;
    }
  };

  const firstReview = await reviewOrNull(candidate.value, "initial");
  if (firstReview === null) return candidate;
  if (firstReview.compliant) return restoreLogoIfMissing(candidate, firstReview);

  const confirmed = concreteViolations(firstReview);
  if (confirmed.length === 0) {
    logTelemetry("image.text_compliance.uncertain_pass", {
      uncertain: firstReview.uncertain,
      wordCount: firstReview.marketingWordCount,
      characterCount: firstReview.marketingCharacterCount,
    });
    return restoreLogoIfMissing(candidate, firstReview);
  }

  logTelemetry("image.text_compliance.retry", {
    uncertain: firstReview.uncertain,
    wordCount: firstReview.marketingWordCount,
    characterCount: firstReview.marketingCharacterCount,
    violations: firstReview.violations,
  });

  // Rung 1: styled re-render from the original photo with tighter copy.
  let bestCandidate = candidate;
  if (regenerationParts && regenerationPrompt) {
    try {
      const retryParts = regenerationParts.map((part) =>
        part && typeof part === "object" && "text" in (part as object)
          ? { text: `${(part as { text: string }).text}${strictTextRetryAddendum()}` }
          : part,
      );
      const regenerated = await generateImageWithFallback(
        imageTaskForTier(imageTier),
        retryParts,
        undefined,
        imageAspectRatio,
        requestAuthEpoch,
      );
      const regeneratedReview = await reviewOrNull(regenerated.value, "regenerated");
      if (regeneratedReview === null || regeneratedReview.compliant) {
        return restoreLogoIfMissing(regenerated, regeneratedReview);
      }
      if (concreteViolations(regeneratedReview).length === 0) {
        return restoreLogoIfMissing(regenerated, regeneratedReview);
      }
      bestCandidate = regenerated;
    } catch (error) {
      logTelemetry("image.text_compliance.regeneration_failed", {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Rung 2: reduce overlay text on the best candidate, keeping brand identity.
  const sourcePart = await imagePartFromDataUrl(bestCandidate.value, requestAuthEpoch);
  const correctionParts: unknown[] = [
    sourcePart,
    { text: TEXT_REDUCTION_CORRECTION_PROMPT },
  ];
  if (logoImagePart) correctionParts.push(logoImagePart);
  const corrected = await generateImageWithFallback(
    imageTaskForTier(imageTier),
    correctionParts,
    // An OpenAI text-to-image fallback cannot see the correction source and
    // could fabricate replacement people/vehicles. Fail closed instead.
    undefined,
    imageAspectRatio,
    requestAuthEpoch,
  );

  const correctedReview = await reviewOrNull(corrected.value, "corrected");
  if (correctedReview === null || correctedReview.compliant) {
    return restoreLogoIfMissing(corrected, correctedReview);
  }
  if (concreteViolations(correctedReview).length === 0) {
    return restoreLogoIfMissing(corrected, correctedReview);
  }

  logTelemetry("image.text_compliance.rejected", {
    uncertain: correctedReview.uncertain,
    wordCount: correctedReview.marketingWordCount,
    characterCount: correctedReview.marketingCharacterCount,
    violations: correctedReview.violations,
  });

  // Only contact details and link-like overlays are genuinely unsafe to ship;
  // word/character/sentence findings are craft judgments. Throwing on those
  // discards every render and drops the caller back to the untouched source
  // photo -- no headline, no badge, no logo -- which is a worse outcome than a
  // slightly long headline, and it is indistinguishable to the user from the
  // app doing nothing at all.
  if (!hasUnsafeOverlayContent(correctedReview)) {
    logTelemetry("image.text_compliance.accepted_over_budget", {
      violations: correctedReview.violations,
      wordCount: correctedReview.marketingWordCount,
      characterCount: correctedReview.marketingCharacterCount,
    });
    return restoreLogoIfMissing(corrected, correctedReview);
  }

  throw new Error("Generated image text exceeded the safe headline limit.");
};

/**
 * Gemini 3 image models default to 1K. Prefer production-quality 2K for the
 * premium/standard tiers; Lite only supports 1K.
 *
 * Size must live under `imageConfig.imageSize` as the string tokens
 * `"512" | "1K" | "2K" | "4K"`. The nested `responseFormat.image.imageSize`
 * field is a protobuf enum (`IMAGE_SIZE_*`) and rejects bare `"2K"`.
 */
const imageGenerationConfig = (
  modelId: string,
  params: GenerationParams,
  imageSizes?: Readonly<Record<string, "1K" | "2K" | "4K">>,
  imageAspectRatio?: ImageAspectRatio,
) => {
  if (imageAspectRatio && !isAllowedImageAspectRatio(imageAspectRatio)) {
    throw new Error(`Unsupported image aspect ratio: ${imageAspectRatio}`);
  }
  return {
    responseModalities: ["TEXT" as any, "IMAGE" as any],
    imageConfig: {
      imageSize:
        imageSizes?.[modelId] ?? (modelId === MODELS.image.emergency ? "1K" : "2K"),
      ...(imageAspectRatio ? { aspectRatio: imageAspectRatio } : {}),
    },
    ...params,
  };
};

const imageTaskForTier = (
  tier: ImageGenerationTier,
): "image_standard" | "image_studio" =>
  tier === "studio" ? "image_studio" : "image_standard";

export const generateFunSocialPostImage = async (
  originalImageBase64Url: string,
  dealershipName: string,
  logoBase64Url?: string,
  requestedStyle?: string, // Optional: specific style  name or 'random'
  imageTier: ImageGenerationTier = "standard",
  imageAspectRatio?: ImageAspectRatio,
): Promise<string> => {
  const requestAuthEpoch = captureAuthEpoch();
  const normalisedOriginal = await normaliseDataUrl(originalImageBase64Url);
  assertAuthEpoch(requestAuthEpoch);
  const { mimeType, data: base64Data } = parseDataUrl(normalisedOriginal);
  const originalImagePart = { inlineData: { mimeType, data: base64Data } };

  const logoImagePart = await optionalLogoImagePart(logoBase64Url);
  assertAuthEpoch(requestAuthEpoch);

  const funPrompt = generateFunPrompt(dealershipName, logoBase64Url, requestedStyle);

  const imageParts: any[] = [originalImagePart, { text: funPrompt }];
  if (logoImagePart) {
    imageParts.push(logoImagePart);
  }

  const generated = await generateImageWithFallback(
    imageTaskForTier(imageTier),
    imageParts,
    funPrompt,
    imageAspectRatio,
    requestAuthEpoch,
  );
  return (
    await enforceGeneratedImageTextCompliance({
      candidate: generated,
      dealershipName,
      logoImagePart,
      imageTier,
      imageAspectRatio,
      requestAuthEpoch,
      regenerationParts: imageParts,
      regenerationPrompt: funPrompt,
    })
  ).value;
};

export const editSocialPostImage = async (
  previousImageBase64Url: string,
  editPromptString: string,
  dealershipName: string,
  logoBase64Url?: string,
  imageTier: ImageGenerationTier = "standard",
  imageAspectRatio?: ImageAspectRatio,
): Promise<string> => {
  const requestAuthEpoch = captureAuthEpoch();
  const normalisedPrevious = await normaliseDataUrl(previousImageBase64Url);
  assertAuthEpoch(requestAuthEpoch);
  const { mimeType, data: base64Data } = parseDataUrl(normalisedPrevious);
  const previousImagePart = { inlineData: { mimeType, data: base64Data } };

  const logoImagePart = await optionalLogoImagePart(logoBase64Url);
  assertAuthEpoch(requestAuthEpoch);

  const editInstruction = editImagePrompt(
    editPromptString,
    dealershipName,
    logoBase64Url,
  );

  const imageParts: any[] = [previousImagePart, { text: editInstruction }];
  if (logoImagePart) {
    imageParts.push(logoImagePart);
  }

  const generated = await generateImageWithFallback(
    imageTaskForTier(imageTier),
    imageParts,
    editInstruction,
    imageAspectRatio,
    requestAuthEpoch,
  );
  return (
    await enforceGeneratedImageTextCompliance({
      candidate: generated,
      dealershipName,
      logoImagePart,
      imageTier,
      imageAspectRatio,
      requestAuthEpoch,
      regenerationParts: imageParts,
      regenerationPrompt: editInstruction,
    })
  ).value;
};

export const generateSocialPostTextDetailed = async (
  imageBase64Url: string,
  tone: ToneOption,
  dealershipName: string,
  customerName?: string,
  isRegeneration = false,
  creativeBrief?: string,
  style?: StyleOption,
): Promise<CaptionGenerationResult> => {
  const requestAuthEpoch = captureAuthEpoch();
  const normalisedImage = await normaliseDataUrl(imageBase64Url);
  assertAuthEpoch(requestAuthEpoch);
  const { mimeType, data: base64Data } = parseDataUrl(normalisedImage);
  const imagePart = { inlineData: { mimeType, data: base64Data } };
  const textPrompt = generateTextPrompt(
    tone,
    dealershipName,
    customerName,
    isRegeneration,
    creativeBrief,
    style,
  );

  const task: "caption" | "caption_regenerate" = isRegeneration
    ? "caption_regenerate"
    : "caption";
  const taskConfig = TASKS[task];
  const attemptId = createGenerationAttemptId();

  // Cache key — never cache regenerations (the whole point is variation).
  // Hash the FULL image bytes, not just the first 256 base64 chars: two photos
  // from the same camera share a long JPEG/EXIF prefix, so a 256-char key
  // collides and could serve one customer's caption for another's vehicle.
  const cacheKey =
    !isRegeneration && FLAGS.enableResponseCache
      ? `caption:v2:${await hashString(textPrompt + ":" + base64Data)}`
      : null;
  assertAuthEpoch(requestAuthEpoch);
  if (cacheKey) {
    const cached = requestCache.get<CaptionGenerationResult>(cacheKey);
    if (cached) {
      lastExecutionByTask.set(task, cached.aiMeta);
      if (cached.aiMeta.lastSuccessAt) {
        lastSuccessfulAtByTask.set(task, cached.aiMeta.lastSuccessAt);
      }
      return {
        ...cached,
        aiMeta: { ...cached.aiMeta, attemptId: undefined },
      };
    }
  }

  const runOnGemini = () =>
    withFallbackChain(task, attemptId, async (modelId) => {
      assertAuthEpoch(requestAuthEpoch);
      const client = getGeminiClient();
      const response = await client.models.generateContent({
        model: modelId,
        task,
        attemptId,
        contents: { parts: [imagePart, { text: textPrompt }] },
        generationConfig: taskConfig.params,
        requestAuthEpoch,
      } as any);
      assertAuthEpoch(requestAuthEpoch);
      let rawText = "";
      try {
        rawText = typeof response.text === "function" ? response.text() : "";
      } catch {
        throw new Error("Failed to extract text from AI response.");
      }
      const cleaned = cleanGeneratedText(rawText);
      const qualityChecked = ensureUsableCaption(cleaned, {
        storeName: dealershipName,
        customerName,
      });
      if (qualityChecked.usedFallback) {
        throw new Error("AI caption blocked by quality gate");
      }
      return qualityChecked.caption;
    });

  let text = "";
  let captionSource: CaptionGenerationResult["captionSource"] = "ai";
  let aiMeta: ModelExecutionMetadata | null = null;
  let fallbackCount = 0;
  let fallbackReason: "provider_error" | "quality_gate" = "provider_error";
  try {
    const generated = await runOnGemini();
    text = generated.value;
    aiMeta = generated.aiMeta;
    fallbackCount = generated.aiMeta.fallbackCount;
  } catch (err) {
    fallbackCount = attemptedModelsFromError(err);
    fallbackReason =
      err instanceof Error && err.message.toLowerCase().includes("quality gate")
        ? "quality_gate"
        : "provider_error";
    if (shouldFallbackToClaude(err) && taskConfig.claudeFallback) {
      console.warn(
        "[generateSocialPostText] Gemini exhausted; falling back to Claude",
        err,
      );
      try {
        // Claude doesn't see the image, so include a one-liner that frames it.
        const claudePrompt = `${textPrompt}\n\n(Note: image was not transmitted to fallback model. Use the creative brief above to infer scene; do not invent specific visual details you cannot verify.)`;
        text = cleanGeneratedText(
          await generateTextViaClaude(claudePrompt, {
            task,
            attemptId,
            model: taskConfig.claudeFallback,
            temperature: taskConfig.claudeTemperature,
            maxTokens: taskConfig.params.maxOutputTokens,
            requestAuthEpoch,
          }),
        );
        assertAuthEpoch(requestAuthEpoch);
        aiMeta = recordExecution(
          task,
          "anthropic",
          taskConfig.claudeFallback,
          fallbackCount,
          true,
          attemptId,
        );
      } catch (claudeErr) {
        console.warn(
          "[generateSocialPostText] Claude fallback failed; using safe template",
          claudeErr,
        );
        fallbackCount += 1;
        text = "";
      }
    } else {
      console.warn(
        "[generateSocialPostText] Gemini failed; using safe template caption",
        err,
      );
      text = "";
    }
  }

  // Quality gate: if the model returned empty/gibberish/labels, ship a clean
  // template post instead of failing the whole generate for the salesperson.
  const usable = ensureUsableCaption(text, {
    storeName: dealershipName,
    customerName,
  });
  text = usable.caption;
  if (usable.usedFallback) {
    captionSource = "basic_fallback";
    aiMeta = recordExecution(
      task,
      "basic_fallback",
      null,
      aiMeta ? aiMeta.fallbackCount + 1 : fallbackCount,
      false,
      attemptId,
    );
    console.warn(
      "[generateSocialPostText] Low-quality/empty model caption replaced with safe template",
    );
    logTelemetry("caption.fallback.basic", {
      task,
      tier: taskConfig.tier,
      fallbackCount: aiMeta.fallbackCount,
      reason: fallbackReason,
    });
  }

  if (!text) {
    // ensureUsableCaption always returns a template when given a store name —
    // this is a last-ditch guard.
    text = ensureUsableCaption("", {
      storeName: dealershipName || "our dealership",
      customerName,
    }).caption;
    captionSource = "basic_fallback";
    aiMeta = recordExecution(
      task,
      "basic_fallback",
      null,
      fallbackCount,
      false,
      attemptId,
    );
  }
  const result: CaptionGenerationResult = {
    text,
    captionSource,
    aiMeta:
      aiMeta ??
      recordExecution(task, "basic_fallback", null, fallbackCount, false, attemptId),
  };
  if (cacheKey) {
    // 5 minute cache — captions are pretty hot when iterating styles.
    requestCache.set(cacheKey, result, 5 * 60 * 1000);
  }
  return result;
};

export const generateSocialPostText = async (
  ...args: Parameters<typeof generateSocialPostTextDetailed>
): Promise<string> => (await generateSocialPostTextDetailed(...args)).text;

/**
 * Raw structured-copy helper for the private Customer Hub draft. This uses the
 * existing caption model chain and authenticated server proxy, but deliberately
 * skips social-caption cleanup because the caller validates a strict JSON
 * object and owns a deterministic fallback.
 */
export const generateWebsiteDraftMetadata = async (
  imageBase64Url: string,
  prompt: string,
): Promise<string> => {
  const requestAuthEpoch = captureAuthEpoch();
  const normalisedImage = await normaliseDataUrl(imageBase64Url);
  assertAuthEpoch(requestAuthEpoch);
  const { mimeType, data: base64Data } = parseDataUrl(normalisedImage);
  const imagePart = { inlineData: { mimeType, data: base64Data } };
  const task = "caption_regenerate" as const;
  const attemptId = createGenerationAttemptId();
  const taskConfig = TASKS[task];

  const generated = await withFallbackChain(task, attemptId, async (modelId) => {
    assertAuthEpoch(requestAuthEpoch);
    const client = getGeminiClient();
    const response = await client.models.generateContent({
      model: modelId,
      task,
      attemptId,
      contents: { parts: [imagePart, { text: prompt }] },
      generationConfig: taskConfig.params,
      requestAuthEpoch,
    } as any);
    assertAuthEpoch(requestAuthEpoch);
    const rawText = typeof response.text === "function" ? response.text() : "";
    if (!rawText.trim()) throw new Error("Website draft AI returned no metadata.");
    return rawText.trim();
  });

  return generated.value;
};

export const editSocialPostTextDetailed = async (
  originalText: string,
  editPromptString: string,
  tone: ToneOption,
): Promise<CaptionGenerationResult> => {
  const requestAuthEpoch = captureAuthEpoch();
  assertAuthEpoch(requestAuthEpoch);
  const prompt = editTextPrompt(originalText, editPromptString, tone);
  const taskConfig = TASKS["caption_edit"];
  const attemptId = createGenerationAttemptId();

  const runOnGemini = () =>
    withFallbackChain("caption_edit", attemptId, async (modelId) => {
      assertAuthEpoch(requestAuthEpoch);
      const client = getGeminiClient();
      const response = await client.models.generateContent({
        model: modelId,
        task: "caption_edit",
        attemptId,
        contents: { parts: [{ text: prompt }] },
        generationConfig: taskConfig.params,
        requestAuthEpoch,
      } as any);
      assertAuthEpoch(requestAuthEpoch);
      let rawText = "";
      try {
        rawText = typeof response.text === "function" ? response.text() : "";
      } catch {
        throw new Error("Failed to extract text from AI response.");
      }
      const cleaned = cleanGeneratedText(rawText);
      if (!cleaned) {
        throw new Error("AI caption edit blocked by quality gate");
      }
      const comparable = (value: string) =>
        cleanGeneratedText(value).replace(/\s+/g, " ").trim().toLocaleLowerCase();
      if (comparable(cleaned) === comparable(originalText)) {
        throw new Error("AI returned the caption without applying the requested edit");
      }
      return cleaned;
    });

  let text = "";
  let aiMeta: ModelExecutionMetadata | null = null;
  try {
    const generated = await runOnGemini();
    text = generated.value;
    aiMeta = generated.aiMeta;
  } catch (err) {
    if (shouldFallbackToClaude(err) && taskConfig.claudeFallback) {
      console.warn(
        "[editSocialPostText] Gemini exhausted; falling back to Claude",
        err,
      );
      text = cleanGeneratedText(
        await generateTextViaClaude(prompt, {
          task: "caption_edit",
          attemptId,
          model: taskConfig.claudeFallback,
          temperature: taskConfig.claudeTemperature,
          maxTokens: taskConfig.params.maxOutputTokens,
          requestAuthEpoch,
        }),
      );
      assertAuthEpoch(requestAuthEpoch);
      if (
        text.replace(/\s+/g, " ").trim().toLocaleLowerCase() ===
        cleanGeneratedText(originalText).replace(/\s+/g, " ").trim().toLocaleLowerCase()
      ) {
        throw new Error("AI returned the caption without applying the requested edit");
      }
      aiMeta = recordExecution(
        "caption_edit",
        "anthropic",
        taskConfig.claudeFallback,
        attemptedModelsFromError(err),
        true,
        attemptId,
      );
    } else {
      throw err;
    }
  }

  if (!text) {
    throw new Error("Failed to edit post text with AI.");
  }
  return {
    text,
    captionSource: "ai",
    aiMeta:
      aiMeta ??
      recordExecution("caption_edit", "basic_fallback", null, 0, false, attemptId),
  };
};

export const editSocialPostText = async (
  ...args: Parameters<typeof editSocialPostTextDetailed>
): Promise<string> => (await editSocialPostTextDetailed(...args)).text;

export const generateSocialPost = async (
  imageBase64Url: string,
  style: StyleOption,
  tone: ToneOption,
  dealershipName: string,
  customerName?: string,
  logoBase64Url?: string,
  initialText?: string,
  creativeBrief?: string,
  imageTier: ImageGenerationTier = "standard",
  imageAspectRatio?: ImageAspectRatio,
): Promise<SocialPostGenerationResult> => {
  const requestAuthEpoch = captureAuthEpoch();
  const normalisedImage = await normaliseDataUrl(imageBase64Url);
  assertAuthEpoch(requestAuthEpoch);
  const { mimeType, data: base64Data } = parseDataUrl(normalisedImage);

  const imagePart = {
    inlineData: {
      mimeType,
      data: base64Data,
    },
  };

  const logoImagePart = await optionalLogoImagePart(logoBase64Url);
  assertAuthEpoch(requestAuthEpoch);

  // Generate text (or use provided template/custom text) and the final image in parallel.
  const textPromise: Promise<CaptionGenerationResult> = (
    initialText
      ? Promise.resolve({
          text: initialText,
          captionSource: "custom" as const,
          aiMeta: recordExecution("caption", "custom", null, 0, false),
        })
      : generateSocialPostTextDetailed(
          imageBase64Url,
          tone,
          dealershipName,
          customerName,
          false,
          creativeBrief,
          style,
        )
  ).catch((error) => {
    throw new Error(
      `Failed to generate text content: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  });

  const imagePrompt = generateImagePrompt(
    style,
    dealershipName,
    !!logoImagePart,
    initialText,
    creativeBrief,
  );
  const imageParts: (typeof imagePart | { text: string })[] = [
    imagePart,
    { text: imagePrompt },
  ];
  if (logoImagePart) {
    imageParts.push(logoImagePart);
  }

  // Image ladder → OpenAI → original photo. Never hard-fail a delivery post
  // just because the retoucher model blocked/recited the image.
  const imagePromise = (async () => {
    try {
      const generated = await generateImageWithFallback(
        imageTaskForTier(imageTier),
        imageParts,
        imagePrompt,
        imageAspectRatio,
        requestAuthEpoch,
      );
      return await enforceGeneratedImageTextCompliance({
        candidate: generated,
        dealershipName,
        logoImagePart,
        imageTier,
        imageAspectRatio,
        requestAuthEpoch,
        regenerationParts: imageParts,
        regenerationPrompt: imagePrompt,
      });
    } catch (err) {
      console.warn(
        "[generateSocialPost] AI image failed; shipping original photo with caption",
        err,
      );
      const task = imageTaskForTier(imageTier);
      // Error level on purpose: only error events are beaconed to
      // /api/telemetry, and this is the one signal that means the product
      // silently did nothing to a salesperson's photo. As an info event it
      // never left the browser, so a months-long degradation was invisible
      // from the server. `task` and `fallbackCount` are on the server-side
      // payload allowlist; `reason` is kept for the local buffer and dropped
      // server-side, so no error text is persisted.
      logImageDegraded("image.fallback.original", {
        task,
        fallbackCount: attemptedModelsFromError(err),
        reason: err instanceof Error ? err.message : String(err),
      });
      return {
        value: normalisedImage,
        aiMeta: recordExecution(
          task,
          "original",
          null,
          attemptedModelsFromError(err),
          false,
          attemptIdFromError(err),
        ),
      };
    }
  })();

  const [textResult, imageResult] = await Promise.all([textPromise, imagePromise]);
  assertAuthEpoch(requestAuthEpoch);

  if (!textResult.text) {
    throw new Error("Failed to generate social post caption.");
  }

  return {
    image: imageResult.value || normalisedImage,
    text: textResult.text,
    captionSource: textResult.captionSource,
    aiMeta: {
      captionSource: textResult.captionSource,
      selectedTier: imageTier,
      ...(textResult.aiMeta.model ? { model: textResult.aiMeta.model } : {}),
      fallbackCount: textResult.aiMeta.fallbackCount + imageResult.aiMeta.fallbackCount,
      ...(latestSuccessfulGenerationAt(textResult.aiMeta, imageResult.aiMeta)
        ? {
            lastSuccessfulGenerationAt: latestSuccessfulGenerationAt(
              textResult.aiMeta,
              imageResult.aiMeta,
            ),
          }
        : {}),
      modelPolicyVersion: MODEL_POLICY_VERSION,
      caption: textResult.aiMeta,
      image: imageResult.aiMeta,
    },
  };
};

const getImageDimensions = (
  dataUrl: string,
): Promise<{ width: number; height: number }> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.width, height: img.height });
    };
    img.onerror = () => {
      reject(new Error("Could not load image to determine dimensions."));
    };
    img.src = dataUrl;
  });
};

/** True if bytes look like an MP4/QuickTime container (ftyp box). */
const looksLikeMp4 = (bytes: Uint8Array): boolean => {
  if (bytes.length < 12) return false;
  // ISO BMFF: size(4) + 'ftyp'(4) at offset 4
  return (
    bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70
  );
};

const VIDEO_DOWNLOAD_RETRY_DELAYS_MS = [400, 1_000] as const;
const isRetryableVideoDownloadStatus = (status: number): boolean =>
  status === 408 ||
  status === 425 ||
  status === 429 ||
  status === 500 ||
  status === 502 ||
  status === 503 ||
  status === 504;

/** Read a small Blob slice across modern browsers and jsdom's legacy Blob. */
const readBlobSlice = async (blob: Blob): Promise<Uint8Array> => {
  if (typeof blob.arrayBuffer === "function") {
    return new Uint8Array(await blob.arrayBuffer());
  }
  if (typeof FileReader !== "undefined") {
    const result = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) {
          resolve(reader.result);
        } else {
          reject(new Error("Video header could not be read."));
        }
      };
      reader.onerror = () =>
        reject(reader.error || new Error("Video header could not be read."));
      reader.readAsArrayBuffer(blob);
    });
    return new Uint8Array(result);
  }
  throw new Error("Video header could not be read.");
};

/**
 * Fetches video content from a Google API URL through our proxy
 * This is needed because the video URI requires API key authentication
 */
export const fetchVideoThroughProxy = async (
  videoUri: string,
  requestAuthEpoch: number,
): Promise<string> => {
  const normalizedUri = videoUri.trim();
  if (normalizedUri.startsWith("blob:")) {
    return normalizedUri;
  }
  if (normalizedUri.startsWith("data:")) {
    assertAuthEpoch(requestAuthEpoch);
    return createVideoBlobUrl(normalizedUri);
  }

  try {
    const parsed = new URL(normalizedUri);
    if (parsed.origin !== "https://generativelanguage.googleapis.com") {
      throw new Error("Video download origin is not trusted.");
    }
    // Veo has returned both the canonical :download URI and the base File URI.
    // Convert either trusted shape to the single internal path authorized by
    // the provider-resource ledger. Do not forward provider query credentials.
    const fileMatch = parsed.pathname.match(
      /^\/v1beta\/files\/([a-z0-9._~-]+)(?::download)?$/i,
    );
    if (!fileMatch) {
      throw new Error("Video download path is not trusted.");
    }
    const proxyPath = `v1beta/files/${fileMatch[1]}:download?alt=media`;

    let response: Response | null = null;
    let lastTransportError: unknown = null;
    for (
      let attempt = 0;
      attempt <= VIDEO_DOWNLOAD_RETRY_DELAYS_MS.length;
      attempt += 1
    ) {
      assertAuthEpoch(requestAuthEpoch);
      try {
        response = await fetch(`/api/proxy/${proxyPath}`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          headers: {
            Accept: "video/mp4, application/octet-stream;q=0.9",
          },
        });
        lastTransportError = null;
      } catch (error) {
        lastTransportError = error;
        response = null;
      }

      const retryable =
        (!response && lastTransportError != null) ||
        (response != null && isRetryableVideoDownloadStatus(response.status));
      if (!retryable || attempt >= VIDEO_DOWNLOAD_RETRY_DELAYS_MS.length) {
        break;
      }

      // Video downloads are read-only and idempotent. A short bounded retry can
      // recover from a transient proxy/Fly handoff without starting a second
      // billable Veo job.
      if (response) {
        await response.body?.cancel().catch(() => undefined);
      }
      await sleep(VIDEO_DOWNLOAD_RETRY_DELAYS_MS[attempt]);
      assertAuthEpoch(requestAuthEpoch);
    }

    if (!response) {
      throw new Error(
        `Video proxy could not be reached${
          lastTransportError instanceof Error && lastTransportError.message
            ? `: ${lastTransportError.message}`
            : ""
        }.`,
      );
    }

    if (!response.ok) {
      if (response.status === 401) notifySessionRejected(requestAuthEpoch);
      const errText = await response.text().catch(() => "");
      if (response.status === 404 || response.status === 410) {
        throw new Error(
          "Video proxy reports that the generated video is no longer available. Generate the video again; the app will not substitute a still image.",
        );
      }
      throw new Error(
        `Video proxy returned ${response.status}${errText ? `: ${errText.slice(0, 160)}` : ""}.`,
      );
    }

    const rawBlob = await response.blob();
    assertAuthEpoch(requestAuthEpoch);
    if (rawBlob.size === 0) {
      throw new Error("Video proxy returned empty media.");
    }

    if (rawBlob.size < 32 || typeof rawBlob.slice !== "function") {
      throw new Error("Video proxy returned invalid MP4 media.");
    }

    // Inspect only the ISO-BMFF header. Reading the full 720p/1080p Blob into a
    // Uint8Array doubles peak memory and can terminate a mobile Safari PWA.
    const headBlob = rawBlob.slice(0, 16);
    const head = await readBlobSlice(headBlob);
    assertAuthEpoch(requestAuthEpoch);
    if (!looksLikeMp4(head)) {
      // Never relabel arbitrary 200 responses as MP4. Provider gateways can
      // return HTML/JSON/plain-text failures with an octet-stream MIME.
      throw new Error("Video proxy returned invalid MP4 media.");
    }

    // Blob.slice can safely apply the playable MIME without copying video
    // bytes into JavaScript memory. Preserve a correct MP4 Blob unchanged.
    const typed =
      rawBlob.type.toLowerCase() === "video/mp4"
        ? rawBlob
        : rawBlob.slice(0, rawBlob.size, "video/mp4");
    assertAuthEpoch(requestAuthEpoch);
    return URL.createObjectURL(typed);
  } catch (error) {
    console.error("[VideoGen] Secure video download failed.", error);
    throw new Error(
      error instanceof Error
        ? error.message
        : "Generated video could not be downloaded securely.",
    );
  }
};

const providerVideoUri = (value: any): string | null => {
  if (!value || typeof value !== "object") return null;
  const candidate =
    value.downloadUri ||
    value.download_uri ||
    value.fileUri ||
    value.file_uri ||
    value.videoUri ||
    value.video_uri ||
    value.uri;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
};

export const generatePostVideo = async (
  imageBase64Url: string,
  style: VideoStyle,
  options: VideoRequestOptions,
  signal?: AbortSignal,
): Promise<string> => {
  const requestAuthEpoch = captureAuthEpoch();
  const videoTask: "video_standard" | "video_quality" =
    options.resolution === "1080p" ? "video_quality" : "video_standard";
  const videoModels = getFallbackChain(videoTask);
  const resolvedResolution = TASKS[videoTask].resolution ?? "720p";

  const normalisedImage = await normaliseDataUrl(imageBase64Url);
  assertAuthEpoch(requestAuthEpoch);

  // Resolve final Veo params FIRST so the prompt matches the wire body.
  // Veo 3.1 accepts only 16:9 | 9:16 and duration 4 | 6 | 8 (1080p → 8s).
  const { width, height } = await getImageDimensions(normalisedImage);
  assertAuthEpoch(requestAuthEpoch);
  const aspectRatio = resolveVeoAspect(
    width,
    height,
    options.aspectPreference || "auto",
  );
  const requestedDuration = options.durationSeconds || 6;
  let durationSeconds = requestedDuration <= 5 ? 4 : requestedDuration <= 7 ? 6 : 8;
  if (resolvedResolution === "1080p") durationSeconds = 8;

  // Letterbox so Veo never has to invent crop margins (root cause of morph/
  // second-car frames when a square branded post is forced into 9:16).
  const letterboxed = await letterboxImageForVideo(normalisedImage, aspectRatio);
  assertAuthEpoch(requestAuthEpoch);
  const { mimeType, data: base64Data } = parseDataUrl(letterboxed);

  const prompt = generateVideoPrompt(style, {
    ...options,
    durationSeconds,
    aspectPreference: aspectRatio,
    resolution: resolvedResolution,
    pacing: options.pacing || "cinematic",
  });

  // Veo 3.x predictLongRunning expects image as { bytesBase64Encoded, mimeType }.
  // Gemini generateContent-style { inlineData: { data, mimeType } } returns 400
  // "inlineData isn't supported by this model".
  const body = {
    instances: [
      {
        prompt: prompt,
        image: {
          bytesBase64Encoded: base64Data,
          mimeType,
        },
      },
    ],
    parameters: {
      aspectRatio: aspectRatio,
      personGeneration: "allow_adult", // Required for image-to-video with people
      durationSeconds: durationSeconds,
      resolution: resolvedResolution,
    },
  };

  // Veo 3.1 bakes native audio from the prompt (no separate track upload).
  // When soundtrack !== none, the prompt requires score/ambience so the MP4
  // is not silent. Log for support when diagnosing "no sound" reports.
  console.log(
    `[VideoGen] Options: aspect=${aspectRatio} duration=${durationSeconds}s soundtrack=${options.soundtrack || "cinematic"}`,
  );

  let lastError: unknown = null;
  const generationAttemptId = createGenerationAttemptId();

  for (let modelIndex = 0; modelIndex < videoModels.length; modelIndex += 1) {
    const veoModel = videoModels[modelIndex];
    const finishVideo = (videoUrl: string): string => {
      recordExecution(
        videoTask,
        "gemini",
        veoModel,
        modelIndex,
        true,
        generationAttemptId,
      );
      return videoUrl;
    };
    if (signal?.aborted) {
      throw new DOMException("Video generation aborted", "AbortError");
    }

    console.log(`[VideoGen] Starting video generation with ${veoModel}.`);
    console.log(`[VideoGen] Config: ${durationSeconds}s, ${aspectRatio}`);

    // A Veo start is billable and non-idempotent. The generation-attempt
    // header is audit metadata; the proxy does not persist a mapping that can
    // recover and return the original operation. Consequently, there must be
    // no automatic retry after a transport/5xx/ambiguous success failure.
    const apiPath = `v1beta/models/${veoModel}:predictLongRunning`;
    let response: Response;
    try {
      assertAuthEpoch(requestAuthEpoch);
      response = await fetch(`/api/proxy/${apiPath}`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-Generation-Task": videoTask,
          "X-Model-Policy-Version": MODEL_POLICY_VERSION,
          "X-Generation-Attempt-ID": generationAttemptId,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }
      lastError = error;
      console.error(
        `[VideoGen] ${veoModel} start failed; not retrying an ambiguous request.`,
        normalizeError(error).message,
      );
      break;
    }

    if (!response.ok) {
      if (response.status === 401) notifySessionRejected(requestAuthEpoch);
      let text = "";
      try {
        text = await response.text();
      } catch (_error) {
        // The status is still useful even if its response body cannot be read.
      }
      lastError = new Error(
        `Video generation failed (${response.status}): ${
          text || response.statusText || "request rejected"
        }`,
      );
      console.error("[VideoGen] Request failed:", text || response.statusText);

      // A 404 proves the selected model endpoint did not start a job, so a
      // configured model fallback is safe. All other failures stop here:
      // notably, proxy 5xx responses can occur after an upstream acceptance
      // whose operation response was lost or could not be secured.
      if (response.status === 404 && modelIndex < videoModels.length - 1) {
        console.warn(
          `[VideoGen] ${veoModel} was not found; trying the next configured model.`,
        );
        continue;
      }
      break;
    }

    let json: any;
    try {
      json = await response.json();
      assertAuthEpoch(requestAuthEpoch);
    } catch (error) {
      lastError = error;
      console.error(
        "[VideoGen] Accepted start returned an unreadable response; not retrying.",
      );
      break;
    }
    console.log("[VideoGen] Generation request accepted.");

    // Once an operation name exists, never start a fallback job. The poller
    // owns transient retries for this one durable provider operation.
    const operationName = json?.name;
    if (operationName) {
      console.log("[VideoGen] Async operation started; polling.");
      return finishVideo(
        await pollGeminiVideoOperation(operationName, 360000, signal, requestAuthEpoch),
      ); // 6 minute timeout for Veo 3.1
    }

    // Check for immediate response (unlikely but handle it)
    if (json?.generatedVideos?.[0]) {
      return finishVideo(await extractVideoFromResponse(json, requestAuthEpoch));
    }

    // Try to extract video from response
    const candidates = json?.candidates;
    if (candidates && candidates.length > 0) {
      const parts = candidates[0]?.content?.parts;
      if (parts && parts.length > 0) {
        for (const part of parts) {
          // Check for inline video data
          if (part.inlineData?.mimeType?.startsWith("video/")) {
            console.log(`[VideoGen] Got inline video data`);
            return finishVideo(createVideoBlobUrl(part.inlineData.data));
          }
          // Check for a provider file/download URI
          const partFileUri = providerVideoUri(part.fileData);
          if (partFileUri) {
            return finishVideo(
              await fetchVideoThroughProxy(partFileUri, requestAuthEpoch),
            );
          }
          // Check for video URI directly
          const partVideoUri =
            providerVideoUri(part.videoMetadata) || providerVideoUri(part);
          if (partVideoUri) {
            return finishVideo(
              await fetchVideoThroughProxy(partVideoUri, requestAuthEpoch),
            );
          }
        }
      }
    }

    // Check for generatedVideos format
    if (json?.generatedVideos || json?.videos) {
      return finishVideo(await extractVideoFromResponse(json, requestAuthEpoch));
    }

    // Check predictions format (fallback)
    if (json?.predictions?.[0]) {
      return finishVideo(
        await extractVideoFromPrediction(json.predictions[0], requestAuthEpoch),
      );
    }

    lastError = new Error(
      "No video content found in response. The model may not support video generation with the current configuration.",
    );
    // A successful-but-unrecognized start response is ambiguous. Do not send
    // another billable start request.
    break;
  }

  const normalized = normalizeError(lastError);
  throw new Error(
    `Video generation did not start safely: ${normalized.message} ${recoveryHint(
      normalized,
    )} The start request was not retried to prevent a duplicate paid video job.`,
  );
};

/**
 * Polls a Gemini API async operation until it completes.
 *
 * `signal` (optional): pass an AbortSignal from the caller (e.g. a React
 * unmount cleanup) and the poll loop will throw out on next iteration instead
 * of running forever in the background.
 */
const pollGeminiVideoOperation = async (
  operationName: string,
  timeoutMs: number = 300000,
  signal?: AbortSignal,
  requestAuthEpoch: number = captureAuthEpoch(),
): Promise<string> => {
  const startTime = Date.now();
  let pollInterval = 5000;
  const maxPollInterval = 30000;

  // Clean up operation name - remove leading slashes
  let cleanOpName = operationName.replace(/^\/+/, "");

  while (Date.now() - startTime < timeoutMs) {
    if (signal?.aborted) {
      throw new DOMException("Video polling aborted", "AbortError");
    }
    try {
      // The operation name format is "models/{model}/operations/{opId}"
      // We need to poll at v1beta/{operationName}
      let pollPath: string;

      if (cleanOpName.startsWith("models/")) {
        // New format: models/veo-3.1-generate-preview/operations/xxx
        pollPath = `v1beta/${cleanOpName}`;
      } else if (cleanOpName.startsWith("operations/")) {
        // Old format: operations/xxx
        pollPath = `v1beta/${cleanOpName}`;
      } else {
        // Bare operation ID
        pollPath = `v1beta/operations/${cleanOpName}`;
      }

      console.log("[VideoGen] Polling video operation.");

      assertAuthEpoch(requestAuthEpoch);
      const response = await fetch(`/api/proxy/${pollPath}`, {
        method: "GET",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        if (response.status === 401) notifySessionRejected(requestAuthEpoch);
        const text = await response.text();
        console.error(`[VideoGen] Poll failed:`, text);
        await sleep(pollInterval);
        pollInterval = Math.min(pollInterval * 1.5, maxPollInterval);
        continue;
      }

      const rawOperation = await response.json();
      assertAuthEpoch(requestAuthEpoch);
      const operation = GeminiVideoOperationSchema.parse(rawOperation);

      console.log(`[VideoGen] Operation done: ${operation.done === true}`);

      if (operation.done === true) {
        if (operation.error) {
          throw new Error(
            `Video generation failed: ${
              operation.error.message || JSON.stringify(operation.error)
            }`,
          );
        }

        if (operation.response) {
          // Try to extract video from the response
          const resp = operation.response;
          // Check generateVideoResponse format (from predictLongRunning) - OFFICIAL FORMAT
          const officialVideoUri = providerVideoUri(
            resp.generateVideoResponse?.generatedSamples?.[0]?.video,
          );
          if (officialVideoUri) {
            // Download video through proxy to handle auth
            return await fetchVideoThroughProxy(officialVideoUri, requestAuthEpoch);
          }

          // Alternative format: direct generatedSamples
          const generatedSampleUri = providerVideoUri(
            resp.generatedSamples?.[0]?.video,
          );
          if (generatedSampleUri) {
            return await fetchVideoThroughProxy(generatedSampleUri, requestAuthEpoch);
          }

          // Check candidates
          if (resp.candidates?.[0]?.content?.parts) {
            for (const part of resp.candidates[0].content.parts) {
              if (part.inlineData?.data) {
                return createVideoBlobUrl(part.inlineData.data);
              }
              const partFileUri = providerVideoUri(part.fileData);
              if (partFileUri) {
                return await fetchVideoThroughProxy(partFileUri, requestAuthEpoch);
              }
            }
          }

          // Check generatedVideos
          if (resp.generatedVideos) {
            return extractVideoFromResponse(resp, requestAuthEpoch);
          }
        }

        throw new Error("Operation completed but no video found in response.");
      }

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(
        `[VideoGen] Still processing... (${elapsed}s elapsed). Next poll in ${pollInterval / 1000}s`,
      );
      await sleep(pollInterval);
      pollInterval = Math.min(pollInterval * 1.5, maxPollInterval);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }
      if (error instanceof Error) {
        const msg = error.message;
        // Terminal failures — do not spin until the 6-minute poll timeout.
        if (
          msg.includes("Video generation failed:") ||
          msg.includes("Video proxy") ||
          msg.includes("could not be downloaded") ||
          msg.includes("non-video") ||
          msg.includes("error payload") ||
          msg.includes("empty media") ||
          msg.includes("too small") ||
          msg.includes("not trusted") ||
          msg.includes("Operation completed but no video")
        ) {
          throw error;
        }
      }
      console.error(
        `[VideoGen] Poll error (will retry in ${pollInterval / 1000}s):`,
        error,
      );
      await sleep(pollInterval);
      pollInterval = Math.min(pollInterval * 1.5, maxPollInterval);
    }
  }

  throw new Error(`Video generation timed out after ${timeoutMs / 1000} seconds.`);
};

/**
 * Extracts video URL or blob from a Veo response
 */
const extractVideoFromResponse = async (
  response: any,
  requestAuthEpoch: number,
): Promise<string> => {
  // Check for generated videos array (common Veo response format)
  const generatedVideos = response?.generatedVideos || response?.videos;
  if (generatedVideos && generatedVideos.length > 0) {
    const video = generatedVideos[0];

    // Check for video URI
    const uri = providerVideoUri(video?.video) || providerVideoUri(video);
    if (uri) {
      return await fetchVideoThroughProxy(uri, requestAuthEpoch);
    }

    // Check for base64 video data
    const base64Data = video?.video?.bytesBase64Encoded || video?.bytesBase64Encoded;
    if (base64Data) {
      return createVideoBlobUrl(base64Data);
    }
  }

  // Check for predictions format
  if (response?.predictions) {
    return await extractVideoFromPrediction(response.predictions[0], requestAuthEpoch);
  }

  throw new Error("Could not extract video from response.");
};

/**
 * Extracts video from a prediction object
 */
const extractVideoFromPrediction = async (
  prediction: any,
  requestAuthEpoch: number,
): Promise<string> => {
  if (!prediction) {
    throw new Error("No prediction data available.");
  }

  const base64Video =
    prediction.byteStream ||
    prediction.byteContent ||
    prediction.bytesBase64Encoded ||
    prediction.videoBytes ||
    prediction.video?.bytesBase64Encoded;

  if (base64Video) {
    return createVideoBlobUrl(base64Video);
  }

  const uri =
    providerVideoUri(prediction.video) ||
    providerVideoUri(prediction) ||
    (typeof prediction.outputUri === "string" ? prediction.outputUri : null) ||
    (typeof prediction.mediaUri === "string" ? prediction.mediaUri : null);

  if (uri) {
    return await fetchVideoThroughProxy(uri, requestAuthEpoch);
  }

  throw new Error("No video content found in prediction.");
};

/**
 * Creates a blob URL from base64 video data
 */
export const createVideoBlobUrl = (base64Data: string): string => {
  // Strip data-URL prefix if the model returned a full data URI
  const pure = base64Data.includes(",")
    ? base64Data.slice(base64Data.indexOf(",") + 1)
    : base64Data;
  console.log(`[VideoGen] Creating blob from base64 data (${pure.length} chars)`);
  const bytes = atob(pure);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  if (arr.byteLength < 32 || !looksLikeMp4(arr.subarray(0, 16))) {
    throw new Error("Generated video data is not valid MP4 media.");
  }
  const blob = new Blob([arr], { type: "video/mp4" });
  if (blob.size < 1000) {
    throw new Error("Generated video data was too small to be valid.");
  }
  return URL.createObjectURL(blob);
};
