import { parseDataUrl, urlToDataUrl } from "../utils/imageUtils";
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  if (source.startsWith("blob:")) {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`Could not read blob url: ${response.statusText}`);
    }
    const blob = await response.blob();
    const reader = new FileReader();
    return await new Promise((resolve, reject) => {
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () =>
        reject(new Error("Failed to convert blob to data URL."));
      reader.readAsDataURL(blob);
    });
  }
  throw new Error(
    "Unsupported image format. Expected a data URL, http(s) URL, or blob URL."
  );
};

const cleanGeneratedText = (inputText: string): string => {
  if (!inputText) return "";
  const lines = inputText.trim().split("\n");
  const firstLine = lines[0].toLowerCase();

  const isPreamble =
    firstLine.includes("here is") ||
    firstLine.includes("here's") ||
    firstLine.startsWith("sure") ||
    firstLine.startsWith("certainly") ||
    (firstLine.includes("post") && firstLine.includes("for you"));

  if (lines.length > 1 && isPreamble) {
    return lines.slice(1).join("\n").trim();
  }

  return inputText.trim();
};

export const generateFunSocialPostImage = async (
  originalImageBase64Url: string,
  dealershipName: string,
  logoBase64Url?: string,
  requestedStyle?: string // Optional: specific style  name or 'random'
): Promise<string> => {
  const normalisedOriginal = await normaliseDataUrl(originalImageBase64Url);
  const { mimeType, data: base64Data } = parseDataUrl(normalisedOriginal);
  const originalImagePart = { inlineData: { mimeType, data: base64Data } };

  let logoImagePart = null;
  if (logoBase64Url) {
    const normalisedLogo = await normaliseDataUrl(logoBase64Url);
    const { mimeType: logoMime, data: logoData } = parseDataUrl(normalisedLogo);
    logoImagePart = { inlineData: { mimeType: logoMime, data: logoData } };
  }

  const funPrompt = generateFunPrompt(
    dealershipName,
    logoBase64Url,
    requestedStyle
  );

  const imageParts: any[] = [originalImagePart, { text: funPrompt }];
  if (logoImagePart) {
    imageParts.push(logoImagePart);
  }

  const client = getGeminiClient();
  const imageResponse = await client.models.generateContent({
    // Use gemini-3-pro-image for best quality image generation
    model: "gemini-3-pro-image-preview",
    contents: { parts: imageParts },
    generationConfig: {
      responseModalities: ["TEXT" as any, "IMAGE" as any],
    },
  });

  const imageContentPart = imageResponse.candidates?.[0]?.content?.parts?.[0];
  if (imageContentPart && imageContentPart.inlineData) {
    const generatedImageMime = imageContentPart.inlineData.mimeType;
    const generatedImageData = imageContentPart.inlineData.data;
    return `data:${generatedImageMime};base64,${generatedImageData}`;
  }

  throw new Error("Failed to generate fun mode image from AI.");
};

export const editSocialPostImage = async (
  previousImageBase64Url: string,
  editPromptString: string,
  dealershipName: string,
  logoBase64Url?: string
): Promise<string> => {
  const normalisedPrevious = await normaliseDataUrl(previousImageBase64Url);
  const { mimeType, data: base64Data } = parseDataUrl(normalisedPrevious);
  const previousImagePart = { inlineData: { mimeType, data: base64Data } };

  let logoImagePart = null;
  if (logoBase64Url) {
    const normalisedLogo = await normaliseDataUrl(logoBase64Url);
    const { mimeType: logoMime, data: logoData } = parseDataUrl(normalisedLogo);
    logoImagePart = { inlineData: { mimeType: logoMime, data: logoData } };
  }

  const editInstruction = editImagePrompt(
    editPromptString,
    dealershipName,
    logoBase64Url
  );

  const imageParts: any[] = [previousImagePart, { text: editInstruction }];
  if (logoImagePart) {
    imageParts.push(logoImagePart);
  }

  const client = getGeminiClient();
  const imageResponse = await client.models.generateContent({
    // Use gemini-3-pro-image for best quality image editing
    model: "gemini-3-pro-image-preview",
    contents: {
      parts: imageParts,
    },
    generationConfig: {
      responseModalities: ["TEXT" as any, "IMAGE" as any],
    },
  });

  let newImageBase64 = "";
  const imageContentPart = imageResponse.candidates?.[0]?.content?.parts?.[0];
  if (imageContentPart && imageContentPart.inlineData) {
    const generatedImageMime = imageContentPart.inlineData.mimeType;
    const generatedImageData = imageContentPart.inlineData.data;
    newImageBase64 = `data:${generatedImageMime};base64,${generatedImageData}`;
  }

  if (!newImageBase64) {
    throw new Error("Failed to generate edited image from AI.");
  }

  return newImageBase64;
};

export const generateSocialPostText = async (
  imageBase64Url: string,
  tone: ToneOption,
  dealershipName: string,
  customerName?: string,
  isRegeneration = false,
  creativeBrief?: string
): Promise<string> => {
  const normalisedImage = await normaliseDataUrl(imageBase64Url);
  const { mimeType, data: base64Data } = parseDataUrl(normalisedImage);
  const imagePart = { inlineData: { mimeType, data: base64Data } };
  const textPrompt = generateTextPrompt(
    tone,
    dealershipName,
    customerName,
    isRegeneration,
    creativeBrief
  );

  const client = getGeminiClient();
  const textResponse = await client.models.generateContent({
    // gemini-2.5-flash: Fast, high-quality text generation (1K RPM vs 150 RPM for pro)
    model: "gemini-2.5-flash",
    contents: { parts: [imagePart, { text: textPrompt }] },
  });

  // Safely extract text with proper error handling
  let rawText = "";
  try {
    rawText =
      typeof textResponse.text === "function" ? textResponse.text() : "";
  } catch (e) {
    throw new Error("Failed to extract text from AI response.");
  }
  const text = cleanGeneratedText(rawText);
  if (!text) {
    throw new Error("Failed to generate post text from AI.");
  }
  return text;
};

export const editSocialPostText = async (
  originalText: string,
  editPromptString: string,
  tone: ToneOption
): Promise<string> => {
  const prompt = editTextPrompt(originalText, editPromptString, tone);

  const client = getGeminiClient();
  const textResponse = await client.models.generateContent({
    // gemini-2.5-flash: Fast text editing
    model: "gemini-2.5-flash",
    contents: { parts: [{ text: prompt }] },
  });

  // Safely extract text with proper error handling
  let rawText = "";
  try {
    rawText =
      typeof textResponse.text === "function" ? textResponse.text() : "";
  } catch (e) {
    throw new Error("Failed to extract text from AI response.");
  }
  const text = cleanGeneratedText(rawText);
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
  creativeBrief?: string
): Promise<{ image: string; text: string }> => {
  const normalisedImage = await normaliseDataUrl(imageBase64Url);
  const { mimeType, data: base64Data } = parseDataUrl(normalisedImage);

  const imagePart = {
    inlineData: {
      mimeType,
      data: base64Data,
    },
  };

  let logoImagePart = null;
  if (logoBase64Url) {
    const normalisedLogo = await normaliseDataUrl(logoBase64Url);
    const { mimeType: logoMime, data: logoData } = parseDataUrl(normalisedLogo);
    logoImagePart = {
      inlineData: {
        mimeType: logoMime,
        data: logoData,
      },
    };
  }

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
          creativeBrief
        )
  ).catch((error) => {
    throw new Error(
      `Failed to generate text content: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  });

  const imagePrompt = generateImagePrompt(
    style,
    dealershipName,
    !!logoImagePart,
    initialText,
    creativeBrief
  );
  const imageParts: (typeof imagePart | { text: string })[] = [
    imagePart,
    { text: imagePrompt },
  ];
  if (logoImagePart) {
    imageParts.push(logoImagePart);
  }

  const client = getGeminiClient();
  const imagePromise = client.models
    .generateContent({
      model: "gemini-3-pro-image-preview",
      contents: { parts: imageParts },
      generationConfig: { responseModalities: ["TEXT" as any, "IMAGE" as any] },
    })
    .catch((error) => {
      throw new Error(
        `Failed to generate image content: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    });

  const [textResult, imageResponse] = await Promise.all([
    textPromise,
    imagePromise,
  ]);

  let newImageBase64 = "";
  const imageContentPart = imageResponse.candidates?.[0]?.content?.parts?.[0];
  if (imageContentPart && imageContentPart.inlineData) {
    const generatedImageMime = imageContentPart.inlineData.mimeType;
    const generatedImageData = imageContentPart.inlineData.data;
    newImageBase64 = `data:${generatedImageMime};base64,${generatedImageData}`;
  }

  if (!textResult || !newImageBase64) {
    throw new Error("Failed to generate social post content from AI.");
  }

  return { image: newImageBase64, text: textResult };
};

const getImageDimensions = (
  dataUrl: string
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

export const generatePostVideo = async (
  imageBase64Url: string,
  style: VideoStyle,
  options: VideoRequestOptions
): Promise<string> => {
  // Use Veo 3.1 Fast - faster generation, same quality
  // NOTE: generateAudio is NOT supported in Gemini API (ML Dev), only in Vertex AI
  const veoModel = "veo-3.1-fast-generate-preview";

  const normalisedImage = await normaliseDataUrl(imageBase64Url);
  const { mimeType, data: base64Data } = parseDataUrl(normalisedImage);
  const prompt = generateVideoPrompt(style, options);

  const { width, height } = await getImageDimensions(imageBase64Url);
  const derivedAspect =
    width === height ? "16:9" : width > height ? "16:9" : "9:16"; // Veo 3.1 only supports 16:9 and 9:16
  const aspectRatio =
    options.aspectPreference === "auto"
      ? derivedAspect
      : options.aspectPreference === "1:1"
      ? "16:9" // Convert 1:1 to 16:9 for Veo 3.1
      : options.aspectPreference;

  // Veo 3.1 supports 4, 6, or 8 seconds
  const durationSeconds = options.durationSeconds || 8;

  // Veo 3.1 uses the predictLongRunning endpoint with instances/parameters format
  // Important: SDK uses "sampleCount" not "numberOfVideos" for Gemini API
  const body = {
    instances: [
      {
        prompt: prompt,
        image: {
          bytesBase64Encoded: base64Data,
          mimeType: mimeType,
        },
      },
    ],
    parameters: {
      aspectRatio: aspectRatio,
      sampleCount: 1, // SDK converts numberOfVideos to sampleCount
      durationSeconds: durationSeconds,
      personGeneration: "allow_adult", // Required for image-to-video
    },
  };

  let lastError: any = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(
        `[VideoGen] Starting video generation with ${veoModel}, attempt ${attempt}`
      );
      console.log(
        `[VideoGen] Config: ${durationSeconds}s, ${aspectRatio}`
      );

      // Use the predictLongRunning endpoint for Veo 3.x
      const apiPath = `v1beta/models/${veoModel}:predictLongRunning`;
      const proxyToken = import.meta.env.VITE_PROXY_ACCESS_TOKEN;

      const response = await fetch(`/api/proxy/${apiPath}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(proxyToken ? { "X-Proxy-Token": proxyToken } : {}),
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        console.error(`[VideoGen] Request failed:`, text);

        // Check for specific error types
        if (response.status === 503 || text.includes("overloaded")) {
          console.log(`[VideoGen] Service overloaded, will retry...`);
          await sleep(attempt * 5000);
          continue;
        }

        throw new Error(
          `Video generation failed (${response.status}): ${
            text || response.statusText
          }`
        );
      }

      const json = await response.json();
      console.log(
        `[VideoGen] Response received:`,
        JSON.stringify(json).substring(0, 500)
      );

      // Veo 3.1 returns an async operation that needs polling
      const operationName = json?.name;
      if (operationName) {
        console.log(
          `[VideoGen] Got async operation, polling: ${operationName}`
        );
        return await pollGeminiVideoOperation(operationName, 360000); // 6 minute timeout for Veo 3.1
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
              console.log(`[VideoGen] Got file URI: ${part.fileData.fileUri}`);
              return part.fileData.fileUri;
            }
            // Check for video URI directly
            if (part.videoMetadata?.uri || part.uri) {
              const uri = part.videoMetadata?.uri || part.uri;
              console.log(`[VideoGen] Got video URI: ${uri}`);
              return uri;
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
        "No video content found in response. The model may not support video generation with the current configuration."
      );
    } catch (error) {
      lastError = error;
      const normalized = normalizeError(error);
      console.error(
        `[VideoGen] Attempt ${attempt} failed:`,
        normalized.message
      );

      if (normalized.kind === "model_unavailable" && attempt < 3) {
        await sleep(attempt * 5000);
        continue;
      }
      if (normalized.kind === "network" && attempt < 3) {
        await sleep(attempt * 3000);
        continue;
      }

      // On last attempt, throw the error
      if (attempt >= 3) {
        throw new Error(
          `Video generation failed: ${normalized.message} ${recoveryHint(
            normalized
          )}`
        );
      }
    }
  }

  throw new Error(
    `Video generation failed after retries: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
};

/**
 * Polls a Gemini API async operation until it completes
 */
const pollGeminiVideoOperation = async (
  operationName: string,
  timeoutMs: number = 300000
): Promise<string> => {
  const startTime = Date.now();
  const pollInterval = 5000;

  // Clean up operation name - remove leading slashes
  let cleanOpName = operationName.replace(/^\/+/, "");

  while (Date.now() - startTime < timeoutMs) {
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

      console.log(`[VideoGen] Polling operation: ${pollPath}`);
      const proxyToken = import.meta.env.VITE_PROXY_ACCESS_TOKEN;

      const response = await fetch(`/api/proxy/${pollPath}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...(proxyToken ? { "X-Proxy-Token": proxyToken } : {}),
        },
      });

      if (!response.ok) {
        const text = await response.text();
        console.error(`[VideoGen] Poll failed:`, text);
        await sleep(pollInterval);
        continue;
      }

      const operation = await response.json();
      console.log(
        `[VideoGen] Operation status:`,
        JSON.stringify(operation).substring(0, 500)
      );

      if (operation.done === true) {
        if (operation.error) {
          throw new Error(
            `Video generation failed: ${
              operation.error.message || JSON.stringify(operation.error)
            }`
          );
        }

        if (operation.response) {
          // Try to extract video from the response
          const resp = operation.response;
          
          // Check generateVideoResponse format (from predictLongRunning)
          if (resp.generateVideoResponse?.generatedSamples?.[0]?.video?.uri) {
            const videoUri = resp.generateVideoResponse.generatedSamples[0].video.uri;
            console.log(`[VideoGen] Got video URI from generateVideoResponse: ${videoUri}`);
            return videoUri;
          }

          // Check candidates
          if (resp.candidates?.[0]?.content?.parts) {
            for (const part of resp.candidates[0].content.parts) {
              if (part.inlineData?.data) {
                return createVideoBlobUrl(part.inlineData.data);
              }
              if (part.fileData?.fileUri) {
                return part.fileData.fileUri;
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
      console.log(`[VideoGen] Still processing... (${elapsed}s elapsed)`);
      await sleep(pollInterval);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("Video generation failed:")
      ) {
        throw error;
      }
      console.error(`[VideoGen] Poll error (will retry):`, error);
      await sleep(pollInterval);
    }
  }

  throw new Error(
    `Video generation timed out after ${timeoutMs / 1000} seconds.`
  );
};

/**
 * Extracts video URL or blob from a Veo response
 */
const extractVideoFromResponse = (response: any): string => {
  // Check for generated videos array (common Veo response format)
  const generatedVideos = response?.generatedVideos || response?.videos;
  if (generatedVideos && generatedVideos.length > 0) {
    const video = generatedVideos[0];

    // Check for video URI
    const uri = video?.video?.uri || video?.uri || video?.videoUri;
    if (uri) {
      console.log(`[VideoGen] Got video URI: ${uri}`);
      return uri;
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
    return extractVideoFromPrediction(response.predictions[0]);
  }

  throw new Error("Could not extract video from response.");
};

/**
 * Extracts video from a prediction object
 */
const extractVideoFromPrediction = (prediction: any): string => {
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
    console.log(`[VideoGen] Got video URI from prediction: ${uri}`);
    return uri;
  }

  throw new Error("No video content found in prediction.");
};

/**
 * Creates a blob URL from base64 video data
 */
const createVideoBlobUrl = (base64Data: string): string => {
  console.log(
    `[VideoGen] Creating blob from base64 data (${base64Data.length} chars)`
  );
  const bytes = atob(base64Data);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  const blob = new Blob([arr], { type: "video/mp4" });
  return URL.createObjectURL(blob);
};
