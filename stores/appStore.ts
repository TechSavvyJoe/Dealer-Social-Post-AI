import { create } from "zustand";
import {
  AppStep,
  Dealer,
  GeneratedPost,
  StyleOption,
  ToneOption,
  GenerationParams,
  UserRole,
  ImageQualityTier,
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
import type { PersonSummary } from "../services/salespeople";
import {
  exitImpersonation as exitImpersonationApi,
  impersonatePerson as impersonatePersonApi,
} from "../services/salespeople";
import {
  ApiError,
  asSessionErrorCode,
  readApiError,
  type SessionErrorCode,
} from "../services/apiErrors";

export interface LoginResult {
  ok: boolean;
  code?: SessionErrorCode;
  message?: string;
  retryAfterSeconds?: number;
}

interface AppState {
  // Core State
  step: AppStep;
  currentDealer: Dealer | null;
  role: UserRole;
  currentPerson: PersonSummary | null;
  isImpersonating: boolean;
  selectedImage: string | null;
  generatedPost: GeneratedPost | null;
  generationParams: GenerationParams | null;
  error: string | null;
  isRestoringSession: boolean;

  // Preferences
  theme: "dark" | "light" | "system";
  preferredStyle: StyleOption;
  preferredTone: ToneOption;
  compactMode: boolean;
  imageQualityTier: ImageQualityTier;

  // Actions
  setStep: (step: AppStep) => void;
  setCurrentDealer: (dealer: Dealer | null) => void;
  setSelectedImage: (image: string | null) => void;
  setGeneratedPost: (post: GeneratedPost | null) => void;
  setGenerationParams: (params: GenerationParams | null) => void;
  setError: (error: string | null) => void;
  setPreferences: (
    prefs: Partial<{
      theme: "dark" | "light" | "system";
      preferredStyle: StyleOption;
      preferredTone: ToneOption;
      compactMode: boolean;
      imageQualityTier: ImageQualityTier;
    }>,
  ) => void;

  // Complex Actions
  login: (dealerCode: string, turnstileToken?: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
  reset: () => void;
  /**
   * Same-photo remix: keep the selected capture (and any still-valid session
   * metadata) but discard the generated result so the user can re-pick style
   * and generate again from CUSTOMIZE.
   */
  startRemix: () => void;
  restoreSession: () => Promise<void>;
  applyAuthPayload: (body: {
    role?: string;
    dealer?: Dealer;
    person?: PersonSummary | null;
    is_impersonation?: boolean;
  }) => void;
  impersonatePerson: (personId: string) => Promise<void>;
  exitImpersonation: () => Promise<void>;
}

const stepForRole = (role: UserRole): AppStep => {
  if (role === "super_admin") return AppStep.ADMIN;
  if (role === "dealer_admin") return AppStep.DEALER_ADMIN;
  return AppStep.CAPTURE;
};

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
  currentPerson: null,
  isImpersonating: false,
  selectedImage: null,
  generatedPost: null,
  generationParams: null,
  error: null,
  isRestoringSession: true,
  theme: "system",
  preferredStyle: StyleOption.Modern,
  preferredTone: ToneOption.Excited,
  compactMode: false,
  imageQualityTier: "standard",

  applyAuthPayload: (body) => {
    const dealer = body.dealer || null;
    const serverRole: UserRole = (body.role as UserRole) || "salesperson";
    const targetStep = stepForRole(serverRole);
    set({
      currentDealer: dealer,
      role: serverRole,
      currentPerson: body.person || null,
      isImpersonating: !!body.is_impersonation,
      step: targetStep,
      selectedImage: null,
      generatedPost: null,
      generationParams: null,
      error: null,
    });
    if (dealer) {
      const preferences = get();
      saveSession({
        dealerId: dealer.id,
        step: targetStep,
        loginTimestamp: Date.now(),
        selectedImage: undefined,
        generatedPost: undefined,
        generationParams: undefined,
        compactMode: preferences.compactMode,
        imageQualityTier: preferences.imageQualityTier,
        theme: preferences.theme,
        preferredStyle: preferences.preferredStyle,
        preferredTone: preferences.preferredTone,
      });
    }
  },

  impersonatePerson: async (personId: string) => {
    const body = await impersonatePersonApi(personId);
    clearSession();
    await clearAllCreatives();
    get().applyAuthPayload({
      role: body.role,
      dealer: body.dealer as Dealer,
      person: body.person || null,
      is_impersonation: true,
    });
  },

  exitImpersonation: async () => {
    const body = await exitImpersonationApi();
    clearSession();
    await clearAllCreatives();
    get().applyAuthPayload({
      role: body.role,
      dealer: body.dealer as Dealer,
      person: null,
      is_impersonation: false,
    });
  },

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
      void saveDealerCreative(currentDealer.id, "generated", post?.image || null);
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
        theme: newState.theme,
        compactMode: newState.compactMode,
        imageQualityTier: newState.imageQualityTier,
        preferredStyle: newState.preferredStyle,
        preferredTone: newState.preferredTone,
      });
      return newState;
    });
  },

  login: async (dealerCode: string, turnstileToken?: string) => {
    try {
      const res = await fetchSession({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealerCode,
          ...(turnstileToken ? { turnstileToken } : {}),
        }),
      });

      if (!res.ok) {
        throw await readApiError(res);
      }

      const body = await res.json();
      const dealer = body.dealer;

      if (dealer) {
        // A successful credential exchange starts a clean tenant workspace.
        // `saveSession` normally merges metadata, so without this explicit
        // boundary a workflow preserved during an outage could be relabeled
        // with another dealer id and restored after the next reload.
        clearSession();
        await clearAllCreatives();
        get().applyAuthPayload({
          role: body.role,
          dealer,
          person: body.person || null,
          is_impersonation: !!body.is_impersonation,
        });
        return { ok: true };
      }
      throw new ApiError("Sign-in response did not include a dealership.", {
        code: "UNAVAILABLE",
        status: 503,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const isTimeout = err instanceof DOMException && err.name === "AbortError";
      const code = isTimeout
        ? "UNAVAILABLE"
        : err instanceof ApiError
          ? asSessionErrorCode(err.code)
          : "UNAVAILABLE";
      const retryAfterSeconds =
        err instanceof ApiError ? err.retryAfterSeconds : undefined;
      logError("app.login.failed", {
        errorCode: code,
        codeLength: dealerCode.length,
      });
      const userMessage =
        code === "INVALID_CODE"
          ? "That access code was not recognized. Check it and try again."
          : code === "CHALLENGE_REQUIRED"
            ? "Complete the security check to continue."
            : code === "LOCKED"
              ? "Too many attempts. Sign-in is temporarily locked."
              : "The secure sign-in service is unavailable right now. Check your connection and try again.";
      set({
        error: userMessage,
      });
      return {
        ok: false,
        code,
        message:
          code === "UNAVAILABLE" && errorMessage && !isTimeout
            ? userMessage
            : userMessage,
        retryAfterSeconds,
      };
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
      currentPerson: null,
      isImpersonating: false,
      selectedImage: null,
      generatedPost: null,
      error: null,
      step: AppStep.LOGIN,
      role: "salesperson",
    });
    clearSession();
    if (dealerId) void clearDealerCreatives(dealerId);
  },

  reset: () => {
    const dealerId = get().currentDealer?.id;
    const role = get().role;
    // Managers/super-admin return to their dashboards; sales floor → capture.
    const nextStep =
      role === "super_admin"
        ? AppStep.ADMIN
        : role === "dealer_admin"
          ? AppStep.DEALER_ADMIN
          : AppStep.CAPTURE;
    set({
      generatedPost: null,
      selectedImage: null,
      error: null,
      step: nextStep,
    });
    // Don't clear session entirely, just reset flow
    const { currentDealer } = get();
    if (currentDealer) {
      saveSession({
        dealerId: currentDealer.id,
        step: nextStep,
        selectedImage: undefined,
        generatedPost: undefined,
        generationParams: undefined,
      });
    }
    if (dealerId) void clearDealerCreatives(dealerId);
  },

  startRemix: () => {
    const { currentDealer, selectedImage, generationParams } = get();
    // Without a capture there is nothing to remix — fall back to a full reset.
    if (!selectedImage) {
      get().reset();
      return;
    }
    set({
      generatedPost: null,
      error: null,
      step: AppStep.CUSTOMIZE,
    });
    if (currentDealer) {
      saveSession({
        dealerId: currentDealer.id,
        step: AppStep.CUSTOMIZE,
        selectedImage,
        generatedPost: undefined,
        // Style/tone/customerName still useful as soft defaults if the
        // customizer later re-hydrates from session; preferredStyle/Tone
        // already cover the main picker defaults.
        generationParams: generationParams || undefined,
      });
      // Drop only the generated creative; keep the selected capture on disk.
      void saveDealerCreative(currentDealer.id, "generated", null);
    }
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
            currentPerson: (body.person as PersonSummary | undefined) || null,
            isImpersonating: !!body.is_impersonation,
            selectedImage: restoredSelectedImage,
            generatedPost: restoredGeneratedPost,
            generationParams: (matchesPersistedDealer
              ? session?.generationParams || null
              : null) as GenerationParams | null,
            step: restoredStep,
            compactMode: session?.compactMode ?? false,
            imageQualityTier: session?.imageQualityTier ?? "standard",
            ...(session?.theme
              ? { theme: session.theme as "dark" | "light" | "system" }
              : {}),
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
      if (session?.imageQualityTier) {
        set({ imageQualityTier: session.imageQualityTier });
      }
      if (session?.theme) {
        set({ theme: session.theme as "dark" | "light" | "system" });
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
