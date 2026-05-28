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

interface AppState {
  // Core State
  step: AppStep;
  currentDealer: Dealer | null;
  role: UserRole;
  selectedImage: string | null;
  generatedPost: GeneratedPost | null;
  generationParams: GenerationParams | null;
  error: string | null;

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
    }>
  ) => void;

  // Complex Actions
  login: (dealerId: string) => Promise<boolean>;
  logout: () => void;
  reset: () => void;
  restoreSession: () => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  step: AppStep.LOGIN,
  currentDealer: null,
  role: "salesperson" as UserRole,
  selectedImage: null,
  generatedPost: null,
  generationParams: null,
  error: null,
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
      const res = await fetch("/api/app/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealerCode })
      });

      if (!res.ok) {
        throw new Error("Invalid dealer code");
      }

      const body = await res.json();
      const dealer = body.dealer;
      const serverRole: UserRole = (body.role as UserRole) || "salesperson";

      if (dealer) {
        // Route by server-supplied role. Three flows:
        //   super_admin → AppStep.ADMIN (manage all dealerships)
        //   dealer_admin → AppStep.DEALER_ADMIN (manage one dealership)
        //   salesperson → AppStep.CAPTURE (generate posts)
        let targetStep = AppStep.CAPTURE;
        if (serverRole === "super_admin") targetStep = AppStep.ADMIN;
        else if (serverRole === "dealer_admin") targetStep = AppStep.DEALER_ADMIN;

        set({
          currentDealer: dealer,
          role: serverRole,
          step: targetStep,
          error: null,
        });

        saveSession({
          dealerId: dealer.id,
          step: targetStep,
          loginTimestamp: Date.now(),
        });

        return true;
      }
      return false;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logError("app.login.failed", { message: errorMessage, dealerId: dealerCode });
      set({
        error: "Login failed. Please check the dealer code and try again.",
      });
      return false;
    }
  },

  logout: async () => {
    try {
      await fetch("/api/app/session", { method: "DELETE" });
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
  },

  reset: () => {
    set({
      generatedPost: null,
      selectedImage: null,
      error: null,
      step: AppStep.CAPTURE,
    });
    // Don't clear session entirely, just reset flow
    const { currentDealer } = get();
    if (currentDealer) {
      saveSession({ dealerId: currentDealer.id, step: AppStep.CAPTURE });
    }
  },

  restoreSession: async () => {
    const session = loadSession();
    try {
      const res = await fetch("/api/app/session", { method: "GET" });
      if (res.ok) {
        const body = await res.json();
        const dealer = body.dealer;
        const serverRole: UserRole = (body.role as UserRole) || "salesperson";
        if (dealer) {
          set({
            currentDealer: dealer,
            role: serverRole,
            selectedImage: session?.selectedImage || null,
            generatedPost:
              session?.generatedPost && session.generatedPost.image
                ? {
                    image: session.generatedPost.image,
                    text: session.generatedPost.text,
                  }
                : null,
            generationParams: (session?.generationParams ||
              null) as GenerationParams | null, // Load generationParams
            step: (typeof session?.step === "number"
              ? session.step
              : session?.generatedPost
              ? AppStep.RESULT
              : AppStep.CAPTURE) as AppStep,
            compactMode: session?.compactMode ?? false,
          });
          logEvent("app.session.restored", {
            step: session?.step,
            dealer: dealer.id,
          });
          return;
        }
      }
      // If we fall through, clear session
      clearSession();
    } catch (error) {
      clearSession();
      logError("app.session.restoreFailed", { message: String(error) });
    }

    // Restore standalone preferences if no full session
      if (session?.compactMode !== undefined) {
        set({ compactMode: session.compactMode });
      }
      if (session?.preferredStyle) {
        set({ preferredStyle: session.preferredStyle as StyleOption });
      }
      if (session?.preferredTone) {
        set({ preferredTone: session.preferredTone as ToneOption });
      }
  },
}));
