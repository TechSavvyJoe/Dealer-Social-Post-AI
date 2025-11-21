import React, { useState, useCallback, useEffect } from 'react';
import { AppStep, StyleOption, ToneOption, VideoStyle, VideoRequestOptions } from './types';
import { useAppStore } from './stores/appStore';
import { Header } from './components/Header';
import { SettingsModal } from './components/SettingsModal';
import { ImageCropModal } from './components/ImageCropModal';
import { ProgressSteps } from './components/ProgressSteps';
import { saveLastSelections } from './utils/settings';
import { logEvent } from './utils/telemetry';
import { useLayoutMode } from './hooks/useLayoutMode';
import { useGemini } from './hooks/useGemini';
import { BackgroundPattern } from './components/BackgroundPattern';
import { MainContent } from './components/MainContent';
import { API_KEY_REQUIRED_MESSAGE } from './utils/constants';
import { useToast } from './components/ui/Toast';

const App: React.FC = () => {
  const { error: toastError } = useToast();
  // Global State
  const { 
    step, currentDealer, selectedImage, generatedPost, error,
    preferredStyle, preferredTone, compactMode,
    setStep, setSelectedImage, setGeneratedPost, setError, 
    setPreferences, login, logout, reset, restoreSession 
  } = useAppStore();

  // Local UI State
  const [displayedStep, setDisplayedStep] = useState(step);
  const [animationClass, setAnimationClass] = useState('animate-fade-in');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  
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

  // Step Animation
  useEffect(() => {
    if (step !== displayedStep) {
      setAnimationClass('animate-fade-out');
      const timer = setTimeout(() => {
        setDisplayedStep(step);
        setAnimationClass('animate-fade-in');
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [step, displayedStep]);

  // Handlers
  const handleLogin = async (dealerId: string) => {
    const success = await login(dealerId);
    if (!success) setError("Invalid dealer ID");
    return success;
  };

  const handleStyleToneChange = useCallback((style: StyleOption, tone: ToneOption) => {
    setPreferences({ preferredStyle: style, preferredTone: tone });
    saveLastSelections(style, tone);
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
      setGenerationProgress(prev => Math.min(95, prev + (Math.random() * 8 + 3)));
    }, 800);

    try {
      const { generateSocialPost } = await loadGeminiService();
      const result = await runGeminiTask('ai.generate', () =>
        generateSocialPost(selectedImage, style, tone, currentDealer.name, customerName, currentDealer.logo, customText, creativeBrief)
      );

      clearInterval(progressInterval);
      setGenerationProgress(100);
      setProgressMessage('Complete!');
      await new Promise(resolve => setTimeout(resolve, 300));

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
  }, [selectedImage, currentDealer, ensureApiKeyReady, runGeminiTask, setStep, setError, setGeneratedPost, loadGeminiService]);

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
  }, [selectedImage, lastGenerationParams, currentDealer, generatedPost, ensureApiKeyReady, runGeminiTask, setGeneratedPost, setError, loadGeminiService]);

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
  }, [selectedImage, currentDealer, generatedPost, ensureApiKeyReady, runGeminiTask, setGeneratedPost, setError, loadGeminiService]);

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
  }, [generatedPost, currentDealer, ensureApiKeyReady, runGeminiTask, setGeneratedPost, setError, loadGeminiService]);

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
  }, [selectedImage, lastGenerationParams, currentDealer, ensureApiKeyReady, generatedPost, runGeminiTask, setGeneratedPost, setError, loadGeminiService]);

  const handleEditText = useCallback(async (editPrompt: string) => {
    if (!generatedPost?.text || !editPrompt.trim() || !lastGenerationParams) return;
    if (!ensureApiKeyReady()) return;
    setError(null);
    try {
      const { editSocialPostText } = await loadGeminiService();
      const newText = await runGeminiTask('ai.edit.text', () =>
        editSocialPostText(generatedPost.text, editPrompt, lastGenerationParams.tone)
      );
      if (generatedPost) setGeneratedPost({ ...generatedPost, text: newText });
    } catch (err) {
      const msg = `Failed to edit text. ${err instanceof Error ? err.message : String(err)}`;
      setError(msg);
      toastError(msg);
    }
  }, [generatedPost, lastGenerationParams, ensureApiKeyReady, runGeminiTask, setGeneratedPost, setError, loadGeminiService]);

  const handleGenerateVideo = useCallback(async (style: VideoStyle, options: VideoRequestOptions): Promise<string> => {
    if (!generatedPost?.image) throw new Error("Cannot generate video without an image.");
    if (!ensureApiKeyReady()) throw new Error(API_KEY_REQUIRED_MESSAGE);
    setError(null);


    if (window.aistudio && typeof window.aistudio.hasSelectedApiKey === 'function') {

      const hasKey = await window.aistudio.hasSelectedApiKey();
      if (!hasKey) {

        if (typeof window.aistudio.openSelectKey === 'function') {
          alert("Video generation requires a personal API key due to processing costs. Please select your key.");

          await window.aistudio.openSelectKey();
        } else {
          throw new Error("Video generation is not available. Could not find key selection utility.");
        }
      }
    }

    try {
      const { generatePostVideo } = await loadGeminiService();
      return await runGeminiTask('ai.generate.video', () =>
        generatePostVideo(generatedPost.image, style, options)
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      if (msg.includes("Requested entity was not found")) {
        setError("Issue with selected API key. Please try again.");
        toastError("Issue with selected API key. Please try again.");

        if (window.aistudio?.openSelectKey) await window.aistudio.openSelectKey();
      } else {
        const errorMsg = `Failed to generate video. ${msg.replace('Video generation failed: ', '')}`;
        setError(errorMsg);
        toastError(errorMsg);
      }
      throw err;
    }
  }, [generatedPost, ensureApiKeyReady, runGeminiTask, setError, loadGeminiService]);

  // Layout Helpers
  const isCenteredStep = displayedStep === AppStep.LOGIN || displayedStep === AppStep.GENERATING;
  const layoutFlexClass = isCenteredStep ? 'justify-center' : 'justify-start';
  const layoutPadding = isCenteredStep
    ? (isDesktopLayout ? (compactMode ? 'py-4' : 'py-8') : 'py-10')
    : (isDesktopLayout ? (compactMode ? 'py-3' : 'py-6') : 'pt-8 pb-16');
  const layoutGap = isDesktopLayout ? (compactMode ? 'gap-4' : 'gap-6') : 'gap-6';

  return (
    <>
      <main className="h-screen w-full bg-surface-950 text-surface-50 flex flex-col overflow-hidden relative selection:bg-primary-500/30 selection:text-primary-100">
        <BackgroundPattern />

        {currentDealer && (
          <div className="relative z-10">
            <Header
              dealer={currentDealer}
              onLogout={logout}
              onShowSettings={() => setIsSettingsOpen(true)}
              isApiKeyConfigured={isApiKeyConfigured}
            />
          </div>
        )}
        
        <div className={`relative z-10 w-full flex flex-col flex-grow overflow-hidden px-4 sm:px-6 lg:px-10 ${animationClass}`}>
          <div className={`w-full max-w-screen-2xl mx-auto flex-1 min-h-0 flex flex-col overflow-auto scrollbar-hide ${layoutGap} ${layoutFlexClass} ${layoutPadding}`}>
            {displayedStep !== AppStep.ADMIN && displayedStep !== AppStep.LOGIN && <ProgressSteps activeStep={displayedStep} />}
            
            <MainContent 
              displayedStep={displayedStep}
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
              onShowSettings={() => setIsSettingsOpen(true)}
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
          </div>
        </div>
      </main>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        initialApiKey={apiKey ?? ''}
        defaultRemember={hasStoredApiKey}
        onSave={handleSettingsSave}
        compactMode={compactMode}
        onToggleCompactMode={(val) => setPreferences({ compactMode: val })}
      />

      <ImageCropModal
        isOpen={cropModalOpen}
        imageSrc={tempImageForCrop || ''}
        onConfirm={handleCropConfirm}
        onCancel={() => { setCropModalOpen(false); setTempImageForCrop(null); }}
      />
    </>
  );
};

export default App;
