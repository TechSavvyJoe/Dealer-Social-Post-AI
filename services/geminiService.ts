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
    "veo-3.1-generate-001";

  const vertexPath = `vertex/v1beta1/projects/gen-lang-client-0994987899/locations/us-central1/publishers/google/models/${vertexModel}:predict`;

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

  const body = {
    instances: [
      {
        prompt,
        image: { bytesBase64Encoded: base64Data, mimeType },
      },
    ],
    parameters: {
      sampleCount: 1,
      videoLength: `${options.durationSeconds || 6}s`,
      aspectRatio,
      resolution: options.resolution || "720p",
    },
  };

  let lastError: any = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(`/api/proxy/${vertexPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `Proxy request failed (${response.status}): ${
            text || response.statusText
          }`
        );
      }

      const json = await response.json();
      const prediction =
        json?.predictions?.[0] ||
        json?.prediction ||
        (Array.isArray(json) ? json[0] : null);

      if (!prediction) {
        throw new Error("No prediction returned from Veo.");
      }

      const base64Video =
        prediction.byteStream ||
        prediction.byteContent ||
        prediction.bytesBase64Encoded ||
        prediction.videoBytes;
      const uri =
        prediction.videoUri ||
        prediction.outputUri ||
        prediction.uri ||
        prediction.mediaUri;

      if (base64Video) {
        const bytes = atob(base64Video);
        const arr = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
        const blob = new Blob([arr], { type: "video/mp4" });
        return URL.createObjectURL(blob);
      }

      if (uri) {
        try {
          const proxied = await fetch(uri);
          if (proxied.ok) {
            const blob = await proxied.blob();
            return URL.createObjectURL(blob);
          }
        } catch (err) {
          // fall back to returning uri
        }
        return uri;
      }

      throw new Error("No video content returned from Veo.");
    } catch (error) {
      lastError = error;
      const normalized = normalizeError(error);
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
