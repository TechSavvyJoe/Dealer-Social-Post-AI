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
}

export interface UsePostShareResult {
  preparationStatus: PostSharePreparationStatus;
  preparationError: string | null;
  prepared: PreparedPublishShare | null;
  shareDisabled: boolean;
  nativeFileShareAvailable: boolean;
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
  const pendingRecordRef = useRef<{
    postId: string;
    channel: PlatformDestinationId;
    via: PostShareVia;
    expectedPostRevision: string;
    retried: boolean;
  } | null>(null);
  const effectiveBlockedReason =
    blockedReason ||
    (post.postId && !expectedPostRevision
      ? "This saved post is missing its revision. Reopen it from My work before delivery."
      : undefined);

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
    if (channelChanged) setFeedback(null);
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
              toUiMessage(error, "The exact file could not be prepared."),
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
      try {
        const recorded = await recordPostShared(post.postId, {
          channel: channelId,
          via,
          expectedPostRevision: expectedPostRevision as string,
        });
        const store = useAppStore.getState();
        const current = store.generatedPost;
        if (current?.postId === post.postId) {
          store.setGeneratedPost(
            { ...current, postRevision: recorded.post_revision },
            { archive: false },
          );
        }
        pendingRecordRef.current = null;
      } catch (error) {
        // The share itself already happened and is shown locally. A rejected
        // receipt (stale revision, delivery lock) can only be rejected again,
        // so only a transport failure is retried when the device reconnects.
        if (error instanceof ApiError && error.status < 500) {
          logError("post.share_receipt_rejected", {
            postId: post.postId,
            code: error.code || String(error.status),
          });
          pendingRecordRef.current = null;
          return;
        }
        pendingRecordRef.current = {
          postId: post.postId,
          channel: channelId,
          via,
          expectedPostRevision: expectedPostRevision as string,
          retried: false,
        };
      }
    },
    [channelId, expectedPostRevision, mergeLocalShare, post.postId],
  );

  useEffect(
    () =>
      connectionManager.subscribe((online) => {
        const pending = pendingRecordRef.current;
        if (!online || !pending || pending.retried) return;
        pending.retried = true;
        void recordPostShared(pending.postId, {
          channel: pending.channel,
          via: pending.via,
          expectedPostRevision: pending.expectedPostRevision,
        })
          .then(() => {
            if (pendingRecordRef.current === pending) pendingRecordRef.current = null;
          })
          .catch(() => undefined);
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
          message: effectiveBlockedReason || "The exact file is still being prepared.",
        });
    void flushDraft();
    return sharePromise.then((result) => {
      if (result.kind === "shared") {
        setFeedback({
          title: `Shared to ${channelLabel}`,
          detail: "Sent to the share sheet. Confirm the post in the destination app.",
          via: "share_sheet",
        });
        void record("share_sheet");
      } else if (result.kind === "fallback") {
        setFeedback({
          title: "Use the fallback controls",
          detail: result.message,
          via: "copy",
        });
      } else if (result.kind === "error") {
        setPreparationError(result.message);
      }
      return result;
    });
  }, [activePrepared, channelLabel, effectiveBlockedReason, flushDraft, record]);

  const copyCaption = useCallback(async () => {
    if (!activePrepared || effectiveBlockedReason) return false;
    const copied = await copyPreparedCaption(activePrepared);
    if (copied) {
      setFeedback({
        title: "Caption copied",
        detail: `Ready to paste into ${channelLabel}.`,
        via: "copy",
      });
      void record("copy");
    }
    return copied;
  }, [activePrepared, channelLabel, effectiveBlockedReason, record]);

  const download = useCallback(() => {
    if (!activePrepared || effectiveBlockedReason) return false;
    const downloaded = downloadPreparedMedia(activePrepared);
    if (downloaded) {
      void record("download");
      setFeedback({
        title: `Downloaded for ${channelLabel}`,
        detail:
          "The exact file is saved. Posting to the destination is not confirmed yet.",
        via: "download",
      });
    }
    return downloaded;
  }, [activePrepared, channelLabel, effectiveBlockedReason, record]);

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
    feedback,
    share,
    copyCaption,
    download,
    openTarget,
  };
};
