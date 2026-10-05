import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  Film,
  Loader2,
  Lock,
  RefreshCw,
  Share2,
  Smile,
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
import {
  derivePostLocks,
  type CaptionIdentityContext,
  type PostLocks,
} from "../utils/postLocks";
import {
  websitePrivacyNote,
  websiteStatusCopy,
  type WebsiteStatusTone,
} from "../utils/websiteStatusCopy";
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
import { Button } from "./ui/Button";
import { ChannelChips, chipClass } from "./post/ChannelChips";
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

/** Links that act as buttons, matched to components/ui/Button (it exports no class helper). */
const primaryLinkClass =
  "inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-sm bg-brand-fill px-4 text-base font-semibold text-brand-foreground transition-opacity duration-120 hover:opacity-90";
const secondaryLinkClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-sm border border-strong bg-panel-raised px-5 text-base font-semibold text-ink transition-opacity duration-120 hover:opacity-90";

/** The one phone bottom bar; at lg and up it sits in the actions column. */
const phoneBarClass =
  "max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-20 max-lg:border-t max-lg:border-hairline max-lg:bg-panel max-lg:px-4 max-lg:pt-3 max-lg:pb-[max(12px,var(--sab))]";

/** A secondary Done beside a primary in the phone bar. */
const barPair = "grid grid-cols-[auto_minmax(0,1fr)] gap-2";

const WEBSITE_TONE_INK: Record<WebsiteStatusTone, string> = {
  neutral: "text-ink",
  info: "text-info-ink",
  warning: "text-warning-ink",
  success: "text-success-ink",
  error: "text-error-ink",
};

/** The short reason a locked post cannot be shared, shown on the disabled primary. */
const lockedShareLabel = (
  locks: PostLocks,
  approvalStatus: GeneratedPost["approvalStatus"],
): string => {
  switch (locks.primary.kind) {
    case "approval":
      // A sent-back or unsent post is not waiting on anyone.
      return approvalStatus === "rejected" || approvalStatus === "submission_failed"
        ? "Start a new post to share"
        : "Waiting for approval";
    case "identity":
    case "claim":
      return "Fix the caption to share";
    case "release":
      // The repairable case has a stored signature; never call it unsaved.
      return locks.releaseLinkRepairable
        ? "Photo release not attached"
        : "Photo release not saved";
    case "image_review":
      return "Start a new post to share";
  }
};

type DeliveryState =
  "locked" | "conflict" | "blocked" | "failed" | "preparing" | "shared" | "ready";

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
      : "This post is locked and can't be changed.",
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
        // One caption on screen, so every channel ships from it (spec §3.4):
        // a per-channel AI variant the salesperson never saw is never sent.
        bodyEditSupersedesPack: true,
      }),
    [
      bannedPhrases,
      caption,
      currentDealer,
      deliveryLanguageAllowed,
      effectivePack,
      identityContext,
      locks.identityMessage,
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
        ? "Saving your changes…"
        : autosave.status === "failed"
          ? "Your changes didn't save. Tap Retry save."
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
    // A conflicted draft is as unsaved as a failed one: the edit is only here.
    hasSavedMedia:
      Boolean(post.postId || post.sharedTo?.length) &&
      autosave.status !== "saving" &&
      autosave.status !== "failed" &&
      autosave.status !== "conflict",
    hasCopiedCaption: Boolean(post.postId || post.sharedTo?.length || share.feedback),
    captionWasEdited: caption !== post.text,
    imageEditPromptDirty: false,
    videoJobCount: video.atRisk ? 1 : 0,
    // Image renders and the website send block leaving; a running video is
    // only a confirm (video.atRisk above), so it is not counted as busy here.
    imageBusy: creative.busy && !video.isVideoLoading,
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

  // A share, copy or download is newer than a failed image update; once one
  // lands, its guidance replaces the stale "not updated" message.
  const lastFeedbackRef = useRef(share.feedback);
  useEffect(() => {
    if (share.feedback && share.feedback !== lastFeedbackRef.current) {
      const store = useAppStore.getState();
      if (store.error) store.setError(null);
    }
    lastFeedbackRef.current = share.feedback;
  }, [share.feedback]);

  const shareFailure = share.preparationError || preparedDelivery.mediaPreparationError;
  const retryShare = useCallback(() => {
    if (share.preparationError && share.prepared) {
      void share.share();
      return;
    }
    preparedDelivery.retryPreparation();
  }, [preparedDelivery, share]);

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
  // "Shared" (and the primary Done) follows a completed share-sheet share only.
  const sharedViaSheet =
    share.feedback?.via === "share_sheet" || Boolean(sharedSelectedChannel);
  const hideCreativeTools =
    approval.reviewRequired || website.handoffStarted || historyReadOnly;
  const canChangeLook =
    !hideCreativeTools && Boolean(selectedImage) && defaults.looks.length > 1;
  const isSaved = Boolean(post.postId);
  const approvalPending =
    approval.reviewRequired && approval.approvalStatus === "pending";
  const mediaNoun =
    preparedDelivery.selectedDelivery?.mediaKind === "video" ? "video" : "image";

  const missingRevisionReason =
    post.postId && !expectedPostRevision
      ? "Reopen this post from My work to keep going."
      : undefined;
  const contentBlockedReason =
    missingRevisionReason ||
    selectedCaption?.blockedReason ||
    (shareContent.text.trim() ? undefined : "Write a caption to share this post.");
  const blockedReason =
    (autosave.status === "saving" || autosave.status === "failed"
      ? autosaveBlockedReason
      : undefined) || contentBlockedReason;
  // An autosave pass is short and runs after every edit. Putting its reason in
  // the phone bar would grow the bar (and the page padding) on each pass, so
  // the bar keeps only a lasting reason; the status line says "Saving draft…"
  // and the disabled Share still names the save in its accessible name.
  const barBlockedHelper =
    autosave.status === "saving" ? contentBlockedReason : blockedReason;
  const delivery: DeliveryState = locks.deliveryLocked
    ? "locked"
    : autosave.status === "conflict"
      ? "conflict"
      : blockedReason
        ? "blocked"
        : shareFailure || share.preparationStatus === "failed"
          ? "failed"
          : share.preparationStatus !== "ready"
            ? "preparing"
            : sharedViaSheet
              ? "shared"
              : "ready";
  // On phones the bottom bar already carries Try again and Open My work, so the
  // banner explains and leaves the button to the bar. Desktop has no bar for
  // those, so its banner keeps them.
  const barCarriesRecovery = !isDesktopLayout && !preparedDelivery.websiteOnly;
  const banner = ((): LockBannerProps | null => {
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
    if (autosave.status === "conflict") {
      return {
        title: "This post changed somewhere else",
        message: DRAFT_CONFLICT_MESSAGE,
        ...(onShowHistory && !barCarriesRecovery
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
    if (shareFailure) {
      return {
        title:
          typeof navigator !== "undefined" && navigator.onLine === false
            ? "You're offline"
            : "Couldn't share yet",
        message: shareFailure,
        ...(barCarriesRecovery && delivery === "failed"
          ? {}
          : { actionLabel: "Try again", onAction: retryShare }),
      };
    }
    if (error) {
      // A failed Try another, Look or Playful render. It has nothing to do
      // with the share file, so it does not offer to re-prepare one.
      return {
        title: "Post not updated",
        message: error,
        actionLabel: "Dismiss",
        onAction: () => useAppStore.getState().setError(null),
      };
    }
    if (share.feedback) {
      return {
        title: share.feedback.title,
        message: share.feedback.detail,
        tone:
          share.feedback.via === "share_sheet"
            ? "success"
            : share.feedback.fallback
              ? "warning"
              : "info",
      };
    }
    // The starter-caption offer is the least urgent message. A lock, a repair
    // to make, a failure or the latest share guidance all outrank it, so the
    // button the bar points to (Retry save, Open My work, Try again) is shown.
    if (post.isBasicFallback) {
      return {
        title: "Using a safe starter caption",
        message:
          "The AI caption was unavailable. You can keep this copy or try once more.",
        actionLabel: "Try AI again",
        onAction: () => void onRegenerateText(),
      };
    }
    return null;
  })();
  const lockedLabel = lockedShareLabel(locks, approval.approvalStatus);
  const shareDisabledReason =
    delivery === "locked"
      ? locks.primary.message
      : delivery === "conflict"
        ? DRAFT_CONFLICT_MESSAGE
        : delivery === "blocked"
          ? (blockedReason as string)
          : delivery === "failed"
            ? shareFailure || "Not ready yet"
            : delivery === "preparing"
              ? "Getting it ready"
              : "Not ready yet";
  // `fallbackActive` stays true through the Save / Copy feedback that follows
  // a failed share sheet, so using one control never brings the failed Share
  // button back. The banner tone still keys off `feedback.fallback`.
  const useFallbackControls = !share.nativeFileShareAvailable || share.fallbackActive;

  const saveStatus =
    autosave.status === "saving"
      ? "Saving draft…"
      : autosave.status === "saved"
        ? "Draft saved"
        : autosave.status === "conflict"
          ? "Changed on another device"
          : autosave.status === "failed"
            ? "Draft save failed"
            : isSaved
              ? approvalPending
                ? "Saved to My work · waiting for approval"
                : "Saved to My work"
              : "Not saved yet";
  const statusNote = approval.approvalCheckError || release.notice;

  const publication = website.publication;
  const websiteEnabled = Boolean(website.websiteDraft?.enabled);
  const websiteStatus = websiteStatusCopy(publication, isSaved);
  const websitePrivacy = websitePrivacyNote(website.websiteDraft?.privacyFlags);
  const websiteNeedsRetry =
    publication?.status === "failed" ||
    (publication?.status === "draft_ready" && Boolean(publication.lastError));
  const websiteRetryLabel =
    publication?.status === "draft_ready" ? "Check status again" : "Retry";
  const websiteCanSend = !publication || publication.status === "not_requested";
  const websiteSendDisabled = website.sending || locks.deliveryLocked || creative.busy;
  const websiteSendLabel = locks.deliveryLocked
    ? `Send website draft unavailable. ${locks.primary.message}`
    : "Send website draft";

  const doneSecondary = (className?: string) =>
    isSaved ? (
      <Button
        variant="secondary"
        size="lg"
        className={className ?? "px-4"}
        onClick={onStartOver}
      >
        Done
      </Button>
    ) : null;

  /** The website-only post's single action, phone bar or desktop column. */
  const websiteOnlyAction = website.reviewUrl ? (
    <a
      href={website.reviewUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={primaryLinkClass}
    >
      Review website draft
      <ExternalLink className="h-5 w-5" aria-hidden="true" />
    </a>
  ) : websiteNeedsRetry && isSaved ? (
    <Button
      variant="primary"
      size="lg"
      fullWidth
      className="px-4"
      loading={website.retrying}
      disabled={locks.deliveryLocked}
      onClick={() => void website.retry()}
    >
      {publication?.status === "draft_ready"
        ? "Check status again"
        : "Retry website draft"}
    </Button>
  ) : websiteCanSend ? (
    <Button
      variant="primary"
      size="lg"
      fullWidth
      className="px-4"
      loading={website.sending}
      disabled={websiteSendDisabled}
      aria-label={websiteSendLabel}
      onClick={() => void sendWebsite()}
    >
      Send website draft
    </Button>
  ) : null;

  const websiteBlock = websiteEnabled ? (
    <div className="flex flex-col gap-2" role="group" aria-labelledby="post-website">
      <span id="post-website" className="text-sm font-medium text-ink-2">
        Dealership website
      </span>
      <div role="status" aria-live="polite">
        <p className={`text-sm font-semibold ${WEBSITE_TONE_INK[websiteStatus.tone]}`}>
          {websiteStatus.title}
        </p>
        <p className="mt-0.5 text-caption text-ink-2">{websiteStatus.detail}</p>
      </div>
      {websitePrivacy ? (
        <p className="text-caption text-ink-2">{websitePrivacy}</p>
      ) : null}
      {website.checkError ? (
        <p className="text-caption text-warning-ink">{website.checkError}</p>
      ) : null}
      {!preparedDelivery.websiteOnly ? (
        website.reviewUrl ? (
          <a
            href={website.reviewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`${secondaryLinkClass} mt-1 self-start`}
          >
            Review website draft
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
        ) : websiteNeedsRetry && isSaved ? (
          <Button
            variant="secondary"
            size="md"
            className="mt-1 self-start"
            loading={website.retrying}
            disabled={locks.deliveryLocked}
            leftIcon={<RefreshCw />}
            onClick={() => void website.retry()}
          >
            {websiteRetryLabel}
          </Button>
        ) : websiteCanSend && isSaved ? (
          <Button
            variant="secondary"
            size="md"
            className="mt-1 self-start"
            loading={website.sending}
            disabled={websiteSendDisabled}
            aria-label={websiteSendLabel}
            onClick={() => void sendWebsite()}
          >
            Send website draft
          </Button>
        ) : null
      ) : null}
    </div>
  ) : null;

  const lookChoice = canChangeLook ? (
    defaults.looks.length <= 4 ? (
      <div className="flex flex-col gap-2">
        <span id="post-look-label" className="text-sm font-medium text-ink-2">
          Look
        </span>
        <div
          className="flex min-w-0 flex-wrap gap-2"
          role="radiogroup"
          aria-labelledby="post-look-label"
        >
          {defaults.looks.map((look) => {
            const checked = look.id === creative.selectedLookId;
            return (
              <button
                key={look.id}
                type="button"
                role="radio"
                aria-checked={checked}
                disabled={creative.busy}
                onClick={() => {
                  if (!checked) void creative.changeLook(look);
                }}
                className={chipClass(checked)}
              >
                {look.label}
              </button>
            );
          })}
        </div>
      </div>
    ) : (
      <div className="flex flex-col gap-2" role="group" aria-label="Look">
        <label htmlFor="post-look" className="text-sm font-medium text-ink-2">
          Look
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
            className="min-h-11 w-full appearance-none rounded-sm border border-strong bg-panel-raised py-2.5 pl-3.5 pr-11 text-base text-ink transition-colors duration-120 focus:border-brand-ink disabled:opacity-50"
          >
            {defaults.looks.map((look) => (
              <option key={look.id} value={look.id}>
                {look.label}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-2"
            aria-hidden="true"
          />
        </div>
      </div>
    )
  ) : null;

  const creativeTools =
    !hideCreativeTools && selectedImage ? (
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            size="md"
            leftIcon={<RefreshCw />}
            disabled={creative.busy || creative.tryAnotherUsed}
            aria-label={
              creative.tryAnotherUsed
                ? "Try another unavailable. Already used once on this post."
                : "Try another"
            }
            onClick={() => void creative.tryAnother()}
          >
            Try another
          </Button>
          {defaults.videoAllowed ? (
            <Button
              variant="secondary"
              size="md"
              leftIcon={<Film />}
              disabled={creative.busy}
              onClick={() => void creative.addVideo()}
            >
              Add video
            </Button>
          ) : null}
          {defaults.playfulStyleId ? (
            <Button
              variant="secondary"
              size="md"
              leftIcon={<Smile />}
              disabled={creative.busy}
              onClick={() => void creative.togglePlayful()}
            >
              Playful
            </Button>
          ) : null}
        </div>
        {creative.tryAnotherUsed ? (
          <p className="text-caption text-ink-2">
            Try another is available once per post.
          </p>
        ) : null}
      </div>
    ) : null;

  const statusLine = (
    <div className="flex items-start justify-between gap-3 text-caption text-ink-2">
      <span>{saveStatus}</span>
      {statusNote ? <span className="text-right">{statusNote}</span> : null}
    </div>
  );

  const shareUnavailableLabel = `Share to ${selectedChannel.label} unavailable. ${shareDisabledReason}`;

  const phoneBarContent = (() => {
    switch (delivery) {
      case "locked":
        return (
          <div className={isSaved ? barPair : undefined}>
            {doneSecondary()}
            <Button
              variant="primary"
              size="lg"
              fullWidth
              className="px-4"
              disabled
              leftIcon={<Lock />}
              aria-label={`Share to ${selectedChannel.label} unavailable. ${lockedLabel}.`}
            >
              {lockedLabel}
            </Button>
          </div>
        );
      case "conflict":
        // Done stays available on a saved post; leaving still asks first,
        // because the conflicted edit exists only on this device.
        return onShowHistory ? (
          <div className={isSaved ? barPair : undefined}>
            {doneSecondary()}
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              className="px-4"
              onClick={onShowHistory}
            >
              Open My work
            </Button>
          </div>
        ) : (
          doneSecondary("w-full")
        );
      case "blocked":
        return (
          <>
            {barBlockedHelper ? (
              <p className="text-caption text-ink-2">{barBlockedHelper}</p>
            ) : null}
            <div className={isSaved ? barPair : undefined}>
              {doneSecondary()}
              <Button
                variant="primary"
                size="lg"
                fullWidth
                className="px-4"
                disabled
                leftIcon={<Share2 />}
                aria-label={shareUnavailableLabel}
              >
                Share to {selectedChannel.label}
              </Button>
            </div>
          </>
        );
      case "failed":
        return (
          <div className={isSaved ? barPair : undefined}>
            {doneSecondary()}
            <Button
              variant="primary"
              size="lg"
              fullWidth
              className="px-4"
              leftIcon={<RefreshCw />}
              onClick={retryShare}
            >
              Try again
            </Button>
          </div>
        );
      case "preparing":
        return (
          <div className={isSaved ? barPair : undefined}>
            {doneSecondary()}
            <Button
              variant="primary"
              size="lg"
              fullWidth
              className="px-4"
              loading
              aria-label={shareUnavailableLabel}
            >
              Getting it ready…
            </Button>
          </div>
        );
      case "shared":
        return (
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              size="lg"
              className="px-4"
              disabled={share.shareDisabled}
              onClick={() => void share.copyCaption()}
            >
              Copy caption
            </Button>
            <Button
              variant="primary"
              size="lg"
              className="px-4"
              leftIcon={<Check />}
              onClick={onStartOver}
            >
              Done
            </Button>
          </div>
        );
      case "ready":
        return useFallbackControls ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                size="md"
                className="px-3"
                disabled={share.shareDisabled}
                onClick={share.download}
              >
                Save {mediaNoun}
              </Button>
              <Button
                variant="secondary"
                size="md"
                className="px-3"
                disabled={share.shareDisabled}
                onClick={() => void share.copyCaption()}
              >
                Copy caption
              </Button>
            </div>
            <div className={isSaved ? barPair : undefined}>
              {doneSecondary()}
              <Button
                variant="primary"
                size="lg"
                fullWidth
                className="px-4"
                disabled={share.shareDisabled}
                rightIcon={<ExternalLink />}
                onClick={share.openTarget}
              >
                Open {selectedChannel.label}
              </Button>
            </div>
          </>
        ) : (
          <div className={isSaved ? barPair : undefined}>
            {doneSecondary()}
            <Button
              variant="primary"
              size="lg"
              fullWidth
              className="px-4"
              disabled={share.shareDisabled}
              leftIcon={<Share2 />}
              aria-label={`Share to ${selectedChannel.label}`}
              onClick={() => void share.share()}
            >
              Share to {selectedChannel.label}
            </Button>
          </div>
        );
    }
  })();
  const tallPhoneBar =
    !isDesktopLayout &&
    !preparedDelivery.websiteOnly &&
    ((delivery === "blocked" && Boolean(barBlockedHelper)) ||
      (delivery === "ready" && useFallbackControls));

  const desktopHelper =
    delivery === "blocked" ? (
      <p className="text-caption text-ink-2">{blockedReason}</p>
    ) : delivery === "preparing" ? (
      <p className="flex items-center gap-2 text-caption text-ink-2">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Getting it ready…
      </p>
    ) : null;

  const deliveryActions = preparedDelivery.websiteOnly ? (
    isDesktopLayout ? (
      <div className="flex flex-col gap-2">
        {websiteOnlyAction}
        {isSaved ? (
          <Button variant="ghost" size="md" fullWidth onClick={onStartOver}>
            Done
          </Button>
        ) : null}
      </div>
    ) : websiteOnlyAction || isSaved ? (
      <div className={phoneBarClass}>
        <div className="mx-auto flex w-full max-w-[640px] flex-col gap-2">
          {websiteOnlyAction ? (
            <div className={isSaved ? barPair : undefined}>
              {doneSecondary()}
              {websiteOnlyAction}
            </div>
          ) : (
            <Button
              variant="primary"
              size="lg"
              fullWidth
              leftIcon={<Check />}
              onClick={onStartOver}
            >
              Done
            </Button>
          )}
        </div>
      </div>
    ) : null
  ) : isDesktopLayout ? (
    <div className="flex flex-col gap-2">
      <Button
        variant="primary"
        size="lg"
        fullWidth
        leftIcon={<Download />}
        disabled={share.shareDisabled}
        aria-label={
          share.shareDisabled
            ? `Download for ${selectedChannel.label} unavailable. ${shareDisabledReason}`
            : `Download for ${selectedChannel.label}`
        }
        onClick={share.download}
      >
        Download for {selectedChannel.label}
      </Button>
      <Button
        variant="secondary"
        size="md"
        fullWidth
        leftIcon={<Copy />}
        disabled={share.shareDisabled}
        aria-label={
          share.shareDisabled
            ? `Copy caption unavailable. ${shareDisabledReason}`
            : "Copy caption"
        }
        onClick={() => void share.copyCaption()}
      >
        Copy caption
      </Button>
      {isSaved ? (
        <Button variant="ghost" size="md" fullWidth onClick={onStartOver}>
          Done
        </Button>
      ) : null}
      {desktopHelper}
    </div>
  ) : (
    <div className={phoneBarClass}>
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-2">
        {phoneBarContent}
      </div>
    </div>
  );

  return (
    <div
      className={`min-h-0 flex-1 overflow-y-auto bg-canvas px-4 pt-4 text-ink sm:px-6 lg:px-10 lg:py-8 ${
        tallPhoneBar
          ? "pb-[calc(160px+env(safe-area-inset-bottom))]"
          : "pb-[calc(96px+env(safe-area-inset-bottom))]"
      }`}
    >
      <h1 className="sr-only lg:hidden">Your post</h1>
      <div className="mx-auto grid w-full max-w-[1160px] gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start lg:gap-10">
        <section
          className="mx-auto w-full max-w-[640px] lg:mx-0"
          aria-label="Post preview"
        >
          <PostPreviewCard
            salespersonName={salespersonName}
            dealerName={currentDealer?.name || "Your dealership"}
            image={post.image}
            videoUrl={video.videoUrl}
            caption={caption}
            outboundText={shareContent.text}
            employeeDisclosure={employeeDisclosure}
            disclosures={shareContent.disclosures}
            editing={editingCaption}
            canEdit={editable}
            busyLabel={creative.busyLabel}
            onEdit={() => setEditingCaption(true)}
            onCaptionChange={setCaption}
            onCaptionBlur={() => setEditingCaption(false)}
          />
        </section>

        <section
          className="mx-auto flex w-full min-w-0 max-w-[640px] flex-col gap-6 lg:mx-0 lg:max-w-none"
          aria-label="Post actions"
        >
          <header className="hidden lg:block">
            <h1 className="font-display text-4xl font-semibold text-ink">
              Ready to share
            </h1>
            <p className="mt-2 max-w-sm text-sm leading-6 text-ink-2">
              {isDesktopLayout
                ? `Pick where it's going, download the ${mediaNoun} and copy the caption, then post it in ${selectedChannel.label}.`
                : `Pick where it's going, then share it to ${selectedChannel.label}.`}
            </p>
          </header>

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

          {lookChoice}
          {websiteBlock}
          {creativeTools}
          {statusLine}
          {deliveryActions}
        </section>
      </div>
    </div>
  );
};

export type PostScreenLookId = SignatureLook | StyleOption;
