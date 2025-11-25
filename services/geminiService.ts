// FIX: Replaced 'GenerateVideosOperationResponse' with the correct 'GenerateVideosOperation' type.
import { GoogleGenAI, Modality, GenerateVideosOperation } from "@google/genai";
import { parseDataUrl, urlToDataUrl } from "../utils/imageUtils";
import {
  StyleOption,
  ToneOption,
  VideoStyle,
  VideoRequestOptions,
} from "../types";
import { getGeminiClient, requireGeminiApiKey } from "./geminiClient";
import {
  generateImagePrompt,
  generateTextPrompt,
  generateFunPrompt,
  editImagePrompt,
  editTextPrompt,
  generateVideoPrompt,
} from "./promptConfig";

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
    model: "gemini-3-pro-preview",
    contents: { parts: imageParts },
    generationConfig: {
      responseModalities: [Modality.IMAGE],
    },
  });

  const imageContentPart = imageResponse.candidates?.[0]?.content?.parts[0];
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
    model: "gemini-3-pro-preview",
    contents: {
      parts: imageParts,
    },
    generationConfig: {
      responseModalities: [Modality.IMAGE],
    },
  });

  let newImageBase64 = "";
  const imageContentPart = imageResponse.candidates?.[0]?.content?.parts[0];
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

  const text = cleanGeneratedText(textResponse.text);
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

  const text = cleanGeneratedText(textResponse.text);
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
      generationConfig: { responseModalities: [Modality.IMAGE] },
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
  const imageContentPart = imageResponse.candidates?.[0]?.content?.parts[0];
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
  const apiKey = requireGeminiApiKey();
  // Always create a fresh client so we respect any runtime key change.
  const videoAi = new GoogleGenAI({ apiKey });

  const normalisedImage = await normaliseDataUrl(imageBase64Url);
  const { mimeType, data: base64Data } = parseDataUrl(normalisedImage);
  const image = { imageBytes: base64Data, mimeType };
  const prompt = generateVideoPrompt(style, options);

  const { width, height } = await getImageDimensions(imageBase64Url);
  const derivedAspect =
    width === height ? "1:1" : width > height ? "16:9" : "9:16";
  const aspectRatio =
    options.aspectPreference === "auto"
      ? derivedAspect
      : options.aspectPreference;
  const resolution = options.resolution || "720p";

  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      let operation: GenerateVideosOperation =
        await videoAi.models.generateVideos({
          model: "veo-3.1-generate-preview",
          prompt: prompt,
          image: image,
          config: {
            numberOfVideos: 1,
            resolution,
            aspectRatio: aspectRatio,
          },
        });

      while (!operation.done) {
        await new Promise((resolve) => setTimeout(resolve, 10000)); // Poll every 10 seconds
        operation = await videoAi.operations.getVideosOperation({
          operation: operation,
        });
      }

      if (operation.error) {
        const message =
          typeof operation.error === "object" &&
          operation.error !== null &&
          "message" in operation.error
            ? String(
                (operation.error as { message?: unknown }).message ??
                  "Video generation failed without an error message."
              )
            : "Video generation failed without an error message.";
        throw new Error(message);
      }

      const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;

      if (!downloadLink) {
        throw new Error(
          "Video generation succeeded, but no download link was provided."
        );
      }

      // Fetch the video as a blob and create a local URL.
      // This avoids needing the API key on the client-side for the video src tag.
      let downloadUrl: string;
      try {
        const url = new URL(downloadLink);
        url.searchParams.set("key", apiKey);
        downloadUrl = url.toString();
      } catch {
        const separator = downloadLink.includes("?") ? "&" : "?";
        downloadUrl = `${downloadLink}${separator}key=${encodeURIComponent(
          apiKey
        )}`;
      }

      const response = await fetch(downloadUrl);
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `Failed to download the generated video. Status: ${response.status}. Body: ${errorBody}`
        );
      }
      const videoBlob = await response.blob();
      return URL.createObjectURL(videoBlob); // Success, exit function
    } catch (error) {
      const errorMessage = (() => {
        if (error instanceof Error) return error.message;
        if (typeof error === "string") return error;
        try {
          return JSON.stringify(error);
        } catch {
          return "Unknown error occurred.";
        }
      })();

      if (
        errorMessage.toLowerCase().includes("overloaded") &&
        attempt < maxRetries
      ) {
        console.warn(
          `Attempt ${attempt} failed: Model overloaded. Retrying in ${
            attempt * 5
          } seconds...`
        );
        await sleep(attempt * 5000);
        continue;
      }

      // This was the last attempt, or it's a non-retryable error. Re-throw it.
      throw new Error(`Video generation failed: ${errorMessage}`);
    }
  }

  // This should not be reached if logic is correct, but is a fallback.
  throw new Error("Video generation failed after multiple retries.");
};
