import React, { Suspense, useEffect, useRef, useState } from "react";
import { Header } from "./components/Header";
import { ImpersonationBanner } from "./components/ImpersonationBanner";
import { MainContent } from "./components/MainContent";
import { OfflineBanner } from "./components/OfflineBanner";
import { useAppController } from "./hooks/useAppController";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { postHasWorkAtRisk, useUrlStepSync } from "./hooks/useUrlStepSync";
import { AppStep } from "./types";
import { useToast } from "./components/ui/Toast";
import { useAppStore } from "./stores/appStore";
import { Modal } from "./components/ui/Modal";
import { Button } from "./components/ui/Button";
import { PwaUpdatePrompt } from "./components/PwaUpdatePrompt";
import { ErrorBoundary } from "./components/ErrorBoundary";
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
        className="mx-auto my-3 w-full max-w-md rounded-xl border border-strong bg-panel px-4 py-3"
      >
        <p className="text-sm font-semibold text-error-ink">
          {panelName} could not open
        </p>
        <p className="mt-1 text-sm leading-relaxed text-ink-2">
          The rest of your workspace is untouched. Try opening it again.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={this.handleRetryPanel}>
            Try again
          </Button>
          {onDismiss && (
            <Button
              variant="plain"
              size="sm"
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
const AppContent: React.FC = () => {
  const app = useAppController();
  const { step, currentDealer, selectedImage, generatedPost, isRestoringSession } = app;
  const currentPerson = useAppStore((s) => s.currentPerson);
  const isImpersonating = useAppStore((s) => s.isImpersonating);
  const theme = useAppStore((s) => s.theme);
  const postWorkAtRisk = useAppStore((s) => s.postWorkAtRisk);
  const settingsEverOpened = useMountedOnce(app.isSettingsOpen);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const leaveAction = useRef<(() => void) | null>(null);
  const [workReturnStep, setWorkReturnStep] = useState<AppStep | null>(null);
  const [managementDirty, setManagementDirty] = useState(false);
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
  }, [step]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      document.documentElement.classList.toggle("theme-light", !dark);
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", dark ? "#121416" : "#f4f4f2");
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [theme]);

  const requestLeave = (action: () => void) => {
    if (step === AppStep.CREATING) return;
    if (
      (step === AppStep.POST && postHasWorkAtRisk()) ||
      (step === AppStep.DEALER_ADMIN && managementDirty)
    ) {
      leaveAction.current = action;
      setLeaveOpen(true);
      return;
    }
    action();
  };
  const goBack = () =>
    requestLeave(() => {
      const state = useAppStore.getState();
      if (step === AppStep.POST) {
        if (state.postReturnStep !== null) app.setStep(state.postReturnStep);
        else if (selectedImage) app.startRemix();
        else app.setStep(AppStep.WORK);
      } else if (step === AppStep.WORK && workReturnStep !== null) {
        app.setStep(workReturnStep);
        setWorkReturnStep(null);
      } else app.reset();
    });
  const openWork = () =>
    requestLeave(() => {
      setWorkReturnStep(
        step === AppStep.DETAILS || step === AppStep.POST ? step : null,
      );
      app.setStep(AppStep.WORK);
    });
  const requestLogout = () =>
    requestLeave(() => {
      void app.logout();
    });
  useUrlStepSync({
    managementDirty,
    onBlockedManagementBack: (target) => {
      leaveAction.current = () => app.setStep(target);
      setLeaveOpen(true);
    },
    onBlockedResultBack: () => {
      leaveAction.current = () => {
        const state = useAppStore.getState();
        if (state.postReturnStep !== null) app.setStep(state.postReturnStep);
        else if (state.selectedImage) app.startRemix();
        else app.reset();
      };
      setLeaveOpen(true);
    },
  });
  useKeyboardShortcuts({
    onCancel: () => {
      if (document.querySelector('[role="dialog"]')) return;
      if (app.isSettingsOpen) {
        app.setIsSettingsOpen(false);
        return;
      }
      if ([AppStep.DETAILS, AppStep.POST, AppStep.WORK].includes(step)) goBack();
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
      toast.info("Finishing the save in My work…");
      void result.saved.then((saved) => {
        if (saved)
          toast.info(
            result.requiresApproval
              ? "Saved to My work · waiting for approval"
              : "Saved to My work as a draft",
          );
        else
          toast.warning("The post could not be saved. Your photo is still in Details.");
      });
    }
  };
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
            step === AppStep.DETAILS || step === AppStep.POST || step === AppStep.WORK
              ? goBack
              : undefined
          }
          flowTitle={
            step === AppStep.DETAILS
              ? "Post details"
              : step === AppStep.POST
                ? "Your post"
                : step === AppStep.WORK
                  ? "My work"
                  : undefined
          }
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
          onOpenPost={app.handleOpenPost}
          onReusePhoto={(selection) => {
            app.supersedeGeneration();
            app.reset();
            useAppStore.getState().setPendingPhoto(selection);
            app.setStep(AppStep.HOME);
            useAppStore.getState().setPendingPhoto(selection);
          }}
          onReset={() => requestLeave(app.reset)}
          onBackFromWork={goBack}
          onManagementDirtyChange={setManagementDirty}
          onRemix={() => requestLeave(app.startRemix)}
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
        title={managementDirty ? "Leave unsaved store settings?" : "Leave this post?"}
        description={
          managementDirty
            ? "Save your dealership settings before leaving, or discard these changes."
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
              Leave anyway
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-2">Leaving now may lose your latest changes.</p>
      </Modal>
    </div>
  );
};
export default function App() {
  return <AppContent />;
}
