export const MODELS = {
  text: {
    primary: 'gemini-3-flash-preview',
    fallback: 'gemini-3.1-flash-lite',
  },
  image: {
    primary: 'gemini-3.1-flash-image-preview',
    fallback: 'gemini-3-pro-image-preview',
  },
  imagen: {
    primary: 'imagen-4.0-generate-001',
  },
  video: {
    primary: 'veo-3.1-generate-preview',
    fast: 'veo-3.1-fast-generate-preview',
    lite: 'veo-3.1-lite-generate-preview',
  }
};

export const getModel = (type: keyof typeof MODELS, variant: 'primary' | 'fallback' | 'fast' | 'lite' = 'primary') => {
  const modelGroup = MODELS[type];
  if (!modelGroup) return '';
  return (modelGroup as any)[variant] || modelGroup.primary;
};