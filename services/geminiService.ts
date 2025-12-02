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
    // Use the verified available Gemini 3 image model
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
    // Use verified available Gemini 3 image model
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
    model: "gemini-3-pro-preview",
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
    model: "gemini-3-pro-preview",
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
  // Use Vertex AI Veo via the proxy
  const vertexModel =
    (typeof import.meta !== "undefined" &&
      (import.meta as any).env?.VITE_VEO_MODEL) ||
    (typeof process !== "undefined" && process.env?.VITE_VEO_MODEL) ||
    "veo-3.0-generate-001";

  const PROJECT_ID = "gen-lang-client-0994987899";
  const LOCATION = "us-central1";

  const normalisedImage = await normaliseDataUrl(imageBase64Url);
  const { mimeType, data: base64Data } = parseDataUrl(normalisedImage);
  const prompt = generateVideoPrompt(style, options);

  const { width, height } = await getImageDimensions(imageBase64Url);
  const derivedAspect =
    width === height ? "1:1" : width > height ? "16:9" : "9:16";
  const aspectRatio =
    options.aspectPreference === "auto"
      ? derivedAspect
      : options.aspectPreference;

  // Veo expects duration as an integer (seconds), not a string
  const durationSeconds = options.durationSeconds || 6;

  const body = {
    instances: [
      {
        prompt,
        image: { bytesBase64Encoded: base64Data, mimeType },
      },
    ],
    parameters: {
      aspectRatio,
      sampleCount: 1,
      durationSeconds,
    },
  };

  let lastError: any = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // Step 1: Start the video generation (returns a Long Running Operation)
      const predictPath = `vertex/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${vertexModel}:predict`;
      
      console.log(`[VideoGen] Starting video generation with ${vertexModel}, attempt ${attempt}`);
      
      const response = await fetch(`/api/proxy/${predictPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        console.error(`[VideoGen] Predict request failed:`, text);
        throw new Error(
          `Proxy request failed (${response.status}): ${
            text || response.statusText
          }`
        );
      }

      const json = await response.json();
      console.log(`[VideoGen] Predict response:`, JSON.stringify(json).substring(0, 500));

      // Check if this is a Long Running Operation (LRO)
      const operationName = json?.name || json?.metadata?.name;
      
      if (operationName && !json.done) {
        // Step 2: Poll the operation until completion
        console.log(`[VideoGen] Got LRO, polling operation: ${operationName}`);
        return await pollVideoOperation(operationName, 180000); // 3 minute timeout
      }

      // If the response is already complete (done: true) or has direct video data
      if (json.done === true || json.response || json.predictions) {
        const result = json.response || json;
        return extractVideoFromResponse(result);
      }

      // Try to extract video directly from predictions (fallback)
      const prediction =
        json?.predictions?.[0] ||
        json?.prediction ||
        (Array.isArray(json) ? json[0] : null);

      if (prediction) {
        return extractVideoFromPrediction(prediction);
      }

      throw new Error("No video operation or content returned from Veo.");
    } catch (error) {
      lastError = error;
      const normalized = normalizeError(error);
      console.error(`[VideoGen] Attempt ${attempt} failed:`, normalized.message);
      
      if (normalized.kind === "model_unavailable" && attempt < 3) {
        await sleep(attempt * 5000);
        continue;
      }
      if (normalized.kind === "network" && attempt < 3) {
        await sleep(attempt * 3000);
        continue;
      }
      throw new Error(
        `Video generation failed: ${normalized.message} ${recoveryHint(
          normalized
        )}`
      );
    }
  }

  throw new Error(
    `Video generation failed after retries: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
};

/**
 * Polls a Vertex AI Long Running Operation until it completes
 */
const pollVideoOperation = async (
  operationName: string,
  timeoutMs: number = 180000
): Promise<string> => {
  const startTime = Date.now();
  const pollInterval = 5000; // Poll every 5 seconds
  
  // Clean up operation name - remove leading slashes and ensure proper format
  let cleanOpName = operationName.replace(/^\/+/, "");
  
  // If it doesn't start with projects/, it might need the full path
  if (!cleanOpName.startsWith("projects/")) {
    // Try to construct the path if we just have the operation ID
    cleanOpName = `projects/gen-lang-client-0994987899/locations/us-central1/operations/${cleanOpName}`;
  }

  while (Date.now() - startTime < timeoutMs) {
    try {
      const pollPath = `vertex/v1/${cleanOpName}`;
      console.log(`[VideoGen] Polling operation: ${pollPath}`);
      
      const response = await fetch(`/api/proxy/${pollPath}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        const text = await response.text();
        console.error(`[VideoGen] Poll request failed:`, text);
        // Don't throw on poll failures, just retry
        await sleep(pollInterval);
        continue;
      }

      const operation = await response.json();
      console.log(`[VideoGen] Operation status:`, JSON.stringify(operation).substring(0, 300));

      if (operation.done === true) {
        if (operation.error) {
          throw new Error(`Video generation failed: ${operation.error.message || JSON.stringify(operation.error)}`);
        }
        
        if (operation.response) {
          return extractVideoFromResponse(operation.response);
        }
        
        throw new Error("Operation completed but no response found.");
      }

      // Not done yet, wait and poll again
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(`[VideoGen] Still processing... (${elapsed}s elapsed)`);
      await sleep(pollInterval);
    } catch (error) {
      // If it's our thrown error, re-throw it
      if (error instanceof Error && error.message.includes("Video generation failed:")) {
        throw error;
      }
      // Otherwise, log and continue polling
      console.error(`[VideoGen] Poll error (will retry):`, error);
      await sleep(pollInterval);
    }
  }

  throw new Error(`Video generation timed out after ${timeoutMs / 1000} seconds.`);
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
    const base64Data = video?.video?.bytesBase64Encoded || video?.bytesBase64Encoded;
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
  console.log(`[VideoGen] Creating blob from base64 data (${base64Data.length} chars)`);
  const bytes = atob(base64Data);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  const blob = new Blob([arr], { type: "video/mp4" });
  return URL.createObjectURL(blob);
};
