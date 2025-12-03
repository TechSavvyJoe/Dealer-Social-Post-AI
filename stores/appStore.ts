import { create } from "zustand";
import {
  AppStep,
  Dealer,
  GeneratedPost,
  StyleOption,
  ToneOption,
  GenerationParams,
} from "../types";
import { loadSession, saveSession, clearSession } from "../utils/persistence";
import { findDealer, findDealerById } from "../services/database";
import { logEvent, logError } from "../utils/telemetry";

interface AppState {
  // Core State
  step: AppStep;
  currentDealer: Dealer | null;
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

  login: async (dealerId: string) => {
    try {
      const dealer = await findDealer(dealerId);
      if (dealer) {
        // Handle logo URL conversion if needed (logic moved from App.tsx)
        // For now assuming findDealer handles it or it's fine

        // Optional admin code is configured via VITE_ADMIN_CODE to avoid hardcoded backdoors
        const configuredAdminCode =
          typeof import.meta !== "undefined"
            ? (import.meta as any).env?.VITE_ADMIN_CODE
            : undefined;
        const targetStep =
          configuredAdminCode && dealer.code === configuredAdminCode
            ? AppStep.ADMIN
            : AppStep.CAPTURE;

        set({
          currentDealer: dealer,
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
      logError("app.login.failed", { message: errorMessage, dealerId });
      set({
        error: "Login failed. Please check the dealer code and try again.",
      });
      return false;
    }
  },

  logout: () => {
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
    if (session?.dealerId) {
      try {
        // Use findDealerById since we store the record ID, not the code
        const dealer = await findDealerById(session.dealerId);
        if (dealer) {
          set({
            currentDealer: dealer,
            selectedImage: session.selectedImage || null,
            generatedPost:
              session.generatedPost && session.generatedPost.image
                ? {
                    image: session.generatedPost.image,
                    text: session.generatedPost.text,
                  }
                : null,
            generationParams: (session.generationParams ||
              null) as GenerationParams | null, // Load generationParams
            step: (typeof session.step === "number"
              ? session.step
              : session.generatedPost
              ? AppStep.RESULT
              : AppStep.CAPTURE) as AppStep,
            compactMode: session.compactMode ?? false,
          });
          logEvent("app.session.restored", {
            step: session.step,
            dealer: dealer.id,
          });
        } else {
          clearSession();
        }
      } catch (error) {
        clearSession();
        logError("app.session.restoreFailed", { message: String(error) });
      }
    } else {
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
    }
  },
}));
