const STORAGE_KEY = 'dealer-social-post-ai.session';

interface PersistedState {
  generatedPost?: {
    image: string;
    text: string;
  };
  selectedImage?: string;
  dealerId?: string;
  step?: number;
}

export const loadSession = (): PersistedState | null => {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? (JSON.parse(stored) as PersistedState) : null;
  } catch {
    return null;
  }
};

export const saveSession = (state: PersistedState) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage failures
  }
};

export const clearSession = () => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore storage failures
  }
};
