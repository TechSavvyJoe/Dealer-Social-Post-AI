import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../services/apiErrors";
import {
  analyzeCaptionForDelivery,
  prohibitedClaimsMessage,
} from "../utils/complianceDisclosures";
import { toUiMessage } from "../utils/errorMessages";
import {
  buildFinalWebsiteDraftFallback,
  enqueueWebsitePublication,
  getWebsitePublication,
  listWebsiteDestinations,
  retryWebsitePublication,
  safeWebsiteReviewUrl,
  websitePublicationNeedsStatusRefresh,
  websitePublicationPollDelay,
  type WebsiteDraft,
  type WebsitePublication,
} from "../services/websitePublishing";
import { useAppStore } from "../stores/appStore";
import { useToast } from "../components/ui/Toast";
import type { Dealer, GeneratedPost } from "../types";
import type { PendingDraftSync } from "./useDraftAutosave";

/** The three functions from useDraftAutosave that a send needs, passed at
 * call time so this hook never has to be constructed after that one — the
 * two hooks would otherwise need each other's output before either mounts. */
export interface WebsiteHandoffAutosave {
  stage: (draft: PendingDraftSync) => void;
  flush: () => Promise<boolean>;
  lastRevisionRef: React.MutableRefObject<string | null>;
}

export interface WebsiteHandoffCaptions {
  activeCaptionPlatform: string | null;
  primaryCaption: string;
  editedText: string;
  bannedPhrases?: string;
  deliveryLanguageAllowed: boolean;
  effectivePack?: Record<string, string>;
  /** captionSetAnalysis.disclosures */
  disclosures: string;
}

export interface UseWebsiteHandoffOptions {
  post: GeneratedPost;
  dealerId: string;
  dealer: Dealer | null;
  imageBusy: boolean;
  textBusy: boolean;
  onPrepareFinalWebsiteDraft?: (input: {
    caption: string;
    image: string;
    currentDraft: WebsiteDraft;
  }) => Promise<WebsiteDraft>;
  captions: WebsiteHandoffCaptions;
}

/**
 * The delivery-lock gate a send must honor. Computed from
 * utils/postLocks.ts's derivePostLocks, which itself reads this hook's own
 * `websiteDraft` (via identityContext) — so it can only be known AFTER this
 * hook has already returned for the render, never passed in at construction.
 * `send` takes it as a call-time argument instead.
 */
export interface WebsiteHandoffSendInput {
  autosave: WebsiteHandoffAutosave;
  deliveryLocked: boolean;
  deliveryGateMessage: string;
}

export interface UseWebsiteHandoffResult {
  websiteDraft: WebsiteDraft | undefined;
  publication: WebsitePublication | undefined;
  checkError: string | null;
  sending: boolean;
  retrying: boolean;
  reviewUrl: string | undefined;
  /** True once a publication exists in any state other than not_requested. */
  handoffStarted: boolean;
  send: (input: WebsiteHandoffSendInput) => Promise<void>;
  retry: () => Promise<void>;
}

/**
 * Website handoff extracted verbatim from components/PostResult.tsx.
 *
 * Status is hydrated once per dealer:post. Polling follows the status. Send
 * first writes the exact visible creative, then enqueues with
 * expectedPostRevision. If the creative changed during preparation the send
 * aborts. On failure the authoritative status is restored, including
 * WEBSITE_DRAFT_ALREADY_SENT.
 */
export const useWebsiteHandoff = ({
  post,
  dealerId,
  dealer,
  imageBusy,
  textBusy,
  onPrepareFinalWebsiteDraft,
  captions,
}: UseWebsiteHandoffOptions): UseWebsiteHandoffResult => {
  const toast = useToast();
  const [websitePublication, setWebsitePublication] = useState<
    WebsitePublication | undefined
  >(
    post.websitePublication ??
      (post.websiteDraft?.enabled ? { status: "not_requested" } : undefined),
  );
  const [websiteDraft, setWebsiteDraft] = useState<WebsiteDraft | undefined>(
    post.websiteDraft,
  );
  const [websiteCheckError, setWebsiteCheckError] = useState<string | null>(null);
  const [websiteRetrying, setWebsiteRetrying] = useState(false);
  const [websiteSending, setWebsiteSending] = useState(false);
  /** Stops duplicate final sends before React can commit the disabled state. */
  const websiteSendingRef = useRef(false);
  /** One authoritative status read per restored/saved post, including not_requested. */
  const websiteStatusHydratedPostRef = useRef<string | null>(null);
  const [websiteDestinationRevision, setWebsiteDestinationRevision] = useState(0);

  const currentPostPropRef = useRef(post);
  currentPostPropRef.current = post;
  /** Live creative identity used to reject a send if anything changes during AI prep. */
  const latestWebsiteCreativeRef = useRef({
    postId: post.postId,
    image: post.image,
    caption: captions.activeCaptionPlatform
      ? captions.primaryCaption
      : captions.editedText,
  });
  latestWebsiteCreativeRef.current = {
    postId: post.postId,
    image: post.image,
    caption: captions.activeCaptionPlatform
      ? captions.primaryCaption
      : captions.editedText,
  };

  const persistWebsiteState = useCallback(
    (
      nextDraft: WebsiteDraft | undefined,
      nextPublication: WebsitePublication,
      creativePatch: Partial<GeneratedPost> = {},
    ) => {
      setWebsiteDraft(nextDraft);
      setWebsitePublication(nextPublication);
      const sourcePost = currentPostPropRef.current;
      if (!sourcePost.postId) return;
      const store = useAppStore.getState();
      const current = store.generatedPost;
      if (current && current.postId !== sourcePost.postId) return;
      const base = current || sourcePost;
      store.setGeneratedPost({
        ...base,
        ...creativePatch,
        websiteDraft: nextDraft ?? base.websiteDraft,
        websitePublication: nextPublication,
      });
    },
    [],
  );

  const websiteReviewUrl = useMemo(
    () => safeWebsiteReviewUrl(websitePublication?.reviewUrl),
    [websiteDestinationRevision, websitePublication?.reviewUrl],
  );

  const handoffStarted = Boolean(
    websitePublication && websitePublication.status !== "not_requested",
  );

  useEffect(() => {
    setWebsitePublication(
      post.websitePublication ??
        (post.websiteDraft?.enabled ? { status: "not_requested" } : undefined),
    );
    setWebsiteDraft(post.websiteDraft);
    setWebsiteCheckError(null);
  }, [post.postId, post.websiteDraft, post.websitePublication]);

  // safeWebsiteReviewUrl remains exact-origin bound. A direct session restore
  // can land on RESULT before PostCustomizer has loaded destination config, so
  // prime the allowlist here as well.
  useEffect(() => {
    if (!websiteDraft?.enabled) return;
    void listWebsiteDestinations()
      .then(() => setWebsiteDestinationRevision((revision) => revision + 1))
      .catch(() => undefined);
  }, [websiteDraft?.enabled]);

  // Local/session state is only a fast restore hint. Read the durable state
  // once even when it says not_requested so a reload or lost POST response can
  // never make an already-sent draft look editable again.
  useEffect(() => {
    if (!websiteDraft?.enabled || !post.postId) return;
    const hydrationKey = `${dealerId}:${post.postId}`;
    if (websiteStatusHydratedPostRef.current === hydrationKey) return;
    websiteStatusHydratedPostRef.current = hydrationKey;
    const controller = new AbortController();
    let active = true;

    void getWebsitePublication(post.postId, controller.signal)
      .then((next) => {
        if (!active) return;
        persistWebsiteState(next.websiteDraft ?? websiteDraft, next);
        setWebsiteCheckError(null);
      })
      .catch((err) => {
        if (!active || (err instanceof DOMException && err.name === "AbortError")) {
          return;
        }
        setWebsiteCheckError(
          "Website status could not be verified yet. No new handoff has been started.",
        );
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [dealerId, persistWebsiteState, post.postId, websiteDraft]);

  useEffect(() => {
    if (!websiteDraft?.enabled || !post.postId) return;
    if (!websitePublication || websitePublication.status === "not_requested") return;
    if (
      websitePublication &&
      !websitePublicationNeedsStatusRefresh(websitePublication.status)
    ) {
      return;
    }
    const controller = new AbortController();
    let active = true;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const refresh = async () => {
      if (typeof document !== "undefined" && document.hidden) {
        timeoutId = setTimeout(refresh, 60_000);
        return;
      }
      try {
        const next = await getWebsitePublication(
          post.postId as string,
          controller.signal,
        );
        if (!active) return;
        persistWebsiteState(next.websiteDraft ?? websiteDraft, next);
        setWebsiteCheckError(null);
        if (websitePublicationNeedsStatusRefresh(next.status)) {
          timeoutId = setTimeout(refresh, websitePublicationPollDelay(next.status));
        }
      } catch (err) {
        if (!active || (err instanceof DOMException && err.name === "AbortError")) {
          return;
        }
        setWebsiteCheckError(
          "Website status could not be refreshed. The delivery worker will keep retrying safely.",
        );
        timeoutId = setTimeout(refresh, 15_000);
      }
    };

    void refresh();
    return () => {
      active = false;
      controller.abort();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [persistWebsiteState, post.postId, websiteDraft, websitePublication?.status]);

  const retry = useCallback(async () => {
    if (!post.postId || websiteRetrying) return;
    const retryingStatusCheck = websitePublication?.status === "draft_ready";
    setWebsiteRetrying(true);
    try {
      const next = await retryWebsitePublication(post.postId);
      persistWebsiteState(next.websiteDraft ?? websiteDraft, next);
      setWebsiteCheckError(null);
      toast.success(
        retryingStatusCheck
          ? "Website status check queued."
          : "Private website draft queued again.",
      );
    } catch (err) {
      toast.error(toUiMessage(err, "Website draft could not be retried."));
    } finally {
      setWebsiteRetrying(false);
    }
  }, [
    persistWebsiteState,
    post.postId,
    toast,
    websiteDraft,
    websitePublication?.status,
    websiteRetrying,
  ]);

  const send = useCallback(
    async ({
      autosave,
      deliveryLocked,
      deliveryGateMessage,
    }: WebsiteHandoffSendInput) => {
      if (!post.postId || !websiteDraft?.enabled || websiteSendingRef.current) return;
      if (deliveryLocked) {
        toast.warning(deliveryGateMessage);
        return;
      }
      if (imageBusy || textBusy) {
        toast.warning("Wait for the current image or caption update to finish first.");
        return;
      }
      const { activeCaptionPlatform, primaryCaption, editedText, bannedPhrases } =
        captions;
      const finalCaption = activeCaptionPlatform ? primaryCaption : editedText;
      const finalCaptionAnalysis = analyzeCaptionForDelivery(
        finalCaption,
        bannedPhrases,
        undefined,
        captions.deliveryLanguageAllowed,
      );
      if (finalCaptionAnalysis.compliance.prohibited.length > 0) {
        toast.warning(
          prohibitedClaimsMessage(finalCaptionAnalysis.compliance.prohibited),
        );
        return;
      }

      const capturedCreative = {
        postId: post.postId,
        image: post.image,
        caption: finalCaptionAnalysis.caption,
      };
      const savedPrimaryCaption = activeCaptionPlatform
        ? analyzeCaptionForDelivery(
            primaryCaption,
            bannedPhrases,
            undefined,
            captions.deliveryLanguageAllowed,
          ).caption
        : capturedCreative.caption;
      const savedPlatformCaptions = activeCaptionPlatform
        ? {
            ...(captions.effectivePack || {}),
            [activeCaptionPlatform]: capturedCreative.caption,
          }
        : captions.effectivePack;
      const creativePatch: Partial<GeneratedPost> = {
        image: capturedCreative.image,
        text: savedPrimaryCaption,
        disclosures: captions.disclosures,
        ...(savedPlatformCaptions ? { platformCaptions: savedPlatformCaptions } : {}),
      };

      websiteSendingRef.current = true;
      setWebsiteSending(true);
      try {
        // Always write the exact visible creative once at the send boundary,
        // even when autosave was already idle. The returned server revision is
        // the compare-and-set token used by the enqueue route.
        autosave.stage({
          caption: savedPrimaryCaption,
          disclosures: captions.disclosures,
          imageDataUrl: capturedCreative.image,
          platformCaptions: savedPlatformCaptions,
        });
        autosave.lastRevisionRef.current = null;
        const draftSaved = await autosave.flush();
        const expectedPostRevision = autosave.lastRevisionRef.current;
        if (!draftSaved || !expectedPostRevision) {
          throw new Error(
            "The latest edit did not save. Retry the My Work save before sending.",
          );
        }
        const finalDraft = onPrepareFinalWebsiteDraft
          ? await onPrepareFinalWebsiteDraft({
              caption: finalCaptionAnalysis.caption,
              image: capturedCreative.image,
              currentDraft: websiteDraft,
            })
          : buildFinalWebsiteDraftFallback({
              currentDraft: websiteDraft,
              dealerName: dealer?.name || "the dealership",
              oemAffiliation: dealer?.oem_affiliation,
              caption: finalCaptionAnalysis.caption,
            });
        const liveCreative = latestWebsiteCreativeRef.current;
        const liveCaption = analyzeCaptionForDelivery(
          liveCreative.caption,
          bannedPhrases,
          undefined,
          captions.deliveryLanguageAllowed,
        ).caption;
        const storedCreative = useAppStore.getState().generatedPost;
        const changedCreativePart =
          liveCreative.postId !== capturedCreative.postId
            ? "post"
            : liveCreative.image !== capturedCreative.image
              ? "live image"
              : liveCaption !== capturedCreative.caption
                ? "live caption"
                : storedCreative?.postId === capturedCreative.postId &&
                    storedCreative.image !== capturedCreative.image
                  ? "saved image"
                  : null;
        if (changedCreativePart) {
          throw new Error(
            "The creative changed while the website draft was being prepared. Review it and send again.",
          );
        }
        const next = await enqueueWebsitePublication(
          post.postId,
          finalDraft,
          expectedPostRevision,
        );
        persistWebsiteState(next.websiteDraft ?? finalDraft, next, creativePatch);
        setWebsiteCheckError(null);
        toast.success(
          next.status === "waiting_approval"
            ? "Final private website draft sent for manager approval."
            : "Final private draft sent to Customer Hub.",
        );
      } catch (err) {
        // If the POST response was lost—or another tab completed the exact
        // handoff—restore the durable status before offering another Send.
        let restored = false;
        try {
          const authoritative = await getWebsitePublication(post.postId);
          if (authoritative.status !== "not_requested") {
            // The status response carries the winning frozen draft. Never bind
            // this tab's submitted copy to a handoff another tab won.
            persistWebsiteState(
              authoritative.websiteDraft ?? websiteDraft,
              authoritative,
            );
            setWebsiteCheckError(null);
            toast.warning(
              err instanceof ApiError && err.code === "WEBSITE_DRAFT_ALREADY_SENT"
                ? "Another window already sent the final website draft. The sent copy and status were restored."
                : "The website handoff was already recorded. Its final copy and status were restored.",
            );
            restored = true;
          }
        } catch {
          // Preserve the original, more useful send error below.
        }
        if (!restored) {
          toast.error(toUiMessage(err, "The final website draft could not be sent."));
        }
      } finally {
        websiteSendingRef.current = false;
        setWebsiteSending(false);
      }
    },
    [
      captions,
      dealer?.name,
      dealer?.oem_affiliation,
      imageBusy,
      onPrepareFinalWebsiteDraft,
      post.image,
      post.postId,
      persistWebsiteState,
      textBusy,
      toast,
      websiteDraft,
    ],
  );

  return {
    websiteDraft,
    publication: websitePublication,
    checkError: websiteCheckError,
    sending: websiteSending,
    retrying: websiteRetrying,
    reviewUrl: websiteReviewUrl,
    handoffStarted,
    send,
    retry,
  };
};
