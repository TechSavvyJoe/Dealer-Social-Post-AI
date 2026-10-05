import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  Film,
  Loader2,
  RefreshCw,
  Share2,
  Sparkles,
} from "lucide-react";
import type {
  GeneratedPost,
  SignatureLook,
  StyleOption,
  VideoRequestOptions,
  VideoStyle,
} from "../types";
import type { WebsiteDraft } from "../services/websitePublishing";
import type { PlatformDestinationId } from "../services/platformOutputs";
import type { StoreLook } from "../services/storeDefaults";
import { resolveStoreDefaults } from "../services/storeDefaults";
import { brandCategoryForScenario } from "../services/creativeSystem";
import { deliveryLanguageAllowedForBrief } from "../services/promptsV2";
import { scenarioToCreativeBrief } from "../services/postScenarios";
import {
  analyzeCaptionForDelivery,
  analyzeCaptionSetForDelivery,
  buildEmployeeDisclosure,
} from "../utils/complianceDisclosures";
import { buildShareCaptions, effectivePackFor } from "../services/deliveryCaptions";
import { derivePostLocks, type CaptionIdentityContext } from "../utils/postLocks";
import type { DealerIdentityGrounding } from "../services/posts";
import { useAppStore } from "../stores/appStore";
import { useApprovalStatus } from "../hooks/useApprovalStatus";
import { useReleaseRepair } from "../hooks/useReleaseRepair";
import { useDraftAutosave, DRAFT_CONFLICT_MESSAGE } from "../hooks/useDraftAutosave";
import { useWebsiteHandoff } from "../hooks/useWebsiteHandoff";
import { useVideoJobs } from "../hooks/useVideoJobs";
import { usePreparedDelivery } from "../hooks/usePreparedDelivery";
import { usePostShare } from "../hooks/usePostShare";
import { usePostCreativeTools } from "../hooks/usePostCreativeTools";
import { usePostLeaveGuard } from "../hooks/usePostLeaveGuard";
import { ChannelChips } from "./post/ChannelChips";
import { LockBanner, type LockBannerProps } from "./post/LockBanner";
import { PostPreviewCard } from "./post/PostPreviewCard";

export interface PostScreenProps {
  post: GeneratedPost;
  onStartOver: () => void;
  onRemix: () => void;
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
  onGenerateCaptionVariant?: () => Promise<{
    caption: string;
    disclosures: string;
    disclosureCategories: string[];
  }>;
  onShowSettings?: () => void;
  onShowHistory?: () => void;
  onRequestLogout?: () => void;
  error?: string | null;
  isDesktopLayout: boolean;
  requiresApproval?: boolean;
  bannedPhrases?: string;
  /** Rebuilds the generation brief for this Look before rendering it. */
  onChangeLook?: (look: StoreLook["id"]) => Promise<void>;
}

const CATEGORY_LABELS: Record<string, string> = {
  deliveries: "Delivery",
  inventory: "New arrival",
  service: "Service",
  promotions: "Promotion",
  community: "Community",
  team: "Team",
};

const buttonBase =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink/60 disabled:cursor-not-allowed";
const secondaryButton = `${buttonBase} border border-strong bg-panel text-ink hover:border-brand-ink hover:bg-brand-tint disabled:opacity-50`;
const primaryButton = `${buttonBase} bg-brand-fill text-brand-foreground shadow-[0_8px_24px_-12px_rgb(var(--brand-fill)/0.7)] hover:brightness-105 disabled:opacity-50`;

const isPlatformDestinationId = (value: string): value is PlatformDestinationId =>
  [
    "instagram_feed",
    "instagram_reel",
    "instagram_story",
    "facebook_feed",
    "tiktok",
    "gbp",
    "marketplace",
    "x_twitter",
    "linkedin",
    "native_share",
  ].includes(value);

export const PostScreen: React.FC<PostScreenProps> = (props) => {
  const {
    post,
    onStartOver,
    onRegenerateImage,
    onRegenerateText,
    onPrepareFinalWebsiteDraft,
    onFunMode,
    onGenerateVideo,
    error,
    isDesktopLayout,
    requiresApproval = false,
    bannedPhrases,
    onChangeLook,
    onShowHistory,
  } = props;
  const currentDealer = useAppStore((state) => state.currentDealer);
  const currentPerson = useAppStore((state) => state.currentPerson);
  const selectedImage = useAppStore((state) => state.selectedImage);
  const postDraft = useAppStore((state) => state.postDraft);
  const generationParams = useAppStore((state) => state.generationParams);
  const setPostWorkAtRisk = useAppStore((state) => state.setPostWorkAtRisk);
  const dealerId = currentDealer?.id || "";
  const salespersonName = currentPerson?.name || "Salesperson";
  const scenarioId =
    postDraft?.scenarioId ||
    generationParams?.scenarioId ||
    post.scenarioId ||
    "customer_delivery";
  const categoryId =
    postDraft?.categoryId ||
    brandCategoryForScenario(scenarioId, currentDealer?.custom_scenarios) ||
    "deliveries";
  const defaults = useMemo(
    () =>
      resolveStoreDefaults({
        dealer: currentDealer,
        person: currentPerson,
        categoryId,
        scenarioId,
        websiteReady: Boolean(post.websiteDraft?.enabled),
      }),
    [categoryId, currentDealer, currentPerson, post.websiteDraft?.enabled, scenarioId],
  );
  const resultIdentity =
    post.postId ||
    post.aiMeta?.image.attemptId ||
    post.aiMeta?.lastSuccessfulGenerationAt ||
    "local-result";
  const [caption, setCaption] = useState(post.text);
  const [editingCaption, setEditingCaption] = useState(false);
  const previousPostTextRef = useRef(post.text);

  useEffect(() => {
    if (previousPostTextRef.current === post.text) return;
    previousPostTextRef.current = post.text;
    setCaption(post.text);
  }, [post.text]);

  const deliveryLanguageAllowed = useMemo(
    () =>
      deliveryLanguageAllowedForBrief(
        generationParams?.creativeBrief ||
          scenarioToCreativeBrief(scenarioId, currentDealer?.custom_scenarios),
        post.customerIdentityRequired ?? true,
      ),
    [
      currentDealer?.custom_scenarios,
      generationParams?.creativeBrief,
      post.customerIdentityRequired,
      scenarioId,
    ],
  );
  const effectivePack = useMemo(
    () => effectivePackFor(post.platformCaptions, {}),
    [post.platformCaptions],
  );
  const captionAnalysis = useMemo(
    () =>
      analyzeCaptionForDelivery(
        caption,
        bannedPhrases,
        undefined,
        deliveryLanguageAllowed,
      ),
    [bannedPhrases, caption, deliveryLanguageAllowed],
  );
  const captionSetAnalysis = useMemo(
    () =>
      analyzeCaptionSetForDelivery(
        [caption, ...Object.values(effectivePack || {})],
        bannedPhrases,
      ),
    [bannedPhrases, caption, effectivePack],
  );

  const approval = useApprovalStatus({
    post,
    requiresApproval: requiresApproval || defaults.requiresApproval,
  });
  const release = useReleaseRepair({ post });
  const video = useVideoJobs({
    post,
    resultIdentity,
    dealerId,
    motion: defaults.motion,
    onGenerateVideo,
  });

  const website = useWebsiteHandoff({
    post,
    dealerId,
    dealer: currentDealer,
    imageBusy: video.isVideoLoading,
    textBusy: false,
    onPrepareFinalWebsiteDraft,
    captions: {
      activeCaptionPlatform: null,
      primaryCaption: caption,
      editedText: caption,
      bannedPhrases,
      deliveryLanguageAllowed,
      effectivePack,
      disclosures: captionSetAnalysis.disclosures,
    },
  });

  const identityContext = useMemo<CaptionIdentityContext>(
    () => ({
      customerDisplayName: post.customerDisplayName,
      dealerName: currentDealer?.name,
      oemAffiliation: currentDealer?.oem_affiliation,
      vehicleDescription:
        website.websiteDraft?.vehicleDescription ||
        generationParams?.websiteVehicleDescription,
      currentPersonName: salespersonName,
      customerIdentityRequired: post.customerIdentityRequired,
      isCustomerStory: website.websiteDraft?.kind === "customer_story",
    }),
    [
      currentDealer?.name,
      currentDealer?.oem_affiliation,
      generationParams?.websiteVehicleDescription,
      post.customerDisplayName,
      post.customerIdentityRequired,
      salespersonName,
      website.websiteDraft?.kind,
      website.websiteDraft?.vehicleDescription,
    ],
  );
  const locks = useMemo(
    () =>
      derivePostLocks({
        captions: [caption, ...Object.values(effectivePack || {})],
        identity: identityContext,
        prohibited: captionSetAnalysis.prohibited,
        imageReviewRequired: approval.imageReviewRequired,
        reviewRequired: approval.reviewRequired,
        approvalStatus: approval.approvalStatus,
        rejectionReason: approval.rejectionReason,
        releaseStatus: release.releaseStatus,
        releaseLinkStatus: release.releaseLinkStatus,
        releaseId: post.releaseId,
        postId: post.postId,
        customerDisplayName: post.customerDisplayName,
      }),
    [
      approval.approvalStatus,
      approval.imageReviewRequired,
      approval.rejectionReason,
      approval.reviewRequired,
      caption,
      captionSetAnalysis.prohibited,
      effectivePack,
      identityContext,
      post.customerDisplayName,
      post.postId,
      post.releaseId,
      release.releaseLinkStatus,
      release.releaseStatus,
    ],
  );
  const contentEditingLocked =
    approval.reviewRequired || website.handoffStarted || website.sending;
  const historyReadOnly = Boolean(post.historyReadOnly);
  const editable = !contentEditingLocked && !historyReadOnly;
  const draftGrounding = useMemo<DealerIdentityGrounding>(
    () => ({
      dealerName: currentDealer?.name,
      oemAffiliation: currentDealer?.oem_affiliation,
      vehicleDescription:
        website.websiteDraft?.vehicleDescription ||
        generationParams?.websiteVehicleDescription,
      salespersonName,
    }),
    [
      currentDealer?.name,
      currentDealer?.oem_affiliation,
      generationParams?.websiteVehicleDescription,
      salespersonName,
      website.websiteDraft?.vehicleDescription,
    ],
  );
  const autosave = useDraftAutosave({
    post,
    editable,
    primaryCaption: caption,
    captionAnalysis,
    captionSetAnalysis,
    effectivePack:
      caption !== post.text
        ? Object.fromEntries(
            Object.keys(effectivePack || {}).map((id) => [id, caption]),
          )
        : effectivePack,
    identityLocked: locks.identityLocked,
    grounding: draftGrounding,
  });
  const creative = usePostCreativeTools({
    post,
    defaults,
    locked: contentEditingLocked || historyReadOnly,
    lockReason: locks.deliveryLocked
      ? locks.primary.message
      : "This creative is locked and cannot be changed.",
    hasOriginalCapture: Boolean(selectedImage),
    onRegenerateImage,
    onRegenerateText,
    onChangeLook,
    onFunMode,
    video,
  });
  const preparedDelivery = usePreparedDelivery({
    post,
    resultIdentity,
    websiteEnabled: website.websiteDraft?.enabled,
    video,
  });

  const availableChannels = defaults.channels.filter((channel) =>
    isPlatformDestinationId(channel.id),
  );
  const initialChannelId =
    availableChannels.find((channel) => (post.platformIds || []).includes(channel.id))
      ?.id ||
    availableChannels[0]?.id ||
    "facebook_feed";
  const [selectedChannelId, setSelectedChannelId] = useState(initialChannelId);
  const selectedChannel = availableChannels.find(
    (channel) => channel.id === selectedChannelId,
  ) ||
    availableChannels[0] || { id: "facebook_feed", label: "Facebook" };

  useEffect(() => {
    preparedDelivery.selectDelivery(
      selectedChannelId,
      video.videoUrl ? "video" : "photo",
    );
    // selectDelivery is intentionally keyed by destination/media. The hook's
    // function identity follows its live plan and must not restart this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChannelId, video.videoUrl]);

  const shareCaptions = useMemo(
    () =>
      buildShareCaptions({
        effectivePack,
        activeCaptionPlatform: null,
        editedText: caption,
        dealer: currentDealer,
        bannedPhrases,
        deliveryLanguageAllowed,
        identity: identityContext,
        identityBlockedMessage: locks.identityMessage,
        bodyEditSupersedesPack: caption !== post.text,
      }),
    [
      bannedPhrases,
      caption,
      currentDealer,
      deliveryLanguageAllowed,
      effectivePack,
      identityContext,
      locks.identityMessage,
      post.text,
    ],
  );
  const selectedCaption = shareCaptions?.[selectedChannelId];
  const employeeDisclosure = useMemo(
    () => buildEmployeeDisclosure(currentDealer),
    [currentDealer],
  );
  const shareContent = useMemo(
    () => ({
      text: selectedCaption?.text || captionAnalysis.caption,
      disclosures:
        selectedCaption?.disclosures || captionSetAnalysis.disclosures || undefined,
      requiredPrefix: employeeDisclosure || undefined,
      imageDataUrl: post.image,
      videoUrl:
        preparedDelivery.selectedDelivery?.mediaKind === "video"
          ? video.videoUrl || undefined
          : undefined,
      preparedFile: preparedDelivery.activePreparedSave?.file,
    }),
    [
      captionAnalysis.caption,
      captionSetAnalysis.disclosures,
      employeeDisclosure,
      post.image,
      preparedDelivery.activePreparedSave?.file,
      preparedDelivery.selectedDelivery?.mediaKind,
      selectedCaption?.disclosures,
      selectedCaption?.text,
      video.videoUrl,
    ],
  );
  const autosaveBlockedReason =
    autosave.status === "conflict"
      ? DRAFT_CONFLICT_MESSAGE
      : autosave.status === "saving"
        ? "Saving the current caption and image before delivery."
        : autosave.status === "failed"
          ? "The current caption and image must be saved before delivery. Retry the draft save."
          : undefined;
  const expectedPostRevision =
    post.postRevision || autosave.lastRevisionRef.current || undefined;
  const share = usePostShare({
    post,
    channelId: selectedChannel.id as PlatformDestinationId,
    channelLabel: selectedChannel.label,
    content: shareContent,
    blockedReason:
      (locks.deliveryLocked ? locks.primary.message : undefined) ||
      autosaveBlockedReason ||
      selectedCaption?.blockedReason,
    expectedPostRevision,
    flushDraft: autosave.flush,
  });

  const leaveGuard = usePostLeaveGuard({
    hasSavedMedia:
      Boolean(post.postId || post.sharedTo?.length) &&
      autosave.status !== "saving" &&
      autosave.status !== "failed",
    hasCopiedCaption: Boolean(post.postId || post.sharedTo?.length || share.feedback),
    captionWasEdited: caption !== post.text,
    imageEditPromptDirty: false,
    videoJobCount: video.atRisk ? 1 : 0,
    imageBusy: creative.busy,
    textBusy: false,
    websiteSending: website.sending,
  });
  useEffect(() => {
    setPostWorkAtRisk(leaveGuard.atRisk);
  }, [leaveGuard.atRisk, setPostWorkAtRisk]);
  useEffect(
    () => () => {
      useAppStore.getState().setPostWorkAtRisk(false);
    },
    [],
  );

  const selectChannel = useCallback(
    (channel: { id: string }) => {
      if (!isPlatformDestinationId(channel.id)) return;
      setSelectedChannelId(channel.id);
      preparedDelivery.selectDelivery(channel.id, video.videoUrl ? "video" : "photo");
    },
    [preparedDelivery, video.videoUrl],
  );

  const sendWebsite = useCallback(
    () =>
      website.send({
        autosave: {
          flush: autosave.flush,
          stage: autosave.stage,
          lastRevisionRef: autosave.lastRevisionRef,
        },
        deliveryLocked: locks.deliveryLocked,
        deliveryGateMessage: locks.primary.message,
      }),
    [autosave.flush, autosave.lastRevisionRef, autosave.stage, locks, website],
  );

  const banner = useMemo<LockBannerProps | null>(() => {
    if (locks.deliveryLocked) {
      return {
        title: locks.primary.title,
        message: locks.primary.message,
        ...(locks.primary.kind === "release" && locks.releaseLinkRepairable
          ? {
              actionLabel: "Retry saving release",
              actionBusy: release.retrying,
              onAction: () => void release.retry("manual"),
            }
          : {}),
      };
    }
    if (post.isBasicFallback) {
      return {
        title: "Using a safe starter caption",
        message:
          "The AI caption was unavailable. You can keep this copy or try once more.",
        actionLabel: "Try AI again",
        onAction: () => void onRegenerateText(),
      };
    }
    if (post.postId && !expectedPostRevision) {
      return {
        title: "Refresh this saved post",
        message:
          "Open this post from My work to load its latest saved copy before editing or sharing.",
        ...(onShowHistory
          ? { actionLabel: "Open My work", onAction: onShowHistory }
          : {}),
      };
    }
    if (autosave.status === "failed") {
      return {
        title: "Draft not saved",
        message:
          "Your changes are still on this device. Retry when the connection is ready.",
        actionLabel: "Retry save",
        onAction: () => void autosave.retry(),
      };
    }
    if (share.feedback) {
      return {
        title: share.feedback.title,
        message: share.feedback.detail,
        tone: share.feedback.via === "share_sheet" ? "success" : "info",
      };
    }
    if (share.preparationError || preparedDelivery.mediaPreparationError || error) {
      return {
        title: "File needs attention",
        message:
          share.preparationError ||
          preparedDelivery.mediaPreparationError ||
          error ||
          "The file could not be prepared.",
        actionLabel: "Retry",
        onAction: preparedDelivery.retryPreparation,
      };
    }
    return null;
  }, [
    autosave,
    error,
    locks,
    onRegenerateText,
    onShowHistory,
    expectedPostRevision,
    post.postId,
    post.isBasicFallback,
    preparedDelivery.mediaPreparationError,
    preparedDelivery.retryPreparation,
    release,
    share.feedback,
    share.preparationError,
  ]);

  const sharedSelectedChannel = post.sharedTo?.some(
    (event) => event.channel === selectedChannelId && event.via === "share_sheet",
  );
  const sharedChannelIds = useMemo(
    () =>
      new Set(
        (post.sharedTo || [])
          .filter((event) => event.via === "share_sheet")
          .map((event) => event.channel),
      ),
    [post.sharedTo],
  );
  const showDone =
    share.feedback?.via === "share_sheet" || Boolean(sharedSelectedChannel);
  const hideCreativeTools =
    approval.reviewRequired || website.handoffStarted || historyReadOnly;
  const shareDisabledReason = locks.deliveryLocked
    ? locks.primary.message
    : autosaveBlockedReason
      ? autosaveBlockedReason
      : share.preparationStatus === "preparing"
        ? "Preparing the exact file and caption"
        : share.preparationError || "The exact file is not ready";

  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto bg-canvas px-4 pb-[calc(96px+env(safe-area-inset-bottom))] pt-4 text-ink sm:px-6 lg:px-10 lg:py-8"
      style={{
        backgroundImage:
          "radial-gradient(ellipse at 10% 0%, rgb(var(--brand-ink) / 0.07), transparent 55%)",
      }}
    >
      <div className="mx-auto grid w-full max-w-[1160px] gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start lg:gap-8">
        <section
          className="mx-auto w-full max-w-[640px] lg:mx-0"
          aria-label="Post preview"
        >
          <div className="mb-3 flex items-center justify-between gap-3 px-1 text-xs">
            <span className="flex items-center gap-2 font-semibold uppercase tracking-[0.12em] text-ink-2">
              <span
                className="h-1.5 w-1.5 rounded-full bg-brand-fill"
                aria-hidden="true"
              />
              Your creative
            </span>
            <span className="rounded-full border border-hairline bg-panel px-2.5 py-1 font-medium text-ink-2">
              {CATEGORY_LABELS[categoryId] || "Post"}
            </span>
          </div>
          <PostPreviewCard
            salespersonName={salespersonName}
            dealerName={currentDealer?.name || "Your dealership"}
            image={post.image}
            videoUrl={video.videoUrl}
            caption={caption}
            employeeDisclosure={employeeDisclosure}
            complianceDisclosure={captionSetAnalysis.disclosures}
            editing={editingCaption}
            canEdit={editable}
            isDesktopLayout={isDesktopLayout}
            busyLabel={creative.busyLabel}
            onEdit={() => setEditingCaption(true)}
            onCaptionChange={setCaption}
            onCaptionBlur={() => setEditingCaption(false)}
          />
        </section>

        <section
          className="flex min-w-0 flex-col gap-5 rounded-2xl border border-hairline bg-panel p-4 shadow-[0_16px_48px_-32px_rgb(var(--ink)/0.3)] sm:p-6 lg:mt-10 lg:p-7"
          aria-label="Post actions"
        >
          <header className="hidden lg:block">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-ink">
              Your next great post
            </p>
            <h1 className="font-display text-[36px] font-semibold leading-10 tracking-[-0.02em]">
              Ready to post
            </h1>
            <p className="mt-2 max-w-sm text-sm leading-6 text-ink-2">
              Choose where it goes. Save your creative and copy the caption to finish in
              the app.
            </p>
          </header>
          <p className="text-sm font-semibold text-ink-2 lg:hidden">
            {CATEGORY_LABELS[categoryId] || "Post"}
          </p>

          {banner ? <LockBanner {...banner} /> : null}

          {!preparedDelivery.websiteOnly && availableChannels.length > 0 ? (
            <ChannelChips
              channels={availableChannels}
              selectedId={selectedChannelId}
              sharedIds={sharedChannelIds}
              disabled={creative.busy}
              onSelect={selectChannel}
            />
          ) : null}

          {!hideCreativeTools && defaults.looks.length > 1 ? (
            <div
              className="border-t border-hairline pt-5"
              role="group"
              aria-label="Look"
            >
              <label
                htmlFor="post-look"
                className="mb-2.5 block text-[13px] font-semibold text-ink-2"
              >
                Creative style
              </label>
              <div className="relative">
                <select
                  id="post-look"
                  value={creative.selectedLookId}
                  disabled={creative.busy}
                  onChange={(event) => {
                    const look = defaults.looks.find(
                      (option) => option.id === event.target.value,
                    );
                    if (look) void creative.changeLook(look);
                  }}
                  className="min-h-12 w-full appearance-none rounded-xl border border-hairline bg-panel-raised py-3 pl-4 pr-11 text-sm font-medium text-ink outline-none transition focus:border-brand-ink focus:ring-2 focus:ring-brand-ink/20 disabled:opacity-50"
                >
                  {defaults.looks.map((look) => (
                    <option key={look.id} value={look.id}>
                      {look.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3"
                  aria-hidden="true"
                />
              </div>
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-3 text-xs text-ink-3">
            <span>
              {autosave.status === "saving"
                ? "Saving draft…"
                : autosave.status === "saved"
                  ? "Draft saved"
                  : autosave.status === "conflict"
                    ? "Changed on another device"
                    : autosave.status === "failed"
                      ? "Draft save failed"
                      : post.postId
                        ? "Saved to My work"
                        : "Not saved yet"}
            </span>
            {approval.approvalCheckError || website.checkError || release.notice ? (
              <span className="text-right">
                {approval.approvalCheckError || website.checkError || release.notice}
              </span>
            ) : null}
          </div>

          {!hideCreativeTools && selectedImage ? (
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                className={secondaryButton}
                disabled={creative.busy || creative.tryAnotherUsed}
                aria-label={
                  creative.tryAnotherUsed
                    ? "Try another unavailable. Already used once on this post."
                    : "Try another"
                }
                onClick={() => void creative.tryAnother()}
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Try another
              </button>
              {defaults.videoAllowed ? (
                <button
                  type="button"
                  className={secondaryButton}
                  disabled={creative.busy}
                  onClick={() => void creative.addVideo()}
                >
                  <Film className="h-4 w-4" aria-hidden="true" />
                  Add video
                </button>
              ) : null}
              {defaults.playfulStyleId ? (
                <button
                  type="button"
                  className={secondaryButton}
                  disabled={creative.busy}
                  onClick={() => void creative.togglePlayful()}
                >
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                  Playful
                </button>
              ) : null}
            </div>
          ) : null}

          {preparedDelivery.websiteOnly ? (
            <div className="fixed bottom-[max(12px,env(safe-area-inset-bottom))] left-4 right-4 z-20 mt-auto flex flex-col gap-2.5 bg-canvas py-2 shadow-[0_-12px_24px_-18px_rgba(15,23,42,.45)] sm:left-6 sm:right-6 lg:static lg:bg-transparent lg:py-0 lg:shadow-none">
              {website.reviewUrl ? (
                <a
                  href={website.reviewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={primaryButton}
                >
                  Review website draft
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                </a>
              ) : website.publication?.status === "failed" ? (
                <button
                  type="button"
                  className={primaryButton}
                  disabled={website.retrying || locks.deliveryLocked}
                  onClick={() => void website.retry()}
                >
                  {website.retrying ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : null}
                  Retry website draft
                </button>
              ) : (
                <button
                  type="button"
                  className={primaryButton}
                  disabled={website.sending || locks.deliveryLocked}
                  aria-label={
                    locks.deliveryLocked
                      ? `Send website draft unavailable. ${locks.primary.message}`
                      : "Send website draft"
                  }
                  onClick={() => void sendWebsite()}
                >
                  {website.sending ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : null}
                  Send website draft
                </button>
              )}
            </div>
          ) : isDesktopLayout ? (
            <div className="mt-1 flex flex-col gap-2.5 border-t border-hairline pt-5">
              <button
                type="button"
                className={primaryButton}
                disabled={share.shareDisabled}
                aria-label={
                  share.shareDisabled
                    ? `Download for ${selectedChannel.label} unavailable. ${shareDisabledReason}`
                    : `Download for ${selectedChannel.label}`
                }
                onClick={share.download}
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Download for {selectedChannel.label}
              </button>
              <button
                type="button"
                className={secondaryButton}
                disabled={share.shareDisabled}
                aria-label={
                  share.shareDisabled
                    ? `Copy caption unavailable. ${shareDisabledReason}`
                    : "Copy caption"
                }
                onClick={() => void share.copyCaption()}
              >
                <Copy className="h-4 w-4" aria-hidden="true" />
                Copy caption
              </button>
            </div>
          ) : showDone ? (
            <button
              type="button"
              className={`${primaryButton} fixed bottom-[max(12px,env(safe-area-inset-bottom))] left-4 right-4 z-20 mt-auto min-h-14 shadow-lg sm:left-6 sm:right-6 lg:static lg:shadow-none`}
              onClick={onStartOver}
            >
              <Check className="h-5 w-5" aria-hidden="true" />
              Done
            </button>
          ) : share.preparationStatus !== "ready" ? (
            <button
              type="button"
              className={`${primaryButton} fixed bottom-[max(12px,env(safe-area-inset-bottom))] left-4 right-4 z-20 mt-auto min-h-14 shadow-lg sm:left-6 sm:right-6 lg:static lg:shadow-none`}
              disabled
              aria-label={`Share to ${selectedChannel.label} unavailable. ${shareDisabledReason}`}
            >
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              Preparing exact file…
            </button>
          ) : share.nativeFileShareAvailable ? (
            <button
              type="button"
              className={`${primaryButton} fixed bottom-[max(12px,env(safe-area-inset-bottom))] left-4 right-4 z-20 mt-auto min-h-14 text-base shadow-lg sm:left-6 sm:right-6 lg:static lg:shadow-none`}
              disabled={share.shareDisabled}
              aria-label={
                share.shareDisabled
                  ? `Share to ${selectedChannel.label} unavailable. ${shareDisabledReason}`
                  : `Share to ${selectedChannel.label}`
              }
              onClick={() => void share.share()}
            >
              <Share2 className="h-5 w-5" aria-hidden="true" />
              Share to {selectedChannel.label}
            </button>
          ) : (
            <div className="fixed bottom-[max(12px,env(safe-area-inset-bottom))] left-4 right-4 z-20 mt-auto grid grid-cols-2 gap-2.5 bg-canvas py-2 shadow-[0_-12px_24px_-18px_rgba(15,23,42,.45)] sm:left-6 sm:right-6 lg:static lg:bg-transparent lg:py-0 lg:shadow-none">
              <button
                type="button"
                className={secondaryButton}
                onClick={share.download}
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Save file
              </button>
              <button
                type="button"
                className={secondaryButton}
                onClick={() => void share.copyCaption()}
              >
                <Copy className="h-4 w-4" aria-hidden="true" />
                Copy caption
              </button>
              <button
                type="button"
                className={`${primaryButton} col-span-2`}
                onClick={share.openTarget}
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                Open {selectedChannel.label}
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export type PostScreenLookId = SignatureLook | StyleOption;
