import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  Suspense,
} from "react";
import { createPortal } from "react-dom";
import { m, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  RefreshCw,
  Edit3,
  Sparkles,
  Download,
  Film,
  Share2,
  Copy,
  Check,
  AlertCircle,
  Loader2,
  Undo2,
  Redo2,
  ChevronDown,
  CircleCheck,
  Camera,
  Calendar,
  Globe2,
  ExternalLink,
  type LucideIcon,
} from "lucide-react";
import confetti from "canvas-confetti";
import { Tooltip } from "./ui/Tooltip";
import { GeneratedPost, VideoStyle, VideoRequestOptions } from "../types";
import { triggerHapticFeedback } from "../utils/haptics";
import { toUiMessage } from "../utils/errorMessages";
import { Badge } from "./ui/Badge";
import { cn } from "../utils/classNames";
import { ProgressBar } from "./ui/ProgressBar";
import { normalizeError, recoveryHint } from "../utils/errorHandler";
import { MultiFormatExportModal } from "./MultiFormatExportModal";
import { ScheduleDialog } from "./ScheduleDialog";
import { LayoutGrid } from "lucide-react";
import { PlatformLimitMeter } from "./PlatformLimitMeter";
import { CaptionStudio } from "./CaptionStudio";
import { ShareDialog, type PlatformShareCaption } from "./ShareDialog";
import {
  PlatformDeliveryBoard,
  type PlatformDeliveryOutput,
} from "./PlatformDeliveryBoard";
import { MobilePublishStudio } from "./MobilePublishStudio";
import { CaptionAlternativesModal } from "./CaptionAlternativesModal";
import { isBrandCategoryId, resolveCreative } from "../services/creativeSystem";
import { ProgressiveImage } from "./ui/ProgressiveImage";
import { useToast } from "./ui/Toast";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import {
  getPostApprovalStatus,
  markPostVideoGenerated,
  schedulePost,
  updatePostDraft,
} from "../services/posts";
import {
  analyzeCaptionForDelivery,
  analyzeCaptionSetForDelivery,
  prohibitedClaimsMessage,
  buildEmployeeDisclosure,
  prependEmployeeDisclosure,
} from "../utils/complianceDisclosures";
import { captionUsesOnlyExpectedCustomer } from "../utils/captionQuality";
import { toPublicCustomerLabel } from "../utils/customerIdentity";
import {
  preferredExportFormatIds,
  resolvePrimaryImageProfile,
  resolvePlatformOption,
} from "../services/platformCopy";
import {
  isMobilePhotoDevice,
  prepareMediaForSave,
  savePreparedMediaToLibrary,
  saveResultToastMessage,
  validateVideoMetadata,
  type PreparedMediaSave,
} from "../utils/mediaSave";
import { useAppStore } from "../stores/appStore";
import { ApiError } from "../services/apiErrors";
import { linkReleaseToPostWithRetry } from "../services/photoReleases";
import { connectionManager } from "../utils/connectionManager";
import { archiveDealerMedia } from "../utils/creativeStorage";
import { EXPORT_FORMATS, renderFormatIfNeeded } from "../utils/multiFormatExport";
import { logError } from "../utils/telemetry";
import {
  derivePlatformDeliveryPlan,
  type PlannedPlatformDelivery,
} from "../services/platformOutputs";
import type { PublishContent } from "../services/publishTargets";
import {
  appendDealershipMention,
  dealershipMentionFor,
} from "../utils/socialAttribution";
import { retainNewestVideoJobs } from "../utils/videoJobRetention";
import {
  buildFinalWebsiteDraftFallback,
  enqueueWebsitePublication,
  getWebsitePublication,
  listWebsiteDestinations,
  retryWebsitePublication,
  safeWebsiteReviewUrl,
  websitePublicationNeedsStatusRefresh,
  websitePublicationPollDelay,
  type WebsiteDraft,
  type WebsitePublication,
} from "../services/websitePublishing";

// Lazy load modals for performance
const LazyImagePreviewModal = React.lazy(() =>
  import("./ImagePreviewModal").then((mod) => ({
    default: mod.ImagePreviewModal,
  })),
);
const LazyEditTextModal = React.lazy(() =>
  import("./EditTextModal").then((mod) => ({ default: mod.EditTextModal })),
);
const LazyVideoDirectorModal = React.lazy(() =>
  import("./VideoDirectorModal").then((mod) => ({
    default: mod.VideoDirectorModal,
  })),
);
const LazyFunModeDirectorModal = React.lazy(() =>
  import("./FunModeDirectorModal").then((mod) => ({
    default: mod.FunModeDirectorModal,
  })),
);

const TILE_BASE =
  "flex items-center justify-start gap-2.5 relative overflow-hidden " +
  "py-2.5 px-3 rounded-xl transition-colors duration-200 " +
  "text-xs sm:text-sm font-semibold min-h-[44px] w-full " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/70 " +
  "focus-visible:ring-offset-2 focus-visible:ring-offset-surface-950 " +
  "disabled:opacity-50 disabled:cursor-not-allowed";
const TILE_NEUTRAL =
  "bg-white/[0.06] border border-white/[0.08] text-surface-50 " +
  "hover:bg-white/[0.10] hover:border-white/[0.15]";
const TILE_ICON_ACCENT = "text-primary-300";

const websitePublicationCopy = (
  publication: WebsitePublication | undefined,
  hasSavedPost = true,
): {
  title: string;
  detail: string;
  tone: "neutral" | "info" | "warning" | "success" | "error";
} => {
  switch (publication?.status) {
    case "not_requested":
      return {
        title: "Website selected",
        detail: "Review, then send one private draft.",
        tone: "neutral",
      };
    case "waiting_approval":
      return {
        title: "Draft waiting for approval",
        detail: "Delivery starts once this creative is approved.",
        tone: "warning",
      };
    case "queued":
    case "retrying":
      return {
        title: "Website draft queued",
        detail: "Handoff queued. Nothing is public yet.",
        tone: "info",
      };
    case "delivering":
      return {
        title: "Sending private draft",
        detail: "Customer Hub is receiving this creative.",
        tone: "info",
      };
    case "draft_ready":
      return publication.lastError
        ? {
            title: "Draft ready — check status",
            detail: "The draft is safe. Retry once you are back online.",
            tone: "warning",
          }
        : {
            title: "Private draft ready",
            detail: "Review in Customer Hub, then publish.",
            tone: "success",
          };
    case "published":
      return {
        title: "Published on the website",
        detail: "Customer Hub reports this item is public.",
        tone: "success",
      };
    case "failed":
      if (!hasSavedPost) {
        return {
          title: "Draft not saved",
          detail: "The post never saved. Start a new one when online.",
          tone: "error",
        };
      }
      return {
        title: "Draft delivery needs attention",
        detail: friendlyWebsiteDeliveryError(publication.lastError),
        tone: "error",
      };
    case "withdrawn":
      return {
        title: "Website draft withdrawn",
        detail: "This revision is no longer queued or public.",
        tone: "neutral",
      };
    default:
      return {
        title: "Website draft prepared",
        detail: "Nothing is public until Customer Hub publishes it.",
        tone: "neutral",
      };
  }
};

const friendlyWebsiteDeliveryError = (code?: string): string => {
  switch ((code || "").trim()) {
    case "destination_rejected_payload":
    case "destination_image_rejected":
      return "Customer Hub could not accept the image. The private draft was not published; retry after reviewing the final creative.";
    case "queue_unavailable":
    case "destination_unavailable":
      return "The private website connection is temporarily unavailable. Your finished post remains saved.";
    case "approval_pending":
      return "Manager approval is still required before Customer Hub delivery can begin.";
    case "release_pending":
      return "The photo release must finish saving before this customer draft can be delivered.";
    default:
      return "The private draft was not delivered. Your finished post remains saved and can be retried safely.";
  }
};

const websitePrivacyFlagCopy: Record<string, string> = {
  faces_visible: "face may be visible",
  license_plate_visible: "license plate may be visible",
  personal_information_visible: "personal information may be visible",
  minor_may_be_visible: "minor may be visible",
  review_visual_privacy: "review the entire image closely",
};

/**
 * A compact secondary tool. Result completion actions intentionally use a
 * stronger treatment below the caption; these controls stay visually quiet.
 */
const ActionTile: React.FC<{
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  tooltip?: string;
  ariaLabel?: string;
  disabled?: boolean;
  busy?: boolean;
  iconClassName?: string;
}> = ({
  icon: Icon,
  label,
  onClick,
  tooltip,
  ariaLabel,
  disabled = false,
  busy = false,
  iconClassName,
}) => {
  const shouldReduceMotion = useReducedMotion();
  const button = (
    <m.button
      type="button"
      onClick={() => {
        triggerHapticFeedback();
        onClick();
      }}
      disabled={disabled}
      // The visible label is hidden on the narrowest phones (see below), so the
      // tile must always carry an accessible name of its own.
      aria-label={ariaLabel || label}
      aria-busy={busy || undefined}
      className={cn(TILE_BASE, TILE_NEUTRAL, "max-[399px]:justify-center")}
      whileHover={shouldReduceMotion ? undefined : { x: disabled ? 0 : 2 }}
      whileTap={shouldReduceMotion ? undefined : { scale: disabled ? 1 : 0.98 }}
    >
      {busy ? (
        <Loader2
          className={cn(
            "w-4 h-4 shrink-0",
            !shouldReduceMotion && "animate-spin",
            iconClassName,
          )}
        />
      ) : (
        <Icon className={cn("w-4 h-4 shrink-0", iconClassName)} />
      )}
      {/* These tiles sit in a 3-column grid on phones. Below ~400px each column
          is too narrow for a two-word label, and `truncate` rendered "Video",
          "Fun mode" and "Schedule" as "Vi…", "Fu…" and "Sc…". An icon-only tile
          with the name on aria-label and the Tooltip reads better than two
          characters, and stays legible down to the 280px fold width. */}
      <span className="truncate max-[399px]:hidden">{label}</span>
    </m.button>
  );
  return tooltip ? (
    <Tooltip label={tooltip} side="top">
      {button}
    </Tooltip>
  ) : (
    button
  );
};

interface PostResultProps {
  post: GeneratedPost;
  onStartOver: () => void;
  /** Same-photo remix — keep capture, return to CUSTOMIZE. */
  onRemix: () => void;
  onRegenerateImage: () => Promise<void>;
  onEditImage: (prompt: string) => Promise<void>;
  onRegenerateText: () => Promise<void>;
  onEditText: (
    prompt: string,
    originalText?: string,
    platformId?: string,
  ) => Promise<string>;
  /** Build metadata from the exact final image/caption before Hub handoff. */
  onPrepareFinalWebsiteDraft?: (input: {
    caption: string;
    image: string;
    currentDraft: WebsiteDraft;
  }) => Promise<WebsiteDraft>;
  onFunMode: (styleName?: string) => Promise<void>;
  onGenerateVideo: (style: VideoStyle, options: VideoRequestOptions) => Promise<string>;
  /** One-shot caption generator for the 3-variant alternatives modal. */
  onGenerateCaptionVariant?: () => Promise<string>;
  onShowSettings?: () => void;
  onShowHistory?: () => void;
  onRequestLogout?: () => void;
  error?: string | null;
  isDesktopLayout: boolean;
  requiresApproval?: boolean;
  /** Dealership-managed words or phrases that may not be delivered. */
  bannedPhrases?: string;
}

const BusyOverlay: React.FC<{ message: string; progress?: number }> = React.memo(
  ({ message, progress }) => {
    const shouldReduceMotion = useReducedMotion();

    return (
      <div
        className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-2xl bg-surface-950/90 px-5 text-center backdrop-blur-sm"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <Loader2
          className={cn(
            "mb-3 h-7 w-7 text-primary-300",
            !shouldReduceMotion && "animate-spin",
          )}
          aria-hidden="true"
        />
        <p className="mb-1 font-semibold text-surface-50">{message}</p>
        <p className="mb-3 text-xs text-surface-400">
          Keep this screen open. Your current work is safe.
        </p>
        {typeof progress === "number" && progress > 0 ? (
          <div className="w-full max-w-sm">
            <ProgressBar
              value={progress}
              showShimmer={!shouldReduceMotion}
              loadingLabel={message}
            />
          </div>
        ) : null}
      </div>
    );
  },
);

export const PostResult: React.FC<PostResultProps> = ({
  post,
  onStartOver,
  onRemix,
  onRegenerateImage,
  onEditImage,
  onRegenerateText,
  onEditText,
  onPrepareFinalWebsiteDraft,
  onFunMode,
  onGenerateVideo,
  onGenerateCaptionVariant,
  onShowSettings,
  onShowHistory,
  onRequestLogout,
  error,
  isDesktopLayout,
  requiresApproval = false,
  bannedPhrases,
}) => {
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  const shouldReduceMotion = useReducedMotion();
  const enabledFunStyles = useAppStore((s) => s.currentDealer?.enabled_fun_styles);
  const dealerId = useAppStore((s) => s.currentDealer?.id || "");
  const currentDealer = useAppStore((s) => s.currentDealer);
  const currentPersonName = useAppStore((s) => s.currentPerson?.name || "");
  const hasOriginalCapture = useAppStore((s) => Boolean(s.selectedImage));
  const generationScenarioId = useAppStore((s) => s.generationParams?.scenarioId);
  const generationStyle = useAppStore((s) => s.generationParams?.style);
  const generationTone = useAppStore((s) => s.generationParams?.tone);

  /**
   * Phase 2 creative resolver (docs/superpowers/specs/
   * 2026-09-02-brand-consistent-creative-system.md §4, §8).
   *
   * `resolveCreative` is pure, so the result screen calls it directly. Every
   * branch below keys off `resolved.enabled`; when it is false the resolver
   * prescribes nothing and restricts nothing, and this screen renders exactly
   * what it renders today.
   */
  const resolved = useMemo(
    () =>
      resolveCreative({
        dealer: currentDealer ?? null,
        categoryId: isBrandCategoryId(post.websiteDraft?.category)
          ? post.websiteDraft?.category
          : undefined,
        scenarioId: generationScenarioId,
        fallbackStyle: generationStyle,
        fallbackTone: generationTone,
      }),
    [
      currentDealer,
      generationScenarioId,
      generationStyle,
      generationTone,
      post.websiteDraft?.category,
    ],
  );
  /** Single switch for every publish-surface behavior added in phase 2. */
  const brandModeOn = resolved.enabled;

  const [isImageEditing, setIsImageEditing] = useState(false);
  const [imageEditPrompt, setImageEditPrompt] = useState("");
  const [isImageLoading, setIsImageLoading] = useState(false);
  const [imageLoadingMessage, setImageLoadingMessage] = useState("Updating image…");
  const [imageLoadingProgress, setImageLoadingProgress] = useState(0);

  const [editedText, setEditedText] = useState(post.text);
  /** Primary caption survives visits to destination-specific caption tabs. */
  const [primaryCaption, setPrimaryCaption] = useState(post.text);
  const [isTextEditing, setIsTextEditing] = useState(false);
  const [isTextLoading, setIsTextLoading] = useState(false);
  /** Active caption-pack platform tab; null = primary post.text. */
  const [activeCaptionPlatform, setActiveCaptionPlatform] = useState<string | null>(
    null,
  );
  const captionTabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Text history for undo/redo
  const [textHistory, setTextHistory] = useState<string[]>([post.text]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const [isVideoDirectorOpen, setIsVideoDirectorOpen] = useState(false);
  const [videoDirectorDeliveryId, setVideoDirectorDeliveryId] = useState<string | null>(
    null,
  );
  const [isFunModeDirectorOpen, setIsFunModeDirectorOpen] = useState(false);
  /**
   * Brand mode only. The house-style master is snapshotted before the Playful
   * render starts so the playful frame can be shown as a SECOND image instead
   * of replacing the master.
   */
  const [playfulPair, setPlayfulPair] = useState<{
    master: string;
    playful: string;
  } | null>(null);
  const playfulPendingMasterRef = useRef<string | null>(null);
  /**
   * Brand mode only: "Try another photo" / "Try another caption" are one shot
   * each. The budget is deliberately mount-scoped rather than keyed on
   * `resultIdentity` — a regenerated image mints a new attempt id, so keying on
   * it would hand the salesperson an unlimited supply of retries.
   */
  const [photoRetryUsed, setPhotoRetryUsed] = useState(false);
  const [captionRetryUsed, setCaptionRetryUsed] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  /** Legacy free-form video selection stays separate from an exact delivery row. */
  const [manualVideoSelected, setManualVideoSelected] = useState(false);
  const [isVideoLoading, setIsVideoLoading] = useState(false);
  /** Synchronous guard: React state alone cannot stop two taps in one frame. */
  const videoGenerationActiveRef = useRef(false);
  const videoJobSequenceRef = useRef(0);
  const [videoLoadingMessage, setVideoLoadingMessage] = useState("");
  /** Browser is buffering / decoding the blob after generation finishes. */
  const [isVideoBuffering, setIsVideoBuffering] = useState(false);
  const [videoPlayError, setVideoPlayError] = useState<string | null>(null);
  /** Start muted for autoplay policy; user can enable sound with one tap. */
  const [videoMuted, setVideoMuted] = useState(true);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  /** Own blob URLs so we only revoke the previous one when replacing/unmounting. */
  const activeVideoBlobRef = useRef<string | null>(null);
  const ownedVideoBlobUrlsRef = useRef<Set<string>>(new Set());
  const [videoJobs, setVideoJobs] = useState<
    Array<{
      id: string;
      style: VideoStyle;
      status: "queued" | "processing" | "completed" | "failed";
      duration: number;
      soundtrack: VideoRequestOptions["soundtrack"];
      aspectPreference: VideoRequestOptions["aspectPreference"];
      resolution: VideoRequestOptions["resolution"];
      pacing: VideoRequestOptions["pacing"];
      createdAt: string;
      /** Exact source creative revision used to generate this clip. */
      sourceCreativeKey: string;
      url?: string;
      error?: string;
    }>
  >([]);

  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isMultiFormatOpen, setIsMultiFormatOpen] = useState(false);
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const [focusedShareDeliveryId, setFocusedShareDeliveryId] = useState<string | null>(
    null,
  );
  const [focusedShareContent, setFocusedShareContent] = useState<PublishContent | null>(
    null,
  );
  const [batchDeliveryIds, setBatchDeliveryIds] = useState<Set<string>>(new Set());
  const [shareQueue, setShareQueue] = useState<string[]>([]);
  const [shareQueueIndex, setShareQueueIndex] = useState(0);
  const shareQueueOpenedRef = useRef<string | null>(null);
  const [isScheduleOpen, setIsScheduleOpen] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [captionAlts, setCaptionAlts] = useState<string[]>([]);
  const [isCaptionAltsOpen, setIsCaptionAltsOpen] = useState(false);
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  /** Guarded navigation away from this result: full reset or same-photo remix. */
  const [leaveConfirm, setLeaveConfirm] = useState<"startOver" | "remix" | null>(null);
  const [hasSavedMedia, setHasSavedMedia] = useState(false);
  const [hasCopiedCaption, setHasCopiedCaption] = useState(false);
  // What the manager asked to be changed. The rejection message used to say
  // "create another post with the requested changes" while nothing carried the
  // requested changes; this is them.
  const [rejectionReason, setRejectionReason] = useState<string>(
    post.rejectionReason || "",
  );
  const [approvalStatus, setApprovalStatus] = useState<
    NonNullable<GeneratedPost["approvalStatus"]>
  >(
    post.approvalStatus ??
      (requiresApproval ? (post.postId ? "pending" : "submission_failed") : "n_a"),
  );
  const [approvalCheckError, setApprovalCheckError] = useState<string | null>(null);
  const [imageReviewRequired, setImageReviewRequired] = useState(
    Boolean(post.imageReviewRequired),
  );
  /**
   * Release state is local because it is repairable from this screen: a
   * successful "Retry saving release" turns a locked post into a deliverable
   * one without regenerating anything.
   */
  const [releaseStatus, setReleaseStatus] = useState<GeneratedPost["releaseStatus"]>(
    post.releaseStatus,
  );
  const [releaseLinkStatus, setReleaseLinkStatus] = useState<
    GeneratedPost["releaseLinkStatus"]
  >(post.releaseLinkStatus);
  const [releaseRetrying, setReleaseRetrying] = useState(false);
  const [releaseRetryNotice, setReleaseRetryNotice] = useState<string | null>(null);
  /** One automatic reconnect retry per mount; the button stays available after. */
  const releaseReconnectUsedRef = useRef(false);
  const releaseRetryingRef = useRef(false);
  const [websitePublication, setWebsitePublication] = useState<
    WebsitePublication | undefined
  >(
    post.websitePublication ??
      (post.websiteDraft?.enabled ? { status: "not_requested" } : undefined),
  );
  const [websiteDraft, setWebsiteDraft] = useState<WebsiteDraft | undefined>(
    post.websiteDraft,
  );
  const [websiteCheckError, setWebsiteCheckError] = useState<string | null>(null);
  const [websiteRetrying, setWebsiteRetrying] = useState(false);
  const [websiteSending, setWebsiteSending] = useState(false);
  /** Stops duplicate final sends before React can commit the disabled state. */
  const websiteSendingRef = useRef(false);
  /** One authoritative status read per restored/saved post, including not_requested. */
  const websiteStatusHydratedPostRef = useRef<string | null>(null);
  const [websiteDestinationRevision, setWebsiteDestinationRevision] = useState(0);
  /** Local edits to per-platform pack captions (share + tab switch must honor these). */
  const [packOverrides, setPackOverrides] = useState<Record<string, string>>({});
  /** Prior image versions after regen/fun/edit (local compare stack, max 5). */
  const [imageVersions, setImageVersions] = useState<string[]>([]);
  const [preparedSave, setPreparedSave] = useState<PreparedMediaSave | null>(null);
  /** Prevent a prepared file from ever being used under a different delivery row. */
  const [preparedSaveForKey, setPreparedSaveForKey] = useState<string | null>(null);
  const [mediaPreparationError, setMediaPreparationError] = useState<string | null>(
    null,
  );
  const [mediaPreparationNonce, setMediaPreparationNonce] = useState(0);
  const [formattedPreviewUrl, setFormattedPreviewUrl] = useState<string | null>(null);
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string | null>(null);
  const [isPreparingSave, setIsPreparingSave] = useState(false);
  const [draftSyncStatus, setDraftSyncStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const draftSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDraftSyncRef = useRef<{
    caption: string;
    disclosures: string;
    imageDataUrl?: string;
    platformCaptions?: Record<string, string>;
  } | null>(null);
  const draftSyncChainRef = useRef<Promise<void>>(Promise.resolve());
  const draftSyncMountedRef = useRef(true);
  const lastSyncedDraftRef = useRef({
    caption: post.text,
    disclosures: post.disclosures || "",
    image: post.image,
    platformCaptions: JSON.stringify(post.platformCaptions || {}),
  });
  /** Server revision returned by the latest exact draft save. */
  const lastPostRevisionRef = useRef<string | null>(null);
  /** Live creative identity used to reject a send if anything changes during AI prep. */
  const latestWebsiteCreativeRef = useRef({
    postId: post.postId,
    image: post.image,
    caption: post.text,
  });
  const currentPostPropRef = useRef(post);
  currentPostPropRef.current = post;
  latestWebsiteCreativeRef.current = {
    postId: post.postId,
    image: post.image,
    caption: activeCaptionPlatform ? primaryCaption : editedText,
  };
  const prevImageRef = useRef(post.image);
  const resultIdentity =
    post.postId ||
    post.aiMeta?.image.attemptId ||
    post.aiMeta?.lastSuccessfulGenerationAt ||
    "local-result";
  const videoCreativeRevisionRef = useRef({
    image: post.image,
    resultIdentity,
    revision: 0,
  });
  if (
    videoCreativeRevisionRef.current.image !== post.image ||
    videoCreativeRevisionRef.current.resultIdentity !== resultIdentity
  ) {
    const previous = videoCreativeRevisionRef.current;
    videoCreativeRevisionRef.current = {
      image: post.image,
      resultIdentity,
      revision: previous.resultIdentity === resultIdentity ? previous.revision + 1 : 0,
    };
  }
  const currentVideoCreativeKey = `${resultIdentity}:${videoCreativeRevisionRef.current.revision}`;
  const previousResultIdentityRef = useRef(resultIdentity);
  const previousPostTextRef = useRef(post.text);
  // Caption state follows a new result/caption pack, but image-only
  // regeneration/editing must not erase salesperson edits already saved into
  // destination captions.
  useEffect(() => {
    if (previousResultIdentityRef.current === resultIdentity) return;
    previousResultIdentityRef.current = resultIdentity;
    setPackOverrides({});
    setHasSavedMedia(false);
    setHasCopiedCaption(false);
    setActiveCaptionPlatform(null);
    previousPostTextRef.current = post.text;
    setPrimaryCaption(post.text);
    setEditedText(post.text);
    setTextHistory([post.text]);
    setHistoryIndex(0);
  }, [post.text, resultIdentity]);

  // Push previous creative onto a small version stack when image is replaced.
  useEffect(() => {
    const prev = prevImageRef.current;
    if (prev && prev !== post.image) {
      setImageVersions((stack) => {
        const next = [prev, ...stack.filter((u) => u !== prev && u !== post.image)];
        return next.slice(0, 5);
      });
    }
    prevImageRef.current = post.image;
  }, [post.image]);

  // Brand mode: pair the playful render with the master it was made from, so
  // both stay on screen and the salesperson can switch back with one tap. The
  // pair is dropped as soon as the creative moves to an image that is neither
  // half of it (a fresh regenerate, a restored version, a different post).
  useEffect(() => {
    const master = playfulPendingMasterRef.current;
    if (master && master !== post.image) {
      playfulPendingMasterRef.current = null;
      setPlayfulPair({ master, playful: post.image });
      return;
    }
    setPlayfulPair((pair) =>
      pair && post.image !== pair.master && post.image !== pair.playful ? null : pair,
    );
  }, [post.image]);

  const effectivePack = useMemo(() => {
    if (!post.platformCaptions && Object.keys(packOverrides).length === 0) {
      return undefined;
    }
    return { ...(post.platformCaptions || {}), ...packOverrides };
  }, [post.platformCaptions, packOverrides]);

  const platformCaptionTabs = useMemo(() => {
    const pack = effectivePack;
    if (!pack || Object.keys(pack).length === 0) return [];
    const orderedIds =
      post.platformIds?.filter((id) => Boolean(pack[id])) ?? Object.keys(pack);
    for (const id of Object.keys(pack)) {
      if (!orderedIds.includes(id)) orderedIds.push(id);
    }
    return orderedIds.map((id) => ({
      id,
      label: resolvePlatformOption(id)?.shortLabel || id,
      caption: pack[id],
    }));
  }, [effectivePack, post.platformIds]);

  const exportPriorityFormatIds = useMemo(
    () => preferredExportFormatIds(post.platformIds ?? []),
    [post.platformIds],
  );
  const primarySaveFormat = useMemo(() => {
    const formatId =
      post.primaryFormatId ??
      resolvePrimaryImageProfile(post.platformIds).primaryFormatId;
    return EXPORT_FORMATS.find((format) => format.id === formatId);
  }, [post.platformIds, post.primaryFormatId]);
  const deliveryPlan = useMemo(() => {
    const requestedMode =
      videoJobs.length > 0 && post.mediaOutputMode !== "video"
        ? "both"
        : (post.mediaOutputMode ?? "photo");
    const fallbackPlatform =
      primarySaveFormat?.id === "feed_portrait"
        ? "instagram_feed"
        : primarySaveFormat?.id === "gbp"
          ? "gbp"
          : primarySaveFormat?.id === "marketplace"
            ? "marketplace"
            : "instagram_story";
    const requestedPlatforms = Array.isArray(post.platformIds)
      ? post.platformIds
      : websiteDraft?.enabled
        ? []
        : [fallbackPlatform];
    return derivePlatformDeliveryPlan(
      requestedPlatforms,
      requestedMode,
      post.postId ? `dealer-social-${post.postId}` : "dealer-social-post",
    );
  }, [
    post.mediaOutputMode,
    post.platformIds,
    post.postId,
    primarySaveFormat?.id,
    videoJobs.length,
    websiteDraft?.enabled,
  ]);
  const deliveriesById = useMemo(
    () =>
      new Map<string, PlannedPlatformDelivery>(
        deliveryPlan.deliveries.map((delivery) => [delivery.id, delivery]),
      ),
    [deliveryPlan.deliveries],
  );
  const websiteOnly = Boolean(
    websiteDraft?.enabled && deliveryPlan.deliveries.length === 0,
  );
  const deliveryPlanSignature = deliveryPlan.deliveries
    .map((delivery) => delivery.id)
    .join("|");
  useEffect(() => {
    setBatchDeliveryIds(
      new Set(
        deliveryPlan.deliveries
          .filter((delivery) => delivery.mediaKind === "photo")
          .map((delivery) => delivery.id),
      ),
    );
    setShareQueue([]);
    setShareQueueIndex(0);
    shareQueueOpenedRef.current = null;
  }, [deliveryPlanSignature, resultIdentity]);
  const selectedDelivery = selectedDeliveryId
    ? deliveriesById.get(selectedDeliveryId)
    : undefined;
  const latestVideoJobBySpec = useMemo(() => {
    const bySpec = new Map<string, (typeof videoJobs)[number]>();
    for (const job of videoJobs) {
      if (job.sourceCreativeKey !== currentVideoCreativeKey) continue;
      if (job.aspectPreference === "9:16" || job.aspectPreference === "16:9") {
        bySpec.set(`${job.aspectPreference}:${job.resolution}:${job.duration}`, job);
      }
    }
    return bySpec;
  }, [currentVideoCreativeKey, videoJobs]);
  const videoJobForDelivery = useCallback(
    (delivery: PlannedPlatformDelivery) => {
      if (
        delivery.mediaKind !== "video" ||
        delivery.profile.preparation.kind !== "veo"
      ) {
        return undefined;
      }
      const preparation = delivery.profile.preparation;
      return latestVideoJobBySpec.get(
        `${preparation.nativeAspectRatio}:${preparation.resolution}:${preparation.durationSeconds}`,
      );
    },
    [latestVideoJobBySpec],
  );
  const selectedVideoJob =
    selectedDelivery?.mediaKind === "video"
      ? videoJobForDelivery(selectedDelivery)
      : undefined;
  const preparationKeyForDelivery = useCallback(
    (delivery: PlannedPlatformDelivery) => {
      const job =
        delivery.mediaKind === "video" ? videoJobForDelivery(delivery) : undefined;
      return `delivery:${delivery.id}:${job?.id || "asset"}`;
    },
    [videoJobForDelivery],
  );
  const batchEligibleDeliveryIds = useMemo(
    () =>
      new Set<string>(
        deliveryPlan.deliveries
          .filter((delivery) => {
            if (delivery.mediaKind === "photo") return true;
            const job = videoJobForDelivery(delivery);
            return job?.status === "completed" && Boolean(job.url);
          })
          .map((delivery) => delivery.id),
      ),
    [deliveryPlan.deliveries, videoJobForDelivery],
  );
  useEffect(() => {
    setBatchDeliveryIds((current) => {
      const next = new Set(
        [...current].filter((deliveryId) => batchEligibleDeliveryIds.has(deliveryId)),
      );
      if (
        next.size === current.size &&
        [...next].every((deliveryId) => current.has(deliveryId))
      ) {
        return current;
      }
      return next;
    });
  }, [batchEligibleDeliveryIds]);
  const selectedPreparationKey = manualVideoSelected
    ? `manual-video:${videoUrl || "pending"}`
    : selectedDelivery
      ? preparationKeyForDelivery(selectedDelivery)
      : `primary:${resultIdentity}`;
  const activePreparedSave =
    preparedSaveForKey === selectedPreparationKey ? preparedSave : null;
  const activeImageFormat = useMemo(() => {
    if (selectedDelivery?.mediaKind === "photo") {
      return EXPORT_FORMATS.find(
        (format) => format.id === selectedDelivery.profile.legacyExportFormatId,
      );
    }
    return primarySaveFormat;
  }, [primarySaveFormat, selectedDelivery]);

  useEffect(() => {
    if (
      selectedDeliveryId &&
      deliveryPlan.deliveries.some((delivery) => delivery.id === selectedDeliveryId)
    ) {
      return;
    }
    setSelectedDeliveryId(deliveryPlan.deliveries[0]?.id || null);
  }, [deliveryPlan.deliveries, selectedDeliveryId]);

  useEffect(() => {
    setIsToolsOpen(false);
  }, [isDesktopLayout]);
  const captionAnalysis = useMemo(
    () => analyzeCaptionForDelivery(editedText, bannedPhrases),
    [bannedPhrases, editedText],
  );
  const captionSetAnalysis = useMemo(() => {
    const currentPrimaryCaption = activeCaptionPlatform ? primaryCaption : editedText;
    const variants = { ...(effectivePack || {}) };
    if (activeCaptionPlatform) variants[activeCaptionPlatform] = editedText;
    return analyzeCaptionSetForDelivery(
      [currentPrimaryCaption, ...Object.values(variants)],
      bannedPhrases,
    );
  }, [activeCaptionPlatform, bannedPhrases, editedText, effectivePack, primaryCaption]);
  const customerIdentityIsSafe = useCallback(
    (caption: string): boolean =>
      captionUsesOnlyExpectedCustomer(caption, post.customerDisplayName, {
        allowedPhrases: [currentDealer?.name, websiteDraft?.vehicleDescription],
        rejectAnyCustomerIdentity: Boolean(
          (post.customerIdentityRequired || websiteDraft?.kind === "customer_story") &&
          !toPublicCustomerLabel(post.customerDisplayName),
        ),
      }),
    [
      currentDealer?.name,
      post.customerDisplayName,
      post.customerIdentityRequired,
      websiteDraft?.kind,
      websiteDraft?.vehicleDescription,
    ],
  );
  const identityLocked = useMemo(() => {
    const currentPrimaryCaption = activeCaptionPlatform ? primaryCaption : editedText;
    const variants = { ...(effectivePack || {}) };
    if (activeCaptionPlatform) variants[activeCaptionPlatform] = editedText;
    return [currentPrimaryCaption, ...Object.values(variants)].some(
      (caption) => !customerIdentityIsSafe(caption),
    );
  }, [
    activeCaptionPlatform,
    customerIdentityIsSafe,
    editedText,
    effectivePack,
    post.customerDisplayName,
    primaryCaption,
  ]);
  const imageBusy = isImageLoading || isVideoLoading;
  const textBusy = isTextLoading;
  const reviewRequired =
    post.approvalStatus !== undefined
      ? post.approvalStatus !== "n_a"
      : requiresApproval;
  const approvalLocked = reviewRequired && approvalStatus !== "approved";
  // The gate itself is unchanged: delivery stays locked for BOTH release
  // failures. Only the explanation and the remedy differ below.
  const releaseLocked = releaseStatus === "save_failed";
  /**
   * The recoverable variant: the customer's signature is durably stored on the
   * server and only its association with this post is missing, so both ids
   * needed to repair it are already in hand.
   */
  const releaseLinkRepairable =
    releaseLocked &&
    releaseLinkStatus === "link_failed" &&
    Boolean(post.releaseId) &&
    Boolean(post.postId);
  const claimLocked = captionSetAnalysis.prohibited.length > 0;
  const deliveryLocked =
    imageReviewRequired ||
    approvalLocked ||
    releaseLocked ||
    claimLocked ||
    identityLocked;
  const persistWebsiteState = useCallback(
    (
      nextDraft: WebsiteDraft | undefined,
      nextPublication: WebsitePublication,
      creativePatch: Partial<GeneratedPost> = {},
    ) => {
      setWebsiteDraft(nextDraft);
      setWebsitePublication(nextPublication);
      const sourcePost = currentPostPropRef.current;
      if (!sourcePost.postId) return;
      const store = useAppStore.getState();
      const current = store.generatedPost;
      if (current && current.postId !== sourcePost.postId) return;
      const base = current || sourcePost;
      store.setGeneratedPost({
        ...base,
        ...creativePatch,
        websiteDraft: nextDraft ?? base.websiteDraft,
        websitePublication: nextPublication,
      });
    },
    [],
  );
  /**
   * Repair the missing post↔release association. Nothing is re-signed and no
   * paid generation runs: this is the same small first-party POST that failed
   * after the post was created, replayed with the ids already on the post.
   */
  const retryReleaseLink = useCallback(
    async (trigger: "manual" | "reconnect") => {
      const sourcePost = currentPostPropRef.current;
      const releaseId = sourcePost.releaseId;
      const postId = sourcePost.postId;
      if (!releaseId || !postId || releaseRetryingRef.current) return;
      releaseRetryingRef.current = true;
      setReleaseRetrying(true);
      setReleaseRetryNotice(null);
      try {
        await linkReleaseToPostWithRetry(releaseId, postId);
        setReleaseStatus("saved");
        setReleaseLinkStatus(undefined);
        const store = useAppStore.getState();
        const current = store.generatedPost;
        if (!current || current.postId === postId) {
          const base = current || sourcePost;
          store.setGeneratedPost({
            ...base,
            releaseStatus: "saved",
            releaseLinkStatus: undefined,
          });
        }
        toast.success(
          "Photo release saved to this post. Copy, share, save, and export are unlocked.",
        );
      } catch (error) {
        logError("photo_release.link_retry_failed", {
          message: error instanceof Error ? error.message : String(error),
          trigger,
        });
        setReleaseRetryNotice(
          connectionManager.isOnline
            ? "That did not go through. Nothing was lost — the signed release is still stored. Try again in a moment; it also retries on its own when the connection comes back."
            : "You are offline. Nothing was lost — the signed release is still stored, and this retries automatically as soon as you are back online.",
        );
      } finally {
        releaseRetryingRef.current = false;
        setReleaseRetrying(false);
      }
    },
    [toast],
  );
  // Queue one automatic repair for the common field case: the link failed
  // because the lot Wi-Fi dropped, and the salesperson is still on this screen
  // when the connection comes back.
  useEffect(() => {
    if (!releaseLinkRepairable) return;
    return connectionManager.subscribe((online) => {
      if (!online || releaseReconnectUsedRef.current) return;
      releaseReconnectUsedRef.current = true;
      void retryReleaseLink("reconnect");
    });
  }, [releaseLinkRepairable, retryReleaseLink]);
  // Once a creative has entered the review workflow it must remain byte-for-
  // byte equivalent to what the manager saw. Delivery unlocks on approval,
  // while edits require starting a new review submission.
  const creativeLockedForReview = reviewRequired;
  const websiteHandoffStarted = Boolean(
    websitePublication && websitePublication.status !== "not_requested",
  );
  const contentEditingLocked =
    creativeLockedForReview || websiteHandoffStarted || websiteSending;
  const videoReviewLockMessage =
    "This reviewed creative must stay unchanged. Start a new post to create a video.";
  const historyReadOnly = Boolean(post.historyReadOnly);
  const editableDraft = !contentEditingLocked && !historyReadOnly;
  const originalRequiredMessage =
    "This tool needs the original captured photo. Reopened History keeps the finished creative, so use Edit image or start a new photo instead.";
  /** Brand mode only: shown once a one-shot retry has been spent. */
  const oneShotSpentMessage =
    "Already used once on this post. A manager can regenerate it for you.";

  const flushPendingDraft = useCallback((): Promise<boolean> => {
    const draft = pendingDraftSyncRef.current;
    if (draftSyncTimeoutRef.current) {
      clearTimeout(draftSyncTimeoutRef.current);
      draftSyncTimeoutRef.current = null;
    }
    if (!draft || !post.postId || !editableDraft) return Promise.resolve(true);

    const operation = draftSyncChainRef.current.then(async () => {
      try {
        const updated = await updatePostDraft(post.postId as string, draft);
        lastPostRevisionRef.current = updated.post_revision;
        lastSyncedDraftRef.current = {
          caption: draft.caption,
          disclosures: draft.disclosures,
          image: draft.imageDataUrl || lastSyncedDraftRef.current.image,
          platformCaptions: JSON.stringify(draft.platformCaptions || {}),
        };
        if (pendingDraftSyncRef.current === draft) {
          pendingDraftSyncRef.current = null;
        }
        if (draftSyncMountedRef.current) {
          setDraftSyncStatus(pendingDraftSyncRef.current ? "saving" : "saved");
        }
        return true;
      } catch (err) {
        logError("post.draft_sync_failed", {
          postId: post.postId,
          message: err instanceof Error ? err.message : String(err),
        });
        if (draftSyncMountedRef.current) setDraftSyncStatus("error");
        return false;
      }
    });
    draftSyncChainRef.current = operation.then(() => undefined);
    return operation;
  }, [editableDraft, post.postId]);

  useEffect(() => {
    if (!post.postId || !editableDraft) return;
    const historyCaption = activeCaptionPlatform ? primaryCaption : editedText;
    const historyAnalysis = activeCaptionPlatform
      ? analyzeCaptionForDelivery(primaryCaption, bannedPhrases)
      : captionAnalysis;
    if (
      !historyCaption.trim() ||
      historyAnalysis.compliance.prohibited.length > 0 ||
      captionSetAnalysis.prohibited.length > 0 ||
      identityLocked
    ) {
      return;
    }
    const last = lastSyncedDraftRef.current;
    const caption = historyAnalysis.caption;
    const disclosures = captionSetAnalysis.disclosures;
    const imageChanged = post.image !== last.image;
    const platformCaptionsJson = JSON.stringify(effectivePack || {});
    const platformCaptionsChanged = platformCaptionsJson !== last.platformCaptions;
    if (
      caption === last.caption &&
      disclosures === last.disclosures &&
      !imageChanged &&
      !platformCaptionsChanged
    ) {
      return;
    }
    pendingDraftSyncRef.current = {
      caption,
      disclosures,
      ...(imageChanged ? { imageDataUrl: post.image } : {}),
      platformCaptions: effectivePack,
    };
    setDraftSyncStatus("saving");
    if (draftSyncTimeoutRef.current) clearTimeout(draftSyncTimeoutRef.current);
    draftSyncTimeoutRef.current = setTimeout(() => {
      void flushPendingDraft();
    }, 600);
  }, [
    activeCaptionPlatform,
    bannedPhrases,
    captionAnalysis,
    captionSetAnalysis,
    editedText,
    effectivePack,
    flushPendingDraft,
    post.image,
    post.postId,
    primaryCaption,
    editableDraft,
    identityLocked,
  ]);

  useEffect(() => {
    draftSyncMountedRef.current = true;
    return () => {
      draftSyncMountedRef.current = false;
      if (draftSyncTimeoutRef.current) {
        clearTimeout(draftSyncTimeoutRef.current);
        draftSyncTimeoutRef.current = null;
      }
      // Queue the last edit behind any in-flight save so an older response can
      // never overwrite a newer draft during navigation.
      void flushPendingDraft();
    };
  }, [flushPendingDraft]);

  const approvalGateMessage =
    approvalStatus === "approved"
      ? "Manager approved this exact creative. Save, share, and export are unlocked; start a new post to make changes."
      : approvalStatus === "rejected"
        ? rejectionReason
          ? `A manager asked for a change: ${rejectionReason} Delivery stays locked until you create another post.`
          : "A manager rejected this creative. Delivery remains locked; create another post with the requested changes."
        : approvalStatus === "submission_failed"
          ? "This creative could not be submitted for approval. Delivery remains locked; check your connection and create another post to retry."
          : "This exact image and caption are awaiting manager approval. Save, share, and export unlock automatically after approval.";
  // Two different failures, two different truths. The harsher wording is
  // reserved for the case where consent may genuinely be missing; claiming a
  // stored signature "was not stored" sent salespeople back to customers who
  // had already driven away.
  const releaseGateTitle = releaseLinkRepairable
    ? "Photo release not attached yet"
    : "Photo release not saved";
  const releaseGateMessage = releaseLinkRepairable
    ? "The customer's signed release was captured and saved — nothing needs to be signed again. Only its link to this post did not finish, so copy, share, save, and export stay locked until it does. Retry saving the release below."
    : "The signed photo release was not stored, so consent cannot be verified. Copy, share, save, and export remain locked; check your connection and create another post to retry.";
  const claimGateMessage = claimLocked
    ? prohibitedClaimsMessage(captionSetAnalysis.prohibited)
    : "";
  const identityGateMessage = identityLocked
    ? post.customerDisplayName
      ? `This copy appears to name someone other than ${post.customerDisplayName}. Correct every caption before saving, copying, scheduling, sharing, or sending it to the website.`
      : "This customer-required copy includes a name without an approved public customer label. Remove the name or add the approved customer first name before delivery."
    : "";
  const imageReviewGateMessage = imageReviewRequired
    ? "This saved image predates the current on-pixel customer-name, logo, and source-fidelity review. It cannot be copied, saved, shared, scheduled, approved, or sent to the website. Create a new post from the original photo."
    : "";
  const deliveryGateMessage = imageReviewRequired
    ? imageReviewGateMessage
    : identityLocked
      ? identityGateMessage
      : claimLocked
        ? claimGateMessage
        : releaseLocked
          ? releaseGateMessage
          : approvalGateMessage;
  const deliveryLockLabel = imageReviewRequired
    ? "Image review required"
    : identityLocked
      ? "Customer blocked"
      : claimLocked
        ? "Claim blocked"
        : releaseLocked
          ? releaseLinkRepairable
            ? "Release not attached"
            : "Release not saved"
          : "Approval pending";
  /**
   * The action bar states the lock; it does not offer it as something to press.
   * It used to render inside the Copy button, so the same sentence appeared as
   * a banner, a toast, and a disabled control that looked tappable. The reason
   * still reaches assistive tech through each disabled button's aria-label, so
   * this stays out of the live regions rather than announcing a third time.
   */
  const deliveryLockStatus = deliveryLocked ? (
    <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-warning-200">
      <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>Delivery locked · {deliveryLockLabel}</span>
    </p>
  ) : null;
  const websiteStatusCopy = websitePublicationCopy(
    websitePublication,
    Boolean(post.postId),
  );
  const websiteReviewUrl = useMemo(
    () => safeWebsiteReviewUrl(websitePublication?.reviewUrl),
    [websiteDestinationRevision, websitePublication?.reviewUrl],
  );

  useEffect(() => {
    setApprovalStatus(
      post.approvalStatus ??
        (requiresApproval ? (post.postId ? "pending" : "submission_failed") : "n_a"),
    );
    setApprovalCheckError(null);
    setImageReviewRequired(Boolean(post.imageReviewRequired));
  }, [post.postId, post.approvalStatus, post.imageReviewRequired, requiresApproval]);

  // A different post (or a store update after a repair) owns the release gate.
  useEffect(() => {
    setReleaseStatus(post.releaseStatus);
    setReleaseLinkStatus(post.releaseLinkStatus);
    setReleaseRetryNotice(null);
    releaseReconnectUsedRef.current = false;
  }, [post.postId, post.releaseStatus, post.releaseLinkStatus]);

  useEffect(() => {
    if (!reviewRequired || approvalStatus !== "pending" || !post.postId) {
      return;
    }

    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let active = true;

    const schedule = () => {
      if (active) timeoutId = setTimeout(checkStatus, 10000);
    };
    const checkStatus = async () => {
      if (!active) return;
      if (typeof document !== "undefined" && document.hidden) {
        schedule();
        return;
      }
      try {
        const result = await getPostApprovalStatus(
          post.postId as string,
          controller.signal,
        );
        if (!active) return;
        setApprovalCheckError(null);
        setImageReviewRequired(Boolean(result.image_review_required));
        setApprovalStatus(result.approval_status);
        setRejectionReason(result.rejection_reason || "");
        if (result.approval_status === "approved") {
          toast.success("Manager approved this post. Delivery is unlocked.");
          return;
        }
        if (result.approval_status === "rejected") {
          toast.warning(
            result.rejection_reason
              ? `Manager asked for a change: ${result.rejection_reason}`
              : "Manager requested changes. Delivery remains locked.",
          );
          return;
        }
        schedule();
      } catch (err) {
        if (!active || (err instanceof DOMException && err.name === "AbortError")) {
          return;
        }
        setApprovalCheckError(
          "Approval status could not be refreshed. We’ll keep checking.",
        );
        schedule();
      }
    };

    void checkStatus();
    return () => {
      active = false;
      controller.abort();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [approvalStatus, post.postId, reviewRequired, toast]);

  useEffect(() => {
    setWebsitePublication(
      post.websitePublication ??
        (post.websiteDraft?.enabled ? { status: "not_requested" } : undefined),
    );
    setWebsiteDraft(post.websiteDraft);
    setWebsiteCheckError(null);
  }, [post.postId, post.websiteDraft, post.websitePublication]);

  // safeWebsiteReviewUrl remains exact-origin bound. A direct session restore
  // can land on RESULT before PostCustomizer has loaded destination config, so
  // prime the allowlist here as well.
  useEffect(() => {
    if (!websiteDraft?.enabled) return;
    void listWebsiteDestinations()
      .then(() => setWebsiteDestinationRevision((revision) => revision + 1))
      .catch(() => undefined);
  }, [websiteDraft?.enabled]);

  // Local/session state is only a fast restore hint. Read the durable state
  // once even when it says not_requested so a reload or lost POST response can
  // never make an already-sent draft look editable again.
  useEffect(() => {
    if (!websiteDraft?.enabled || !post.postId) return;
    const hydrationKey = `${dealerId}:${post.postId}`;
    if (websiteStatusHydratedPostRef.current === hydrationKey) return;
    websiteStatusHydratedPostRef.current = hydrationKey;
    const controller = new AbortController();
    let active = true;

    void getWebsitePublication(post.postId, controller.signal)
      .then((next) => {
        if (!active) return;
        persistWebsiteState(next.websiteDraft ?? websiteDraft, next);
        setWebsiteCheckError(null);
      })
      .catch((err) => {
        if (!active || (err instanceof DOMException && err.name === "AbortError")) {
          return;
        }
        setWebsiteCheckError(
          "Website status could not be verified yet. No new handoff has been started.",
        );
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [dealerId, persistWebsiteState, post.postId, websiteDraft]);

  useEffect(() => {
    if (!websiteDraft?.enabled || !post.postId) return;
    if (!websitePublication || websitePublication.status === "not_requested") return;
    if (
      websitePublication &&
      !websitePublicationNeedsStatusRefresh(websitePublication.status)
    ) {
      return;
    }
    const controller = new AbortController();
    let active = true;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const refresh = async () => {
      if (typeof document !== "undefined" && document.hidden) {
        timeoutId = setTimeout(refresh, 60_000);
        return;
      }
      try {
        const next = await getWebsitePublication(
          post.postId as string,
          controller.signal,
        );
        if (!active) return;
        persistWebsiteState(next.websiteDraft ?? websiteDraft, next);
        setWebsiteCheckError(null);
        if (websitePublicationNeedsStatusRefresh(next.status)) {
          timeoutId = setTimeout(refresh, websitePublicationPollDelay(next.status));
        }
      } catch (err) {
        if (!active || (err instanceof DOMException && err.name === "AbortError")) {
          return;
        }
        setWebsiteCheckError(
          "Website status could not be refreshed. The delivery worker will keep retrying safely.",
        );
        timeoutId = setTimeout(refresh, 15_000);
      }
    };

    void refresh();
    return () => {
      active = false;
      controller.abort();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [persistWebsiteState, post.postId, websiteDraft, websitePublication?.status]);

  const handleRetryWebsite = useCallback(async () => {
    if (!post.postId || websiteRetrying) return;
    const retryingStatusCheck = websitePublication?.status === "draft_ready";
    setWebsiteRetrying(true);
    try {
      const next = await retryWebsitePublication(post.postId);
      persistWebsiteState(next.websiteDraft ?? websiteDraft, next);
      setWebsiteCheckError(null);
      toast.success(
        retryingStatusCheck
          ? "Website status check queued."
          : "Private website draft queued again.",
      );
    } catch (err) {
      toast.error(toUiMessage(err, "Website draft could not be retried."));
    } finally {
      setWebsiteRetrying(false);
    }
  }, [
    persistWebsiteState,
    post.postId,
    toast,
    websiteDraft,
    websitePublication?.status,
    websiteRetrying,
  ]);

  const handleSendWebsiteDraft = useCallback(async () => {
    if (!post.postId || !websiteDraft?.enabled || websiteSendingRef.current) return;
    if (deliveryLocked) {
      toast.warning(deliveryGateMessage);
      return;
    }
    if (imageBusy || textBusy) {
      toast.warning("Wait for the current image or caption update to finish first.");
      return;
    }
    const finalCaption = activeCaptionPlatform ? primaryCaption : editedText;
    const finalCaptionAnalysis = analyzeCaptionForDelivery(finalCaption, bannedPhrases);
    if (finalCaptionAnalysis.compliance.prohibited.length > 0) {
      toast.warning(
        prohibitedClaimsMessage(finalCaptionAnalysis.compliance.prohibited),
      );
      return;
    }

    const capturedCreative = {
      postId: post.postId,
      image: post.image,
      caption: finalCaptionAnalysis.caption,
    };
    const savedPrimaryCaption = activeCaptionPlatform
      ? analyzeCaptionForDelivery(primaryCaption, bannedPhrases).caption
      : capturedCreative.caption;
    const savedPlatformCaptions = activeCaptionPlatform
      ? {
          ...(effectivePack || {}),
          [activeCaptionPlatform]: capturedCreative.caption,
        }
      : effectivePack;
    const creativePatch: Partial<GeneratedPost> = {
      image: capturedCreative.image,
      text: savedPrimaryCaption,
      disclosures: captionSetAnalysis.disclosures,
      ...(savedPlatformCaptions ? { platformCaptions: savedPlatformCaptions } : {}),
    };

    websiteSendingRef.current = true;
    setWebsiteSending(true);
    try {
      // Always write the exact visible creative once at the send boundary,
      // even when autosave was already idle. The returned server revision is
      // the compare-and-set token used by the enqueue route.
      pendingDraftSyncRef.current = {
        caption: savedPrimaryCaption,
        disclosures: captionSetAnalysis.disclosures,
        imageDataUrl: capturedCreative.image,
        platformCaptions: savedPlatformCaptions,
      };
      setDraftSyncStatus("saving");
      lastPostRevisionRef.current = null;
      const draftSaved = await flushPendingDraft();
      const expectedPostRevision = lastPostRevisionRef.current;
      if (!draftSaved || !expectedPostRevision) {
        throw new Error(
          "The latest edit did not save. Retry the My Work save before sending.",
        );
      }
      const finalDraft = onPrepareFinalWebsiteDraft
        ? await onPrepareFinalWebsiteDraft({
            caption: finalCaptionAnalysis.caption,
            image: capturedCreative.image,
            currentDraft: websiteDraft,
          })
        : buildFinalWebsiteDraftFallback({
            currentDraft: websiteDraft,
            dealerName: currentDealer?.name || "the dealership",
            caption: finalCaptionAnalysis.caption,
          });
      const liveCreative = latestWebsiteCreativeRef.current;
      const liveCaption = analyzeCaptionForDelivery(
        liveCreative.caption,
        bannedPhrases,
      ).caption;
      const storedCreative = useAppStore.getState().generatedPost;
      const changedCreativePart =
        liveCreative.postId !== capturedCreative.postId
          ? "post"
          : liveCreative.image !== capturedCreative.image
            ? "live image"
            : liveCaption !== capturedCreative.caption
              ? "live caption"
              : storedCreative?.postId === capturedCreative.postId &&
                  storedCreative.image !== capturedCreative.image
                ? "saved image"
                : null;
      if (changedCreativePart) {
        throw new Error(
          "The creative changed while the website draft was being prepared. Review it and send again.",
        );
      }
      const next = await enqueueWebsitePublication(
        post.postId,
        finalDraft,
        expectedPostRevision,
      );
      persistWebsiteState(next.websiteDraft ?? finalDraft, next, creativePatch);
      setWebsiteCheckError(null);
      toast.success(
        next.status === "waiting_approval"
          ? "Final private website draft sent for manager approval."
          : "Final private draft sent to Customer Hub.",
      );
    } catch (err) {
      // If the POST response was lost—or another tab completed the exact
      // handoff—restore the durable status before offering another Send.
      let restored = false;
      try {
        const authoritative = await getWebsitePublication(post.postId);
        if (authoritative.status !== "not_requested") {
          // The status response carries the winning frozen draft. Never bind
          // this tab's submitted copy to a handoff another tab won.
          persistWebsiteState(
            authoritative.websiteDraft ?? websiteDraft,
            authoritative,
          );
          setWebsiteCheckError(null);
          toast.warning(
            err instanceof ApiError && err.code === "WEBSITE_DRAFT_ALREADY_SENT"
              ? "Another window already sent the final website draft. The sent copy and status were restored."
              : "The website handoff was already recorded. Its final copy and status were restored.",
          );
          restored = true;
        }
      } catch {
        // Preserve the original, more useful send error below.
      }
      if (!restored) {
        toast.error(toUiMessage(err, "The final website draft could not be sent."));
      }
    } finally {
      websiteSendingRef.current = false;
      setWebsiteSending(false);
    }
  }, [
    activeCaptionPlatform,
    bannedPhrases,
    currentDealer?.name,
    captionSetAnalysis.disclosures,
    deliveryGateMessage,
    deliveryLocked,
    editedText,
    effectivePack,
    flushPendingDraft,
    imageBusy,
    onPrepareFinalWebsiteDraft,
    post.image,
    post.postId,
    persistWebsiteState,
    primaryCaption,
    textBusy,
    toast,
    websiteDraft,
  ]);

  useEffect(() => {
    if (previousPostTextRef.current === post.text) return;
    previousPostTextRef.current = post.text;
    setPrimaryCaption(post.text);
    if (activeCaptionPlatform !== null) return;
    setEditedText(post.text);
    setTextHistory([post.text]);
    setHistoryIndex(0);
  }, [activeCaptionPlatform, post.text]);

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target;
      const isTyping =
        target instanceof HTMLElement &&
        (target.matches("input, textarea, select") || target.isContentEditable);
      if (isTyping || document.querySelector('[role="dialog"][aria-modal="true"]')) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === "y" || (e.key === "z" && e.shiftKey))
      ) {
        e.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [historyIndex, textHistory]);

  const handleTextChange = useCallback(
    (newText: string) => {
      setEditedText(newText);
      if (activeCaptionPlatform === null) setPrimaryCaption(newText);
      setHasCopiedCaption(false);
      // Add to history, removing any future history if we're not at the end
      const newHistory = textHistory.slice(0, historyIndex + 1);
      newHistory.push(newText);
      setTextHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
    },
    [activeCaptionPlatform, historyIndex, textHistory],
  );

  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setEditedText(textHistory[newIndex]);
      if (activeCaptionPlatform === null) {
        setPrimaryCaption(textHistory[newIndex]);
      }
      setHasCopiedCaption(false);
      triggerHapticFeedback();
    }
  }, [activeCaptionPlatform, historyIndex, textHistory]);

  const handleRedo = useCallback(() => {
    if (historyIndex < textHistory.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setEditedText(textHistory[newIndex]);
      if (activeCaptionPlatform === null) {
        setPrimaryCaption(textHistory[newIndex]);
      }
      setHasCopiedCaption(false);
      triggerHapticFeedback();
    }
  }, [activeCaptionPlatform, historyIndex, textHistory]);

  const adoptVideoUrl = useCallback((url: string | null) => {
    // Preview selection must not revoke a completed queue asset. The user can
    // switch video → photo → video without turning the retained URL into a
    // dead pointer. URLs are revoked only on explicit removal or unmount.
    if (url?.startsWith("blob:")) ownedVideoBlobUrlsRef.current.add(url);
    activeVideoBlobRef.current = url;
    setVideoUrl(url);
    setVideoPlayError(null);
    setIsVideoBuffering(Boolean(url));
    // New clips start muted so autoplay works; prompt user to unmute.
    setVideoMuted(true);
  }, []);

  useEffect(() => {
    if (!videoUrl) return;
    const activeJob = [...videoJobs].reverse().find((job) => job.url === videoUrl);
    if (
      !activeJob ||
      activeJob.sourceCreativeKey !== currentVideoCreativeKey ||
      (activeJob.aspectPreference !== "9:16" && activeJob.aspectPreference !== "16:9")
    ) {
      setManualVideoSelected(false);
      adoptVideoUrl(null);
      return;
    }
    if (manualVideoSelected) return;
    const matchingDelivery = deliveryPlan.deliveries.find(
      (delivery) =>
        delivery.mediaKind === "video" &&
        delivery.profile.preparation.kind === "veo" &&
        delivery.profile.preparation.nativeAspectRatio === activeJob.aspectPreference &&
        delivery.profile.preparation.resolution === activeJob.resolution &&
        delivery.profile.preparation.durationSeconds === activeJob.duration,
    );
    if (matchingDelivery && matchingDelivery.id !== selectedDeliveryId) {
      setSelectedDeliveryId(matchingDelivery.id);
    }
  }, [
    adoptVideoUrl,
    currentVideoCreativeKey,
    deliveryPlan.deliveries,
    manualVideoSelected,
    selectedDeliveryId,
    videoJobs,
    videoUrl,
  ]);

  // Unmount-only bulk cleanup. Selecting a different asset never destroys it.
  useEffect(() => {
    return () => {
      ownedVideoBlobUrlsRef.current.forEach((owned) => {
        try {
          URL.revokeObjectURL(owned);
        } catch {
          /* ignore */
        }
      });
      ownedVideoBlobUrlsRef.current.clear();
      activeVideoBlobRef.current = null;
    };
  }, []);

  useEffect(() => {
    const retained = new Set(
      videoJobs.map((job) => job.url).filter((url): url is string => Boolean(url)),
    );
    ownedVideoBlobUrlsRef.current.forEach((owned) => {
      if (retained.has(owned) || activeVideoBlobRef.current === owned) return;
      URL.revokeObjectURL(owned);
      ownedVideoBlobUrlsRef.current.delete(owned);
    });
  }, [videoJobs, videoUrl]);

  useEffect(() => {
    setHasSavedMedia(false);
  }, [videoUrl]);

  useEffect(() => {
    let active = true;
    setPreparedSave(null);
    setPreparedSaveForKey(null);
    setMediaPreparationError(null);
    const preparationKey = selectedPreparationKey;

    const selectedVideoUrl =
      !manualVideoSelected &&
      selectedDelivery?.mediaKind === "video" &&
      selectedVideoJob?.status === "completed"
        ? selectedVideoJob.url
        : undefined;
    if (
      !manualVideoSelected &&
      selectedDelivery?.mediaKind === "video" &&
      !selectedVideoUrl
    ) {
      setIsPreparingSave(false);
      return () => {
        active = false;
      };
    }

    setIsPreparingSave(true);
    void (async () => {
      const isVideo = manualVideoSelected
        ? Boolean(videoUrl)
        : selectedDelivery
          ? selectedDelivery.mediaKind === "video"
          : Boolean(videoUrl);
      const sourceUrl =
        !isVideo && activeImageFormat
          ? await renderFormatIfNeeded(post.image, activeImageFormat)
          : selectedVideoUrl || videoUrl || post.image;
      if (
        isVideo &&
        !manualVideoSelected &&
        selectedDelivery?.mediaKind === "video" &&
        selectedDelivery.profile.preparation.kind === "veo" &&
        selectedVideoUrl
      ) {
        await validateVideoMetadata(selectedVideoUrl, {
          width: selectedDelivery.profile.output.width,
          height: selectedDelivery.profile.output.height,
          durationSeconds: selectedDelivery.profile.preparation.durationSeconds,
        });
      }
      const basename = isVideo
        ? (!manualVideoSelected && selectedDelivery?.mediaKind === "video"
            ? selectedDelivery.filename.replace(/\.[^.]+$/, "")
            : undefined) || "dealer-social-video"
        : selectedDelivery?.filename.replace(/\.[^.]+$/, "") ||
          activeImageFormat?.filename.replace(/\.[^.]+$/, "") ||
          "dealer-social-post";
      return prepareMediaForSave({
        sourceUrl,
        kind: isVideo ? "video" : "image",
        basename,
      });
    })()
      .then((prepared) => {
        if (active) {
          setPreparedSave(prepared);
          setPreparedSaveForKey(preparationKey);
        }
      })
      .catch((err) => {
        if (!active) return;
        setPreparedSave(null);
        setPreparedSaveForKey(null);
        setMediaPreparationError(
          err instanceof Error
            ? err.message
            : "The exact platform file could not be prepared.",
        );
      })
      .finally(() => {
        if (active) setIsPreparingSave(false);
      });
    return () => {
      active = false;
    };
  }, [
    activeImageFormat,
    manualVideoSelected,
    post.image,
    mediaPreparationNonce,
    selectedDelivery,
    selectedPreparationKey,
    selectedVideoJob,
    videoUrl,
  ]);

  useEffect(() => {
    if (
      !activePreparedSave ||
      activePreparedSave.kind !== "image" ||
      videoUrl ||
      typeof URL.createObjectURL !== "function"
    ) {
      setFormattedPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(activePreparedSave.file);
    setFormattedPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [activePreparedSave, videoUrl]);

  const displayImageUrl = formattedPreviewUrl || post.image;

  const saveKind =
    manualVideoSelected && videoUrl
      ? "video"
      : selectedDelivery?.mediaKind === "video"
        ? "video"
        : "image";
  const saveToPhotos = isMobilePhotoDevice();
  const saveButtonLabel = saveToPhotos
    ? activeImageFormat && saveKind === "image"
      ? `Save ${activeImageFormat.width}×${activeImageFormat.height}`
      : "Save to Photos"
    : saveKind === "video"
      ? "Save video"
      : activeImageFormat
        ? `Save ${activeImageFormat.width}×${activeImageFormat.height}`
        : "Save image";
  const saveAriaLabel = (locked: boolean) =>
    locked ? `Save ${saveKind} (${deliveryLockLabel.toLowerCase()})` : saveButtonLabel;

  const handleSave = async (deliveryId?: string) => {
    triggerHapticFeedback();
    if (deliveryLocked) {
      toast.warning(deliveryGateMessage);
      return;
    }
    if (deliveryId && deliveryId !== selectedDeliveryId) {
      toast.warning("Select this output and wait until its exact file is ready.");
      return;
    }
    if (!activePreparedSave) {
      toast.warning(
        isPreparingSave
          ? "Media is still preparing. Try Save again in a moment."
          : "Media could not be prepared. Switch to another version or retry.",
      );
      return;
    }

    // WebKit consumes transient activation at the first asynchronous boundary.
    // The prepared File is ready already, so invoke navigator.share (inside this
    // helper) immediately from this click before starting this click's History
    // flush. A background autosave that began earlier may still be in flight,
    // but it is never awaited on the fresh user-activation path.
    const mediaSavePromise = savePreparedMediaToLibrary(activePreparedSave);
    const draftSavePromise = flushPendingDraft();
    const result = await mediaSavePromise;
    const draftSaved = await draftSavePromise;
    if (!draftSaved) {
      toast.warning(
        "The media is ready, but the latest History update did not save. You can continue or use Retry history save.",
      );
    }

    if (result.method === "cancelled") {
      toast.warning(saveResultToastMessage(result));
      return;
    }
    if (result.method === "error") {
      toast.error(saveResultToastMessage(result));
      return;
    }

    setHasSavedMedia(true);
    toast.success(saveResultToastMessage(result));

    if (!shouldReduceMotion) {
      confetti({
        particleCount: 70,
        spread: 64,
        origin: { y: 0.65 },
        colors: ["#1e40af", "#2563eb", "#60a5fa", "#16a34a"],
      });
    }
  };

  const synchronousCopy = (text: string): boolean => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed"; // Prevent scrolling to bottom of page in MS Edge.
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.opacity = "0";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    let success = false;
    try {
      success = document.execCommand("copy");
    } catch (err) {
      console.error("Fallback copy command failed", err);
    }
    document.body.removeChild(textArea);
    return success;
  };

  // The on-screen "caption" textarea never contains disclosures (they're
  // stored separately so the salesperson can't silently delete them). For
  // copy + share + download we always paste the caption + disclosure block
  // together so the dealer's actual social post is compliant.
  //
  const sourceCaptionForActive =
    activeCaptionPlatform && effectivePack?.[activeCaptionPlatform]
      ? effectivePack[activeCaptionPlatform]
      : post.text;
  const captionWasEdited = editedText !== sourceCaptionForActive;
  // Always derive the footer from the actual visible caption. Platform
  // variants and salesperson edits may advertise different terms.
  // The FTC team-member disclosure travels with every PublishContent as a
  // protected prefix, so destination character budgets truncate body copy
  // instead of the disclosure. Empty string when the dealership opted out.
  const employeeDisclosure = React.useMemo(
    () => buildEmployeeDisclosure(currentDealer),
    [currentDealer],
  );

  const activeDisclosures = captionAnalysis.disclosures.trim();
  const activeDisclosureCategories = captionAnalysis.disclosureCategories;
  const appendDisclosureText = (caption: string, disclosures: string): string => {
    const cap = caption.trim();
    const disclosureText = disclosures.trim();
    if (!disclosureText) return cap;
    return `${cap}\n\n${
      disclosureText.startsWith("— Disclosures —")
        ? disclosureText
        : `— Disclosures —\n${disclosureText}`
    }`;
  };
  const captionWithDisclosures = appendDisclosureText(editedText, activeDisclosures);

  // Persist textarea edits into the active pack slot so Share uses salesperson edits.
  useEffect(() => {
    if (!activeCaptionPlatform) return;
    const trimmed = editedText.trim();
    if (!trimmed) return;
    setPackOverrides((prev) => {
      if (prev[activeCaptionPlatform] === trimmed) return prev;
      return { ...prev, [activeCaptionPlatform]: trimmed };
    });
  }, [editedText, activeCaptionPlatform]);

  /** Re-scan every outgoing variant; one platform can trigger a different disclosure. */
  const sharePlatformCaptions = useMemo(() => {
    if (!effectivePack) return undefined;
    const out: Record<string, PlatformShareCaption> = {};
    for (const [id, cap] of Object.entries(effectivePack)) {
      // Active platform: use live editor text (includes in-progress edits)
      const base = id === activeCaptionPlatform ? editedText.trim() : cap?.trim();
      if (!base) continue;
      // The FTC team-member disclosure leads the caption; the dealership
      // mention trails it. Both are applied before the compliance scan so the
      // scanned text is exactly what the destination receives.
      const attributed = prependEmployeeDisclosure(
        appendDealershipMention(base, id, currentDealer),
        currentDealer,
      );
      const prepared = analyzeCaptionForDelivery(attributed, bannedPhrases);
      const identitySafe = customerIdentityIsSafe(prepared.caption);
      out[id] = {
        text: prepared.caption,
        disclosures: prepared.disclosures || undefined,
        blockedReason: !identitySafe
          ? identityGateMessage
          : prepared.compliance.prohibited.length > 0
            ? prohibitedClaimsMessage(prepared.compliance.prohibited)
            : undefined,
      };
    }
    if (out.instagram_feed && !out.instagram_reel) {
      out.instagram_reel = out.instagram_feed;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }, [
    activeCaptionPlatform,
    bannedPhrases,
    currentDealer,
    customerIdentityIsSafe,
    editedText,
    effectivePack,
    identityGateMessage,
  ]);

  const selectCaptionPlatform = useCallback(
    (platformId: string | null, withHaptic = true) => {
      // Flush current editor into pack before switching
      if (activeCaptionPlatform && editedText.trim()) {
        setPackOverrides((prev) => ({
          ...prev,
          [activeCaptionPlatform]: editedText.trim(),
        }));
      } else if (activeCaptionPlatform === null) {
        setPrimaryCaption(editedText);
      }
      const pack = { ...(post.platformCaptions || {}), ...packOverrides };
      const nextText =
        platformId && pack[platformId] ? pack[platformId] : primaryCaption;
      setActiveCaptionPlatform(platformId);
      setEditedText(nextText);
      setTextHistory([nextText]);
      setHistoryIndex(0);
      setHasCopiedCaption(false);
      if (withHaptic) triggerHapticFeedback();
    },
    [
      activeCaptionPlatform,
      editedText,
      packOverrides,
      primaryCaption,
      post.platformCaptions,
    ],
  );

  const handleCaptionTabKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
      const tabCount = platformCaptionTabs.length + 1;
      let nextIndex: number | null = null;

      if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabCount;
      if (event.key === "ArrowLeft") {
        nextIndex = (currentIndex - 1 + tabCount) % tabCount;
      }
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = tabCount - 1;
      if (nextIndex === null) return;

      event.preventDefault();
      const nextPlatformId =
        nextIndex === 0 ? null : platformCaptionTabs[nextIndex - 1]?.id || null;
      selectCaptionPlatform(nextPlatformId);
      requestAnimationFrame(() => captionTabRefs.current[nextIndex]?.focus());
    },
    [platformCaptionTabs, selectCaptionPlatform],
  );

  const activeCaptionTabIndex =
    activeCaptionPlatform === null
      ? 0
      : Math.max(
          0,
          platformCaptionTabs.findIndex(({ id }) => id === activeCaptionPlatform) + 1,
        );

  const handleCopy = async () => {
    triggerHapticFeedback();
    if (deliveryLocked) {
      toast.warning(deliveryGateMessage);
      return;
    }
    const draftSaved = await flushPendingDraft();
    if (!draftSaved) {
      toast.warning(
        "The caption can still be copied, but its latest History update did not save.",
      );
    }
    let success = false;
    const copyDestinationId =
      activeCaptionPlatform || selectedDelivery?.destinationId || post.platformIds?.[0];
    const attributedCaption = prependEmployeeDisclosure(
      copyDestinationId
        ? appendDealershipMention(editedText, copyDestinationId, currentDealer)
        : editedText,
      currentDealer,
    );
    const preparedCopy = analyzeCaptionForDelivery(attributedCaption, bannedPhrases);
    if (preparedCopy.compliance.prohibited.length > 0) {
      toast.warning(prohibitedClaimsMessage(preparedCopy.compliance.prohibited));
      return;
    }
    const textToCopy = appendDisclosureText(
      preparedCopy.caption,
      preparedCopy.disclosures,
    );
    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(textToCopy);
        success = true;
      } catch (err) {
        success = synchronousCopy(textToCopy);
      }
    } else {
      success = synchronousCopy(textToCopy);
    }

    if (success) {
      // The inline checkmark (2s) is enough acknowledgment for a routine copy.
      // Confetti is reserved for genuine completion moments (saving the post).
      setCopied(true);
      setHasCopiedCaption(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("Caption and disclosures copied.");
    } else {
      toast.error(
        "The caption could not be copied. Select the text and copy it manually.",
      );
    }
  };

  const handleOpenShare = async () => {
    triggerHapticFeedback();
    if (deliveryLocked) {
      toast.warning(deliveryGateMessage);
      return;
    }
    if (!manualVideoSelected && selectedDelivery) {
      await handleShareDelivery(selectedDelivery.id);
      return;
    }
    if (!manualVideoSelected || !videoUrl || !activePreparedSave) {
      toast.warning(
        selectedDelivery?.mediaKind === "video"
          ? "Create this exact video output before sharing it."
          : "Select a platform output and wait until its exact file is ready.",
      );
      return;
    }
    const draftSaved = await flushPendingDraft();
    if (!draftSaved) {
      toast.warning(
        "Sharing is available, but the latest History update did not save.",
      );
    }
    // A free-form legacy render is shareable through the device sheet, but it
    // is never mislabeled as an exact Facebook/Instagram/Google deliverable.
    setFocusedShareDeliveryId("native_share:manual");
    setFocusedShareContent({
      text: prependEmployeeDisclosure(editedText, currentDealer),
      disclosures: activeDisclosures || undefined,
      requiredPrefix: employeeDisclosure || undefined,
      videoUrl,
      preparedFile: activePreparedSave.file,
    });
    setIsShareDialogOpen(true);
  };

  const handleImageAction = async (
    action: () => Promise<void>,
    messages: string[] = ["Updating image…", "Polishing details…", "Almost there…"],
  ) => {
    if (contentEditingLocked) {
      toast.warning(
        websiteSending
          ? "Wait for the final website handoff to finish."
          : "This creative is locked and cannot be changed.",
      );
      return;
    }
    setIsImageLoading(true);
    setImageLoadingMessage(messages[0] || "Updating image…");
    setImageLoadingProgress(8);

    let messageIndex = 0;
    const intervalId = setInterval(() => {
      messageIndex = (messageIndex + 1) % messages.length;
      setImageLoadingMessage(messages[messageIndex] || "Working…");
      setImageLoadingProgress((prev) => Math.min(prev + 12, 90));
    }, 1200);

    try {
      const result = await action();
      setImageLoadingProgress(100);
      setImageLoadingMessage("Complete");
      await new Promise((resolve) => setTimeout(resolve, 220));
      return result;
    } finally {
      clearInterval(intervalId);
      setIsImageLoading(false);
      setImageLoadingProgress(0);
      setImageLoadingMessage("Updating image…");
    }
  };

  const handleTextAction = async (action: () => Promise<void>) => {
    if (contentEditingLocked) {
      toast.warning(
        websiteSending
          ? "Wait for the final website handoff to finish."
          : "This caption is locked and cannot be changed.",
      );
      return;
    }
    setIsTextLoading(true);
    try {
      await action();
    } finally {
      setIsTextLoading(false);
    }
  };

  const handleTextEditSubmit = async (prompt: string) => {
    const sourceText = editedText;
    let updatedText = "";
    await handleTextAction(async () => {
      updatedText = activeCaptionPlatform
        ? await onEditText(prompt, sourceText, activeCaptionPlatform)
        : await onEditText(prompt, sourceText);
    });
    if (updatedText) {
      handleTextChange(updatedText);
    }
    setIsTextEditing(false);
  };

  const startVideoJob = async (
    style: VideoStyle,
    options: VideoRequestOptions,
    existingJobId?: string,
  ) => {
    if (videoGenerationActiveRef.current) {
      toast.warning("A video is already rendering. Wait for it to finish first.");
      return;
    }
    videoGenerationActiveRef.current = true;
    setIsVideoLoading(true);

    const messages = [
      "Setting up the virtual studio…",
      "Directing the AI animator…",
      "Rendering motion on your delivery photo…",
      "Still working — AI video often takes 1–3 minutes…",
      "Almost there — keep this screen open…",
    ];
    let messageIndex = 0;
    let allowRotation = true;
    const startedAt = Date.now();
    const formatElapsed = () => {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      const m = Math.floor(s / 60);
      const r = s % 60;
      return m > 0 ? `${m}m ${r}s` : `${r}s`;
    };
    setVideoLoadingMessage(`${messages[messageIndex]} (${formatElapsed()})`);
    const intervalId = setInterval(() => {
      if (!allowRotation) return;
      // Advance copy every ~5s; always show elapsed so the wait feels tracked.
      if ((Date.now() - startedAt) % 5000 < 1100) {
        messageIndex = (messageIndex + 1) % messages.length;
      }
      setVideoLoadingMessage(`${messages[messageIndex]} (${formatElapsed()})`);
    }, 1000);

    videoJobSequenceRef.current += 1;
    const randomJobId =
      typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}-${videoJobSequenceRef.current}`;
    const jobId = existingJobId || `video-${randomJobId}`;
    if (!existingJobId) {
      setVideoJobs((prev) =>
        retainNewestVideoJobs([
          ...prev,
          {
            id: jobId,
            style,
            status: "queued" as const,
            duration: options.durationSeconds,
            soundtrack: options.soundtrack,
            aspectPreference: options.aspectPreference,
            resolution: options.resolution,
            pacing: options.pacing,
            createdAt: new Date().toISOString(),
            sourceCreativeKey: currentVideoCreativeKey,
          },
        ]),
      );
    }

    // Mark job as processing
    setVideoJobs((prev) =>
      prev.map((job) =>
        job.id === jobId ? { ...job, status: "processing", error: undefined } : job,
      ),
    );

    // The provider service owns bounded model/poll retries. Retrying the whole
    // request here could create multiple paid Veo jobs after a lost response.
    const maxAttempts = 1;
    const runAttempt = async (attempt: number): Promise<void> => {
      try {
        const url = await onGenerateVideo(style, options);
        // Always show the latest successful render (previous logic kept a
        // stale/null URL if something odd was already set).
        adoptVideoUrl(url);
        if (dealerId) {
          void archiveDealerMedia(dealerId, {
            kind: "video",
            source: url,
            label: `${style} video`,
          });
        }
        setVideoJobs((prev) =>
          prev.map((job) =>
            job.id === jobId ? { ...job, status: "completed", url } : job,
          ),
        );
        toast.success("Video ready — tap play if it does not start.");
        if (post.postId) {
          try {
            await markPostVideoGenerated(post.postId);
          } catch (_err) {
            // The paid render succeeded, so keep it usable. Be explicit that
            // only the history metric failed rather than misreporting the
            // whole generation as failed and tempting a costly retry.
            toast.warning(
              "Video created, but its history metric could not be updated.",
            );
          }
        }
      } catch (error) {
        const normalized = normalizeError(error);
        const retryDelay =
          attempt < maxAttempts && normalized.retryable ? attempt * 8000 : 0;
        const attemptMessage = `Attempt ${attempt} failed: ${normalized.message}`;

        if (retryDelay > 0) {
          allowRotation = false;
          setVideoLoadingMessage(
            `${attemptMessage}. Retrying in ${retryDelay / 1000}s...`,
          );
          setVideoJobs((prev) =>
            prev.map((job) =>
              job.id === jobId
                ? { ...job, status: "queued", error: attemptMessage }
                : job,
            ),
          );
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          allowRotation = true;
          setVideoLoadingMessage(messages[0]);
          messageIndex = 0;
          return runAttempt(attempt + 1);
        }

        const finalMessage = `${attemptMessage}. ${recoveryHint(normalized)}`;
        allowRotation = false;
        setVideoLoadingMessage(finalMessage);
        setVideoJobs((prev) =>
          prev.map((job) =>
            job.id === jobId ? { ...job, status: "failed", error: finalMessage } : job,
          ),
        );
        throw normalized;
      }
    };

    try {
      await runAttempt(1);
    } catch (err) {
      // Failure is already recorded in job state; no additional action needed here.
    } finally {
      videoGenerationActiveRef.current = false;
      setIsVideoLoading(false);
      clearInterval(intervalId);
    }
  };

  const handleGenerateVideo = async (
    style: VideoStyle,
    options: VideoRequestOptions,
  ) => {
    setManualVideoSelected(!videoDirectorDeliveryId);
    setIsVideoDirectorOpen(false);
    setVideoDirectorDeliveryId(null);
    await startVideoJob(style, options);
  };

  /**
   * Brand mode "Add video": the dealership motion signature, not an option
   * matrix. Spec §4.3 — 9:16 · 6s · 720p · music on, style bound to the Look.
   */
  const houseMotionOptions = useMemo((): VideoRequestOptions | null => {
    const motion = resolved.motion;
    if (!motion) return null;
    const aspect: VideoRequestOptions["aspectPreference"] =
      motion.aspects[0] === "16:9" ? "16:9" : "9:16";
    const soundtrack = (
      ["none", "celebration", "cinematic", "anthemic", "funk"] as const
    ).includes(motion.audio as VideoRequestOptions["soundtrack"])
      ? (motion.audio as VideoRequestOptions["soundtrack"])
      : "cinematic";
    return {
      durationSeconds: 6,
      soundtrack,
      aspectPreference: aspect,
      resolution: "720p",
      pacing: "cinematic",
    };
  }, [resolved.motion]);

  const handleAddHouseVideo = async () => {
    if (!resolved.motion || !houseMotionOptions) return;
    await handleGenerateVideo(resolved.motion.style, houseMotionOptions);
  };

  /**
   * Brand mode Playful: apply the one configured style with no catalogue, and
   * keep the house-style master beside the result instead of replacing it.
   */
  const handleApplyHousePlayful = async () => {
    const styleId = resolved.playfulStyleId;
    if (!styleId) {
      toast.warning(
        "No playful style is set for this dealership yet. A manager can choose one in Brand settings.",
      );
      return;
    }
    playfulPendingMasterRef.current = post.image;
    await handleImageAction(
      () => onFunMode(styleId),
      [
        "Applying your dealership's playful style…",
        "Keeping the real car and people intact…",
        "Finishing the second version…",
      ],
    ).catch(() => {
      playfulPendingMasterRef.current = null;
    });
  };

  /** Swap between the house-style master and its playful companion. */
  const selectPlayfulVersion = (url: string) => {
    if (url === post.image) return;
    triggerHapticFeedback();
    const store = useAppStore.getState();
    const current = store.generatedPost;
    store.setGeneratedPost({ ...(current || post), image: url });
  };

  const handleTryAnotherPhoto = async () => {
    if (brandModeOn) {
      if (photoRetryUsed) return;
      setPhotoRetryUsed(true);
    }
    await handleImageAction(onRegenerateImage, [
      "Refreshing with your chosen style...",
      "Balancing lighting and color...",
      "Finishing touches...",
    ]).catch(() => undefined);
  };

  const handleTryAnotherCaption = async () => {
    if (brandModeOn) {
      if (captionRetryUsed) return;
      setCaptionRetryUsed(true);
    }
    await handleTextAction(onRegenerateText).catch(() => undefined);
  };

  const handleRetryVideo = async (jobId: string) => {
    const job = videoJobs.find((j) => j.id === jobId);
    if (!job) return;
    const options: VideoRequestOptions = {
      durationSeconds: job.duration,
      soundtrack: job.soundtrack,
      aspectPreference: job.aspectPreference,
      resolution: job.resolution,
      pacing: job.pacing,
    };
    await startVideoJob(
      job.style,
      options,
      job.sourceCreativeKey === currentVideoCreativeKey ? jobId : undefined,
    );
  };

  const handleRemoveVideoJob = (jobId: string) => {
    const removed = videoJobs.find((job) => job.id === jobId);
    if (removed?.url && activeVideoBlobRef.current === removed.url) {
      adoptVideoUrl(null);
      setManualVideoSelected(false);
    }
    if (removed?.url?.startsWith("blob:")) {
      ownedVideoBlobUrlsRef.current.delete(removed.url);
      URL.revokeObjectURL(removed.url);
    }
    setVideoJobs((prev) => prev.filter((job) => job.id !== jobId));
  };

  const handleSelectDelivery = (deliveryId: string) => {
    const delivery = deliveriesById.get(deliveryId);
    if (!delivery) return;
    triggerHapticFeedback();
    setPreparedSave(null);
    setPreparedSaveForKey(null);
    setIsPreparingSave(delivery.mediaKind === "photo");
    setSelectedDeliveryId(deliveryId);
    setMediaPreparationError(null);
    setManualVideoSelected(false);
    if (delivery.mediaKind === "photo") {
      adoptVideoUrl(null);
      return;
    }
    const job = videoJobForDelivery(delivery);
    adoptVideoUrl(job?.status === "completed" && job.url ? job.url : null);
  };

  const handleSelectMobileDelivery = (deliveryId: string) => {
    const delivery = deliveriesById.get(deliveryId);
    if (!delivery) return;

    handleSelectDelivery(deliveryId);

    const destinationId =
      delivery.destinationId === "instagram_reel" &&
      !effectivePack?.instagram_reel &&
      effectivePack?.instagram_feed
        ? "instagram_feed"
        : delivery.destinationId;
    const nextCaptionPlatform = effectivePack?.[destinationId] ? destinationId : null;
    if (nextCaptionPlatform !== activeCaptionPlatform) {
      // The output selection already supplied haptic feedback. Keep the
      // destination-specific caption synchronized without buzzing twice.
      selectCaptionPlatform(nextCaptionPlatform, false);
    }
  };

  const handleShareDelivery = async (deliveryId: string) => {
    if (deliveryLocked) {
      toast.warning(deliveryGateMessage);
      return;
    }
    const delivery = deliveriesById.get(deliveryId);
    const expectedPreparationKey = delivery
      ? preparationKeyForDelivery(delivery)
      : null;
    if (
      !delivery ||
      deliveryId !== selectedDeliveryId ||
      manualVideoSelected ||
      preparedSaveForKey !== expectedPreparationKey ||
      !activePreparedSave
    ) {
      toast.warning("Select this output and wait until its exact file is ready.");
      return;
    }

    const captionVariant = sharePlatformCaptions?.[delivery.destinationId];
    if (
      captionVariant &&
      typeof captionVariant !== "string" &&
      captionVariant.blockedReason
    ) {
      toast.warning(captionVariant.blockedReason);
      return;
    }
    const baseCaption =
      typeof captionVariant === "string"
        ? captionVariant
        : captionVariant?.text || editedText;
    const caption = prependEmployeeDisclosure(
      appendDealershipMention(baseCaption, delivery.destinationId, currentDealer),
      currentDealer,
    );
    const disclosures =
      typeof captionVariant === "string"
        ? undefined
        : captionVariant?.disclosures || activeDisclosures || undefined;
    const job =
      delivery.mediaKind === "video" ? videoJobForDelivery(delivery) : undefined;
    if (delivery.mediaKind === "video" && (!job?.url || job.status !== "completed")) {
      toast.warning("Create this exact video output before sharing it.");
      return;
    }

    const draftSaved = await flushPendingDraft();
    if (!draftSaved) {
      toast.warning(
        "Sharing is available, but the latest History update did not save.",
      );
    }

    setFocusedShareDeliveryId(delivery.id);
    setFocusedShareContent({
      // `caption` already leads with the disclosure (prependEmployeeDisclosure
      // above); requiredPrefix marks it protected for the budget fitter.
      text: caption,
      disclosures,
      requiredPrefix: employeeDisclosure || undefined,
      preparedFile: activePreparedSave.file,
      ...(delivery.mediaKind === "video"
        ? { videoUrl: job?.url }
        : { imageDataUrl: formattedPreviewUrl || post.image }),
    });
    setIsShareDialogOpen(true);
  };

  const handleToggleBatchDelivery = (deliveryId: string, selected: boolean) => {
    if (
      !deliveriesById.has(deliveryId) ||
      (selected && !batchEligibleDeliveryIds.has(deliveryId))
    ) {
      return;
    }
    setBatchDeliveryIds((current) => {
      const next = new Set(current);
      if (selected) next.add(deliveryId);
      else next.delete(deliveryId);
      return next;
    });
  };

  const handleToggleAllBatchDeliveries = (selected: boolean) => {
    setBatchDeliveryIds(
      selected ? new Set<string>(batchEligibleDeliveryIds) : new Set(),
    );
  };

  const handleStartShareBatch = () => {
    if (deliveryLocked) {
      toast.warning(deliveryGateMessage);
      return;
    }

    const selectedDeliveries = deliveryPlan.deliveries.filter((delivery) =>
      batchDeliveryIds.has(delivery.id),
    );
    if (selectedDeliveries.length === 0) {
      toast.warning("Choose at least one platform file to share.");
      return;
    }

    const unavailableDelivery = selectedDeliveries.find(
      (delivery) => !batchEligibleDeliveryIds.has(delivery.id),
    );
    if (unavailableDelivery) {
      setBatchDeliveryIds((current) => {
        const next = new Set(current);
        next.delete(unavailableDelivery.id);
        return next;
      });
      toast.warning(
        `${unavailableDelivery.profile.destinationLabel} was removed from this share sequence because its exact file is not ready.`,
      );
      return;
    }

    const blockedCaption = selectedDeliveries.find((delivery) => {
      const variant = sharePlatformCaptions?.[delivery.destinationId];
      return variant && typeof variant !== "string" && Boolean(variant.blockedReason);
    });
    if (blockedCaption) {
      const variant = sharePlatformCaptions?.[blockedCaption.destinationId];
      toast.warning(
        typeof variant !== "string" && variant?.blockedReason
          ? variant.blockedReason
          : "A selected destination caption needs attention before sharing.",
      );
      handleSelectDelivery(blockedCaption.id);
      return;
    }

    const queue = selectedDeliveries.map((delivery) => delivery.id);
    shareQueueOpenedRef.current = null;
    setShareQueue(queue);
    setShareQueueIndex(0);
    setIsShareDialogOpen(false);
    setFocusedShareDeliveryId(null);
    setFocusedShareContent(null);
    const firstDelivery = deliveriesById.get(queue[0]);
    const firstPreparationKey = firstDelivery
      ? preparationKeyForDelivery(firstDelivery)
      : null;
    if (
      selectedDeliveryId !== queue[0] ||
      manualVideoSelected ||
      preparedSaveForKey !== firstPreparationKey
    ) {
      handleSelectDelivery(queue[0]);
    } else if (!activePreparedSave) {
      setMediaPreparationError(null);
      setMediaPreparationNonce((value) => value + 1);
    }
  };

  const handleCancelShareQueue = () => {
    setIsShareDialogOpen(false);
    setFocusedShareDeliveryId(null);
    setFocusedShareContent(null);
    setShareQueue([]);
    setShareQueueIndex(0);
    shareQueueOpenedRef.current = null;
  };

  const handleAdvanceShareQueue = () => {
    const nextIndex = shareQueueIndex + 1;
    setIsShareDialogOpen(false);
    setFocusedShareDeliveryId(null);
    setFocusedShareContent(null);

    if (nextIndex >= shareQueue.length) {
      setShareQueue([]);
      setShareQueueIndex(0);
      shareQueueOpenedRef.current = null;
      toast.success(
        "Share sequence finished — verify each post in its destination app.",
      );
      return;
    }

    const nextDeliveryId = shareQueue[nextIndex];
    setShareQueueIndex(nextIndex);
    handleSelectDelivery(nextDeliveryId);
  };

  const handleRetryDelivery = async (deliveryId: string) => {
    const delivery = deliveriesById.get(deliveryId);
    if (!delivery) return;
    if (delivery.mediaKind === "photo") {
      handleSelectDelivery(deliveryId);
      setMediaPreparationNonce((value) => value + 1);
      return;
    }
    if (creativeLockedForReview) {
      toast.warning(videoReviewLockMessage);
      return;
    }
    if (videoGenerationActiveRef.current || isVideoLoading) {
      toast.warning("A video is already rendering. Wait for it to finish first.");
      return;
    }
    const job = videoJobForDelivery(delivery);
    if (job?.status === "failed") {
      await handleRetryVideo(job.id);
      return;
    }
    if (delivery.profile.preparation.kind !== "veo") return;
    setSelectedDeliveryId(deliveryId);
    // Brand mode never opens the option matrix: render this destination's exact
    // file straight from the dealership motion signature.
    if (brandModeOn) {
      if (!resolved.motion || !resolved.videoAllowed) return;
      const preparation = delivery.profile.preparation;
      setManualVideoSelected(false);
      await startVideoJob(resolved.motion.style, {
        durationSeconds: preparation.durationSeconds,
        soundtrack: houseMotionOptions?.soundtrack ?? "cinematic",
        aspectPreference: preparation.nativeAspectRatio,
        resolution: preparation.resolution,
        pacing: "cinematic",
      });
      return;
    }
    setVideoDirectorDeliveryId(deliveryId);
    setIsVideoDirectorOpen(true);
  };

  const queuedDeliveryId = shareQueue[shareQueueIndex];
  const queuedDelivery = queuedDeliveryId
    ? deliveriesById.get(queuedDeliveryId)
    : undefined;
  useEffect(() => {
    if (
      !queuedDeliveryId ||
      isShareDialogOpen ||
      selectedDeliveryId !== queuedDeliveryId ||
      isPreparingSave ||
      !activePreparedSave
    ) {
      return;
    }
    const openKey = `${shareQueueIndex}:${queuedDeliveryId}`;
    if (shareQueueOpenedRef.current === openKey) return;
    shareQueueOpenedRef.current = openKey;
    void handleShareDelivery(queuedDeliveryId);
  }, [
    activePreparedSave,
    isPreparingSave,
    isShareDialogOpen,
    queuedDeliveryId,
    selectedDeliveryId,
    shareQueueIndex,
  ]);

  const deliveryOutputs = useMemo<PlatformDeliveryOutput[]>(
    () =>
      deliveryPlan.deliveries.map((delivery) => {
        const selected = delivery.id === selectedDeliveryId;
        const videoJob =
          delivery.mediaKind === "video" ? videoJobForDelivery(delivery) : undefined;
        let status: PlatformDeliveryOutput["status"] = selected
          ? activePreparedSave
            ? "ready"
            : "generating"
          : "available";

        if (delivery.mediaKind === "video") {
          status = !videoJob
            ? "pending"
            : videoJob.status === "completed"
              ? selected
                ? activePreparedSave
                  ? "ready"
                  : "generating"
                : "available"
              : videoJob.status === "failed"
                ? "failed"
                : "generating";
        }
        if (selected && !manualVideoSelected && isPreparingSave) {
          status = "generating";
        }
        if (selected && !manualVideoSelected && mediaPreparationError) {
          status = "failed";
        }

        return {
          id: delivery.id,
          platformLabel: delivery.profile.destinationLabel,
          mediaKind: delivery.mediaKind === "photo" ? "image" : "video",
          ratio: delivery.profile.output.aspectRatio,
          width: delivery.profile.output.width,
          height: delivery.profile.output.height,
          status,
          thumbnail:
            delivery.mediaKind === "video" && videoJob?.url ? videoJob.url : post.image,
          poster: delivery.mediaKind === "video" ? post.image : undefined,
          selected,
          batchSelected: batchDeliveryIds.has(delivery.id),
          batchEligible: batchEligibleDeliveryIds.has(delivery.id),
          actionsReady:
            selected &&
            !manualVideoSelected &&
            status === "ready" &&
            Boolean(activePreparedSave) &&
            !isPreparingSave,
          recoveryDisabled: delivery.mediaKind === "video" && creativeLockedForReview,
          recoveryDisabledReason:
            delivery.mediaKind === "video" && creativeLockedForReview
              ? videoReviewLockMessage
              : undefined,
        };
      }),
    [
      deliveryPlan.deliveries,
      isPreparingSave,
      manualVideoSelected,
      mediaPreparationError,
      post.image,
      activePreparedSave,
      batchDeliveryIds,
      batchEligibleDeliveryIds,
      creativeLockedForReview,
      selectedDeliveryId,
      videoReviewLockMessage,
      videoJobForDelivery,
    ],
  );

  const hasWorkAtRisk =
    !hasSavedMedia ||
    !hasCopiedCaption ||
    captionWasEdited ||
    imageEditPrompt.trim().length > 0 ||
    videoJobs.length > 0;

  const requestLeaveResult = (mode: "startOver" | "remix") => {
    triggerHapticFeedback();
    if (imageBusy || textBusy || websiteSending) {
      toast.warning(
        websiteSending
          ? "Wait for the final website handoff to finish before leaving this post."
          : mode === "remix"
            ? "Wait for the current update to finish before remixing this photo."
            : "Wait for the current update to finish before starting another post.",
      );
      return;
    }
    if (hasWorkAtRisk) {
      setLeaveConfirm(mode);
      return;
    }
    if (mode === "remix") onRemix();
    else onStartOver();
  };

  const handleCreateAnotherRequest = () => requestLeaveResult("startOver");
  const handleRemixRequest = () => requestLeaveResult("remix");
  const activePublishOutput =
    deliveryOutputs.find((output) => output.selected) ?? deliveryOutputs[0];
  const selectedFileTitle = historyReadOnly
    ? "Saved post"
    : manualVideoSelected && videoUrl
      ? "Video ready to review"
      : !activePublishOutput
        ? websiteDraft?.enabled
          ? websitePublication?.status === "not_requested"
            ? "Finish and send to website"
            : "Website draft status"
          : "Review your post"
        : activePublishOutput.status === "ready" && activePublishOutput.actionsReady
          ? "Ready to save and share"
          : activePublishOutput.status === "failed"
            ? "File needs attention"
            : activePublishOutput.status === "pending"
              ? "Create this video to continue"
              : "Preparing platform file";
  const publishTitle = imageReviewRequired
    ? "Image review required"
    : identityLocked
      ? "Customer name needs attention"
      : claimLocked
        ? "Caption claim needs attention"
        : releaseLocked
          ? "Photo release needs attention"
          : reviewRequired
            ? approvalStatus === "rejected"
              ? "Manager requested changes"
              : approvalStatus === "approved"
                ? selectedFileTitle
                : "Ready for manager review"
            : selectedFileTitle;
  const websiteMobileActionLabel =
    !post.postId && websiteDraft?.enabled
      ? "Not saved"
      : websitePublication?.status === "not_requested"
        ? websiteSending
          ? "Sending…"
          : "Send"
        : websitePublication?.status === "failed"
          ? websiteRetrying
            ? "Retrying…"
            : "Retry"
          : websiteReviewUrl
            ? "Review"
            : websitePublication?.status === "queued" ||
                websitePublication?.status === "delivering" ||
                websitePublication?.status === "retrying"
              ? "Queued"
              : "Website";
  const websiteMobileActionDisabled =
    !post.postId ||
    websiteSending ||
    websiteRetrying ||
    deliveryLocked ||
    imageBusy ||
    textBusy ||
    (websitePublication?.status !== "not_requested" &&
      websitePublication?.status !== "failed" &&
      !websiteReviewUrl);
  const handleWebsiteMobileAction = () => {
    if (websitePublication?.status === "not_requested") {
      void handleSendWebsiteDraft();
      return;
    }
    if (websitePublication?.status === "failed") {
      void handleRetryWebsite();
      return;
    }
    if (websiteReviewUrl && typeof window !== "undefined") {
      window.open(websiteReviewUrl, "_blank", "noopener,noreferrer");
    }
  };

  const confirmLeaveResult = () => {
    const mode = leaveConfirm;
    setLeaveConfirm(null);
    if (mode === "remix") onRemix();
    else if (mode === "startOver") onStartOver();
  };

  /**
   * Per-platform caption tabs. Brand mode moves this whole strip behind the
   * "Studio tools" disclosure; legacy mode keeps it on the caption surface.
   */
  const renderCaptionPlatformTabs = () => {
    if (platformCaptionTabs.length === 0) return null;
    return (
      <div
        className="mb-3 flex flex-wrap gap-2"
        role="tablist"
        aria-label="Platform captions"
      >
        <button
          ref={(node) => {
            captionTabRefs.current[0] = node;
          }}
          id="caption-platform-tab-0"
          type="button"
          role="tab"
          aria-selected={activeCaptionPlatform === null}
          aria-controls="caption-platform-panel"
          tabIndex={activeCaptionPlatform === null ? 0 : -1}
          onClick={() => selectCaptionPlatform(null)}
          onKeyDown={(event) => handleCaptionTabKeyDown(event, 0)}
          className={cn(
            "min-h-[40px] rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors",
            isDesktopLayout && "lg:min-h-9 lg:px-3 lg:py-1",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/70",
            activeCaptionPlatform === null
              ? "border-primary-400/50 bg-primary-500/20 text-primary-100"
              : "border-white/10 bg-white/[0.04] text-surface-300 hover:border-white/20 hover:bg-white/[0.08]",
          )}
        >
          Primary
        </button>
        {platformCaptionTabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(node) => {
              captionTabRefs.current[index + 1] = node;
            }}
            id={`caption-platform-tab-${index + 1}`}
            type="button"
            role="tab"
            aria-selected={activeCaptionPlatform === tab.id}
            aria-controls="caption-platform-panel"
            tabIndex={activeCaptionPlatform === tab.id ? 0 : -1}
            onClick={() => selectCaptionPlatform(tab.id)}
            onKeyDown={(event) => handleCaptionTabKeyDown(event, index + 1)}
            className={cn(
              "min-h-[40px] rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors",
              isDesktopLayout && "lg:min-h-9 lg:px-3 lg:py-1",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/70",
              activeCaptionPlatform === tab.id
                ? "border-primary-400/50 bg-primary-500/20 text-primary-100"
                : "border-white/10 bg-white/[0.04] text-surface-300 hover:border-white/20 hover:bg-white/[0.08]",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
    );
  };

  const renderMediaHistoryRail = (desktop = false, forceVisible = false) => {
    if (creativeLockedForReview) return null;

    const completedVideos = videoJobs.filter(
      (job) => job.url && job.sourceCreativeKey === currentVideoCreativeKey,
    );
    const mediaCount = 1 + imageVersions.length + completedVideos.length;
    if (!desktop && !forceVisible && mediaCount <= 1) return null;

    return (
      <section
        className={cn(
          "w-full rounded-xl border border-white/10 bg-surface-950/80 p-2.5 shadow-xl shadow-black/20 backdrop-blur-xl",
          desktop && "sticky bottom-3 z-20",
        )}
        aria-labelledby={desktop ? "media-history-heading" : undefined}
      >
        <div
          className={cn(
            "mb-2 flex items-center justify-between gap-2",
            desktop && "lg:mb-0 lg:grid lg:grid-cols-[8.5rem_minmax(0,1fr)_auto]",
          )}
        >
          <div className="min-w-0">
            <p
              id={desktop ? "media-history-heading" : undefined}
              className="text-xs font-semibold text-surface-100"
            >
              {desktop ? "Media history" : "Media tray"}
            </p>
            <p className="text-[10px] leading-relaxed text-surface-400">
              {desktop
                ? "Return to any photo or finished video."
                : "Photos and completed videos stay available while you work."}
            </p>
          </div>
          <div
            className={cn(
              "flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]",
              desktop && "lg:pb-0",
            )}
            aria-label={desktop ? "Generated media history" : "Generated media tray"}
          >
            <button
              type="button"
              onClick={() => {
                triggerHapticFeedback();
                setManualVideoSelected(false);
                setSelectedDeliveryId(
                  deliveryPlan.deliveries.find(
                    (delivery) => delivery.mediaKind === "photo",
                  )?.id || null,
                );
                adoptVideoUrl(null);
              }}
              className={cn(
                "relative shrink-0 overflow-hidden rounded-lg border bg-surface-950 ring-offset-2 ring-offset-surface-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400",
                desktop ? "h-[4.5rem] w-[5.5rem]" : "h-20 w-20",
                !videoUrl
                  ? "border-primary-300 ring-2 ring-primary-400/45"
                  : "border-white/15 hover:border-primary-400/60",
              )}
              aria-label="Show current generated photo"
              aria-current={!videoUrl ? "true" : undefined}
            >
              <img
                src={post.image}
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
              />
              <span className="absolute inset-x-0 bottom-0 bg-black/80 px-1 py-0.5 text-center text-[9px] font-semibold text-white">
                Current
              </span>
            </button>
            {imageVersions.map((url, i) => (
              <button
                key={`${i}-${url.slice(0, 24)}`}
                type="button"
                onClick={() => {
                  triggerHapticFeedback();
                  const current = post.image;
                  useAppStore.getState().setGeneratedPost({
                    ...post,
                    image: url,
                  });
                  setImageVersions((stack) => {
                    const rest = stack.filter((u) => u !== url);
                    return current ? [current, ...rest].slice(0, 5) : rest.slice(0, 5);
                  });
                }}
                className={cn(
                  "relative shrink-0 overflow-hidden rounded-lg border border-white/15 bg-surface-950 ring-offset-2 ring-offset-surface-900 hover:border-primary-400/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400",
                  desktop ? "h-[4.5rem] w-[5.5rem]" : "h-20 w-20",
                )}
                aria-label={`Restore previous image version ${i + 1}`}
              >
                <img
                  src={url}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
                <span className="absolute inset-x-0 bottom-0 bg-black/80 px-1 py-0.5 text-center text-[9px] font-semibold text-white">
                  Version {i + 1}
                </span>
              </button>
            ))}
            {completedVideos.map((job, index) => (
              <button
                key={`tray-${job.id}`}
                type="button"
                onClick={() => {
                  triggerHapticFeedback();
                  setManualVideoSelected(true);
                  adoptVideoUrl(job.url || null);
                }}
                className={cn(
                  "relative flex shrink-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-lg border bg-surface-900 px-2 text-center ring-offset-2 ring-offset-surface-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400",
                  desktop ? "h-[4.5rem] w-[6.25rem]" : "h-20 w-24",
                  videoUrl === job.url
                    ? "border-primary-300 ring-2 ring-primary-400/45"
                    : "border-white/15 hover:border-primary-400/60",
                )}
                aria-label={`Show ${job.style} video`}
                aria-current={videoUrl === job.url ? "true" : undefined}
              >
                <Film className="h-5 w-5 text-primary-300" aria-hidden="true" />
                <span className="line-clamp-1 text-[9px] font-semibold leading-tight text-surface-100">
                  {job.style}
                </span>
                <span className="text-[8px] uppercase tracking-wide text-surface-400">
                  Video {index + 1}
                </span>
              </button>
            ))}
          </div>
          <Badge variant="neutral" uppercase={false}>
            {mediaCount} {mediaCount === 1 ? "item" : "items"}
          </Badge>
        </div>
      </section>
    );
  };

  /**
   * Brand mode Playful (spec §4.2): the playful frame is a SECOND image shown
   * beside the house-style master, never a replacement. Either one can be made
   * the delivered creative with a single tap.
   */
  const renderPlayfulPair = () => {
    if (!playfulPair) return null;
    const options: Array<{ url: string; label: string; detail: string }> = [
      {
        url: playfulPair.master,
        label: "House style",
        detail: "Your dealership's signature look",
      },
      {
        url: playfulPair.playful,
        label: "Playful",
        detail: "Same photo, dealership playful style",
      },
    ];
    return (
      <section
        className="w-full rounded-xl border border-white/10 bg-surface-950/80 p-2.5"
        aria-label="Photo versions"
        data-testid="playful-pair"
      >
        <p className="mb-2 text-xs font-semibold text-surface-100">
          Two versions ready
        </p>
        <div className="flex gap-2">
          {options.map((option) => {
            const isActive = post.image === option.url;
            return (
              <button
                key={option.label}
                type="button"
                onClick={() => selectPlayfulVersion(option.url)}
                aria-label={`Use the ${option.label.toLowerCase()} version`}
                aria-current={isActive ? "true" : undefined}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-2 rounded-lg border p-1.5 text-left transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400",
                  isActive
                    ? "border-primary-300 bg-primary-500/10"
                    : "border-white/15 hover:border-primary-400/60",
                )}
              >
                <img
                  src={option.url}
                  alt=""
                  className="h-14 w-14 shrink-0 rounded-md object-cover"
                  loading="lazy"
                />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold text-surface-50">
                    {option.label}
                  </span>
                  <span className="block truncate text-[10px] text-surface-400">
                    {isActive ? "Currently selected" : option.detail}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>
    );
  };

  /**
   * Brand mode "Studio tools" (spec §8): the destination caption tabs, the
   * hashtag chip editor, and the media version tray live behind the disclosure
   * instead of sitting on the publish surface.
   */
  const renderBrandStudioExtras = () => (
    <div className="mt-2 space-y-3" data-testid="studio-tools-extras">
      {renderCaptionPlatformTabs()}
      {/* The caption editor itself stays on the publish surface; opening
          Studio tools reveals its hashtag chip mode in place rather than
          mounting a second editor here. */}
      {renderMediaHistoryRail(false, true)}
    </div>
  );

  const renderMobileFocusedMedia = () => (
    <div className="relative grid h-full min-h-0 w-full place-items-center overflow-hidden">
      {(isImageLoading || isVideoLoading) && (
        <BusyOverlay
          message={isVideoLoading ? videoLoadingMessage : imageLoadingMessage}
          progress={isVideoLoading ? undefined : imageLoadingProgress}
        />
      )}
      {videoUrl ? (
        <div className="w-full space-y-2 p-2 [@media(max-height:700px)]:flex [@media(max-height:700px)]:h-full [@media(max-height:700px)]:min-h-0 [@media(max-height:700px)]:flex-col [@media(max-height:700px)]:gap-1 [@media(max-height:700px)]:space-y-0 [@media(max-height:700px)]:p-1">
          {isVideoBuffering && !isVideoLoading && !videoPlayError ? (
            <div
              className="pointer-events-none absolute inset-0 z-[5] grid place-items-center bg-surface-950/45"
              role="status"
              aria-label="Loading video preview"
            >
              <Loader2
                className="h-8 w-8 animate-spin text-primary-300 motion-reduce:animate-none"
                aria-hidden="true"
              />
            </div>
          ) : null}
          <video
            ref={videoElRef}
            key={videoUrl}
            src={videoUrl}
            controls
            playsInline
            preload="auto"
            autoPlay={!shouldReduceMotion}
            loop={!shouldReduceMotion}
            muted={videoMuted}
            aria-label="Generated social media video preview"
            onLoadStart={() => setIsVideoBuffering(true)}
            onLoadedData={() => {
              setIsVideoBuffering(false);
              setVideoPlayError(null);
            }}
            onCanPlay={() => {
              setIsVideoBuffering(false);
              setVideoPlayError(null);
              const element = videoElRef.current;
              if (element && !shouldReduceMotion) {
                void element.play().catch(() => {
                  // Autoplay may be blocked; native controls stay available.
                });
              }
            }}
            onVolumeChange={(event) => {
              setVideoMuted(event.currentTarget.muted);
            }}
            onError={() => {
              setIsVideoBuffering(false);
              setVideoPlayError(
                "This video could not be played. Try Save video, or create it again.",
              );
            }}
            className="max-h-[62dvh] w-full rounded-xl bg-black object-contain [@media(max-height:700px)]:min-h-0 [@media(max-height:700px)]:flex-1 [@media(max-height:700px)]:max-h-full"
          />
          {videoMuted && !videoPlayError ? (
            <button
              type="button"
              onClick={() => {
                triggerHapticFeedback();
                const element = videoElRef.current;
                if (!element) return;
                element.muted = false;
                setVideoMuted(false);
                void element.play().catch(() => undefined);
              }}
              className="flex min-h-11 w-full items-center justify-center rounded-xl border border-primary-400/40 bg-primary-500/15 px-3 text-sm font-semibold text-primary-50"
            >
              Turn on sound
            </button>
          ) : null}
          {videoPlayError ? (
            <div
              className="space-y-2 rounded-xl border border-error-500/40 bg-error-500/10 p-3 text-xs text-error-100 [.theme-light_&]:text-error-800"
              role="alert"
            >
              <p>{videoPlayError}</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className="min-h-10 rounded-lg border border-white/15 bg-white/5 px-3 font-semibold text-surface-100"
                  onClick={() => {
                    const element = videoElRef.current;
                    if (!element || !videoUrl) return;
                    setVideoPlayError(null);
                    setIsVideoBuffering(true);
                    element.load();
                    void element.play().catch(() => setIsVideoBuffering(false));
                  }}
                >
                  Retry play
                </button>
                <button
                  type="button"
                  className="min-h-10 rounded-lg border border-white/15 bg-white/5 px-3 font-semibold text-surface-100"
                  onClick={() => {
                    setManualVideoSelected(false);
                    setSelectedDeliveryId(
                      deliveryPlan.deliveries.find(
                        (delivery) => delivery.mediaKind === "photo",
                      )?.id || null,
                    );
                    adoptVideoUrl(null);
                    setVideoPlayError(null);
                  }}
                >
                  Show photo
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                triggerHapticFeedback();
                const photoDelivery = deliveryPlan.deliveries.find(
                  (delivery) => delivery.mediaKind === "photo",
                );
                setManualVideoSelected(false);
                setSelectedDeliveryId(photoDelivery?.id || null);
                adoptVideoUrl(null);
              }}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.05] px-3 text-sm font-semibold text-surface-100"
            >
              <Camera className="h-4 w-4" aria-hidden="true" />
              Back to photos
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            triggerHapticFeedback();
            setIsPreviewOpen(true);
          }}
          className="relative mx-auto grid w-full place-items-center overflow-hidden rounded-xl bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 [@media(max-height:700px)]:!h-full [@media(max-height:700px)]:!w-auto [@media(max-height:700px)]:max-w-full"
          style={
            activeImageFormat
              ? {
                  width: "calc(100% - 0.75rem)",
                  aspectRatio: `${activeImageFormat.width} / ${activeImageFormat.height}`,
                  maxWidth: `min(100%, calc(62dvh * ${activeImageFormat.width} / ${activeImageFormat.height}))`,
                }
              : undefined
          }
          aria-label="Enlarge image"
        >
          <ProgressiveImage
            src={displayImageUrl}
            alt="Generated social media post"
            className="h-full w-full rounded-xl object-contain"
          />
          {selectedDelivery?.mediaKind === "video" ? (
            <span className="absolute inset-x-3 bottom-3 rounded-lg border border-white/15 bg-black/75 px-3 py-2 text-center text-xs font-semibold text-white backdrop-blur">
              Video poster · create this output to preview motion
            </span>
          ) : null}
        </button>
      )}
    </div>
  );

  return (
    <>
      <Suspense fallback={null}>
        <LazyImagePreviewModal
          isOpen={isPreviewOpen && !videoUrl}
          onClose={() => setIsPreviewOpen(false)}
          imageSrc={displayImageUrl}
        />
      </Suspense>

      <MultiFormatExportModal
        isOpen={isMultiFormatOpen && !deliveryLocked}
        onClose={() => setIsMultiFormatOpen(false)}
        sourceImageUrl={post.image}
        priorityFormatIds={exportPriorityFormatIds}
      />
      <ShareDialog
        isOpen={isShareDialogOpen && !deliveryLocked}
        onClose={
          shareQueue.length > 0
            ? handleCancelShareQueue
            : () => {
                setIsShareDialogOpen(false);
                setFocusedShareDeliveryId(null);
                setFocusedShareContent(null);
              }
        }
        content={
          focusedShareContent || {
            text: prependEmployeeDisclosure(editedText, currentDealer),
            disclosures: activeDisclosures || undefined,
            requiredPrefix: employeeDisclosure || undefined,
            imageDataUrl: post.image,
            videoUrl: videoUrl || undefined,
          }
        }
        platformCaptions={sharePlatformCaptions}
        selectedPlatformIds={
          focusedShareDeliveryId
            ? [
                deliveriesById.get(focusedShareDeliveryId)?.destinationId ||
                  "native_share",
              ]
            : post.platformIds
        }
        focusedTargetId={
          focusedShareDeliveryId
            ? deliveriesById.get(focusedShareDeliveryId)?.destinationId
            : undefined
        }
        dealershipMention={
          focusedShareDeliveryId
            ? dealershipMentionFor(
                deliveriesById.get(focusedShareDeliveryId)?.destinationId || "",
                currentDealer,
              )
            : undefined
        }
        queueProgress={
          shareQueue.length > 0
            ? {
                current: shareQueueIndex + 1,
                total: shareQueue.length,
                nextLabel: shareQueue[shareQueueIndex + 1]
                  ? deliveriesById.get(shareQueue[shareQueueIndex + 1])?.profile
                      .destinationLabel
                  : undefined,
              }
            : undefined
        }
        onQueueAdvance={shareQueue.length > 0 ? handleAdvanceShareQueue : undefined}
      />
      <Modal
        isOpen={leaveConfirm !== null}
        onClose={() => setLeaveConfirm(null)}
        size="sm"
        title={leaveConfirm === "remix" ? "Remix this photo?" : "Create another post?"}
        description="This result is not fully preserved yet."
        footer={
          <>
            <Button variant="outline" onClick={() => setLeaveConfirm(null)} fullWidth>
              Keep editing
            </Button>
            <Button variant="danger" onClick={confirmLeaveResult} fullWidth>
              Discard and continue
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-surface-300">
          {leaveConfirm === "remix"
            ? "Save the media and copy the caption first if you want to keep both. Remixing keeps this photo and returns you to style setup with a fresh result."
            : "Save the media and copy the caption first if you want to keep both. Starting another post replaces this workspace."}
        </p>
      </Modal>
      {onGenerateCaptionVariant && (
        <CaptionAlternativesModal
          isOpen={
            isCaptionAltsOpen &&
            !contentEditingLocked &&
            !historyReadOnly &&
            hasOriginalCapture
          }
          onClose={() => setIsCaptionAltsOpen(false)}
          generateOne={onGenerateCaptionVariant}
          bannedPhrases={bannedPhrases}
          onSelect={({ text }) => {
            handleTextChange(text);
          }}
        />
      )}

      <Suspense fallback={null}>
        <LazyEditTextModal
          isOpen={
            isTextEditing &&
            !contentEditingLocked &&
            !historyReadOnly &&
            (!brandModeOn || resolved.freeTextEditAllowed)
          }
          onClose={() => setIsTextEditing(false)}
          onSubmit={handleTextEditSubmit}
          originalText={editedText}
          isLoading={isTextLoading}
        />
      </Suspense>
      <Suspense fallback={null}>
        <LazyVideoDirectorModal
          isOpen={isVideoDirectorOpen && !brandModeOn && !creativeLockedForReview}
          onClose={() => {
            setIsVideoDirectorOpen(false);
            setVideoDirectorDeliveryId(null);
          }}
          onSelectStyle={handleGenerateVideo}
          defaultAspect={
            post.imageAspectRatio === "9:16" || post.imageAspectRatio === "4:5"
              ? "9:16"
              : "16:9"
          }
          lockedAspect={(() => {
            const delivery = videoDirectorDeliveryId
              ? deliveriesById.get(videoDirectorDeliveryId)
              : undefined;
            return delivery?.profile.preparation.kind === "veo"
              ? delivery.profile.preparation.nativeAspectRatio
              : undefined;
          })()}
          deliveryLabel={
            videoDirectorDeliveryId
              ? deliveriesById.get(videoDirectorDeliveryId)?.profile.destinationLabel
              : undefined
          }
          isSubmitting={isVideoLoading}
        />
        <ScheduleDialog
          isOpen={isScheduleOpen && !historyReadOnly}
          onClose={() => setIsScheduleOpen(false)}
          isLoading={isScheduling}
          onSchedule={async (isoString) => {
            if (post.postId) {
              setIsScheduling(true);
              try {
                await schedulePost(post.postId, isoString);
                toast.success(
                  "Share time saved for " + new Date(isoString).toLocaleString(),
                );
                setIsScheduleOpen(false);
              } catch (err) {
                toast.error(toUiMessage(err, "Could not save that share time."));
              } finally {
                setIsScheduling(false);
              }
            } else {
              // Without a saved post there is nothing to attach the time to, so
              // the request never happens. Reporting success here told the
              // salesperson their post was handled when nothing was stored.
              setIsScheduleOpen(false);
              toast.warning("Save this post first, then plan a share time.");
            }
          }}
        />
      </Suspense>
      <Suspense fallback={null}>
        <LazyFunModeDirectorModal
          isOpen={
            isFunModeDirectorOpen &&
            !brandModeOn &&
            !contentEditingLocked &&
            hasOriginalCapture
          }
          onClose={() => setIsFunModeDirectorOpen(false)}
          enabledFunStyles={enabledFunStyles}
          onSelectStyle={(styleName) => {
            setIsFunModeDirectorOpen(false);
            handleImageAction(
              () => onFunMode(styleName),
              [
                "Queuing fun mode style…",
                "Illustrating with your photo reference…",
                "Polishing colors and details…",
              ],
            );
          }}
        />
      </Suspense>
      <m.section
        className={cn(
          "mx-auto w-full max-w-screen-2xl flex-1 space-y-4 px-0 py-3 sm:space-y-5 sm:px-2 sm:py-5 md:px-4 md:py-6",
          !isDesktopLayout && "pb-20",
        )}
        initial={shouldReduceMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: shouldReduceMotion ? 0 : 0.3 }}
        aria-busy={imageBusy || textBusy}
        style={
          isDesktopLayout
            ? {
                paddingTop: "0.75rem",
                paddingBottom: "1rem",
              }
            : {
                // The portaled footer is 60px plus the iPhone home-indicator
                // inset. Reserve that inset as well so the final control can
                // always scroll completely above the fixed bar.
                paddingBottom: "calc(5rem + env(safe-area-inset-bottom))",
              }
        }
      >
        {isDesktopLayout ? <h2 className="sr-only">{publishTitle}</h2> : null}
        {isDesktopLayout ? (
          <nav
            className="flex items-center gap-4 rounded-xl border border-white/[0.08] bg-surface-950/35 px-4 py-2.5"
            aria-label="Publishing progress"
          >
            <ol className="grid min-w-0 flex-1 grid-cols-3" role="list">
              {[
                {
                  label: "Destinations",
                  detail: `${deliveryPlan.deliveries.length} output${deliveryPlan.deliveries.length === 1 ? "" : "s"} selected`,
                },
                {
                  label: "Create outputs",
                  detail:
                    deliveryOutputs.length > 0 &&
                    deliveryOutputs.every(
                      (output) =>
                        output.status === "ready" || output.status === "available",
                    )
                      ? "Files prepared"
                      : "Review file status",
                },
                {
                  label: "Save & share",
                  detail: "Review, save, and publish",
                },
              ].map((step, index) => {
                const active = index === 2;
                return (
                  <li
                    key={step.label}
                    className={cn("relative min-w-0 pr-4", index > 0 && "pl-5")}
                    aria-current={active ? "step" : undefined}
                  >
                    {index > 0 ? (
                      <span
                        className="absolute left-0 top-3 h-px w-4 -translate-y-1/2 bg-primary-400/55"
                        aria-hidden="true"
                      />
                    ) : null}
                    <div className="flex min-w-0 items-start gap-2.5">
                      <span
                        className={cn(
                          "grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[11px] font-bold",
                          active
                            ? "border-primary-300 bg-primary-500 text-white shadow-[0_0_18px_rgba(59,130,246,0.3)]"
                            : "border-primary-400/45 bg-primary-500/15 text-primary-200",
                        )}
                        aria-hidden="true"
                      >
                        {active ? index + 1 : <Check className="h-3.5 w-3.5" />}
                      </span>
                      <span className="min-w-0">
                        <span
                          className={cn(
                            "block truncate text-xs font-semibold",
                            active ? "text-surface-50" : "text-surface-200",
                          )}
                        >
                          {step.label}
                        </span>
                        <span className="mt-0.5 block truncate text-[10px] text-surface-400">
                          {step.detail}
                        </span>
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>
            <div
              className="flex shrink-0 items-center gap-2 border-l border-white/10 pl-4"
              aria-label="Workspace actions"
            >
              {hasOriginalCapture ? (
                <button
                  type="button"
                  onClick={handleRemixRequest}
                  className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-primary-400/35 bg-primary-500/10 px-3 text-xs font-semibold text-primary-100 transition-colors hover:border-primary-400/55 hover:bg-primary-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/70"
                >
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  Remix
                </button>
              ) : null}
              <button
                type="button"
                onClick={handleCreateAnotherRequest}
                className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-surface-200 transition-colors hover:border-white/20 hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/70"
              >
                <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                New photo
              </button>
            </div>
          </nav>
        ) : null}
        {post.isBasicFallback || post.captionSource === "basic_fallback" ? (
          <m.div
            className="mx-auto flex max-w-3xl flex-col gap-3 rounded-2xl border border-warning-500/30 bg-warning-500/10 px-4 py-4 text-warning-100 shadow-lg shadow-black/10 sm:flex-row sm:items-center"
            initial={shouldReduceMotion ? false : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.25 }}
            role="status"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">Basic caption used</p>
                <Badge variant="warning" uppercase={false}>
                  AI was unavailable
                </Badge>
              </div>
              <p className="mt-1 text-sm leading-relaxed text-warning-100/80">
                Your post is safe to use, but this caption came from a basic template.
                Try AI again when the connection is ready.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="min-h-11 shrink-0 border-warning-300/30 text-warning-50"
              disabled={textBusy || contentEditingLocked || !hasOriginalCapture}
              title={!hasOriginalCapture ? originalRequiredMessage : undefined}
              leftIcon={
                textBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )
              }
              onClick={() =>
                void handleTextAction(onRegenerateText).catch(() => undefined)
              }
            >
              Try AI again
            </Button>
          </m.div>
        ) : null}
        {imageReviewRequired && (
          <m.div
            className="mx-auto flex max-w-3xl gap-3 rounded-2xl border border-error-500/30 bg-error-500/10 px-4 py-4 text-error-100 shadow-lg shadow-black/10 [.theme-light_&]:text-error-800"
            initial={shouldReduceMotion ? false : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.25 }}
            role="alert"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-current/20 bg-black/10">
              <AlertCircle className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">Image safety review required</p>
                <Badge variant="error" uppercase={false}>
                  Delivery locked
                </Badge>
              </div>
              <p className="mt-1 text-sm leading-relaxed opacity-80">
                {imageReviewGateMessage}
              </p>
            </div>
          </m.div>
        )}
        {identityLocked && (
          <m.div
            id="caption-identity-alert"
            className="mx-auto flex max-w-3xl gap-3 rounded-2xl border border-error-500/30 bg-error-500/10 px-4 py-4 text-error-100 shadow-lg shadow-black/10 [.theme-light_&]:text-error-800"
            initial={shouldReduceMotion ? false : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.25 }}
            role="alert"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-current/20 bg-black/10">
              <AlertCircle className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">Customer name blocked</p>
                <Badge variant="error" uppercase={false}>
                  Delivery locked
                </Badge>
              </div>
              <p className="mt-1 text-sm leading-relaxed opacity-80">
                {identityGateMessage}
              </p>
            </div>
          </m.div>
        )}
        {claimLocked && (
          <m.div
            id="caption-compliance-alert"
            className="mx-auto flex max-w-3xl gap-3 rounded-2xl border border-error-500/30 bg-error-500/10 px-4 py-4 text-error-100 shadow-lg shadow-black/10 [.theme-light_&]:text-error-800"
            initial={shouldReduceMotion ? false : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.25 }}
            role="alert"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-current/20 bg-black/10">
              <AlertCircle className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">Caption claim blocked</p>
                <Badge variant="error" uppercase={false}>
                  Delivery locked
                </Badge>
              </div>
              <p className="mt-1 text-sm leading-relaxed opacity-80">
                {claimGateMessage}
              </p>
            </div>
          </m.div>
        )}
        {releaseLocked && (
          <m.div
            className="mx-auto flex max-w-3xl gap-3 rounded-2xl border border-error-500/30 bg-error-500/10 px-4 py-4 text-error-100 shadow-lg shadow-black/10 [.theme-light_&]:text-error-800"
            initial={shouldReduceMotion ? false : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.25 }}
            role="alert"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-current/20 bg-black/10">
              <AlertCircle className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{releaseGateTitle}</p>
                <Badge variant="error" uppercase={false}>
                  Delivery locked
                </Badge>
              </div>
              <p className="mt-1 text-sm leading-relaxed opacity-80">
                {releaseGateMessage}
              </p>
              {releaseLinkRepairable ? (
                <div className="mt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11"
                    disabled={releaseRetrying}
                    leftIcon={
                      releaseRetrying ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )
                    }
                    onClick={() => void retryReleaseLink("manual")}
                  >
                    {releaseRetrying ? "Saving release…" : "Retry saving release"}
                  </Button>
                  {releaseRetryNotice ? (
                    <p
                      className="mt-2 text-sm leading-relaxed opacity-80"
                      aria-live="polite"
                    >
                      {releaseRetryNotice}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </m.div>
        )}
        {reviewRequired && (
          <m.div
            className={cn(
              "mx-auto flex max-w-3xl flex-col gap-3 rounded-2xl px-4 py-4 shadow-lg shadow-black/10 sm:flex-row sm:items-start",
              approvalStatus === "approved"
                ? "border border-success-500/30 bg-success-500/10 text-success-100"
                : approvalStatus === "pending"
                  ? "border border-warning-500/30 bg-warning-500/10 text-warning-100"
                  : "border border-error-500/30 bg-error-500/10 text-error-100 [.theme-light_&]:text-error-800",
            )}
            initial={shouldReduceMotion ? false : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.25 }}
            role="status"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-current/20 bg-black/10">
              {approvalStatus === "approved" ? (
                <CircleCheck className="h-5 w-5" />
              ) : (
                <AlertCircle className="h-5 w-5" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">
                  {approvalStatus === "approved"
                    ? "Manager approved"
                    : approvalStatus === "rejected"
                      ? "Manager rejected"
                      : approvalStatus === "submission_failed"
                        ? "Approval submission failed"
                        : "Manager approval pending"}
                </p>
                <Badge
                  variant={
                    approvalStatus === "approved"
                      ? "success"
                      : approvalStatus === "pending"
                        ? "warning"
                        : "error"
                  }
                  uppercase={false}
                >
                  {approvalStatus === "approved"
                    ? "Delivery unlocked"
                    : "Save and share locked"}
                </Badge>
              </div>
              <p className="mt-1 text-sm leading-relaxed opacity-80">
                {approvalGateMessage}
              </p>
              {approvalCheckError ? (
                <p className="mt-2 text-xs font-medium opacity-75">
                  {approvalCheckError}
                </p>
              ) : null}
            </div>
          </m.div>
        )}
        {websiteDraft?.enabled ? (
          <m.div
            className={cn(
              "relative mx-auto flex min-h-14 w-full max-w-3xl items-center gap-2 rounded-xl border px-2.5 py-2 shadow-lg shadow-black/10 sm:px-3",
              websiteStatusCopy.tone === "success"
                ? "border-success-500/30 bg-success-500/10 text-success-100"
                : websiteStatusCopy.tone === "warning"
                  ? "border-warning-500/30 bg-warning-500/10 text-warning-100"
                  : websiteStatusCopy.tone === "error"
                    ? "border-error-500/30 bg-error-500/10 text-error-100 [.theme-light_&]:text-error-800"
                    : websiteStatusCopy.tone === "info"
                      ? "border-info-500/30 bg-info-500/10 text-info-100"
                      : "border-white/10 bg-white/[0.04] text-surface-100",
            )}
            initial={shouldReduceMotion ? false : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.25 }}
            role={
              websitePublication?.status === "failed" ||
              (websitePublication?.status === "draft_ready" &&
                websitePublication.lastError)
                ? "alert"
                : "status"
            }
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-current/20 bg-black/10">
              <Globe2 className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              {/* Wrap rather than clip: these strings were being cut mid-word
                  ("Website draft was not s…"), which reads as a rendering bug
                  and hides the part that says what to do next. */}
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <p className="truncate text-sm font-semibold">
                  {websiteStatusCopy.title}
                </p>
                <Badge
                  className="hidden shrink-0 min-[390px]:inline-flex"
                  variant={websiteStatusCopy.tone}
                  uppercase={false}
                >
                  Private draft
                </Badge>
              </div>
              <p className="truncate text-[11px] leading-snug opacity-75 sm:text-xs">
                {websiteStatusCopy.detail}
              </p>
            </div>
            {websiteDraft.privacyFlags?.length || websiteCheckError ? (
              <details className="group shrink-0">
                <summary
                  className="grid h-11 w-11 cursor-pointer list-none place-items-center rounded-lg border border-current/20 bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 [&::-webkit-details-marker]:hidden"
                  aria-label="Website privacy review details"
                >
                  <AlertCircle className="h-4 w-4" aria-hidden="true" />
                </summary>
                <div className="absolute right-0 top-full z-40 mt-2 w-[min(18rem,calc(100vw-2rem))] rounded-xl border border-white/15 bg-surface-950 p-3 text-left text-xs leading-relaxed text-surface-200 shadow-2xl shadow-black/50">
                  {websiteDraft.privacyFlags?.length ? (
                    <p>
                      Review the entire image for:{" "}
                      {websiteDraft.privacyFlags
                        .map((flag) => websitePrivacyFlagCopy[flag])
                        .filter(Boolean)
                        .join("; ")}
                      .
                    </p>
                  ) : null}
                  {websiteCheckError ? (
                    <p className="mt-2 text-warning-200">{websiteCheckError}</p>
                  ) : null}
                </div>
              </details>
            ) : null}
            <div className="flex shrink-0 items-center gap-1.5">
              {isDesktopLayout &&
              websitePublication?.status === "not_requested" &&
              post.postId ? (
                <Button
                  variant="primary"
                  size="sm"
                  className="min-h-11 px-3"
                  disabled={websiteSending || deliveryLocked || imageBusy || textBusy}
                  leftIcon={
                    websiteSending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Globe2 className="h-3.5 w-3.5" />
                    )
                  }
                  onClick={() => void handleSendWebsiteDraft()}
                >
                  {websiteSending ? "Sending…" : "Send"}
                </Button>
              ) : null}
              {websiteReviewUrl && (isDesktopLayout || !websiteOnly) ? (
                <a
                  href={websiteReviewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-current/25 bg-black/10 px-3 py-2 text-xs font-semibold transition-colors hover:bg-black/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/70"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  Review
                </a>
              ) : null}
              {(websitePublication?.status === "failed" ||
                (websitePublication?.status === "draft_ready" &&
                  websitePublication.lastError)) &&
              post.postId &&
              (isDesktopLayout || !websiteOnly) &&
              (isDesktopLayout || !websiteReviewUrl) ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11"
                  disabled={websiteRetrying}
                  leftIcon={
                    websiteRetrying ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )
                  }
                  onClick={() => void handleRetryWebsite()}
                >
                  {websiteRetrying
                    ? "Retrying…"
                    : websitePublication.status === "draft_ready"
                      ? "Retry status"
                      : "Retry"}
                </Button>
              ) : null}
            </div>
          </m.div>
        ) : null}
        {error && (
          <m.div
            className="mb-4 bg-error-900/50 border border-error-700 text-error-300 px-4 py-3 rounded-xl flex items-center justify-center gap-2 backdrop-blur-sm"
            initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.3 }}
            role="alert"
          >
            <AlertCircle className="w-5 h-5" aria-hidden="true" />
            <span>{error}</span>
          </m.div>
        )}
        {!isDesktopLayout ? (
          <MobilePublishStudio
            outputs={deliveryOutputs}
            title={publishTitle}
            mediaPreview={renderMobileFocusedMedia()}
            caption={captionWithDisclosures}
            postingAs={currentPersonName || undefined}
            captionNote={
              historyReadOnly
                ? "View-only history. You can still copy or share this saved post."
                : websiteOnly
                  ? "Keep editing. Customer Hub receives nothing until you press Send."
                  : selectedDelivery &&
                      dealershipMentionFor(
                        selectedDelivery.destinationId,
                        currentDealer,
                      )
                    ? "Dealership tag and required disclosures are included when you share."
                    : activeDisclosures
                      ? "Required disclosures are included when you copy or share."
                      : "The exact destination caption is included when you share."
            }
            copied={copied}
            onSelect={handleSelectMobileDelivery}
            onRetry={handleRetryDelivery}
            onToggleBatch={
              deliveryOutputs.length > 0 ? handleToggleBatchDelivery : undefined
            }
            onToggleAll={
              deliveryOutputs.length > 0 ? handleToggleAllBatchDeliveries : undefined
            }
            onShareBatch={
              deliveryOutputs.length > 0 ? handleStartShareBatch : undefined
            }
            onCopyCaption={handleCopy}
            onEditCaption={
              brandModeOn && !resolved.freeTextEditAllowed
                ? undefined
                : () => setIsTextEditing(true)
            }
            onBack={handleCreateAnotherRequest}
            onRemix={hasOriginalCapture ? handleRemixRequest : undefined}
            onShowSettings={onShowSettings}
            onShowHistory={onShowHistory}
            onRequestLogout={onRequestLogout}
            actionsDisabled={deliveryLocked}
            recoveryDisabled={isVideoLoading}
            batchActionDisabled={
              deliveryLocked || isVideoLoading || shareQueue.length > 0
            }
            copyCaptionDisabled={deliveryLocked}
            editCaptionDisabled={
              textBusy || contentEditingLocked || historyReadOnly || !hasOriginalCapture
            }
            emptyStatusLabel={websiteOnly ? "Editing" : undefined}
            emptyStatusDetail={
              websiteOnly
                ? "Finish the image and caption, then send the private draft."
                : undefined
            }
            emptyMetadata={websiteOnly ? "Private website draft" : undefined}
          />
        ) : null}
        <div
          className={cn(
            "grid w-full grid-cols-1 items-start gap-4",
            isDesktopLayout && "grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.9fr)]",
          )}
        >
          <aside
            className={cn(
              "min-w-0 space-y-3",
              isDesktopLayout &&
                "sticky top-4 col-start-2 row-start-1 max-h-[calc(100dvh-2rem)] overflow-y-auto pr-0.5 [scrollbar-width:thin]",
              !isDesktopLayout &&
                (shareQueue.length === 0 || isShareDialogOpen) &&
                deliveryPlan.unsupported.length === 0 &&
                deliveryPlan.unknown.length === 0 &&
                "hidden",
            )}
            aria-label="Platform delivery workspace"
          >
            {isDesktopLayout ? (
              <PlatformDeliveryBoard
                className="w-full"
                outputs={deliveryOutputs}
                onSelect={handleSelectDelivery}
                onSave={handleSave}
                onShare={handleShareDelivery}
                onRetry={handleRetryDelivery}
                onToggleBatch={handleToggleBatchDelivery}
                onToggleAll={handleToggleAllBatchDeliveries}
                onShareBatch={handleStartShareBatch}
                actionsDisabled={deliveryLocked}
                recoveryDisabled={isVideoLoading}
                batchActionDisabled={
                  deliveryLocked || isVideoLoading || shareQueue.length > 0
                }
                compact
                description={
                  post.mediaOutputMode === "both"
                    ? "Photo and video versions are separated by destination. Select a row, wait for Ready, then save or share that exact file."
                    : "Select a destination output, wait for Ready, then save or share its exact file."
                }
              />
            ) : null}
            {shareQueue.length > 0 && !isShareDialogOpen ? (
              <div
                className={cn(
                  "w-full rounded-xl border px-4 py-3",
                  mediaPreparationError
                    ? "border-error-500/35 bg-error-500/10"
                    : "border-primary-400/30 bg-primary-500/10",
                )}
                role={mediaPreparationError ? "alert" : "status"}
                aria-live="polite"
              >
                <div className="flex flex-col gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-surface-50">
                      {mediaPreparationError
                        ? `Could not prepare ${queuedDelivery?.profile.destinationLabel || "this output"}`
                        : `Preparing ${queuedDelivery?.profile.destinationLabel || "selected output"} · ${shareQueueIndex + 1} of ${shareQueue.length}`}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-surface-300">
                      {mediaPreparationError ||
                        "You can cancel the sequence while the exact file is prepared."}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {mediaPreparationError && queuedDelivery ? (
                      <>
                        <button
                          type="button"
                          className="min-h-11 rounded-lg border border-primary-400/40 bg-primary-500/15 px-3 text-xs font-semibold text-surface-50"
                          onClick={() => {
                            setMediaPreparationError(null);
                            shareQueueOpenedRef.current = null;
                            if (queuedDelivery.mediaKind === "video") {
                              handleCancelShareQueue();
                              void handleRetryDelivery(queuedDelivery.id);
                            } else {
                              handleSelectDelivery(queuedDelivery.id);
                              setMediaPreparationNonce((value) => value + 1);
                            }
                          }}
                        >
                          {queuedDelivery.mediaKind === "video"
                            ? "Create again"
                            : "Retry file"}
                        </button>
                        <button
                          type="button"
                          className="min-h-11 rounded-lg border border-surface-600 px-3 text-xs font-semibold text-surface-200"
                          onClick={handleAdvanceShareQueue}
                        >
                          Skip this output
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      className="min-h-11 rounded-lg border border-surface-600 px-3 text-xs font-semibold text-surface-200"
                      onClick={handleCancelShareQueue}
                    >
                      Cancel sequence
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
            {(deliveryPlan.unsupported.length > 0 ||
              deliveryPlan.unknown.length > 0) && (
              <div
                className="w-full rounded-xl border border-warning-500/25 bg-warning-500/10 px-4 py-3 text-sm text-warning-100"
                role="status"
              >
                <p className="font-semibold">Some saved destinations need attention</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-xs leading-relaxed">
                  {deliveryPlan.unsupported.map((profile) => (
                    <li key={profile.profileId}>{profile.reason}</li>
                  ))}
                  {deliveryPlan.unknown.map((item) => (
                    <li key={item.platformId}>
                      {item.platformId}: {item.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
          <div
            className={cn(
              "grid min-w-0 grid-cols-1",
              isDesktopLayout ? "col-start-1 row-start-1 gap-4" : "row-start-2 gap-6",
            )}
          >
            <section
              className={cn(
                "flex flex-col items-center space-y-4 rounded-2xl border border-white/10 bg-white/[0.04] p-3 shadow-2xl shadow-black/20 sm:p-4",
                isDesktopLayout && "lg:space-y-3 lg:p-3",
              )}
              aria-labelledby={isDesktopLayout ? "media-preview-heading" : undefined}
              aria-label={
                isDesktopLayout ? undefined : "Creative tools and media history"
              }
              aria-busy={imageBusy}
            >
              {isDesktopLayout ? (
                <>
                  <div className="flex w-full items-center justify-between px-1">
                    <h3
                      id="media-preview-heading"
                      className="text-sm font-semibold text-surface-100"
                    >
                      Media preview
                    </h3>
                    <div className="flex flex-wrap justify-end gap-2">
                      {historyReadOnly ? (
                        <Badge variant="neutral" uppercase={false}>
                          View-only history
                        </Badge>
                      ) : editableDraft && draftSyncStatus !== "idle" ? (
                        <div className="flex items-center gap-1.5">
                          <Badge
                            variant={
                              draftSyncStatus === "error"
                                ? "error"
                                : draftSyncStatus === "saved"
                                  ? "success"
                                  : "info"
                            }
                            uppercase={false}
                          >
                            {draftSyncStatus === "error"
                              ? "History save failed"
                              : draftSyncStatus === "saved"
                                ? "Saved to My work"
                                : "Saving to My work…"}
                          </Badge>
                          {draftSyncStatus === "error" ? (
                            <button
                              type="button"
                              className="min-h-8 rounded-lg border border-error-400/30 bg-error-500/10 px-2 text-[10px] font-semibold text-error-100 [.theme-light_&]:text-error-800"
                              onClick={() => void flushPendingDraft()}
                            >
                              Retry
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                      <Badge variant={videoUrl ? "info" : "neutral"} uppercase={false}>
                        {videoUrl
                          ? "Video"
                          : activeImageFormat
                            ? `Saves as ${activeImageFormat.width}×${activeImageFormat.height}`
                            : "Image"}
                      </Badge>
                      {!videoUrl && activePreparedSave ? (
                        <Badge variant="neutral" uppercase={false}>
                          {activePreparedSave.filename
                            .split(".")
                            .pop()
                            ?.toUpperCase() || "JPG"}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  <div className="relative w-full overflow-hidden rounded-xl bg-surface-950/60">
                    {(isImageLoading || isVideoLoading) && (
                      <BusyOverlay
                        message={
                          isVideoLoading ? videoLoadingMessage : imageLoadingMessage
                        }
                        progress={isVideoLoading ? undefined : imageLoadingProgress}
                      />
                    )}
                    {videoUrl &&
                    isVideoBuffering &&
                    !isVideoLoading &&
                    !videoPlayError ? (
                      <div
                        className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center bg-surface-950/40"
                        role="status"
                        aria-label="Loading video preview"
                      >
                        <Loader2
                          className="h-8 w-8 animate-spin text-primary-300"
                          aria-hidden="true"
                        />
                      </div>
                    ) : null}

                    {videoUrl ? (
                      <div className="w-full space-y-2">
                        <video
                          ref={videoElRef}
                          key={videoUrl}
                          src={videoUrl}
                          controls
                          playsInline
                          preload="auto"
                          autoPlay={!shouldReduceMotion}
                          loop={!shouldReduceMotion}
                          muted={videoMuted}
                          aria-label="Generated social media video preview"
                          onLoadStart={() => setIsVideoBuffering(true)}
                          onLoadedData={() => {
                            setIsVideoBuffering(false);
                            setVideoPlayError(null);
                          }}
                          onCanPlay={() => {
                            setIsVideoBuffering(false);
                            setVideoPlayError(null);
                            const el = videoElRef.current;
                            if (el && !shouldReduceMotion) {
                              void el.play().catch(() => {
                                // Autoplay blocked — controls still work for manual play.
                              });
                            }
                          }}
                          onVolumeChange={(e) => {
                            setVideoMuted(e.currentTarget.muted);
                          }}
                          onError={() => {
                            setIsVideoBuffering(false);
                            setVideoPlayError(
                              "This video could not be played. Try Save video, or generate again.",
                            );
                          }}
                          className={cn(
                            "w-full rounded-xl bg-black object-contain shadow-2xl",
                            isDesktopLayout ? "max-h-[36dvh]" : "max-h-[70dvh]",
                          )}
                        />
                        {videoMuted && !videoPlayError ? (
                          <button
                            type="button"
                            onClick={() => {
                              triggerHapticFeedback();
                              const el = videoElRef.current;
                              if (!el) return;
                              el.muted = false;
                              setVideoMuted(false);
                              void el.play().catch(() => undefined);
                            }}
                            className="flex w-full min-h-11 items-center justify-center gap-2 rounded-xl border border-primary-400/40 bg-primary-500/15 px-3 py-2 text-sm font-semibold text-primary-50"
                          >
                            Turn on sound
                          </button>
                        ) : null}
                        {!videoPlayError ? (
                          <button
                            type="button"
                            onClick={() => {
                              triggerHapticFeedback();
                              setManualVideoSelected(false);
                              setSelectedDeliveryId(
                                deliveryPlan.deliveries.find(
                                  (delivery) => delivery.mediaKind === "photo",
                                )?.id || null,
                              );
                              adoptVideoUrl(null);
                            }}
                            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.05] px-3 py-2 text-sm font-semibold text-surface-100 transition-colors hover:bg-white/[0.09]"
                          >
                            <Camera className="h-4 w-4" aria-hidden="true" />
                            Back to photos
                          </button>
                        ) : null}
                        {videoPlayError ? (
                          <div
                            className="space-y-2 rounded-xl border border-error-500/40 bg-error-500/10 px-3 py-2 text-xs text-error-100 [.theme-light_&]:text-error-800"
                            role="alert"
                          >
                            <p>{videoPlayError}</p>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 font-semibold text-surface-100"
                                onClick={() => {
                                  const el = videoElRef.current;
                                  if (!el || !videoUrl) return;
                                  setVideoPlayError(null);
                                  setIsVideoBuffering(true);
                                  el.load();
                                  void el
                                    .play()
                                    .catch(() => setIsVideoBuffering(false));
                                }}
                              >
                                Retry play
                              </button>
                              <button
                                type="button"
                                className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 font-semibold text-surface-100"
                                onClick={() => {
                                  setManualVideoSelected(false);
                                  setSelectedDeliveryId(
                                    deliveryPlan.deliveries.find(
                                      (delivery) => delivery.mediaKind === "photo",
                                    )?.id || null,
                                  );
                                  adoptVideoUrl(null);
                                  setVideoPlayError(null);
                                }}
                              >
                                Show photo
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          triggerHapticFeedback();
                          setIsPreviewOpen(true);
                        }}
                        className={cn(
                          "mx-auto block w-full overflow-hidden rounded-xl bg-black transition-all hover:ring-2 hover:ring-primary-400/30 focus:outline-none focus:ring-4 focus:ring-primary-500/50",
                          isDesktopLayout && "max-h-[36dvh]",
                        )}
                        style={
                          activeImageFormat
                            ? {
                                aspectRatio: `${activeImageFormat.width} / ${activeImageFormat.height}`,
                                maxWidth: `min(100%, calc(${isDesktopLayout ? "36dvh" : "70dvh"} * ${activeImageFormat.width} / ${activeImageFormat.height}))`,
                              }
                            : undefined
                        }
                        aria-label="Enlarge image"
                      >
                        <ProgressiveImage
                          src={displayImageUrl}
                          alt="Generated social media post"
                          className="h-full w-full rounded-xl object-contain shadow-2xl"
                        />
                      </button>
                    )}
                  </div>
                </>
              ) : null}

              {!isDesktopLayout && !brandModeOn ? renderMediaHistoryRail() : null}
              {brandModeOn && playfulPair ? renderPlayfulPair() : null}

              <div className="w-full space-y-2 mb-2">
                <div
                  className={cn(
                    "gap-1.5 bg-surface-950/35 border border-white/10 rounded-xl p-1.5",
                    isDesktopLayout
                      ? "flex flex-wrap items-center justify-between"
                      : "grid grid-cols-[minmax(0,1fr)_auto] items-stretch",
                  )}
                >
                  <div
                    className={cn(
                      "gap-1.5 min-w-0",
                      isDesktopLayout ? "flex flex-1" : "grid grid-cols-3",
                    )}
                  >
                    {/* Brand mode hides the tile outright when the category or
                        a manager permission forbids motion; otherwise it is the
                        same tile, opening the same director. */}
                    {!brandModeOn || resolved.videoAllowed ? (
                      <ActionTile
                        icon={Film}
                        iconClassName={TILE_ICON_ACCENT}
                        ariaLabel={brandModeOn ? "Add video" : undefined}
                        tooltip={
                          historyReadOnly
                            ? "This teammate's saved post is view-only"
                            : brandModeOn
                              ? "Render this photo with your dealership's motion signature"
                              : "Turn your image into a video"
                        }
                        disabled={
                          imageBusy ||
                          isVideoLoading ||
                          creativeLockedForReview ||
                          historyReadOnly
                        }
                        busy={isVideoLoading}
                        label={
                          isVideoLoading
                            ? "Render"
                            : brandModeOn
                              ? "Add video"
                              : videoUrl
                                ? "New video"
                                : "Video"
                        }
                        onClick={() => {
                          if (brandModeOn) {
                            void handleAddHouseVideo();
                            return;
                          }
                          setVideoDirectorDeliveryId(null);
                          setIsVideoDirectorOpen(true);
                        }}
                      />
                    ) : null}
                    {!brandModeOn || resolved.playfulAllowed ? (
                      <ActionTile
                        icon={Sparkles}
                        iconClassName="text-primary-300"
                        ariaLabel={brandModeOn ? "Playful" : undefined}
                        tooltip={
                          !hasOriginalCapture
                            ? originalRequiredMessage
                            : brandModeOn
                              ? "Add your dealership's playful version beside this photo"
                              : "Artistic style (optional)"
                        }
                        disabled={
                          imageBusy ||
                          !!videoUrl ||
                          contentEditingLocked ||
                          historyReadOnly ||
                          !hasOriginalCapture
                        }
                        busy={imageBusy}
                        label={
                          imageBusy ? "Wait" : brandModeOn ? "Playful" : "Fun mode"
                        }
                        onClick={() => {
                          if (brandModeOn) {
                            void handleApplyHousePlayful();
                            return;
                          }
                          setIsFunModeDirectorOpen(true);
                        }}
                      />
                    ) : null}
                    <ActionTile
                      icon={Calendar}
                      iconClassName="text-emerald-300"
                      tooltip="Schedule post for later"
                      disabled={deliveryLocked || historyReadOnly}
                      label="Schedule"
                      onClick={() => {
                        if (deliveryLocked || historyReadOnly) {
                          toast.warning(
                            historyReadOnly
                              ? "This teammate's saved post is view-only."
                              : deliveryGateMessage,
                          );
                          return;
                        }
                        setIsScheduleOpen(true);
                      }}
                    />
                    {isDesktopLayout ? (
                      <>
                        <ActionTile
                          icon={Share2}
                          iconClassName="text-blue-300"
                          tooltip="Share post"
                          ariaLabel={
                            deliveryLocked
                              ? `Share post (${deliveryLockLabel.toLowerCase()})`
                              : "Share post"
                          }
                          disabled={
                            deliveryLocked ||
                            (!manualVideoSelected && !activePreparedSave) ||
                            isPreparingSave
                          }
                          label="Share"
                          onClick={handleOpenShare}
                        />
                        <ActionTile
                          icon={Download}
                          iconClassName="text-success-300"
                          tooltip="Save media"
                          ariaLabel={saveAriaLabel(deliveryLocked)}
                          disabled={
                            imageBusy ||
                            deliveryLocked ||
                            isPreparingSave ||
                            !activePreparedSave
                          }
                          busy={imageBusy || isPreparingSave}
                          label={isPreparingSave ? "Preparing" : "Save"}
                          onClick={() => void handleSave()}
                        />
                      </>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsToolsOpen((open) => !open)}
                    aria-label={
                      brandModeOn
                        ? isToolsOpen
                          ? "Hide studio tools"
                          : "Show studio tools"
                        : isToolsOpen
                          ? "Hide creative tools"
                          : "Show creative tools"
                    }
                    aria-expanded={isToolsOpen}
                    aria-controls="creative-tools-panel"
                    className={cn(
                      "flex shrink-0 min-h-[44px] px-3 items-center justify-center gap-1.5 rounded-lg border border-transparent text-sm font-semibold text-surface-200 transition-colors",
                      isToolsOpen ? "bg-white/[0.08]" : "hover:bg-white/[0.04]",
                      !isDesktopLayout && "px-2",
                    )}
                  >
                    {brandModeOn ? "Studio tools" : "More"}
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 shrink-0 text-surface-400 transition-transform",
                        isToolsOpen && "rotate-180",
                      )}
                      aria-hidden="true"
                    />
                  </button>
                </div>

                <div
                  id="creative-tools-panel"
                  data-testid="creative-tools-panel"
                  hidden={!isToolsOpen}
                  className={cn(
                    "grid grid-cols-2 gap-2 sm:grid-cols-3 mt-1",
                    !isToolsOpen && "hidden",
                  )}
                >
                  <ActionTile
                    icon={LayoutGrid}
                    iconClassName="text-amber-300"
                    tooltip={
                      deliveryLocked
                        ? deliveryGateMessage
                        : "Export Story, Feed, Marketplace & Google sizes"
                    }
                    disabled={imageBusy || deliveryLocked}
                    label="Export sizes"
                    onClick={() => {
                      if (deliveryLocked) {
                        toast.warning(deliveryGateMessage);
                        return;
                      }
                      setIsMultiFormatOpen(true);
                    }}
                  />

                  <ActionTile
                    icon={RefreshCw}
                    iconClassName="text-surface-300"
                    tooltip={
                      !hasOriginalCapture
                        ? originalRequiredMessage
                        : brandModeOn && photoRetryUsed
                          ? oneShotSpentMessage
                          : brandModeOn
                            ? "One new photo per post"
                            : "Generate a new image version"
                    }
                    ariaLabel={brandModeOn ? "Try another photo" : "Regenerate image"}
                    disabled={
                      imageBusy ||
                      !!videoUrl ||
                      contentEditingLocked ||
                      historyReadOnly ||
                      !hasOriginalCapture ||
                      (brandModeOn && photoRetryUsed)
                    }
                    busy={imageBusy}
                    label={
                      imageBusy
                        ? "Working…"
                        : brandModeOn
                          ? "Try another photo"
                          : "Regenerate image"
                    }
                    onClick={() => {
                      void handleTryAnotherPhoto();
                    }}
                  />

                  {!brandModeOn || resolved.freeTextEditAllowed ? (
                    <ActionTile
                      icon={Edit3}
                      iconClassName={TILE_ICON_ACCENT}
                      tooltip={
                        historyReadOnly
                          ? "This teammate's saved post is view-only"
                          : "Change specific details"
                      }
                      disabled={
                        imageBusy ||
                        !!videoUrl ||
                        contentEditingLocked ||
                        historyReadOnly
                      }
                      busy={imageBusy}
                      label={
                        imageBusy
                          ? "Working…"
                          : isImageEditing
                            ? "Cancel"
                            : "Edit image"
                      }
                      onClick={() => setIsImageEditing(!isImageEditing)}
                    />
                  ) : null}

                  <ActionTile
                    icon={RefreshCw}
                    iconClassName="text-surface-300"
                    tooltip={
                      !hasOriginalCapture
                        ? originalRequiredMessage
                        : brandModeOn && captionRetryUsed
                          ? oneShotSpentMessage
                          : brandModeOn
                            ? "One new caption per post"
                            : "Generate a new caption"
                    }
                    ariaLabel={
                      brandModeOn ? "Try another caption" : "Regenerate caption"
                    }
                    disabled={
                      textBusy ||
                      contentEditingLocked ||
                      historyReadOnly ||
                      !hasOriginalCapture ||
                      (brandModeOn && captionRetryUsed)
                    }
                    busy={textBusy}
                    label={
                      textBusy
                        ? "Working…"
                        : brandModeOn
                          ? "Try another caption"
                          : "Regenerate caption"
                    }
                    onClick={() => {
                      void handleTryAnotherCaption();
                    }}
                  />

                  {!brandModeOn || resolved.freeTextEditAllowed ? (
                    <ActionTile
                      icon={Edit3}
                      iconClassName={TILE_ICON_ACCENT}
                      tooltip={
                        historyReadOnly
                          ? "This teammate's saved post is view-only"
                          : "Describe a caption change"
                      }
                      disabled={textBusy || contentEditingLocked || historyReadOnly}
                      busy={textBusy}
                      label={textBusy ? "Working…" : "Edit text"}
                      onClick={() => setIsTextEditing(true)}
                    />
                  ) : null}

                  {/* Three-at-once caption ideas are another caption
                      regeneration path, so brand mode retires it rather than
                      letting it walk around the one-shot budget. */}
                  {onGenerateCaptionVariant && !brandModeOn ? (
                    <ActionTile
                      icon={Sparkles}
                      iconClassName={TILE_ICON_ACCENT}
                      tooltip={
                        hasOriginalCapture
                          ? "Generate three caption options"
                          : originalRequiredMessage
                      }
                      disabled={
                        textBusy ||
                        contentEditingLocked ||
                        historyReadOnly ||
                        !hasOriginalCapture
                      }
                      label="3 text ideas"
                      onClick={() => setIsCaptionAltsOpen(true)}
                    />
                  ) : null}
                </div>
                {brandModeOn && (photoRetryUsed || captionRetryUsed) ? (
                  <p
                    className="mt-1 text-xs text-surface-400"
                    data-testid="one-shot-retry-note"
                  >
                    {oneShotSpentMessage}
                  </p>
                ) : null}
                {brandModeOn && isToolsOpen ? renderBrandStudioExtras() : null}
                <AnimatePresence>
                  {isToolsOpen &&
                    isImageEditing &&
                    (!brandModeOn || resolved.freeTextEditAllowed) && (
                      <m.div
                        className="space-y-2 rounded-xl border border-white/10 bg-surface-800/50 p-3"
                        initial={shouldReduceMotion ? false : { opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: shouldReduceMotion ? 0 : 0.25 }}
                      >
                        <label
                          htmlFor="image-edit-request"
                          className="text-xs font-semibold text-surface-200"
                        >
                          Image edit request
                        </label>
                        <textarea
                          id="image-edit-request"
                          value={imageEditPrompt}
                          onChange={(e) => setImageEditPrompt(e.target.value)}
                          placeholder="Example: Make the headline gold and brighten the vehicle."
                          className="w-full bg-surface-800/50 text-surface-50 border-2 border-white/20 rounded-xl px-3 py-2 focus:ring-2 focus:ring-primary-400 focus:border-primary-400 outline-none transition text-sm"
                          rows={2}
                        />
                        <Button
                          onClick={() => {
                            void handleImageAction(
                              () => onEditImage(imageEditPrompt),
                              [
                                "Applying your edit request...",
                                "Re-rendering safely around people and cars...",
                                "Finalizing the updated image...",
                              ],
                            )
                              .then(() => {
                                setIsImageEditing(false);
                                setImageEditPrompt("");
                              })
                              .catch(() => undefined);
                          }}
                          disabled={!imageEditPrompt.trim()}
                          fullWidth
                          size="sm"
                        >
                          Apply image edit
                        </Button>
                      </m.div>
                    )}
                </AnimatePresence>
                {isToolsOpen && videoJobs.length > 0 && (
                  <m.div
                    className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-3"
                    initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: shouldReduceMotion ? 0 : 0.25 }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wide text-surface-50">
                        Video queue
                      </span>
                      <span
                        className="text-[10px] text-primary-200/70"
                        role="status"
                        aria-live="polite"
                      >
                        {videoJobs.filter((job) => job.status === "processing").length}{" "}
                        active
                      </span>
                    </div>
                    <ul className="space-y-2" role="list" aria-label="Video queue list">
                      {videoJobs.map((job) => (
                        <m.li
                          key={job.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-surface-900/40 px-3 py-2 text-xs"
                          initial={
                            shouldReduceMotion ? false : { opacity: 0, scale: 0.95 }
                          }
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ duration: shouldReduceMotion ? 0 : 0.2 }}
                        >
                          <div className="flex flex-col">
                            <span className="font-semibold text-surface-50">
                              {job.style}
                            </span>
                            <span className="text-primary-200/70">
                              {job.duration}s ·{" "}
                              {job.soundtrack === "none"
                                ? "No soundtrack"
                                : job.soundtrack}{" "}
                              ·{" "}
                              {job.aspectPreference === "auto"
                                ? "auto"
                                : job.aspectPreference}{" "}
                              · {job.resolution} · {job.pacing}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            {job.status === "completed" && (
                              <Badge variant="success">Ready</Badge>
                            )}
                            {job.status === "processing" && (
                              <Badge variant="info">Rendering</Badge>
                            )}
                            {job.status === "queued" && (
                              <Badge variant="neutral">Queued</Badge>
                            )}
                            {job.status === "failed" && (
                              <Badge variant="warning">Failed</Badge>
                            )}
                            {job.url && (
                              <button
                                type="button"
                                onClick={() => {
                                  setManualVideoSelected(true);
                                  adoptVideoUrl(job.url || null);
                                }}
                                aria-label={`Preview ${job.style} video`}
                                className="text-[10px] font-semibold uppercase tracking-wide text-primary-200 hover:text-surface-50 transition-colors"
                              >
                                Preview
                              </button>
                            )}
                            {job.status === "failed" && (
                              <button
                                type="button"
                                onClick={() => handleRetryVideo(job.id)}
                                aria-label={`Retry ${job.style} video`}
                                className="text-[10px] font-semibold uppercase tracking-wide text-amber-200 hover:text-amber-50 transition-colors"
                              >
                                Retry
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleRemoveVideoJob(job.id)}
                              aria-label={`Remove ${job.style} video job`}
                              className="text-[10px] font-semibold uppercase tracking-wide text-surface-200/70 hover:text-surface-50 transition-colors"
                            >
                              Remove
                            </button>
                          </div>
                          <div className="flex flex-col gap-1 text-xs text-warning-200">
                            {job.error && <span>{job.error}</span>}
                            <span className="text-surface-400">
                              Started{" "}
                              {new Date(job.createdAt).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                        </m.li>
                      ))}
                    </ul>
                  </m.div>
                )}
              </div>
            </section>

            {isDesktopLayout ? (
              <m.section
                className="flex flex-col rounded-2xl border border-white/10 bg-surface-900/70 p-4 backdrop-blur-lg lg:p-4"
                initial={shouldReduceMotion ? false : { opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{
                  delay: shouldReduceMotion ? 0 : 0.12,
                  duration: shouldReduceMotion ? 0 : 0.3,
                }}
                aria-labelledby="caption-delivery-heading"
                aria-busy={textBusy}
              >
                <div
                  className={cn(
                    "mb-3 flex flex-col gap-3",
                    isDesktopLayout && "lg:mb-2 lg:gap-2",
                  )}
                >
                  <div className="min-w-0">
                    <h3
                      id="caption-delivery-heading"
                      className={cn(
                        "font-semibold text-surface-50",
                        isDesktopLayout ? "text-base" : "text-xl",
                      )}
                    >
                      Caption studio
                    </h3>
                    <p className="mt-0.5 text-xs text-surface-400">
                      {historyReadOnly
                        ? "This teammate's saved copy is view-only. You can still copy, share, or export it."
                        : contentEditingLocked
                          ? websiteHandoffStarted
                            ? "Website copy is locked to the exact final draft sent to Customer Hub."
                            : "Review copy is locked to the exact creative submitted to the manager."
                          : brandModeOn
                            ? "Ready to copy and post. Everything else lives in Studio tools."
                            : "Ready to copy and post. Tap New caption if you want a different version."}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {/* Brand mode keeps exactly one caption-regeneration
                        control, the one-shot "Try another caption" in Studio
                        tools, so this duplicate is retired there. */}
                    {!brandModeOn ? (
                      <button
                        type="button"
                        onClick={() => {
                          void handleTryAnotherCaption();
                        }}
                        disabled={
                          textBusy ||
                          contentEditingLocked ||
                          historyReadOnly ||
                          !hasOriginalCapture
                        }
                        className={cn(
                          "inline-flex min-h-11 items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-semibold transition-colors",
                          isDesktopLayout &&
                            "lg:min-h-9 lg:rounded-lg lg:px-3 lg:py-1.5 lg:text-xs",
                          "border-primary-400/45 bg-primary-500/15 text-primary-50",
                          "hover:border-primary-400/65 hover:bg-primary-500/25",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/70",
                          "disabled:cursor-not-allowed disabled:opacity-40",
                        )}
                        title={
                          historyReadOnly
                            ? "This teammate's saved post is view-only"
                            : !hasOriginalCapture
                              ? originalRequiredMessage
                              : "Generate a full new marketing caption and hashtags"
                        }
                        aria-label="New caption"
                      >
                        {textBusy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                        {textBusy ? "Writing..." : "New caption"}
                      </button>
                    ) : null}
                    {onGenerateCaptionVariant && !brandModeOn ? (
                      <button
                        type="button"
                        onClick={() => setIsCaptionAltsOpen(true)}
                        disabled={
                          textBusy ||
                          contentEditingLocked ||
                          historyReadOnly ||
                          !hasOriginalCapture
                        }
                        className={cn(
                          "inline-flex min-h-11 items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-semibold transition-colors",
                          isDesktopLayout &&
                            "lg:min-h-9 lg:rounded-lg lg:px-3 lg:py-1.5 lg:text-xs",
                          "border-white/10 bg-white/[0.04] text-surface-200",
                          "hover:border-white/20 hover:bg-white/[0.08]",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/70",
                          "disabled:cursor-not-allowed disabled:opacity-40",
                        )}
                        title={
                          historyReadOnly
                            ? "This teammate's saved post is view-only"
                            : !hasOriginalCapture
                              ? originalRequiredMessage
                              : "Generate three full caption options"
                        }
                        aria-label="Three caption ideas"
                      >
                        <Sparkles className="h-4 w-4 text-primary-300" />3 options
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={handleUndo}
                      disabled={
                        historyIndex === 0 || contentEditingLocked || historyReadOnly
                      }
                      className={cn(
                        "inline-flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-surface-200 transition-colors hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/70 disabled:cursor-not-allowed disabled:opacity-30",
                        isDesktopLayout && "lg:h-9 lg:w-9",
                      )}
                      title="Undo (Ctrl+Z)"
                      aria-label="Undo caption change"
                    >
                      <Undo2 className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={handleRedo}
                      disabled={
                        historyIndex === textHistory.length - 1 ||
                        contentEditingLocked ||
                        historyReadOnly
                      }
                      className={cn(
                        "inline-flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-surface-200 transition-colors hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/70 disabled:cursor-not-allowed disabled:opacity-30",
                        isDesktopLayout && "lg:h-9 lg:w-9",
                      )}
                      title="Redo (Ctrl+Y)"
                      aria-label="Redo caption change"
                    >
                      <Redo2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {!brandModeOn ? renderCaptionPlatformTabs() : null}

                <div
                  id="caption-platform-panel"
                  role={platformCaptionTabs.length > 0 ? "tabpanel" : undefined}
                  aria-labelledby={
                    platformCaptionTabs.length > 0
                      ? `caption-platform-tab-${activeCaptionTabIndex}`
                      : undefined
                  }
                  className={cn("relative mb-4", isDesktopLayout && "lg:mb-3")}
                >
                  {isTextLoading && <BusyOverlay message="Updating caption…" />}
                  {captionWasEdited && (
                    <div className="mb-2 flex items-center gap-2 text-xs text-warning-300">
                      <Edit3 className="w-3 h-3" />
                      <span>Caption edited for this platform</span>
                    </div>
                  )}
                  {/* One caption editor serves both modes. Brand mode keeps the
                      caption on the surface but hides the hashtag chip editor
                      until "Studio tools" is opened, so two editors are never
                      mounted at once. */}
                  <CaptionStudio
                    value={editedText}
                    onChange={handleTextChange}
                    disabled={isTextLoading || contentEditingLocked || historyReadOnly}
                    platformId={activeCaptionPlatform}
                    claimLocked={claimLocked || identityLocked}
                    compact={isDesktopLayout}
                    hideHashtagEditor={brandModeOn && !isToolsOpen}
                  />
                </div>

                {/* Desktop: delivery actions sit with the caption panel. */}
                {isDesktopLayout ? (
                  <div className="mb-3" aria-label="Post delivery actions">
                    {deliveryLockStatus}
                    <Button
                      variant="outline"
                      onClick={handleCopy}
                      disabled={deliveryLocked}
                      aria-label={
                        deliveryLocked
                          ? `Copy caption (${deliveryLockLabel.toLowerCase()})`
                          : "Copy caption"
                      }
                      leftIcon={
                        copied ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )
                      }
                      fullWidth
                      disableHaptics
                    >
                      <span aria-live="polite">
                        {copied ? "Copied" : "Copy caption"}
                      </span>
                    </Button>
                  </div>
                ) : null}

                {reviewRequired ? (
                  <p
                    className={cn(
                      "mb-4 text-xs",
                      approvalStatus === "approved"
                        ? "text-success-200"
                        : "text-warning-200",
                    )}
                    role="status"
                  >
                    {approvalStatus === "approved"
                      ? "Approved creative: copy, share, save, and export are available."
                      : "Copy, share, save, and export unlock after manager approval."}
                  </p>
                ) : null}

                <PlatformLimitMeter
                  text={captionWithDisclosures}
                  platformIds={post.platformIds}
                  className={isDesktopLayout ? "mb-3" : "mb-4"}
                />

                {/* Locked compliance disclosure block. Read-only so a salesperson
                can't silently delete it. Bundled with the caption automatically
                on copy/share. Media downloads remain media-only. */}
                {activeDisclosures && (
                  <m.div
                    initial={shouldReduceMotion ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: shouldReduceMotion ? 0 : 0.2 }}
                    className="mb-4 rounded-xl border border-warning-700/40 bg-warning-900/20 p-3"
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <AlertCircle className="w-4 h-4 text-warning-300" />
                      <span className="text-xs uppercase tracking-wide text-warning-200 font-semibold">
                        Required compliance disclosures
                        {activeDisclosureCategories.length
                          ? ` · ${activeDisclosureCategories.join(", ")}`
                          : ""}
                      </span>
                    </div>
                    <div className="text-sm text-warning-100/90 whitespace-pre-line leading-relaxed select-text">
                      {activeDisclosures.replace(/^—\s*Disclosures\s*—\s*\n?/, "")}
                    </div>
                    <div className="text-xs text-warning-300/70 mt-2">
                      Included automatically when you copy or share. Saving media
                      downloads only the image or video, so copy the caption too.
                    </div>
                  </m.div>
                )}
              </m.section>
            ) : null}
          </div>
        </div>
        {isDesktopLayout && !brandModeOn ? renderMediaHistoryRail(true) : null}
      </m.section>

      {/* Mobile/narrow: sticky bottom delivery bar (Save · Share · Copy).
          Creative tools stay collapsed above; desktop keeps in-panel CTAs. */}
      {!isDesktopLayout && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-surface-950/95 shadow-[0_-8px_24px_rgba(0,0,0,0.35)] backdrop-blur-md"
              style={{
                paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))",
                paddingLeft: "env(safe-area-inset-left)",
                paddingRight: "env(safe-area-inset-right)",
              }}
            >
              {deliveryLockStatus ? (
                <div className="mx-auto max-w-lg px-3 pt-2">{deliveryLockStatus}</div>
              ) : null}
              <div
                className="mx-auto grid max-w-lg grid-cols-3 gap-2 px-3 pt-2"
                aria-label="Post delivery actions"
              >
                <Button
                  variant="primary"
                  onClick={() => void handleSave()}
                  disabled={
                    deliveryLocked ||
                    imageBusy ||
                    isPreparingSave ||
                    !activePreparedSave
                  }
                  aria-label={saveAriaLabel(deliveryLocked)}
                  leftIcon={
                    isPreparingSave ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )
                  }
                  fullWidth
                  className="min-w-0 px-2"
                  disableHaptics
                >
                  {isPreparingSave ? "Ready…" : "Save"}
                </Button>
                {websiteOnly ? (
                  <Button
                    variant="outline"
                    onClick={handleWebsiteMobileAction}
                    disabled={websiteMobileActionDisabled}
                    aria-label={`${websiteMobileActionLabel} website draft`}
                    leftIcon={
                      websiteSending || websiteRetrying ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : websiteReviewUrl ? (
                        <ExternalLink className="h-4 w-4" />
                      ) : (
                        <Globe2 className="h-4 w-4" />
                      )
                    }
                    fullWidth
                    className="min-w-0 px-2"
                    disableHaptics
                  >
                    {websiteMobileActionLabel}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    onClick={handleOpenShare}
                    disabled={
                      deliveryLocked ||
                      isPreparingSave ||
                      !activePreparedSave ||
                      (!manualVideoSelected &&
                        selectedDelivery?.mediaKind === "video" &&
                        selectedVideoJob?.status !== "completed")
                    }
                    aria-label={
                      deliveryLocked
                        ? `Share post (${deliveryLockLabel.toLowerCase()})`
                        : "Share post"
                    }
                    leftIcon={<Share2 className="h-4 w-4" />}
                    fullWidth
                    className="min-w-0 px-2"
                    disableHaptics
                  >
                    Share
                  </Button>
                )}
                <Button
                  variant="tinted"
                  onClick={handleCopy}
                  disabled={deliveryLocked}
                  aria-label={
                    deliveryLocked
                      ? `Copy caption (${deliveryLockLabel.toLowerCase()})`
                      : "Copy caption"
                  }
                  leftIcon={
                    copied ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )
                  }
                  fullWidth
                  className="min-w-0 px-2"
                  disableHaptics
                >
                  <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
                </Button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
};
