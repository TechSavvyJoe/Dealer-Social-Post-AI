import React, { Suspense } from 'react';
import { motion } from 'framer-motion';
import { AppStep, GeneratedPost, StyleOption, ToneOption, VideoStyle, VideoRequestOptions, Dealer } from '../types';
import { Icon } from './Icons';
import { LoadingOverlay } from './LoadingOverlay';
import { Button } from './ui/Button';

// Lazy load components
const LazyLoginScreen = React.lazy(() => import('./LoginScreen').then(mod => ({ default: mod.LoginScreen })));
const LazyAdminDashboard = React.lazy(() => import('./AdminDashboard').then(mod => ({ default: mod.AdminDashboard })));
const LazyImageInput = React.lazy(() => import('./CameraCapture').then(mod => ({ default: mod.ImageInput })));
const LazyPostCustomizer = React.lazy(() => import('./PostCustomizer').then(mod => ({ default: mod.PostCustomizer })));
const LazyPostResult = React.lazy(() => import('./PostResult').then(mod => ({ default: mod.PostResult })));

interface MainContentProps {
  displayedStep: AppStep;
  step: AppStep;
  currentDealer: Dealer | null;
  selectedImage: string | null;
  generatedPost: GeneratedPost | null;
  error: string | null;
  preferredStyle: StyleOption;
  preferredTone: ToneOption;
  isApiKeyConfigured: boolean;
  isDesktopLayout: boolean;
  generationProgress: number;
  progressMessage: string;
  
  // Handlers
  onLogin: (dealerId: string) => Promise<boolean>;
  onShowSettings: () => void;
  onImageSelected: (image: string) => void;
  onReset: () => void;
  onGenerate: (style: StyleOption, tone: ToneOption, customerName: string, customText?: string, creativeBrief?: string) => Promise<void>;
  onBackToCapture: () => void;
  onStyleToneChange: (style: StyleOption, tone: ToneOption) => void;
  onRegenerateImage: () => Promise<void>;
  onEditImage: (prompt: string) => Promise<void>;
  onRegenerateText: () => Promise<void>;
  onEditText: (prompt: string) => Promise<void>;
  onFunMode: (styleName?: string) => Promise<void>;
  onGenerateVideo: (style: VideoStyle, options: VideoRequestOptions) => Promise<string>;
}

export const MainContent: React.FC<MainContentProps> = ({
  displayedStep,
  step,
  currentDealer,
  selectedImage,
  generatedPost,
  error,
  preferredStyle,
  preferredTone,
  isApiKeyConfigured,
  isDesktopLayout,
  generationProgress,
  progressMessage,
  onLogin,
  onShowSettings,
  onImageSelected,
  onReset,
  onGenerate,
  onBackToCapture,
  onStyleToneChange,
  onRegenerateImage,
  onEditImage,
  onRegenerateText,
  onEditText,
  onFunMode,
  onGenerateVideo
}) => {

  const suspenseFallback = (label: string) => (
    <div className="flex min-h-[200px] w-full flex-col items-center justify-center gap-4 text-primary-300" role="status">
      <div className="relative w-12 h-12">
        <div className="absolute inset-0 rounded-full border-4 border-primary-500/30"></div>
        <div className="absolute inset-0 rounded-full border-4 border-primary-500 border-t-transparent animate-spin"></div>
      </div>
      <span className="text-xs font-semibold uppercase tracking-[0.2em] text-primary-300/70 animate-pulse">{label}</span>
    </div>
  );

  const stepContent = () => {
    switch (displayedStep) {
      case AppStep.LOGIN:
        return (
          <Suspense fallback={suspenseFallback('Loading login')}>
            <LazyLoginScreen
              onLogin={onLogin}
              onShowSettings={onShowSettings}
              isApiKeyConfigured={isApiKeyConfigured}
            />
          </Suspense>
        );
      case AppStep.ADMIN:
        return <Suspense fallback={suspenseFallback('Loading admin')}><LazyAdminDashboard /></Suspense>;
      case AppStep.CAPTURE:
        return (
          <Suspense fallback={suspenseFallback('Preparing camera')}>
            <LazyImageInput onImageSelected={onImageSelected} onClose={onReset} />
          </Suspense>
        );
      case AppStep.CUSTOMIZE:
        const customizerProps = {
          imageSrc: selectedImage!,
          onGenerate: onGenerate,
          onBack: onBackToCapture,
          dealershipName: currentDealer!.name,
          defaultStyle: preferredStyle,
          defaultTone: preferredTone,
          onStyleToneChange: onStyleToneChange,
          isApiKeyConfigured,
          onOpenSettings: onShowSettings,
          isDesktopLayout,
          isGenerating: step === AppStep.GENERATING,
        };
        
        if (error) {
          return (
            <div className="w-full max-w-screen-2xl mx-auto p-4 flex flex-col items-center justify-center min-h-[50vh]">
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-error/10 border border-error/30 p-6 rounded-2xl max-w-md w-full text-center backdrop-blur-md"
              >
                <div className="w-12 h-12 bg-error/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Icon type="error" className="w-6 h-6 text-error" />
                </div>
                <h3 className="text-lg font-bold text-white mb-2">Something went wrong</h3>
                <p className="text-error-200 mb-6">{error}</p>
                <div className="flex gap-3 justify-center">
                  <Button variant="outline" onClick={onReset}>Start Over</Button>
                  <Button variant="primary" onClick={() => window.location.reload()}>Reload App</Button>
                </div>
              </motion.div>
            </div>
          );
        }
        return selectedImage ? <Suspense fallback={suspenseFallback('Loading')}><LazyPostCustomizer {...customizerProps} /></Suspense> : null;
      case AppStep.GENERATING:
        return <LoadingOverlay progress={generationProgress} message={progressMessage} />;
      case AppStep.RESULT:
        return generatedPost ? (
          <Suspense fallback={suspenseFallback('Loading results')}>
            <LazyPostResult
              post={generatedPost}
              onStartOver={onReset}
              onRegenerateImage={onRegenerateImage}
              onEditImage={onEditImage}
              onRegenerateText={onRegenerateText}
              onEditText={onEditText}
              onFunMode={onFunMode}
              onGenerateVideo={onGenerateVideo}
              error={error}
              isDesktopLayout={isDesktopLayout}
            />
          </Suspense>
        ) : null;
      default:
        return null;
    }
  };

  return (
    <motion.div
      key={displayedStep}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="w-full h-full"
    >
      {stepContent()}
    </motion.div>
  );
};
