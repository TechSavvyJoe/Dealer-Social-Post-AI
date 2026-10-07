import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GeneratedPost, PostShareVia } from "../types";
import type { PlatformDestinationId } from "../services/platformOutputs";
import {
  copyPreparedCaption,
  downloadPreparedMedia,
  openPreparedTarget,
  preparePublishShare,
  sharePrepared,
  type PreparedPublishShare,
  type PublishContent,
  type PublishStatus,
} from "../services/publishTargets";
import { submitShareReceipt } from "../services/shareReceipts";
import { useAppStore } from "../stores/appStore";
import { toUiMessage } from "../utils/errorMessages";
import { sharedLabel } from "../utils/postLabels";

export type PostSharePreparationStatus = "idle" | "preparing" | "ready" | "failed";

export interface UsePostShareOptions {
  post: GeneratedPost;
  channelId: PlatformDestinationId;
  channelLabel: string;
  content: PublishContent;
  blockedReason?: string;
  /** Revision of the exact saved copy being handed off. Required for saved posts. */
  expectedPostRevision?: string;
  /** Flush starts only after navigator.share has been invoked. */
  flushDraft: () => Promise<boolean>;
  onMediaDelivered?: (content: PublishContent) => void;
}

export interface PostShareFeedback {
  title: string;
  detail: string;
  via: PostShareVia;
  /**
   * This feedback reports that the share sheet did not open (warning tone).
   * Set only on that message; whether the manual controls stay up is
   * `UsePostShareResult.fallbackActive`.
   */
  fallback?: boolean;
}

export interface UsePostShareResult {
  preparationStatus: PostSharePreparationStatus;
  preparationError: string | null;
  prepared: PreparedPublishShare | null;
  shareDisabled: boolean;
  nativeFileShareAvailable: boolean;
  /**
   * The share sheet did not open for this channel. The Post screen swaps the
   * Share button for Save file / Copy caption / Open {channel}. It stays true
   * through the copy and download feedback that follows, so using one of those
   * controls never takes the others away; changing channel or a later
   * successful share clears it.
   */
  fallbackActive: boolean;
  feedback: PostShareFeedback | null;
  share: () => Promise<PublishStatus>;
  copyCaption: () => Promise<boolean>;
  download: () => boolean;
  openTarget: () => "native" | "web" | "none";
}

const preparedFileKey = (file: File | undefined): string =>
  file ? `${file.name}:${file.type}:${file.size}:${file.lastModified}` : "no-file";

const localShare = (
  channel: PlatformDestinationId,
  via: PostShareVia,
): NonNullable<GeneratedPost["sharedTo"]>[number] => ({
  channel,
  via,
  at: new Date().toISOString(),
});

const isVideoContent = (content: PublishContent): boolean =>
  Boolean(content.videoUrl || content.preparedFile?.type.startsWith("video/"));

/**
 * One prepared destination at a time. The requested key is checked during
 * render, so a caption edit disables Share immediately, before the debounce
 * effect has a chance to clear the previous file/caption pair.
 */
export const usePostShare = ({
  post,
  channelId,
  channelLabel,
  content,
  blockedReason,
  expectedPostRevision,
  flushDraft,
  onMediaDelivered,
}: UsePostShareOptions): UsePostShareResult => {
  const [prepared, setPrepared] = useState<PreparedPublishShare | null>(null);
  const [preparedKey, setPreparedKey] = useState<string | null>(null);
  const [preparingKey, setPreparingKey] = useState<string | null>(null);
  const [preparationError, setPreparationError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<PostShareFeedback | null>(null);
  const previousChannelRef = useRef(channelId);
  /** The share sheet failed for this channel; keep the manual controls up. */
  const [fallbackActive, setFallbackActive] = useState(false);
  /** The share sheet carried the media for this channel in this session. */
  const sharedViaSheetRef = useRef(false);
  const effectiveBlockedReason =
    blockedReason ||
    (post.postId && !expectedPostRevision
      ? "Reopen this post from My work to keep going."
      : undefined);
  const mediaNoun = isVideoContent(content) ? "video" : "image";

  const requestedKey = useMemo(
    () =>
      [
        channelId,
        content.text,
        content.disclosures || "",
        content.requiredPrefix || "",
        content.videoUrl || "",
        preparedFileKey(content.preparedFile),
        effectiveBlockedReason || "",
      ].join("\u0000"),
    [
      effectiveBlockedReason,
      channelId,
      content.disclosures,
      content.preparedFile,
      content.requiredPrefix,
      content.text,
      content.videoUrl,
    ],
  );

  const activePrepared = preparedKey === requestedKey ? prepared : null;
  const deliveredCreativeKey = [
    channelId,
    content.text,
    content.disclosures,
    content.requiredPrefix,
    content.imageDataUrl,
    content.videoUrl,
    preparedFileKey(content.preparedFile),
  ].join("\u0000");
  const previousCreativeKey = useRef(deliveredCreativeKey);

  useEffect(() => {
    let active = true;
    const channelChanged = previousChannelRef.current !== channelId;
    previousChannelRef.current = channelId;
    if (channelChanged || previousCreativeKey.current !== deliveredCreativeKey) {
      setFeedback(null);
      setFallbackActive(false);
      sharedViaSheetRef.current = false;
    }
    previousCreativeKey.current = deliveredCreativeKey;
    setPreparationError(null);

    if (effectiveBlockedReason || !content.text.trim() || !content.preparedFile) {
      setPrepared(null);
      setPreparedKey(null);
      setPreparingKey(null);
      return;
    }

    setPreparingKey(requestedKey);
    const timeoutId = setTimeout(
      () => {
        void preparePublishShare(channelId, content)
          .then((next) => {
            if (!active) return;
            setPrepared(next);
            setPreparedKey(requestedKey);
          })
          .catch((error) => {
            if (!active) return;
            setPrepared(null);
            setPreparedKey(null);
            setPreparationError(
              toUiMessage(
                error,
                `Couldn't get the ${isVideoContent(content) ? "video" : "image"} ready.`,
              ),
            );
          })
          .finally(() => {
            if (active) setPreparingKey(null);
          });
      },
      channelChanged ? 0 : 300,
    );

    return () => {
      active = false;
      clearTimeout(timeoutId);
    };
  }, [channelId, content, deliveredCreativeKey, effectiveBlockedReason, requestedKey]);

  const mergeLocalShare = useCallback(
    (via: PostShareVia) => {
      const store = useAppStore.getState();
      const current = store.generatedPost;
      if (current && post.postId && current.postId !== post.postId) return;
      const base = current || post;
      store.setGeneratedPost({
        ...base,
        sharedTo: [...(base.sharedTo || []), localShare(channelId, via)],
      });
    },
    [channelId, post],
  );

  const record = useCallback(
    async (via: PostShareVia) => {
      // A manager can deliver a teammate's file, but only its author owns
      // saved share receipts. Local delivery feedback still describes the action.
      if (post.historyReadOnly || (post.postId && !expectedPostRevision)) return;
      mergeLocalShare(via);
      if (!post.postId) return;
      await submitShareReceipt({
        postId: post.postId,
        channel: channelId,
        via,
        expectedPostRevision: expectedPostRevision as string,
        captionMode: "primary",
        disclosures: content.disclosures || "",
      });
    },
    [
      channelId,
      content.disclosures,
      expectedPostRevision,
      mergeLocalShare,
      post.historyReadOnly,
      post.postId,
    ],
  );

  const share = useCallback((): Promise<PublishStatus> => {
    // Keep this as the first statement. sharePrepared invokes navigator.share
    // synchronously before its first await, preserving WebKit user activation.
    const sharePromise = activePrepared
      ? sharePrepared(activePrepared)
      : Promise.resolve<PublishStatus>({
          kind: "error",
          message: effectiveBlockedReason || "Still getting it ready.",
        });
    void flushDraft();
    return sharePromise.then((result) => {
      // Only an error is a failure. A share, a closed sheet or the manual
      // fallback each replace an earlier failure; keeping it would leave the
      // screen on Try again after a share that went through.
      if (result.kind !== "error") setPreparationError(null);
      if (result.kind === "shared") {
        setFallbackActive(false);
        sharedViaSheetRef.current = true;
        setFeedback({
          // The same words My work and Home use: the sheet does not say
          // which app received the post.
          title: sharedLabel(channelId),
          // Facebook drops shared text, so the caption only arrives if the
          // clipboard has it. Say which, and how to get it if it does not.
          detail: result.captionCopied
            ? `Caption copied. Paste it into your ${channelLabel} post, then tap Post there.`
            : `Tap Copy caption, then paste it into your ${channelLabel} post.`,
          via: "share_sheet",
        });
        onMediaDelivered?.(content);
        void record("share_sheet");
      } else if (result.kind === "fallback") {
        setFallbackActive(true);
        setFeedback({
          title: "Share sheet didn't open",
          detail: `Save the ${mediaNoun} and copy the caption below, then open ${channelLabel}.`,
          via: "copy",
          fallback: true,
        });
      } else if (result.kind === "error") {
        setPreparationError(result.message);
      }
      return result;
    });
  }, [
    activePrepared,
    channelId,
    channelLabel,
    effectiveBlockedReason,
    flushDraft,
    mediaNoun,
    onMediaDelivered,
    content,
    record,
  ]);

  // A reopened post already shared through the sheet to this channel has its
  // media in the post, the same as a share made in this session. Once the
  // sheet has failed, the salesperson is posting the media by hand instead.
  const mediaAlreadyInPost =
    !fallbackActive &&
    Boolean(
      post.sharedTo?.some(
        (event) => event.channel === channelId && event.via === "share_sheet",
      ),
    );

  const copyCaption = useCallback(async () => {
    if (!activePrepared || effectiveBlockedReason) return false;
    const copied = await copyPreparedCaption(activePrepared);
    if (copied) {
      setFeedback({
        title: "Caption copied",
        detail:
          sharedViaSheetRef.current || mediaAlreadyInPost
            ? `Paste it into your ${channelLabel} post.`
            : `Paste it into ${channelLabel} with the ${mediaNoun}.`,
        via: "copy",
      });
      void record("copy");
    }
    return copied;
  }, [
    activePrepared,
    channelLabel,
    effectiveBlockedReason,
    mediaAlreadyInPost,
    mediaNoun,
    record,
  ]);

  const download = useCallback(() => {
    if (!activePrepared || effectiveBlockedReason) return false;
    const downloaded = downloadPreparedMedia(activePrepared);
    if (downloaded) {
      onMediaDelivered?.(content);
      void record("download");
      setFeedback({
        title: mediaNoun === "video" ? "Video downloaded" : "Image downloaded",
        detail: `Copy the caption, then post both in ${channelLabel}.`,
        via: "download",
      });
    }
    return downloaded;
  }, [
    activePrepared,
    channelLabel,
    effectiveBlockedReason,
    mediaNoun,
    record,
    onMediaDelivered,
    content,
  ]);

  const openTarget = useCallback(
    () => (activePrepared ? openPreparedTarget(activePrepared) : "none"),
    [activePrepared],
  );

  const nativeFileShareAvailable = useMemo(() => {
    if (!activePrepared?.file || typeof navigator === "undefined") return false;
    if (typeof navigator.share !== "function") return false;
    if (typeof navigator.canShare !== "function") return true;
    try {
      return navigator.canShare({ files: [activePrepared.file] });
    } catch {
      return false;
    }
  }, [activePrepared]);

  const preparationStatus: PostSharePreparationStatus = preparationError
    ? "failed"
    : activePrepared
      ? "ready"
      : preparingKey === requestedKey
        ? "preparing"
        : "idle";

  return {
    preparationStatus,
    preparationError,
    prepared: activePrepared,
    shareDisabled: Boolean(effectiveBlockedReason || !activePrepared),
    nativeFileShareAvailable,
    fallbackActive,
    feedback,
    share,
    copyCaption,
    download,
    openTarget,
  };
};
