import {
  dataUrlToBlob,
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
  type LogoCornerCheck,
  type LogoPlacement,
} from "../types";
import {
  generateImagePrompt,
  generateTextPrompt,
  generateFunPrompt,
  editImagePrompt,
  editTextPrompt,
  funStyleCatalog,
  generateVideoPrompt,
} from "./promptConfig";
import { generateVideoNegativePrompt } from "./promptsV2";
import { classifyCreativeBrief } from "./creativeSkills";
import {
  logoCornerCheck,
  logoPlacementWording,
  readObservedLogoCorner,
  storeLogoPlacement,
} from "./logoPlacement";
import {
  createBlockedContentError,
  isBlockedContentError,
  isOutdatedClientError,
  normalizeError,
  recoveryHint,
  type NormalizedError,
} from "../utils/errorHandler";
import { getGeminiClient } from "./geminiClient";
import {
  isProxyValidationRejection,
  isIndeterminateGenerationError,
  outdatedClientErrorFromResponse,
  type GenerationPurpose,
} from "./geminiProxy";
import { proxyCapabilities } from "./proxyCapabilities";
import { createGenerationBudget } from "./generationBudget";
import { GeminiVideoOperationSchema, resolveVeoVideoOutcome } from "../utils/schemas";
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
  MODEL_POLICY,
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
import {
  claudeAcceptsImage,
  generateTextViaClaude,
  shouldFallbackToClaude,
} from "./claudeAdapter";
import { generateImageViaOpenAI, shouldFallbackToOpenAI } from "./openaiAdapter";
import { requestCache } from "../utils/requestCache";
import {
  logEvent as logTelemetry,
  logError as logImageDegraded,
} from "../utils/telemetry";
import { cleanSocialCaption, ensureUsableCaption } from "../utils/captionQuality";
import { toPublicCustomerLabel } from "../utils/customerIdentity";
import { activeSalespersonPhrases } from "../utils/identityContext";
import { z } from "zod";
import {
  deliveryLanguageAllowedForBrief,
  editTextPromptPartsV2,
  editTextPromptV2,
  generateTextPromptPartsV2,
  generateTextPromptV2,
  isSafeOnImageHeadline,
  ON_IMAGE_TEXT_BUDGET,
  type PromptTurn,
} from "./promptsV2";

/**
 * Transport for a text prompt: `{ parts: [...] }` for the Gemini
 * `systemInstruction` field, or `undefined` when the prompt is a single turn.
 */
const systemInstructionPart = (turn: PromptTurn) =>
  turn.systemInstruction.trim()
    ? { parts: [{ text: turn.systemInstruction }] }
    : undefined;

/**
 * Decide whether the routed prompt (`promptConfig` picks V2 or the legacy
 * prompt behind `FLAGS.useV2Prompts`) is the V2 one, and if so send its
 * static rules as a `systemInstruction` instead of concatenating them into
 * the user turn.
 *
 * The routing rule itself is not duplicated here: the flattened V2 rendering
 * is compared against what the router actually returned. When they match, the
 * split form carries byte-identical guidance; when the router chose the legacy
 * prompt, it is sent unchanged as a single user turn.
 */
const splitRoutedPrompt = (
  routedPrompt: string,
  flattenedV2Prompt: string,
  splitV2Prompt: () => PromptTurn,
): PromptTurn =>
  routedPrompt === flattenedV2Prompt
    ? splitV2Prompt()
    : { systemInstruction: "", userPrompt: routedPrompt };

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

const isAbortError = (error: unknown): boolean =>
  error !== null &&
  typeof error === "object" &&
  "name" in error &&
  error.name === "AbortError";

/**
 * Ids in the server's response-schema registry
 * (`GEMINI_RESPONSE_SCHEMAS` in pb_hooks/requestPolicies.js, listed as
 * `responseSchemaIds` in config/gemini-model-policy.json). The browser sends
 * only the id; the proxy swaps it for the real `responseJsonSchema`, so no
 * schema body ever travels from an untrusted client. This app no longer sends
 * `captionPack` (one caption ships to every channel); the server keeps that
 * schema for installed copies of older builds.
 */
export const RESPONSE_SCHEMA_IDS = {
  visionReview: "vision_review_v1",
  captionPack: "caption_pack_v1",
  websiteDraft: "website_draft_v1",
} as const;

export type ResponseSchemaId =
  (typeof RESPONSE_SCHEMA_IDS)[keyof typeof RESPONSE_SCHEMA_IDS];

/**
 * Structured JSON output is a capability of the deployed proxy, not of the
 * browser. A server that predates the schema registry sees `responseMimeType`
 * and `schemaId` as unknown generationConfig keys and refuses the whole
 * request with a 400. The first such refusal latches structured output off
 * for the session and every later call runs in prose mode — which is exactly
 * why the heuristic JSON recovery in the parsers is kept rather than deleted.
 */
let structuredJsonSupported = true;

/** Test seam: reset the per-session structured-output latch. */
export const resetStructuredJsonSupport = (): void => {
  structuredJsonSupported = true;
};

const isStructuredTransportRejection = (error: unknown): boolean => {
  if (isAbortError(error) || isBlockedContentError(error)) return false;
  if (isOutdatedClientError(error)) return false;
  if (normalizeError(error).kind === "validation") return true;
  return /\berror 400\b/i.test(
    error instanceof Error ? error.message : String(error ?? ""),
  );
};

/**
 * Run one model attempt asking for schema-bound JSON, retrying the identical
 * request without the structured fields when the proxy rejects them. The
 * retry stays inside the caller's fallback-chain attempt so it is not counted
 * as a model failure.
 */
const withStructuredJson = async <T>(
  schemaId: ResponseSchemaId,
  params: GenerationParams,
  attempt: (generationConfig: Record<string, unknown>) => Promise<T>,
): Promise<T> => {
  if (structuredJsonSupported) {
    try {
      return await attempt({
        ...params,
        responseMimeType: "application/json",
        schemaId,
      });
    } catch (error) {
      if (!isStructuredTransportRejection(error)) throw error;
      structuredJsonSupported = false;
      console.warn(
        "[geminiService] Structured JSON output was refused by the proxy; falling back to prose parsing for this session.",
        error,
      );
    }
  }
  return attempt({ ...params });
};

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
      // Cancellation is a caller decision, not a model failure. Never advance
      // to another provider/model after the queue has aborted the active task.
      if (isAbortError(err)) throw err;
      // A lost paid response is not evidence that a different model should
      // be charged for the same action. Preserve it as a terminal outcome.
      if (isIndeterminateGenerationError(err)) {
        throw new ModelChainFailure(task, attemptedModels, err);
      }
      lastErr = err;
      // A content refusal is a verdict on the photo/wording, not on the model:
      // the next model would be shown the same input and answer the same way.
      if (isBlockedContentError(err)) {
        throw new ModelChainFailure(task, attemptedModels, err);
      }
      // A stale installed app is rejected before the model is even chosen;
      // every model in the chain would answer with the same 409.
      if (isOutdatedClientError(err)) {
        throw new ModelChainFailure(task, attemptedModels, err);
      }
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

const sleepWithSignal = (ms: number, signal?: AbortSignal): Promise<void> => {
  if (!signal) return sleep(ms).then(() => undefined);
  if (signal.aborted) {
    return Promise.reject(
      signal.reason instanceof Error
        ? signal.reason
        : new DOMException("Operation cancelled", "AbortError"),
    );
  }

  return new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, ms);
    const handleAbort = () => {
      clearTimeout(timeoutId);
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException("Operation cancelled", "AbortError"),
      );
    };
    signal.addEventListener("abort", handleAbort, { once: true });
  });
};

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

const normaliseDataUrl = async (
  source?: string,
  signal?: AbortSignal,
): Promise<string> => {
  if (!source) {
    throw new Error("No image data provided.");
  }
  if (source.startsWith("data:")) {
    return source;
  }
  if (source.startsWith("http")) {
    return await urlToDataUrl(source, signal);
  }
  if (source.startsWith("/")) {
    const response = await fetch(source, { credentials: "include", signal });
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
    const response = await fetch(source, { signal });
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

const optionalLogoImagePart = async (source?: string, signal?: AbortSignal) => {
  if (!source) return null;
  try {
    const normalisedLogo = await normaliseDataUrl(source, signal);
    const { mimeType, data } = parseDataUrl(normalisedLogo);
    if (!SUPPORTED_PROVIDER_IMAGE_TYPES.has(mimeType.toLowerCase())) {
      throw new Error(`Unsupported logo format: ${mimeType}`);
    }
    return { inlineData: { mimeType: mimeType.toLowerCase(), data } };
  } catch (error) {
    // Cancellation is not a broken logo — let the queue/caller see it.
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    // A configured asset is an explicit brand contract. Silently dropping it
    // changes the requested creative and also disables exact-logo vision QC.
    // Keep the underlying transport/URL out of the user-facing error.
    throw new Error(
      "The configured dealership logo could not be loaded as a supported image. Update the logo in dealership settings and try again.",
    );
  }
};

/** Clean model text; never return labeled/XML junk to the UI. */
const cleanGeneratedText = (inputText: string): string => {
  return cleanSocialCaption(inputText ?? "");
};

/**
 * OEM affiliation and VIN-decoded vehicle phrase as the creative brief
 * carries them (PostCustomizer's oemBlock / vehicleToCreativeBrief), so the
 * in-service caption gate forgives the same grounded words the browser and
 * server identity guards do.
 */
const captionIdentityGroundingFromBrief = (
  creativeBrief?: string,
): {
  oemAffiliation?: string;
  vehiclePhrase?: string;
  maskedPhrases: Array<string | undefined>;
} => {
  // Both the allowlisted label ("Chevrolet") and the dealer's own spelling
  // in the brief ("Chevy") — the caption uses whichever the store configured.
  const configuredOem = /\bOEM affiliation:\s*([^.\n]{1,80})\./u
    .exec(creativeBrief || "")?.[1]
    ?.trim();
  const oemAffiliation = [
    ...classifyCreativeBrief(creativeBrief).oemAffiliations,
    ...(configuredOem ? [configuredOem] : []),
  ].join(" ");
  const vehiclePhrase = /\bVehicle:\s*([^.\n]{1,80})\./u
    .exec(creativeBrief || "")?.[1]
    ?.trim();
  const salesperson = activeSalespersonPhrases();
  return {
    ...(oemAffiliation ? { oemAffiliation } : {}),
    ...(vehiclePhrase ? { vehiclePhrase } : {}),
    maskedPhrases: [...salesperson, ...salesperson.map(toPublicCustomerLabel)],
  };
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
 * image bytes" (empty parts, NO_IMAGE, IMAGE_OTHER) as a failure so the next
 * model is tried — previously that silent empty success aborted the whole
 * post with a generic error. Content refusals (SAFETY, IMAGE_SAFETY, empty
 * IMAGE_RECITATION) arrive from the client as a typed `blocked` error: the
 * ladder stops and `shouldFallbackToOpenAI` declines, so callers ship the
 * original photo instead of a fabricated one.
 */
const generateImageWithFallback = async (
  task: "image_standard" | "image_studio",
  imageParts: unknown[],
  imagePromptForOpenAI?: string,
  imageAspectRatio?: ImageAspectRatio,
  requestAuthEpoch: number = captureAuthEpoch(),
  signal?: AbortSignal,
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
        signal,
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
    if (
      !isIndeterminateGenerationError(err) &&
      shouldFallbackToOpenAI(err) &&
      imagePromptForOpenAI
    ) {
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
          signal,
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
        if (isAbortError(openaiErr)) throw openaiErr;
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
  "unexpected_personal_name",
  "missing_dealership_identity",
  "incorrect_dealership_name",
  "fabricated_brand_mark",
  "supplied_logo_altered_or_replaced",
  "instruction_text",
  "social_ui_chrome",
  "unrequested_illustration",
  "subject_identity_changed",
  "vehicle_identity_changed",
  "source_composition_changed",
  "unflattering_or_disrespectful",
  "overdone_or_platform_inappropriate",
  "bland_or_unstyled",
  "below_campaign_quality",
  "unintegrated_3d_graphics",
  "malformed_or_misspelled_text",
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
    violations: z.array(ImageTextViolationSchema).max(16),
    logoPresent: z.boolean().optional(),
    logoMatchesSuppliedAsset: z.boolean().optional(),
    hasUnexpectedPersonalName: z.boolean().optional(),
    detectedPersonalNames: z.array(z.string().max(80)).max(5).optional(),
    dealershipNamePresent: z.boolean().optional(),
    dealershipNameCorrect: z.boolean().optional(),
    hasFabricatedBrandMark: z.boolean().optional(),
    hasInstructionText: z.boolean().optional(),
    hasSocialUiChrome: z.boolean().optional(),
    isIllustrationOrCharacterRender: z.boolean().optional(),
    preservesSourceSubjects: z.boolean().optional(),
    preservesVehicleIdentity: z.boolean().optional(),
    preservesSourceComposition: z.boolean().optional(),
    isRespectfulAndFlattering: z.boolean().optional(),
    isPlatformAppropriate: z.boolean().optional(),
    visualQualityScore: z.number().int().min(1).max(5).optional(),
    hasDistinctStyleSignature: z.boolean().optional(),
    hasEnvironmentalDepthIntegration: z.boolean().optional(),
    hasCleanTypography: z.boolean().optional(),
    // Read leniently (readObservedLogoCorner): an odd answer here is unknown,
    // never a reason to reject the whole review.
    logoCorner: z.unknown().optional(),
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
  /** True only when the visible mark matches the supplied logo reference. */
  logoMatchesSuppliedAsset?: boolean;
  /** Designed personal names are forbidden; photographed scene text is exempt. */
  hasUnexpectedPersonalName?: boolean;
  detectedPersonalNames?: string[];
  dealershipNamePresent?: boolean;
  dealershipNameCorrect?: boolean;
  hasFabricatedBrandMark?: boolean;
  hasInstructionText?: boolean;
  hasSocialUiChrome?: boolean;
  isIllustrationOrCharacterRender?: boolean;
  preservesSourceSubjects?: boolean;
  preservesVehicleIdentity?: boolean;
  preservesSourceComposition?: boolean;
  isRespectfulAndFlattering?: boolean;
  isPlatformAppropriate?: boolean;
  /** 1=broken/bland, 3=usable, 5=exceptional. */
  visualQualityScore?: number;
  hasDistinctStyleSignature?: boolean;
  /** Dimensional graphics match the photographed perspective, light, and occlusion. */
  hasEnvironmentalDepthIntegration?: boolean;
  hasCleanTypography?: boolean;
  /**
   * Where the designed logo sits, asked only when the store set a corner.
   * Absent = unknown. Diagnostic only: it never adds a violation.
   */
  logoCorner?: LogoCornerCheck["observed"];
  /** Derived locally; false means the reviewer omitted a required safety field. */
  safetyReviewComplete?: boolean;
}

interface GeneratedImageReviewContext {
  requestedStyle?: string;
  /** Fun Mode deliberately permits illustrated/character transformations. */
  allowArtisticTransformation?: boolean;
  logoSupplied?: boolean;
  /** Exact approved logo reference for output-vs-brand comparison. */
  logoReferenceImagePart?: {
    inlineData: { mimeType: string; data: string };
  };
  /** Original input used for source-vs-output identity and scene comparison. */
  sourceImageBase64Url?: string;
  /**
   * The store's logo corner. With a supplied logo, the reviewer also reports
   * the corner it sees; without a placement the prompt is unchanged.
   */
  logoPlacement?: LogoPlacement | null;
}

/** True when the reviewer is asked where the supplied logo landed. */
const asksLogoCorner = (context: GeneratedImageReviewContext): boolean =>
  Boolean(context.logoSupplied) && storeLogoPlacement(context.logoPlacement) !== null;

/**
 * Strict parse first, brace-scan second.
 *
 * With `responseMimeType: "application/json"` and the server-injected
 * `vision_review_v1` schema, the direct `JSON.parse` below is the normal
 * path. The balanced-object scan is KEPT — not dead code — as the fallback
 * for a proxy that predates the schema registry (see `withStructuredJson`),
 * where the model still wraps JSON in Markdown fences or prose.
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
  context: GeneratedImageReviewContext = {},
): string => `You are a strict visual quality-control inspector for an automotive dealership image.

Inspect the image pixels and return only the requested JSON object.

${
  context.sourceImageBase64Url
    ? `The first two attached images are labeled REFERENCE SOURCE and GENERATED OUTPUT. Compare them directly.
- preservesSourceSubjects=true only when the output keeps the same number of people, recognizable identities, clothing/pose relationships, and no added/replaced person. Fun Mode may stylize faces and bodies, but they must still clearly map to the same source people.
- preservesVehicleIdentity=true only when the output keeps the same vehicle count, body type, color, viewing angle, and recognizable make/model identity. A stylized/brick/painted rendering is allowed in Fun Mode; a different vehicle is not.
- preservesSourceComposition=true only when the people, vehicle, and main location geometry retain their source arrangement. Artistic background treatment is allowed in Fun Mode, but moving subjects, inventing a new setting/story, or replacing the scene is not.
Use subject_identity_changed, vehicle_identity_changed, or source_composition_changed for false fields.`
    : "Only the generated output is attached, so omit the three source-comparison fields."
}

Marketing overlay policy (this matches the design brief the image was created from):
- Up to ${ON_IMAGE_TEXT_BUDGET.maxBlocks} separate overlay text blocks are allowed: one headline of at most ${ON_IMAGE_TEXT_BUDGET.headlineWords} words / ${ON_IMAGE_TEXT_BUDGET.headlineChars} characters, plus up to two short accents (a badge of at most ${ON_IMAGE_TEXT_BUDGET.badgeWords} words and one short support line).
- Across all blocks combined: at most ${ON_IMAGE_TEXT_BUDGET.totalWords} words and ${ON_IMAGE_TEXT_BUDGET.totalChars} characters.
- Reject full sentences, hashtags, URLs, and phone numbers anywhere in overlay copy.
- Customer or personal names are forbidden in designed overlay pixels. The exact dealership name below is a business identity and is exempt. Set hasUnexpectedPersonalName=true and use unexpected_personal_name for any other visible designed person name.
- The exact dealership legal name (${dealershipName}) and a supplied dealership logo are brand identity. Exclude those from the marketing word/character counts and block counts.
- Set dealershipNamePresent=true only when the exact business identity is visibly present as text or within the exact supplied logo. Use missing_dealership_identity when neither is visible.
- The dealership name must be spelled exactly "${dealershipName}". Set dealershipNameCorrect=false for any misspelling, truncation, or substituted store/location name.
- ${context.logoSupplied ? "A third image labeled APPROVED DEALERSHIP LOGO is supplied. The output may show that exact asset once as a designed overlay/watermark, scaled proportionally but otherwise unchanged. Set logoMatchesSuppliedAsset=false and use supplied_logo_altered_or_replaced ONLY when the designed overlay logo's lettering/wording, colors, proportions, emblem, or store identity differs from the supplied asset, or it is a redrawn imitation. Ordinary raster differences from re-rendering (slight softness, anti-aliasing, scaling, compression) are not alterations. Any OTHER designed dealership or manufacturer emblem, badge, crest, or seal added on top of the photo that is not the supplied asset is fabricated and must use fabricated_brand_mark." : "No logo asset was supplied. Any added dealership badge, crest, seal, manufacturer/OEM emblem, or logo-like graphic is fabricated and must use fabricated_brand_mark."}
- Manufacturer signage that is physically part of the photographed scene — a pylon sign, building fascia or showroom sign, a vehicle grille or tailgate badge, a dealer plate frame — is scene content. It is NOT the supplied logo and must never be compared against it, must not set logoPresent, and must not count as fabricated_brand_mark. Judge only graphics that were designed and added on top of the photo.
- Reject prompt leakage or production notes rendered as image copy (for example "avoiding faces", "safe zone", "max words", or parenthetical instructions) with instruction_text.
- Reject drawn social-app interface chrome: usernames, fake Instagram/TikTok/Facebook headers, heart/comment/share buttons, black app bars, or phone frames. Use social_ui_chrome.
- ${
  context.allowArtisticTransformation === true
    ? "This is Fun Mode: an illustrated/comic/character transformation is intentionally allowed and must not be marked unrequested."
    : context.allowArtisticTransformation === false
      ? "This is a regular photo-overlay style. A cartoon, illustration, character render, or rebuilt scene is unrequested and must use unrequested_illustration."
      : "Do not judge whether illustration was requested; this may be an edit of either regular or Fun Mode output."
}
- Exclude text naturally photographed in the scene, such as vehicle badges, building signs, clothing, documents, and license plates. Count only designed promotional overlay copy.
- If text is unreadable, ambiguous, or you cannot confidently distinguish promotional overlay from scene text, set uncertain=true. Only set compliant=false when you can identify a concrete violation.
- Set logoPresent=true only when a DESIGNED dealership logo graphic (an added overlay/watermark, not signage photographed in the scene) is visible, otherwise false.${
  asksLogoCorner(context)
    ? `\n- Set logoCorner to the corner of the image where that designed logo sits: top_left, top_right, bottom_left, or bottom_right. Use not_in_corner when it is visible but not in a corner, and omit logoCorner when no designed logo is visible. This is a placement note only: never add a violation or change compliant because of it.
- The store asked for its logo ${logoPlacementWording(context.logoPlacement, "")}. That position and size are the store's choice: they must never lower visualQualityScore, set isPlatformAppropriate=false, or add a violation.`
    : ""
}

Visual craft target${context.requestedStyle ? ` (${context.requestedStyle})` : ""}:
- Score the finished social creative from 1 to 5. One means broken/unstyled, three means usable but still needs another creative pass, four means high-end and campaign-ready, and five means exceptional campaign craft. Scores below four must use below_campaign_quality.
- Set isRespectfulAndFlattering=true only when the treatment presents every customer warmly and with dignity. Distorted caricature, ridicule, age/body exaggeration, humiliating expressions, or a joke at the customer's expense must use unflattering_or_disrespectful.
- Set isPlatformAppropriate=true only when the design feels ready for a dealership-tagged social post: exciting and polished without visual overload, sensationalism, fake app chrome, excessive effects, or an over-the-top gimmick. Otherwise use overdone_or_platform_inappropriate.
- A plain lightly graded photo with generic white type, weak hierarchy, arbitrary floating elements, malformed letters, or no recognizable style signature is not post-ready.
- Set hasDistinctStyleSignature=false and use bland_or_unstyled for a score of 1-2 caused by generic treatment.
- Set hasEnvironmentalDepthIntegration=true only when visible dimensional graphics actually inherit the photographed scene's perspective, light direction, occlusion, contact shadow, reflected color, and depth-of-field. Floating sticker shadows or flat pasted-on 3D text are false.${context.requestedStyle === StyleOption.DepthPop ? " For 3D Depth Pop this field is required and false must use unintegrated_3d_graphics." : " For styles without dimensional graphics, omit this field."}
- Set hasCleanTypography=false and use malformed_or_misspelled_text for warped, doubled, melted, clipped, or misspelled designed lettering.

detectedMarketingText must contain each overlay text block as its own array entry, exactly as rendered. detectedPersonalNames contains only designed personal/customer names, never words that are part of the exact dealership business name. marketingWordCount and marketingCharacterCount are totals across all blocks. violations must use only the allowed enum values. Return only the JSON object with keys: compliant, uncertain, detectedMarketingText, marketingWordCount, marketingCharacterCount, hasFullSentence, hasHashtag, hasUrlOrPhone, violations, logoPresent, logoMatchesSuppliedAsset, hasUnexpectedPersonalName, detectedPersonalNames, dealershipNamePresent, dealershipNameCorrect, hasFabricatedBrandMark, hasInstructionText, hasSocialUiChrome, isIllustrationOrCharacterRender, preservesSourceSubjects, preservesVehicleIdentity, preservesSourceComposition, isRespectfulAndFlattering, isPlatformAppropriate, visualQualityScore, hasDistinctStyleSignature, hasEnvironmentalDepthIntegration, hasCleanTypography${
  asksLogoCorner(context) ? ", logoCorner" : ""
}. Never include explanations or image details outside the JSON.`;

/**
 * Studio output can be 4K. The publishable result stays untouched, but sending
 * the 4K output plus source and logo back through vision can exceed the proxy's
 * bounded inline payload. A 2K review copy preserves typography/identity detail
 * while keeping the fail-closed comparison request reliable on mobile.
 */
const VISION_REVIEW_MAX_INLINE_IMAGE_CHARS =
  MODEL_POLICY.requestLimits.maxInlineImageChars;
const VISION_REVIEW_MAX_TOTAL_IMAGE_CHARS =
  MODEL_POLICY.requestLimits.maxTotalInlineImageChars;

/**
 * Produce a review-only JPEG that is guaranteed to fit its assigned proxy
 * budget. The publishable image is never changed. If this browser cannot make
 * a bounded copy, only an already-bounded original is accepted; otherwise the
 * fail-closed reviewer aborts before issuing a request the backend will reject.
 */
const prepareVisionReviewCopy = async (
  dataUrl: string,
  maxBase64Chars: number,
  maxDimension = 2048,
): Promise<string> => {
  const original = parseDataUrl(dataUrl);
  const originalFits = original.data.length <= maxBase64Chars;
  if (typeof document === "undefined" || typeof createImageBitmap === "undefined") {
    if (originalFits) return dataUrl;
    throw new Error("Vision review image exceeds the secure proxy payload budget.");
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(await dataUrlToBlob(dataUrl));
    const longest = Math.max(bitmap.width, bitmap.height);
    if (!longest) {
      throw new Error("Vision review image has no readable dimensions.");
    }

    const dimensionSteps = [maxDimension, 1792, 1536, 1280].filter(
      (value, index, values) => value > 0 && values.indexOf(value) === index,
    );
    const qualitySteps = [0.88, 0.8, 0.72, 0.64];
    for (const targetDimension of dimensionSteps) {
      const scale = Math.min(1, targetDimension / longest);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context2d = canvas.getContext("2d");
      if (!context2d) continue;
      // Review copies do not need transparency. A white matte avoids turning a
      // transparent PNG background black while allowing predictable JPEG size.
      context2d.fillStyle = "#ffffff";
      context2d.fillRect(0, 0, canvas.width, canvas.height);
      context2d.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

      for (const quality of qualitySteps) {
        const encoded = canvas.toDataURL("image/jpeg", quality);
        if (parseDataUrl(encoded).data.length <= maxBase64Chars) {
          return encoded;
        }
      }
    }
  } catch (error) {
    if (originalFits) return dataUrl;
    throw error;
  } finally {
    bitmap?.close();
  }

  if (originalFits) return dataUrl;
  throw new Error("Vision review image exceeds the secure proxy payload budget.");
};

/**
 * Second-pass vision check for text painted into generated image pixels.
 * Provider credentials remain in the authenticated PocketBase proxy; this
 * browser helper receives only the strict, non-sensitive review result.
 */
export const reviewGeneratedImageText = async (
  imageBase64Url: string,
  dealershipName: string,
  context: GeneratedImageReviewContext = {},
  requestAuthEpoch: number = captureAuthEpoch(),
  signal?: AbortSignal,
): Promise<GeneratedImageTextReview> => {
  const logoReferenceImagePart = context.logoReferenceImagePart || null;
  const logoChars = logoReferenceImagePart?.inlineData.data.length || 0;
  if (
    logoChars > VISION_REVIEW_MAX_INLINE_IMAGE_CHARS ||
    logoChars >= VISION_REVIEW_MAX_TOTAL_IMAGE_CHARS
  ) {
    throw new Error("Approved logo exceeds the secure vision-review payload budget.");
  }
  const comparisonImageCount = context.sourceImageBase64Url ? 2 : 1;
  const perComparisonImageBudget = Math.min(
    VISION_REVIEW_MAX_INLINE_IMAGE_CHARS,
    Math.floor(
      (VISION_REVIEW_MAX_TOTAL_IMAGE_CHARS - logoChars) / comparisonImageCount,
    ),
  );
  if (perComparisonImageBudget < 4) {
    throw new Error("Vision review images cannot fit the secure proxy payload budget.");
  }

  const normalisedImage = await prepareVisionReviewCopy(
    await normaliseDataUrl(imageBase64Url, signal),
    perComparisonImageBudget,
  );
  assertAuthEpoch(requestAuthEpoch);
  const { mimeType, data } = parseDataUrl(normalisedImage);
  const imagePart = { inlineData: { mimeType, data } };
  let sourceImagePart: { inlineData: { mimeType: string; data: string } } | null = null;
  if (context.sourceImageBase64Url) {
    const normalisedSource = await prepareVisionReviewCopy(
      await normaliseDataUrl(context.sourceImageBase64Url, signal),
      perComparisonImageBudget,
    );
    assertAuthEpoch(requestAuthEpoch);
    const source = parseDataUrl(normalisedSource);
    sourceImagePart = {
      inlineData: { mimeType: source.mimeType, data: source.data },
    };
  }
  const imageLegend = sourceImagePart
    ? `IMAGE 1: REFERENCE SOURCE IMAGE\nIMAGE 2: GENERATED OUTPUT IMAGE${
        logoReferenceImagePart ? "\nIMAGE 3: APPROVED DEALERSHIP LOGO" : ""
      }`
    : `IMAGE 1: GENERATED OUTPUT IMAGE${
        logoReferenceImagePart ? "\nIMAGE 2: APPROVED DEALERSHIP LOGO" : ""
      }`;
  const reviewPrompt = `${imageLegend}\n\n${generatedImageTextReviewPrompt(
    dealershipName,
    context,
  )}`;
  // Its own policy task, not `caption_regenerate`. The two share a model
  // ladder and a 2048-token budget, but this is the one text call where
  // reasoning quality decides whether a flawed render ships, so the policy
  // pins `thinkingLevel: "medium"` here while captions stay at "low".
  // Thinking tokens bill as output, so the split is also what keeps captions
  // cheap. The proxy records the task, and the ledger stops counting QC
  // reviews as captions.
  const task = "vision_review" as const;
  const taskConfig = TASKS[task];
  const attemptId = createGenerationAttemptId();

  const generated = await withFallbackChain(task, attemptId, async (modelId) =>
    // Schema-bound JSON: the proxy injects `vision_review_v1` from its own
    // registry, so the verdict comes back as a parseable object instead of
    // JSON buried in prose. `extractJsonObject` still guards the prose path.
    withStructuredJson(
      RESPONSE_SCHEMA_IDS.visionReview,
      taskConfig.params,
      async (generationConfig) => {
        assertAuthEpoch(requestAuthEpoch);
        const response = await getGeminiClient().models.generateContent({
          model: modelId,
          task,
          attemptId,
          purpose: "vision_review",
          contents: {
            parts: [
              { text: reviewPrompt },
              ...(sourceImagePart ? [sourceImagePart] : []),
              imagePart,
              ...(logoReferenceImagePart ? [logoReferenceImagePart] : []),
            ],
          },
          // Beyond the task policy's config and the server-resolved schema,
          // no browser-supplied knobs: strictness comes from the schema plus
          // the Zod boundary below.
          generationConfig,
          requestAuthEpoch,
          signal,
        } as any);
        assertAuthEpoch(requestAuthEpoch);
        const rawText = typeof response.text === "function" ? response.text() : "";
        const parsedJson = extractJsonObject(rawText);
        const parsed = GeneratedImageTextReviewSchema.safeParse(parsedJson);
        if (!parsed.success) {
          throw new Error("Image text review returned an invalid structured result.");
        }
        return parsed.data;
      },
    ),
  );

  const review = generated.value;
  const safetyReviewComplete =
    typeof review.hasUnexpectedPersonalName === "boolean" &&
    typeof review.dealershipNamePresent === "boolean" &&
    typeof review.dealershipNameCorrect === "boolean" &&
    typeof review.hasFabricatedBrandMark === "boolean" &&
    typeof review.hasInstructionText === "boolean" &&
    typeof review.hasSocialUiChrome === "boolean" &&
    (!context.logoSupplied ||
      (typeof review.logoPresent === "boolean" &&
        typeof review.logoMatchesSuppliedAsset === "boolean")) &&
    (context.allowArtisticTransformation === undefined ||
      typeof review.isIllustrationOrCharacterRender === "boolean") &&
    typeof review.visualQualityScore === "number" &&
    typeof review.hasDistinctStyleSignature === "boolean" &&
    typeof review.hasCleanTypography === "boolean" &&
    typeof review.isRespectfulAndFlattering === "boolean" &&
    typeof review.isPlatformAppropriate === "boolean" &&
    (context.requestedStyle !== StyleOption.DepthPop ||
      typeof review.hasEnvironmentalDepthIntegration === "boolean") &&
    (!context.sourceImageBase64Url ||
      (typeof review.preservesSourceSubjects === "boolean" &&
        typeof review.preservesVehicleIdentity === "boolean" &&
        typeof review.preservesSourceComposition === "boolean"));
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
  const detectedPersonalNames = (review.detectedPersonalNames || [])
    .map((value) => value.trim())
    .filter(Boolean);
  const hasUnexpectedPersonalName =
    review.hasUnexpectedPersonalName === true ||
    detectedPersonalNames.length > 0 ||
    review.violations.includes("unexpected_personal_name");

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

  const violations = new Set(review.violations);
  if (!safetyReviewComplete) violations.add("unreadable_or_uncertain");
  if (marketingWordCount > ON_IMAGE_TEXT_BUDGET.totalWords) {
    violations.add("too_many_words");
  }
  if (marketingCharacterCount > ON_IMAGE_TEXT_BUDGET.totalChars) {
    violations.add("too_many_characters");
  }
  if (detectedMarketingText.length > ON_IMAGE_TEXT_BUDGET.maxBlocks) {
    violations.add("multiple_marketing_blocks");
  }
  if (review.hasFullSentence) violations.add("full_sentence");
  if (review.hasHashtag) violations.add("hashtag");
  if (review.hasUrlOrPhone) violations.add("url_or_phone");
  if (hasUnexpectedPersonalName) violations.add("unexpected_personal_name");
  if (review.dealershipNamePresent === false) {
    violations.add("missing_dealership_identity");
  }
  if (review.dealershipNameCorrect === false) {
    violations.add("incorrect_dealership_name");
  }
  if (review.hasFabricatedBrandMark) violations.add("fabricated_brand_mark");
  if (context.logoSupplied && review.logoMatchesSuppliedAsset === false) {
    violations.add("supplied_logo_altered_or_replaced");
  }
  if (review.hasInstructionText) violations.add("instruction_text");
  if (review.hasSocialUiChrome) violations.add("social_ui_chrome");
  if (
    context.allowArtisticTransformation === false &&
    review.isIllustrationOrCharacterRender === true
  ) {
    violations.add("unrequested_illustration");
  }
  if (review.preservesSourceSubjects === false) {
    violations.add("subject_identity_changed");
  }
  if (review.preservesVehicleIdentity === false) {
    violations.add("vehicle_identity_changed");
  }
  if (review.preservesSourceComposition === false) {
    violations.add("source_composition_changed");
  }
  if (review.isRespectfulAndFlattering === false) {
    violations.add("unflattering_or_disrespectful");
  }
  if (review.isPlatformAppropriate === false) {
    violations.add("overdone_or_platform_inappropriate");
  }
  if (review.hasDistinctStyleSignature === false) {
    violations.add("bland_or_unstyled");
  }
  if (review.visualQualityScore !== undefined && review.visualQualityScore < 4) {
    violations.add("below_campaign_quality");
  }
  if (
    context.requestedStyle === StyleOption.DepthPop &&
    review.hasEnvironmentalDepthIntegration !== true
  ) {
    violations.add("unintegrated_3d_graphics");
  }
  if (review.hasCleanTypography === false) {
    violations.add("malformed_or_misspelled_text");
  }

  // Diagnostic only: read after every pass/fail decision above and never
  // part of one, so a logo in another corner costs no extra generation.
  const { logoCorner: rawLogoCorner, ...reviewFields } = review;
  const observedLogoCorner = readObservedLogoCorner(rawLogoCorner);

  return {
    ...reviewFields,
    ...(observedLogoCorner ? { logoCorner: observedLogoCorner } : {}),
    safetyReviewComplete,
    hasUnexpectedPersonalName,
    detectedPersonalNames,
    detectedMarketingText,
    marketingWordCount,
    marketingCharacterCount,
    violations: [...violations],
    compliant:
      review.compliant &&
      !review.uncertain &&
      safetyReviewComplete &&
      violations.size === 0 &&
      withinBudget &&
      !review.hasFullSentence &&
      !review.hasHashtag &&
      !review.hasUrlOrPhone &&
      !hasUnexpectedPersonalName &&
      review.dealershipNamePresent !== false &&
      review.dealershipNameCorrect !== false &&
      review.hasFabricatedBrandMark !== true &&
      (!context.logoSupplied ||
        (review.logoPresent === true && review.logoMatchesSuppliedAsset === true)) &&
      review.hasInstructionText !== true &&
      review.hasSocialUiChrome !== true &&
      !(
        context.allowArtisticTransformation === false &&
        review.isIllustrationOrCharacterRender === true
      ) &&
      review.preservesSourceSubjects !== false &&
      review.preservesVehicleIdentity !== false &&
      review.preservesSourceComposition !== false &&
      review.isRespectfulAndFlattering !== false &&
      review.isPlatformAppropriate !== false &&
      review.hasDistinctStyleSignature !== false &&
      !(
        context.requestedStyle === StyleOption.DepthPop &&
        review.hasEnvironmentalDepthIntegration !== true
      ) &&
      review.hasCleanTypography !== false &&
      (review.visualQualityScore === undefined || review.visualQualityScore >= 4) &&
      blocksSafe,
  };
};

const textReductionCorrectionPrompt = (dealershipName: string): string =>
  `This is a corrective photo edit of the attached generated image.

Reduce the AI-added marketing overlay text to the allowed budget:
- Keep at most one short headline of up to ${ON_IMAGE_TEXT_BUDGET.headlineWords} words (${ON_IMAGE_TEXT_BUDGET.headlineChars} characters max).
- The only authorized business identity text is exactly "${dealershipName}". Correct its spelling if necessary.
- Keep the supplied dealership logo and the exact dealership name lockup unchanged — they are brand identity, not marketing copy.
- Remove every customer/person name, additional slogan, caption line, hashtag, URL, phone number, prompt/instruction note, fake social-app UI element, fabricated badge/seal/emblem, and extra word badge.
- The dealership name must read exactly as supplied. If no genuine logo asset is attached, use business-name TEXT only and remove every logo-like mark.
Do not add new words. Preserve the exact people, faces, bodies, vehicle, background, crop, lighting, and colors.
Return only the corrected image.`;

const strictTextRetryAddendum = (requestedStyle?: string): string => `

<text_compliance_retry>
A prior render exceeded the on-image text budget. Re-render the same creative direction with tighter copy:
- At most one short headline (${ON_IMAGE_TEXT_BUDGET.headlineWords} words / ${ON_IMAGE_TEXT_BUDGET.headlineChars} characters max)
- At most one ${ON_IMAGE_TEXT_BUDGET.badgeWords}-word badge, only if space allows
- Keep the dealership name lockup and supplied logo
- No customer/person names, sentences, hashtags, URLs, phone numbers, instruction notes, social-app UI chrome, or invented badges/logos anywhere
- Make the ${requestedStyle || "selected"} visual style unmistakable, energetic, and intentionally art-directed; generic white type on a lightly graded photo is a failed retry
${requestedStyle === StyleOption.DepthPop ? "- Rebuild the dimensional graphics as environmental 3D: match the real horizon/perspective, light direction, contact shadow, reflected scene color, depth-of-field, and vehicle-edge occlusion; no flat sticker shadow" : ""}
</text_compliance_retry>`;

const logoRestorePrompt = (
  logoPlacement?: LogoPlacement | null,
): string => `This is a corrective photo edit of the attached generated image.

Use the supplied dealership logo (second attached image) ${logoPlacementWording(
  logoPlacement,
  "as a small, tasteful watermark in a lower-corner safe zone away from people",
)}. If an invented, misspelled, distorted, recolored, or altered imitation is present, remove it and replace it with the exact supplied asset. Do not distort it.
Change nothing else: preserve all existing text, people, faces, vehicle, background, crop, lighting, and colors.
Return only the corrected image.`;

interface ImageTextComplianceInput {
  candidate: ModelRun<string>;
  dealershipName: string;
  logoImagePart: Awaited<ReturnType<typeof optionalLogoImagePart>>;
  imageTier: ImageGenerationTier;
  imageAspectRatio?: ImageAspectRatio;
  requestAuthEpoch: number;
  signal?: AbortSignal;
  /** Original photo + prompt parts, enabling a styled compliant re-render. */
  regenerationParts?: unknown[];
  regenerationPrompt?: string;
  requestedStyle?: string;
  allowArtisticTransformation?: boolean;
  sourceImageBase64Url?: string;
  /** The store's logo corner and size; asked for, never enforced. */
  logoPlacement?: LogoPlacement | null;
}

const concreteViolations = (
  review: GeneratedImageTextReview,
): GeneratedImageTextReview["violations"] =>
  review.violations.filter((violation) => violation !== "unreadable_or_uncertain");

/**
 * Identity, brand-fabrication, source-fidelity, and dignity findings must
 * never ship. Everything else the reviewer can say is a craft opinion — and
 * a craft opinion is never a reason to throw a real render away and hand the
 * salesperson their untouched photo (see the end of
 * enforceGeneratedImageTextCompliance).
 *
 * Deliberately NOT unsafe:
 * - `uncertain`: the reviewer is told to set this whenever it cannot tell
 *   designed overlay text from text photographed in the scene — which is
 *   every real delivery photo taken in front of the store's own signage. It
 *   is also told to only fail a render for a CONCRETE violation. Treating
 *   "I'm not sure" as "unsafe" made the `uncertain_pass` branch below
 *   unreachable and shipped the original photo for whole dealerships.
 * - `supplied_logo_altered_or_replaced`: the image model redraws the whole
 *   frame, so a detailed logo is often a close-but-inexact rendition. That
 *   is the dealer's own mark, not a fabricated or OEM one; the logo-restore
 *   pass gets one try and the better render ships either way.
 * - `overdone_or_platform_inappropriate`: taste. The regeneration ladder
 *   tries again; if it still disagrees, the salesperson gets a styled image
 *   to judge for themselves rather than nothing.
 */
const hasUnsafeOverlayContent = (review: GeneratedImageTextReview): boolean =>
  review.safetyReviewComplete === false ||
  review.hasUrlOrPhone ||
  review.hasHashtag ||
  review.violations.includes("url_or_phone") ||
  review.violations.includes("hashtag") ||
  review.hasUnexpectedPersonalName === true ||
  review.dealershipNameCorrect === false ||
  review.hasFabricatedBrandMark === true ||
  review.hasInstructionText === true ||
  review.hasSocialUiChrome === true ||
  review.violations.includes("unexpected_personal_name") ||
  review.violations.includes("incorrect_dealership_name") ||
  review.violations.includes("fabricated_brand_mark") ||
  review.violations.includes("instruction_text") ||
  review.violations.includes("social_ui_chrome") ||
  review.violations.includes("unrequested_illustration") ||
  review.violations.includes("subject_identity_changed") ||
  review.violations.includes("vehicle_identity_changed") ||
  review.violations.includes("source_composition_changed") ||
  review.violations.includes("unflattering_or_disrespectful");

const hasCorrectableOverlayLengthViolation = (
  review: GeneratedImageTextReview,
): boolean =>
  review.hasFullSentence ||
  review.violations.some((violation) =>
    [
      "too_many_words",
      "too_many_characters",
      "full_sentence",
      "multiple_marketing_blocks",
    ].includes(violation),
  );

const hasBlockingCraftViolation = (review: GeneratedImageTextReview): boolean =>
  review.violations.some((violation) =>
    [
      "bland_or_unstyled",
      "below_campaign_quality",
      "missing_dealership_identity",
      "malformed_or_misspelled_text",
      "unintegrated_3d_graphics",
    ].includes(violation),
  );

const needsFullCreativeRerender = (review: GeneratedImageTextReview): boolean =>
  hasBlockingCraftViolation(review) ||
  review.violations.some((violation) =>
    [
      "unrequested_illustration",
      "subject_identity_changed",
      "vehicle_identity_changed",
      "source_composition_changed",
      "unflattering_or_disrespectful",
      "overdone_or_platform_inappropriate",
    ].includes(violation),
  );

/**
 * Pick the genuinely better render after a retry. Safety dominates; then
 * typography/style craft and reviewer score; only then text-budget neatness.
 */
const generatedImageReviewScore = (review: GeneratedImageTextReview): number => {
  let score = 0;
  if (review.safetyReviewComplete === false) score -= 1_000;
  if (hasUnsafeOverlayContent(review)) score -= 500;
  if (review.hasCleanTypography === true) score += 60;
  if (review.hasCleanTypography === false) score -= 100;
  if (review.hasDistinctStyleSignature === true) score += 50;
  if (review.hasDistinctStyleSignature === false) score -= 80;
  if (review.hasEnvironmentalDepthIntegration === true) score += 40;
  if (review.hasEnvironmentalDepthIntegration === false) score -= 60;
  if (review.isRespectfulAndFlattering === true) score += 40;
  if (review.isPlatformAppropriate === true) score += 30;
  score += (review.visualQualityScore || 0) * 20;
  if (hasCorrectableOverlayLengthViolation(review)) score -= 30;
  if (review.compliant) score += 100;
  return score;
};

const imagePartFromDataUrl = async (
  dataUrl: string,
  requestAuthEpoch: number,
  signal?: AbortSignal,
): Promise<{ inlineData: { mimeType: string; data: string } }> => {
  const normalised = await normaliseDataUrl(dataUrl, signal);
  assertAuthEpoch(requestAuthEpoch);
  const { mimeType, data } = parseDataUrl(normalised);
  return { inlineData: { mimeType, data } };
};

/**
 * Bounded compliance ladder for AI-added overlay text.
 *
 * Identity/branding review is fail-closed: if the reviewer cannot prove the
 * required fields, regular generation returns to the original photo and Fun
 * Mode reports the failure. Confirmed violations trigger a styled re-render,
 * then a targeted text-reduction edit when that edit can actually help.
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
  requestedStyle,
  allowArtisticTransformation,
  sourceImageBase64Url,
  logoPlacement,
  signal,
}: ImageTextComplianceInput): Promise<ModelRun<string>> => {
  const reviewOrNull = async (
    image: string,
    stage: string,
  ): Promise<GeneratedImageTextReview | null> => {
    try {
      return await reviewGeneratedImageText(
        image,
        dealershipName,
        {
          requestedStyle,
          allowArtisticTransformation,
          logoSupplied: Boolean(logoImagePart),
          logoReferenceImagePart: logoImagePart || undefined,
          sourceImageBase64Url,
          logoPlacement,
        },
        requestAuthEpoch,
        signal,
      );
    } catch (error) {
      if (isAbortError(error) || isIndeterminateGenerationError(error)) throw error;
      logTelemetry("image.text_compliance.review_failed", {
        stage,
        reason: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  };

  // Error level on purpose: only error events are beaconed to /api/telemetry
  // and counted in the server's recent-errors view. A render that shipped
  // with a craft, length, or logo finding is a product degradation the
  // server must be able to see, exactly like an original-photo fallback.
  // `task` and `kind` are on the server payload allowlist; no review text.
  const reportDegradedShip = (kind: string) => {
    logImageDegraded("image.accepted_degraded", {
      task: imageTaskForTier(imageTier),
      kind,
    });
  };

  // Every shipped render leaves through restoreLogoIfMissing, which returns
  // the render with the review that judged it. With a store corner and a
  // supplied logo, that review's corner is recorded on the image provenance.
  // Recording only: no branch above or below reads it.
  type ReviewedRun = {
    run: ModelRun<string>;
    review: GeneratedImageTextReview | null;
  };
  let safeReviewed: ReviewedRun | null = null;
  const rememberReviewed = (
    run: ModelRun<string>,
    review: GeneratedImageTextReview | null,
  ) => {
    if (
      review &&
      !hasUnsafeOverlayContent(review) &&
      (!safeReviewed ||
        generatedImageReviewScore(review) >=
          generatedImageReviewScore(safeReviewed.review!))
    ) {
      safeReviewed = { run, review };
    }
  };
  const withLogoCornerCheck = ({ run, review }: ReviewedRun): ModelRun<string> => {
    if (!logoImagePart) return run;
    const check = logoCornerCheck(logoPlacement, review?.logoCorner);
    return check ? { ...run, aiMeta: { ...run.aiMeta, logoCorner: check } } : run;
  };

  const restoreLogoIfMissing = async (
    result: ModelRun<string>,
    review: GeneratedImageTextReview | null,
  ): Promise<ModelRun<string>> =>
    withLogoCornerCheck(await restoreLogoIfMissingReviewed(result, review));

  const restoreLogoIfMissingReviewed = async (
    result: ModelRun<string>,
    review: GeneratedImageTextReview | null,
  ): Promise<ReviewedRun> => {
    if (!logoImagePart) return { run: result, review };
    if (review?.logoPresent === true && review.logoMatchesSuppliedAsset === true) {
      return { run: result, review };
    }
    logTelemetry("image.text_compliance.logo_restore", {});
    let restored: ModelRun<string>;
    try {
      const sourcePart = await imagePartFromDataUrl(
        result.value,
        requestAuthEpoch,
        signal,
      );
      restored = await generateImageWithFallback(
        imageTaskForTier(imageTier),
        [sourcePart, { text: logoRestorePrompt(logoPlacement) }, logoImagePart],
        undefined,
        imageAspectRatio,
        requestAuthEpoch,
        signal,
      );
    } catch (error) {
      if (isAbortError(error) || isIndeterminateGenerationError(error)) throw error;
      // Same policy as the review-failure branch below: the render in hand
      // already passed identity/brand review apart from the logo, so it
      // ships rather than the raw photo. Only an unsafe or unreviewed render
      // still fails closed.
      const reviewedSafe = review !== null && !hasUnsafeOverlayContent(review);
      logTelemetry("image.text_compliance.logo_restore_failed", {
        reason: error instanceof Error ? error.message : String(error),
        shipped: reviewedSafe ? "original_render" : "none",
      });
      if (reviewedSafe) {
        reportDegradedShip("logo_restore_failed");
        return { run: result, review };
      }
      throw new Error("The supplied dealership logo could not be restored safely.");
    }

    const restoredReview = await reviewOrNull(restored.value, "logo_restored");
    rememberReviewed(restored, restoredReview);
    if (restoredReview?.compliant && !hasUnsafeOverlayContent(restoredReview)) {
      return { run: restored, review: restoredReview };
    }
    // The restore pass gets one try. Whatever it produced, the render that
    // reached this point already passed identity/brand review apart from the
    // logo, so it ships — a dealership's own logo drawn slightly off is not
    // a reason to hand the salesperson an untouched photo. Prefer the
    // restored render only when the reviewer could confirm it is at least as
    // safe; an unreviewable restore never replaces a reviewed original.
    const restoredIsSafe =
      restoredReview !== null && !hasUnsafeOverlayContent(restoredReview);
    const keepRestored =
      restoredIsSafe &&
      (review === null ||
        generatedImageReviewScore(restoredReview) >= generatedImageReviewScore(review));
    logTelemetry("image.text_compliance.logo_restore_rejected", {
      reason: restoredReview ? "review_noncompliant" : "review_failed",
      shipped: keepRestored ? "restored" : "original_render",
    });
    reportDegradedShip("logo_unverified");
    return keepRestored
      ? { run: restored, review: restoredReview }
      : { run: result, review };
  };

  const completeReview = async (): Promise<ModelRun<string>> => {
    const firstReview = await reviewOrNull(candidate.value, "initial");
    rememberReviewed(candidate, firstReview);
    if (firstReview === null) {
      throw new Error(
        "Generated image could not be verified for customer identity and branding.",
      );
    }
    const logoNeedsRepair =
      Boolean(logoImagePart) &&
      (firstReview.logoPresent === false ||
        firstReview.logoMatchesSuppliedAsset === false);
    const nonLogoViolations = firstReview.violations.filter(
      (violation) => violation !== "supplied_logo_altered_or_replaced",
    );
    if (logoNeedsRepair && nonLogoViolations.length === 0) {
      return await restoreLogoIfMissing(candidate, firstReview);
    }
    if (firstReview.compliant) return restoreLogoIfMissing(candidate, firstReview);

    const confirmed = concreteViolations(firstReview);
    if (confirmed.length === 0 && !hasUnsafeOverlayContent(firstReview)) {
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
    let bestReview = firstReview;
    if (regenerationParts && regenerationPrompt) {
      try {
        const retryParts = regenerationParts.map((part) =>
          part && typeof part === "object" && "text" in (part as object)
            ? {
                text: `${(part as { text: string }).text}${strictTextRetryAddendum(
                  requestedStyle,
                )}`,
              }
            : part,
        );
        const regenerated = await generateImageWithFallback(
          imageTaskForTier(imageTier),
          retryParts,
          undefined,
          imageAspectRatio,
          requestAuthEpoch,
          signal,
        );
        const regeneratedReview = await reviewOrNull(regenerated.value, "regenerated");
        rememberReviewed(regenerated, regeneratedReview);
        if (regeneratedReview?.compliant) {
          return restoreLogoIfMissing(regenerated, regeneratedReview);
        }
        if (regeneratedReview === null) {
          throw new Error(
            "Regenerated image could not be verified for customer identity and branding.",
          );
        }
        if (
          concreteViolations(regeneratedReview).length === 0 &&
          !hasUnsafeOverlayContent(regeneratedReview)
        ) {
          return restoreLogoIfMissing(regenerated, regeneratedReview);
        }
        if (
          generatedImageReviewScore(regeneratedReview) >=
          generatedImageReviewScore(bestReview)
        ) {
          bestCandidate = regenerated;
          bestReview = regeneratedReview;
        }
      } catch (error) {
        if (isAbortError(error) || isIndeterminateGenerationError(error)) throw error;
        logTelemetry("image.text_compliance.regeneration_failed", {
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Rung 1b: one final full creative pass for defects a text-only edit cannot
    // repair (bland design, malformed type, broken 3D, changed subjects/scene,
    // or disrespectful/overdone treatment).
    if (
      regenerationParts &&
      regenerationPrompt &&
      needsFullCreativeRerender(bestReview)
    ) {
      try {
        const finalRetryParts = regenerationParts.map((part) =>
          part && typeof part === "object" && "text" in (part as object)
            ? {
                text: `${(part as { text: string }).text}${strictTextRetryAddendum(
                  requestedStyle,
                )}

<final_creative_recovery>
The previous attempt still failed campaign review. Build a visibly different, senior-designer composition while preserving the exact source people, vehicle, and scene relationship. Use crisp correctly spelled type, a clear style signature, flattering customer treatment, and platform-ready restraint. If dimensional graphics are requested, integrate them through real perspective, lighting, contact shadow, depth-of-field, and occlusion rather than a flat sticker effect.
</final_creative_recovery>`,
              }
            : part,
        );
        const finalRetry = await generateImageWithFallback(
          imageTaskForTier(imageTier),
          finalRetryParts,
          undefined,
          imageAspectRatio,
          requestAuthEpoch,
          signal,
        );
        const finalRetryReview = await reviewOrNull(
          finalRetry.value,
          "creative_recovery",
        );
        rememberReviewed(finalRetry, finalRetryReview);
        if (finalRetryReview?.compliant) {
          return restoreLogoIfMissing(finalRetry, finalRetryReview);
        }
        if (
          finalRetryReview &&
          generatedImageReviewScore(finalRetryReview) >=
            generatedImageReviewScore(bestReview)
        ) {
          bestCandidate = finalRetry;
          bestReview = finalRetryReview;
        }
      } catch (error) {
        if (isAbortError(error) || isIndeterminateGenerationError(error)) throw error;
        logTelemetry("image.text_compliance.creative_recovery_failed", {
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (needsFullCreativeRerender(bestReview)) {
      if (hasUnsafeOverlayContent(bestReview)) {
        throw new Error(
          "Generated image did not meet the campaign-quality and source-fidelity review.",
        );
      }
      // Every remaining finding is a craft opinion (score, style signature,
      // typography, 3D integration, missing store lockup). Two full renders
      // disagreed with the reviewer's taste; a third would too. The
      // salesperson can regenerate or edit a styled image — they cannot do
      // anything with an untouched photo except conclude the app did nothing.
      logTelemetry("image.text_compliance.accepted_below_craft_bar", {
        violations: bestReview.violations,
        requestedStyle,
        visualQualityScore: bestReview.visualQualityScore,
      });
      reportDegradedShip(
        bestReview.violations[0] ?? `score_${bestReview.visualQualityScore}`,
      );
      return restoreLogoIfMissing(bestCandidate, bestReview);
    }

    // A second text-reduction edit can remove unsafe pixel copy, but it cannot
    // repair art direction or scene-depth integration. After one full re-render,
    // keep the better styled candidate instead of flattening it with an
    // unrelated correction pass.
    if (
      !hasUnsafeOverlayContent(bestReview) &&
      !hasCorrectableOverlayLengthViolation(bestReview)
    ) {
      logTelemetry("image.text_compliance.accepted_after_style_retry", {
        violations: bestReview.violations,
        requestedStyle,
      });
      return restoreLogoIfMissing(bestCandidate, bestReview);
    }

    // Rung 2: reduce overlay text on the best candidate, keeping brand identity.
    const sourcePart = await imagePartFromDataUrl(
      bestCandidate.value,
      requestAuthEpoch,
      signal,
    );
    const correctionParts: unknown[] = [
      sourcePart,
      { text: textReductionCorrectionPrompt(dealershipName) },
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
      signal,
    );

    const correctedReview = await reviewOrNull(corrected.value, "corrected");
    rememberReviewed(corrected, correctedReview);
    if (correctedReview?.compliant) {
      return restoreLogoIfMissing(corrected, correctedReview);
    }
    if (correctedReview === null) {
      // The correction pass could not be reviewed. The best reviewed render is
      // the only candidate whose safety is known; ship it unless it carries an
      // identity/brand/fidelity/dignity finding.
      if (!hasUnsafeOverlayContent(bestReview)) {
        logTelemetry("image.text_compliance.accepted_with_length_findings", {
          violations: bestReview.violations,
          wordCount: bestReview.marketingWordCount,
          characterCount: bestReview.marketingCharacterCount,
        });
        reportDegradedShip("correction_unreviewed");
        return restoreLogoIfMissing(bestCandidate, bestReview);
      }
      throw new Error(
        "Corrected image could not be verified for customer identity and branding.",
      );
    }
    if (
      concreteViolations(correctedReview).length === 0 &&
      !hasUnsafeOverlayContent(correctedReview)
    ) {
      return restoreLogoIfMissing(corrected, correctedReview);
    }

    // Last rung. Only an identity/brand/fidelity/dignity finding is worth
    // discarding a real render over; a leftover length or craft finding on the
    // best available candidate ships with telemetry instead of nothing.
    const finalCandidate =
      generatedImageReviewScore(correctedReview) >=
      generatedImageReviewScore(bestReview)
        ? { run: corrected, review: correctedReview }
        : { run: bestCandidate, review: bestReview };
    if (!hasUnsafeOverlayContent(finalCandidate.review)) {
      logTelemetry("image.text_compliance.accepted_with_length_findings", {
        violations: finalCandidate.review.violations,
        wordCount: finalCandidate.review.marketingWordCount,
        characterCount: finalCandidate.review.marketingCharacterCount,
      });
      reportDegradedShip(finalCandidate.review.violations[0] ?? "length");
      return restoreLogoIfMissing(finalCandidate.run, finalCandidate.review);
    }

    logTelemetry("image.text_compliance.rejected", {
      uncertain: correctedReview.uncertain,
      wordCount: correctedReview.marketingWordCount,
      characterCount: correctedReview.marketingCharacterCount,
      violations: correctedReview.violations,
    });

    throw new Error(
      "Generated image did not pass the final text, identity, brand, and campaign-quality review.",
    );
  };
  try {
    return await completeReview();
  } catch (error) {
    if (!isIndeterminateGenerationError(error) || !safeReviewed) throw error;
    // Only a render whose identity, source fidelity and branding review is
    // complete may survive a stalled optional improvement. An unreviewed or
    // unsafe render still fails closed to the caller's original-photo path.
    assertAuthEpoch(requestAuthEpoch);
    if (signal?.aborted && signal.reason?.name !== "GenerationBudgetExceeded") {
      throw signal.reason instanceof Error
        ? signal.reason
        : new DOMException("Request cancelled", "AbortError");
    }
    reportDegradedShip("recovery_interrupted");
    return withLogoCornerCheck(safeReviewed);
  }
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
  creativeBrief?: string,
  signal?: AbortSignal,
  /** The store's logo corner and size (`dealer.logo_placement`). */
  logoPlacement?: LogoPlacement | null,
): Promise<string> => {
  const requestAuthEpoch = captureAuthEpoch();
  const normalisedOriginal = await normaliseDataUrl(originalImageBase64Url, signal);
  assertAuthEpoch(requestAuthEpoch);
  const { mimeType, data: base64Data } = parseDataUrl(normalisedOriginal);
  const originalImagePart = { inlineData: { mimeType, data: base64Data } };

  const logoImagePart = await optionalLogoImagePart(logoBase64Url, signal);
  assertAuthEpoch(requestAuthEpoch);

  const funPrompt = generateFunPrompt(
    dealershipName,
    logoBase64Url,
    requestedStyle,
    creativeBrief,
    logoPlacement,
  );
  const reviewedStyleName =
    funStyleCatalog.find(
      (style) => style.id === requestedStyle || style.name === requestedStyle,
    )?.name || "Fun Mode";

  const imageParts: any[] = [{ text: funPrompt }, originalImagePart];
  if (logoImagePart) {
    imageParts.push(logoImagePart);
  }

  const generated = await generateImageWithFallback(
    imageTaskForTier(imageTier),
    imageParts,
    funPrompt,
    imageAspectRatio,
    requestAuthEpoch,
    signal,
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
      requestedStyle: reviewedStyleName,
      allowArtisticTransformation: true,
      sourceImageBase64Url: normalisedOriginal,
      logoPlacement,
      signal,
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
  signal?: AbortSignal,
  /** The store's logo corner and size (`dealer.logo_placement`). */
  logoPlacement?: LogoPlacement | null,
): Promise<string> => {
  const requestAuthEpoch = captureAuthEpoch();
  const normalisedPrevious = await normaliseDataUrl(previousImageBase64Url, signal);
  assertAuthEpoch(requestAuthEpoch);
  const { mimeType, data: base64Data } = parseDataUrl(normalisedPrevious);
  const previousImagePart = { inlineData: { mimeType, data: base64Data } };

  const logoImagePart = await optionalLogoImagePart(logoBase64Url, signal);
  assertAuthEpoch(requestAuthEpoch);

  const editInstruction = editImagePrompt(
    editPromptString,
    dealershipName,
    logoBase64Url,
    logoPlacement,
  );

  const imageParts: any[] = [{ text: editInstruction }, previousImagePart];
  if (logoImagePart) {
    imageParts.push(logoImagePart);
  }

  const generated = await generateImageWithFallback(
    imageTaskForTier(imageTier),
    imageParts,
    editInstruction,
    imageAspectRatio,
    requestAuthEpoch,
    signal,
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
      sourceImageBase64Url: normalisedPrevious,
      logoPlacement,
      signal,
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
  customerIdentityRequired = true,
  signal?: AbortSignal,
): Promise<CaptionGenerationResult> => {
  const requestAuthEpoch = captureAuthEpoch();
  const normalisedImage = await normaliseDataUrl(imageBase64Url, signal);
  assertAuthEpoch(requestAuthEpoch);
  const { mimeType, data: base64Data } = parseDataUrl(normalisedImage);
  const imagePart = { inlineData: { mimeType, data: base64Data } };
  const promptArgs = [
    tone,
    dealershipName,
    customerName,
    isRegeneration,
    creativeBrief,
    style,
    customerIdentityRequired,
  ] as const;
  // Reused by every ensureUsableCaption call below so the deterministic
  // fallback template never contradicts what the live prompt was told —
  // e.g. it must not claim a vehicle handoff for a Recall Completion or
  // Customer Testimonial post just because a customer is involved.
  const deliveryLanguageAllowed = deliveryLanguageAllowedForBrief(
    creativeBrief,
    customerIdentityRequired,
  );
  // The same grounding the browser and server identity guards get: the OEM
  // the store sells and the VIN-decoded vehicle, both already in the brief.
  // Without them this gate rejected "This Bronco is ready…" as a customer
  // name and quietly swapped in the template caption.
  const identityGrounding = captionIdentityGroundingFromBrief(creativeBrief);
  // Flattened prompt: the cache key, the Claude fallback, and the legacy
  // transport all still take one string.
  const textPrompt = generateTextPrompt(...promptArgs);
  // Split transport: the invariant compliance/identity/output rules move to
  // `systemInstruction`; only the per-post facts stay in the user turn.
  const promptTurn = splitRoutedPrompt(
    textPrompt,
    generateTextPromptV2(...promptArgs),
    () => generateTextPromptPartsV2(...promptArgs),
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
        // Text first: the shared prompt prefix precedes the per-post image
        // bytes so Gemini's implicit cache can match across requests.
        contents: { parts: [{ text: promptTurn.userPrompt }, imagePart] },
        systemInstruction: systemInstructionPart(promptTurn),
        generationConfig: taskConfig.params,
        requestAuthEpoch,
        signal,
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
        customerIdentityRequired,
        deliveryLanguageAllowed,
        ...identityGrounding,
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
    if (isAbortError(err)) throw err;
    // Terminal: the photo or wording was refused. A template caption would
    // hide that from the salesperson, and Claude would be handed the same
    // input, so surface the typed error for the curated toast instead.
    if (isBlockedContentError(err)) throw err;
    fallbackCount = attemptedModelsFromError(err);
    fallbackReason =
      err instanceof Error && err.message.toLowerCase().includes("quality gate")
        ? "quality_gate"
        : "provider_error";
    if (
      !isIndeterminateGenerationError(err) &&
      shouldFallbackToClaude(err) &&
      taskConfig.claudeFallback
    ) {
      console.warn(
        "[generateSocialPostText] Gemini exhausted; falling back to Claude",
        err,
      );
      try {
        // Claude sees the same photo when its media type is supported;
        // otherwise a one-liner frames the missing image.
        const claudeImage = { mimeType, data: base64Data };
        const claudePrompt = claudeAcceptsImage(claudeImage)
          ? textPrompt
          : `${textPrompt}\n\n(Note: image was not transmitted to fallback model. Use the creative brief above to infer scene; do not invent specific visual details you cannot verify.)`;
        text = cleanGeneratedText(
          await generateTextViaClaude(claudePrompt, {
            task,
            attemptId,
            model: taskConfig.claudeFallback,
            temperature: taskConfig.claudeTemperature,
            maxTokens: taskConfig.params.maxOutputTokens,
            image: claudeImage,
            requestAuthEpoch,
            signal,
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
        if (isAbortError(claudeErr)) throw claudeErr;
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
    customerIdentityRequired,
    deliveryLanguageAllowed,
    ...identityGrounding,
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
      customerIdentityRequired,
      deliveryLanguageAllowed,
      ...identityGrounding,
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
  if (cacheKey && captionSource === "ai") {
    // 5 minute cache — captions are pretty hot when iterating styles. Only
    // real AI results are cached: re-serving a template fallback would make
    // "Generate" useless for 5 minutes after a transient provider outage.
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
const generateRawStructuredImageText = async (
  imageBase64Url: string,
  prompt: string,
  emptyResponseMessage: string,
  purpose: GenerationPurpose,
  schemaId: ResponseSchemaId,
  signal?: AbortSignal,
): Promise<string> => {
  const requestAuthEpoch = captureAuthEpoch();
  const normalisedImage = await normaliseDataUrl(imageBase64Url, signal);
  assertAuthEpoch(requestAuthEpoch);
  const { mimeType, data: base64Data } = parseDataUrl(normalisedImage);
  const imagePart = { inlineData: { mimeType, data: base64Data } };
  const task = "caption_regenerate" as const;
  const attemptId = createGenerationAttemptId();
  const taskConfig = TASKS[task];

  const generated = await withFallbackChain(task, attemptId, async (modelId) =>
    withStructuredJson(schemaId, taskConfig.params, async (generationConfig) => {
      assertAuthEpoch(requestAuthEpoch);
      const client = getGeminiClient();
      const response = await client.models.generateContent({
        model: modelId,
        task,
        attemptId,
        purpose,
        contents: { parts: [{ text: prompt }, imagePart] },
        generationConfig,
        requestAuthEpoch,
        signal,
      } as any);
      assertAuthEpoch(requestAuthEpoch);
      const rawText = typeof response.text === "function" ? response.text() : "";
      if (!rawText.trim()) throw new Error(emptyResponseMessage);
      return rawText.trim();
    }),
  );

  return generated.value;
};

export const generateWebsiteDraftMetadata = async (
  imageBase64Url: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<string> =>
  generateRawStructuredImageText(
    imageBase64Url,
    prompt,
    "Website draft AI returned no metadata.",
    "website_draft",
    RESPONSE_SCHEMA_IDS.websiteDraft,
    signal,
  );

export const editSocialPostTextDetailed = async (
  originalText: string,
  editPromptString: string,
  tone: ToneOption,
  signal?: AbortSignal,
): Promise<CaptionGenerationResult> => {
  const requestAuthEpoch = captureAuthEpoch();
  assertAuthEpoch(requestAuthEpoch);
  const prompt = editTextPrompt(originalText, editPromptString, tone);
  const promptTurn = splitRoutedPrompt(
    prompt,
    editTextPromptV2(originalText, editPromptString, tone),
    () => editTextPromptPartsV2(originalText, editPromptString, tone),
  );
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
        contents: { parts: [{ text: promptTurn.userPrompt }] },
        systemInstruction: systemInstructionPart(promptTurn),
        generationConfig: taskConfig.params,
        requestAuthEpoch,
        signal,
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
    if (isAbortError(err)) throw err;
    if (
      !isIndeterminateGenerationError(err) &&
      shouldFallbackToClaude(err) &&
      taskConfig.claudeFallback
    ) {
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
          signal,
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

/** One of the two halves generateSocialPost produces in parallel. */
export type SocialPostPart = "caption" | "image";

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
  customerIdentityRequired = true,
  signal?: AbortSignal,
  /**
   * Progress only: called once per part as its promise fulfils, so the
   * Creating screen can say which half has actually landed. A part that
   * rejects is never reported as ready.
   */
  onPartReady?: (part: SocialPostPart) => void,
  /**
   * The store's logo corner and size (`dealer.logo_placement`). Asked for in
   * the image prompt and noted from the image review on `aiMeta.image`;
   * null or absent keeps the prompts exactly as they were.
   */
  logoPlacement?: LogoPlacement | null,
): Promise<SocialPostGenerationResult> => {
  // A progress listener must never be able to fail or alter the generation.
  const notifyPartReady = (part: SocialPostPart) => {
    try {
      onPartReady?.(part);
    } catch {
      /* progress reporting is best-effort */
    }
  };
  const requestAuthEpoch = captureAuthEpoch();
  const normalisedImage = await normaliseDataUrl(imageBase64Url, signal);
  assertAuthEpoch(requestAuthEpoch);
  const { mimeType, data: base64Data } = parseDataUrl(normalisedImage);

  const imagePart = {
    inlineData: {
      mimeType,
      data: base64Data,
    },
  };

  const logoImagePart = await optionalLogoImagePart(logoBase64Url, signal);
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
          customerIdentityRequired,
          signal,
        )
  ).catch((error) => {
    if (isAbortError(error)) throw error;
    // Keep the typed provider failure reachable so a blocked-content verdict
    // still classifies as `blocked` for the toast instead of "unknown".
    throw new Error(
      `Failed to generate text content: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  });

  const imagePrompt = generateImagePrompt(
    style,
    dealershipName,
    !!logoImagePart,
    initialText,
    creativeBrief,
    logoPlacement,
  );
  // Text first: the shared style prompt precedes the per-post image bytes so
  // Gemini's implicit cache can match across requests.
  const imageParts: (typeof imagePart | { text: string })[] = [
    { text: imagePrompt },
    imagePart,
  ];
  if (logoImagePart) {
    imageParts.push(logoImagePart);
  }

  // Image ladder → OpenAI → original photo. Never hard-fail a delivery post
  // just because the retoucher model blocked/recited the image. A content
  // block skips OpenAI (it would fabricate a photo without the customer) and
  // ships the original photo directly.
  const imagePromise = (async () => {
    const imageBudget = createGenerationBudget(signal);
    try {
      const generated = await generateImageWithFallback(
        imageTaskForTier(imageTier),
        imageParts,
        imagePrompt,
        imageAspectRatio,
        requestAuthEpoch,
        imageBudget.signal,
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
        requestedStyle: style,
        allowArtisticTransformation: false,
        sourceImageBase64Url: normalisedImage,
        logoPlacement,
        signal: imageBudget.signal,
      });
    } catch (err) {
      if (signal?.aborted) {
        throw signal.reason instanceof Error
          ? signal.reason
          : new DOMException("Request cancelled", "AbortError");
      }
      if (isAbortError(err)) throw err;
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
    } finally {
      imageBudget.dispose();
    }
  })();

  // Each half is reported as its own promise fulfils (attached in the same
  // tick both were created, so nothing can settle unobserved).
  const [textResult, imageResult] = await Promise.all([
    textPromise.then((result) => {
      notifyPartReady("caption");
      return result;
    }),
    imagePromise.then((result) => {
      notifyPartReady("image");
      return result;
    }),
  ]);
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
  signal?: AbortSignal,
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
          signal,
        });
        lastTransportError = null;
      } catch (error) {
        if (isAbortError(error)) throw error;
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
      await sleepWithSignal(VIDEO_DOWNLOAD_RETRY_DELAYS_MS[attempt], signal);
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
    if (isAbortError(error)) throw error;
    console.error("[VideoGen] Secure video download failed.", error);
    throw new Error(
      error instanceof Error
        ? error.message
        : "Generated video could not be downloaded securely.",
    );
  }
};

/**
 * The provider refused the clip on content grounds (`raiMediaFilteredReasons`
 * on an otherwise successful operation). Terminal by construction: the same
 * photo and prompt cannot pass on a different Veo model, so the caller must not
 * advance the model ladder.
 */
const blockedVideoError = (reasons: string[]): NormalizedError =>
  createBlockedContentError(`video RAI filter: ${reasons.join("; ")}`);

/**
 * Veo returned something this app does not recognise. Named and non-retryable
 * so a provider shape change is diagnosable in one log line instead of
 * surfacing as the old generic "no video found". `received` lists key names
 * only and rides on `original`, never in the user-facing message.
 */
const unrecognizedVideoResponseError = (
  stage: "start" | "operation",
  received: string,
): NormalizedError => {
  const error = new Error(
    "The video service returned a response this app could not read.",
  ) as NormalizedError;
  error.name = "UnrecognizedVideoResponseError";
  error.kind = "validation";
  error.retryable = false;
  error.original = new Error(
    `Veo ${stage} response did not match the documented shape (received ${received}).`,
  );
  return error;
};

/** Key names only — never URIs, prompts, or media bytes. */
const describeResponseShape = (value: unknown): string => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value !== "object") return typeof value;
  const keys = Object.keys(value as Record<string, unknown>).slice(0, 8);
  return keys.length ? `keys ${keys.join(",")}` : "empty object";
};

/**
 * Our own typed failures (blocked content, unrecognised shape) are terminal.
 * The poll loop must rethrow them instead of treating them as a transient
 * network blip and spinning until the six-minute timeout.
 */
const isTerminalTypedError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "kind" in error &&
  (error as NormalizedError).retryable === false;

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

  const normalisedImage = await normaliseDataUrl(imageBase64Url, signal);
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

  // The identity locks and the silent-clip request ride as a real request
  // parameter, not only as prose the model may weigh against the rest of the
  // prompt. `generateAudio` is deliberately not sent: it is a Vertex/GEAP-only
  // parameter that both official Google SDKs refuse to forward to
  // generativelanguage.googleapis.com, so it would risk a 400 on every clip.
  const negativePrompt = generateVideoNegativePrompt({
    ...options,
    durationSeconds,
    aspectPreference: aspectRatio,
    resolution: resolvedResolution,
    pacing: options.pacing || "cinematic",
  });

  // `negativePrompt` is optional on the wire and negotiated, never assumed: it
  // rides only when the backend that issued this session advertised
  // `capabilities.veoNegativePrompt`. An older backend (a rollback, or the
  // older half of a mixed-version deploy) validates the body against an exact
  // key whitelist and would answer 400 before ever reaching Veo.
  let includeNegativePrompt = proxyCapabilities().veoNegativePrompt === true;

  // Veo 3.x predictLongRunning expects image as { bytesBase64Encoded, mimeType }.
  // Gemini generateContent-style { inlineData: { data, mimeType } } returns 400
  // "inlineData isn't supported by this model".
  const buildStartBody = () => ({
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
      ...(includeNegativePrompt ? { negativePrompt } : {}),
    },
  });

  // Veo 3.1 bakes native audio from the prompt (no separate track upload).
  // When soundtrack !== none, the prompt requires score/ambience so the MP4
  // is not silent; when it is none, negativePrompt suppresses music, score,
  // and speech. Log for support when diagnosing "no sound" reports.
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
          "X-Generation-Purpose": "video",
        },
        body: JSON.stringify(buildStartBody()),
        signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }
      lastError = error;
      // Log the raw error: normalizeError's message is curated for toasts and
      // no longer carries the technical detail this diagnostic needs.
      console.error(
        `[VideoGen] ${veoModel} start failed; not retrying an ambiguous request.`,
        error,
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
      // The proxy rejected a stale installed app before validating the body;
      // no model in the chain would be treated differently.
      const outdated = outdatedClientErrorFromResponse(response.status, text);
      if (outdated) {
        lastError = outdated;
        console.error("[VideoGen] The installed app is behind the server policy.");
        break;
      }
      // The proxy validates the body against its key whitelist before any
      // upstream call, so this exact 400 proves no Veo job was started. It is
      // the one failure a start may be re-issued for: the session advertised
      // `negativePrompt`, but the instance that answered predates it (a
      // rollback or mixed-version deploy). Send the same start once more
      // without the optional field, on the same model — never on the next
      // rung, which would turn a request-shape problem into a model change.
      if (includeNegativePrompt && isProxyValidationRejection(response.status, text)) {
        includeNegativePrompt = false;
        console.warn(
          `[VideoGen] ${veoModel} rejected negativePrompt; re-issuing the start without it.`,
        );
        modelIndex -= 1;
        continue;
      }
      // 5xx carries no normalizeError token, so spell out "unavailable" to
      // classify as a temporary outage; other statuses classify off their
      // number (401/404/429/400). Raw provider text stays in the console.
      lastError = new Error(
        response.status >= 500
          ? `Video generation failed (${response.status}): the service is temporarily unavailable.`
          : `Video generation failed (${response.status}): ${
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

    // `:predictLongRunning` documents exactly one accepted-start shape: an
    // operation envelope carrying `name`. A 200 without it is ambiguous — the
    // job may or may not be running — so name what arrived and stop. Do not
    // send another billable start request.
    lastError = unrecognizedVideoResponseError("start", describeResponseShape(json));
    console.error(
      "[VideoGen] Accepted start had no operation name.",
      (lastError as NormalizedError).original,
    );
    break;
  }

  const normalized = normalizeError(lastError);
  const startFailure = new Error(
    `Video generation did not start safely: ${normalized.message} ${recoveryHint(
      normalized,
    )} The start request was not retried to prevent a duplicate paid video job.`,
  );
  // Keep the typed provider failure reachable so a terminal classification
  // (blocked, outdated) survives the wrapper instead of degrading to unknown.
  Object.defineProperty(startFailure, "cause", { value: lastError, enumerable: false });
  throw startFailure;
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
        signal,
      });

      if (!response.ok) {
        if (response.status === 401) notifySessionRejected(requestAuthEpoch);
        const text = await response.text();
        console.error(`[VideoGen] Poll failed:`, text);
        await sleepWithSignal(pollInterval, signal);
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

        // One typed classification of the documented shape — no probing. A
        // content refusal arrives here on a *successful* operation, which is
        // why it used to be indistinguishable from an empty result.
        const outcome = resolveVeoVideoOutcome(operation.response);
        if (outcome.kind === "uri") {
          // Download through the proxy so the provider key never reaches the browser.
          return await fetchVideoThroughProxy(outcome.uri, requestAuthEpoch, signal);
        }
        if (outcome.kind === "inline") {
          return createVideoBlobUrl(outcome.data);
        }
        if (outcome.kind === "blocked") {
          console.error(
            `[VideoGen] Provider filtered the clip on content grounds: ${outcome.reasons.join("; ")}`,
          );
          throw blockedVideoError(outcome.reasons);
        }
        throw unrecognizedVideoResponseError("operation", outcome.received);
      }

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(
        `[VideoGen] Still processing... (${elapsed}s elapsed). Next poll in ${pollInterval / 1000}s`,
      );
      await sleepWithSignal(pollInterval, signal);
      pollInterval = Math.min(pollInterval * 1.5, maxPollInterval);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }
      // A content refusal or an unrecognised response shape is already typed
      // and non-retryable; rethrow instead of polling until the timeout. This
      // also carries the terminal classification out to the caller, which never
      // starts a second billable job for it.
      if (isTerminalTypedError(error)) {
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
          msg.includes("not trusted")
        ) {
          throw error;
        }
      }
      console.error(
        `[VideoGen] Poll error (will retry in ${pollInterval / 1000}s):`,
        error,
      );
      await sleepWithSignal(pollInterval, signal);
      pollInterval = Math.min(pollInterval * 1.5, maxPollInterval);
    }
  }

  throw new Error(`Video generation timed out after ${timeoutMs / 1000} seconds.`);
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
