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
import { recordPostShared } from "../services/posts";
import { ApiError } from "../services/apiErrors";
import { logError } from "../utils/telemetry";
import { connectionManager } from "../utils/connectionManager";
import { useAppStore } from "../stores/appStore";
import { toUiMessage } from "../utils/errorMessages";

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

interface PendingReceipt {
  postId: string;
  channel: PlatformDestinationId;
  via: PostShareVia;
  expectedPostRevision: string;
  retried: boolean;
}

/**
 * One pending receipt per post, channel and method: a later Copy caption must
 * not discard a share-sheet receipt still waiting for the connection.
 */
const receiptKey = (
  postId: string,
  channel: PlatformDestinationId,
  via: PostShareVia,
) => `${postId}\u0000${channel}\u0000${via}`;

/** 4xx statuses that mean "try again later", not "this receipt is refused". */
const TRANSIENT_CLIENT_STATUSES = new Set([408, 425, 429]);

/**
 * The server refused the receipt itself (stale revision, delivery lock, bad
 * input). Sending the same receipt again can only be refused again, so it is
 * logged and dropped. Timeouts, rate limits, 5xx and network failures are
 * transport problems and keep the single reconnect retry.
 */
const isRejectedReceipt = (error: unknown): error is ApiError =>
  error instanceof ApiError &&
  error.status >= 400 &&
  error.status < 500 &&
  !TRANSIENT_CLIENT_STATUSES.has(error.status);

/**
 * The receipt echoes the revision whose delivery locks were checked. Adopt a
 * different one only while the store still holds the token the receipt was
 * sent with: a draft save that finished meanwhile owns a newer token, and
 * rolling it back would make the next autosave look like a conflict.
 */
const adoptReceiptRevision = (
  postId: string,
  sentRevision: string,
  receiptRevision: string | undefined,
): void => {
  if (!receiptRevision || receiptRevision === sentRevision) return;
  const store = useAppStore.getState();
  const current = store.generatedPost;
  if (current?.postId !== postId || current.postRevision !== sentRevision) return;
  store.setGeneratedPost(
    { ...current, postRevision: receiptRevision },
    { archive: false },
  );
};

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
  const pendingRecordsRef = useRef(new Map<string, PendingReceipt>());
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

  useEffect(() => {
    let active = true;
    const channelChanged = previousChannelRef.current !== channelId;
    previousChannelRef.current = channelId;
    if (channelChanged) {
      setFeedback(null);
      setFallbackActive(false);
      sharedViaSheetRef.current = false;
    }
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
  }, [channelId, content, effectiveBlockedReason, requestedKey]);

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
      if (post.postId && !expectedPostRevision) return;
      mergeLocalShare(via);
      if (!post.postId) return;
      const sentRevision = expectedPostRevision as string;
      const key = receiptKey(post.postId, channelId, via);
      try {
        const recorded = await recordPostShared(post.postId, {
          channel: channelId,
          via,
          expectedPostRevision: sentRevision,
        });
        adoptReceiptRevision(post.postId, sentRevision, recorded.post_revision);
        // Only this receipt is settled; another method's may still be waiting.
        pendingRecordsRef.current.delete(key);
      } catch (error) {
        // The share itself already happened and is shown locally. A rejected
        // receipt (stale revision, delivery lock) can only be rejected again,
        // so only a transport failure is retried when the device reconnects.
        // Re-reading the revision to resend is deliberately not done: that
        // would record a share against content the salesperson did not share.
        if (isRejectedReceipt(error)) {
          logError("post.share_receipt_rejected", {
            postId: post.postId,
            status: error.status,
            // "code" is a redacted telemetry key; keep the server code readable.
            errorCode: error.code || String(error.status),
          });
          pendingRecordsRef.current.delete(key);
          return;
        }
        pendingRecordsRef.current.set(key, {
          postId: post.postId,
          channel: channelId,
          via,
          expectedPostRevision: sentRevision,
          retried: false,
        });
      }
    },
    [channelId, expectedPostRevision, mergeLocalShare, post.postId],
  );

  useEffect(
    () =>
      connectionManager.subscribe((online) => {
        if (!online) return;
        const pendingRecords = pendingRecordsRef.current;
        for (const [key, pending] of pendingRecords) {
          if (pending.retried) continue;
          pending.retried = true;
          void recordPostShared(pending.postId, {
            channel: pending.channel,
            via: pending.via,
            expectedPostRevision: pending.expectedPostRevision,
          })
            .then((recorded) => {
              adoptReceiptRevision(
                pending.postId,
                pending.expectedPostRevision,
                recorded?.post_revision,
              );
            })
            .catch((error) => {
              // One retry only. Whatever the reason, the receipt is dropped now.
              logError(
                isRejectedReceipt(error)
                  ? "post.share_receipt_rejected"
                  : "post.share_receipt_failed",
                {
                  postId: pending.postId,
                  status: error instanceof ApiError ? error.status : undefined,
                  errorCode:
                    error instanceof ApiError
                      ? error.code || String(error.status)
                      : error instanceof Error
                        ? error.name
                        : "unknown",
                },
              );
            })
            .finally(() => {
              if (pendingRecords.get(key) === pending) pendingRecords.delete(key);
            });
        }
      }),
    [],
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
      if (result.kind === "shared") {
        setFallbackActive(false);
        sharedViaSheetRef.current = true;
        setFeedback({
          title: `Shared to ${channelLabel}`,
          // Facebook drops shared text, so the caption only arrives if the
          // clipboard has it. Say which, and how to get it if it does not.
          detail: result.captionCopied
            ? `Caption copied. Paste it into your ${channelLabel} post, then tap Post there.`
            : `Tap Copy caption, then paste it into your ${channelLabel} post.`,
          via: "share_sheet",
        });
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
    channelLabel,
    effectiveBlockedReason,
    flushDraft,
    mediaNoun,
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
      void record("download");
      setFeedback({
        title: mediaNoun === "video" ? "Video downloaded" : "Image downloaded",
        detail: `Copy the caption, then post both in ${channelLabel}.`,
        via: "download",
      });
    }
    return downloaded;
  }, [activePrepared, channelLabel, effectiveBlockedReason, mediaNoun, record]);

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
