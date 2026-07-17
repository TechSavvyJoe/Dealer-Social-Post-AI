import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  Suspense,
} from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
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
  type LucideIcon,
} from "lucide-react";
import confetti from "canvas-confetti";
import { Tooltip } from "./ui/Tooltip";
import { GeneratedPost, VideoStyle, VideoRequestOptions } from "../types";
import { triggerHapticFeedback } from "../utils/haptics";
import { Badge } from "./ui/Badge";
import { cn } from "../utils/classNames";
import { ProgressBar } from "./ui/ProgressBar";
import { normalizeError, recoveryHint } from "../utils/errorHandler";
import { MultiFormatExportModal } from "./MultiFormatExportModal";
import { LayoutGrid } from "lucide-react";
import { PlatformLimitMeter } from "./PlatformLimitMeter";
import { ShareDialog } from "./ShareDialog";
import { CaptionAlternativesModal } from "./CaptionAlternativesModal";
import { ProgressiveImage } from "./ui/ProgressiveImage";
import { useToast } from "./ui/Toast";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import {
  getPostApprovalStatus,
  markPostVideoGenerated,
} from "../services/posts";
import { imageFileExtension } from "../utils/imageUtils";
import {
  analyzeCaptionForDelivery,
  prohibitedClaimsMessage,
} from "../utils/complianceDisclosures";
import {
  preferredExportFormatIds,
  resolvePlatformOption,
} from "../services/platformCopy";
import { useAppStore } from "../stores/appStore";

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

/**
 * A compact secondary tool. Result completion actions intentionally use a
 * stronger treatment below the caption; these controls stay visually quiet.
 */
const ActionTile: React.FC<{
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  tooltip?: string;
  disabled?: boolean;
  busy?: boolean;
  iconClassName?: string;
}> = ({
  icon: Icon,
  label,
  onClick,
  tooltip,
  disabled = false,
  busy = false,
  iconClassName,
}) => {
  const shouldReduceMotion = useReducedMotion();
  const button = (
    <motion.button
      type="button"
      onClick={() => {
        triggerHapticFeedback();
        onClick();
      }}
      disabled={disabled}
      aria-busy={busy || undefined}
      className={cn(TILE_BASE, TILE_NEUTRAL)}
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
      <span className="truncate">{label}</span>
    </motion.button>
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
  onEditText: (prompt: string) => Promise<void>;
  onFunMode: (styleName?: string) => Promise<void>;
  onGenerateVideo: (
    style: VideoStyle,
    options: VideoRequestOptions,
  ) => Promise<string>;
  /** One-shot caption generator for the 3-variant alternatives modal. */
  onGenerateCaptionVariant?: () => Promise<string>;
  error?: string | null;
  isDesktopLayout: boolean;
  requiresApproval?: boolean;
  /** Dealership-managed words or phrases that may not be delivered. */
  bannedPhrases?: string;
}

const BusyOverlay: React.FC<{ message: string; progress?: number }> =
  React.memo(({ message, progress }) => {
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
  });

export const PostResult: React.FC<PostResultProps> = ({
  post,
  onStartOver,
  onRemix,
  onRegenerateImage,
  onEditImage,
  onRegenerateText,
  onEditText,
  onFunMode,
  onGenerateVideo,
  onGenerateCaptionVariant,
  error,
  isDesktopLayout,
  requiresApproval = false,
  bannedPhrases,
}) => {
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  const shouldReduceMotion = useReducedMotion();
  const enabledFunStyles = useAppStore(
    (s) => s.currentDealer?.enabled_fun_styles,
  );

  const [isImageEditing, setIsImageEditing] = useState(false);
  const [imageEditPrompt, setImageEditPrompt] = useState("");
  const [isImageLoading, setIsImageLoading] = useState(false);
  const [imageLoadingMessage, setImageLoadingMessage] =
    useState("Updating Image...");
  const [imageLoadingProgress, setImageLoadingProgress] = useState(0);

  const [editedText, setEditedText] = useState(post.text);
  const [isTextEditing, setIsTextEditing] = useState(false);
  const [isTextLoading, setIsTextLoading] = useState(false);
  /** Active caption-pack platform tab; null = primary post.text. */
  const [activeCaptionPlatform, setActiveCaptionPlatform] = useState<
    string | null
  >(null);

  // Text history for undo/redo
  const [textHistory, setTextHistory] = useState<string[]>([post.text]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const [isVideoDirectorOpen, setIsVideoDirectorOpen] = useState(false);
  const [isFunModeDirectorOpen, setIsFunModeDirectorOpen] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isVideoLoading, setIsVideoLoading] = useState(false);
  const [videoLoadingMessage, setVideoLoadingMessage] = useState("");
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
      url?: string;
      error?: string;
    }>
  >([]);

  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const [isMultiFormatOpen, setIsMultiFormatOpen] = useState(false);
  const [isCaptionAltsOpen, setIsCaptionAltsOpen] = useState(false);
  const [isToolsOpen, setIsToolsOpen] = useState(isDesktopLayout);
  /** Guarded navigation away from this result: full reset or same-photo remix. */
  const [leaveConfirm, setLeaveConfirm] = useState<"startOver" | "remix" | null>(
    null,
  );
  const [hasSavedMedia, setHasSavedMedia] = useState(false);
  const [hasCopiedCaption, setHasCopiedCaption] = useState(false);
  const [approvalStatus, setApprovalStatus] = useState<
    NonNullable<GeneratedPost["approvalStatus"]>
  >(
    post.approvalStatus ??
      (requiresApproval
        ? post.postId
          ? "pending"
          : "submission_failed"
        : "n_a"),
  );
  const [approvalCheckError, setApprovalCheckError] = useState<string | null>(
    null,
  );
  // Local override for the disclosure footer + categories — set when the
  // user picks an alternative caption from the modal so the displayed
  // compliance block matches the chosen variant.
  const [disclosureOverride, setDisclosureOverride] = useState<{
    text: string;
    categories: string[];
  } | null>(null);
  /** Local edits to per-platform pack captions (share + tab switch must honor these). */
  const [packOverrides, setPackOverrides] = useState<Record<string, string>>(
    {},
  );
  /** Prior image versions after regen/fun/edit (local compare stack, max 5). */
  const [imageVersions, setImageVersions] = useState<string[]>([]);
  const prevImageRef = useRef(post.image);
  // Reset override whenever the source post changes (regenerate, new post).
  useEffect(() => {
    setDisclosureOverride(null);
    setPackOverrides({});
    setHasSavedMedia(false);
    setHasCopiedCaption(false);
    setActiveCaptionPlatform(null);
  }, [post.image, post.text, post.platformCaptions]);

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
      post.platformIds?.filter((id) => Boolean(pack[id])) ??
      Object.keys(pack);
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

  useEffect(() => {
    setIsToolsOpen(isDesktopLayout);
  }, [isDesktopLayout]);
  const captionAnalysis = useMemo(
    () => analyzeCaptionForDelivery(editedText, bannedPhrases),
    [bannedPhrases, editedText],
  );
  const imageBusy = isImageLoading || isVideoLoading;
  const textBusy = isTextLoading;
  const approvalLocked = requiresApproval && approvalStatus !== "approved";
  const releaseLocked = post.releaseStatus === "save_failed";
  const claimLocked = captionAnalysis.compliance.prohibited.length > 0;
  const deliveryLocked = approvalLocked || releaseLocked || claimLocked;
  // Once a creative has entered the review workflow it must remain byte-for-
  // byte equivalent to what the manager saw. Delivery unlocks on approval,
  // while edits require starting a new review submission.
  const creativeLockedForReview = requiresApproval;
  const approvalGateMessage =
    approvalStatus === "approved"
      ? "Manager approved this exact creative. Save, share, and export are unlocked; start a new post to make changes."
      : approvalStatus === "rejected"
        ? "A manager rejected this creative. Delivery remains locked; create another post with the requested changes."
        : approvalStatus === "submission_failed"
          ? "This creative could not be submitted for approval. Delivery remains locked; check your connection and create another post to retry."
          : "This exact image and caption are awaiting manager approval. Save, share, and export unlock automatically after approval.";
  const releaseGateMessage =
    "The signed photo release was not stored, so consent cannot be verified. Copy, share, save, and export remain locked; check your connection and create another post to retry.";
  const claimGateMessage = claimLocked
    ? prohibitedClaimsMessage(captionAnalysis.compliance.prohibited)
    : "";
  const deliveryGateMessage = claimLocked
    ? claimGateMessage
    : releaseLocked
      ? releaseGateMessage
      : approvalGateMessage;
  const deliveryLockLabel = claimLocked
    ? "Claim blocked"
    : releaseLocked
      ? "Release not saved"
      : "Approval pending";

  useEffect(() => {
    setApprovalStatus(
      post.approvalStatus ??
        (requiresApproval
          ? post.postId
            ? "pending"
            : "submission_failed"
          : "n_a"),
    );
    setApprovalCheckError(null);
  }, [post.postId, post.approvalStatus, requiresApproval]);

  useEffect(() => {
    if (!requiresApproval || approvalStatus !== "pending" || !post.postId) {
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
        setApprovalStatus(result.approval_status);
        if (result.approval_status === "approved") {
          toast.success("Manager approved this post. Delivery is unlocked.");
          return;
        }
        if (result.approval_status === "rejected") {
          toast.warning("Manager requested changes. Delivery remains locked.");
          return;
        }
        schedule();
      } catch (err) {
        if (
          !active ||
          (err instanceof DOMException && err.name === "AbortError")
        ) {
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
  }, [approvalStatus, post.postId, requiresApproval, toast]);

  useEffect(() => {
    setEditedText(post.text);
    setTextHistory([post.text]);
    setHistoryIndex(0);
  }, [post.text]);

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target;
      const isTyping =
        target instanceof HTMLElement &&
        (target.matches("input, textarea, select") || target.isContentEditable);
      if (
        isTyping ||
        document.querySelector('[role="dialog"][aria-modal="true"]')
      ) {
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
      setHasCopiedCaption(false);
      // Add to history, removing any future history if we're not at the end
      const newHistory = textHistory.slice(0, historyIndex + 1);
      newHistory.push(newText);
      setTextHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
    },
    [historyIndex, textHistory],
  );

  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setEditedText(textHistory[newIndex]);
      setHasCopiedCaption(false);
      triggerHapticFeedback();
    }
  }, [historyIndex, textHistory]);

  const handleRedo = useCallback(() => {
    if (historyIndex < textHistory.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setEditedText(textHistory[newIndex]);
      setHasCopiedCaption(false);
      triggerHapticFeedback();
    }
  }, [historyIndex, textHistory]);

  useEffect(() => {
    // Cleanup function for the video object URL to prevent memory leaks.
    // This runs when the component unmounts or when videoUrl changes.
    const currentVideoUrl = videoUrl;
    return () => {
      if (currentVideoUrl && currentVideoUrl.startsWith("blob:")) {
        URL.revokeObjectURL(currentVideoUrl);
      }
    };
  }, [videoUrl]);

  useEffect(() => {
    setVideoJobs([]);
    setVideoUrl(null);
  }, [post.image]);

  useEffect(() => {
    setHasSavedMedia(false);
  }, [videoUrl]);

  const handleSave = async () => {
    triggerHapticFeedback();
    if (deliveryLocked) {
      toast.warning(deliveryGateMessage);
      return;
    }
    const link = document.createElement("a");

    if (videoUrl) {
      link.href = videoUrl;
      link.download = "social-media-video.mp4";
    } else {
      link.href = post.image;
      link.download = `social-media-post.${imageFileExtension(post.image)}`;
    }

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setHasSavedMedia(true);
    toast.success(`${videoUrl ? "Video" : "Image"} saved to your device.`);

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
  // disclosureOverride takes precedence over post.disclosures when the user
  // picked an alternative from the CaptionAlternativesModal (each variant
  // may trigger a different compliance language set).
  const sourceCaptionForActive =
    activeCaptionPlatform && effectivePack?.[activeCaptionPlatform]
      ? effectivePack[activeCaptionPlatform]
      : post.text;
  const captionWasEdited = editedText !== sourceCaptionForActive;
  const activeDisclosures = (
    captionWasEdited
      ? captionAnalysis.disclosures
      : (disclosureOverride?.text ?? post.disclosures ?? "")
  ).trim();
  const activeDisclosureCategories = captionWasEdited
    ? captionAnalysis.disclosureCategories
    : (disclosureOverride?.categories ?? post.disclosureCategories ?? []);
  const appendDisclosures = (caption: string): string => {
    const cap = caption.trim();
    if (!activeDisclosures) return cap;
    return `${cap}\n\n${
      activeDisclosures.startsWith("— Disclosures —")
        ? activeDisclosures
        : `— Disclosures —\n${activeDisclosures}`
    }`;
  };
  const captionWithDisclosures = appendDisclosures(editedText);

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

  /** Pack captions (with local overrides) + disclosures for ShareDialog. */
  const sharePlatformCaptions = useMemo(() => {
    if (!effectivePack) return undefined;
    const baseDisc = (post.disclosures ?? "").trim();
    const out: Record<string, string> = {};
    for (const [id, cap] of Object.entries(effectivePack)) {
      // Active platform: use live editor text (includes in-progress edits)
      const base =
        id === activeCaptionPlatform
          ? editedText.trim()
          : cap?.trim();
      if (!base) continue;
      if (!baseDisc) {
        out[id] = base;
      } else {
        out[id] = `${base}\n\n${
          baseDisc.startsWith("— Disclosures —")
            ? baseDisc
            : `— Disclosures —\n${baseDisc}`
        }`;
      }
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }, [
    effectivePack,
    post.disclosures,
    activeCaptionPlatform,
    editedText,
  ]);

  const selectCaptionPlatform = useCallback(
    (platformId: string | null) => {
      // Flush current editor into pack before switching
      if (activeCaptionPlatform && editedText.trim()) {
        setPackOverrides((prev) => ({
          ...prev,
          [activeCaptionPlatform]: editedText.trim(),
        }));
      }
      const pack = { ...(post.platformCaptions || {}), ...packOverrides };
      const nextText =
        platformId && pack[platformId] ? pack[platformId] : post.text;
      setActiveCaptionPlatform(platformId);
      setEditedText(nextText);
      setTextHistory([nextText]);
      setHistoryIndex(0);
      setHasCopiedCaption(false);
      triggerHapticFeedback();
    },
    [
      activeCaptionPlatform,
      editedText,
      packOverrides,
      post.platformCaptions,
      post.text,
    ],
  );

  const handleCopy = async () => {
    triggerHapticFeedback();
    if (deliveryLocked) {
      toast.warning(deliveryGateMessage);
      return;
    }
    let success = false;
    const textToCopy = captionWithDisclosures;
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

  const handleImageAction = async (
    action: () => Promise<void>,
    messages: string[] = [
      "Updating image...",
      "Polishing details...",
      "Almost there...",
    ],
  ) => {
    setIsImageLoading(true);
    setImageLoadingMessage(messages[0] || "Updating Image...");
    setImageLoadingProgress(8);

    let messageIndex = 0;
    const intervalId = setInterval(() => {
      messageIndex = (messageIndex + 1) % messages.length;
      setImageLoadingMessage(messages[messageIndex] || "Working...");
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
      setImageLoadingMessage("Updating Image...");
    }
  };

  const handleTextAction = async (action: () => Promise<void>) => {
    setIsTextLoading(true);
    try {
      await action();
    } finally {
      setIsTextLoading(false);
    }
  };

  const handleTextEditSubmit = async (prompt: string) => {
    await handleTextAction(() => onEditText(prompt));
    setIsTextEditing(false); // Close modal after action completes
  };

  const startVideoJob = async (
    style: VideoStyle,
    options: VideoRequestOptions,
    existingJobId?: string,
  ) => {
    setIsVideoLoading(true);

    const messages = [
      "Setting up the virtual studio...",
      "Directing the AI animator...",
      "Adding special effects...",
      "Rendering the final cut...",
      "This can take a minute or two...",
    ];
    let messageIndex = 0;
    let allowRotation = true;
    setVideoLoadingMessage(messages[messageIndex]);
    const intervalId = setInterval(() => {
      if (!allowRotation) return;
      messageIndex = (messageIndex + 1) % messages.length;
      setVideoLoadingMessage(messages[messageIndex]);
    }, 4000);

    const jobId = existingJobId || `video-${Date.now()}`;
    if (!existingJobId) {
      setVideoJobs((prev) => [
        ...prev,
        {
          id: jobId,
          style,
          status: "queued",
          duration: options.durationSeconds,
          soundtrack: options.soundtrack,
          aspectPreference: options.aspectPreference,
          resolution: options.resolution,
          pacing: options.pacing,
          createdAt: new Date().toISOString(),
        },
      ]);
    }

    // Mark job as processing
    setVideoJobs((prev) =>
      prev.map((job) =>
        job.id === jobId
          ? { ...job, status: "processing", error: undefined }
          : job,
      ),
    );

    const maxAttempts = 3;
    const runAttempt = async (attempt: number): Promise<void> => {
      try {
        const url = await onGenerateVideo(style, options);
        setVideoUrl((prev) => prev || url); // auto-open the first available video
        setVideoJobs((prev) =>
          prev.map((job) =>
            job.id === jobId ? { ...job, status: "completed", url } : job,
          ),
        );
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
            job.id === jobId
              ? { ...job, status: "failed", error: finalMessage }
              : job,
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
      setIsVideoLoading(false);
      clearInterval(intervalId);
    }
  };

  const handleGenerateVideo = async (
    style: VideoStyle,
    options: VideoRequestOptions,
  ) => {
    setIsVideoDirectorOpen(false);
    await startVideoJob(style, options);
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
    await startVideoJob(job.style, options, jobId);
  };

  const handleRemoveVideoJob = (jobId: string) => {
    setVideoJobs((prev) => prev.filter((job) => job.id !== jobId));
  };

  const hasWorkAtRisk =
    !hasSavedMedia ||
    !hasCopiedCaption ||
    captionWasEdited ||
    imageEditPrompt.trim().length > 0 ||
    videoJobs.length > 0;

  const requestLeaveResult = (mode: "startOver" | "remix") => {
    triggerHapticFeedback();
    if (imageBusy || textBusy) {
      toast.warning(
        mode === "remix"
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

  const confirmLeaveResult = () => {
    const mode = leaveConfirm;
    setLeaveConfirm(null);
    if (mode === "remix") onRemix();
    else if (mode === "startOver") onStartOver();
  };

  return (
    <>
      <Suspense fallback={null}>
        <LazyImagePreviewModal
          isOpen={isPreviewOpen && !videoUrl}
          onClose={() => setIsPreviewOpen(false)}
          imageSrc={post.image}
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
        onClose={() => setIsShareDialogOpen(false)}
        content={{
          text: captionWithDisclosures,
          imageDataUrl: post.image,
          videoUrl: videoUrl || undefined,
        }}
        platformCaptions={sharePlatformCaptions}
        selectedPlatformIds={post.platformIds}
      />
      <Modal
        isOpen={leaveConfirm !== null}
        onClose={() => setLeaveConfirm(null)}
        size="sm"
        title={
          leaveConfirm === "remix"
            ? "Remix this photo?"
            : "Create another post?"
        }
        description="This result is not fully preserved yet."
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setLeaveConfirm(null)}
              fullWidth
            >
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
          isOpen={isCaptionAltsOpen && !creativeLockedForReview}
          onClose={() => setIsCaptionAltsOpen(false)}
          generateOne={onGenerateCaptionVariant}
          bannedPhrases={bannedPhrases}
          onSelect={({ text, disclosures, disclosureCategories }) => {
            handleTextChange(text);
            setDisclosureOverride({
              text: disclosures,
              categories: disclosureCategories,
            });
          }}
        />
      )}

      <Suspense fallback={null}>
        <LazyEditTextModal
          isOpen={isTextEditing && !creativeLockedForReview}
          onClose={() => setIsTextEditing(false)}
          onSubmit={handleTextEditSubmit}
          originalText={post.text}
          isLoading={isTextLoading}
        />
      </Suspense>
      <Suspense fallback={null}>
        <LazyVideoDirectorModal
          isOpen={isVideoDirectorOpen && !creativeLockedForReview}
          onClose={() => setIsVideoDirectorOpen(false)}
          onSelectStyle={handleGenerateVideo}
        />
      </Suspense>
      <Suspense fallback={null}>
        <LazyFunModeDirectorModal
          isOpen={isFunModeDirectorOpen && !creativeLockedForReview}
          onClose={() => setIsFunModeDirectorOpen(false)}
          enabledFunStyles={enabledFunStyles}
          onSelectStyle={(styleName) => {
            setIsFunModeDirectorOpen(false);
            handleImageAction(
              () => onFunMode(styleName),
              [
                "Queuing fun mode style...",
                "Illustrating with your photo reference...",
                "Polishing colors and details...",
              ],
            );
          }}
        />
      </Suspense>
      <motion.section
        className={cn(
          "mx-auto w-full max-w-screen-2xl flex-1 space-y-4 px-0 py-3 sm:space-y-5 sm:px-2 sm:py-5 md:px-4 md:py-6",
          // Room for the fixed mobile delivery bar + home-indicator inset.
          !isDesktopLayout && "pb-[calc(5.75rem+env(safe-area-inset-bottom))]",
        )}
        initial={shouldReduceMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: shouldReduceMotion ? 0 : 0.3 }}
        aria-busy={imageBusy || textBusy}
      >
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary-300">
              <CircleCheck className="h-4 w-4" aria-hidden="true" />
              Post workspace
            </div>
            <h2 className="text-2xl font-semibold tracking-tight text-surface-50 sm:text-3xl">
              {claimLocked
                ? "Caption claim needs attention"
                : releaseLocked
                  ? "Photo release needs attention"
                  : requiresApproval
                    ? approvalStatus === "approved"
                      ? "Approved and ready to publish"
                      : approvalStatus === "rejected"
                        ? "Manager requested changes"
                        : "Ready for manager review"
                    : "Ready to publish"}
            </h2>
            <p className="mt-1 text-sm text-surface-400">
              Review the media and caption, then copy, share, or save.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 self-stretch sm:self-auto">
            <button
              type="button"
              onClick={handleRemixRequest}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-primary-400/35 bg-primary-500/10 px-4 text-sm font-semibold text-primary-100 transition-colors hover:border-primary-400/55 hover:bg-primary-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/70 sm:min-h-[44px] sm:flex-none"
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              Remix this photo
            </button>
            <button
              type="button"
              onClick={handleCreateAnotherRequest}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-surface-200 transition-colors hover:border-white/20 hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/70 sm:min-h-[44px] sm:flex-none"
            >
              <Camera className="h-4 w-4" aria-hidden="true" />
              New photo
            </button>
          </div>
        </header>
        {claimLocked && (
          <motion.div
            id="caption-compliance-alert"
            className="mx-auto flex max-w-3xl gap-3 rounded-2xl border border-error-500/30 bg-error-500/10 px-4 py-4 text-error-100 shadow-lg shadow-black/10"
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
          </motion.div>
        )}
        {releaseLocked && (
          <motion.div
            className="mx-auto flex max-w-3xl gap-3 rounded-2xl border border-error-500/30 bg-error-500/10 px-4 py-4 text-error-100 shadow-lg shadow-black/10"
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
                <p className="font-semibold">Photo release not saved</p>
                <Badge variant="error" uppercase={false}>
                  Delivery locked
                </Badge>
              </div>
              <p className="mt-1 text-sm leading-relaxed opacity-80">
                {releaseGateMessage}
              </p>
            </div>
          </motion.div>
        )}
        {requiresApproval && (
          <motion.div
            className={cn(
              "mx-auto flex max-w-3xl flex-col gap-3 rounded-2xl px-4 py-4 shadow-lg shadow-black/10 sm:flex-row sm:items-start",
              approvalStatus === "approved"
                ? "border border-success-500/30 bg-success-500/10 text-success-100"
                : approvalStatus === "pending"
                  ? "border border-warning-500/30 bg-warning-500/10 text-warning-100"
                  : "border border-error-500/30 bg-error-500/10 text-error-100",
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
          </motion.div>
        )}
        {error && (
          <motion.div
            className="mb-4 bg-error-900/50 border border-error-700 text-error-300 px-4 py-3 rounded-xl flex items-center justify-center gap-2 backdrop-blur-sm"
            initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.3 }}
          >
            <AlertCircle className="w-5 h-5" />
            <span>{error}</span>
          </motion.div>
        )}
        <div
          className={`grid w-full ${
            isDesktopLayout
              ? "grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-8"
              : "grid-cols-1 gap-6"
          }`}
        >
          <section
            className="flex flex-col items-center space-y-4 rounded-2xl border border-white/10 bg-white/[0.04] p-3 shadow-2xl shadow-black/20 sm:p-4"
            aria-labelledby="media-preview-heading"
            aria-busy={imageBusy}
          >
            <div className="flex w-full items-center justify-between px-1">
              <h3
                id="media-preview-heading"
                className="text-sm font-semibold text-surface-100"
              >
                Media preview
              </h3>
              <Badge variant={videoUrl ? "info" : "neutral"} uppercase={false}>
                {videoUrl ? "Video" : "Image"}
              </Badge>
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

              {videoUrl ? (
                <video
                  src={videoUrl}
                  controls
                  autoPlay={!shouldReduceMotion}
                  loop={!shouldReduceMotion}
                  muted
                  className="max-h-[70dvh] w-full rounded-xl object-contain shadow-2xl"
                />
              ) : (
                <button
                  onClick={() => {
                    triggerHapticFeedback();
                    setIsPreviewOpen(true);
                  }}
                  className="w-full block rounded-xl overflow-hidden focus:outline-none focus:ring-4 focus:ring-primary-500/50 transition-all hover:ring-2 hover:ring-primary-400/30"
                  aria-label="Enlarge image"
                >
                  <ProgressiveImage
                    src={post.image}
                    alt="Generated social media post"
                    className="max-h-[70dvh] w-full rounded-xl object-contain shadow-2xl"
                  />
                </button>
              )}
            </div>

            {imageVersions.length > 0 && !videoUrl && !creativeLockedForReview ? (
              <div className="w-full">
                <p className="mb-1.5 text-[10px] uppercase tracking-wide text-surface-500">
                  Previous versions — tap to restore
                </p>
                <div className="flex gap-2 overflow-x-auto pb-1">
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
                          return current
                            ? [current, ...rest].slice(0, 5)
                            : rest.slice(0, 5);
                        });
                      }}
                      className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-white/15 bg-surface-950 ring-offset-2 ring-offset-surface-900 hover:ring-2 hover:ring-primary-400/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                      aria-label={`Restore previous image version ${i + 1}`}
                    >
                      <img
                        src={url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="w-full space-y-3">
              <button
                type="button"
                onClick={() => setIsToolsOpen((open) => !open)}
                aria-expanded={isToolsOpen}
                aria-controls="creative-tools-panel"
                className="flex min-h-[48px] w-full items-center gap-3 rounded-xl border border-white/10 bg-surface-950/35 px-3 text-left transition-colors hover:border-white/20 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/70"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-500/15 text-primary-300">
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-surface-100">
                    Creative tools
                  </span>
                  <span className="block truncate text-xs text-surface-400">
                    Optional image, caption, video, and export controls
                  </span>
                </span>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 shrink-0 text-surface-400 transition-transform",
                    isToolsOpen && "rotate-180",
                  )}
                  aria-hidden="true"
                />
              </button>

              <div
                id="creative-tools-panel"
                data-testid="creative-tools-panel"
                hidden={!isToolsOpen}
                className={cn(
                  "grid grid-cols-2 gap-2 lg:grid-cols-3",
                  !isToolsOpen && "hidden",
                )}
              >
                <ActionTile
                  icon={Film}
                  iconClassName={TILE_ICON_ACCENT}
                  tooltip="Turn your image into a video"
                  disabled={
                    imageBusy || isVideoLoading || creativeLockedForReview
                  }
                  busy={isVideoLoading}
                  label={
                    isVideoLoading
                      ? "Rendering…"
                      : videoUrl
                        ? "New video"
                        : "Animate with AI"
                  }
                  onClick={() => setIsVideoDirectorOpen(true)}
                />

                <ActionTile
                  icon={LayoutGrid}
                  iconClassName="text-amber-300"
                  tooltip={
                    deliveryLocked
                      ? deliveryGateMessage
                      : "Export Story, Feed, Marketplace & Google sizes — full creative, no crop"
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
                  tooltip="Generate a new image version"
                  disabled={imageBusy || !!videoUrl || creativeLockedForReview}
                  busy={imageBusy}
                  label={imageBusy ? "Updating image..." : "Regenerate image"}
                  onClick={() => {
                    void handleImageAction(onRegenerateImage, [
                      "Refreshing with your chosen style...",
                      "Balancing lighting and color...",
                      "Finishing touches...",
                    ]).catch(() => undefined);
                  }}
                />

                <ActionTile
                  icon={Edit3}
                  iconClassName={TILE_ICON_ACCENT}
                  tooltip="Change specific details"
                  disabled={imageBusy || !!videoUrl || creativeLockedForReview}
                  busy={imageBusy}
                  label={
                    imageBusy
                      ? "Updating image..."
                      : isImageEditing
                        ? "Cancel"
                        : "AI image edit"
                  }
                  onClick={() => setIsImageEditing(!isImageEditing)}
                />

                <ActionTile
                  icon={RefreshCw}
                  iconClassName="text-surface-300"
                  tooltip="Generate a new caption"
                  disabled={textBusy || creativeLockedForReview}
                  busy={textBusy}
                  label={
                    textBusy ? "Updating caption..." : "Regenerate caption"
                  }
                  onClick={() => {
                    void handleTextAction(onRegenerateText).catch(
                      () => undefined,
                    );
                  }}
                />

                <ActionTile
                  icon={Edit3}
                  iconClassName={TILE_ICON_ACCENT}
                  tooltip="Describe a caption change"
                  disabled={textBusy || creativeLockedForReview}
                  busy={textBusy}
                  label={textBusy ? "Updating caption..." : "AI caption edit"}
                  onClick={() => setIsTextEditing(true)}
                />

                {onGenerateCaptionVariant ? (
                  <ActionTile
                    icon={Sparkles}
                    iconClassName={TILE_ICON_ACCENT}
                    tooltip="Generate three caption options"
                    disabled={textBusy || creativeLockedForReview}
                    label="Three caption ideas"
                    onClick={() => setIsCaptionAltsOpen(true)}
                  />
                ) : null}

                <ActionTile
                  icon={Sparkles}
                  iconClassName="text-primary-300"
                  tooltip="Artistic style (optional — may change the look)"
                  disabled={imageBusy || !!videoUrl || creativeLockedForReview}
                  busy={imageBusy}
                  label={imageBusy ? "Working..." : "Fun mode"}
                  onClick={() => setIsFunModeDirectorOpen(true)}
                />
              </div>
              <AnimatePresence>
                {isToolsOpen && isImageEditing && (
                  <motion.div
                    className="space-y-2 rounded-xl border border-white/10 bg-surface-800/50 p-3"
                    initial={
                      shouldReduceMotion ? false : { opacity: 0, height: 0 }
                    }
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
                  </motion.div>
                )}
              </AnimatePresence>
              {isToolsOpen && videoJobs.length > 0 && (
                <motion.div
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
                      {
                        videoJobs.filter((job) => job.status === "processing")
                          .length
                      }{" "}
                      active
                    </span>
                  </div>
                  <ul
                    className="space-y-2"
                    role="list"
                    aria-label="Video queue list"
                  >
                    {videoJobs.map((job) => (
                      <motion.li
                        key={job.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-surface-900/40 px-3 py-2 text-xs"
                        initial={
                          shouldReduceMotion
                            ? false
                            : { opacity: 0, scale: 0.95 }
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
                              onClick={() => setVideoUrl(job.url || null)}
                              className="text-[10px] font-semibold uppercase tracking-wide text-primary-200 hover:text-surface-50 transition-colors"
                            >
                              Preview
                            </button>
                          )}
                          {job.status === "failed" && (
                            <button
                              onClick={() => handleRetryVideo(job.id)}
                              className="text-[10px] font-semibold uppercase tracking-wide text-amber-200 hover:text-amber-50 transition-colors"
                            >
                              Retry
                            </button>
                          )}
                          <button
                            onClick={() => handleRemoveVideoJob(job.id)}
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
                      </motion.li>
                    ))}
                  </ul>
                </motion.div>
              )}
            </div>
          </section>

          <motion.section
            className="flex flex-col rounded-2xl border border-white/10 bg-surface-900/70 p-4 backdrop-blur-lg lg:p-6"
            initial={shouldReduceMotion ? false : { opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{
              delay: shouldReduceMotion ? 0 : 0.12,
              duration: shouldReduceMotion ? 0 : 0.3,
            }}
            aria-labelledby="caption-delivery-heading"
            aria-busy={textBusy}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3
                  id="caption-delivery-heading"
                  className="text-xl font-semibold text-surface-50"
                >
                  Caption and delivery
                </h3>
                <p className="mt-0.5 text-xs text-surface-400">
                  {creativeLockedForReview
                    ? "Review copy is locked to the exact creative submitted to the manager."
                    : "Edit directly. Required disclosures stay attached automatically."}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={handleUndo}
                  disabled={historyIndex === 0 || creativeLockedForReview}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-surface-200 transition-colors hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/70 disabled:cursor-not-allowed disabled:opacity-30"
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
                    creativeLockedForReview
                  }
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-surface-200 transition-colors hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/70 disabled:cursor-not-allowed disabled:opacity-30"
                  title="Redo (Ctrl+Y)"
                  aria-label="Redo caption change"
                >
                  <Redo2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            {platformCaptionTabs.length > 0 && (
              <div
                className="mb-3 flex flex-wrap gap-2"
                role="tablist"
                aria-label="Platform captions"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeCaptionPlatform === null}
                  onClick={() => selectCaptionPlatform(null)}
                  className={cn(
                    "min-h-[36px] rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/70",
                    activeCaptionPlatform === null
                      ? "border-primary-400/50 bg-primary-500/20 text-primary-100"
                      : "border-white/10 bg-white/[0.04] text-surface-300 hover:border-white/20 hover:bg-white/[0.08]",
                  )}
                >
                  Primary
                </button>
                {platformCaptionTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={activeCaptionPlatform === tab.id}
                    onClick={() => selectCaptionPlatform(tab.id)}
                    className={cn(
                      "min-h-[36px] rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
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
            )}

            <div className="relative mb-4">
              {isTextLoading && <BusyOverlay message="Updating caption..." />}
              {captionWasEdited && (
                <div className="mb-2 flex items-center gap-2 text-xs text-warning-300">
                  <Edit3 className="w-3 h-3" />
                  <span>Text has been edited</span>
                </div>
              )}
              <textarea
                aria-label="Generated social post text"
                aria-invalid={claimLocked || undefined}
                aria-describedby={
                  claimLocked ? "caption-compliance-alert" : undefined
                }
                value={editedText}
                onChange={(e) => handleTextChange(e.target.value)}
                disabled={isTextLoading || creativeLockedForReview}
                className={cn(
                  "h-48 w-full lg:h-60 lg:max-h-[24rem]",
                  "bg-surface-800/50 text-surface-300 p-4 rounded-xl text-sm",
                  "resize-y border-2 border-transparent leading-relaxed",
                  "focus:border-primary-400 focus:ring-2 focus:ring-primary-400",
                  "outline-none transition-all duration-300",
                )}
              />
            </div>

            {/* Desktop: delivery actions sit with the caption panel. */}
            {isDesktopLayout ? (
              <div
                className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3"
                aria-label="Post delivery actions"
              >
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
                    {deliveryLocked
                      ? deliveryLockLabel
                      : copied
                        ? "Copied"
                        : "Copy caption"}
                  </span>
                </Button>
                <Button
                  variant="filled"
                  onClick={() => {
                    if (deliveryLocked) {
                      toast.warning(deliveryGateMessage);
                      return;
                    }
                    setIsShareDialogOpen(true);
                  }}
                  disabled={deliveryLocked}
                  aria-label={
                    deliveryLocked
                      ? `Share post (${deliveryLockLabel.toLowerCase()})`
                      : "Share post"
                  }
                  leftIcon={<Share2 className="h-4 w-4" />}
                  fullWidth
                >
                  {deliveryLocked ? deliveryLockLabel : "Share post"}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleSave}
                  disabled={imageBusy || deliveryLocked}
                  loading={imageBusy}
                  aria-label={
                    deliveryLocked
                      ? `Save ${videoUrl ? "video" : "image"} (${deliveryLockLabel.toLowerCase()})`
                      : `Save ${videoUrl ? "video" : "image"}`
                  }
                  leftIcon={<Download className="h-4 w-4" />}
                  className="border-success-500/35 text-success-100 hover:border-success-400/60 hover:bg-success-500/10"
                  fullWidth
                  disableHaptics
                >
                  {deliveryLocked
                    ? deliveryLockLabel
                    : `Save ${videoUrl ? "video" : "image"}`}
                </Button>
              </div>
            ) : null}

            {requiresApproval ? (
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
              className="mb-4"
            />

            {/* Locked compliance disclosure block. Read-only so a salesperson
                can't silently delete it. Bundled with the caption automatically
                on copy/share. Media downloads remain media-only. */}
            {activeDisclosures && (
              <motion.div
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
              </motion.div>
            )}
          </motion.section>
        </div>
      </motion.section>

      {/* Mobile/narrow: sticky bottom delivery bar (Copy · Share · Save).
          Creative tools stay collapsed above; desktop keeps in-panel CTAs. */}
      {!isDesktopLayout ? (
        <div
          className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-surface-950/95 shadow-[0_-8px_24px_rgba(0,0,0,0.35)] backdrop-blur-md"
          style={{
            paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))",
            paddingLeft: "env(safe-area-inset-left)",
            paddingRight: "env(safe-area-inset-right)",
          }}
        >
          <div
            className="mx-auto grid max-w-lg grid-cols-3 gap-2 px-3 pt-2"
            aria-label="Post delivery actions"
          >
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
                {deliveryLocked ? deliveryLockLabel : copied ? "Copied" : "Copy"}
              </span>
            </Button>
            <Button
              variant="filled"
              onClick={() => {
                if (deliveryLocked) {
                  toast.warning(deliveryGateMessage);
                  return;
                }
                setIsShareDialogOpen(true);
              }}
              disabled={deliveryLocked}
              aria-label={
                deliveryLocked
                  ? `Share post (${deliveryLockLabel.toLowerCase()})`
                  : "Share post"
              }
              leftIcon={<Share2 className="h-4 w-4" />}
              fullWidth
            >
              {deliveryLocked ? deliveryLockLabel : "Share"}
            </Button>
            <Button
              variant="outline"
              onClick={handleSave}
              disabled={imageBusy || deliveryLocked}
              loading={imageBusy}
              aria-label={
                deliveryLocked
                  ? `Save ${videoUrl ? "video" : "image"} (${deliveryLockLabel.toLowerCase()})`
                  : `Save ${videoUrl ? "video" : "image"}`
              }
              leftIcon={<Download className="h-4 w-4" />}
              className="border-success-500/35 text-success-100 hover:border-success-400/60 hover:bg-success-500/10"
              fullWidth
              disableHaptics
            >
              {deliveryLocked ? deliveryLockLabel : "Save"}
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
};
