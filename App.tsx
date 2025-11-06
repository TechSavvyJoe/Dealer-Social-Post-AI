import React, { useState, useCallback, useEffect, Suspense } from 'react';
import { AppStep, GeneratedPost, StyleOption, ToneOption, VideoStyle, Dealer, VideoRequestOptions } from './types';
import { Icon } from './components/Icons';
import { triggerHapticFeedback } from './utils/haptics';
import { findDealer } from './services/database';
import { urlToDataUrl } from './utils/imageUtils';
import { Header } from './components/Header';
import { SettingsModal } from './components/SettingsModal';
import { getGeminiApiKey, setGeminiApiKey, getLastSelections, saveLastSelections } from './utils/settings';
import { configureGeminiClient, getActiveGeminiApiKey } from './services/geminiClient';
import { enqueueTask } from './services/requestQueue';
import { logEvent, logError } from './utils/telemetry';
import { ProgressSteps } from './components/ProgressSteps';
import { loadSession, saveSession, clearSession } from './utils/persistence';


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
  const [step, setStep] = useState<AppStep>(AppStep.LOGIN);
  const [displayedStep, setDisplayedStep] = useState(step);
  const [animationClass, setAnimationClass] = useState('animate-fade-in');

  const [currentDealer, setCurrentDealer] = useState<Dealer | null>(null);

  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [generatedPost, setGeneratedPost] = useState<GeneratedPost | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [hasStoredApiKey, setHasStoredApiKey] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [preferredStyle, setPreferredStyle] = useState<StyleOption>(StyleOption.Modern);
  const [preferredTone, setPreferredTone] = useState<ToneOption>(ToneOption.Excited);
  const isApiKeyConfigured = Boolean(apiKey);
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

  const [lastGenerationParams, setLastGenerationParams] = useState<{
    style: StyleOption;
    tone: ToneOption;
    customerName: string;
    customText?: string;
    creativeBrief?: string;
  } | null>(null);

  const persistSession = useCallback((partial: Partial<{ generatedPost: GeneratedPost | null; selectedImage: string | null; step: AppStep }>) => {
    if (!currentDealer) return;
    const payload = {
      dealerId: currentDealer.id,
      generatedPost: partial.generatedPost ?? generatedPost ?? undefined,
      selectedImage: partial.selectedImage ?? selectedImage ?? undefined,
      step: partial.step ?? step,
    };
    saveSession(payload);
  }, [currentDealer, generatedPost, selectedImage, step]);

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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const pointerMedia = typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: fine)') : null;
    const hoverMedia = typeof window.matchMedia === 'function' ? window.matchMedia('(hover: hover)') : null;

    let resizeTimeout: NodeJS.Timeout;

    const updateLayoutMode = () => {
      // Enhanced mobile detection including tablets
      const uaIsMobile = typeof navigator !== 'undefined'
        ? /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
        : false;

      // Check for touchscreen capability (tablets may report as desktop)
      const hasTouch = typeof window !== 'undefined'
        ? ('ontouchstart' in window || navigator.maxTouchPoints > 0)
        : false;

      const pointerFine = pointerMedia ? pointerMedia.matches : true;
      const canHover = hoverMedia ? hoverMedia.matches : true;
      const isWideScreen = window.innerWidth >= 1200;

      // Desktop = wide screen + fine pointer + hover support + not mobile UA + (no touch OR very wide screen)
      const isDesktop = isWideScreen && pointerFine && canHover && !uaIsMobile && (!hasTouch || window.innerWidth >= 1440);

      setIsDesktopLayout(isDesktop);
    };

    // Debounced resize handler for better performance
    const debouncedUpdate = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(updateLayoutMode, 150);
    };

    updateLayoutMode();
    window.addEventListener('resize', debouncedUpdate);
    pointerMedia?.addEventListener('change', updateLayoutMode);
    hoverMedia?.addEventListener('change', updateLayoutMode);

    return () => {
      clearTimeout(resizeTimeout);
      window.removeEventListener('resize', debouncedUpdate);
      pointerMedia?.removeEventListener('change', updateLayoutMode);
      hoverMedia?.removeEventListener('change', updateLayoutMode);
    };
  }, []);

  useEffect(() => {
    let intervalId: number;
    if (step === AppStep.GENERATING) {
      intervalId = window.setInterval(() => {
        setLoadingMessageIndex((prevIndex) => (prevIndex + 1) % loadingMessages.length);
      }, 2500);
    }
    return () => window.clearInterval(intervalId);
  }, [step]);

  useEffect(() => {
    logEvent('app.boot');

    const storedKey = getGeminiApiKey();
    if (storedKey) {
        configureGeminiClient(storedKey);
        setApiKey(storedKey);
        setHasStoredApiKey(true);
    } else {
        const bootstrapKey = getActiveGeminiApiKey();
        if (bootstrapKey) {
            setApiKey(bootstrapKey);
        }
    }

    const { lastStyle, lastTone } = getLastSelections();
    if (lastStyle) {
        setPreferredStyle(lastStyle);
    }
    if (lastTone) {
        setPreferredTone(lastTone);
    }

    const session = loadSession();
    if (session?.dealerId) {
      (async () => {
        try {
          const dealer = await findDealer(session.dealerId!);
          if (dealer) {
            setCurrentDealer(dealer);
            if (session.selectedImage) {
              setSelectedImage(session.selectedImage);
            }
            if (session.generatedPost) {
              setGeneratedPost(session.generatedPost);
            }
            if (typeof session.step === 'number') {
              setStep(session.step as AppStep);
            } else {
              setStep(session.generatedPost ? AppStep.RESULT : AppStep.CAPTURE);
            }
            logEvent('app.session.restored', { step: session.step, dealer: dealer.id });
          } else {
            clearSession();
          }
        } catch (error) {
          clearSession();
          logError('app.session.restoreFailed', { message: error instanceof Error ? error.message : String(error) });
        }
      })();
    }
  }, []);

  useEffect(() => {
    if (step !== displayedStep) {
      setAnimationClass('animate-fade-out');
      const timer = setTimeout(() => {
        setDisplayedStep(step);
        setAnimationClass('animate-fade-in');
      }, 500); // Must match animation duration
      return () => clearTimeout(timer);
    }
  }, [step, displayedStep]);

  useEffect(() => {
    logEvent('app.step.change', { step: AppStep[step] });
  }, [step]);

  const ensureApiKeyReady = useCallback(() => {
    if (isApiKeyConfigured) {
      return true;
    }
    logError('app.apiKey.missing');
    setError(API_KEY_REQUIRED_MESSAGE);
    setIsSettingsOpen(true);
    return false;
  }, [isApiKeyConfigured]);

  const handleStyleToneChange = useCallback((style: StyleOption, tone: ToneOption) => {
    setPreferredStyle(style);
    setPreferredTone(tone);
    saveLastSelections(style, tone);
  }, []);

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
  }, []);

  const handleImageSelected = useCallback((image: string) => {
    setSelectedImage(image);
    setGeneratedPost(null);
    setStep(AppStep.CUSTOMIZE);
    setError(null);
    persistSession({ selectedImage: image, generatedPost: null, step: AppStep.CUSTOMIZE });
  }, [persistSession]);

  const handleLogin = async (dealerId: string): Promise<boolean> => {
    const dealer = await findDealer(dealerId);

    if (dealer) {
        if (dealer.logo && dealer.logo.startsWith('http')) {
            try {
                const logoDataUrl = await urlToDataUrl(dealer.logo);
                dealer.logo = logoDataUrl;
            } catch (error) {
                console.error(`Failed to fetch and convert dealer logo from URL: ${dealer.logo}`, error);
                dealer.logo = undefined;
            }
        }

        setCurrentDealer(dealer);
        const targetStep = dealer.id === '0000' ? AppStep.ADMIN : AppStep.CAPTURE;
        setStep(targetStep);
        setError(null);
        
        // Save session with login timestamp for persistence
        saveSession({
            dealerId: dealer.id,
            step: targetStep,
            loginTimestamp: Date.now()
        });
        
        return true;
    }
    return false;
  };

  const handleLogout = () => {
      triggerHapticFeedback();
      setCurrentDealer(null);
      setSelectedImage(null);
      setGeneratedPost(null);
      setError(null);
      setStep(AppStep.LOGIN);
      clearSession();
  };

  const handleGenerate = useCallback(async (style: StyleOption, tone: ToneOption, customerName:string, customText?: string, creativeBrief?: string) => {
    if (!selectedImage || !currentDealer) return;
    if (!ensureApiKeyReady()) return;

    setStep(AppStep.GENERATING);
    setError(null);
    setLastGenerationParams({ style, tone, customerName, customText, creativeBrief });
    try {
      const { generateSocialPost } = await loadGeminiService();
      const result = await runGeminiTask('ai.generate', () =>
        generateSocialPost(selectedImage, style, tone, currentDealer.name, customerName, currentDealer.logo, customText, creativeBrief)
      , { style, tone, dealership: currentDealer.name, creativeBrief });
      setGeneratedPost(result);
      setStep(AppStep.RESULT);
      persistSession({ generatedPost: result, step: AppStep.RESULT });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
      setError(`Failed to generate your post. Please try again. ${errorMessage}`);
      setStep(AppStep.CUSTOMIZE);
    }
  }, [selectedImage, currentDealer, ensureApiKeyReady, persistSession]);
  
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
      , { style: lastGenerationParams.style, tone: lastGenerationParams.tone, dealership: currentDealer.name, creativeBrief: lastGenerationParams.creativeBrief });
      setGeneratedPost(result);
      persistSession({ generatedPost: result });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
      setError(`Failed to regenerate image. ${errorMessage}`);
    }
  }, [selectedImage, lastGenerationParams, currentDealer, generatedPost, ensureApiKeyReady, persistSession]);
  
  const handleEditImage = useCallback(async (editPrompt: string) => {
    if (!generatedPost?.image || !editPrompt.trim() || !currentDealer) return;
    if (!ensureApiKeyReady()) return;
    setError(null);
    try {
        const { editSocialPostImage } = await loadGeminiService();
        const newImage = await runGeminiTask('ai.edit.image', () =>
          editSocialPostImage(generatedPost.image, editPrompt, currentDealer.name, currentDealer.logo)
        , { dealership: currentDealer.name });
        const updatedPost = generatedPost ? { ...generatedPost, image: newImage } : null;
        setGeneratedPost(updatedPost);
        if (updatedPost) {
          persistSession({ generatedPost: updatedPost });
        }
    } catch(err) {
        const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
        setError(`Failed to apply image edits. ${errorMessage}`);
    }
  }, [generatedPost, currentDealer, ensureApiKeyReady, persistSession]);

  const handleFunMode = useCallback(async () => {
    if (!selectedImage || !currentDealer) return;
    if (!ensureApiKeyReady()) return;
    setError(null);
    try {
        // Use the original selected image for Fun Mode for a clean slate
        const { generateFunSocialPostImage } = await loadGeminiService();
        const newImage = await runGeminiTask('ai.funmode.image', () =>
          generateFunSocialPostImage(selectedImage, currentDealer.name, currentDealer.logo)
        , { dealership: currentDealer.name });
        setGeneratedPost(prev => {
          const updated = prev ? { ...prev, image: newImage } : { image: newImage, text: prev?.text || 'Congratulations!' };
          persistSession({ generatedPost: updated });
          return updated;
        });
    } catch(err) {
        const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
        setError(`Failed to generate fun image. ${errorMessage}`);
    }
  }, [selectedImage, currentDealer, ensureApiKeyReady, persistSession]);

  const handleRegenerateText = useCallback(async () => {
    if (!selectedImage || !lastGenerationParams || !currentDealer) return;
    if (!ensureApiKeyReady()) return;
    setError(null);
    try {
      const { generateSocialPostText } = await loadGeminiService();
      const newText = await runGeminiTask('ai.regenerate.text', () =>
        generateSocialPostText(
          selectedImage,
          lastGenerationParams.tone,
          currentDealer.name,
          lastGenerationParams.customerName,
          true,
          lastGenerationParams.creativeBrief
        )
      , { tone: lastGenerationParams.tone, dealership: currentDealer.name, creativeBrief: lastGenerationParams.creativeBrief });
      const updatedPost = generatedPost ? { ...generatedPost, text: newText } : null;
      setGeneratedPost(updatedPost);
      if (updatedPost) {
        persistSession({ generatedPost: updatedPost });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
      setError(`Failed to regenerate text. ${errorMessage}`);
    }
  }, [selectedImage, lastGenerationParams, currentDealer, ensureApiKeyReady, generatedPost, persistSession]);

  const handleEditText = useCallback(async (editPrompt: string) => {
    if (!generatedPost?.text || !editPrompt.trim() || !lastGenerationParams) return;
    if (!ensureApiKeyReady()) return;
    setError(null);
    try {
      const { editSocialPostText } = await loadGeminiService();
      const newText = await runGeminiTask('ai.edit.text', () =>
        editSocialPostText(
          generatedPost.text,
          editPrompt,
          lastGenerationParams.tone
        )
      , { tone: lastGenerationParams.tone, dealership: currentDealer?.name, creativeBrief: lastGenerationParams.creativeBrief });
      const updatedPost = generatedPost ? { ...generatedPost, text: newText } : null;
      setGeneratedPost(updatedPost);
      if (updatedPost) {
        persistSession({ generatedPost: updatedPost });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
      setError(`Failed to edit text. ${errorMessage}`);
    }
  }, [generatedPost, lastGenerationParams, ensureApiKeyReady, persistSession]);

  const handleGenerateVideo = useCallback(async (style: VideoStyle, options: VideoRequestOptions): Promise<string> => {
    if (!generatedPost?.image) {
        throw new Error("Cannot generate video without an image.");
    }
    if (!ensureApiKeyReady()) {
        throw new Error(API_KEY_REQUIRED_MESSAGE);
    }
    setError(null);

    // Check for API key selection for Veo models, a requirement for video generation.
    // @ts-ignore - aistudio is globally available in this environment
    if (window.aistudio && typeof window.aistudio.hasSelectedApiKey === 'function') {
        // @ts-ignore
        const hasKey = await window.aistudio.hasSelectedApiKey();
        if (!hasKey) {
            // @ts-ignore
            if (typeof window.aistudio.openSelectKey === 'function') {
                alert("Video generation requires a personal API key due to processing costs. Please select your key.\n\nFor more info on billing, visit: ai.google.dev/gemini-api/docs/billing");
                // @ts-ignore
                await window.aistudio.openSelectKey();
                // After this, we assume the key is selected and proceed. Errors will be caught below.
            } else {
                 const errMsg = "Video generation is not available. Could not find key selection utility.";
                 setError(errMsg);
                 throw new Error(errMsg);
            }
        }
    }

    try {
        const { generatePostVideo } = await loadGeminiService();
        const videoUrl = await runGeminiTask('ai.generate.video', () =>
          generatePostVideo(generatedPost.image, style, options)
        , { style, dealership: currentDealer?.name, duration: options.durationSeconds, soundtrack: options.soundtrack });
        return videoUrl;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
      // Handle the specific error for an invalid API key selection.
      if (errorMessage.includes("Requested entity was not found")) {
         setError("There was an issue with your selected API key. Please try generating the video again.");
         // @ts-ignore
         if (window.aistudio && typeof window.aistudio.openSelectKey === 'function') {
            // @ts-ignore
            await window.aistudio.openSelectKey();
         }
      } else if (errorMessage.toLowerCase().includes("overloaded")) {
        setError("The video generation service is very busy right now. We tried a few times, but it's still overloaded. Please try again in a few minutes.");
      } else {
        setError(`Failed to generate video. ${errorMessage.replace('Video generation failed: ', '')}`);
      }
      throw err; // Re-throw to be caught by the caller in PostResult
    }
  }, [generatedPost, ensureApiKeyReady]);


  const handleStartOver = useCallback(() => {
    setGeneratedPost(null);
    setSelectedImage(null);
    setError(null);
    setLastGenerationParams(null);
    setStep(AppStep.CAPTURE);
    clearSession();
  }, []);

  const handleBackToCapture = useCallback(() => {
      setSelectedImage(null);
      setError(null);
      setStep(AppStep.CAPTURE);
  }, []);

  const suspenseFallback = (label: string) => (
    <div className="flex min-h-[200px] w-full flex-col items-center justify-center gap-4 text-indigo-200">
      <svg className="h-8 w-8 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      <span className="text-xs font-semibold uppercase tracking-[0.3em] text-indigo-200/70">{label}</span>
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
        return (
          <Suspense fallback={suspenseFallback('Loading admin tools')}>
            <LazyAdminDashboard />
          </Suspense>
        );
      case AppStep.CAPTURE:
        return (
          <Suspense fallback={suspenseFallback('Preparing camera')}>
            <LazyImageInput onImageSelected={handleImageSelected} onClose={handleStartOver} />
          </Suspense>
        );
      case AppStep.CUSTOMIZE:
        const customizerProps = {
            imageSrc: selectedImage!, 
            onGenerate: handleGenerate, 
            onBack: handleBackToCapture, 
            dealershipName: currentDealer!.name,
            defaultStyle: preferredStyle,
            defaultTone: preferredTone,
            onStyleToneChange: handleStyleToneChange,
            isApiKeyConfigured,
            onOpenSettings: () => setIsSettingsOpen(true),
            isDesktopLayout,
        };
        if (error) {
            return (
              <div className="w-full max-w-screen-2xl mx-auto text-center p-4">
                <div className="mb-4 bg-red-900/50 border border-red-700 text-red-300 px-4 py-3 rounded-lg flex items-center justify-center gap-2">
                  <Icon type="error" className="w-5 h-5"/>
                  <span>{error}</span>
                </div>
                 { selectedImage && (
                   <Suspense fallback={suspenseFallback('Loading customizer')}>
                     <LazyPostCustomizer {...customizerProps} />
                   </Suspense>
                 ) }
              </div>
            );
        }
        return selectedImage ? (
          <Suspense fallback={suspenseFallback('Loading customizer')}>
            <LazyPostCustomizer {...customizerProps} />
          </Suspense>
        ) : null;
      case AppStep.GENERATING:
        return (
          <div className="text-center p-8 flex flex-col items-center justify-center h-full">
            <svg className="animate-spin h-20 w-20 text-indigo-400 mb-8" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <h2 className="text-3xl font-bold text-white mb-4 animate-pulse">Crafting Your Masterpiece...</h2>
            <p className="text-indigo-300 text-lg transition-opacity duration-500 h-6">
              {loadingMessages[loadingMessageIndex]}
            </p>
          </div>
        );
      case AppStep.RESULT:
        return generatedPost ? (
          <Suspense fallback={suspenseFallback('Loading results')}>
            <LazyPostResult
              post={generatedPost}
              onStartOver={handleStartOver}
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
  // Reduce vertical padding on desktop to minimize unnecessary page scroll
  const layoutPadding = isCenteredStep
    ? (isDesktopLayout ? 'py-8' : 'py-10')
    : (isDesktopLayout ? 'py-6' : 'pt-8 pb-16');
  // Slightly smaller gaps on desktop to tighten layout
  const layoutGap = isDesktopLayout ? 'gap-6' : 'gap-6';

  return (
    <>
  <main className="h-screen w-full text-slate-100 flex flex-col overflow-hidden">
        {currentDealer && (
          <Header
            dealer={currentDealer}
            onLogout={handleLogout}
            onShowSettings={() => setIsSettingsOpen(true)}
            isApiKeyConfigured={isApiKeyConfigured}
          />
        )}
        <div className={`w-full flex flex-col flex-grow overflow-hidden px-4 sm:px-6 lg:px-10 ${animationClass}`}>
          <div className={`w-full max-w-screen-2xl mx-auto flex-1 min-h-0 flex flex-col overflow-auto ${layoutGap} ${layoutFlexClass} ${layoutPadding}`}>
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
      />
    </>
  );
};

export default App;
