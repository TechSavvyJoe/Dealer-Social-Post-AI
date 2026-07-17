import React, { Suspense } from "react";
import { AnimatePresence } from "framer-motion";
import { Header } from "./components/Header";
import { ImpersonationBanner } from "./components/ImpersonationBanner";
import { MainContent } from "./components/MainContent";
import { useAppController } from "./hooks/useAppController";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { AppStep } from "./types";
import { useAppStore } from "./stores/appStore";

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
const AppContent: React.FC = () => {
  const {
    step,
    currentDealer,
    selectedImage,
    generatedPost,
    error,
    preferredStyle,
    preferredTone,
    compactMode,
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
    setCropModalOpen,
    tempImageForCrop,
    isDesktopLayout,
    generationProgress,
    progressMessage,
    handleLogin,
    handleStyleToneChange,
    handleImageSelected,
    handleCropConfirm,
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

  // Power-user shortcuts. Step-aware so each key does the smart thing where you are.
  useKeyboardShortcuts({
    onCancel: () => {
      if (isSettingsOpen) {
        setIsSettingsOpen(false);
        return;
      }
      if (isVideoDirectorOpen) {
        setIsVideoDirectorOpen(false);
        return;
      }
      if (cropModalOpen) {
        setCropModalOpen(false);
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
        <div
          className="flex items-center gap-4"
          role="status"
          aria-live="polite"
        >
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
      className="flex min-h-0 flex-1 flex-col font-sans"
      style={{
        backgroundColor: "rgb(var(--color-surface-base))",
        color: "rgb(var(--color-text-primary))",
      }}
    >
      {isImpersonating && <ImpersonationBanner />}
      {currentDealer && (
        <Header
          dealer={currentDealer}
          onLogout={() => logout()}
          onShowSettings={() => setIsSettingsOpen(true)}
          confirmBeforeLogout={
            step === AppStep.RESULT && Boolean(generatedPost)
          }
        />
      )}

      <main
        id="main-content"
        className={`flex-1 flex flex-col transition-all duration-300 ease-in-out ${
          compactMode ? "pt-4 sm:pt-6" : "pt-6 sm:pt-8"
        } pb-4 sm:pb-8 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full`}
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
          />
        </AnimatePresence>
      </main>

      <Suspense fallback={null}>
        <LazySettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          compactMode={compactMode}
          onToggleCompactMode={(value) =>
            setPreferences({ compactMode: value })
          }
        />
      </Suspense>

      <Suspense fallback={null}>
        <LazyImageCropModal
          isOpen={cropModalOpen}
          onClose={() => setCropModalOpen(false)}
          imageSrc={tempImageForCrop}
          onConfirm={handleCropConfirm}
        />
      </Suspense>

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
