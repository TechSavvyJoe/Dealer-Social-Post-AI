import { create } from "zustand";
import {
  AppStep,
  Dealer,
  GeneratedPost,
  StyleOption,
  ToneOption,
  GenerationParams,
  UserRole,
} from "../types";
import { loadSession, saveSession, clearSession } from "../utils/persistence";
// Removed duplicate import
import { logEvent, logError } from "../utils/telemetry";
import {
  clearAllCreatives,
  clearDealerCreatives,
  loadDealerCreative,
  saveDealerCreative,
} from "../utils/creativeStorage";

interface AppState {
  // Core State
  step: AppStep;
  currentDealer: Dealer | null;
  role: UserRole;
  selectedImage: string | null;
  generatedPost: GeneratedPost | null;
  generationParams: GenerationParams | null;
  error: string | null;
  isRestoringSession: boolean;

  // Preferences
  preferredStyle: StyleOption;
  preferredTone: ToneOption;
  compactMode: boolean;

  // Actions
  setStep: (step: AppStep) => void;
  setCurrentDealer: (dealer: Dealer | null) => void;
  setSelectedImage: (image: string | null) => void;
  setGeneratedPost: (post: GeneratedPost | null) => void;
  setGenerationParams: (params: GenerationParams | null) => void;
  setError: (error: string | null) => void;
  setPreferences: (
    prefs: Partial<{
      preferredStyle: StyleOption;
      preferredTone: ToneOption;
      compactMode: boolean;
    }>,
  ) => void;

  // Complex Actions
  login: (dealerId: string) => Promise<boolean>;
  logout: () => Promise<void>;
  reset: () => void;
  restoreSession: () => Promise<void>;
}

const SESSION_REQUEST_TIMEOUT_MS = 8_000;

/** Keep an unavailable backend from trapping the entire app in startup UI. */
export const fetchSession = async (
  init: RequestInit = {},
  timeoutMs = SESSION_REQUEST_TIMEOUT_MS,
): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch("/api/app/session", {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
};

/**
 * Resolve persisted navigation against server-authoritative role and the data
 * that actually survived local-storage pruning. This prevents a large 2K
 * result from restoring to an empty RESULT screen and keeps a forged/stale
 * local step from opening an admin surface for the wrong role.
 */
export const resolveRestoredStep = (
  role: UserRole,
  persistedStep: number | undefined,
  hasSelectedImage: boolean,
  hasGeneratedPost: boolean,
): AppStep => {
  if (role === "super_admin") return AppStep.ADMIN;
  if (role === "dealer_admin") return AppStep.DEALER_ADMIN;

  const requestedStep =
    typeof persistedStep === "number"
      ? persistedStep
      : hasGeneratedPost
        ? AppStep.RESULT
        : AppStep.CAPTURE;

  if (requestedStep === AppStep.RESULT && hasGeneratedPost) {
    return AppStep.RESULT;
  }
  if (
    hasSelectedImage &&
    (requestedStep === AppStep.CUSTOMIZE ||
      requestedStep === AppStep.GENERATING ||
      requestedStep === AppStep.RESULT)
  ) {
    return AppStep.CUSTOMIZE;
  }
  return AppStep.CAPTURE;
};

export const useAppStore = create<AppState>((set, get) => ({
  step: AppStep.LOGIN,
  currentDealer: null,
  role: "salesperson" as UserRole,
  selectedImage: null,
  generatedPost: null,
  generationParams: null,
  error: null,
  isRestoringSession: true,
  preferredStyle: StyleOption.Modern,
  preferredTone: ToneOption.Excited,
  compactMode: false,

  setStep: (step) => {
    set({ step });
    const { currentDealer, generatedPost, selectedImage } = get();
    if (currentDealer) {
      saveSession({
        step,
        dealerId: currentDealer.id,
        generatedPost: generatedPost || undefined,
        selectedImage: selectedImage || undefined,
        generationParams: get().generationParams || undefined,
      });
    }
  },

  setCurrentDealer: (dealer) => set({ currentDealer: dealer }),

  setSelectedImage: (image) => {
    set({ selectedImage: image });
    const { currentDealer, step, generatedPost } = get();
    if (currentDealer) {
      void saveDealerCreative(currentDealer.id, "selected", image);
      saveSession({
        selectedImage: image || undefined,
        dealerId: currentDealer.id,
        step,
        generatedPost: generatedPost || undefined,
        generationParams: get().generationParams || undefined,
      });
    }
  },

  setGeneratedPost: (post) => {
    set({ generatedPost: post });
    const { currentDealer, step, selectedImage } = get();
    if (currentDealer) {
      void saveDealerCreative(
        currentDealer.id,
        "generated",
        post?.image || null,
      );
      saveSession({
        generatedPost: post || undefined,
        dealerId: currentDealer.id,
        step,
        selectedImage: selectedImage || undefined,
        generationParams: get().generationParams || undefined,
      });
    }
  },

  setGenerationParams: (params) => {
    set({ generationParams: params });
    const { currentDealer, step, selectedImage, generatedPost } = get();
    if (currentDealer) {
      saveSession({
        generationParams: params || undefined,
        dealerId: currentDealer.id,
        step,
        selectedImage: selectedImage || undefined,
        generatedPost: generatedPost || undefined,
      });
    }
  },

  setError: (error) => set({ error }),

  setPreferences: (prefs) => {
    set((state) => {
      const newState = { ...state, ...prefs };
      saveSession({
        compactMode: newState.compactMode,
        preferredStyle: newState.preferredStyle,
        preferredTone: newState.preferredTone,
      });
      return newState;
    });
  },

  login: async (dealerCode: string) => {
    try {
      const res = await fetchSession({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealerCode }),
      });

      if (!res.ok) {
        let serverMessage = "";
        try {
          const body = await res.json();
          serverMessage = (body?.error || "").toString();
        } catch {
          /* not json */
        }
        if (res.status === 400 || res.status === 401) {
          throw new Error("INVALID_DEALER_CODE");
        }
        if (res.status === 429 && serverMessage) {
          throw new Error(serverMessage);
        }
        throw new Error("SIGN_IN_UNAVAILABLE");
      }

      const body = await res.json();
      const dealer = body.dealer;
      const serverRole: UserRole = (body.role as UserRole) || "salesperson";

      if (dealer) {
        // A successful credential exchange starts a clean tenant workspace.
        // `saveSession` normally merges metadata, so without this explicit
        // boundary a workflow preserved during an outage could be relabeled
        // with another dealer id and restored after the next reload.
        clearSession();
        await clearAllCreatives();

        // Route by server-supplied role. Three flows:
        //   super_admin → AppStep.ADMIN (manage all dealerships)
        //   dealer_admin → AppStep.DEALER_ADMIN (manage one dealership)
        //   salesperson → AppStep.CAPTURE (generate posts)
        let targetStep = AppStep.CAPTURE;
        if (serverRole === "super_admin") targetStep = AppStep.ADMIN;
        else if (serverRole === "dealer_admin")
          targetStep = AppStep.DEALER_ADMIN;

        set({
          currentDealer: dealer,
          role: serverRole,
          step: targetStep,
          selectedImage: null,
          generatedPost: null,
          generationParams: null,
          error: null,
        });

        const preferences = get();
        saveSession({
          dealerId: dealer.id,
          step: targetStep,
          loginTimestamp: Date.now(),
          selectedImage: undefined,
          generatedPost: undefined,
          generationParams: undefined,
          compactMode: preferences.compactMode,
          preferredStyle: preferences.preferredStyle,
          preferredTone: preferences.preferredTone,
        });

        return true;
      }
      return false;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logError("app.login.failed", {
        message: errorMessage,
        codeLength: dealerCode.length,
      });
      const isTimeout =
        err instanceof DOMException && err.name === "AbortError";
      const userMessage =
        errorMessage === "INVALID_DEALER_CODE"
          ? "That access code was not recognized. Check it and try again."
          : isTimeout ||
              errorMessage === "SIGN_IN_UNAVAILABLE" ||
              err instanceof TypeError
            ? "The secure sign-in service is unavailable right now. Check your connection and try again."
            : errorMessage;
      set({
        error: userMessage,
      });
      return false;
    }
  },

  logout: async () => {
    const dealerId = get().currentDealer?.id;
    try {
      await fetchSession({ method: "DELETE" });
    } catch (err) {
      console.error("Logout error", err);
    }
    set({
      currentDealer: null,
      selectedImage: null,
      generatedPost: null,
      error: null,
      step: AppStep.LOGIN,
    });
    clearSession();
    if (dealerId) void clearDealerCreatives(dealerId);
  },

  reset: () => {
    const dealerId = get().currentDealer?.id;
    set({
      generatedPost: null,
      selectedImage: null,
      error: null,
      step: AppStep.CAPTURE,
    });
    // Don't clear session entirely, just reset flow
    const { currentDealer } = get();
    if (currentDealer) {
      saveSession({
        dealerId: currentDealer.id,
        step: AppStep.CAPTURE,
        selectedImage: undefined,
        generatedPost: undefined,
        generationParams: undefined,
      });
    }
    if (dealerId) void clearDealerCreatives(dealerId);
  },

  restoreSession: async () => {
    const session = loadSession();
    try {
      const res = await fetchSession({ method: "GET" });
      if (res.ok) {
        const body = await res.json();
        const dealer = body.dealer;
        const serverRole: UserRole = (body.role as UserRole) || "salesperson";
        if (dealer) {
          // Local creative belongs to the dealer that created it. If the
          // authoritative cookie now resolves to another dealer, retain only
          // non-sensitive preferences and start a clean workflow.
          const matchesPersistedDealer = session?.dealerId === dealer.id;
          const restoredSelectedImage = matchesPersistedDealer
            ? session?.selectedImage ||
              (await loadDealerCreative(dealer.id, "selected"))
            : null;
          const persistedGeneratedPost = matchesPersistedDealer
            ? session?.generatedPost
            : undefined;
          const restoredGeneratedImage = persistedGeneratedPost
            ? persistedGeneratedPost.image ||
              (await loadDealerCreative(dealer.id, "generated"))
            : null;
          const restoredGeneratedPost =
            persistedGeneratedPost && restoredGeneratedImage
              ? ({
                  ...persistedGeneratedPost,
                  image: restoredGeneratedImage,
                } as GeneratedPost)
              : null;
          const restoredStep = resolveRestoredStep(
            serverRole,
            matchesPersistedDealer ? session?.step : undefined,
            Boolean(restoredSelectedImage),
            Boolean(restoredGeneratedPost),
          );

          set({
            currentDealer: dealer,
            role: serverRole,
            selectedImage: restoredSelectedImage,
            generatedPost: restoredGeneratedPost,
            generationParams: (matchesPersistedDealer
              ? session?.generationParams || null
              : null) as GenerationParams | null,
            step: restoredStep,
            compactMode: session?.compactMode ?? false,
            // Restore saved style/tone for authenticated users too. These were
            // previously only restored in the unauthenticated fall-through
            // (which returns early above), so a logged-in user's preferences
            // silently reset to defaults on every reload.
            ...(session?.preferredStyle
              ? { preferredStyle: session.preferredStyle as StyleOption }
              : {}),
            ...(session?.preferredTone
              ? { preferredTone: session.preferredTone as ToneOption }
              : {}),
            isRestoringSession: false,
          });
          logEvent("app.session.restored", {
            step: restoredStep,
            dealer: dealer.id,
          });
          return;
        }
      }
      // Only an authoritative auth rejection clears stored workflow data.
      // Preserve it across temporary 5xx/network failures so recovery does
      // not itself destroy a salesperson's local work.
      if (res.status === 401 || res.status === 403) clearSession();
    } catch (error) {
      logError("app.session.restoreFailed", { message: String(error) });
    } finally {
      // Restore standalone preferences even when the API is unavailable, and
      // always release the blocking startup screen.
      if (session?.compactMode !== undefined) {
        set({ compactMode: session.compactMode });
      }
      if (session?.preferredStyle) {
        set({ preferredStyle: session.preferredStyle as StyleOption });
      }
      if (session?.preferredTone) {
        set({ preferredTone: session.preferredTone as ToneOption });
      }
      set({ isRestoringSession: false });
    }
  },
}));
