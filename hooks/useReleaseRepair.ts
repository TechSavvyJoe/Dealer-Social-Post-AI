import { useCallback, useEffect, useRef, useState } from "react";
import { linkReleaseToPostWithRetry } from "../services/photoReleases";
import { connectionManager } from "../utils/connectionManager";
import { useAppStore } from "../stores/appStore";
import { logError } from "../utils/telemetry";
import { useToast } from "../components/ui/Toast";
import type { GeneratedPost } from "../types";

export interface UseReleaseRepairOptions {
  post: GeneratedPost;
}

export interface UseReleaseRepairResult {
  releaseStatus: GeneratedPost["releaseStatus"];
  releaseLinkStatus: GeneratedPost["releaseLinkStatus"];
  /** The recoverable variant: the signature is stored, only its link to this post is missing. */
  releaseLinkRepairable: boolean;
  retrying: boolean;
  notice: string | null;
  retry: (trigger: "manual" | "reconnect") => Promise<void>;
}

/**
 * Release repair extracted verbatim from components/PostResult.tsx.
 *
 * Retries automatically once per mount when the connection comes back. The
 * button stays available. Nothing is re-signed: this replays the same small
 * first-party POST that failed after the post was created, using the ids
 * already on the post.
 */
export const useReleaseRepair = ({
  post,
}: UseReleaseRepairOptions): UseReleaseRepairResult => {
  const toast = useToast();
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
  const currentPostPropRef = useRef(post);
  currentPostPropRef.current = post;

  const releaseLocked = releaseStatus === "save_failed";
  const releaseLinkRepairable =
    releaseLocked &&
    releaseLinkStatus === "link_failed" &&
    Boolean(post.releaseId) &&
    Boolean(post.postId);

  // A different post (or a store update after a repair) owns the release gate.
  useEffect(() => {
    setReleaseStatus(post.releaseStatus);
    setReleaseLinkStatus(post.releaseLinkStatus);
    setReleaseRetryNotice(null);
    releaseReconnectUsedRef.current = false;
  }, [post.postId, post.releaseStatus, post.releaseLinkStatus]);

  const retryReleaseLink = useCallback(
    async (trigger: "manual" | "reconnect") => {
      const sourcePost = currentPostPropRef.current;
      const releaseId = sourcePost.releaseId;
      const postId = sourcePost.postId;
      if (!releaseId || !postId || releaseRetryingRef.current) return;
      const before = useAppStore.getState();
      const observedRevision =
        before.generatedPost?.postRevision ?? sourcePost.postRevision;
      const authEpoch = before.authEpoch;
      releaseRetryingRef.current = true;
      setReleaseRetrying(true);
      setReleaseRetryNotice(null);
      try {
        const linked = await linkReleaseToPostWithRetry(releaseId, postId);
        if (
          useAppStore.getState().authEpoch !== authEpoch ||
          currentPostPropRef.current.postId !== postId
        )
          return;
        setReleaseStatus("saved");
        setReleaseLinkStatus(undefined);
        const store = useAppStore.getState();
        const current = store.generatedPost;
        if (!current || current.postId === postId) {
          const base = current || sourcePost;
          let revision = linked.post_revision;
          if (base.postRevision !== observedRevision) {
            // PocketBase revisions are server timestamps. Either operation
            // may commit last, independently of when its response arrives.
            const currentTime = Date.parse((base.postRevision || "").replace(" ", "T"));
            const linkedTime = Date.parse(
              (linked.post_revision || "").replace(" ", "T"),
            );
            revision =
              Number.isFinite(currentTime) && Number.isFinite(linkedTime)
                ? linkedTime > currentTime
                  ? linked.post_revision
                  : (base.postRevision as string)
                : "";
          }
          store.setGeneratedPost({
            ...base,
            postRevision: revision || undefined,
            releaseStatus: "saved",
            releaseLinkStatus: undefined,
          });
        }
        if (!current || current.postId === postId) {
          const live = useAppStore.getState().generatedPost;
          if (live && !live.postRevision) {
            toast.warning(
              "Photo release saved. Reopen this post from My work before sharing.",
            );
          } else {
            toast.success(
              "Photo release saved to this post. Copy, share, save, and export are unlocked.",
            );
          }
        }
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

  return {
    releaseStatus,
    releaseLinkStatus,
    releaseLinkRepairable,
    retrying: releaseRetrying,
    notice: releaseRetryNotice,
    retry: retryReleaseLink,
  };
};
