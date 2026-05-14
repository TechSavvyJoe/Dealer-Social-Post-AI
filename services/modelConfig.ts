export const MODEL_CONFIG = {
  // Text Models
  TEXT: "gemini-3-flash-preview",
  TEXT_FALLBACK: "gemini-3.1-flash-lite",

  // Image Models
  IMAGE: "gemini-3.1-flash-image-preview",
  IMAGE_FALLBACK: "gemini-3-pro-image-preview",
  IMAGEN: "imagen-4.0-generate-001",

  // Video Models
  VIDEO: "veo-3.1-generate-preview",
  VIDEO_FAST: "veo-3.1-fast-generate-preview",
  VIDEO_LITE: "veo-3.1-lite-generate-preview"
};

export const getModelWithFallback = (primary: string, fallback: string, useFallback: boolean) => {
  return useFallback ? fallback : primary;
};
