const STORAGE_KEY = 'dealer-social-post-ai.session';
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface PersistedState {
  generatedPost?: {
    image: string;
    text: string;
  };
  selectedImage?: string;
  dealerId?: string;
  step?: number;
  loginTimestamp?: number;
  compactMode?: boolean;
}

export const loadSession = (): PersistedState | null => {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    
    const session = JSON.parse(stored) as PersistedState;
    
    // Check if session has expired (7 days)
    if (session.loginTimestamp) {
      const now = Date.now();
      const elapsed = now - session.loginTimestamp;
      
      if (elapsed > SESSION_DURATION_MS) {
        // Session expired, clear it
        clearSession();
        return null;
      }
    }
    
    return session;
  } catch {
    return null;
  }
};

export const saveSession = (state: PersistedState) => {
  if (typeof window === 'undefined') return;
  try {
    // Preserve the login timestamp if it exists, or set it if this is a new login
    const existingSession = loadSessionRaw();
    const sessionWithTimestamp: PersistedState = {
      ...(existingSession ?? {}),
      ...state,
      loginTimestamp: state.loginTimestamp ?? existingSession?.loginTimestamp ?? Date.now()
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionWithTimestamp));
  } catch {
    // ignore storage failures
  }
};

// Internal helper to load session without expiry check
const loadSessionRaw = (): PersistedState | null => {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? (JSON.parse(stored) as PersistedState) : null;
  } catch {
    return null;
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
