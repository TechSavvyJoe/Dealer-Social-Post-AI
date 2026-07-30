import React, { Suspense, useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { Header } from "./components/Header";
import { ImpersonationBanner } from "./components/ImpersonationBanner";
import { MainContent } from "./components/MainContent";
import { useAppController } from "./hooks/useAppController";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { AppStep } from "./types";
import { useToast } from "./components/ui/Toast";
import { useAppStore } from "./stores/appStore";
import { Modal } from "./components/ui/Modal";
import { Button } from "./components/ui/Button";
import { History, LayoutDashboard, Settings } from "lucide-react";

// Lazy load heavyweight modals
const LazySettingsModal = React.lazy(() =>
  import("./components/SettingsModal").then((mod) => ({
    default: mod.SettingsModal,
  })),
);
const LazyImageCropModal = React.lazy(() =>
  import("./components/ImageCropModal").then((mod) => ({
    default: mod.ImageCropModal,
  })),
);
const LazyPostHistory = React.lazy(() =>
  import("./components/PostHistory").then((mod) => ({
    default: mod.PostHistory,
  })),
);
const AppContent: React.FC = () => {
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isMobileLogoutConfirmOpen, setIsMobileLogoutConfirmOpen] = useState(false);
  const {
    step,
    currentDealer,
    selectedImage,
    generatedPost,
    error,
    preferredStyle,
    preferredTone,
    compactMode,
    imageQualityTier,
    isRestoringSession,
    setStep,
    setError,
    setPreferences,
    logout,
    reset,
    startRemix,
    isSettingsOpen,
    setIsSettingsOpen,
    isVideoDirectorOpen,
    setIsVideoDirectorOpen,
    cropModalOpen,
    tempImageForCrop,
    tempOriginalForBackup,
    tempOriginalFilename,
    originalBackupStatus,
    isDesktopLayout,
    generationProgress,
    progressMessage,
    handleLogin,
    handleStyleToneChange,
    handleImageSelected,
    handleCropConfirm,
    handleCropClose,
    handleGenerate,
    handleRegenerateImage,
    handleFunMode,
    handleEditImage,
    handleRegenerateText,
    handleEditText,
    handleGenerateVideo,
    generateCaptionVariant,
  } = useAppController();

  // Must run before any conditional return — React requires a stable hook order.
  const isImpersonating = useAppStore((s) => s.isImpersonating);
  const currentPerson = useAppStore((s) => s.currentPerson);
  const currentPersonId = currentPerson?.id || "";
  const theme = useAppStore((s) => s.theme);
  useEffect(() => {
    setIsHistoryOpen(false);
  }, [currentDealer?.id, currentPersonId, isImpersonating]);

  useEffect(() => {
    const updateTheme = () => {
      const isDark =
        step === AppStep.RESULT ||
        theme === "dark" ||
        (theme === "system" &&
          window.matchMedia("(prefers-color-scheme: dark)").matches);
      if (!isDark) {
        document.documentElement.classList.add("theme-light");
      } else {
        document.documentElement.classList.remove("theme-light");
      }
    };

    updateTheme();

    if (theme === "system" && typeof window !== "undefined") {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => updateTheme();
      media.addEventListener("change", handler);
      return () => media.removeEventListener("change", handler);
    }
  }, [step, theme]);

  const toast = useToast();

  // Power-user shortcuts. Step-aware so each key does the smart thing where you are.
  useKeyboardShortcuts({
    onCancel: () => {
      if (isHistoryOpen) {
        setIsHistoryOpen(false);
        return;
      }
      if (isSettingsOpen) {
        setIsSettingsOpen(false);
        return;
      }
      if (isVideoDirectorOpen) {
        setIsVideoDirectorOpen(false);
        return;
      }
      if (cropModalOpen) {
        handleCropClose();
        return;
      }
      // Step-specific back actions
      if (step === AppStep.CUSTOMIZE) {
        setStep(AppStep.CAPTURE);
        return;
      }
      if (step === AppStep.RESULT) {
        // Result replacement is intentionally guarded by PostResult's
        // confirmation dialog. A global Escape must never bypass that guard
        // and discard an expensive unsaved creative.
        toast.info(
          "Unsaved creative in progress. Click 'Start Over' or 'Remix' to exit.",
        );
        return;
      }
    },
    onPalette: () => setIsSettingsOpen(!isSettingsOpen),
    onFocusSearch: () => {
      const first = document.querySelector<HTMLElement>(
        "input:not([disabled]), textarea:not([disabled])",
      );
      first?.focus();
    },
  });

  if (isRestoringSession) {
    return (
      <main
        className="flex min-h-0 flex-1 items-center justify-center bg-surface-950 p-6 text-surface-50"
        aria-busy="true"
      >
        <div className="flex items-center gap-4" role="status" aria-live="polite">
          <span
            className="h-10 w-10 rounded-xl border border-primary-400/40 bg-primary-500/10 grid place-items-center"
            aria-hidden="true"
          >
            <span className="h-2.5 w-2.5 rounded-full bg-primary-300 animate-pulse" />
          </span>
          <div>
            <p className="font-semibold tracking-tight">Dealer Social</p>
            <p className="text-sm text-surface-300">Preparing your studio…</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <div
      className={`flex min-h-0 flex-1 flex-col font-sans ${
        step === AppStep.RESULT ? "publish-studio-theme" : ""
      }`}
      style={{
        backgroundColor: "rgb(var(--color-surface-base))",
        color: "rgb(var(--color-text-primary))",
      }}
    >
      {isImpersonating && <ImpersonationBanner />}
      {currentDealer && (step !== AppStep.RESULT || isDesktopLayout) && (
        <Header
          dealer={currentDealer}
          person={currentPerson}
          onLogout={() => logout()}
          onShowSettings={() => setIsSettingsOpen(true)}
          onShowHistory={() => setIsHistoryOpen(true)}
          confirmBeforeLogout={step === AppStep.RESULT && Boolean(generatedPost)}
          studioMode={step === AppStep.RESULT}
        />
      )}

      <div className="flex min-h-0 flex-1">
        {step === AppStep.RESULT && isDesktopLayout ? (
          <aside
            className="flex w-[5.25rem] shrink-0 flex-col items-center border-r border-white/[0.08] bg-surface-950/35 px-2 py-4"
            aria-label="Publishing workspace navigation"
          >
            <nav className="flex w-full flex-1 flex-col gap-2">
              <span
                className="flex min-h-[4.25rem] w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-primary-400/45 bg-primary-500/15 px-1 text-[10px] font-semibold text-primary-100 shadow-[0_8px_24px_rgba(0,0,0,0.18)]"
                aria-current="page"
              >
                <LayoutDashboard className="h-5 w-5" aria-hidden="true" />
                Workspace
              </span>
              <button
                type="button"
                onClick={() => setIsHistoryOpen(true)}
                className="flex min-h-[4.25rem] w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-transparent px-1 text-[10px] font-medium text-surface-400 transition-colors hover:border-white/10 hover:bg-white/[0.05] hover:text-surface-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
              >
                <History className="h-5 w-5" aria-hidden="true" />
                My work
              </button>
            </nav>
            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              className="flex min-h-[4.25rem] w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-transparent px-1 text-[10px] font-medium text-surface-400 transition-colors hover:border-white/10 hover:bg-white/[0.05] hover:text-surface-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
            >
              <Settings className="h-5 w-5" aria-hidden="true" />
              Settings
            </button>
          </aside>
        ) : null}

        <main
          id="main-content"
          className={
            step === AppStep.LOGIN
              ? // Zero vertical chrome on mobile login — #root already owns safe-area
                "mx-auto flex h-full min-h-0 w-full max-w-7xl flex-1 flex-col overflow-hidden px-0 py-0 sm:px-6 sm:py-4 lg:px-8 lg:py-6"
              : step === AppStep.RESULT
                ? // Publishing is a wide, dense studio. It remains one scrollport on
                  // short displays, but uses the available desktop canvas.
                  "mx-auto flex min-h-0 w-full max-w-[1680px] flex-1 flex-col overflow-y-auto overscroll-y-contain px-2 pb-2 pt-2 sm:px-3 sm:pb-3 sm:pt-3 lg:px-4 lg:pb-4 lg:pt-4"
                : // Non-login: one scrollport; bottom pad only for content (safe-area on #root)
                  "mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col overflow-y-auto overscroll-y-contain px-4 pb-4 pt-3 sm:px-6 sm:pb-6 sm:pt-5 lg:px-8 lg:pb-8 lg:pt-6"
          }
        >
          <AnimatePresence mode="wait">
            <MainContent
              key="main-content"
              displayedStep={step}
              step={step}
              currentDealer={currentDealer}
              selectedImage={selectedImage}
              generatedPost={generatedPost}
              error={error}
              preferredStyle={preferredStyle}
              preferredTone={preferredTone}
              isDesktopLayout={isDesktopLayout}
              generationProgress={generationProgress}
              progressMessage={progressMessage}
              onLogin={handleLogin}
              onImageSelected={handleImageSelected}
              onReset={reset}
              onRemix={startRemix}
              onDismissError={() => setError(null)}
              onGenerate={handleGenerate}
              onBackToCapture={() => setStep(AppStep.CAPTURE)}
              onStyleToneChange={handleStyleToneChange}
              onRegenerateImage={handleRegenerateImage}
              onEditImage={handleEditImage}
              onRegenerateText={handleRegenerateText}
              onEditText={handleEditText}
              onFunMode={handleFunMode}
              onGenerateVideo={handleGenerateVideo}
              onGenerateCaptionVariant={generateCaptionVariant}
              onShowSettings={() => setIsSettingsOpen(true)}
              onShowHistory={() => setIsHistoryOpen(true)}
              onRequestLogout={() => setIsMobileLogoutConfirmOpen(true)}
            />
          </AnimatePresence>
        </main>
      </div>

      <Suspense fallback={null}>
        <LazySettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          compactMode={compactMode}
          imageQualityTier={imageQualityTier}
          theme={theme}
          onToggleCompactMode={(value) => setPreferences({ compactMode: value })}
          onImageQualityTierChange={(value) =>
            setPreferences({ imageQualityTier: value })
          }
          onThemeChange={(value) => setPreferences({ theme: value })}
        />
      </Suspense>

      <Suspense fallback={null}>
        <LazyImageCropModal
          isOpen={cropModalOpen}
          onClose={handleCropClose}
          imageSrc={tempImageForCrop}
          originalSource={tempOriginalForBackup}
          originalFilename={tempOriginalFilename}
          onConfirm={handleCropConfirm}
          originalBackupStatus={originalBackupStatus}
        />
      </Suspense>

      <Modal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        size="full"
        title="My work"
        description="Reopen prior creatives, captions, and customer posts without regenerating."
        className="mx-2 w-[calc(100%-1rem)] sm:mx-4 sm:w-[min(72rem,calc(100%-2rem))]"
      >
        <Suspense
          fallback={
            <div
              className="flex min-h-48 items-center justify-center text-sm text-surface-300"
              role="status"
            >
              Loading your work…
            </div>
          }
        >
          <LazyPostHistory onOpenCreative={() => setIsHistoryOpen(false)} />
        </Suspense>
      </Modal>

      <Modal
        isOpen={isMobileLogoutConfirmOpen}
        onClose={() => setIsMobileLogoutConfirmOpen(false)}
        size="sm"
        title="Log out and discard this post?"
        description="This generated result is not fully preserved yet."
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setIsMobileLogoutConfirmOpen(false)}
              fullWidth
            >
              Keep working
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setIsMobileLogoutConfirmOpen(false);
                logout();
              }}
              fullWidth
            >
              Log out anyway
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-surface-300">
          Save the media and copy the caption first if you want to keep both. Logging
          out clears this workspace.
        </p>
      </Modal>

      {/* Video director lives on PostResult — global no-op modal removed */}
    </div>
  );
};

const App: React.FC = () => {
  // ToastProvider is mounted once at the root (index.tsx); no need to nest a
  // second provider here.
  return <AppContent />;
};

export default App;
