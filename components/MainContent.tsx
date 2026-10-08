import React, { Suspense } from "react";
import {
  AppStep,
  GeneratedPost,
  StyleOption,
  ToneOption,
  VideoStyle,
  VideoRequestOptions,
  Dealer,
  ImageSelection,
  MediaOutputMode,
  BrandCategoryId,
  SignatureLook,
} from "../types";
import { CreatingScreen } from "./CreatingScreen";
import { PageTransition } from "./ui/PageTransition";
import type { LoginResult, SessionLoginRequest } from "../stores/appStore";
import { useAppStore } from "../stores/appStore";
import type { PrimaryImageProfile, PlatformId } from "../services/platformCopy";
import type { WebsiteDraft } from "../services/websitePublishing";
import type { GenerationStage, GenerationPartsReady } from "../hooks/useGeneration";
const LazyLogin = React.lazy(() =>
  import("./LoginScreen").then((m) => ({ default: m.LoginScreen })),
);
const LazyAdmin = React.lazy(() =>
  import("./AdminDashboard").then((m) => ({ default: m.AdminDashboard })),
);
const LazyDealerAdmin = React.lazy(() =>
  import("./DealerAdminDashboard").then((m) => ({ default: m.DealerAdminDashboard })),
);
const LazyHome = React.lazy(() => import("./Home").then((m) => ({ default: m.Home })));
const LazyDetails = React.lazy(() =>
  import("./PostDetails").then((m) => ({ default: m.PostDetails })),
);
const LazyPost = React.lazy(() =>
  import("./PostScreen").then((m) => ({ default: m.PostScreen })),
);
const LazySpin = React.lazy(() =>
  import("./VehicleSpinStudio").then((m) => ({ default: m.VehicleSpinStudio })),
);
const LazyWork = React.lazy(() =>
  import("./MyWork").then((m) => ({ default: m.MyWork })),
);
export interface MainContentProps {
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

  generationStage?: GenerationStage;
  partsReady?: GenerationPartsReady;
  onCancelGeneration?: () => void;
  onPhotoPicked?: (
    selection: ImageSelection,
    categoryId: BrandCategoryId,
    scenarioId: string,
  ) => void;
  onOpenPost?: (post: GeneratedPost) => void;
  onReusePhoto?: (selection: ImageSelection) => void;
  onChangeLook?: (look: SignatureLook | StyleOption) => Promise<void>;
  // Handlers
  onLogin: (
    credentials: SessionLoginRequest,
    turnstileToken?: string,
  ) => Promise<LoginResult>;
  onImageSelected: (selection: ImageSelection) => void;
  onReset: () => void;
  onBackFromWork?: () => void;
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
  onPrepareFinalWebsiteDraft?: (input: {
    caption: string;
    image: string;
    currentDraft: WebsiteDraft;
  }) => Promise<WebsiteDraft>;
  onFunMode: (styleName?: string) => Promise<void>;
  onGenerateVideo: (style: VideoStyle, options: VideoRequestOptions) => Promise<string>;
  /**
   * One-shot caption generator for the alternatives modal. Returns the
   * fully-prepared caption (brand kit + delivery-language gating +
   * disclosures already applied) — callers must use it as-is, never re-run
   * prepareCaptionForDelivery on the result.
   */
  onGenerateCaptionVariant?: () => Promise<{
    caption: string;
    disclosures: string;
    disclosureCategories: string[];
  }>;
  onShowSettings?: () => void;
  onShowHistory?: () => void;
  onRequestLogout?: () => void;
  onManagementDirtyChange?: (dirty: boolean) => void;
  onSpinDirtyChange: (dirty: boolean) => void;
  onOpenSpin: () => void;
}

export const MainContent: React.FC<MainContentProps> = (props) => {
  const { displayedStep, selectedImage, generatedPost, currentDealer, error } = props;
  const draft = useAppStore((s) => s.postDraft);
  const authEpoch = useAppStore((s) => s.authEpoch);
  React.useEffect(() => {
    if (props.step === AppStep.CREATING) void import("./PostScreen").catch(() => {});
  }, [props.step]);
  const fallback = (label: string) => (
    <div
      role="status"
      className="flex min-h-64 flex-1 flex-col items-center justify-center gap-4 p-5 text-ink-2"
    >
      {selectedImage && displayedStep === AppStep.DETAILS && (
        <img
          src={selectedImage}
          alt="Your selected photo"
          className="max-h-64 max-w-full rounded-md object-contain"
        />
      )}
      <p>{label}</p>
    </div>
  );
  const openPost = (post: GeneratedPost) => props.onOpenPost?.(post);
  let content: React.ReactNode = null;
  switch (displayedStep) {
    case AppStep.LOGIN:
      content = <LazyLogin onLogin={props.onLogin} />;
      break;
    case AppStep.ADMIN:
      content = <LazyAdmin />;
      break;
    case AppStep.DEALER_ADMIN:
      content = (
        <>
          <button
            className="mx-4 mt-4 min-h-11 self-start rounded-sm border border-strong px-4 text-sm font-semibold text-ink"
            onClick={props.onOpenSpin}
          >
            360° vehicle studio & reviews
          </button>
          <LazyDealerAdmin
            onSettingsDirtyChange={props.onManagementDirtyChange}
            onOpenPost={openPost}
          />
        </>
      );
      break;
    case AppStep.VEHICLE_SPIN:
      content = <LazySpin key={authEpoch} onDirtyChange={props.onSpinDirtyChange} />;
      break;
    case AppStep.HOME:
      content = (
        <LazyHome
          onPhotoPicked={
            props.onPhotoPicked || ((selection) => props.onImageSelected(selection))
          }
          onOpenSpin={props.onOpenSpin}
          onShowHistory={() => props.onShowHistory?.()}
          onOpenPost={openPost}
        />
      );
      break;
    case AppStep.DETAILS:
      content = selectedImage ? (
        <LazyDetails
          imageSrc={selectedImage}
          onGenerate={props.onGenerate}
          onBack={props.onBackToCapture}
          onChangePhoto={(selection) =>
            props.onPhotoPicked?.(
              selection,
              draft?.categoryId || "deliveries",
              draft?.scenarioId || "customer_delivery",
            )
          }
          error={error}
          onDismissError={props.onDismissError}
        />
      ) : null;
      break;
    case AppStep.CREATING:
      content = (
        <CreatingScreen
          imageSrc={selectedImage}
          stage={props.generationStage || "design"}
          partsReady={props.partsReady || { image: false, caption: false }}
          onCancel={() => props.onCancelGeneration?.()}
        />
      );
      break;
    case AppStep.WORK:
      content = (
        <LazyWork
          onBack={props.onBackFromWork || props.onReset}
          onOpenPost={openPost}
          onReusePhoto={props.onReusePhoto || props.onImageSelected}
        />
      );
      break;
    case AppStep.POST:
      content = generatedPost ? (
        <LazyPost
          key={
            generatedPost.postId || generatedPost.aiMeta?.image?.attemptId || "unsaved"
          }
          post={generatedPost}
          onStartOver={props.onReset}
          onRemix={props.onRemix}
          onRegenerateImage={props.onRegenerateImage}
          onEditImage={props.onEditImage}
          onRegenerateText={props.onRegenerateText}
          onEditText={props.onEditText}
          onPrepareFinalWebsiteDraft={props.onPrepareFinalWebsiteDraft}
          onFunMode={props.onFunMode}
          onGenerateVideo={props.onGenerateVideo}
          onGenerateCaptionVariant={props.onGenerateCaptionVariant}
          onShowSettings={props.onShowSettings}
          onShowHistory={props.onShowHistory}
          onRequestLogout={props.onRequestLogout}
          error={error}
          isDesktopLayout={props.isDesktopLayout}
          requiresApproval={Boolean(currentDealer?.requires_approval)}
          bannedPhrases={currentDealer?.banned_phrases}
          onChangeLook={props.onChangeLook}
        />
      ) : null;
      break;
  }
  const viewport =
    displayedStep === AppStep.LOGIN || displayedStep === AppStep.CREATING;
  return (
    <PageTransition
      pageKey={String(displayedStep)}
      layout={viewport ? "viewport" : "content"}
      skipInitial={displayedStep === AppStep.LOGIN}
    >
      <div
        className={
          viewport
            ? "flex h-full min-h-0 w-full flex-1 flex-col"
            : "flex min-h-full w-full flex-none flex-col"
        }
        data-page-content-layout={viewport ? "viewport" : "content"}
      >
        <Suspense
          fallback={fallback(
            displayedStep === AppStep.DETAILS
              ? "Opening details…"
              : "Opening your workspace…",
          )}
        >
          {content}
        </Suspense>
      </div>
    </PageTransition>
  );
};
