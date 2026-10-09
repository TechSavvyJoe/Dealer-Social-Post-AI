import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Header } from "./components/Header";
import { ImpersonationBanner } from "./components/ImpersonationBanner";
import { MainContent } from "./components/MainContent";
import { OfflineBanner } from "./components/OfflineBanner";
import { useAppController } from "./hooks/useAppController";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import {
  postBusyMessage,
  postHasWorkAtRisk,
  useUrlStepSync,
} from "./hooks/useUrlStepSync";
import {
  AppStep,
  type ApprovalPolicyMode,
  type Dealer,
  type GeneratedPost,
  type ImageSelection,
} from "./types";
import { useToast } from "./components/ui/Toast";
import { useAppStore } from "./stores/appStore";
import { Modal } from "./components/ui/Modal";
import { Button } from "./components/ui/Button";
import { PwaUpdatePrompt } from "./components/PwaUpdatePrompt";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { homeTilesForDealer } from "./services/storeDefaults";

interface PanelBoundaryProps {
  children: React.ReactNode;
  /** Surface name used in the compact fallback copy. */
  panelName: string;
  /** Closes the crashed surface so the workspace is left clean. */
  onDismiss?: () => void;
}

/**
 * Scoped boundary for one lazy/heavy surface.
 *
 * It extends the app's single ErrorBoundary so the catch path and the redacted
 * crash telemetry stay identical, and replaces only the full-screen recovery
 * screen with a compact inline panel. Without this, a crash inside settings,
 * the crop dialog, or history unwinds all the way to the root boundary and
 * blanks the entire workspace. The root boundary in index.tsx still backstops
 * everything these do not cover.
 */
export class PanelErrorBoundary extends ErrorBoundary {
  declare props: Readonly<PanelBoundaryProps>;

  private handleRetryPanel = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, copied: false });
  };

  public render() {
    if (!this.state.hasError) return this.props.children;
    const { panelName, onDismiss } = this.props;
    return (
      <div
        role="alert"
        className="mx-auto my-3 w-full max-w-md rounded-md border border-strong bg-panel px-4 py-3"
      >
        <p className="text-sm font-semibold text-error-ink">
          {panelName} could not open
        </p>
        <p className="mt-1 text-sm leading-relaxed text-ink-2">
          The rest of your workspace is untouched. Try opening it again.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={this.handleRetryPanel}>
            Try again
          </Button>
          {onDismiss && (
            <Button
              variant="ghost"
              onClick={() => {
                this.handleRetryPanel();
                onDismiss();
              }}
            >
              Close
            </Button>
          )}
        </div>
      </div>
    );
  }
}

/**
 * True from the first time `open` goes true, and never false again.
 *
 * A React.lazy component starts its dynamic import when it first renders, not
 * when it becomes visible. Rendering the Settings and Photo-review modals
 * unconditionally with isOpen={false} therefore pulled SettingsModal,
 * ImageCropModal, mediaSave, imageUtils and their icon chunks on the
 * unauthenticated login screen — verified in the production network log. Gating
 * on this latch defers those chunks until the panel is actually opened, while
 * still leaving the component mounted afterwards so its close animation runs
 * and a second open is instant.
 */
const useMountedOnce = (open: boolean): boolean => {
  const [mounted, setMounted] = React.useState(open);
  React.useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  return mounted || open;
};

// Lazy load heavyweight modals
const LazySettingsModal = React.lazy(() =>
  import("./components/SettingsModal").then((mod) => ({
    default: mod.SettingsModal,
  })),
);
/**
 * The approval modes that only narrow review while it is on: the server
 * decides per post whether it waits (pb_hooks/requestPolicies.js
 * initialApprovalStatus), so the client cannot promise either outcome.
 */
const NARROWING_APPROVAL_MODES: readonly ApprovalPolicyMode[] = [
  "per_category",
  "first_n",
];

/** Tolerates a policy still held as its stored JSON text after a settings save. */
const approvalPolicyMode = (dealer: Dealer | null): ApprovalPolicyMode | null => {
  let policy: unknown = dealer?.approval_policy;
  if (typeof policy === "string") {
    try {
      policy = JSON.parse(policy);
    } catch {
      return null;
    }
  }
  const mode = (policy as { mode?: unknown } | null)?.mode;
  return typeof mode === "string" ? (mode as ApprovalPolicyMode) : null;
};

/**
 * The B5 outcome toast once a cancelled run's save lands in My work. Review is
 * switched on by requires_approval; a narrowing policy then lets the server
 * decide whether this post waits, so the toast only says where it went.
 */
const cancelSavedMessage = (
  requiresApproval: boolean,
  dealer: Dealer | null,
): string => {
  if (!requiresApproval) return "Saved to My work as a draft";
  const mode = approvalPolicyMode(dealer);
  return mode && NARROWING_APPROVAL_MODES.includes(mode)
    ? "Saved to My work"
    : "Saved to My work · waiting for approval";
};

/** Which question the leave dialog is asking. */
type LeaveKind = "post" | "settings" | "draft" | "spin" | "walkaround";

const AppContent: React.FC = () => {
  const app = useAppController();
  const { step, currentDealer, selectedImage, generatedPost, isRestoringSession } = app;
  const currentPerson = useAppStore((s) => s.currentPerson);
  const isImpersonating = useAppStore((s) => s.isImpersonating);
  const theme = useAppStore((s) => s.theme);
  const postWorkAtRisk = useAppStore((s) => s.postWorkAtRisk);
  const postDraft = useAppStore((s) => s.postDraft);
  const pendingRelease = useAppStore((s) => s.pendingRelease);
  const settingsEverOpened = useMountedOnce(app.isSettingsOpen);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveKind, setLeaveKind] = useState<LeaveKind>("post");
  const leaveAction = useRef<(() => void) | null>(null);
  const [workReturnStep, setWorkReturnStep] = useState<AppStep | null>(null);
  const [managementDirty, setManagementDirty] = useState(false);
  const [spinDirty, setSpinDirty] = useState(false);
  const [walkaroundDirty, setWalkaroundDirty] = useState(false);
  const toast = useToast();
  const mainRef = useRef<HTMLElement>(null);

  // Prefetch the actual next screen, without downloading signed-in panels at login.
  const isSignedIn = Boolean(currentDealer);
  useEffect(() => {
    if (!isSignedIn) return;
    const timer = window.setTimeout(() => {
      void import("./components/PostDetails").catch(() => {});
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [isSignedIn]);
  useEffect(() => {
    setLeaveOpen(false);
    leaveAction.current = null;
    setWorkReturnStep(null);
  }, [currentDealer?.id, currentPerson?.id, isImpersonating]);
  useEffect(() => {
    mainRef.current?.scrollTo?.({ top: 0 });
    if (mainRef.current && getComputedStyle(mainRef.current).overflowY === "visible")
      window.scrollTo({ top: 0 });
  }, [step]);
  // Leaving My work by any route (browser Back included) spends where its
  // Back would have returned, so a later visit never bounces to a stale step.
  const stepBefore = useRef(step);
  useEffect(() => {
    if (stepBefore.current === AppStep.WORK && step !== AppStep.WORK)
      setWorkReturnStep(null);
    stepBefore.current = step;
  }, [step]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      document.documentElement.classList.toggle("theme-light", !dark);
      // The browser chrome takes the canvas token of the theme just applied,
      // so it can never drift from the page (index.html seeds it at boot).
      const canvas = getComputedStyle(document.documentElement)
        .getPropertyValue("--canvas")
        .trim();
      if (canvas)
        document
          .querySelector('meta[name="theme-color"]')
          ?.setAttribute("content", `rgb(${canvas.split(/\s+/).join(", ")})`);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [theme]);

  const confirmLeave = (kind: LeaveKind, action: () => void) => {
    leaveAction.current = action;
    setLeaveKind(kind);
    setLeaveOpen(true);
  };
  /**
   * Every exit from the current screen goes through here: header Back, My
   * work, Log out, Escape, Done, Remix and Settings' dealer setup. Creating
   * cannot be left; a Post screen still rendering or sending the website
   * handoff refuses with the original toast (A4); unsaved work asks first.
   */
  const requestLeave = (action: () => void) => {
    if (step === AppStep.CREATING) return;
    if (step === AppStep.POST) {
      const busy = postBusyMessage();
      if (busy) {
        toast.warning(busy);
        return;
      }
    }
    if (step === AppStep.POST && postHasWorkAtRisk()) {
      confirmLeave("post", action);
      return;
    }
    if (step === AppStep.DEALER_ADMIN && managementDirty) {
      confirmLeave("settings", action);
      return;
    }
    if (step === AppStep.VEHICLE_SPIN && spinDirty) {
      confirmLeave("spin", action);
      return;
    }
    if (step === AppStep.WALKAROUND && walkaroundDirty) {
      confirmLeave("walkaround", action);
      return;
    }
    action();
  };
  /** A return step is only usable while the state it renders still exists. */
  const canReturnTo = (target: AppStep): boolean => {
    const state = useAppStore.getState();
    if (target === AppStep.DETAILS)
      return Boolean(state.selectedImage && state.postDraft);
    if (target === AppStep.POST) return Boolean(state.generatedPost);
    return true;
  };
  const goBack = () =>
    requestLeave(() => {
      const state = useAppStore.getState();
      if (step === AppStep.POST) {
        if (state.postReturnStep !== null) app.setStep(state.postReturnStep);
        else if (selectedImage) app.startRemix();
        else app.setStep(AppStep.WORK);
      } else if (step === AppStep.WORK && workReturnStep !== null) {
        const target = workReturnStep;
        setWorkReturnStep(null);
        // Never open an empty Details or Post: if what it showed is gone,
        // start again from Home as the URL guard does.
        if (canReturnTo(target)) app.setStep(target);
        else app.reset();
      } else if (step === AppStep.DETAILS && state.pendingRelease) {
        // Back to Home clears Details: a signed release is only discarded
        // after the salesperson says so (B13).
        confirmLeave("draft", app.reset);
      } else app.reset();
    });
  const openWork = () =>
    requestLeave(() => {
      // A second My work tap on My work keeps where Back returns to.
      if (step !== AppStep.WORK)
        setWorkReturnStep(
          step === AppStep.DETAILS || step === AppStep.POST ? step : null,
        );
      app.setStep(AppStep.WORK);
    });
  /**
   * Opening a saved post or reusing a photo replaces the whole workspace. A
   * Details draft still in progress (photo, details, perhaps the customer's
   * signature) is only discarded after the salesperson says so (B13).
   */
  const replaceWorkspace = (action: () => void) => {
    const run = () => {
      setWorkReturnStep(null);
      action();
    };
    const state = useAppStore.getState();
    if (state.selectedImage && state.postDraft && !state.generatedPost) {
      confirmLeave("draft", run);
      return;
    }
    run();
  };
  const openPost = (post: GeneratedPost) =>
    replaceWorkspace(() => app.handleOpenPost(post));
  const reusePhoto = (selection: ImageSelection) =>
    replaceWorkspace(() => {
      app.supersedeGeneration();
      app.reset();
      useAppStore.getState().setPendingPhoto(selection);
      app.setStep(AppStep.HOME);
      useAppStore.getState().setPendingPhoto(selection);
    });
  const requestLogout = () => {
    if (step === AppStep.DETAILS && useAppStore.getState().pendingRelease) {
      confirmLeave("draft", () => {
        void app.logout();
      });
      return;
    }
    requestLeave(() => {
      void app.logout();
    });
  };
  useUrlStepSync({
    managementDirty,
    spinDirty,
    walkaroundDirty,
    onBlockedWalkaroundBack: (target) =>
      confirmLeave("walkaround", () => app.setStep(target)),
    onBlockedSpinBack: (target) => confirmLeave("spin", () => app.setStep(target)),
    onBlockedManagementBack: (target) => {
      confirmLeave("settings", () => app.setStep(target));
    },
    onBusyResultBack: (message) => toast.warning(message),
    onBlockedDraftBack: (target) => confirmLeave("draft", () => app.setStep(target)),
    onBlockedResultBack: () => {
      confirmLeave("post", () => {
        const state = useAppStore.getState();
        if (state.postReturnStep !== null) app.setStep(state.postReturnStep);
        else if (state.selectedImage) app.startRemix();
        else app.reset();
      });
    },
  });
  useKeyboardShortcuts({
    onCancel: () => {
      if (document.querySelector('[role="dialog"]')) return;
      if (app.isSettingsOpen) {
        app.setIsSettingsOpen(false);
        return;
      }
      if (
        [
          AppStep.DETAILS,
          AppStep.POST,
          AppStep.WORK,
          AppStep.VEHICLE_SPIN,
          AppStep.WALKAROUND,
        ].includes(step)
      )
        goBack();
    },
    onPalette: () => app.setIsSettingsOpen(!app.isSettingsOpen),
    onFocusSearch: () =>
      document
        .querySelector<HTMLElement>("input:not([disabled]), textarea:not([disabled])")
        ?.focus(),
  });
  const cancelGeneration = () => {
    const result = app.cancelGeneration();
    if (result.status === "saving") {
      const dealerAtCancel = useAppStore.getState().currentDealer;
      toast.info("Finishing the save in My work…");
      void result.saved.then((saved) => {
        if (saved)
          toast.info(cancelSavedMessage(result.requiresApproval, dealerAtCancel));
        else
          toast.warning("The post could not be saved. Your photo is still in Details.");
      });
    }
  };
  // The header names the step by its category tile ("Delivery", "New
  // arrival"), as the Details and Post artboards do; My work keeps its name.
  const tiles = useMemo(() => homeTilesForDealer(currentDealer), [currentDealer]);
  const tileLabel = (scenarioId: string | undefined): string =>
    tiles.find((tile) => tile.scenarioId === scenarioId)?.label || "Post";
  const flowTitle =
    step === AppStep.DETAILS
      ? tileLabel(postDraft?.scenarioId)
      : step === AppStep.POST
        ? tileLabel(generatedPost?.scenarioId || postDraft?.scenarioId)
        : step === AppStep.WORK
          ? "My work"
          : step === AppStep.VEHICLE_SPIN
            ? "Vehicle studio"
            : step === AppStep.WALKAROUND
              ? "Walkaround video"
              : undefined;
  if (isRestoringSession)
    return (
      <main
        className="flex flex-1 items-center justify-center bg-canvas p-6 text-ink"
        aria-busy="true"
      >
        <p role="status">Opening your workspace…</p>
      </main>
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas font-sans text-ink">
      <OfflineBanner />
      {isImpersonating && <ImpersonationBanner />}
      <PwaUpdatePrompt />
      {currentDealer && (
        <Header
          dealer={currentDealer}
          person={currentPerson}
          onLogout={requestLogout}
          onShowSettings={() => app.setIsSettingsOpen(true)}
          onShowHistory={openWork}
          confirmBeforeLogout={false}
          onBack={
            step === AppStep.DETAILS ||
            step === AppStep.POST ||
            step === AppStep.WORK ||
            step === AppStep.VEHICLE_SPIN ||
            step === AppStep.WALKAROUND
              ? goBack
              : undefined
          }
          flowTitle={flowTitle}
          navigationDisabled={step === AppStep.CREATING}
        />
      )}
      <main
        id="main-content"
        ref={mainRef}
        className={
          step === AppStep.LOGIN
            ? "login-stage mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col overflow-hidden sm:px-6 sm:py-4 lg:px-8 lg:py-6"
            : "mx-auto flex min-h-0 w-full max-w-[1440px] flex-1 flex-col overflow-y-auto overscroll-y-contain"
        }
      >
        <MainContent
          displayedStep={step}
          step={step}
          currentDealer={currentDealer}
          selectedImage={selectedImage}
          generatedPost={generatedPost}
          error={app.error}
          preferredStyle={app.preferredStyle}
          preferredTone={app.preferredTone}
          isDesktopLayout={app.isDesktopLayout}
          generationProgress={app.generationProgress}
          progressMessage={app.progressMessage}
          generationStage={app.generationStage}
          partsReady={app.partsReady}
          onCancelGeneration={cancelGeneration}
          onLogin={app.handleLogin}
          onImageSelected={app.handleImageSelected}
          onPhotoPicked={app.handlePhotoPicked}
          onOpenPost={openPost}
          onReusePhoto={reusePhoto}
          onReset={() => requestLeave(app.reset)}
          onBackFromWork={goBack}
          onManagementDirtyChange={setManagementDirty}
          onSpinDirtyChange={setSpinDirty}
          onWalkaroundDirtyChange={setWalkaroundDirty}
          onOpenSpin={() => requestLeave(() => app.setStep(AppStep.VEHICLE_SPIN))}
          onOpenWalkaround={() => requestLeave(() => app.setStep(AppStep.WALKAROUND))}
          onRemix={() => requestLeave(app.startRemix)}
          onRetrySaveGeneratedPost={app.retrySaveGeneratedPost}
          savingGeneratedPost={app.savingGeneratedPost}
          onDismissError={() => app.setError(null)}
          onGenerate={app.handleGenerate}
          onBackToCapture={goBack}
          onStyleToneChange={app.handleStyleToneChange}
          onRegenerateImage={app.handleRegenerateImage}
          onEditImage={app.handleEditImage}
          onRegenerateText={app.handleRegenerateText}
          onEditText={app.handleEditText}
          onPrepareFinalWebsiteDraft={app.handlePrepareFinalWebsiteDraft}
          onFunMode={app.handleFunMode}
          onGenerateVideo={app.handleGenerateVideo}
          onGenerateCaptionVariant={app.generateCaptionVariant}
          onChangeLook={app.handleChangeLook}
          onShowSettings={() => app.setIsSettingsOpen(true)}
          onShowHistory={openWork}
          onRequestLogout={requestLogout}
        />
      </main>
      <PanelErrorBoundary
        panelName="Settings"
        onDismiss={() => app.setIsSettingsOpen(false)}
      >
        <Suspense fallback={null}>
          {settingsEverOpened && (
            <LazySettingsModal
              isOpen={app.isSettingsOpen}
              onClose={() => app.setIsSettingsOpen(false)}
              onOpenDealerSetup={() => {
                app.setIsSettingsOpen(false);
                requestLeave(() => app.setStep(AppStep.DEALER_ADMIN));
              }}
              imageQualityTier={app.imageQualityTier}
              theme={theme}
              onImageQualityTierChange={(value) =>
                app.setPreferences({ imageQualityTier: value })
              }
              onThemeChange={(value) => app.setPreferences({ theme: value })}
            />
          )}
        </Suspense>
      </PanelErrorBoundary>
      <Modal
        isOpen={leaveOpen}
        onClose={() => setLeaveOpen(false)}
        title={
          leaveKind === "spin"
            ? "Leave this vehicle spin?"
            : leaveKind === "walkaround"
              ? "Leave this walkaround?"
              : leaveKind === "settings"
                ? "Leave unsaved store settings?"
                : leaveKind === "draft"
                  ? "Discard the post in progress?"
                  : "Leave this post?"
        }
        description={
          leaveKind === "spin"
            ? "Unsaved frames and processing will be discarded. Saved spins stay in your vehicle studio."
            : leaveKind === "walkaround"
              ? "Unuploaded clips and unsaved walkaround text will be cleared. Saved project work stays with the dealership."
              : leaveKind === "settings"
                ? "Save your dealership settings before leaving, or discard these changes."
                : leaveKind === "draft"
                  ? pendingRelease
                    ? "Your photo, details and the customer's signature will be cleared."
                    : "Your photo and details will be cleared."
                  : postWorkAtRisk
                    ? "Changes are still saving or work is in progress."
                    : "This post has not been saved yet."
        }
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setLeaveOpen(false)}>
              Keep working
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setLeaveOpen(false);
                leaveAction.current?.();
                leaveAction.current = null;
              }}
            >
              {leaveKind === "draft" ? "Discard post" : "Leave anyway"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-2">
          {leaveKind === "draft"
            ? "Posts you already created stay in My work."
            : "Leaving now may lose your latest changes."}
        </p>
      </Modal>
    </div>
  );
};
const LazyPublicSpin = React.lazy(() =>
  import("./components/PublicVehicleSpin").then((m) => ({
    default: m.PublicVehicleSpin,
  })),
);
const LazyDealershipInvitation = React.lazy(() =>
  import("./components/DealershipInvitation").then((m) => ({
    default: m.DealershipInvitation,
  })),
);
export default function App() {
  const [route, setRoute] = useState(() => ({
    path: window.location.pathname,
    hash: window.location.hash,
  }));
  const publicToken = route.hash.startsWith("#/spin/") ? route.hash.slice(7) : "";
  useEffect(() => {
    const update = () =>
      setRoute({ path: window.location.pathname, hash: window.location.hash });
    window.addEventListener("hashchange", update);
    window.addEventListener("popstate", update);
    return () => {
      window.removeEventListener("hashchange", update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  if (route.path === "/join")
    return (
      <Suspense
        fallback={
          <p className="p-6 text-ink" role="status">
            Opening dealership invitation…
          </p>
        }
      >
        <LazyDealershipInvitation key={route.hash} token={route.hash.slice(1)} />
      </Suspense>
    );
  return publicToken ? (
    <Suspense
      fallback={
        <p className="p-6 text-ink" role="status">
          Opening vehicle view…
        </p>
      }
    >
      <LazyPublicSpin token={publicToken} />
    </Suspense>
  ) : (
    <AppContent />
  );
}
