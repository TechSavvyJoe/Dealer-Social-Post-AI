import { useCallback, useState, useEffect } from 'react';
import { getGeminiApiKey, setGeminiApiKey as storeGeminiApiKey } from '../utils/settings';
import { configureGeminiClient, getActiveGeminiApiKey } from '../services/geminiClient';
import { enqueueTask } from '../services/requestQueue';
import { logEvent, logError } from '../utils/telemetry';
import { API_KEY_REQUIRED_MESSAGE } from '../utils/constants';

type GeminiServiceModule = typeof import('../services/geminiService');
let geminiServiceModulePromise: Promise<GeminiServiceModule> | null = null;

const loadGeminiService = (): Promise<GeminiServiceModule> => {
  if (!geminiServiceModulePromise) {
    geminiServiceModulePromise = import('../services/geminiService');
  }
  return geminiServiceModulePromise;
};

export const useGemini = (setError: (error: string | null) => void, setIsSettingsOpen: (isOpen: boolean) => void) => {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [hasStoredApiKey, setHasStoredApiKey] = useState(false);

  const isApiKeyConfigured = Boolean(apiKey);

  useEffect(() => {
    const storedKey = getGeminiApiKey();
    if (storedKey) {
      configureGeminiClient(storedKey);
      setApiKey(storedKey);
      setHasStoredApiKey(true);
    } else {
      const bootstrapKey = getActiveGeminiApiKey();
      if (bootstrapKey) setApiKey(bootstrapKey);
    }
  }, []);

  const ensureApiKeyReady = useCallback(() => {
    if (isApiKeyConfigured) {
      return true;
    }
    logError('app.apiKey.missing');
    setError(API_KEY_REQUIRED_MESSAGE);
    setIsSettingsOpen(true);
    return false;
  }, [isApiKeyConfigured, setError, setIsSettingsOpen]);

  const runGeminiTask = useCallback(async <T,>(name: string, task: () => Promise<T>, metadata?: Record<string, unknown>) => {
    logEvent(`${name}.start`, metadata);
    try {
      const result = await enqueueTask(task);
      logEvent(`${name}.success`, metadata);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError(`${name}.failure`, { ...metadata, message });
      throw error;
    }
  }, []);

  const handleSettingsSave = useCallback(({ apiKey: nextKey, remember }: { apiKey: string; remember: boolean; }) => {
    const sanitized = nextKey.trim();
    const resolvedKey = sanitized.length ? sanitized : null;
    if (resolvedKey && remember) {
      storeGeminiApiKey(resolvedKey);
      setHasStoredApiKey(true);
    } else {
      storeGeminiApiKey(undefined);
      setHasStoredApiKey(false);
    }
    configureGeminiClient(resolvedKey);
    setApiKey(resolvedKey);
    setIsSettingsOpen(false);
    setError(null);
  }, [setError, setIsSettingsOpen]);

  return {
    apiKey,
    hasStoredApiKey,
    isApiKeyConfigured,
    ensureApiKeyReady,
    runGeminiTask,
    loadGeminiService,
    handleSettingsSave,
    setApiKey // Exposed if needed for manual updates
  };
};
