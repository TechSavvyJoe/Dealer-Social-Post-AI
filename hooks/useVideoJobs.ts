import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GeneratedPost, VideoRequestOptions, VideoStyle } from "../types";
import { useToast } from "../components/ui/Toast";
import { markPostVideoGenerated } from "../services/posts";
import { adoptPostRevision } from "../utils/postRevision";
import type { ResolvedMotion } from "../services/creativeSystem";
import type { PlannedPlatformDelivery } from "../services/platformOutputs";
import { archiveDealerMedia } from "../utils/creativeStorage";
import { normalizeError, recoveryHint } from "../utils/errorHandler";
import { retainNewestVideoJobs } from "../utils/videoJobRetention";

/** One in-memory video render on the result screen. */
export interface VideoJob {
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
}

export interface UseVideoJobsOptions {
  /** `image` bumps the creative revision; `postId` receives the video metric. */
  post: Pick<GeneratedPost, "image" | "postId">;
  /**
   * PostResult's `resultIdentity` (postId, else the image attempt id, else the
   * last generation time). A new identity restarts the creative revision at 0.
   */
  resultIdentity: string;
  /** Archive owner for finished clips; nothing is archived when empty. */
  dealerId: string;
  /** `resolved.motion` from resolveCreative — the dealership motion signature. */
  motion: ResolvedMotion | null;
  onGenerateVideo: (style: VideoStyle, options: VideoRequestOptions) => Promise<string>;
}

export interface UseVideoJobsResult {
  videoJobs: VideoJob[];
  /** The clip currently previewed (blob: or remote URL), or null for the photo. */
  videoUrl: string | null;
  /**
   * Preview a clip (or null for the photo). Takes ownership of blob: URLs; a
   * URL is revoked only on explicit removal, retention eviction, or unmount.
   */
  adoptVideoUrl: (url: string | null) => void;
  /** Legacy free-form video selection, separate from an exact delivery row. */
  manualVideoSelected: boolean;
  setManualVideoSelected: React.Dispatch<React.SetStateAction<boolean>>;
  isVideoLoading: boolean;
  videoLoadingMessage: string;
  /** Browser is buffering / decoding the blob after generation finishes. */
  isVideoBuffering: boolean;
  setIsVideoBuffering: React.Dispatch<React.SetStateAction<boolean>>;
  videoPlayError: string | null;
  setVideoPlayError: React.Dispatch<React.SetStateAction<string | null>>;
  /** Start muted for autoplay policy; user can enable sound with one tap. */
  videoMuted: boolean;
  setVideoMuted: React.Dispatch<React.SetStateAction<boolean>>;
  /** Synchronous guard: React state alone cannot stop two taps in one frame. */
  videoGenerationActiveRef: React.MutableRefObject<boolean>;
  /** `${resultIdentity}:${revision}` — jobs from another revision never match. */
  currentVideoCreativeKey: string;
  /** Newest job of the current creative matching a Veo delivery's exact spec. */
  videoJobForDelivery: (delivery: PlannedPlatformDelivery) => VideoJob | undefined;
  startVideoJob: (
    style: VideoStyle,
    options: VideoRequestOptions,
    existingJobId?: string,
  ) => Promise<void>;
  /** PostResult's former handleRetryVideo. */
  retryVideoJob: (jobId: string) => Promise<void>;
  /** PostResult's former handleRemoveVideoJob. */
  removeVideoJob: (jobId: string) => void;
  /**
   * Brand mode "Add video": the dealership motion signature, not an option
   * matrix. Spec §4.3 — 9:16 · 6s · 720p · music on, style bound to the Look.
   */
  houseMotionOptions: VideoRequestOptions | null;
  /**
   * A paid render that leaving would lose: one is rendering, queued, or has
   * finished into an in-memory clip (clips are never persisted with the
   * post). A failed job loses nothing. For A4/PR2b; PostResult's own leave
   * guard still counts every job (`videoJobs.length`) exactly as before.
   */
  atRisk: boolean;
}

/**
 * Video job machinery extracted verbatim from components/PostResult.tsx:
 * the job list, the synchronous two-tap guard, creative-revision binding,
 * blob-URL ownership and revocation, the history metric, and the brand-mode
 * house motion options.
 */
export const useVideoJobs = ({
  post,
  resultIdentity,
  dealerId,
  motion,
  onGenerateVideo,
}: UseVideoJobsOptions): UseVideoJobsResult => {
  const toast = useToast();
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
  /** Own blob URLs so we only revoke the previous one when replacing/unmounting. */
  const activeVideoBlobRef = useRef<string | null>(null);
  const ownedVideoBlobUrlsRef = useRef<Set<string>>(new Set());
  const [videoJobs, setVideoJobs] = useState<VideoJob[]>([]);

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
            const marked = await markPostVideoGenerated(post.postId);
            adoptPostRevision(post.postId, marked?.post_revision);
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

  /**
   * Brand mode "Add video": the dealership motion signature, not an option
   * matrix. Spec §4.3 — 9:16 · 6s · 720p · music on, style bound to the Look.
   */
  const houseMotionOptions = useMemo((): VideoRequestOptions | null => {
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
  }, [motion]);

  const retryVideoJob = async (jobId: string) => {
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

  const removeVideoJob = (jobId: string) => {
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

  const atRisk =
    isVideoLoading ||
    videoJobs.some(
      (job) =>
        job.status === "queued" ||
        job.status === "processing" ||
        (job.status === "completed" && Boolean(job.url)),
    );

  return {
    videoJobs,
    videoUrl,
    adoptVideoUrl,
    manualVideoSelected,
    setManualVideoSelected,
    isVideoLoading,
    videoLoadingMessage,
    isVideoBuffering,
    setIsVideoBuffering,
    videoPlayError,
    setVideoPlayError,
    videoMuted,
    setVideoMuted,
    videoGenerationActiveRef,
    currentVideoCreativeKey,
    videoJobForDelivery,
    startVideoJob,
    retryVideoJob,
    removeVideoJob,
    houseMotionOptions,
    atRisk,
  };
};
