import React, { useState, useCallback, useEffect, Suspense } from 'react';
import { AppStep, GeneratedPost, StyleOption, ToneOption, VideoStyle, Dealer, VideoRequestOptions } from './types';
import { useAppStore } from './stores/appStore';
import { Icon } from './components/Icons';
import { Header } from './components/Header';
import { SettingsModal } from './components/SettingsModal';
import { ImageCropModal } from './components/ImageCropModal';
import { ProgressBar } from './components/ui/ProgressBar';
import { getGeminiApiKey, setGeminiApiKey, getLastSelections, saveLastSelections } from './utils/settings';
import { configureGeminiClient, getActiveGeminiApiKey } from './services/geminiClient';
import { enqueueTask } from './services/requestQueue';
import { logEvent, logError } from './utils/telemetry';
import { ProgressSteps } from './components/ProgressSteps';
import { urlToDataUrl } from './utils/imageUtils';


const loadingMessages = [
  "Polishing the chrome...",
  "Adding that new car smell...",
  "Finding the perfect filter...",
  "Writing a winning caption...",
  "Warming up the engine...",
  "Consulting with our design AI...",
  "Applying your edits...",
  "Finalizing the details..."
];

const API_KEY_REQUIRED_MESSAGE = "Please add your Gemini API key in Settings to use AI features.";

type GeminiServiceModule = typeof import('./services/geminiService');
let geminiServiceModulePromise: Promise<GeminiServiceModule> | null = null;
const loadGeminiService = (): Promise<GeminiServiceModule> => {
  if (!geminiServiceModulePromise) {
    geminiServiceModulePromise = import('./services/geminiService');
  }
  return geminiServiceModulePromise;
};

const LazyLoginScreen = React.lazy(() => import('./components/LoginScreen').then(mod => ({ default: mod.LoginScreen })));
const LazyAdminDashboard = React.lazy(() => import('./components/AdminDashboard').then(mod => ({ default: mod.AdminDashboard })));
const LazyImageInput = React.lazy(() => import('./components/CameraCapture').then(mod => ({ default: mod.ImageInput })));
const LazyPostCustomizer = React.lazy(() => import('./components/PostCustomizer').then(mod => ({ default: mod.PostCustomizer })));
const LazyPostResult = React.lazy(() => import('./components/PostResult').then(mod => ({ default: mod.PostResult })));




const App: React.FC = () => {
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
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [hasStoredApiKey, setHasStoredApiKey] = useState(false);
  
  // Generation State (kept local as it's transient)
  const [generationProgress, setGenerationProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  
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

  const isApiKeyConfigured = Boolean(apiKey);
  
  // Layout Detection
  const [isDesktopLayout, setIsDesktopLayout] = useState(() => {
    if (typeof window === 'undefined') return true;
    const pointerFine = typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: fine)').matches : true;
    const canHover = typeof window.matchMedia === 'function' ? window.matchMedia('(hover: hover)').matches : true;
    const uaIsMobile = typeof navigator !== 'undefined'
      ? /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
      : false;
    const hasTouch = ('ontouchstart' in window || navigator.maxTouchPoints > 0);
    const isWideScreen = window.innerWidth >= 1200;
    return isWideScreen && pointerFine && canHover && !uaIsMobile && (!hasTouch || window.innerWidth >= 1440);
  });

  // ... (Keep existing helper functions: runGeminiTask, ensureApiKeyReady) ...
  
  const runGeminiTask = useCallback(async <T,>(name: string, task: () => Promise<T>, metadata?: Record<string, unknown>) => {
    logEvent(`${name}.start`, metadata);
    try {
      const result = await enqueueTask(task);
      logEvent(`${name}.success`, metadata);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError(`${name}.failure`, { ...metadata, message });
      throw error;
    }
  }, []);

  const ensureApiKeyReady = useCallback(() => {
    if (isApiKeyConfigured) {
      return true;
    }
    logError('app.apiKey.missing');
    setError(API_KEY_REQUIRED_MESSAGE);
    setIsSettingsOpen(true);
    return false;
  }, [isApiKeyConfigured, setError]);

  // Initialization
  useEffect(() => {
    logEvent('app.boot');
    
    // API Key
    const storedKey = getGeminiApiKey();
    if (storedKey) {
      configureGeminiClient(storedKey);
      setApiKey(storedKey);
      setHasStoredApiKey(true);
    } else {
      const bootstrapKey = getActiveGeminiApiKey();
      if (bootstrapKey) setApiKey(bootstrapKey);
    }

    // Restore Session
    restoreSession();
    
    // Layout Listeners
    if (typeof window === 'undefined') return;
    const updateLayoutMode = () => {
      const uaIsMobile = /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      const hasTouch = ('ontouchstart' in window || navigator.maxTouchPoints > 0);
      const isWideScreen = window.innerWidth >= 1200;
      const isDesktop = isWideScreen && !uaIsMobile && (!hasTouch || window.innerWidth >= 1440);
      setIsDesktopLayout(isDesktop);
    };
    window.addEventListener('resize', updateLayoutMode);
    return () => window.removeEventListener('resize', updateLayoutMode);
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

  const handleSettingsSave = useCallback(({ apiKey: nextKey, remember }: { apiKey: string; remember: boolean; }) => {
    const sanitized = nextKey.trim();
    const resolvedKey = sanitized.length ? sanitized : null;
    if (resolvedKey && remember) {
      setGeminiApiKey(resolvedKey);
      setHasStoredApiKey(true);
    } else {
      setGeminiApiKey(undefined);
      setHasStoredApiKey(false);
    }
    configureGeminiClient(resolvedKey);
    setApiKey(resolvedKey);
    setIsSettingsOpen(false);
    setError(null);
  }, [setError]);

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
      setError(`Failed to generate your post. ${errorMessage}`);
      setStep(AppStep.CUSTOMIZE);
    }
  }, [selectedImage, currentDealer, ensureApiKeyReady, runGeminiTask, setStep, setError, setGeneratedPost]);

  // ... (Other handlers: handleRegenerateImage, handleFunMode, etc. - similar updates to use store setters) ...
  // For brevity in this replacement, I will assume the other handlers are updated similarly or I need to include them all.
  // Since I'm replacing the WHOLE file content, I MUST include them all.

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
      setError(`Failed to regenerate image. ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [selectedImage, lastGenerationParams, currentDealer, generatedPost, ensureApiKeyReady, runGeminiTask, setGeneratedPost, setError]);

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
      setError(`Failed to generate fun image. ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [selectedImage, currentDealer, generatedPost, ensureApiKeyReady, runGeminiTask, setGeneratedPost, setError]);

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
      setError(`Failed to apply image edits. ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [generatedPost, currentDealer, ensureApiKeyReady, runGeminiTask, setGeneratedPost, setError]);

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
      setError(`Failed to regenerate text. ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [selectedImage, lastGenerationParams, currentDealer, ensureApiKeyReady, generatedPost, runGeminiTask, setGeneratedPost, setError]);

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
      setError(`Failed to edit text. ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [generatedPost, lastGenerationParams, ensureApiKeyReady, runGeminiTask, setGeneratedPost, setError]);

  const handleGenerateVideo = useCallback(async (style: VideoStyle, options: VideoRequestOptions): Promise<string> => {
    if (!generatedPost?.image) throw new Error("Cannot generate video without an image.");
    if (!ensureApiKeyReady()) throw new Error(API_KEY_REQUIRED_MESSAGE);
    setError(null);

    // @ts-ignore
    if (window.aistudio && typeof window.aistudio.hasSelectedApiKey === 'function') {
      // @ts-ignore
      const hasKey = await window.aistudio.hasSelectedApiKey();
      if (!hasKey) {
        // @ts-ignore
        if (typeof window.aistudio.openSelectKey === 'function') {
          alert("Video generation requires a personal API key due to processing costs. Please select your key.");
          // @ts-ignore
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
        // @ts-ignore
        if (window.aistudio?.openSelectKey) await window.aistudio.openSelectKey();
      } else {
        setError(`Failed to generate video. ${msg.replace('Video generation failed: ', '')}`);
      }
      throw err;
    }
  }, [generatedPost, ensureApiKeyReady, runGeminiTask, setError]);


  // Render Helpers
  const suspenseFallback = (label: string) => (
    <div className="flex min-h-[200px] w-full flex-col items-center justify-center gap-4 text-primary-300" role="status">
      <div className="relative w-12 h-12">
        <div className="absolute inset-0 rounded-full border-4 border-primary-500/30"></div>
        <div className="absolute inset-0 rounded-full border-4 border-primary-500 border-t-transparent animate-spin"></div>
      </div>
      <span className="text-xs font-semibold uppercase tracking-[0.2em] text-primary-300/70 animate-pulse">{label}</span>
    </div>
  );

  const renderContent = () => {
    switch (displayedStep) {
      case AppStep.LOGIN:
        return (
          <Suspense fallback={suspenseFallback('Loading login')}>
            <LazyLoginScreen
              onLogin={handleLogin}
              onShowSettings={() => setIsSettingsOpen(true)}
              isApiKeyConfigured={isApiKeyConfigured}
            />
          </Suspense>
        );
      case AppStep.ADMIN:
        return <Suspense fallback={suspenseFallback('Loading admin')}><LazyAdminDashboard /></Suspense>;
      case AppStep.CAPTURE:
        return (
          <Suspense fallback={suspenseFallback('Preparing camera')}>
            <LazyImageInput onImageSelected={handleImageSelected} onClose={reset} />
          </Suspense>
        );
      case AppStep.CUSTOMIZE:
        const customizerProps = {
          imageSrc: selectedImage!,
          onGenerate: handleGenerate,
          onBack: () => setStep(AppStep.CAPTURE),
          dealershipName: currentDealer!.name,
          defaultStyle: preferredStyle,
          defaultTone: preferredTone,
          onStyleToneChange: handleStyleToneChange,
          isApiKeyConfigured,
          onOpenSettings: () => setIsSettingsOpen(true),
          isDesktopLayout,
          isGenerating: step === AppStep.GENERATING,
        };
        if (error) {
          return (
            <div className="w-full max-w-screen-2xl mx-auto text-center p-4">
              <div className="mb-4 bg-error/10 border border-error/30 text-error px-4 py-3 rounded-xl flex items-center justify-center gap-2 backdrop-blur-sm">
                <Icon type="error" className="w-5 h-5" />
                <span>{error}</span>
              </div>
              {selectedImage && <Suspense fallback={suspenseFallback('Loading')}><LazyPostCustomizer {...customizerProps} /></Suspense>}
            </div>
          );
        }
        return selectedImage ? <Suspense fallback={suspenseFallback('Loading')}><LazyPostCustomizer {...customizerProps} /></Suspense> : null;
      case AppStep.GENERATING:
        return (
          <div className="text-center p-8 flex flex-col items-center justify-center h-full max-w-md mx-auto">
            <div className="relative w-24 h-24 mb-8">
              <div className="absolute inset-0 rounded-full border-4 border-primary-500/20"></div>
              <div className="absolute inset-0 rounded-full border-4 border-primary-500 border-t-transparent animate-spin"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <Icon type="sparkles" className="w-8 h-8 text-primary-400 animate-pulse" />
              </div>
            </div>
            <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary-400 to-secondary-400 mb-6 animate-pulse">
              Crafting Your Masterpiece...
            </h2>
            <ProgressBar value={generationProgress} message={progressMessage} loadingLabel="Generating" className="w-full" />
          </div>
        );
      case AppStep.RESULT:
        return generatedPost ? (
          <Suspense fallback={suspenseFallback('Loading results')}>
            <LazyPostResult
              post={generatedPost}
              onStartOver={reset}
              onRegenerateImage={handleRegenerateImage}
              onEditImage={handleEditImage}
              onRegenerateText={handleRegenerateText}
              onEditText={handleEditText}
              onFunMode={handleFunMode}
              onGenerateVideo={handleGenerateVideo}
              error={error}
              isDesktopLayout={isDesktopLayout}
            />
          </Suspense>
        ) : null;
      default:
        return null;
    }
  };

  const isCenteredStep = displayedStep === AppStep.LOGIN || displayedStep === AppStep.GENERATING;
  const layoutFlexClass = isCenteredStep ? 'justify-center' : 'justify-start';
  const layoutPadding = isCenteredStep
    ? (isDesktopLayout ? (compactMode ? 'py-4' : 'py-8') : 'py-10')
    : (isDesktopLayout ? (compactMode ? 'py-3' : 'py-6') : 'pt-8 pb-16');
  const layoutGap = isDesktopLayout ? (compactMode ? 'gap-4' : 'gap-6') : 'gap-6';

  return (
    <>
      <main className="h-screen w-full bg-surface-950 text-surface-50 flex flex-col overflow-hidden relative selection:bg-primary-500/30 selection:text-primary-100">
        {/* Background Pattern */}
        <div className="absolute inset-0 pointer-events-none z-0 opacity-40" style={{
          backgroundImage: `
            radial-gradient(circle at 50% 0%, rgba(59, 130, 246, 0.15), transparent 50%),
            linear-gradient(rgba(255, 255, 255, 0.02) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 255, 255, 0.02) 1px, transparent 1px)
          `,
          backgroundSize: '100% 100%, 40px 40px, 40px 40px'
        }} />

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
            {renderContent()}
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
