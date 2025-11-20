import { create } from 'zustand';
import { AppStep, Dealer, GeneratedPost, StyleOption, ToneOption } from '../types';
import { loadSession, saveSession, clearSession } from '../utils/persistence';
import { findDealer } from '../services/database';
import { logEvent, logError } from '../utils/telemetry';

interface AppState {
  // Core State
  step: AppStep;
  currentDealer: Dealer | null;
  selectedImage: string | null;
  generatedPost: GeneratedPost | null;
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
  setError: (error: string | null) => void;
  setPreferences: (prefs: Partial<{ preferredStyle: StyleOption; preferredTone: ToneOption; compactMode: boolean }>) => void;
  
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
  error: null,
  preferredStyle: StyleOption.Modern,
  preferredTone: ToneOption.Excited,
  compactMode: false,

  setStep: (step) => {
    set({ step });
    const { currentDealer, generatedPost, selectedImage } = get();
    if (currentDealer) {
      saveSession({ step, dealerId: currentDealer.id, generatedPost: generatedPost || undefined, selectedImage: selectedImage || undefined });
    }
  },

  setCurrentDealer: (dealer) => set({ currentDealer: dealer }),
  
  setSelectedImage: (image) => {
    set({ selectedImage: image });
    const { currentDealer, step, generatedPost } = get();
    if (currentDealer) {
      saveSession({ selectedImage: image || undefined, dealerId: currentDealer.id, step, generatedPost: generatedPost || undefined });
    }
  },

  setGeneratedPost: (post) => {
    set({ generatedPost: post });
    const { currentDealer, step, selectedImage } = get();
    if (currentDealer) {
      saveSession({ generatedPost: post || undefined, dealerId: currentDealer.id, step, selectedImage: selectedImage || undefined });
    }
  },

  setError: (error) => set({ error }),

  setPreferences: (prefs) => {
    set((state) => {
      const newState = { ...state, ...prefs };
      if (prefs.compactMode !== undefined) {
        saveSession({ compactMode: prefs.compactMode });
      }
      return newState;
    });
  },

  login: async (dealerId: string) => {
    try {
      const dealer = await findDealer(dealerId);
      if (dealer) {
        // Handle logo URL conversion if needed (logic moved from App.tsx)
        // For now assuming findDealer handles it or it's fine
        
        const targetStep = dealer.id === '0000' ? AppStep.ADMIN : AppStep.CAPTURE;
        
        set({ 
          currentDealer: dealer, 
          step: targetStep, 
          error: null 
        });

        saveSession({
          dealerId: dealer.id,
          step: targetStep,
          loginTimestamp: Date.now()
        });
        
        return true;
      }
      return false;
    } catch (err) {
      console.error("Login failed", err);
      return false;
    }
  },

  logout: () => {
    set({
      currentDealer: null,
      selectedImage: null,
      generatedPost: null,
      error: null,
      step: AppStep.LOGIN
    });
    clearSession();
  },

  reset: () => {
    set({
      generatedPost: null,
      selectedImage: null,
      error: null,
      step: AppStep.CAPTURE
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
        const dealer = await findDealer(session.dealerId);
        if (dealer) {
          set({
            currentDealer: dealer,
            selectedImage: session.selectedImage || null,
            generatedPost: session.generatedPost || null,
            step: (typeof session.step === 'number' ? session.step : (session.generatedPost ? AppStep.RESULT : AppStep.CAPTURE)) as AppStep,
            compactMode: session.compactMode ?? false
          });
          logEvent('app.session.restored', { step: session.step, dealer: dealer.id });
        } else {
          clearSession();
        }
      } catch (error) {
        clearSession();
        logError('app.session.restoreFailed', { message: String(error) });
      }
    } else if (session?.compactMode !== undefined) {
      set({ compactMode: session.compactMode });
    }
  }
}));
