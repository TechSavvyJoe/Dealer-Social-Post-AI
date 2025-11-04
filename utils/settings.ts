import { DealershipSettings } from '../types';

const SETTINGS_KEY = 'dealershipSocialAiSettings';

export const saveSettings = (settings: DealershipSettings): void => {
  try {
    const settingsJson = JSON.stringify(settings);
    localStorage.setItem(SETTINGS_KEY, settingsJson);
  } catch (error) {
    console.error("Could not save settings to localStorage", error);
  }
};

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
