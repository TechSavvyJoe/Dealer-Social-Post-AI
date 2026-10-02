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
  PostDraft,
  PendingRelease,
  ImageSelection,
} from "../types";
import { loadSession, saveSession, clearSession } from "../utils/persistence";
import { setProxyCapabilities } from "../services/proxyCapabilities";
import { MODEL_POLICY_VERSION } from "../services/modelConfig";
// Removed duplicate import
import { logEvent, logError } from "../utils/telemetry";
import {
  archiveDealerMedia,
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
import { AUTH_SESSION_REJECTED_EVENT, setActiveAuthEpoch } from "../utils/authBoundary";
import { setActiveSalespersonName } from "../utils/identityContext";

export interface LoginResult {
  ok: boolean;
  code?: SessionErrorCode;
  message?: string;
  retryAfterSeconds?: number;
}

export type SessionLoginRequest =
  | { authType: "code"; dealerCode: string }
  | { authType: "manager_password"; username: string; password: string }
  | { authType: "admin_password"; username: string; password: string };

/**
 * The store a device last signed into. Sent as an optional hint with personal
 * access-code logins so the backend can scope its lookup to this dealership;
 * deliberately kept outside the session payload so logout does not clear it.
 */
const LAST_DEALER_STORAGE_KEY = "dealer-social-post-ai.last-dealer-id";

const readRememberedDealerId = (): string => {
  try {
    const value = localStorage.getItem(LAST_DEALER_STORAGE_KEY) || "";
    return /^[a-z0-9]{15}$/.test(value) ? value : "";
  } catch {
    return "";
  }
};

const rememberDealerId = (dealerId: string): void => {
  try {
    if (/^[a-z0-9]{15}$/.test(dealerId)) {
      localStorage.setItem(LAST_DEALER_STORAGE_KEY, dealerId);
    }
  } catch {
    // Private-mode storage failures only cost the scoping hint.
  }
};

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
  postDraft: PostDraft | null;
  pendingRelease: PendingRelease | null;
  pendingPhoto: ImageSelection | null;
  postWorkAtRisk: boolean;
  postReturnStep: AppStep | null;
  error: string | null;
  isRestoringSession: boolean;
  /** Monotonic identity boundary used to discard stale async provider results. */
  authEpoch: number;

  // Preferences
  theme: "dark" | "light" | "system";
  preferredStyle: StyleOption;
  preferredTone: ToneOption;
  imageQualityTier: ImageQualityTier;

  // Actions
  setStep: (step: AppStep) => void;
  setCurrentDealer: (dealer: Dealer | null) => void;
  setSelectedImage: (image: string | null) => void;
  setGeneratedPost: (
    post: GeneratedPost | null,
    options?: { archive?: boolean },
  ) => void;
  setGenerationParams: (params: GenerationParams | null) => void;
  setError: (error: string | null) => void;
  setPostDraft: (draft: PostDraft | null) => void;
  setPendingRelease: (release: PendingRelease | null) => void;
  setPendingPhoto: (photo: ImageSelection | null) => void;
  setPostWorkAtRisk: (atRisk: boolean) => void;
  setPostReturnStep: (step: AppStep | null) => void;
  setPreferences: (
    prefs: Partial<{
      theme: "dark" | "light" | "system";
      preferredStyle: StyleOption;
      preferredTone: ToneOption;
      imageQualityTier: ImageQualityTier;
    }>,
  ) => void;

  // Complex Actions
  login: (
    credentials: SessionLoginRequest,
    turnstileToken?: string,
  ) => Promise<LoginResult>;
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
    capabilities?: unknown;
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

export const resolveRestoredCustomerIdentityRequired = (
  generatedPostValue?: boolean,
  generationParamsValue?: boolean,
): boolean => generatedPostValue ?? generationParamsValue ?? true;

/**
 * Creatives recovered directly from private browser storage do not pass back
 * through History. Treat missing/older on-pixel provenance as quarantined,
 * while preserving an explicit server-derived review result saved by the
 * current client.
 */
export const resolveRestoredImageReviewRequired = (
  savedReviewRequired: boolean | undefined,
  savedModelPolicyVersion: string | undefined,
): boolean => savedReviewRequired ?? savedModelPolicyVersion !== MODEL_POLICY_VERSION;
const AUTH_BOUNDARY_STORAGE_KEY = "__dsp_auth_boundary_v1";
const AUTH_BOUNDARY_CHANNEL = "dealer-social-auth-boundary";
const authBoundaryChannel =
  typeof window !== "undefined" && typeof window.BroadcastChannel !== "undefined"
    ? new window.BroadcastChannel(AUTH_BOUNDARY_CHANNEL)
    : null;

const publishAuthBoundary = (): void => {
  const value = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  try {
    localStorage.setItem(AUTH_BOUNDARY_STORAGE_KEY, value);
  } catch {
    // BroadcastChannel still covers modern private-browsing contexts.
  }
  authBoundaryChannel?.postMessage({ value });
};

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

  if (requestedStep === AppStep.WORK) return AppStep.WORK;
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
  postDraft: null,
  pendingRelease: null,
  pendingPhoto: null,
  postWorkAtRisk: false,
  postReturnStep: null,
  error: null,
  isRestoringSession: true,
  authEpoch: 0,
  // Seed the theme synchronously from the persisted session so light-mode
  // users don't flash dark between mount and the async restore resolving.
  // New installs still open in the dealership-studio dark theme.
  theme: ((): "dark" | "light" | "system" => {
    try {
      const persisted = loadSession()?.theme;
      return persisted === "light" || persisted === "system" ? persisted : "dark";
    } catch {
      return "dark";
    }
  })(),
  preferredStyle: StyleOption.Modern,
  preferredTone: ToneOption.Excited,
  imageQualityTier: "standard",

  applyAuthPayload: (body) => {
    // Replace, never merge: a session from an older backend advertises nothing.
    setProxyCapabilities((body as { capabilities?: unknown }).capabilities);
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
      postDraft: null,
      pendingRelease: null,
      pendingPhoto: null,
      postWorkAtRisk: false,
      postReturnStep: null,
      error: null,
      authEpoch: get().authEpoch + 1,
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
        postDraft: undefined,
        imageQualityTier: preferences.imageQualityTier,
        theme: preferences.theme,
        preferredStyle: preferences.preferredStyle,
        preferredTone: preferences.preferredTone,
      });
    }
    publishAuthBoundary();
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
      capabilities: body.capabilities,
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
      capabilities: body.capabilities,
    });
  },

  setStep: (step) => {
    const startsNewCapture = step === AppStep.CAPTURE;
    set(
      startsNewCapture
        ? {
            step,
            generationParams: null,
            postDraft: null,
            pendingRelease: null,
            pendingPhoto: null,
            postWorkAtRisk: false,
            postReturnStep: null,
          }
        : { step },
    );
    const { currentDealer, generatedPost, selectedImage } = get();
    if (currentDealer) {
      saveSession({
        step,
        dealerId: currentDealer.id,
        generatedPost: generatedPost || undefined,
        selectedImage: selectedImage || undefined,
        postDraft: startsNewCapture ? undefined : get().postDraft || undefined,
        generationParams: startsNewCapture
          ? undefined
          : get().generationParams || undefined,
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

  setGeneratedPost: (post, options) => {
    const previousImage = get().generatedPost?.image;
    set({ generatedPost: post });
    const { currentDealer, step, selectedImage } = get();
    if (currentDealer) {
      void saveDealerCreative(currentDealer.id, "generated", post?.image || null);
      if (post?.image && post.image !== previousImage && options?.archive !== false) {
        void archiveDealerMedia(currentDealer.id, {
          kind: "generated-image",
          source: post.image,
          label: "Generated image",
        });
      }
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

  setPostDraft: (postDraft) => {
    set({ postDraft });
    saveSession({ postDraft: postDraft || undefined });
  },
  setPendingRelease: (pendingRelease) => set({ pendingRelease }),
  setPendingPhoto: (pendingPhoto) => set({ pendingPhoto }),
  setPostWorkAtRisk: (postWorkAtRisk) => set({ postWorkAtRisk }),
  setPostReturnStep: (postReturnStep) => set({ postReturnStep }),
  setError: (error) => set({ error }),

  setPreferences: (prefs) => {
    set((state) => {
      const newState = { ...state, ...prefs };
      saveSession({
        theme: newState.theme,
        imageQualityTier: newState.imageQualityTier,
        preferredStyle: newState.preferredStyle,
        preferredTone: newState.preferredTone,
      });
      return newState;
    });
  },

  login: async (credentials: SessionLoginRequest, turnstileToken?: string) => {
    try {
      const loginBody =
        credentials.authType === "manager_password" ||
        credentials.authType === "admin_password"
          ? {
              authType: credentials.authType,
              username: credentials.username.trim().toLowerCase(),
              // Passwords are exact credentials; preserve case, whitespace,
              // punctuation, and password-manager supplied values.
              password: credentials.password,
            }
          : (() => {
              const rememberedDealerId = readRememberedDealerId();
              return {
                dealerCode: credentials.dealerCode,
                ...(rememberedDealerId ? { dealerId: rememberedDealerId } : {}),
              };
            })();
      const res = await fetchSession({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...loginBody,
          ...(turnstileToken ? { turnstileToken } : {}),
        }),
      });

      if (!res.ok) {
        throw await readApiError(res, { notifyAuth: false });
      }

      const body = await res.json();
      const dealer = body.dealer;

      if (dealer && credentials.authType === "code" && dealer.id) {
        rememberDealerId(String(dealer.id));
      }

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
          capabilities: body.capabilities,
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
        authType: credentials.authType,
      });
      const userMessage =
        code === "INVALID_CODE" || code === "INVALID_CREDENTIALS"
          ? credentials.authType === "manager_password"
            ? "Username or password not recognized. Check both and try again."
            : "That access code was not recognized. Check it and try again."
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
    try {
      const response = await fetchSession({ method: "DELETE" });
      if (response.status === 401) {
        // The server is already authoritative: there is no active session.
        // Treat this as a completed sign-out and clear the stale local shell.
      } else if (!response.ok) {
        const detail = await readApiError(response, { notifyAuth: false });
        logError("app.logout.failed", {
          status: response.status,
          code: detail.code || "UNKNOWN",
        });
        set({
          error:
            "Secure sign-out did not complete. Your session is still active; check your connection and try again.",
        });
        return;
      }
    } catch (err) {
      logError("app.logout.failed", {
        message: err instanceof Error ? err.message : String(err),
      });
      set({
        error:
          "Secure sign-out did not complete. Your session is still active; check your connection and try again.",
      });
      return;
    }
    set({
      currentDealer: null,
      currentPerson: null,
      isImpersonating: false,
      selectedImage: null,
      generatedPost: null,
      generationParams: null,
      postDraft: null,
      pendingRelease: null,
      pendingPhoto: null,
      postWorkAtRisk: false,
      postReturnStep: null,
      error: null,
      step: AppStep.LOGIN,
      role: "salesperson",
      authEpoch: get().authEpoch + 1,
    });
    clearSession();
    // Includes short-lived original-photo recovery copies. The storage helper
    // coordinates upgrades and falls back to deleting the private database.
    const mediaCleared = await clearAllCreatives();
    if (!mediaCleared) {
      logError("media.storage.clear_failed", {
        boundary: "logout",
      });
    }
    publishAuthBoundary();
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
      generationParams: null,
      postDraft: null,
      pendingRelease: null,
      pendingPhoto: null,
      postWorkAtRisk: false,
      postReturnStep: null,
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
        postDraft: undefined,
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
        // The cookie-restore path applies the session directly (no
        // applyAuthPayload), so it must forward the advertisement itself or
        // every reopened PWA would silently lose the optional Veo fields.
        setProxyCapabilities((body as { capabilities?: unknown }).capabilities);
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
          const restoredCustomerIdentityRequired =
            resolveRestoredCustomerIdentityRequired(
              persistedGeneratedPost?.customerIdentityRequired,
              session?.generationParams?.customerIdentityRequired,
            );
          const restoredGeneratedPost =
            persistedGeneratedPost && restoredGeneratedImage
              ? ({
                  ...persistedGeneratedPost,
                  image: restoredGeneratedImage,
                  customerIdentityRequired: restoredCustomerIdentityRequired,
                  imageReviewRequired: resolveRestoredImageReviewRequired(
                    persistedGeneratedPost.imageReviewRequired,
                    persistedGeneratedPost.aiMeta?.modelPolicyVersion,
                  ),
                } as GeneratedPost)
              : null;
          const restoredGenerationParams =
            matchesPersistedDealer && session?.generationParams
              ? ({
                  ...session.generationParams,
                  customerIdentityRequired: resolveRestoredCustomerIdentityRequired(
                    session.generationParams.customerIdentityRequired,
                    persistedGeneratedPost?.customerIdentityRequired,
                  ),
                } as GenerationParams)
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
            generationParams: restoredGenerationParams,
            postDraft: matchesPersistedDealer
              ? session?.postDraft ||
                (restoredSelectedImage
                  ? {
                      categoryId: "deliveries",
                      scenarioId:
                        restoredGenerationParams?.scenarioId || "customer_delivery",
                      decodedVehicle: restoredGenerationParams?.decodedVehicle,
                    }
                  : null)
              : null,
            pendingRelease: null,
            pendingPhoto: null,
            postWorkAtRisk: false,
            postReturnStep: null,
            step: restoredStep,
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
            authEpoch: get().authEpoch + 1,
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

setActiveAuthEpoch(useAppStore.getState().authEpoch);
setActiveSalespersonName(useAppStore.getState().currentPerson?.name);
useAppStore.subscribe((state, previousState) => {
  if (state.authEpoch !== previousState.authEpoch) {
    setActiveAuthEpoch(state.authEpoch);
  }
  if (state.currentPerson?.name !== previousState.currentPerson?.name) {
    setActiveSalespersonName(state.currentPerson?.name);
  }
});

if (typeof window !== "undefined") {
  let externalBoundaryPending = false;
  const handleExternalBoundary = (event?: Event) => {
    if (
      event?.type === AUTH_SESSION_REJECTED_EVENT &&
      event instanceof CustomEvent &&
      event.detail?.authEpoch !== useAppStore.getState().authEpoch
    ) {
      return;
    }
    if (externalBoundaryPending) return;
    externalBoundaryPending = true;
    const state = useAppStore.getState();
    useAppStore.setState({
      currentDealer: null,
      currentPerson: null,
      isImpersonating: false,
      selectedImage: null,
      generatedPost: null,
      generationParams: null,
      postDraft: null,
      pendingRelease: null,
      pendingPhoto: null,
      postWorkAtRisk: false,
      postReturnStep: null,
      error: null,
      role: "salesperson",
      step: AppStep.LOGIN,
      isRestoringSession: true,
      authEpoch: state.authEpoch + 1,
    });
    void clearAllCreatives()
      .then(() => useAppStore.getState().restoreSession())
      .finally(() => {
        externalBoundaryPending = false;
      });
  };
  window.addEventListener("storage", (event) => {
    if (event.key === AUTH_BOUNDARY_STORAGE_KEY) handleExternalBoundary();
  });
  window.addEventListener(AUTH_SESSION_REJECTED_EVENT, handleExternalBoundary);
  if (authBoundaryChannel) {
    authBoundaryChannel.onmessage = handleExternalBoundary;
  }
}
