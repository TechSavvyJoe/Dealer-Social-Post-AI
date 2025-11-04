import { DealershipSettings } from '../types';

// Key for storing settings in the browser's local storage.
const SETTINGS_KEY = 'dealerSocialPostAiSettings';

/**
 * Saves the provided dealership settings to local storage, allowing them to persist across sessions.
 * @param settings The settings object to save.
 */
export const saveSettings = (settings: DealershipSettings): void => {
  try {
    const settingsJson = JSON.stringify(settings);
    localStorage.setItem(SETTINGS_KEY, settingsJson);
  } catch (error) {
    console.error("Could not save settings to localStorage", error);
  }
};

/**
 * Loads dealership settings from local storage.
 * @returns The saved settings object, or null if none are found or an error occurs.
 */
export const loadSettings = (): DealershipSettings | null => {
  try {
    const settingsJson = localStorage.getItem(SETTINGS_KEY);
    if (settingsJson === null) {
      return null;
    }
    return JSON.parse(settingsJson);
  } catch (error) {
    console.error("Could not load settings from localStorage", error);
    return null;
  }
};
