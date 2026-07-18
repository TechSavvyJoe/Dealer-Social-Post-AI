import { StyleOption, ToneOption } from "../types";

const STORAGE_KEY = "dealer-social-post-ai.settings";

export interface AppSettings {
  geminiApiKey?: string;
  lastStyle?: StyleOption;
  lastTone?: ToneOption;
}

const DEFAULT_SETTINGS: AppSettings = {};

let cachedSettings: AppSettings | null = null;

const isBrowser = typeof window !== "undefined" && typeof localStorage !== "undefined";

const hydrateSettings = (): AppSettings => {
  if (!isBrowser) {
    return { ...DEFAULT_SETTINGS };
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return { ...DEFAULT_SETTINGS };
    }
    const parsed = JSON.parse(stored) as AppSettings;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch (error) {
    console.warn("Failed to parse saved settings. Falling back to defaults.", error);
    return { ...DEFAULT_SETTINGS };
  }
};

const persistSettings = (settings: AppSettings) => {
  cachedSettings = { ...settings };
  if (!isBrowser) return;
  try {
    const hasValues = Object.values(settings).some((value) => value !== undefined);
    if (!hasValues) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }
  } catch (error) {
    console.warn("Failed to persist settings.", error);
  }
};

export const getSettings = (): AppSettings => {
  if (cachedSettings) {
    return { ...cachedSettings };
  }
  const settings = hydrateSettings();
  cachedSettings = { ...settings };
  return { ...cachedSettings };
};

export const updateSettings = (partial: Partial<AppSettings>): AppSettings => {
  const current = { ...getSettings(), ...partial };
  (Object.keys(current) as (keyof AppSettings)[]).forEach((key) => {
    if (current[key] === undefined) {
      delete current[key];
    }
  });
  persistSettings(current);
  return { ...current };
};

export const clearSettings = () => {
  persistSettings({});
};

export const getGeminiApiKey = (): string | undefined => {
  const { geminiApiKey } = getSettings();
  return geminiApiKey;
};

export const setGeminiApiKey = (apiKey: string | null | undefined) => {
  const trimmed = apiKey?.trim();
  if (!trimmed) {
    updateSettings({ geminiApiKey: undefined });
    return;
  }
  updateSettings({ geminiApiKey: trimmed });
};

export const saveLastSelections = (style?: StyleOption, tone?: ToneOption) => {
  updateSettings({
    lastStyle: style ?? undefined,
    lastTone: tone ?? undefined,
  });
};

export const getLastSelections = (): Pick<AppSettings, "lastStyle" | "lastTone"> => {
  const { lastStyle, lastTone } = getSettings();
  return { lastStyle, lastTone };
};
