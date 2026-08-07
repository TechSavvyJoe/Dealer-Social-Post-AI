import { useCallback, useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { useAppStore } from "../stores/appStore";
import { useShallow } from "zustand/react/shallow";
import { useGemini } from "./useGemini";
import {
  StyleOption,
  ToneOption,
  VideoStyle,
  VideoRequestOptions,
  AppStep,
  GeneratedPost,
  ImageQualityTier,
  MediaOutputMode,
} from "../types";
import { useToast } from "../components/ui/Toast";
import { normalizeError, recoveryHint } from "../utils/errorHandler";
import { logPost } from "../services/posts";
import {
  analyzeCaptionSetForDelivery,
  prepareCaptionForDelivery,
} from "../utils/complianceDisclosures";
import type { DealerBrandKit } from "../utils/brandKit";
import { logEvent, logError } from "../utils/telemetry";
import {
  CapturedRelease,
  linkReleaseToPost,
  runWithPersistedPhotoRelease,
} from "../services/photoReleases";
import {
  parsePlatformCaptionPack,
  platformsToCaptionPackBrief,
  resolvePrimaryImageProfile,
  shouldGenerateCaptionPack,
  type PrimaryImageProfile,
  type PlatformId,
} from "../services/platformCopy";
import type { Dealer } from "../types";
import type { CaptionGenerationResult } from "../services/modelConfig";
import { MODEL_POLICY_VERSION } from "../services/modelConfig";
import { EXPORT_FORMATS, renderFormat } from "../utils/multiFormatExport";
import {
  buildFinalWebsiteDraftFallback,
  buildFinalWebsiteDraftPrompt,
  buildFallbackWebsiteDraft,
  buildWebsiteDraftPrompt,
  parseFinalWebsiteDraftResponse,
  parseWebsiteDraftResponse,
  type FinalWebsiteDraftSource,
  type WebsiteDraft,
  type WebsiteDraftSource,
} from "../services/websitePublishing";

const brandKitFromDealer = (dealer?: Dealer | null): DealerBrandKit | null => {
  if (!dealer) return null;
  return {
    name: dealer.name,
    default_hashtags: dealer.default_hashtags,
    default_footer: dealer.default_footer,
  };
};

const latestSuccessfulAt = (
  ...values: Array<string | null | undefined>
): string | undefined => {
  const valid = values.filter((value): value is string => {
    return typeof value === "string" && Number.isFinite(Date.parse(value));
  });
  return valid.sort((a, b) => Date.parse(b) - Date.parse(a))[0];
};

const workspaceKeyForPost = (post: GeneratedPost | null | undefined): string | null =>
  post?.postId || post?.aiMeta?.image.attemptId || post?.image || null;

const workspaceIsCurrent = (workspaceKey: string | null): boolean =>
  workspaceKeyForPost(useAppStore.getState().generatedPost) === workspaceKey;

const assertOperationAuthEpoch = (operationAuthEpoch: number): void => {
  if (operationAuthEpoch !== useAppStore.getState().authEpoch) {
    throw new DOMException(
      "The signed-in workspace changed during this operation.",
      "AbortError",
    );
  }
};

const renderExactPrimaryImage = async (
  image: string,
  formatId: PrimaryImageProfile["primaryFormatId"],
): Promise<string> => {
  const format = EXPORT_FORMATS.find((candidate) => candidate.id === formatId);
  if (!format) throw new Error("Selected output format is unavailable.");
  return renderFormat(image, format);
};

/**
 * Replace caption provenance after a regeneration while retaining the image
 * provenance for the creative that is still on screen. Older saved posts may
 * predate modality metadata; their existing image is represented as unknown
 * instead of falsely attributing it to a provider or model.
 */
export const mergeCaptionProvenance = (
  current: GeneratedPost["aiMeta"] | undefined,
  captionResult: CaptionGenerationResult,
  selectedTier: ImageQualityTier,
): NonNullable<GeneratedPost["aiMeta"]> => {
  const image = current?.image ?? {
    task: selectedTier === "studio" ? "image_studio" : "image_standard",
    tier: selectedTier,
    provider: "unknown",
    model: null,
    fallbackCount: 0,
    lastSuccessAt: null,
  };
  const lastSuccessfulGenerationAt = latestSuccessfulAt(
    captionResult.aiMeta.lastSuccessAt,
    image.lastSuccessAt,
  );

  return {
    captionSource: captionResult.captionSource,
    selectedTier: current?.selectedTier ?? selectedTier,
    ...(captionResult.aiMeta.model ? { model: captionResult.aiMeta.model } : {}),
    fallbackCount: captionResult.aiMeta.fallbackCount + image.fallbackCount,
    ...(lastSuccessfulGenerationAt ? { lastSuccessfulGenerationAt } : {}),
    caption: captionResult.aiMeta,
    image,
    modelPolicyVersion: current?.modelPolicyVersion ?? MODEL_POLICY_VERSION,
  };
};

export interface GenerationMeta {
  salespersonName?: string;
  /** When the salesperson was picked from the dealer's roster, this is the salespeople record id. */
  salespersonId?: string;
  vin?: string;
  scenarioId?: string;
  hasRelease?: boolean;
  /** Signed-but-unsaved release captured before generation. Saved linked to the post on success so we never create orphan release records. */
  capturedRelease?: CapturedRelease;
  /** Prepare a private Customer Hub draft after AI generation. */
  websiteEnabled?: boolean;
  /** Grounded year/make/model/trim from VIN decode; never the VIN. */
  websiteVehicleDescription?: string;
}

export const useGeneration = () => {
  const { error: toastError, warning: toastWarning } = useToast();
  const {
    currentDealer,
    selectedImage,
    generatedPost,
    generationParams,
    preferredTone,
    imageQualityTier,
    authEpoch,
    setGeneratedPost,
    setGenerationParams,
    setError,
    setStep,
  } = useAppStore(
    useShallow((state) => ({
      currentDealer: state.currentDealer,
      selectedImage: state.selectedImage,
      generatedPost: state.generatedPost,
      generationParams: state.generationParams,
      preferredTone: state.preferredTone,
      imageQualityTier: state.imageQualityTier,
      authEpoch: state.authEpoch,
      setGeneratedPost: state.setGeneratedPost,
      setGenerationParams: state.setGenerationParams,
      setError: state.setError,
      setStep: state.setStep,
    })),
  );

  const { runGeminiTask, loadGeminiService } = useGemini();

  // Removed local lastGenerationParams state in favor of store persistence

  const [generationProgress, setGenerationProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const timeoutsRef = useRef<NodeJS.Timeout[]>([]);
  // One controller per active video poll. Aborted on unmount so a salesperson
  // who navigates away mid-render stops eating Vertex quota.
  const videoAbortControllersRef = useRef<Set<AbortController>>(new Set());

  const cleanupTimers = useCallback(() => {
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
  }, []);

  const abortActiveVideoPolls = useCallback(() => {
    for (const ctrl of videoAbortControllersRef.current) {
      try {
        ctrl.abort();
      } catch {
        /* ignore */
      }
    }
    videoAbortControllersRef.current.clear();
  }, []);

  // Authentication is a hard workspace boundary. Provider calls that cannot
  // be cancelled are discarded by epoch checks below; Veo polling is aborted.
  useEffect(() => {
    cleanupTimers();
    abortActiveVideoPolls();
  }, [abortActiveVideoPolls, authEpoch, cleanupTimers]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupTimers();
      abortActiveVideoPolls();
    };
  }, [abortActiveVideoPolls, cleanupTimers]);

  const generateMutation = useMutation({
    mutationFn: async (params: {
      style: StyleOption;
      tone: ToneOption;
      customerName: string;
      customText?: string;
      creativeBrief?: string;
      platformIds?: PlatformId[];
      mediaOutputMode: MediaOutputMode;
      primaryFormatId: PrimaryImageProfile["primaryFormatId"];
      imageAspectRatio: PrimaryImageProfile["imageAspectRatio"];
      meta?: GenerationMeta;
      authEpoch: number;
    }) => {
      assertOperationAuthEpoch(params.authEpoch);
      if (!selectedImage || !currentDealer) throw new Error("Missing required data");

      const gated = await runWithPersistedPhotoRelease(
        params.meta?.capturedRelease,
        currentDealer.name,
        async () => {
          assertOperationAuthEpoch(params.authEpoch);
          const { generateSocialPost } = await loadGeminiService();
          assertOperationAuthEpoch(params.authEpoch);
          return runGeminiTask("ai.generate", () => {
            assertOperationAuthEpoch(params.authEpoch);
            return generateSocialPost(
              selectedImage,
              params.style,
              params.tone,
              currentDealer.name,
              params.customerName,
              currentDealer.logo,
              params.customText,
              params.creativeBrief,
              imageQualityTier,
              params.imageAspectRatio,
            );
          });
        },
        params.authEpoch,
      );
      assertOperationAuthEpoch(params.authEpoch);
      const exactImage = await renderExactPrimaryImage(
        gated.result.image,
        params.primaryFormatId,
      );
      assertOperationAuthEpoch(params.authEpoch);
      return {
        ...gated,
        result: {
          ...gated.result,
          image: exactImage,
        },
      };
    },
    onMutate: (variables) => {
      cleanupTimers();
      setStep(AppStep.GENERATING);
      setError(null);
      setGenerationProgress(0);
      setProgressMessage("Analyzing your image...");
      setGenerationParams({
        style: variables.style,
        tone: variables.tone,
        customerName: variables.customerName,
        customText: variables.customText,
        creativeBrief: variables.creativeBrief,
        platformIds: variables.platformIds,
        scenarioId: variables.meta?.scenarioId,
        mediaOutputMode: variables.mediaOutputMode,
        primaryFormatId: variables.primaryFormatId,
        imageAspectRatio: variables.imageAspectRatio,
        websiteEnabled: variables.meta?.websiteEnabled,
        websiteVehicleDescription: variables.meta?.websiteVehicleDescription,
      });

      progressIntervalRef.current = setInterval(() => {
        setGenerationProgress((prev) => {
          if (prev >= 95) return prev;
          const remaining = 95 - prev;
          const increment = Math.max(0.1, remaining * 0.05 * (Math.random() + 0.5));
          return prev + increment;
        });
      }, 800);

      timeoutsRef.current.push(
        setTimeout(() => setProgressMessage("Consulting the style guide..."), 2000),
      );
      timeoutsRef.current.push(
        setTimeout(() => setProgressMessage("Crafting the perfect caption..."), 4500),
      );
      timeoutsRef.current.push(
        setTimeout(() => setProgressMessage("Applying final polish..."), 7000),
      );
      timeoutsRef.current.push(
        setTimeout(
          () => setProgressMessage("AI is thinking hard... this might take a moment."),
          15000,
        ),
      );
      timeoutsRef.current.push(
        setTimeout(
          () => setProgressMessage("Still working... generating high-quality content."),
          30000,
        ),
      );
      timeoutsRef.current.push(
        setTimeout(
          () => setProgressMessage("Almost there! Thanks for your patience."),
          60000,
        ),
      );
      timeoutsRef.current.push(
        setTimeout(() => setProgressMessage("Finalizing your post..."), 90000),
      );
    },
    onSuccess: async (gatedResult, variables) => {
      if (variables.authEpoch !== useAppStore.getState().authEpoch) return;
      cleanupTimers();
      setGenerationProgress(100);
      setProgressMessage("Complete!");

      const result = gatedResult.result;
      const releaseId = gatedResult.releaseId;

      if (result.aiMeta.image.provider === "original") {
        toastWarning(
          "AI styling couldn't be applied this time — showing your original photo with the generated caption.",
        );
      }

      // Scan the caption for compliance triggers. Disclosures go into a
      // separate `disclosures` field so the editable caption textarea
      // never contains them (and a salesperson can't silently delete them).
      let preparedCaption;
      try {
        preparedCaption = prepareCaptionForDelivery(
          result.text,
          currentDealer?.banned_phrases,
          brandKitFromDealer(currentDealer),
        );
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "The generated caption contains a prohibited advertising claim.";
        logEvent("compliance.prohibited_detected", {
          blocked: true,
        });
        setError(message);
        toastError(message);
        setStep(AppStep.CUSTOMIZE);
        return;
      }
      const compliance = preparedCaption.compliance;
      if (compliance.changed && compliance.matches.length > 0) {
        logEvent("compliance.disclosures_detected", {
          categories: Array.from(new Set(compliance.matches.map((m) => m.category))),
        });
      }
      const platformIds = variables.platformIds?.filter(Boolean) ?? [];
      const finalPost: GeneratedPost = {
        ...result,
        text: preparedCaption.caption,
        isBasicFallback: result.captionSource === "basic_fallback",
        disclosures: preparedCaption.disclosures,
        disclosureCategories: preparedCaption.disclosureCategories,
        // Empty is authoritative: it represents a Website-only post.
        platformIds,
        mediaOutputMode: variables.mediaOutputMode,
        primaryFormatId: variables.primaryFormatId,
        imageAspectRatio: variables.imageAspectRatio,
      };

      // Destination copy can run together after the approved primary
      // caption/image exists. Both paths own safe fallbacks and never block the
      // main post. Website preparation remains a private draft only.
      const shouldPrepareCaptionPack =
        shouldGenerateCaptionPack(platformIds) &&
        Boolean(selectedImage && currentDealer);
      const shouldPrepareWebsite = Boolean(
        variables.meta?.websiteEnabled && currentDealer && finalPost.image,
      );
      if (shouldPrepareCaptionPack || shouldPrepareWebsite) {
        setProgressMessage("Finishing destination copy...");
      }

      const captionPackTask = async (): Promise<Record<string, string> | undefined> => {
        if (!shouldPrepareCaptionPack || !selectedImage || !currentDealer) {
          return undefined;
        }
        try {
          const packBrief = platformsToCaptionPackBrief(
            platformIds,
            currentDealer.name,
            preparedCaption.caption,
          );
          assertOperationAuthEpoch(variables.authEpoch);
          const { generateSocialPostText } = await loadGeminiService();
          assertOperationAuthEpoch(variables.authEpoch);
          const rawPack = await runGeminiTask("ai.caption.pack", () => {
            assertOperationAuthEpoch(variables.authEpoch);
            return generateSocialPostText(
              selectedImage,
              variables.tone,
              currentDealer.name,
              variables.customerName,
              true,
              packBrief,
              variables.style,
            );
          });
          assertOperationAuthEpoch(variables.authEpoch);
          const parsed = parsePlatformCaptionPack(rawPack, platformIds);
          const cleaned: Record<string, string> = {};
          for (const [id, caption] of Object.entries(parsed)) {
            try {
              const prepared = prepareCaptionForDelivery(
                caption,
                currentDealer.banned_phrases,
                brandKitFromDealer(currentDealer),
              );
              cleaned[id] = prepared.caption;
            } catch {
              // Skip prohibited variants; primary caption remains usable.
            }
          }
          return Object.keys(cleaned).length > 0 ? cleaned : undefined;
        } catch (err) {
          logError("caption.pack_failed", {
            message: err instanceof Error ? err.message : String(err),
            platforms: platformIds,
          });
          return undefined;
        }
      };

      const websiteDraftTask = async () => {
        if (!shouldPrepareWebsite || !currentDealer) {
          return undefined;
        }
        const source: WebsiteDraftSource = {
          scenarioId: variables.meta?.scenarioId,
          customScenariosJson: currentDealer.custom_scenarios,
          dealerName: currentDealer.name,
          caption: preparedCaption.caption,
          customerDisplayName: variables.customerName,
          vehicleDescription: variables.meta?.websiteVehicleDescription,
        };
        const fallback = buildFallbackWebsiteDraft(source);
        try {
          assertOperationAuthEpoch(variables.authEpoch);
          const { generateWebsiteDraftMetadata } = await loadGeminiService();
          assertOperationAuthEpoch(variables.authEpoch);
          // This call intentionally runs beside the queued caption-pack call.
          // The proxy/model layer owns retries; malformed JSON is handled by
          // the strict parser below.
          logEvent("ai.website.draft.start", {
            kind: fallback.kind,
            category: fallback.category,
          });
          const raw = await generateWebsiteDraftMetadata(
            finalPost.image,
            buildWebsiteDraftPrompt(source),
          );
          assertOperationAuthEpoch(variables.authEpoch);
          const prepared = parseWebsiteDraftResponse(raw, source);
          logEvent("ai.website.draft.success", {
            source: prepared.source,
            kind: prepared.draft.kind,
          });
          return prepared.draft;
        } catch (err) {
          logError("ai.website.draft.failure", {
            message: err instanceof Error ? err.message : String(err),
            kind: fallback.kind,
          });
          return fallback;
        }
      };

      const [platformCaptions, websiteDraft] = await Promise.all([
        captionPackTask(),
        websiteDraftTask(),
      ]);
      if (platformCaptions) {
        finalPost.platformCaptions = platformCaptions;
        const disclosureUnion = analyzeCaptionSetForDelivery(
          [finalPost.text, ...Object.values(platformCaptions)],
          currentDealer?.banned_phrases,
        );
        finalPost.disclosures = disclosureUnion.disclosures;
        finalPost.disclosureCategories = disclosureUnion.disclosureCategories;
      }
      if (websiteDraft) finalPost.websiteDraft = websiteDraft;
      if (variables.authEpoch !== useAppStore.getState().authEpoch) return;

      // Log post + (if a release was captured) link the already-persisted
      // release to it. The signature was durably saved before the provider
      // call, and this phase never uploads or duplicates it. An
      // approval-gated creative must be persisted before rendering the result,
      // because the returned id is the secure status-polling handle and the
      // manager needs the exact image/caption they are approving.
      if (currentDealer) {
        const persistPost = async () => {
          const captured = variables.meta?.capturedRelease;
          assertOperationAuthEpoch(variables.authEpoch);
          const post = await logPost(
            {
              dealerId: currentDealer.id,
              style: variables.style,
              tone: variables.tone,
              customerName: variables.customerName,
              scenarioId: variables.meta?.scenarioId,
              vin: variables.meta?.vin,
              // The release route flips this true only after its protected
              // signature file has been durably stored. Starting false avoids a
              // false consent claim if that second write fails.
              hasRelease: false,
              hasVideo: false,
              requiresApproval: !!currentDealer.requires_approval,
              caption: finalPost.text,
              disclosures: finalPost.disclosures,
              imageDataUrl: finalPost.image,
              captionSource: finalPost.captionSource,
              generationTier: finalPost.aiMeta?.selectedTier,
              generationModel: finalPost.aiMeta?.model,
              generationFallbackCount: finalPost.aiMeta?.fallbackCount,
              generationLastSuccessAt: finalPost.aiMeta?.lastSuccessfulGenerationAt,
              modelPolicyVersion: finalPost.aiMeta?.modelPolicyVersion,
              captionAttemptId: finalPost.aiMeta?.caption.attemptId,
              imageAttemptId: finalPost.aiMeta?.image.attemptId,
              platformIds: finalPost.platformIds,
              mediaOutputMode: finalPost.mediaOutputMode,
              platformCaptions: finalPost.platformCaptions,
              primaryFormatId: finalPost.primaryFormatId,
              imageAspectRatio: finalPost.imageAspectRatio,
              websiteDraft: finalPost.websiteDraft,
            },
            variables.authEpoch,
          );
          assertOperationAuthEpoch(variables.authEpoch);
          let releaseStatus: NonNullable<GeneratedPost["releaseStatus"]> =
            post?.release_required && post.release_status !== "saved"
              ? "save_failed"
              : captured
                ? "save_failed"
                : "not_required";
          if (captured && releaseId && post) {
            try {
              await linkReleaseToPost(releaseId, post.id, variables.authEpoch);
              assertOperationAuthEpoch(variables.authEpoch);
              releaseStatus = "saved";
            } catch (err) {
              logError("photo_release.link_failed", {
                message: err instanceof Error ? err.message : String(err),
                postId: post.id,
                releaseId,
              });
            }
          }
          if (captured && (!releaseId || !post)) {
            logError("photo_release.link_failed", {
              message: !releaseId
                ? "Persisted release id was unavailable"
                : "Post record was unavailable for release linking",
            });
          }
          return { post, releaseStatus };
        };

        // Await the small first-party persistence request for every generated
        // post. Besides making metrics truthful, this gives subsequent video
        // and release updates an owner-scoped post id.
        const persisted = await persistPost();
        if (variables.authEpoch !== useAppStore.getState().authEpoch) return;
        const post = persisted.post;
        finalPost.releaseStatus = persisted.releaseStatus;
        if (post) {
          finalPost.postId = post.id;
          if (post.website_draft) finalPost.websiteDraft = post.website_draft;
          finalPost.websitePublication =
            post.website_publication ||
            (finalPost.websiteDraft
              ? {
                  status: "not_requested",
                }
              : undefined);
        } else if (finalPost.websiteDraft) {
          finalPost.websitePublication = {
            status: "failed",
            lastError: "The website draft could not be saved with this post.",
          };
        }

        if (persisted.releaseStatus === "save_failed") {
          toastError(
            "The signed photo release could not be stored. Copy, share, save, and export are locked; check your connection and create another post to retry.",
          );
        }

        if (currentDealer.requires_approval) {
          if (post) {
            finalPost.approvalStatus = post.approval_status || "pending";
          } else {
            // Preserve the expensive generated result, but fail closed: no id
            // means there is nothing a manager can review or approve.
            finalPost.approvalStatus = "submission_failed";
            const approvalError =
              "Your post was generated, but it could not be submitted for manager approval. Save and share remain locked; check your connection and create another post to retry.";
            setError(approvalError);
            toastError(approvalError);
          }
        } else {
          finalPost.approvalStatus = "n_a";
        }

        if (!post && !currentDealer.requires_approval) {
          toastWarning(
            "Your post was created, but it could not be saved to history. You can still share and save it now.",
          );
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (variables.authEpoch !== useAppStore.getState().authEpoch) return;
      setGeneratedPost(finalPost);
      setStep(AppStep.RESULT);
    },
    onError: (err, variables) => {
      if (variables.authEpoch !== useAppStore.getState().authEpoch) return;
      cleanupTimers();
      const normalized = normalizeError(err);
      const fullMsg = `Failed to generate your post. ${normalized.message} ${recoveryHint(normalized)}`;
      setError(fullMsg);
      toastError(fullMsg);
      setStep(AppStep.CUSTOMIZE);
    },
  });

  const handleGenerate = useCallback(
    async (
      style: StyleOption,
      tone: ToneOption,
      customerName: string,
      customText?: string,
      creativeBrief?: string,
      meta?: GenerationMeta,
      platformIds?: PlatformId[],
      outputProfile?: PrimaryImageProfile,
      mediaOutputMode: MediaOutputMode = "photo",
    ) => {
      const resolvedProfile = outputProfile ?? resolvePrimaryImageProfile(platformIds);
      await generateMutation.mutateAsync({
        style,
        tone,
        customerName,
        customText,
        creativeBrief,
        platformIds,
        mediaOutputMode,
        primaryFormatId: resolvedProfile.primaryFormatId,
        imageAspectRatio: resolvedProfile.imageAspectRatio,
        meta,
        authEpoch: useAppStore.getState().authEpoch,
      });
    },
    [generateMutation],
  );

  const regenerateImageMutation = useMutation({
    mutationFn: async () => {
      const sourcePost = useAppStore.getState().generatedPost;
      const workspaceKey = workspaceKeyForPost(sourcePost);
      const operationAuthEpoch = useAppStore.getState().authEpoch;
      if (!selectedImage || !generationParams || !currentDealer || !sourcePost)
        throw new Error("Missing required data");
      assertOperationAuthEpoch(operationAuthEpoch);
      const { generateSocialPost } = await loadGeminiService();
      assertOperationAuthEpoch(operationAuthEpoch);
      const result = await runGeminiTask("ai.regenerate.image", () => {
        assertOperationAuthEpoch(operationAuthEpoch);
        return generateSocialPost(
          selectedImage,
          generationParams.style,
          generationParams.tone,
          currentDealer.name,
          generationParams.customerName,
          currentDealer.logo,
          generationParams.customText || generatedPost?.text,
          generationParams.creativeBrief,
          imageQualityTier,
          generationParams.imageAspectRatio ??
            resolvePrimaryImageProfile(generationParams.platformIds).imageAspectRatio,
        );
      });
      assertOperationAuthEpoch(operationAuthEpoch);
      const formatId =
        sourcePost.primaryFormatId ??
        generationParams.primaryFormatId ??
        resolvePrimaryImageProfile(
          sourcePost.platformIds ?? generationParams.platformIds,
        ).primaryFormatId;
      const image = await renderExactPrimaryImage(result.image, formatId);
      assertOperationAuthEpoch(operationAuthEpoch);
      return {
        workspaceKey,
        operationAuthEpoch,
        image,
      };
    },
    onMutate: () => setError(null),
    // This control promises an image-only refresh. Preserve the caption,
    // disclosure, release, approval, and owner-scoped post metadata rather
    // than replacing the entire reviewed result with the provider response.
    onSuccess: ({ workspaceKey, operationAuthEpoch, image }) => {
      if (
        operationAuthEpoch !== useAppStore.getState().authEpoch ||
        !workspaceIsCurrent(workspaceKey)
      )
        return;
      const currentPost = useAppStore.getState().generatedPost;
      if (currentPost) setGeneratedPost({ ...currentPost, image });
    },
    onError: (err) => {
      const normalized = normalizeError(err);
      const msg = `Failed to regenerate image. ${normalized.message} ${recoveryHint(normalized)}`;
      setError(msg);
      toastError(msg);
    },
  });

  const handleRegenerateImage = useCallback(async () => {
    await regenerateImageMutation.mutateAsync();
  }, [regenerateImageMutation]);

  const funModeMutation = useMutation({
    mutationFn: async (styleName?: string) => {
      const sourcePost = useAppStore.getState().generatedPost;
      const workspaceKey = workspaceKeyForPost(sourcePost);
      const operationAuthEpoch = useAppStore.getState().authEpoch;
      if (!selectedImage || !currentDealer || !sourcePost)
        throw new Error("Missing required data");
      assertOperationAuthEpoch(operationAuthEpoch);
      const { generateFunSocialPostImage } = await loadGeminiService();
      assertOperationAuthEpoch(operationAuthEpoch);
      const generatedImage = await runGeminiTask("ai.fun", () => {
        assertOperationAuthEpoch(operationAuthEpoch);
        return generateFunSocialPostImage(
          selectedImage,
          currentDealer.name,
          currentDealer.logo,
          styleName,
          imageQualityTier,
          generationParams?.imageAspectRatio ??
            generatedPost?.imageAspectRatio ??
            resolvePrimaryImageProfile(
              generationParams?.platformIds ?? generatedPost?.platformIds,
            ).imageAspectRatio,
        );
      });
      assertOperationAuthEpoch(operationAuthEpoch);
      const formatId =
        sourcePost.primaryFormatId ??
        generationParams?.primaryFormatId ??
        resolvePrimaryImageProfile(
          sourcePost.platformIds ?? generationParams?.platformIds,
        ).primaryFormatId;
      const image = await renderExactPrimaryImage(generatedImage, formatId);
      assertOperationAuthEpoch(operationAuthEpoch);
      return {
        workspaceKey,
        operationAuthEpoch,
        image,
      };
    },
    onMutate: () => setError(null),
    onSuccess: ({ workspaceKey, operationAuthEpoch, image }) => {
      if (
        operationAuthEpoch !== useAppStore.getState().authEpoch ||
        !workspaceIsCurrent(workspaceKey)
      )
        return;
      const currentPost = useAppStore.getState().generatedPost;
      if (currentPost) setGeneratedPost({ ...currentPost, image });
    },
    onError: (err) => {
      const normalized = normalizeError(err);
      const msg = `Failed to generate fun image. ${normalized.message} ${recoveryHint(normalized)}`;
      setError(msg);
      toastError(msg);
    },
  });

  const handleFunMode = useCallback(
    async (styleName?: string) => {
      await funModeMutation.mutateAsync(styleName);
    },
    [funModeMutation],
  );

  const editImageMutation = useMutation({
    mutationFn: async (editPrompt: string) => {
      const sourcePost = useAppStore.getState().generatedPost;
      const workspaceKey = workspaceKeyForPost(sourcePost);
      const operationAuthEpoch = useAppStore.getState().authEpoch;
      if (!sourcePost?.image || !editPrompt.trim() || !currentDealer)
        throw new Error("Missing required data");
      assertOperationAuthEpoch(operationAuthEpoch);
      const { editSocialPostImage } = await loadGeminiService();
      assertOperationAuthEpoch(operationAuthEpoch);
      const generatedImage = await runGeminiTask("ai.edit.image", () => {
        assertOperationAuthEpoch(operationAuthEpoch);
        return editSocialPostImage(
          sourcePost.image,
          editPrompt,
          currentDealer.name,
          currentDealer.logo,
          imageQualityTier,
          sourcePost.imageAspectRatio ??
            generationParams?.imageAspectRatio ??
            resolvePrimaryImageProfile(
              sourcePost.platformIds ?? generationParams?.platformIds,
            ).imageAspectRatio,
        );
      });
      assertOperationAuthEpoch(operationAuthEpoch);
      const formatId =
        sourcePost.primaryFormatId ??
        generationParams?.primaryFormatId ??
        resolvePrimaryImageProfile(
          sourcePost.platformIds ?? generationParams?.platformIds,
        ).primaryFormatId;
      const image = await renderExactPrimaryImage(generatedImage, formatId);
      assertOperationAuthEpoch(operationAuthEpoch);
      return {
        workspaceKey,
        operationAuthEpoch,
        image,
      };
    },
    onMutate: () => setError(null),
    onSuccess: ({ workspaceKey, operationAuthEpoch, image }) => {
      if (
        operationAuthEpoch !== useAppStore.getState().authEpoch ||
        !workspaceIsCurrent(workspaceKey)
      )
        return;
      const currentPost = useAppStore.getState().generatedPost;
      if (currentPost) setGeneratedPost({ ...currentPost, image });
    },
    onError: (err) => {
      const normalized = normalizeError(err);
      const msg = `Failed to apply image edits. ${normalized.message} ${recoveryHint(normalized)}`;
      setError(msg);
      toastError(msg);
    },
  });

  const handleEditImage = useCallback(
    async (editPrompt: string) => {
      await editImageMutation.mutateAsync(editPrompt);
    },
    [editImageMutation],
  );

  /** Rebuild multi-platform pack for the current primary caption (non-fatal). */
  const rebuildCaptionPack = useCallback(
    async (
      primaryCaption: string,
      platformIds: string[],
      operationAuthEpoch: number,
    ): Promise<
      | {
          captions: Record<string, string>;
          disclosures: string;
          disclosureCategories: GeneratedPost["disclosureCategories"];
        }
      | undefined
    > => {
      if (!shouldGenerateCaptionPack(platformIds) || !selectedImage || !currentDealer) {
        return undefined;
      }
      try {
        assertOperationAuthEpoch(operationAuthEpoch);
        const packBrief = platformsToCaptionPackBrief(
          platformIds,
          currentDealer.name,
          primaryCaption,
        );
        const { generateSocialPostText } = await loadGeminiService();
        assertOperationAuthEpoch(operationAuthEpoch);
        const rawPack = await runGeminiTask("ai.caption.pack", () => {
          assertOperationAuthEpoch(operationAuthEpoch);
          return generateSocialPostText(
            selectedImage,
            generationParams?.tone || preferredTone,
            currentDealer.name,
            generationParams?.customerName,
            true,
            packBrief,
            generationParams?.style,
          );
        });
        assertOperationAuthEpoch(operationAuthEpoch);
        const parsed = parsePlatformCaptionPack(rawPack, platformIds);
        const cleaned: Record<string, string> = {};
        const kit = brandKitFromDealer(currentDealer);
        for (const [id, caption] of Object.entries(parsed)) {
          try {
            const prepared = prepareCaptionForDelivery(
              caption,
              currentDealer.banned_phrases,
              kit,
            );
            cleaned[id] = prepared.caption;
          } catch {
            /* skip prohibited variant */
          }
        }
        if (Object.keys(cleaned).length === 0) return undefined;
        const disclosureUnion = analyzeCaptionSetForDelivery(
          [primaryCaption, ...Object.values(cleaned)],
          currentDealer.banned_phrases,
        );
        return {
          captions: cleaned,
          disclosures: disclosureUnion.disclosures,
          disclosureCategories: disclosureUnion.disclosureCategories,
        };
      } catch (err) {
        logError("caption.pack_rebuild_failed", {
          message: err instanceof Error ? err.message : String(err),
          platforms: platformIds,
        });
        return undefined;
      }
    },
    [
      selectedImage,
      currentDealer,
      generationParams,
      preferredTone,
      loadGeminiService,
      runGeminiTask,
    ],
  );

  const regenerateTextMutation = useMutation({
    mutationFn: async () => {
      const sourcePost = useAppStore.getState().generatedPost;
      const workspaceKey = workspaceKeyForPost(sourcePost);
      const operationAuthEpoch = useAppStore.getState().authEpoch;
      if (!selectedImage || !generationParams || !currentDealer || !sourcePost)
        throw new Error("Missing required data");
      assertOperationAuthEpoch(operationAuthEpoch);
      const { generateSocialPostTextDetailed } = await loadGeminiService();
      assertOperationAuthEpoch(operationAuthEpoch);
      const captionResult = await runGeminiTask("ai.regenerate.text", () => {
        assertOperationAuthEpoch(operationAuthEpoch);
        return generateSocialPostTextDetailed(
          selectedImage,
          generationParams.tone,
          currentDealer.name,
          generationParams.customerName,
          true,
          generationParams.creativeBrief,
          generationParams.style,
        );
      });
      assertOperationAuthEpoch(operationAuthEpoch);
      const prepared = prepareCaptionForDelivery(
        captionResult.text,
        currentDealer.banned_phrases,
        brandKitFromDealer(currentDealer),
      );
      const platformIds = generationParams.platformIds ?? sourcePost.platformIds ?? [];
      const pack = await rebuildCaptionPack(
        prepared.caption,
        platformIds,
        operationAuthEpoch,
      );
      assertOperationAuthEpoch(operationAuthEpoch);
      return {
        workspaceKey,
        operationAuthEpoch,
        prepared,
        pack,
        platformIds,
        captionResult,
      };
    },
    onMutate: () => setError(null),
    onSuccess: ({
      workspaceKey,
      operationAuthEpoch,
      prepared,
      pack,
      platformIds,
      captionResult,
    }) => {
      if (
        operationAuthEpoch !== useAppStore.getState().authEpoch ||
        !workspaceIsCurrent(workspaceKey)
      )
        return;
      const currentPost = useAppStore.getState().generatedPost;
      if (!currentPost) return;
      setGeneratedPost({
        ...currentPost,
        text: prepared.caption,
        captionSource: captionResult.captionSource,
        isBasicFallback: captionResult.captionSource === "basic_fallback",
        aiMeta: mergeCaptionProvenance(
          currentPost.aiMeta,
          captionResult,
          imageQualityTier,
        ),
        platformCaptions: pack?.captions,
        platformIds: platformIds.length > 0 ? platformIds : currentPost.platformIds,
        disclosures: pack?.disclosures ?? prepared.disclosures,
        disclosureCategories:
          pack?.disclosureCategories ?? prepared.disclosureCategories,
      });
    },
    onError: (err) => {
      const normalized = normalizeError(err);
      const msg = `Failed to regenerate text. ${normalized.message} ${recoveryHint(normalized)}`;
      setError(msg);
      toastError(msg);
    },
  });

  const handleRegenerateText = useCallback(async () => {
    await regenerateTextMutation.mutateAsync();
  }, [regenerateTextMutation]);

  // One-shot caption generator that RETURNS the text instead of side-effecting
  // the post. Used by the CaptionAlternativesModal which spawns 3 in parallel
  // and lets the salesperson pick — replaces state itself on selection.
  const generateCaptionVariant = useCallback(async (): Promise<string> => {
    const operationAuthEpoch = useAppStore.getState().authEpoch;
    if (!selectedImage || !generationParams || !currentDealer) {
      throw new Error("Missing required data for caption variant");
    }
    assertOperationAuthEpoch(operationAuthEpoch);
    const { generateSocialPostText } = await loadGeminiService();
    assertOperationAuthEpoch(operationAuthEpoch);
    const variant = await runGeminiTask("ai.caption.variant", () => {
      assertOperationAuthEpoch(operationAuthEpoch);
      return generateSocialPostText(
        selectedImage,
        generationParams.tone,
        currentDealer.name,
        generationParams.customerName,
        true, // regeneration mode — higher temperature, guaranteed variation
        generationParams.creativeBrief,
        generationParams.style,
      );
    });
    assertOperationAuthEpoch(operationAuthEpoch);
    const prepared = prepareCaptionForDelivery(
      variant,
      currentDealer.banned_phrases,
      brandKitFromDealer(currentDealer),
    );
    if (operationAuthEpoch !== useAppStore.getState().authEpoch) {
      throw new Error("Your signed-in workspace changed during caption generation.");
    }
    return prepared.caption;
  }, [
    selectedImage,
    generationParams,
    currentDealer,
    loadGeminiService,
    runGeminiTask,
  ]);

  const editTextMutation = useMutation({
    mutationFn: async ({
      editPrompt,
      originalText,
      platformId,
    }: {
      editPrompt: string;
      originalText?: string;
      platformId?: string;
    }) => {
      const sourcePost = useAppStore.getState().generatedPost;
      const workspaceKey = workspaceKeyForPost(sourcePost);
      const operationAuthEpoch = useAppStore.getState().authEpoch;
      const sourceText = originalText?.trim() || sourcePost?.text || "";
      if (!sourcePost || !sourceText || !editPrompt.trim())
        throw new Error("Missing required data");
      assertOperationAuthEpoch(operationAuthEpoch);
      const { editSocialPostTextDetailed } = await loadGeminiService();
      assertOperationAuthEpoch(operationAuthEpoch);
      const tone = generationParams?.tone || preferredTone;
      const captionResult = await runGeminiTask("ai.edit.text", () => {
        assertOperationAuthEpoch(operationAuthEpoch);
        return editSocialPostTextDetailed(sourceText, editPrompt, tone);
      });
      assertOperationAuthEpoch(operationAuthEpoch);
      const prepared = prepareCaptionForDelivery(
        captionResult.text,
        currentDealer?.banned_phrases,
        brandKitFromDealer(currentDealer),
      );
      const platformIds = sourcePost.platformIds ?? [];
      const pack = platformId
        ? undefined
        : await rebuildCaptionPack(prepared.caption, platformIds, operationAuthEpoch);
      assertOperationAuthEpoch(operationAuthEpoch);
      return {
        workspaceKey,
        operationAuthEpoch,
        platformId,
        prepared,
        pack,
        captionResult,
      };
    },
    onMutate: () => setError(null),
    onSuccess: ({
      workspaceKey,
      operationAuthEpoch,
      platformId,
      prepared,
      pack,
      captionResult,
    }) => {
      if (
        operationAuthEpoch !== useAppStore.getState().authEpoch ||
        !workspaceIsCurrent(workspaceKey)
      )
        return;
      const currentPost = useAppStore.getState().generatedPost;
      if (!currentPost) return;
      if (platformId) {
        const platformCaptions = {
          ...(currentPost.platformCaptions || {}),
          [platformId]: prepared.caption,
        };
        const disclosureUnion = analyzeCaptionSetForDelivery(
          [currentPost.text, ...Object.values(platformCaptions)],
          currentDealer?.banned_phrases,
        );
        setGeneratedPost({
          ...currentPost,
          platformCaptions,
          disclosures: disclosureUnion.disclosures,
          disclosureCategories: disclosureUnion.disclosureCategories,
        });
        return;
      }
      setGeneratedPost({
        ...currentPost,
        text: prepared.caption,
        captionSource: captionResult.captionSource,
        isBasicFallback: false,
        aiMeta: mergeCaptionProvenance(
          currentPost.aiMeta,
          captionResult,
          imageQualityTier,
        ),
        disclosures: pack?.disclosures ?? prepared.disclosures,
        disclosureCategories:
          pack?.disclosureCategories ?? prepared.disclosureCategories,
        platformCaptions: pack?.captions,
      });
    },
    onError: (err) => {
      const msg = `Failed to apply text edits. ${err instanceof Error ? err.message : String(err)}`;
      setError(msg);
      toastError(msg);
    },
  });

  const handleEditText = useCallback(
    async (
      editPrompt: string,
      originalText?: string,
      platformId?: string,
    ): Promise<string> => {
      const result = await editTextMutation.mutateAsync({
        editPrompt,
        originalText,
        platformId,
      });
      return result.prepared.caption;
    },
    [editTextMutation],
  );

  const handlePrepareFinalWebsiteDraft = useCallback(
    async (input: {
      caption: string;
      image: string;
      currentDraft: WebsiteDraft;
    }): Promise<WebsiteDraft> => {
      const state = useAppStore.getState();
      const operationAuthEpoch = state.authEpoch;
      const dealer = state.currentDealer;
      if (!dealer) throw new Error("The dealership workspace is unavailable.");
      assertOperationAuthEpoch(operationAuthEpoch);
      const source: FinalWebsiteDraftSource = {
        currentDraft: input.currentDraft,
        dealerName: dealer.name,
        caption: input.caption,
        customerName: state.generationParams?.customerName,
      };
      const fallback = buildFinalWebsiteDraftFallback(source);
      try {
        const { generateWebsiteDraftMetadata } = await loadGeminiService();
        assertOperationAuthEpoch(operationAuthEpoch);
        logEvent("ai.website.final.start", {
          kind: fallback.kind,
          category: fallback.category,
        });
        const raw = await generateWebsiteDraftMetadata(
          input.image,
          buildFinalWebsiteDraftPrompt(source),
        );
        assertOperationAuthEpoch(operationAuthEpoch);
        const prepared = parseFinalWebsiteDraftResponse(raw, source);
        logEvent("ai.website.final.success", {
          source: prepared.source,
          kind: prepared.draft.kind,
        });
        if (prepared.source === "deterministic_fallback") {
          toastWarning(
            "AI could not refresh the website title and image description, so safe review placeholders were used. Check them in Customer Hub before publishing.",
          );
        }
        return prepared.draft;
      } catch (err) {
        // Never turn an auth/workspace change into a usable fallback that the
        // caller could send under a newer session.
        if (operationAuthEpoch !== useAppStore.getState().authEpoch) throw err;
        logError("ai.website.final.failure", {
          message: err instanceof Error ? err.message : String(err),
          kind: fallback.kind,
        });
        toastWarning(
          "AI could not refresh the website title and image description, so safe review placeholders were used. Check them in Customer Hub before publishing.",
        );
        return fallback;
      }
    },
    [loadGeminiService, toastWarning],
  );

  const generateVideoMutation = useMutation({
    mutationFn: async ({
      style,
      options,
    }: {
      style: VideoStyle;
      options: VideoRequestOptions;
    }) => {
      const sourcePost = useAppStore.getState().generatedPost;
      const workspaceKey = workspaceKeyForPost(sourcePost);
      const operationAuthEpoch = useAppStore.getState().authEpoch;
      if (!sourcePost?.image)
        throw new Error("No image available for video generation");
      assertOperationAuthEpoch(operationAuthEpoch);
      const { generatePostVideo } = await loadGeminiService();
      assertOperationAuthEpoch(operationAuthEpoch);
      // Issue a controller bound to component lifecycle so the poll cancels
      // if the user navigates away.
      const controller = new AbortController();
      videoAbortControllersRef.current.add(controller);
      try {
        const url = await runGeminiTask("ai.generate.video", () => {
          assertOperationAuthEpoch(operationAuthEpoch);
          return generatePostVideo(sourcePost.image, style, options, controller.signal);
        });
        assertOperationAuthEpoch(operationAuthEpoch);
        if (!workspaceIsCurrent(workspaceKey)) {
          if (url.startsWith("blob:")) URL.revokeObjectURL(url);
          throw new Error("This video finished after you opened another post.");
        }
        return { url, workspaceKey, operationAuthEpoch };
      } finally {
        videoAbortControllersRef.current.delete(controller);
      }
    },
    onError: (err) => {
      const normalized = normalizeError(err);
      const msg = `Failed to generate video. ${normalized.message} ${recoveryHint(normalized)}`;
      toastError(msg);
    },
  });

  const handleGenerateVideo = useCallback(
    async (style: VideoStyle, options: VideoRequestOptions): Promise<string> => {
      const result = await generateVideoMutation.mutateAsync({ style, options });
      if (
        result.operationAuthEpoch !== useAppStore.getState().authEpoch ||
        !workspaceIsCurrent(result.workspaceKey)
      ) {
        if (result.url.startsWith("blob:")) URL.revokeObjectURL(result.url);
        throw new Error("This video finished after your signed-in workspace changed.");
      }
      return result.url;
    },
    [generateVideoMutation],
  );

  return {
    generationProgress,
    progressMessage,
    handleGenerate,
    handleRegenerateImage,
    handleFunMode,
    handleEditImage,
    handleRegenerateText,
    handleEditText,
    handlePrepareFinalWebsiteDraft,
    handleGenerateVideo,
    generateCaptionVariant,
  };
};
