import { useCallback, useEffect, useMemo, useState } from "react";
import type { GeneratedPost } from "../types";
import {
  derivePlatformDeliveryPlan,
  type MediaKind,
  type PlannedPlatformDelivery,
} from "../services/platformOutputs";
import { resolvePrimaryImageProfile } from "../services/platformCopy";
import { toUiMessage } from "../utils/errorMessages";
import { triggerHapticFeedback } from "../utils/haptics";
import {
  prepareMediaForSave,
  validateVideoMetadata,
  type PreparedMediaSave,
} from "../utils/mediaSave";
import { EXPORT_FORMATS, renderFormatIfNeeded } from "../utils/multiFormatExport";
import type { UseVideoJobsResult } from "./useVideoJobs";

export interface UsePreparedDeliveryOptions {
  post: Pick<
    GeneratedPost,
    "image" | "platformIds" | "primaryFormatId" | "mediaOutputMode" | "postId"
  >;
  /** PostResult's `resultIdentity`; keys the primary (no-delivery) preparation. */
  resultIdentity: string;
  /**
   * `websiteDraft?.enabled`. A website-only post (no saved platform ids) asks
   * for no platform files instead of the fallback platform.
   */
  websiteEnabled: boolean | undefined;
  /** The video state this plan reads (useVideoJobs owns it). */
  video: Pick<
    UseVideoJobsResult,
    | "videoJobs"
    | "videoUrl"
    | "adoptVideoUrl"
    | "manualVideoSelected"
    | "setManualVideoSelected"
    | "currentVideoCreativeKey"
    | "videoJobForDelivery"
  >;
}

/**
 * Exact per-destination file preparation extracted verbatim from
 * components/PostResult.tsx: the delivery plan, the selected delivery row,
 * the preparation key that stops a prepared file ever being used under a
 * different row, the single prepared File kept in memory (iPhone memory
 * pressure), video metadata validation before any save or share, and the
 * formatted preview object-URL lifecycle.
 */
export const usePreparedDelivery = ({
  post,
  resultIdentity,
  websiteEnabled,
  video,
}: UsePreparedDeliveryOptions) => {
  const {
    videoJobs,
    videoUrl,
    adoptVideoUrl,
    manualVideoSelected,
    setManualVideoSelected,
    currentVideoCreativeKey,
    videoJobForDelivery,
  } = video;
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
      : websiteEnabled
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
    websiteEnabled,
  ]);
  const deliveriesById = useMemo(
    () =>
      new Map<string, PlannedPlatformDelivery>(
        deliveryPlan.deliveries.map((delivery) => [delivery.id, delivery]),
      ),
    [deliveryPlan.deliveries],
  );
  const websiteOnly = Boolean(websiteEnabled && deliveryPlan.deliveries.length === 0);
  const selectedDelivery = selectedDeliveryId
    ? deliveriesById.get(selectedDeliveryId)
    : undefined;
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
          toUiMessage(err, "The exact platform file could not be prepared."),
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

  /** PostResult's former handleSelectDelivery. */
  const selectDeliveryById = (deliveryId: string) => {
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

  /**
   * Select the row for a channel and media kind. `destinationId` may be the
   * delivery's own destination or the platform id that requested it (an
   * Instagram feed selection plans its video as an Instagram Reel). Returns
   * false, changing nothing, when the plan has no such row.
   */
  const selectDelivery = (destinationId: string, mediaKind: MediaKind): boolean => {
    const ofKind = deliveryPlan.deliveries.filter(
      (candidate) => candidate.mediaKind === mediaKind,
    );
    const delivery =
      ofKind.find((candidate) => candidate.destinationId === destinationId) ??
      ofKind.find((candidate) => candidate.requestedVia.includes(destinationId));
    if (!delivery) return false;
    selectDeliveryById(delivery.id);
    return true;
  };

  /** Re-run preparation of the selected row (the retry nonce). */
  const retryPreparation = useCallback(() => {
    setMediaPreparationNonce((value) => value + 1);
  }, []);

  return {
    primarySaveFormat,
    deliveryPlan,
    deliveriesById,
    websiteOnly,
    selectedDeliveryId,
    setSelectedDeliveryId,
    selectedDelivery,
    selectedVideoJob,
    preparationKeyForDelivery,
    selectedPreparationKey,
    preparedSaveForKey,
    activePreparedSave,
    activeImageFormat,
    isPreparingSave,
    mediaPreparationError,
    setMediaPreparationError,
    retryPreparation,
    formattedPreviewUrl,
    selectDeliveryById,
    selectDelivery,
  };
};

export type UsePreparedDeliveryResult = ReturnType<typeof usePreparedDelivery>;
