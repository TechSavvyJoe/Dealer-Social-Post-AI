import { useCallback, useEffect, useRef, useState } from "react";
import { updatePostDraft, type DealerIdentityGrounding } from "../services/posts";
import type {
  CaptionSetDeliveryAnalysis,
  DeliveryCaption,
} from "../utils/complianceDisclosures";
import { logError } from "../utils/telemetry";
import { ApiError } from "../services/apiErrors";
import type { GeneratedPost } from "../types";
import { useAppStore } from "../stores/appStore";

export interface PendingDraftSync {
  caption: string;
  disclosures: string;
  imageDataUrl?: string;
  platformCaptions?: Record<string, string>;
}

export type DraftAutosaveStatus = "idle" | "saving" | "saved" | "failed" | "conflict";

/**
 * Another tab or device saved this post after this editor loaded it. Saving
 * again would overwrite that edit, so autosave stops until the post is reopened.
 */
export const DRAFT_CONFLICT_MESSAGE =
  "This post changed on another device or tab. Reopen it from My work to keep editing.";

export interface UseDraftAutosaveOptions {
  post: GeneratedPost;
  /** contentEditingLocked/historyReadOnly resolved to a single flag (was `editableDraft`). */
  editable: boolean;
  /** The current caption to save — the caller resolves
   * `activeCaptionPlatform ? primaryCaption : editedText` before passing it in. */
  primaryCaption: string;
  /** The analysis for that same resolved caption. */
  captionAnalysis: DeliveryCaption;
  captionSetAnalysis: CaptionSetDeliveryAnalysis;
  effectivePack?: Record<string, string>;
  identityLocked: boolean;
  grounding: DealerIdentityGrounding;
}

export interface UseDraftAutosaveResult {
  status: DraftAutosaveStatus;
  flush: () => Promise<boolean>;
  /**
   * The "Retry save" control after a failed save — same operation as `flush`.
   * After a conflict it sends nothing: the stale token can only be refused
   * again, so the edit stays on this device until the post is reopened.
   */
  retry: () => Promise<boolean>;
  /** Manually queue a draft to save (used by the website handoff's exact-creative send). */
  stage: (draft: PendingDraftSync) => void;
  lastRevisionRef: React.MutableRefObject<string | null>;
}

/**
 * The status a new edit shows. After a conflict the edit is kept on this
 * device but never sent, so "Saving…" would be a false promise and would hide
 * the "changed somewhere else" banner while the salesperson types.
 */
const editStatus = (
  conflictPostId: string | null,
  postId: string | undefined,
): DraftAutosaveStatus => (postId && conflictPostId === postId ? "conflict" : "saving");

/**
 * Draft autosave extracted verbatim from components/PostResult.tsx.
 *
 * Debounces 600 ms and runs as a serialized promise chain. Flushes on
 * unmount and never saves a caption with prohibited claims or an identity
 * failure. The server's post_revision is kept as the compare-and-set token
 * (`lastRevisionRef`).
 */
export const useDraftAutosave = ({
  post,
  editable,
  primaryCaption,
  captionAnalysis,
  captionSetAnalysis,
  effectivePack,
  identityLocked,
  grounding,
}: UseDraftAutosaveOptions): UseDraftAutosaveResult => {
  const [status, setStatus] = useState<DraftAutosaveStatus>("idle");
  const draftSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDraftSyncRef = useRef<PendingDraftSync | null>(null);
  const draftSyncChainRef = useRef<Promise<void>>(Promise.resolve());
  const draftSyncMountedRef = useRef(true);
  const lastSyncedDraftRef = useRef({
    caption: post.text,
    disclosures: post.disclosures || "",
    image: post.image,
    platformCaptions: JSON.stringify(post.platformCaptions || {}),
  });
  /** Server revision returned by the latest exact draft save. */
  const lastRevisionRef = useRef<string | null>(post.postRevision || null);
  /**
   * The post the server reported a newer edit for. Keyed by id, so a save the
   * old post queued during a switch stays blocked while the next post starts
   * clean.
   */
  const conflictPostIdRef = useRef<string | null>(null);
  /** The post on screen now; a queued save never reports status for another. */
  const livePostIdRef = useRef(post.postId);
  livePostIdRef.current = post.postId;
  useEffect(() => {
    // Another post must not inherit the "changed elsewhere" state.
    setStatus((current) => (current === "conflict" ? "idle" : current));
  }, [post.postId]);
  useEffect(() => {
    // Release linking and other same-post server transitions can advance the
    // revision outside autosave. Adopt the revision carried by the live post;
    // the response path below still refuses to replace a newer observed token.
    if (post.postRevision) lastRevisionRef.current = post.postRevision;
  }, [post.postId, post.postRevision]);

  const flush = useCallback((): Promise<boolean> => {
    const draft = pendingDraftSyncRef.current;
    if (draftSyncTimeoutRef.current) {
      clearTimeout(draftSyncTimeoutRef.current);
      draftSyncTimeoutRef.current = null;
    }
    const postId = post.postId;
    if (!draft || !postId || !editable) return Promise.resolve(true);
    const report = (next: DraftAutosaveStatus) => {
      if (draftSyncMountedRef.current && livePostIdRef.current === postId) {
        setStatus(next);
      }
    };

    const operation = draftSyncChainRef.current.then(async () => {
      // Retrying with the stale token can only fail again and would never
      // tell the salesperson why; keep the conflict state until a reopen.
      if (conflictPostIdRef.current === postId) {
        report("conflict");
        return false;
      }
      const expectedPostRevision = lastRevisionRef.current;
      if (!expectedPostRevision) {
        // The server would refuse this as POST_DRAFT_REVISION_REQUIRED, and a
        // retry cannot invent the token: only a reopen loads one. Treat it as
        // the conflict it is, not a connection failure with a futile Retry.
        conflictPostIdRef.current = postId;
        logError("post.draft_sync_conflict", {
          postId,
          message: "Reopen this post from My work to keep going.",
        });
        report("conflict");
        return false;
      }
      try {
        const updated = await updatePostDraft(postId, {
          ...draft,
          expectedPostRevision,
          grounding,
        });
        lastSyncedDraftRef.current = {
          caption: draft.caption,
          disclosures: draft.disclosures,
          image: draft.imageDataUrl || lastSyncedDraftRef.current.image,
          platformCaptions: JSON.stringify(draft.platformCaptions || {}),
        };
        const store = useAppStore.getState();
        const current = store.generatedPost;
        let authoritativeRevision = updated.post_revision;
        if (
          current &&
          current.postId === postId &&
          current.postRevision &&
          current.postRevision !== expectedPostRevision
        ) {
          authoritativeRevision = current.postRevision;
        }
        lastRevisionRef.current = authoritativeRevision;
        if (current && current.postId === postId) {
          const currentPost = current;
          const savedDraftIsStillLatest = pendingDraftSyncRef.current === draft;
          store.setGeneratedPost(
            savedDraftIsStillLatest
              ? {
                  ...currentPost,
                  text: draft.caption,
                  disclosures: draft.disclosures || undefined,
                  platformCaptions: draft.platformCaptions,
                  image: draft.imageDataUrl || currentPost.image,
                  postRevision: authoritativeRevision,
                }
              : { ...currentPost, postRevision: authoritativeRevision },
            { archive: false },
          );
        }
        if (pendingDraftSyncRef.current === draft) {
          pendingDraftSyncRef.current = null;
        }
        report(pendingDraftSyncRef.current ? "saving" : "saved");
        return true;
      } catch (err) {
        const conflict =
          err instanceof ApiError &&
          (err.code === "POST_DRAFT_REVISION_CONFLICT" ||
            err.code === "POST_DRAFT_REVISION_REQUIRED");
        if (conflict) conflictPostIdRef.current = postId;
        logError(conflict ? "post.draft_sync_conflict" : "post.draft_sync_failed", {
          postId,
          message: err instanceof Error ? err.message : String(err),
        });
        report(conflict ? "conflict" : "failed");
        return false;
      }
    });
    draftSyncChainRef.current = operation.then(() => undefined);
    return operation;
  }, [editable, grounding, post.postId]);

  const stage = useCallback((draft: PendingDraftSync) => {
    pendingDraftSyncRef.current = draft;
    setStatus(editStatus(conflictPostIdRef.current, livePostIdRef.current));
  }, []);

  useEffect(() => {
    if (!post.postId || !editable) return;
    const historyCaption = primaryCaption;
    const historyAnalysis = captionAnalysis;
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
    setStatus(editStatus(conflictPostIdRef.current, post.postId));
    if (draftSyncTimeoutRef.current) clearTimeout(draftSyncTimeoutRef.current);
    draftSyncTimeoutRef.current = setTimeout(() => {
      void flush();
    }, 600);
  }, [
    captionAnalysis,
    captionSetAnalysis,
    effectivePack,
    flush,
    post.image,
    post.postId,
    primaryCaption,
    editable,
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
      void flush();
    };
  }, [flush]);

  return {
    status,
    flush,
    retry: flush,
    stage,
    lastRevisionRef,
  };
};
