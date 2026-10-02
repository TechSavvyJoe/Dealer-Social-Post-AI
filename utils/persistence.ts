import type { GeneratedPost, GenerationParams, PostDraft } from "../types";
import { clearAllCreatives } from "./creativeStorage";

const STORAGE_KEY = "dealer-social-post-ai.session";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface PersistedState {
  postDraft?: Omit<PostDraft, "personalLine">;
  generatedPost?: Omit<GeneratedPost, "image"> & { image?: string };
  selectedImage?: string;
  dealerId?: string;
  step?: number;
  loginTimestamp?: number;
  imageQualityTier?: "standard" | "studio";
  theme?: string;
  preferredStyle?: string;
  preferredTone?: string;
  generationParams?: Omit<GenerationParams, "style" | "tone"> & {
    // Storage is a JSON compatibility boundary; enum validation happens when
    // a restored editor consumes these legacy string values.
    style: string;
    tone: string;
  };
}

type PersistedGenerationParams = NonNullable<PersistedState["generationParams"]>;

/**
 * The Details draft a Cancel or a failed attempt carries back through the
 * customizer's remount is in memory only: a captured release holds the
 * customer's drawn signature, and the personal line is unposted free text.
 * Neither belongs in localStorage (or its quota), and a restored session must
 * never hand the customizer a release, so both are dropped on every save and
 * on every load.
 */
const carriesInMemoryDraft = (params: PersistedState["generationParams"]): boolean =>
  Boolean(params && ("capturedRelease" in params || "personalLine" in params));

const withoutInMemoryDraft = (
  params: PersistedGenerationParams,
): PersistedGenerationParams => {
  const {
    capturedRelease: _release,
    personalLine: _personalLine,
    ...storable
  } = params;
  return storable;
};

const withoutImageBytes = (session: PersistedState): PersistedState => ({
  ...session,
  postDraft: session.postDraft
    ? {
        categoryId: session.postDraft.categoryId,
        scenarioId: session.postDraft.scenarioId,
        decodedVehicle: session.postDraft.decodedVehicle,
      }
    : undefined,
  generatedPost: session.generatedPost
    ? { ...session.generatedPost, image: undefined }
    : undefined,
  selectedImage: undefined,
  generationParams: session.generationParams
    ? withoutInMemoryDraft(session.generationParams)
    : undefined,
});

const scrubLegacyImageBytes = (session: PersistedState): PersistedState => {
  const scrubbed = withoutImageBytes(session);
  if (
    session.selectedImage ||
    session.generatedPost?.image ||
    carriesInMemoryDraft(session.generationParams)
  ) {
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
    } catch {
      // Quota retry: drop the workflow-heavy fields (images are already
      // IndexedDB-only) so dealerId/step/preferences still persist.
      const slimmed: PersistedState = {
        ...sessionWithTimestamp,
        generatedPost: undefined,
        generationParams: undefined,
      };
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
