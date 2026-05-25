import React, { useState, useEffect, useCallback, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  RefreshCw,
  Edit3,
  Sparkles,
  Download,
  Film,
  RotateCcw,
  Share2,
  Copy,
  Check,
  AlertCircle,
  Loader2,
  Undo2,
  Redo2,
} from "lucide-react";
import confetti from "canvas-confetti";
import { Tooltip } from "./ui/Tooltip";
import { GeneratedPost, VideoStyle, VideoRequestOptions } from "../types";
import { dataUrlToBlob } from "../utils/imageUtils";
import { triggerHapticFeedback } from "../utils/haptics";
import { Badge } from "./ui/Badge";
import { cn } from "../utils/classNames";
import { ProgressBar } from "./ui/ProgressBar";
import { normalizeError, recoveryHint } from "../utils/errorHandler";
import { ProgressiveImage } from "./ui/ProgressiveImage";
import { useTouchGestures } from "../hooks/useTouchGestures";
import { usePullToRefresh } from "../hooks/usePullToRefresh";

// Lazy load modals for performance
const LazyImagePreviewModal = React.lazy(() =>
  import("./ImagePreviewModal").then((mod) => ({ default: mod.ImagePreviewModal }))
);
const LazyEditTextModal = React.lazy(() =>
  import("./EditTextModal").then((mod) => ({ default: mod.EditTextModal }))
);
const LazyVideoDirectorModal = React.lazy(() =>
  import("./VideoDirectorModal").then((mod) => ({ default: mod.VideoDirectorModal }))
);
const LazyFunModeDirectorModal = React.lazy(() =>
  import("./FunModeDirectorModal").then((mod) => ({ default: mod.FunModeDirectorModal }))
);

interface PostResultProps {
  post: GeneratedPost;
  onStartOver: () => void;
  onRegenerateImage: () => Promise<void>;
  onEditImage: (prompt: string) => Promise<void>;
  onRegenerateText: () => Promise<void>;
  onEditText: (prompt: string) => Promise<void>;
  onFunMode: (styleName?: string) => Promise<void>;
  onGenerateVideo: (
    style: VideoStyle,
    options: VideoRequestOptions
  ) => Promise<string>;
  error?: string | null;
  isDesktopLayout: boolean;
}

const LoadingOverlay: React.FC<{ message: string; progress?: number }> =
  React.memo(({ message, progress }) => (
    <div className="absolute inset-0 bg-surface-900/80 backdrop-blur-sm flex flex-col items-center justify-center rounded-lg z-10 px-4">
      <Loader2 className="h-12 w-12 text-primary-400 animate-spin mb-4" />
      <p className="text-surface-50 font-semibold animate-pulse mb-2 text-center">
        {message}
      </p>
      {typeof progress === "number" && progress > 0 && (
        <div className="w-full max-w-sm">
          <ProgressBar value={progress} />
        </div>
      )}
    </div>
  ));

export const PostResult: React.FC<PostResultProps> = ({
  post,
  onStartOver,
  onRegenerateImage,
  onEditImage,
  onRegenerateText,
  onEditText,
  onFunMode,
  onGenerateVideo,
  error,
  isDesktopLayout,
}) => {
  const [copied, setCopied] = useState(false);

  const [isImageEditing, setIsImageEditing] = useState(false);
  const [imageEditPrompt, setImageEditPrompt] = useState("");
  const [isImageLoading, setIsImageLoading] = useState(false);
  const [imageLoadingMessage, setImageLoadingMessage] =
    useState("Updating Image...");
  const [imageLoadingProgress, setImageLoadingProgress] = useState(0);

  const [editedText, setEditedText] = useState(post.text);
  const [isTextEditing, setIsTextEditing] = useState(false);
  const [isTextLoading, setIsTextLoading] = useState(false);

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
  const [isSharing, setIsSharing] = useState(false);
  const imageBusy = isImageLoading || isVideoLoading;
  const textBusy = isTextLoading;

  // Swipe gesture for returning to home/start over on mobile
  const touchHandlers = useTouchGestures({
    onSwipeRight: () => {
      triggerHapticFeedback();
      onStartOver();
    }
  });

  // Pull down gesture to regenerate a new design/post automatically
  const { pullDistance, shouldRefresh, handlers: pullHandlers } = usePullToRefresh({
    onRefresh: async () => {
      triggerHapticFeedback();
      await handleImageAction(onRegenerateImage, [
        "Refreshing with your chosen style...",
        "Balancing lighting and color...",
        "Finishing touches...",
      ]);
    }
  });

  // Combine both swipe and pull touch handlers safely
  const combinedTouchHandlers = {
    onTouchStart: (e: React.TouchEvent) => {
      touchHandlers.onTouchStart(e.nativeEvent);
      pullHandlers.onTouchStart(e.nativeEvent);
    },
    onTouchMove: (e: React.TouchEvent) => {
      touchHandlers.onTouchMove(e.nativeEvent);
      pullHandlers.onTouchMove(e.nativeEvent);
    },
    onTouchEnd: (e: React.TouchEvent) => {
      touchHandlers.onTouchEnd();
      pullHandlers.onTouchEnd();
    }
  };

  useEffect(() => {
    setEditedText(post.text);
    setTextHistory([post.text]);
    setHistoryIndex(0);
  }, [post.text]);

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
      // Add to history, removing any future history if we're not at the end
      const newHistory = textHistory.slice(0, historyIndex + 1);
      newHistory.push(newText);
      setTextHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
    },
    [historyIndex, textHistory]
  );

  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setEditedText(textHistory[newIndex]);
      triggerHapticFeedback();
    }
  }, [historyIndex, textHistory]);

  const handleRedo = useCallback(() => {
    if (historyIndex < textHistory.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setEditedText(textHistory[newIndex]);
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

  const handleSave = async () => {
    triggerHapticFeedback();
    const link = document.createElement("a");

    if (videoUrl) {
      link.href = videoUrl;
      link.download = "social-media-video.mp4";
    } else {
      link.href = post.image;
      link.download = "social-media-post.jpg";
    }

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Trigger confetti
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
      colors: ["#38bdf8", "#818cf8", "#c084fc", "#e879f9"],
    });
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

  const handleCopy = async () => {
    triggerHapticFeedback();
    let success = false;
    const textToCopy = editedText;
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
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      confetti({
        particleCount: 50,
        spread: 50,
        origin: { y: 0.7 },
        gravity: 1.2,
      });
    }
  };

  const handleShare = async () => {
    triggerHapticFeedback();
    const textToCopy = editedText;
    const textForShareAPI = textToCopy.trim();
    setIsSharing(true);

    let copySuccess = false;
    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(textToCopy);
        copySuccess = true;
      } catch (err) {
        copySuccess = synchronousCopy(textToCopy);
      }
    } else {
      copySuccess = synchronousCopy(textToCopy);
    }

    if (copySuccess) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }

    try {
      const mediaUrl = videoUrl || post.image;
      const mediaBlob = await (await fetch(mediaUrl)).blob();
      const fileName = videoUrl
        ? "social-media-video.mp4"
        : "social-media-post.jpg";
      const file = new File([mediaBlob], fileName, { type: mediaBlob.type });

      const shareData = {
        title: "New Car Celebration!",
        text: textForShareAPI,
        files: [file],
      };

      if (navigator.share && navigator.canShare(shareData)) {
        await navigator.share(shareData);
      } else {
        alert(
          "Web Share is not supported on your device, but the post text has been copied to your clipboard!"
        );
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        // User cancelled the share dialog, do nothing.
      } else {
        console.error("Sharing failed:", error);
        alert(
          "Could not open the share dialog, but the post text has been copied to your clipboard!"
        );
      }
    } finally {
      setIsSharing(false);
    }
  };

  const handleImageAction = async (
    action: () => Promise<void>,
    messages: string[] = [
      "Updating image...",
      "Polishing details...",
      "Almost there...",
    ]
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
    existingJobId?: string
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
          : job
      )
    );

    const maxAttempts = 3;
    const runAttempt = async (attempt: number): Promise<void> => {
      try {
        const url = await onGenerateVideo(style, options);
        setVideoUrl((prev) => prev || url); // auto-open the first available video
        setVideoJobs((prev) =>
          prev.map((job) =>
            job.id === jobId ? { ...job, status: "completed", url } : job
          )
        );
      } catch (error) {
        const normalized = normalizeError(error);
        const retryDelay =
          attempt < maxAttempts && normalized.retryable ? attempt * 8000 : 0;
        const attemptMessage = `Attempt ${attempt} failed: ${normalized.message}`;

        if (retryDelay > 0) {
          allowRotation = false;
          setVideoLoadingMessage(
            `${attemptMessage}. Retrying in ${retryDelay / 1000}s...`
          );
          setVideoJobs((prev) =>
            prev.map((job) =>
              job.id === jobId
                ? { ...job, status: "queued", error: attemptMessage }
                : job
            )
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
              : job
          )
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
    options: VideoRequestOptions
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

  return (
    <>
      {pullDistance > 0 && (
        <div 
          className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center pointer-events-none transition-opacity duration-150"
          style={{ 
            transform: `translateY(${Math.min(pullDistance / 2, 40)}px)`,
            opacity: Math.min(pullDistance / 80, 1)
          }}
        >
          <div className="bg-surface-900/90 border border-white/10 backdrop-blur-md px-4 py-2 rounded-full flex items-center gap-2 shadow-lg">
            <RefreshCw 
              className={cn(
                "w-4 h-4 text-primary-400 transition-transform", 
                shouldRefresh ? "rotate-180 scale-110 text-success-400 animate-spin" : "rotate-0 scale-100"
              )} 
            />
            <span className="text-xs font-semibold text-surface-200">
              {shouldRefresh ? "Release to Regenerate" : "Pull down to Regenerate"}
            </span>
          </div>
        </div>
      )}

      <Suspense fallback={null}>
        <LazyImagePreviewModal
          isOpen={isPreviewOpen && !videoUrl}
          onClose={() => setIsPreviewOpen(false)}
          imageSrc={post.image}
        />
      </Suspense>
      <Suspense fallback={null}>
        <LazyEditTextModal
          isOpen={isTextEditing}
          onClose={() => setIsTextEditing(false)}
          onSubmit={handleTextEditSubmit}
          originalText={post.text}
          isLoading={isTextLoading}
        />
      </Suspense>
      <Suspense fallback={null}>
        <LazyVideoDirectorModal
          isOpen={isVideoDirectorOpen}
          onClose={() => setIsVideoDirectorOpen(false)}
          onSelectStyle={handleGenerateVideo}
        />
      </Suspense>
      <Suspense fallback={null}>
        <LazyFunModeDirectorModal
          isOpen={isFunModeDirectorOpen}
          onClose={() => setIsFunModeDirectorOpen(false)}
          onSelectStyle={(styleName) => {
            setIsFunModeDirectorOpen(false);
            handleImageAction(
              () => onFunMode(styleName),
              [
                "Queuing Fun Mode style...",
                "Illustrating with your photo reference...",
                "Polishing colors and details...",
              ]
            );
          }}
        />
      </Suspense>
      <motion.div
        className="flex-1 w-full max-w-screen-2xl mx-auto px-1 sm:px-4 md:px-6 py-4 sm:py-6 space-y-6 touch-pan-y"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
        {...combinedTouchHandlers}
      >
        <motion.h2
          className="text-3xl sm:text-4xl font-bold text-center text-surface-50"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.4 }}
        >
          Your Post is Ready!
        </motion.h2>
        {error && (
          <motion.div
            className="mb-4 bg-error-900/50 border border-error-700 text-error-300 px-4 py-3 rounded-xl flex items-center justify-center gap-2 backdrop-blur-sm"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
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
          <div className="flex flex-col items-center bg-white/5 p-4 rounded-2xl shadow-2xl space-y-4">
            <div className="relative w-full">
              {(isImageLoading || isVideoLoading) && (
                <LoadingOverlay
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
                  autoPlay
                  loop
                  muted
                  className="rounded-xl shadow-2xl w-full object-contain"
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
                    className="rounded-xl shadow-2xl w-full object-contain"
                  />
                </button>
              )}
            </div>

            <div className="w-full space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
                <Tooltip label="Get a new version" side="top">
                  <motion.button
                    onClick={() => {
                      triggerHapticFeedback();
                      handleImageAction(onRegenerateImage, [
                        "Refreshing with your chosen style...",
                        "Balancing lighting and color...",
                        "Finishing touches...",
                      ]);
                    }}
                    disabled={imageBusy || !!videoUrl}
                    className={cn(
                      "flex flex-col items-center justify-center gap-1 sm:gap-2 relative overflow-hidden",
                      "bg-white/10 border border-white/20 text-surface-50 font-bold",
                      "py-2 px-3 sm:py-3 sm:px-4 rounded-xl transition-all duration-300",
                      "text-[10px] sm:text-xs md:text-sm",
                      "min-h-[80px] sm:aspect-square",
                      "hover:bg-white/20 hover:border-white/30",
                      "disabled:opacity-50 disabled:cursor-not-allowed w-full"
                    )}
                    whileHover={{
                      scale: imageBusy ? 1 : 1.05,
                      y: imageBusy ? 0 : -2,
                    }}
                    whileTap={{ scale: imageBusy ? 1 : 0.95 }}
                  >
                    <span className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-0 hover:opacity-100 transition-opacity pointer-events-none" />
                    {imageBusy ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-5 h-5" />
                    )}
                    <span>{imageBusy ? "Working..." : "Regenerate"}</span>
                  </motion.button>
                </Tooltip>

                <Tooltip label="Change specific details" side="top">
                  <motion.button
                    onClick={() => {
                      triggerHapticFeedback();
                      setIsImageEditing(!isImageEditing);
                    }}
                    disabled={imageBusy || !!videoUrl}
                    className={cn(
                      "flex flex-col items-center justify-center gap-1 sm:gap-2 relative overflow-hidden",
                      "bg-gradient-to-r from-sky-500 to-primary-500 text-surface-50 font-bold",
                      "py-2 px-3 sm:py-3 sm:px-4 rounded-xl transition-all duration-300",
                      "text-[10px] sm:text-xs md:text-sm",
                      "min-h-[80px] sm:aspect-square",
                      "shadow-lg hover:shadow-glow-primary",
                      "disabled:opacity-50 disabled:cursor-not-allowed w-full"
                    )}
                    whileHover={{ scale: 1.05, y: -2 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    <span className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-0 hover:opacity-100 transition-opacity pointer-events-none" />
                    {imageBusy ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Edit3 className="w-5 h-5" />
                    )}
                    <span>
                      {imageBusy
                        ? "Working..."
                        : isImageEditing
                        ? "Cancel"
                        : "AI Image Edit"}
                    </span>
                  </motion.button>
                </Tooltip>

                <Tooltip label="Artistic transformations" side="top">
                  <motion.button
                    onClick={() => {
                      triggerHapticFeedback();
                      setIsFunModeDirectorOpen(true);
                    }}
                    disabled={imageBusy || !!videoUrl}
                    className={cn(
                      "flex flex-col items-center justify-center gap-1 sm:gap-2 relative overflow-hidden",
                      "bg-gradient-to-r from-purple-500 to-pink-500 text-surface-50 font-bold",
                      "py-2 px-3 sm:py-3 sm:px-4 rounded-xl transition-all duration-300",
                      "text-[10px] sm:text-xs md:text-sm",
                      "min-h-[80px] sm:aspect-square",
                      "shadow-lg hover:shadow-[0_0_25px_rgba(168,85,247,0.5)]",
                      "disabled:opacity-50 disabled:cursor-not-allowed w-full"
                    )}
                    whileHover={{ scale: 1.05, y: -2 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    <span className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-0 hover:opacity-100 transition-opacity pointer-events-none" />
                    {imageBusy ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Sparkles className="w-5 h-5" />
                    )}
                    <span>{imageBusy ? "Working..." : "Fun Mode"}</span>
                  </motion.button>
                </Tooltip>

                <Tooltip label="Download to your device" side="top">
                  <motion.button
                    onClick={handleSave}
                    disabled={imageBusy}
                    className={cn(
                      "flex flex-col items-center justify-center gap-2 relative overflow-hidden",
                      "bg-gradient-to-r from-success-500 to-emerald-600 text-surface-50 font-bold",
                      "py-3 px-4 rounded-xl transition-all duration-300",
                      "text-xs sm:text-sm aspect-square",
                      "shadow-lg hover:shadow-glow-success",
                      imageBusy && "opacity-70 cursor-not-allowed w-full"
                    )}
                    whileHover={{
                      scale: imageBusy ? 1 : 1.05,
                      y: imageBusy ? 0 : -2,
                    }}
                    whileTap={{ scale: imageBusy ? 1 : 0.95 }}
                  >
                    <span className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-0 hover:opacity-100 transition-opacity pointer-events-none" />
                    {imageBusy ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Download className="w-5 h-5" />
                    )}
                    <span>
                      {imageBusy
                        ? "Working..."
                        : `Save ${videoUrl ? "Video" : "Image"}`}
                    </span>
                  </motion.button>
                </Tooltip>

                <Tooltip label="Turn your image into a video" side="top">
                  <motion.button
                    onClick={() => {
                      triggerHapticFeedback();
                      setIsVideoDirectorOpen(true);
                    }}
                    disabled={imageBusy || isVideoLoading}
                    className={cn(
                      "flex flex-col items-center justify-center gap-2 relative overflow-hidden",
                      "bg-gradient-to-r from-primary-500 to-secondary-600 text-surface-50 font-bold",
                      "py-3 px-4 rounded-xl transition-all duration-300",
                      "text-xs sm:text-sm aspect-square",
                      "shadow-lg hover:shadow-glow-primary",
                      "disabled:opacity-50 disabled:cursor-not-allowed w-full"
                    )}
                    whileHover={{
                      scale: isVideoLoading ? 1 : 1.05,
                      y: isVideoLoading ? 0 : -2,
                    }}
                    whileTap={{ scale: isVideoLoading ? 1 : 0.95 }}
                  >
                    <span className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-0 hover:opacity-100 transition-opacity pointer-events-none" />
                    <Film
                      className={cn(
                        "w-5 h-5",
                        isVideoLoading && "animate-spin"
                      )}
                    />
                    <span>
                      {isVideoLoading
                        ? "Rendering…"
                        : videoUrl
                        ? "New Video"
                        : "Animate with AI"}
                    </span>
                  </motion.button>
                </Tooltip>

                <motion.button
                  onClick={() => {
                    triggerHapticFeedback();
                    onStartOver();
                  }}
                  className={cn(
                    "flex flex-col items-center justify-center gap-2 relative overflow-hidden",
                    "bg-white/10 border border-white/20 text-surface-50 font-bold",
                    "py-3 px-4 rounded-xl transition-all duration-300",
                    "text-xs sm:text-sm aspect-square",
                    "hover:bg-white/20 hover:border-white/30"
                  )}
                  whileHover={{ scale: 1.05, y: -2 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <span className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 hover:opacity-100 transition-opacity pointer-events-none" />
                  <RotateCcw className="w-5 h-5" />
                  <span>Create Another</span>
                </motion.button>
              </div>
              <AnimatePresence>
                {isImageEditing && (
                  <motion.div
                    className="space-y-2 p-3 bg-surface-800/50 rounded-xl border border-white/10"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <textarea
                      value={imageEditPrompt}
                      onChange={(e) => setImageEditPrompt(e.target.value)}
                      placeholder="e.g., Make the text gold..."
                      className="w-full bg-surface-800/50 text-surface-50 border-2 border-white/20 rounded-xl px-3 py-2 focus:ring-2 focus:ring-primary-400 focus:border-primary-400 outline-none transition text-sm"
                      rows={2}
                    />
                    <motion.button
                      onClick={() => {
                        triggerHapticFeedback();
                        handleImageAction(
                          () => onEditImage(imageEditPrompt),
                          [
                            "Applying your edit request...",
                            "Re-rendering safely around people and cars...",
                            "Finalizing the updated image...",
                          ]
                        ).then(() => setIsImageEditing(false));
                      }}
                      disabled={!imageEditPrompt.trim()}
                      className={cn(
                        "w-full bg-gradient-to-r from-primary-500 to-secondary-600",
                        "text-surface-50 font-bold py-2 px-4 rounded-xl",
                        "transition-all duration-300 shadow-lg hover:shadow-glow-primary",
                        "disabled:opacity-50 disabled:cursor-not-allowed"
                      )}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      Submit Edit
                    </motion.button>
                  </motion.div>
                )}
              </AnimatePresence>
              {videoJobs.length > 0 && (
                <motion.div
                  className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-3"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wide text-surface-50">
                      Video queue
                    </span>
                    <span className="text-[10px] text-primary-200/70">
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
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.2 }}
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
                        <div className="flex flex-col gap-1 text-[10px] text-warning-200">
                          {job.error && <span>{job.error}</span>}
                          <span className="text-indigo-100/70">
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
          </div>

          <motion.div
            className="bg-white/10 backdrop-blur-lg border border-white/20 p-4 lg:p-6 rounded-2xl flex flex-col"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2, duration: 0.4 }}
          >
            <h3 className="text-xl font-semibold mb-3 text-surface-50">
              Generated Social Post
            </h3>
            <div className="relative mb-4">
              {isTextLoading && <LoadingOverlay message="Updating Text..." />}
              {editedText !== post.text && (
                <div className="mb-2 flex items-center gap-2 text-xs text-warning-300">
                  <Edit3 className="w-3 h-3" />
                  <span>Text has been edited</span>
                </div>
              )}
              <textarea
                aria-label="Generated social post text"
                value={editedText}
                onChange={(e) => handleTextChange(e.target.value)}
                disabled={isTextLoading}
                className={cn(
                  "w-full h-40 lg:h-80 lg:max-h-[32rem]",
                  "bg-surface-800/50 text-surface-300 p-4 rounded-xl text-sm",
                  "resize-none border-2 border-transparent",
                  "focus:border-primary-400 focus:ring-2 focus:ring-primary-400",
                  "outline-none transition-all duration-300"
                )}
              />
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-2">
                <motion.button
                  onClick={handleUndo}
                  disabled={historyIndex === 0}
                  className={cn(
                    "flex items-center justify-center gap-1",
                    "bg-white/10 border border-white/20 text-surface-50 font-medium",
                    "py-2 px-2 rounded-lg transition-all duration-300 text-xs",
                    "hover:bg-white/20 hover:border-white/30",
                    "disabled:opacity-30 disabled:cursor-not-allowed"
                  )}
                  whileHover={{ scale: historyIndex > 0 ? 1.05 : 1 }}
                  whileTap={{ scale: historyIndex > 0 ? 0.95 : 1 }}
                  title="Undo (Ctrl+Z)"
                >
                  <Undo2 className="w-3 h-3" />
                </motion.button>

                <motion.button
                  onClick={handleRedo}
                  disabled={historyIndex === textHistory.length - 1}
                  className={cn(
                    "flex items-center justify-center gap-1",
                    "bg-white/10 border border-white/20 text-surface-50 font-medium",
                    "py-2 px-2 rounded-lg transition-all duration-300 text-xs",
                    "hover:bg-white/20 hover:border-white/30",
                    "disabled:opacity-30 disabled:cursor-not-allowed"
                  )}
                  whileHover={{
                    scale: historyIndex < textHistory.length - 1 ? 1.05 : 1,
                  }}
                  whileTap={{
                    scale: historyIndex < textHistory.length - 1 ? 0.95 : 1,
                  }}
                  title="Redo (Ctrl+Y)"
                >
                  <Redo2 className="w-3 h-3" />
                </motion.button>

                <motion.button
                  onClick={() => {
                    triggerHapticFeedback();
                    handleTextAction(onRegenerateText);
                  }}
                  disabled={textBusy}
                  className={cn(
                    "flex items-center justify-center gap-1",
                    "bg-white/10 border border-white/20 text-surface-50 font-medium",
                    "py-2 px-2 rounded-lg transition-all duration-300 text-xs",
                    "hover:bg-white/20 hover:border-white/30",
                    "col-span-2",
                    textBusy && "opacity-70 cursor-not-allowed"
                  )}
                  whileHover={{ scale: textBusy ? 1 : 1.02 }}
                  whileTap={{ scale: textBusy ? 1 : 0.98 }}
                >
                  {textBusy ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3 h-3" />
                  )}
                  <span>{textBusy ? "Updating…" : "Regenerate"}</span>
                </motion.button>
              </div>

              <motion.button
                onClick={() => {
                  triggerHapticFeedback();
                  setIsTextEditing(true);
                }}
                disabled={textBusy}
                className={cn(
                  "w-full flex items-center justify-center gap-2 relative overflow-hidden",
                  "bg-gradient-to-r from-sky-500 to-primary-500 text-surface-50 font-bold",
                  "py-2 px-4 rounded-xl transition-all duration-300 text-sm",
                  "shadow-lg hover:shadow-glow-primary",
                  textBusy && "opacity-70 cursor-not-allowed"
                )}
                whileHover={{ scale: textBusy ? 1 : 1.02 }}
                whileTap={{ scale: textBusy ? 1 : 0.98 }}
              >
                <span className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-0 hover:opacity-100 transition-opacity pointer-events-none" />
                {textBusy ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Edit3 className="w-4 h-4" />
                )}
                <span>{textBusy ? "Updating…" : "Edit with AI"}</span>
              </motion.button>
            </div>
            <div className="border-t border-white/10 my-4"></div>
            <div className="space-y-3">
              <motion.button
                onClick={handleShare}
                disabled={isSharing}
                className={cn(
                  "w-full flex items-center justify-center gap-2 relative overflow-hidden",
                  "bg-gradient-to-r from-teal-500 to-cyan-500 text-surface-50 font-bold",
                  "py-3 px-4 rounded-xl transition-all duration-300",
                  "shadow-lg hover:shadow-[0_0_25px_rgba(20,184,166,0.5)]",
                  isSharing && "opacity-70 cursor-not-allowed"
                )}
                whileHover={{ scale: isSharing ? 1 : 1.02 }}
                whileTap={{ scale: isSharing ? 1 : 0.98 }}
              >
                <span className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-0 hover:opacity-100 transition-opacity pointer-events-none" />
                {isSharing ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Share2 className="w-5 h-5" />
                )}
                <span>{isSharing ? "Opening share…" : "Share Post"}</span>
              </motion.button>

              <motion.button
                onClick={handleCopy}
                className={cn(
                  "w-full flex items-center justify-center gap-2",
                  "bg-white/10 border border-white/20 text-surface-50 font-bold",
                  "py-2 px-4 rounded-xl transition-all duration-300",
                  "hover:bg-white/20 hover:border-white/30"
                )}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                {copied ? (
                  <Check className="w-5 h-5" />
                ) : (
                  <Copy className="w-5 h-5" />
                )}
                <span>{copied ? "Copied!" : "Copy Text Only"}</span>
              </motion.button>
            </div>
          </motion.div>
        </div>
      </motion.div>
    </>
  );
};
