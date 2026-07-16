import type { GeneratedPost } from "../types";
import { clearAllCreatives } from "./creativeStorage";

const STORAGE_KEY = "dealer-social-post-ai.session";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_STORED_IMAGE_BYTES = 500_000; // ~0.5MB safety cap per image

interface PersistedState {
  generatedPost?: Omit<GeneratedPost, "image"> & { image?: string };
  selectedImage?: string;
  dealerId?: string;
  step?: number;
  loginTimestamp?: number;
  compactMode?: boolean;
  preferredStyle?: string;
  preferredTone?: string;
  generationParams?: {
    style: string;
    tone: string;
    customerName: string;
    customText?: string;
    creativeBrief?: string;
  };
}

export const loadSession = (): PersistedState | null => {
  if (typeof window === "undefined") return null;
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
    clearSession();
    return null;
  }
};

export const saveSession = (state: PersistedState) => {
  if (typeof window === "undefined") return;
  try {
    const pruneImages = (session: PersistedState): PersistedState => {
      const next: PersistedState = { ...session };
      if (
        next.generatedPost?.image &&
        next.generatedPost.image.length > MAX_STORED_IMAGE_BYTES
      ) {
        next.generatedPost = { ...next.generatedPost, image: undefined };
      }
      if (
        next.selectedImage &&
        next.selectedImage.length > MAX_STORED_IMAGE_BYTES
      ) {
        next.selectedImage = undefined;
      }
      return next;
    };

    // Preserve the login timestamp if it exists, or set it if this is a new login
    const existingSession = loadSessionRaw();
    const sessionWithTimestamp: PersistedState = pruneImages({
      ...(existingSession ?? {}),
      ...state,
      loginTimestamp:
        state.loginTimestamp ?? existingSession?.loginTimestamp ?? Date.now(),
    });

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionWithTimestamp));
    } catch (err) {
      // On quota errors, retry without bulky images
      const slimmed = pruneImages({
        ...sessionWithTimestamp,
        generatedPost: sessionWithTimestamp.generatedPost
          ? { ...sessionWithTimestamp.generatedPost, image: undefined }
          : undefined,
        selectedImage: undefined,
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
    return stored ? (JSON.parse(stored) as PersistedState) : null;
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
