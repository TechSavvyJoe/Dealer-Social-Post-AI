import { useCallback } from 'react';
import { enqueueTask } from '../services/requestQueue';
import { logEvent, logError } from '../utils/telemetry';

// Since the Gemini API key is now handled by the server-side proxy,
// this hook is greatly simplified. It no longer needs to manage the key.

type GeminiServiceModule = typeof import('../services/geminiService');
let geminiServiceModulePromise: Promise<GeminiServiceModule> | null = null;

const loadGeminiService = (): Promise<GeminiServiceModule> => {
  if (!geminiServiceModulePromise) {
    geminiServiceModulePromise = import('../services/geminiService');
  }
  return geminiServiceModulePromise;
};

export const useGemini = (
  // The setError and setIsSettingsOpen props are kept for compatibility,
  // though they are no longer used for API key validation.
  setError: (error: string | null) => void,
  setIsSettingsOpen: (isOpen: boolean) => void
) => {

  // The API is always considered configured because the key is on the server.
  const isApiKeyConfigured = true;

  // This check is now simplified to always return true.
  const ensureApiKeyReady = useCallback(() => {
    return true;
  }, []);

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

  // This function is now a no-op but is kept for compatibility.
  const handleSettingsSave = useCallback(() => {
    setIsSettingsOpen(false);
    setError(null);
  }, [setError, setIsSettingsOpen]);

  return {
    // These values are now constants as the key is server-side.
    apiKey: 'CONFIGURED_ON_SERVER',
    hasStoredApiKey: true,
    isApiKeyConfigured: true,
    
    // Core functionality remains
    ensureApiKeyReady,
    runGeminiTask,
    loadGeminiService,
    handleSettingsSave,

    // This is a no-op, kept for compatibility.
    setApiKey: () => {},
  };
};
