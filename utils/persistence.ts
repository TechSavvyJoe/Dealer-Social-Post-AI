import type { GeneratedPost } from "../types";
import { clearAllCreatives } from "./creativeStorage";

const STORAGE_KEY = "dealer-social-post-ai.session";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface PersistedState {
  generatedPost?: Omit<GeneratedPost, "image"> & { image?: string };
  selectedImage?: string;
  dealerId?: string;
  step?: number;
  loginTimestamp?: number;
  compactMode?: boolean;
  imageQualityTier?: "standard" | "studio";
  theme?: string;
  preferredStyle?: string;
  preferredTone?: string;
  generationParams?: {
    style: string;
    tone: string;
    customerName: string;
    customText?: string;
    creativeBrief?: string;
    platformIds?: string[];
  };
}

const withoutImageBytes = (session: PersistedState): PersistedState => ({
  ...session,
  generatedPost: session.generatedPost
    ? { ...session.generatedPost, image: undefined }
    : undefined,
  selectedImage: undefined,
});

const scrubLegacyImageBytes = (session: PersistedState): PersistedState => {
  const scrubbed = withoutImageBytes(session);
  if (session.selectedImage || session.generatedPost?.image) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(scrubbed));
    } catch {
      // Returning the scrubbed in-memory state still prevents reuse of legacy bytes.
    }
  }
  return scrubbed;
};

export const loadSession = (): PersistedState | null => {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;

    const session = scrubLegacyImageBytes(JSON.parse(stored) as PersistedState);

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
    clearSession();
    return null;
  }
};

export const saveSession = (state: PersistedState) => {
  if (typeof window === "undefined") return;
  try {
    // Preserve the login timestamp if it exists, or set it if this is a new login
    const existingSession = loadSessionRaw();
    const sessionWithTimestamp: PersistedState = withoutImageBytes({
      ...(existingSession ?? {}),
      ...state,
      loginTimestamp:
        state.loginTimestamp ?? existingSession?.loginTimestamp ?? Date.now(),
    });

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionWithTimestamp));
    } catch (err) {
      // Retry with workflow-heavy metadata removed, while images remain IndexedDB-only.
      const slimmed = withoutImageBytes({
        ...sessionWithTimestamp,
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(slimmed));
    }
  } catch {
    // ignore storage failures
  }
};

// Internal helper to load session without expiry check
const loadSessionRaw = (): PersistedState | null => {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? scrubLegacyImageBytes(JSON.parse(stored) as PersistedState) : null;
  } catch {
    return null;
  }
};

export const clearSession = () => {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore storage failures
  }
  void clearAllCreatives();
};
