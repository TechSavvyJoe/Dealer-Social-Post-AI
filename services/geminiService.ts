// FIX: Replaced 'GenerateVideosOperationResponse' with the correct 'GenerateVideosOperation' type.
import { GoogleGenAI, GenerateVideosOperation } from "@google/genai";
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
    // Use the absolute latest Imagen model as requested
    model: "imagen-4.0-generate",
    contents: { parts: imageParts },
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
    // Use image-capable model so we actually receive inline image data back.
    model: "imagen-4.0-generate",
    contents: {
      parts: imageParts,
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
    model: "gemini-3-pro",
    contents: { parts: [imagePart, { text: textPrompt }] },
  });

  const text = cleanGeneratedText(textResponse.text());
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
    model: "gemini-3-pro",
    contents: { parts: [{ text: prompt }] },
  });

  const text = cleanGeneratedText(textResponse.text());
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
      model: "imagen-4.0-generate",
      contents: { parts: imageParts },
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
  // Use the proxied client instead of the direct SDK client
  const videoAi = getGeminiClient();

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
        (await videoAi.models.generateVideos({
          model: "veo-3.0-generate",
          prompt: prompt,
          image: image,
          config: {
            numberOfVideos: 1,
            resolution,
            aspectRatio: aspectRatio,
          },
        })) as any;

      while (!operation.done) {
        await new Promise((resolve) => setTimeout(resolve, 10000)); // Poll every 10 seconds
        // Cast to any to bypass strict type check on the mock client return
        operation = (await videoAi.operations.getVideosOperation({
          operation: operation as any,
        })) as any;
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
      // The proxy handles the key, so we don't need to append it here for the downloadUrl
      // if the proxy handles the download. However, the downloadLink is likely a direct Google URL.
      // Since we can't expose the key, we should proxy the download too, or if the link is public/signed.
      // Actually, for Veo, the link usually requires the key.
      // Since we don't have the key on the client, we need to use a proxy endpoint for this too.
      // For now, let's assume the proxy client handles this or we need a workaround.
      // WAIT: The previous code used `apiKey` which is now gone.
      // We can use the proxy to fetch the video content.

      const downloadUrl = downloadLink;
      let finalVideoUrl = downloadUrl;

      // If the URL is a Google API URL, we need to proxy it to attach the key
      if (downloadUrl.includes("generativelanguage.googleapis.com")) {
        try {
          // Extract the path part (e.g., v1beta/files/...) including query params
          const urlObj = new URL(downloadUrl);
          const path = urlObj.pathname.substring(1) + urlObj.search; // Preserve query params like ?alt=media

          // Use the proxy client to fetch the video blob
          const response = await fetch(`/api/proxy/${path}`);
          if (!response.ok) throw new Error("Failed to fetch video via proxy");
          const blob = await response.blob();
          finalVideoUrl = URL.createObjectURL(blob);
        } catch (e) {
          console.error("Failed to proxy video download:", e);
          // Fallback to direct link (might fail if key is required)
        }
      } else {
        // Try fetching directly if it's not a google API url (unlikely for Veo)
        const response = await fetch(downloadUrl);
        if (response.ok) {
          const blob = await response.blob();
          finalVideoUrl = URL.createObjectURL(blob);
        }
      }

      return finalVideoUrl;
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
