import React, { Suspense } from "react";
import { AnimatePresence } from "framer-motion";
import { Header } from "./components/Header";
import { MainContent } from "./components/MainContent";
import { useAppController } from "./hooks/useAppController";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { AppStep } from "./types";

// Lazy load heavyweight modals
const LazySettingsModal = React.lazy(() =>
  import("./components/SettingsModal").then((mod) => ({ default: mod.SettingsModal }))
);
const LazyImageCropModal = React.lazy(() =>
  import("./components/ImageCropModal").then((mod) => ({ default: mod.ImageCropModal }))
);
const LazyVideoDirectorModal = React.lazy(() =>
  import("./components/VideoDirectorModal").then((mod) => ({ default: mod.VideoDirectorModal }))
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
    setStep,
    setPreferences,
    logout,
    reset,
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
        reset();
        return;
      }
    },
    onPalette: () => setIsSettingsOpen(!isSettingsOpen),
    onFocusSearch: () => {
      const first = document.querySelector<HTMLElement>(
        "input:not([disabled]), textarea:not([disabled])"
      );
      first?.focus();
    },
  });

  return (
    <div
      className="min-h-screen font-sans"
      style={{
        backgroundColor: "rgb(var(--color-surface-base))",
        color: "rgb(var(--color-text-primary))",
      }}
    >
      {currentDealer && (
        <Header
          dealer={currentDealer}
          onLogout={() => logout()}
          onShowSettings={() => setIsSettingsOpen(true)}
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
          onToggleCompactMode={(value) => setPreferences({ compactMode: value })}
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

      <Suspense fallback={null}>
        <LazyVideoDirectorModal
          isOpen={isVideoDirectorOpen}
          onClose={() => setIsVideoDirectorOpen(false)}
          onSelectStyle={(style, options) => {
            // This is handled inside PostResult usually, but if we needed a global modal:
            setIsVideoDirectorOpen(false);
          }}
        />
      </Suspense>
    </div>
  );
};

const App: React.FC = () => {
  // ToastProvider is mounted once at the root (index.tsx); no need to nest a
  // second provider here.
  return <AppContent />;
};

export default App;
