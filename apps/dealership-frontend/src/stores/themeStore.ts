import { create } from 'zustand';
import { storage } from '../lib/utils';
import { STORAGE_KEYS } from '../config/constants';

type Theme = 'light' | 'dark' | 'system';

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const getSystemTheme = (): 'light' | 'dark' => {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

const applyTheme = (theme: Theme) => {
  const root = window.document.documentElement;
  const effectiveTheme = theme === 'system' ? getSystemTheme() : theme;

  root.classList.remove('light', 'dark');
  root.classList.add(effectiveTheme);
};

export const useThemeStore = create<ThemeState>((set, get) => {
  const savedTheme = storage.get<Theme>(STORAGE_KEYS.THEME) || 'system';

  // Apply theme on init
  if (typeof window !== 'undefined') {
    applyTheme(savedTheme);
  }

  return {
    theme: savedTheme,

    setTheme: (theme) => {
      storage.set(STORAGE_KEYS.THEME, theme);
      applyTheme(theme);
      set({ theme });
    },

    toggleTheme: () => {
      const current = get().theme;
      const next = current === 'light' ? 'dark' : 'light';
      get().setTheme(next);
    },
  };
});

// Listen for system theme changes
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const { theme, setTheme } = useThemeStore.getState();
    if (theme === 'system') {
      applyTheme('system');
    }
  });
}
