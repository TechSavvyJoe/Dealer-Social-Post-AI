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
  GenerationParams,
  ImageSelection,
  MediaOutputMode,
} from "../types";
import { LoadingOverlay } from "./LoadingOverlay";
import { PageTransition } from "./ui/PageTransition";
import { Button } from "./ui/Button";
import { Shimmer } from "./ui/Shimmer";
import type { LoginResult, SessionLoginRequest } from "../stores/appStore";
import { useAppStore } from "../stores/appStore";
import type { PrimaryImageProfile, PlatformId } from "../services/platformCopy";

// Lazy load components
const LazyLoginScreen = React.lazy(() =>
  import("./LoginScreen").then((mod) => ({ default: mod.LoginScreen })),
);
const LazyAdminDashboard = React.lazy(() =>
  import("./AdminDashboard").then((mod) => ({ default: mod.AdminDashboard })),
);
const LazyDealerAdminDashboard = React.lazy(() =>
  import("./DealerAdminDashboard").then((mod) => ({
    default: mod.DealerAdminDashboard,
  })),
);
const LazyImageInput = React.lazy(() =>
  import("./CameraCapture").then((mod) => ({ default: mod.ImageInput })),
);
const LazyPostCustomizer = React.lazy(() =>
  import("./PostCustomizer").then((mod) => ({ default: mod.PostCustomizer })),
);
const LazyPostResult = React.lazy(() =>
  import("./PostResult").then((mod) => ({ default: mod.PostResult })),
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
  onLogin: (
    credentials: SessionLoginRequest,
    turnstileToken?: string,
  ) => Promise<LoginResult>;
  onImageSelected: (selection: ImageSelection) => void;
  onReset: () => void;
  /** Same-photo remix — keep capture, re-open CUSTOMIZE. */
  onRemix: () => void;
  onDismissError: () => void;
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
      scenarioId?: string;
      hasRelease?: boolean;
      websiteEnabled?: boolean;
      websiteVehicleDescription?: string;
      capturedRelease?: {
        customerName: string;
        signaturePngDataUrl: string;
        vin?: string;
      };
    },
    platformIds?: PlatformId[],
    outputProfile?: PrimaryImageProfile,
    mediaOutputMode?: MediaOutputMode,
  ) => Promise<void>;
  onBackToCapture: () => void;
  onStyleToneChange: (style: StyleOption, tone: ToneOption) => void;
  onRegenerateImage: () => Promise<void>;
  onEditImage: (prompt: string) => Promise<void>;
  onRegenerateText: () => Promise<void>;
  onEditText: (
    prompt: string,
    originalText?: string,
    platformId?: string,
  ) => Promise<string>;
  onFunMode: (styleName?: string) => Promise<void>;
  onGenerateVideo: (style: VideoStyle, options: VideoRequestOptions) => Promise<string>;
  /** One-shot caption generator for the alternatives modal. */
  onGenerateCaptionVariant?: () => Promise<string>;
  onShowSettings?: () => void;
  onShowHistory?: () => void;
  onRequestLogout?: () => void;
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
  onRemix,
  onDismissError,
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
  onShowSettings,
  onShowHistory,
  onRequestLogout,
}) => {
  const persistedGenerationParams = useAppStore((state) => state.generationParams);
  const [customizerSeed, setCustomizerSeed] = React.useState<GenerationParams | null>(
    () => (displayedStep === AppStep.CUSTOMIZE ? persistedGenerationParams : null),
  );

  // Returning to Capture starts a genuinely new post. Keep the persisted
  // values available for reload/remix recovery, but do not leak them into the
  // next photo's editor defaults.
  React.useEffect(() => {
    if (displayedStep === AppStep.CAPTURE) {
      setCustomizerSeed(null);
    }
  }, [displayedStep]);

  const handleCustomizerGenerate = React.useCallback(
    async (
      style: StyleOption,
      tone: ToneOption,
      customerName: string,
      customText?: string,
      creativeBrief?: string,
      meta?: {
        salespersonName?: string;
        salespersonId?: string;
        vin?: string;
        scenarioId?: string;
        hasRelease?: boolean;
        websiteEnabled?: boolean;
        websiteVehicleDescription?: string;
        capturedRelease?: {
          customerName: string;
          signaturePngDataUrl: string;
          vin?: string;
        };
      },
      platformIds?: PlatformId[],
      outputProfile?: PrimaryImageProfile,
      mediaOutputMode: MediaOutputMode = "photo",
    ) => {
      // Capture the exact editor choices before GENERATING unmounts the
      // customizer. If generation fails, or the result is remixed, the same
      // destination plan is available on the next CUSTOMIZE mount.
      setCustomizerSeed({
        style,
        tone,
        customerName,
        customText,
        creativeBrief,
        platformIds: platformIds ? [...platformIds] : undefined,
        scenarioId: meta?.scenarioId,
        mediaOutputMode,
        primaryFormatId: outputProfile?.primaryFormatId,
        imageAspectRatio: outputProfile?.imageAspectRatio,
        websiteEnabled: meta?.websiteEnabled,
        websiteVehicleDescription: meta?.websiteVehicleDescription,
      });
      await onGenerate(
        style,
        tone,
        customerName,
        customText,
        creativeBrief,
        meta,
        platformIds,
        outputProfile,
        mediaOutputMode,
      );
    },
    [onGenerate],
  );

  const handleRemixWithSelections = React.useCallback(() => {
    const base = persistedGenerationParams || customizerSeed;
    const postDeliveryParams = generatedPost
      ? {
          platformIds: generatedPost.platformIds,
          mediaOutputMode: generatedPost.mediaOutputMode,
          primaryFormatId: generatedPost.primaryFormatId,
          imageAspectRatio: generatedPost.imageAspectRatio,
          websiteEnabled: generatedPost.websiteDraft?.enabled,
          websiteVehicleDescription: generatedPost.websiteDraft?.vehicleDescription,
        }
      : {};

    setCustomizerSeed({
      style: base?.style ?? preferredStyle,
      tone: base?.tone ?? preferredTone,
      customerName: base?.customerName ?? "",
      customText: base?.customText,
      creativeBrief: base?.creativeBrief,
      platformIds: postDeliveryParams.platformIds ?? base?.platformIds,
      scenarioId: base?.scenarioId,
      mediaOutputMode:
        postDeliveryParams.mediaOutputMode ?? base?.mediaOutputMode ?? "photo",
      primaryFormatId: postDeliveryParams.primaryFormatId ?? base?.primaryFormatId,
      imageAspectRatio: postDeliveryParams.imageAspectRatio ?? base?.imageAspectRatio,
      websiteEnabled:
        postDeliveryParams.websiteEnabled ?? base?.websiteEnabled ?? false,
      websiteVehicleDescription:
        postDeliveryParams.websiteVehicleDescription ?? base?.websiteVehicleDescription,
    });
    onRemix();
  }, [
    customizerSeed,
    generatedPost,
    onRemix,
    persistedGenerationParams,
    preferredStyle,
    preferredTone,
  ]);

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
          <Suspense
            fallback={
              <div className="flex min-h-0 flex-1 items-center justify-center">
                {suspenseFallback("Loading login")}
              </div>
            }
          >
            <div className="flex min-h-0 w-full flex-1 flex-col">
              <LazyLoginScreen onLogin={onLogin} />
            </div>
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
            <LazyImageInput onImageSelected={onImageSelected} onClose={onReset} />
          </Suspense>
        );
      case AppStep.CUSTOMIZE:
        const customizerProps = {
          imageSrc: selectedImage!,
          onGenerate: handleCustomizerGenerate,
          onBack: onBackToCapture,
          dealershipName: currentDealer!.name,
          defaultStyle: preferredStyle,
          defaultTone: preferredTone,
          onStyleToneChange: onStyleToneChange,
          isDesktopLayout,
          isGenerating: step === AppStep.GENERATING,
          initialGenerationParams: customizerSeed,
        };

        return selectedImage ? (
          <div className="mx-auto w-full max-w-screen-2xl space-y-4">
            {error ? (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                className="mx-auto flex max-w-3xl flex-col gap-3 rounded-xl border border-error-500/30 bg-error-500/10 p-4 text-error-100 sm:flex-row sm:items-center sm:justify-between"
                role="alert"
              >
                <div>
                  <p className="font-semibold">Generation was interrupted</p>
                  <p className="mt-1 text-sm text-error-200">{error}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onDismissError}
                  className="shrink-0"
                >
                  Back to editor
                </Button>
              </motion.div>
            ) : null}
            <Suspense fallback={suspenseFallback("Loading editor")}>
              <LazyPostCustomizer {...customizerProps} />
            </Suspense>
          </div>
        ) : null;
      case AppStep.GENERATING:
        return (
          <LoadingOverlay progress={generationProgress} message={progressMessage} />
        );
      case AppStep.RESULT:
        return generatedPost ? (
          <Suspense fallback={suspenseFallback("Loading results")}>
            <LazyPostResult
              key={
                generatedPost.postId ||
                generatedPost.aiMeta?.image.attemptId ||
                generatedPost.image
              }
              post={generatedPost}
              onStartOver={onReset}
              onRemix={handleRemixWithSelections}
              onRegenerateImage={onRegenerateImage}
              onEditImage={onEditImage}
              onRegenerateText={onRegenerateText}
              onEditText={onEditText}
              onFunMode={onFunMode}
              onGenerateVideo={onGenerateVideo}
              onGenerateCaptionVariant={onGenerateCaptionVariant}
              onShowSettings={onShowSettings}
              onShowHistory={onShowHistory}
              onRequestLogout={onRequestLogout}
              error={error}
              isDesktopLayout={isDesktopLayout}
              requiresApproval={Boolean(currentDealer?.requires_approval)}
              bannedPhrases={currentDealer?.banned_phrases}
            />
          </Suspense>
        ) : null;
      default:
        return null;
    }
  };

  return (
    <PageTransition pageKey={String(displayedStep)}>
      <div className="flex h-full min-h-0 w-full flex-1 flex-col">{stepContent()}</div>
    </PageTransition>
  );
};
