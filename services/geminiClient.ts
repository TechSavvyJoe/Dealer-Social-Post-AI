import { GoogleGenAI } from "@google/genai";

const sanitizeApiKey = (value?: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "undefined" || trimmed.toLowerCase() === "null") {
    return null;
  }
  return trimmed;
};

let activeApiKey: string | null = null;
let memoizedClient: GoogleGenAI | null = null;

export const configureGeminiClient = (apiKey?: string | null) => {
  const sanitized = sanitizeApiKey(apiKey);
  activeApiKey = sanitized;
  memoizedClient = sanitized ? new GoogleGenAI({ apiKey: sanitized }) : null;
};

export const getActiveGeminiApiKey = (): string | null => activeApiKey;

export const getGeminiClient = (): GoogleGenAI => {
  if (!activeApiKey) {
    throw new Error("Gemini API key is not configured. Add a valid key from the Settings panel before generating content.");
  }
  if (!memoizedClient) {
    memoizedClient = new GoogleGenAI({ apiKey: activeApiKey });
  }
  return memoizedClient;
};

export const requireGeminiApiKey = (): string => {
  if (!activeApiKey) {
    throw new Error("Gemini API key is not configured. Add a valid key from the Settings panel before generating content.");
  }
  return activeApiKey;
};

// Hard-coded API key for testing/development
const HARDCODED_API_KEY = "AIzaSyD5g64nF8GmSlDPcNBySnsms-lPEOQdqpE";
const defaultApiKey = sanitizeApiKey(HARDCODED_API_KEY ?? process.env.API_KEY ?? process.env.GEMINI_API_KEY);
configureGeminiClient(defaultApiKey);
