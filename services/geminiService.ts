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
  FLAGS,
  getFallbackChain,
  MODELS,
  TASKS,
  type GenerationParams,
} from "./modelConfig";
import { generateTextViaClaude, shouldFallbackToClaude } from "./claudeAdapter";
import {
  generateImageViaOpenAI,
  shouldFallbackToOpenAI,
} from "./openaiAdapter";
import { requestCache } from "../utils/requestCache";
import { logEvent as logTelemetry } from "../utils/telemetry";
import {
  cleanSocialCaption,
  ensureUsableCaption,
} from "../utils/captionQuality";

/**
 * Tries each model in the fallback chain for a given task. The action
 * receives the resolved model id and should perform a single attempt.
 * Returns on first success; throws the last error if every model fails.
 */
async function withFallbackChain<T>(
  task: keyof typeof TASKS,
  action: (modelId: string) => Promise<T>,
): Promise<T> {
  const chain = getFallbackChain(task);
  let lastErr: unknown;
  for (const modelId of chain) {
    try {
      return await action(modelId);
    } catch (err) {
      lastErr = err;
      const msg = (
        err instanceof Error ? err.message : String(err)
      ).toLowerCase();
      // Authentication and malformed requests will fail identically across
      // models, so stop. A 404 can be model-specific (regional rollout or a
      // retired endpoint), so it should advance through the configured chain.
      if (msg.includes("400") || msg.includes("401") || msg.includes("403")) {
        throw err;
      }
      // Otherwise try the next model.
      console.warn(
        `[withFallbackChain] ${task} on ${modelId} failed; trying next model.`,
        err,
      );
    }
  }
  throw lastErr ?? new Error(`All models failed for task ${task}`);
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
    const inline = (part as { inlineData?: { mimeType?: string; data?: string } })
      ?.inlineData;
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
  return (
    cand?.finishReason ||
    cand?.finishMessage ||
    block ||
    "empty image response"
  );
};

/**
 * Run image generation across the model ladder. Treats "HTTP 200 but no
 * image bytes" (IMAGE_RECITATION, SAFETY, empty parts) as a failure so the
 * next model is tried — previously that silent empty success aborted the
 * whole post with a generic error.
 */
const generateImageWithFallback = async (
  task: "image_generate" | "image_edit" | "image_fun",
  imageParts: unknown[],
  imagePromptForOpenAI?: string,
): Promise<string> => {
  const client = getGeminiClient();
  try {
    const response = await withFallbackChain(task, async (modelId) => {
      const res = await client.models.generateContent({
        model: modelId,
        contents: { parts: imageParts },
        generationConfig: imageGenerationConfig(modelId, TASKS[task].params),
      } as any);
      const dataUrl = extractGeneratedImageDataUrl(res);
      if (!dataUrl) {
        throw new Error(
          `No image from ${modelId} (${imageFailureReason(res)})`,
        );
      }
      return res;
    });
    const dataUrl = extractGeneratedImageDataUrl(response);
    if (dataUrl) return dataUrl;
    throw new Error("Image model returned no image data.");
  } catch (err) {
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
        return await generateImageViaOpenAI({
          prompt: imagePromptForOpenAI,
          size: "1024x1024",
          quality: "high",
        });
      } catch (openaiErr) {
        console.warn(`[${task}] OpenAI image fallback also failed`, openaiErr);
      }
    }
    throw err;
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
const imageGenerationConfig = (modelId: string, params: GenerationParams) => ({
  responseModalities: ["TEXT" as any, "IMAGE" as any],
  imageConfig: {
    imageSize: modelId === MODELS.image.emergency ? "1K" : "2K",
  },
  ...params,
});

export const generateFunSocialPostImage = async (
  originalImageBase64Url: string,
  dealershipName: string,
  logoBase64Url?: string,
  requestedStyle?: string, // Optional: specific style  name or 'random'
): Promise<string> => {
  const normalisedOriginal = await normaliseDataUrl(originalImageBase64Url);
  const { mimeType, data: base64Data } = parseDataUrl(normalisedOriginal);
  const originalImagePart = { inlineData: { mimeType, data: base64Data } };

  const logoImagePart = await optionalLogoImagePart(logoBase64Url);

  const funPrompt = generateFunPrompt(
    dealershipName,
    logoBase64Url,
    requestedStyle,
  );

  const imageParts: any[] = [originalImagePart, { text: funPrompt }];
  if (logoImagePart) {
    imageParts.push(logoImagePart);
  }

  return await generateImageWithFallback("image_fun", imageParts, funPrompt);
};

export const editSocialPostImage = async (
  previousImageBase64Url: string,
  editPromptString: string,
  dealershipName: string,
  logoBase64Url?: string,
): Promise<string> => {
  const normalisedPrevious = await normaliseDataUrl(previousImageBase64Url);
  const { mimeType, data: base64Data } = parseDataUrl(normalisedPrevious);
  const previousImagePart = { inlineData: { mimeType, data: base64Data } };

  const logoImagePart = await optionalLogoImagePart(logoBase64Url);

  const editInstruction = editImagePrompt(
    editPromptString,
    dealershipName,
    logoBase64Url,
  );

  const imageParts: any[] = [previousImagePart, { text: editInstruction }];
  if (logoImagePart) {
    imageParts.push(logoImagePart);
  }

  return await generateImageWithFallback(
    "image_edit",
    imageParts,
    editInstruction,
  );
};

export const generateSocialPostText = async (
  imageBase64Url: string,
  tone: ToneOption,
  dealershipName: string,
  customerName?: string,
  isRegeneration = false,
  creativeBrief?: string,
  style?: StyleOption,
): Promise<string> => {
  const normalisedImage = await normaliseDataUrl(imageBase64Url);
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

  const task = isRegeneration ? "caption_regenerate" : "caption";
  const taskConfig = TASKS[task];

  // Cache key — never cache regenerations (the whole point is variation).
  // Hash the FULL image bytes, not just the first 256 base64 chars: two photos
  // from the same camera share a long JPEG/EXIF prefix, so a 256-char key
  // collides and could serve one customer's caption for another's vehicle.
  const cacheKey =
    !isRegeneration && FLAGS.enableResponseCache
      ? `caption:${await hashString(textPrompt + ":" + base64Data)}`
      : null;
  if (cacheKey) {
    const cached = requestCache.get<string>(cacheKey);
    if (cached) return cached;
  }

  const runOnGemini = () =>
    withFallbackChain(task, async (modelId) => {
      const client = getGeminiClient();
      const response = await client.models.generateContent({
        model: modelId,
        contents: { parts: [imagePart, { text: textPrompt }] },
        generationConfig: taskConfig.params,
      } as any);
      let rawText = "";
      try {
        rawText = typeof response.text === "function" ? response.text() : "";
      } catch {
        throw new Error("Failed to extract text from AI response.");
      }
      return cleanGeneratedText(rawText);
    });

  let text = "";
  try {
    text = await runOnGemini();
  } catch (err) {
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
            model: taskConfig.claudeFallback,
            temperature: taskConfig.claudeTemperature,
            maxTokens: taskConfig.params.maxOutputTokens,
          }),
        );
      } catch (claudeErr) {
        console.warn(
          "[generateSocialPostText] Claude fallback failed; using safe template",
          claudeErr,
        );
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
    console.warn(
      "[generateSocialPostText] Low-quality/empty model caption replaced with safe template",
    );
  }

  if (!text) {
    // ensureUsableCaption always returns a template when given a store name —
    // this is a last-ditch guard.
    text = ensureUsableCaption("", {
      storeName: dealershipName || "our dealership",
      customerName,
    }).caption;
  }
  if (cacheKey) {
    // 5 minute cache — captions are pretty hot when iterating styles.
    requestCache.set(cacheKey, text, 5 * 60 * 1000);
  }
  return text;
};

export const editSocialPostText = async (
  originalText: string,
  editPromptString: string,
  tone: ToneOption,
): Promise<string> => {
  const prompt = editTextPrompt(originalText, editPromptString, tone);
  const taskConfig = TASKS["caption_edit"];

  const runOnGemini = () =>
    withFallbackChain("caption_edit", async (modelId) => {
      const client = getGeminiClient();
      const response = await client.models.generateContent({
        model: modelId,
        contents: { parts: [{ text: prompt }] },
        generationConfig: taskConfig.params,
      } as any);
      let rawText = "";
      try {
        rawText = typeof response.text === "function" ? response.text() : "";
      } catch {
        throw new Error("Failed to extract text from AI response.");
      }
      return cleanGeneratedText(rawText);
    });

  let text = "";
  try {
    text = await runOnGemini();
  } catch (err) {
    if (shouldFallbackToClaude(err) && taskConfig.claudeFallback) {
      console.warn(
        "[editSocialPostText] Gemini exhausted; falling back to Claude",
        err,
      );
      text = cleanGeneratedText(
        await generateTextViaClaude(prompt, {
          model: taskConfig.claudeFallback,
          temperature: taskConfig.claudeTemperature,
          maxTokens: taskConfig.params.maxOutputTokens,
        }),
      );
    } else {
      throw err;
    }
  }

  if (!text) {
    throw new Error("Failed to edit post text with AI.");
  }
  return text;
};

export const generateSocialPost = async (
  imageBase64Url: string,
  style: StyleOption,
  tone: ToneOption,
  dealershipName: string,
  customerName?: string,
  logoBase64Url?: string,
  initialText?: string,
  creativeBrief?: string,
): Promise<{ image: string; text: string }> => {
  const normalisedImage = await normaliseDataUrl(imageBase64Url);
  const { mimeType, data: base64Data } = parseDataUrl(normalisedImage);

  const imagePart = {
    inlineData: {
      mimeType,
      data: base64Data,
    },
  };

  const logoImagePart = await optionalLogoImagePart(logoBase64Url);

  // Generate text (or use provided template/custom text) and the final image in parallel.
  const textPromise = (
    initialText
      ? Promise.resolve(initialText)
      : generateSocialPostText(
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
      return await generateImageWithFallback(
        "image_generate",
        imageParts,
        imagePrompt,
      );
    } catch (err) {
      console.warn(
        "[generateSocialPost] AI image failed; shipping original photo with caption",
        err,
      );
      logTelemetry("image.fallback.original", {
        reason: err instanceof Error ? err.message : String(err),
      });
      return normalisedImage;
    }
  })();

  const [textResult, imageResult] = await Promise.all([
    textPromise,
    imagePromise,
  ]);

  if (!textResult) {
    throw new Error("Failed to generate social post caption.");
  }

  return { image: imageResult || normalisedImage, text: textResult };
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

/**
 * Fetches video content from a Google API URL through our proxy
 * This is needed because the video URI requires API key authentication
 */
const fetchVideoThroughProxy = async (videoUri: string): Promise<string> => {
  if (videoUri.startsWith("blob:")) {
    return videoUri;
  }
  if (videoUri.startsWith("data:")) {
    return videoUri;
  }

  try {
    const parsed = new URL(videoUri);
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "generativelanguage.googleapis.com" ||
      !parsed.pathname.startsWith("/v1beta/files/")
    ) {
      throw new Error("Video download origin is not trusted.");
    }
    const proxyPath = `${parsed.pathname.slice(1)}${parsed.search}`;

    const response = await fetch(`/api/proxy/${proxyPath}`, {
      method: "GET",
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(`Video proxy returned ${response.status}.`);
    }

    const blob = await response.blob();
    if (
      blob.size === 0 ||
      (!blob.type.startsWith("video/") &&
        blob.type !== "application/octet-stream")
    ) {
      throw new Error("Video proxy returned invalid media.");
    }
    return URL.createObjectURL(blob);
  } catch (error) {
    console.error("[VideoGen] Secure video download failed.", error);
    throw new Error("Generated video could not be downloaded securely.");
  }
};

export const generatePostVideo = async (
  imageBase64Url: string,
  style: VideoStyle,
  options: VideoRequestOptions,
  signal?: AbortSignal,
): Promise<string> => {
  // Prefer the quality Veo 3.1 Gemini API model, then fail over to Fast when
  // the primary is unavailable or overloaded.
  const videoModels = getFallbackChain("video");

  const normalisedImage = await normaliseDataUrl(imageBase64Url);

  // Resolve final Veo params FIRST so the prompt matches the wire body.
  // Veo 3.1 accepts only 16:9 | 9:16 and duration 4 | 6 | 8 (1080p → 8s).
  const { width, height } = await getImageDimensions(normalisedImage);
  const aspectRatio = resolveVeoAspect(
    width,
    height,
    options.aspectPreference || "auto",
  );
  const requestedDuration = options.durationSeconds || 6;
  let durationSeconds =
    requestedDuration <= 5 ? 4 : requestedDuration <= 7 ? 6 : 8;
  if (options.resolution === "1080p") durationSeconds = 8;

  // Letterbox so Veo never has to invent crop margins (root cause of morph/
  // second-car frames when a square branded post is forced into 9:16).
  const letterboxed = await letterboxImageForVideo(
    normalisedImage,
    aspectRatio,
  );
  const { mimeType, data: base64Data } = parseDataUrl(letterboxed);

  const prompt = generateVideoPrompt(style, {
    ...options,
    durationSeconds,
    aspectPreference: aspectRatio,
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
      resolution: options.resolution,
    },
  };

  let lastError: any = null;

  for (const veoModel of videoModels) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (signal?.aborted) {
        throw new DOMException("Video generation aborted", "AbortError");
      }

      try {
        console.log(
          `[VideoGen] Starting video generation with ${veoModel}, attempt ${attempt}`,
        );
        console.log(`[VideoGen] Config: ${durationSeconds}s, ${aspectRatio}`);

        // Use the predictLongRunning endpoint for Veo 3.x
        const apiPath = `v1beta/models/${veoModel}:predictLongRunning`;

        const response = await fetch(`/api/proxy/${apiPath}`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const text = await response.text();
          console.error(`[VideoGen] Request failed:`, text);

          // Check for specific error types
          if (response.status === 503 || text.includes("overloaded")) {
            console.log(`[VideoGen] Service overloaded, will retry...`);
            if (attempt < 3) {
              await sleep(attempt * 5000);
              continue;
            }
            throw new Error(
              `Video generation failed (${response.status}): ${
                text || "service overloaded"
              }`,
            );
          }

          throw new Error(
            `Video generation failed (${response.status}): ${
              text || response.statusText
            }`,
          );
        }

        const json = await response.json();
        console.log("[VideoGen] Generation request accepted.");

        // Veo 3.1 returns an async operation that needs polling
        const operationName = json?.name;
        if (operationName) {
          console.log("[VideoGen] Async operation started; polling.");
          return await pollGeminiVideoOperation(operationName, 360000, signal); // 6 minute timeout for Veo 3.1
        }

        // Check for immediate response (unlikely but handle it)
        if (json?.generatedVideos?.[0]) {
          return extractVideoFromResponse(json);
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
                return createVideoBlobUrl(part.inlineData.data);
              }
              // Check for file URI
              if (part.fileData?.fileUri) {
                return await fetchVideoThroughProxy(part.fileData.fileUri);
              }
              // Check for video URI directly
              if (part.videoMetadata?.uri || part.uri) {
                const uri = part.videoMetadata?.uri || part.uri;
                return await fetchVideoThroughProxy(uri);
              }
            }
          }
        }

        // Check for generatedVideos format
        if (json?.generatedVideos || json?.videos) {
          return extractVideoFromResponse(json);
        }

        // Check predictions format (fallback)
        if (json?.predictions?.[0]) {
          return extractVideoFromPrediction(json.predictions[0]);
        }

        throw new Error(
          "No video content found in response. The model may not support video generation with the current configuration.",
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          throw error;
        }

        lastError = error;
        const normalized = normalizeError(error);
        console.error(
          `[VideoGen] ${veoModel} attempt ${attempt} failed:`,
          normalized.message,
        );

        if (normalized.kind === "model_unavailable" && attempt < 3) {
          await sleep(attempt * 5000);
          continue;
        }
        if (normalized.kind === "network" && attempt < 3) {
          await sleep(attempt * 3000);
          continue;
        }

        console.warn(
          `[VideoGen] ${veoModel} exhausted; trying the next configured model.`,
        );
        break;
      }
    }
  }

  const normalized = normalizeError(lastError);
  throw new Error(
    `Video generation failed after all configured models: ${normalized.message} ${recoveryHint(
      normalized,
    )}`,
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

      const response = await fetch(`/api/proxy/${pollPath}`, {
        method: "GET",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const text = await response.text();
        console.error(`[VideoGen] Poll failed:`, text);
        await sleep(pollInterval);
        pollInterval = Math.min(pollInterval * 1.5, maxPollInterval);
        continue;
      }

      const rawOperation = await response.json();
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
          if (resp.generateVideoResponse?.generatedSamples?.[0]?.video?.uri) {
            const videoUri =
              resp.generateVideoResponse.generatedSamples[0].video.uri;
            // Download video through proxy to handle auth
            return await fetchVideoThroughProxy(videoUri);
          }

          // Alternative format: direct generatedSamples
          if (resp.generatedSamples?.[0]?.video?.uri) {
            const videoUri = resp.generatedSamples[0].video.uri;
            return await fetchVideoThroughProxy(videoUri);
          }

          // Check candidates
          if (resp.candidates?.[0]?.content?.parts) {
            for (const part of resp.candidates[0].content.parts) {
              if (part.inlineData?.data) {
                return createVideoBlobUrl(part.inlineData.data);
              }
              if (part.fileData?.fileUri) {
                return await fetchVideoThroughProxy(part.fileData.fileUri);
              }
            }
          }

          // Check generatedVideos
          if (resp.generatedVideos) {
            return extractVideoFromResponse(resp);
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
      if (
        error instanceof Error &&
        error.message.includes("Video generation failed:")
      ) {
        throw error;
      }
      console.error(
        `[VideoGen] Poll error (will retry in ${pollInterval / 1000}s):`,
        error,
      );
      await sleep(pollInterval);
      pollInterval = Math.min(pollInterval * 1.5, maxPollInterval);
    }
  }

  throw new Error(
    `Video generation timed out after ${timeoutMs / 1000} seconds.`,
  );
};

/**
 * Extracts video URL or blob from a Veo response
 */
const extractVideoFromResponse = async (response: any): Promise<string> => {
  // Check for generated videos array (common Veo response format)
  const generatedVideos = response?.generatedVideos || response?.videos;
  if (generatedVideos && generatedVideos.length > 0) {
    const video = generatedVideos[0];

    // Check for video URI
    const uri = video?.video?.uri || video?.uri || video?.videoUri;
    if (uri) {
      return await fetchVideoThroughProxy(uri);
    }

    // Check for base64 video data
    const base64Data =
      video?.video?.bytesBase64Encoded || video?.bytesBase64Encoded;
    if (base64Data) {
      return createVideoBlobUrl(base64Data);
    }
  }

  // Check for predictions format
  if (response?.predictions) {
    return await extractVideoFromPrediction(response.predictions[0]);
  }

  throw new Error("Could not extract video from response.");
};

/**
 * Extracts video from a prediction object
 */
const extractVideoFromPrediction = async (prediction: any): Promise<string> => {
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
    prediction.videoUri ||
    prediction.outputUri ||
    prediction.uri ||
    prediction.mediaUri ||
    prediction.video?.uri;

  if (uri) {
    return await fetchVideoThroughProxy(uri);
  }

  throw new Error("No video content found in prediction.");
};

/**
 * Creates a blob URL from base64 video data
 */
const createVideoBlobUrl = (base64Data: string): string => {
  console.log(
    `[VideoGen] Creating blob from base64 data (${base64Data.length} chars)`,
  );
  const bytes = atob(base64Data);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  const blob = new Blob([arr], { type: "video/mp4" });
  return URL.createObjectURL(blob);
};
