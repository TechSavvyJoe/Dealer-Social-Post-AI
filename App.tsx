import React from "react";
import { AnimatePresence } from "framer-motion";
import { Header } from "./components/Header";
import { MainContent } from "./components/MainContent";
import { SettingsModal } from "./components/SettingsModal";
import { ImageCropModal } from "./components/ImageCropModal";
import { VideoDirectorModal } from "./components/VideoDirectorModal";
import { ToastProvider } from "./components/ui/Toast";
import { useAppController } from "./hooks/useAppController";
import { AppStep } from "./types";

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
  } = useAppController();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 font-sans selection:bg-indigo-500/30">
      {currentDealer && (
        <Header
          dealer={currentDealer}
          onLogout={() => logout()}
          onShowSettings={() => setIsSettingsOpen(true)}
        />
      )}

      <main
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
          />
        </AnimatePresence>
      </main>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        compactMode={compactMode}
        onToggleCompactMode={(value) => setPreferences({ compactMode: value })}
      />

      <ImageCropModal
        isOpen={cropModalOpen}
        onClose={() => setCropModalOpen(false)}
        imageSrc={tempImageForCrop}
        onConfirm={handleCropConfirm}
      />

      <VideoDirectorModal
        isOpen={isVideoDirectorOpen}
        onClose={() => setIsVideoDirectorOpen(false)}
        onSelectStyle={(style, options) => {
          // This is handled inside PostResult usually, but if we needed a global modal:
          setIsVideoDirectorOpen(false);
        }}
      />
    </div>
  );
};

const App: React.FC = () => {
  return <AppContent />;
};

export default App;
