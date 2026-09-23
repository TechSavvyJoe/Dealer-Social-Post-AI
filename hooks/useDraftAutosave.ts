import { useCallback, useEffect, useRef, useState } from "react";
import { updatePostDraft, type DealerIdentityGrounding } from "../services/posts";
import type {
  CaptionSetDeliveryAnalysis,
  DeliveryCaption,
} from "../utils/complianceDisclosures";
import { logError } from "../utils/telemetry";
import type { GeneratedPost } from "../types";

export interface PendingDraftSync {
  caption: string;
  disclosures: string;
  imageDataUrl?: string;
  platformCaptions?: Record<string, string>;
}

export type DraftAutosaveStatus = "idle" | "saving" | "saved" | "failed";

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
  /** The "Retry" control after a failed save — same operation as `flush`. */
  retry: () => Promise<boolean>;
  /** Manually queue a draft to save (used by the website handoff's exact-creative send). */
  stage: (draft: PendingDraftSync) => void;
  lastRevisionRef: React.MutableRefObject<string | null>;
}

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
  const lastRevisionRef = useRef<string | null>(null);

  const flush = useCallback((): Promise<boolean> => {
    const draft = pendingDraftSyncRef.current;
    if (draftSyncTimeoutRef.current) {
      clearTimeout(draftSyncTimeoutRef.current);
      draftSyncTimeoutRef.current = null;
    }
    if (!draft || !post.postId || !editable) return Promise.resolve(true);

    const operation = draftSyncChainRef.current.then(async () => {
      try {
        const updated = await updatePostDraft(post.postId as string, {
          ...draft,
          grounding,
        });
        lastRevisionRef.current = updated.post_revision;
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
          setStatus(pendingDraftSyncRef.current ? "saving" : "saved");
        }
        return true;
      } catch (err) {
        logError("post.draft_sync_failed", {
          postId: post.postId,
          message: err instanceof Error ? err.message : String(err),
        });
        if (draftSyncMountedRef.current) setStatus("failed");
        return false;
      }
    });
    draftSyncChainRef.current = operation.then(() => undefined);
    return operation;
  }, [editable, grounding, post.postId]);

  const stage = useCallback((draft: PendingDraftSync) => {
    pendingDraftSyncRef.current = draft;
    setStatus("saving");
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
    setStatus("saving");
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
