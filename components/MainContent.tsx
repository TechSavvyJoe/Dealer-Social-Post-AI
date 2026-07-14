import React, { Suspense } from "react";
import { motion } from "framer-motion";
import {
  AppStep,
  GeneratedPost,
  StyleOption,
  ToneOption,
  VideoStyle,
  VideoRequestOptions,
  Dealer,
} from "../types";
import { Icon } from "./Icons";
import { LoadingOverlay } from "./LoadingOverlay";
import { VinScanner } from "./VinScanner";
import { PageTransition } from "./ui/PageTransition";
import { Button } from "./ui/Button";
import { Shimmer } from "./ui/Shimmer";

// Lazy load components
const LazyLoginScreen = React.lazy(() =>
  import("./LoginScreen").then((mod) => ({ default: mod.LoginScreen }))
);
const LazyAdminDashboard = React.lazy(() =>
  import("./AdminDashboard").then((mod) => ({ default: mod.AdminDashboard }))
);
const LazyDealerAdminDashboard = React.lazy(() =>
  import("./DealerAdminDashboard").then((mod) => ({
    default: mod.DealerAdminDashboard,
  }))
);
const LazyImageInput = React.lazy(() =>
  import("./CameraCapture").then((mod) => ({ default: mod.ImageInput }))
);
const LazyPostCustomizer = React.lazy(() =>
  import("./PostCustomizer").then((mod) => ({ default: mod.PostCustomizer }))
);
const LazyPostResult = React.lazy(() =>
  import("./PostResult").then((mod) => ({ default: mod.PostResult }))
);

interface MainContentProps {
  displayedStep: AppStep;
  step: AppStep;
  currentDealer: Dealer | null;
  selectedImage: string | null;
  generatedPost: GeneratedPost | null;
  error: string | null;
  preferredStyle: StyleOption;
  preferredTone: ToneOption;
  isDesktopLayout: boolean;
  generationProgress: number;
  progressMessage: string;

  // Handlers
  onLogin: (dealerId: string) => Promise<boolean>;
  onImageSelected: (image: string) => void;
  onReset: () => void;
  onGenerate: (
    style: StyleOption,
    tone: ToneOption,
    customerName: string,
    customText?: string,
    creativeBrief?: string,
    meta?: {
      salespersonName?: string;
      salespersonId?: string;
      vin?: string;
      hasRelease?: boolean;
      capturedRelease?: {
        customerName: string;
        signaturePngDataUrl: string;
        vin?: string;
      };
    }
  ) => Promise<void>;
  onBackToCapture: () => void;
  onStyleToneChange: (style: StyleOption, tone: ToneOption) => void;
  onRegenerateImage: () => Promise<void>;
  onEditImage: (prompt: string) => Promise<void>;
  onRegenerateText: () => Promise<void>;
  onEditText: (prompt: string) => Promise<void>;
  onFunMode: (styleName?: string) => Promise<void>;
  onGenerateVideo: (
    style: VideoStyle,
    options: VideoRequestOptions
  ) => Promise<string>;
  /** One-shot caption generator for the alternatives modal. */
  onGenerateCaptionVariant?: () => Promise<string>;
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
  isDesktopLayout,
  generationProgress,
  progressMessage,
  onLogin,
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
  onGenerateVideo,
  onGenerateCaptionVariant,
}) => {
  const suspenseFallback = (label: string) => (
    <div
      className="w-full max-w-2xl mx-auto p-4 flex flex-col items-center justify-center min-h-[50vh] space-y-6"
      role="status"
    >
      <div className="w-full space-y-4">
        <Shimmer className="w-full h-64 rounded-2xl" />
        <div className="space-y-2">
          <Shimmer className="w-3/4 h-8 rounded-lg" />
          <Shimmer className="w-1/2 h-4 rounded-lg" />
        </div>
        <div className="grid grid-cols-2 gap-4 pt-4">
          <Shimmer className="h-24 rounded-xl" />
          <Shimmer className="h-24 rounded-xl" />
        </div>
      </div>
      <span className="text-xs font-semibold uppercase tracking-[0.2em] text-primary-300/70 animate-pulse">
        {label}
      </span>
    </div>
  );

  const stepContent = () => {
    switch (displayedStep) {
      case AppStep.LOGIN:
        return (
          <Suspense fallback={suspenseFallback("Loading login")}>
            <LazyLoginScreen onLogin={onLogin} />
          </Suspense>
        );
      case AppStep.ADMIN:
        return (
          <Suspense fallback={suspenseFallback("Loading admin")}>
            <LazyAdminDashboard />
          </Suspense>
        );
      case AppStep.DEALER_ADMIN:
        return (
          <Suspense fallback={suspenseFallback("Loading dealership dashboard")}>
            <LazyDealerAdminDashboard />
          </Suspense>
        );
      case AppStep.CAPTURE:
        return (
          <Suspense fallback={suspenseFallback("Preparing camera")}>
            <LazyImageInput
              onImageSelected={onImageSelected}
              onClose={onReset}
            />
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
                <h3 className="text-lg font-bold text-white mb-2">
                  Something went wrong
                </h3>
                <p className="text-error-200 mb-6">{error}</p>
                <div className="flex gap-3 justify-center">
                  <Button variant="outline" onClick={onReset}>
                    Start Over
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => window.location.reload()}
                  >
                    Reload App
                  </Button>
                </div>
              </motion.div>
            </div>
          );
        }
        return selectedImage ? (
          <Suspense fallback={suspenseFallback("Loading")}>
            <LazyPostCustomizer {...customizerProps} />
          </Suspense>
        ) : null;
      case AppStep.GENERATING:
        return (
          <LoadingOverlay
            progress={generationProgress}
            message={progressMessage}
          />
        );
      case AppStep.RESULT:
        return generatedPost ? (
          <Suspense fallback={suspenseFallback("Loading results")}>
            <LazyPostResult
              post={generatedPost}
              onStartOver={onReset}
              onRegenerateImage={onRegenerateImage}
              onEditImage={onEditImage}
              onRegenerateText={onRegenerateText}
              onEditText={onEditText}
              onFunMode={onFunMode}
              onGenerateVideo={onGenerateVideo}
              onGenerateCaptionVariant={onGenerateCaptionVariant}
              error={error}
              isDesktopLayout={isDesktopLayout}
              requiresApproval={Boolean(currentDealer?.requires_approval)}
            />
          </Suspense>
        ) : null;
      default:
        return null;
    }
  };

  return (
    <PageTransition pageKey={String(displayedStep)}>
      <div className="w-full flex-1 flex flex-col h-full">
        {stepContent()}
      </div>
    </PageTransition>
  );
};
