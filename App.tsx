import React, { useState, useEffect, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Header } from './components/Header';
import { MainContent } from './components/MainContent';
import { SettingsModal } from './components/SettingsModal';
import { ImageCropModal } from './components/ImageCropModal';
import { VideoDirectorModal } from './components/VideoDirectorModal';
import { ToastProvider, useToast } from './components/ui/Toast';
import { useAppStore } from './stores/appStore';
import { useLayoutMode } from './hooks/useLayoutMode';
import { useGemini } from './hooks/useGemini';
import { AppStep, StyleOption, ToneOption, VideoStyle, VideoRequestOptions } from './types';
import { logEvent } from './utils/telemetry';

const AppContent: React.FC = () => {
  const { error: toastError } = useToast();
  // Global State
  const { 
    step, currentDealer, selectedImage, generatedPost, error,
    preferredStyle, preferredTone, compactMode,
    setStep, setSelectedImage, setGeneratedPost, setError, 
    setPreferences, login, logout, reset, restoreSession 
  } = useAppStore();

  // Local UI State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isVideoDirectorOpen, setIsVideoDirectorOpen] = useState(false);
  
  // Generation State
  const [generationProgress, setGenerationProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  
  // Crop Modal State
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [tempImageForCrop, setTempImageForCrop] = useState<string | null>(null);
  
  // Last Params (for regeneration)
  const [lastGenerationParams, setLastGenerationParams] = useState<{
    style: StyleOption;
    tone: ToneOption;
    customerName: string;
    customText?: string;
    creativeBrief?: string;
  } | null>(null);

  // Custom Hooks
  const isDesktopLayout = useLayoutMode();
  const { 
    apiKey, 
    hasStoredApiKey, 
    isApiKeyConfigured, 
    ensureApiKeyReady, 
    runGeminiTask, 
    loadGeminiService, 
    handleSettingsSave 
  } = useGemini(setError, setIsSettingsOpen);

  // Initialization
  useEffect(() => {
    logEvent('app.boot');
    restoreSession();
  }, [restoreSession]);

  // Handlers
  const handleLogin = async (dealerId: string) => {
    const success = await login(dealerId);
    if (!success) setError("Invalid dealer ID");
    return success;
  };
  
  const handleStyleToneChange = useCallback((style: StyleOption, tone: ToneOption) => {
    setPreferences({ preferredStyle: style, preferredTone: tone });
  }, [setPreferences]);

  const handleImageSelected = useCallback((image: string) => {
    setTempImageForCrop(image);
    setCropModalOpen(true);
  }, []);

  const handleCropConfirm = useCallback((croppedImage: string) => {
    setSelectedImage(croppedImage);
    setGeneratedPost(null);
    setStep(AppStep.CUSTOMIZE);
    setError(null);
    setCropModalOpen(false);
    setTempImageForCrop(null);
  }, [setSelectedImage, setGeneratedPost, setStep, setError]);

  const handleGenerate = useCallback(async (style: StyleOption, tone: ToneOption, customerName: string, customText?: string, creativeBrief?: string) => {
    if (!selectedImage || !currentDealer) return;
    if (!ensureApiKeyReady()) return;

    setStep(AppStep.GENERATING);
    setError(null);
    setGenerationProgress(0);
    setProgressMessage('Analyzing your image...');
    setLastGenerationParams({ style, tone, customerName, customText, creativeBrief });

    // Progress Simulation
    const progressInterval = setInterval(() => {
      setGenerationProgress(prev => {
        if (prev >= 90) return prev;
        return prev + (Math.random() * 5 + 2);
      });
    }, 800);

    try {
      const { generateSocialPost } = await loadGeminiService();
      
      // Update messages based on progress
      setTimeout(() => setProgressMessage('Consulting the style guide...'), 2000);
      setTimeout(() => setProgressMessage('Crafting the perfect caption...'), 4500);
      setTimeout(() => setProgressMessage('Applying final polish...'), 7000);

      const result = await runGeminiTask('ai.generate', () =>
        generateSocialPost(selectedImage, style, tone, currentDealer.name, customerName, currentDealer.logo, customText, creativeBrief)
      );

      clearInterval(progressInterval);
      setGenerationProgress(100);
      setProgressMessage('Complete!');
      await new Promise(resolve => setTimeout(resolve, 500));

      setGeneratedPost(result);
      setStep(AppStep.RESULT);
    } catch (err) {
      clearInterval(progressInterval);
      const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
      const fullMsg = `Failed to generate your post. ${errorMessage}`;
      setError(fullMsg);
      toastError(fullMsg);
      setStep(AppStep.CUSTOMIZE);
    }
  }, [selectedImage, currentDealer, ensureApiKeyReady, runGeminiTask, setStep, setError, setGeneratedPost, loadGeminiService, toastError]);

  const handleRegenerateImage = useCallback(async () => {
    if (!selectedImage || !lastGenerationParams || !currentDealer) return;
    if (!ensureApiKeyReady()) return;
    setError(null);
    try {
      const { generateSocialPost } = await loadGeminiService();
      const result = await runGeminiTask('ai.regenerate.image', () =>
        generateSocialPost(
          selectedImage, lastGenerationParams.style, lastGenerationParams.tone,
          currentDealer.name, lastGenerationParams.customerName, currentDealer.logo,
          lastGenerationParams.customText || generatedPost?.text,
          lastGenerationParams.creativeBrief
        )
      );
      setGeneratedPost(result);
    } catch (err) {
      const msg = `Failed to regenerate image. ${err instanceof Error ? err.message : String(err)}`;
      setError(msg);
      toastError(msg);
    }
  }, [selectedImage, lastGenerationParams, currentDealer, generatedPost, ensureApiKeyReady, runGeminiTask, setGeneratedPost, setError, loadGeminiService, toastError]);

  const handleFunMode = useCallback(async (styleName?: string) => {
    if (!selectedImage || !currentDealer) return;
    if (!ensureApiKeyReady()) return;
    setError(null);
    try {
      const { generateFunSocialPostImage } = await loadGeminiService();
      const newImage = await runGeminiTask('ai.fun', () =>
        generateFunSocialPostImage(selectedImage, currentDealer.name, currentDealer.logo, styleName)
      );
      if (generatedPost) setGeneratedPost({ ...generatedPost, image: newImage });
    } catch (err) {
      const msg = `Failed to generate fun image. ${err instanceof Error ? err.message : String(err)}`;
      setError(msg);
      toastError(msg);
    }
  }, [selectedImage, currentDealer, generatedPost, ensureApiKeyReady, runGeminiTask, setGeneratedPost, setError, loadGeminiService, toastError]);

  const handleEditImage = useCallback(async (editPrompt: string) => {
    if (!generatedPost?.image || !editPrompt.trim() || !currentDealer) return;
    if (!ensureApiKeyReady()) return;
    setError(null);
    try {
      const { editSocialPostImage } = await loadGeminiService();
      const newImage = await runGeminiTask('ai.edit.image', () =>
        editSocialPostImage(generatedPost.image, editPrompt, currentDealer.name, currentDealer.logo)
      );
      if (generatedPost) setGeneratedPost({ ...generatedPost, image: newImage });
    } catch (err) {
      const msg = `Failed to apply image edits. ${err instanceof Error ? err.message : String(err)}`;
      setError(msg);
      toastError(msg);
    }
  }, [generatedPost, currentDealer, ensureApiKeyReady, runGeminiTask, setGeneratedPost, setError, loadGeminiService, toastError]);

  const handleRegenerateText = useCallback(async () => {
    if (!selectedImage || !lastGenerationParams || !currentDealer) return;
    if (!ensureApiKeyReady()) return;
    setError(null);
    try {
      const { generateSocialPostText } = await loadGeminiService();
      const newText = await runGeminiTask('ai.regenerate.text', () =>
        generateSocialPostText(
          selectedImage, lastGenerationParams.tone, currentDealer.name,
          lastGenerationParams.customerName, true, lastGenerationParams.creativeBrief
        )
      );
      if (generatedPost) setGeneratedPost({ ...generatedPost, text: newText });
    } catch (err) {
      const msg = `Failed to regenerate text. ${err instanceof Error ? err.message : String(err)}`;
      setError(msg);
      toastError(msg);
    }
  }, [selectedImage, lastGenerationParams, currentDealer, generatedPost, ensureApiKeyReady, runGeminiTask, setGeneratedPost, setError, loadGeminiService, toastError]);

  const handleEditText = useCallback(async (editPrompt: string) => {
    if (!generatedPost?.text || !editPrompt.trim()) return;
    if (!ensureApiKeyReady()) return;
    setError(null);
    try {
      const { editSocialPostText } = await loadGeminiService();
      const tone = lastGenerationParams?.tone || preferredTone;
      const newText = await runGeminiTask('ai.edit.text', () =>
        editSocialPostText(generatedPost.text, editPrompt, tone)
      );
      if (generatedPost) setGeneratedPost({ ...generatedPost, text: newText });
    } catch (err) {
      const msg = `Failed to apply text edits. ${err instanceof Error ? err.message : String(err)}`;
      setError(msg);
      toastError(msg);
    }
  }, [generatedPost, lastGenerationParams, preferredTone, ensureApiKeyReady, runGeminiTask, setGeneratedPost, setError, loadGeminiService, toastError]);

  const handleGenerateVideo = useCallback(async (style: VideoStyle, options: VideoRequestOptions): Promise<string> => {
    if (!generatedPost?.image) throw new Error("No image available for video generation");
    if (!ensureApiKeyReady()) throw new Error("API Key not configured");
    
    try {
      const { generatePostVideo } = await loadGeminiService();
      return await runGeminiTask('ai.generate.video', () =>
        generatePostVideo(generatedPost.image, style, options)
      );
    } catch (err) {
      const msg = `Failed to generate video. ${err instanceof Error ? err.message : String(err)}`;
      toastError(msg);
      throw err;
    }
  }, [generatedPost, ensureApiKeyReady, runGeminiTask, loadGeminiService, toastError]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 font-sans selection:bg-indigo-500/30">
      {currentDealer && (
        <Header 
          dealer={currentDealer} 
          onLogout={() => logout()} 
          onShowSettings={() => setIsSettingsOpen(true)}
          isApiKeyConfigured={isApiKeyConfigured}
        />
      )}

      <main className={`transition-all duration-500 ease-in-out ${compactMode ? 'pt-16' : 'pt-24'} pb-8 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto h-[calc(100vh-4rem)]`}>
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
            isApiKeyConfigured={isApiKeyConfigured}
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
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
};

export default App;
