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
} from "../types";
import { useToast } from "../components/ui/Toast";
import { normalizeError, recoveryHint } from "../utils/errorHandler";
import { logPost } from "../services/posts";
import { prepareCaptionForDelivery } from "../utils/complianceDisclosures";
import { logEvent, logError } from "../utils/telemetry";
import {
  CapturedRelease,
  linkReleaseToPost,
  runWithPersistedPhotoRelease,
} from "../services/photoReleases";

export interface GenerationMeta {
  salespersonName?: string;
  /** When the salesperson was picked from the dealer's roster, this is the salespeople record id. */
  salespersonId?: string;
  vin?: string;
  hasRelease?: boolean;
  /** Signed-but-unsaved release captured before generation. Saved linked to the post on success so we never create orphan release records. */
  capturedRelease?: CapturedRelease;
}

export const useGeneration = () => {
  const { error: toastError } = useToast();
  const {
    currentDealer,
    selectedImage,
    generatedPost,
    generationParams,
    preferredTone,
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupTimers();
      // Abort any in-flight video polls.
      for (const ctrl of videoAbortControllersRef.current) {
        try {
          ctrl.abort();
        } catch {
          /* ignore */
        }
      }
      videoAbortControllersRef.current.clear();
    };
  }, [cleanupTimers]);

  const generateMutation = useMutation({
    mutationFn: async (params: {
      style: StyleOption;
      tone: ToneOption;
      customerName: string;
      customText?: string;
      creativeBrief?: string;
      meta?: GenerationMeta;
    }) => {
      if (!selectedImage || !currentDealer)
        throw new Error("Missing required data");

      return runWithPersistedPhotoRelease(
        params.meta?.capturedRelease,
        currentDealer.name,
        async () => {
          const { generateSocialPost } = await loadGeminiService();
          return runGeminiTask("ai.generate", () =>
            generateSocialPost(
              selectedImage,
              params.style,
              params.tone,
              currentDealer.name,
              params.customerName,
              currentDealer.logo,
              params.customText,
              params.creativeBrief,
            ),
          );
        },
      );
    },
    onMutate: (variables) => {
      setStep(AppStep.GENERATING);
      setError(null);
      setGenerationProgress(0);
      setProgressMessage("Analyzing your image...");
      setGenerationParams(variables);

      progressIntervalRef.current = setInterval(() => {
        setGenerationProgress((prev) => {
          if (prev >= 95) return prev;
          const remaining = 95 - prev;
          const increment = Math.max(
            0.1,
            remaining * 0.05 * (Math.random() + 0.5),
          );
          return prev + increment;
        });
      }, 800);

      timeoutsRef.current.push(
        setTimeout(
          () => setProgressMessage("Consulting the style guide..."),
          2000,
        ),
      );
      timeoutsRef.current.push(
        setTimeout(
          () => setProgressMessage("Crafting the perfect caption..."),
          4500,
        ),
      );
      timeoutsRef.current.push(
        setTimeout(() => setProgressMessage("Applying final polish..."), 7000),
      );
      timeoutsRef.current.push(
        setTimeout(
          () =>
            setProgressMessage(
              "AI is thinking hard... this might take a moment.",
            ),
          15000,
        ),
      );
      timeoutsRef.current.push(
        setTimeout(
          () =>
            setProgressMessage(
              "Still working... generating high-quality content.",
            ),
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
      cleanupTimers();
      setGenerationProgress(100);
      setProgressMessage("Complete!");

      const result = gatedResult.result;
      const releaseId = gatedResult.releaseId;

      // Scan the caption for compliance triggers. Disclosures go into a
      // separate `disclosures` field so the editable caption textarea
      // never contains them (and a salesperson can't silently delete them).
      let preparedCaption;
      try {
        preparedCaption = prepareCaptionForDelivery(
          result.text,
          currentDealer?.banned_phrases,
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
          categories: Array.from(
            new Set(compliance.matches.map((m) => m.category)),
          ),
        });
      }
      const finalPost: GeneratedPost = {
        ...result,
        text: preparedCaption.caption,
        disclosures: preparedCaption.disclosures,
        disclosureCategories: preparedCaption.disclosureCategories,
      };

      // Log post + (if a release was captured) link the already-persisted
      // release to it. The signature was durably saved before the provider
      // call, and this phase never uploads or duplicates it. An
      // approval-gated creative must be persisted before rendering the result,
      // because the returned id is the secure status-polling handle and the
      // manager needs the exact image/caption they are approving.
      if (currentDealer) {
        const persistPost = async () => {
          const captured = variables.meta?.capturedRelease;
          const post = await logPost({
            dealerId: currentDealer.id,
            salespersonName: variables.meta?.salespersonName,
            salespersonId: variables.meta?.salespersonId,
            style: variables.style,
            tone: variables.tone,
            customerName: variables.customerName,
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
          });
          let releaseStatus: NonNullable<GeneratedPost["releaseStatus"]> =
            captured ? "save_failed" : "not_required";
          if (captured && releaseId && post) {
            try {
              await linkReleaseToPost(releaseId, post.id);
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
        const post = persisted.post;
        finalPost.releaseStatus = persisted.releaseStatus;
        if (post) finalPost.postId = post.id;

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
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
      setGeneratedPost(finalPost);
      setStep(AppStep.RESULT);
    },
    onError: (err) => {
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
    ) => {
      await generateMutation.mutateAsync({
        style,
        tone,
        customerName,
        customText,
        creativeBrief,
        meta,
      });
    },
    [generateMutation],
  );

  const regenerateImageMutation = useMutation({
    mutationFn: async () => {
      if (!selectedImage || !generationParams || !currentDealer)
        throw new Error("Missing required data");
      const { generateSocialPost } = await loadGeminiService();
      return runGeminiTask("ai.regenerate.image", () =>
        generateSocialPost(
          selectedImage,
          generationParams.style,
          generationParams.tone,
          currentDealer.name,
          generationParams.customerName,
          currentDealer.logo,
          generationParams.customText || generatedPost?.text,
          generationParams.creativeBrief,
        ),
      );
    },
    onMutate: () => setError(null),
    // This control promises an image-only refresh. Preserve the caption,
    // disclosure, release, approval, and owner-scoped post metadata rather
    // than replacing the entire reviewed result with the provider response.
    onSuccess: (result) => {
      if (generatedPost) {
        setGeneratedPost({ ...generatedPost, image: result.image });
      }
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
      if (!selectedImage || !currentDealer)
        throw new Error("Missing required data");
      const { generateFunSocialPostImage } = await loadGeminiService();
      return runGeminiTask("ai.fun", () =>
        generateFunSocialPostImage(
          selectedImage,
          currentDealer.name,
          currentDealer.logo,
          styleName,
        ),
      );
    },
    onMutate: () => setError(null),
    onSuccess: (newImage) => {
      if (generatedPost)
        setGeneratedPost({ ...generatedPost, image: newImage });
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
      if (!generatedPost?.image || !editPrompt.trim() || !currentDealer)
        throw new Error("Missing required data");
      const { editSocialPostImage } = await loadGeminiService();
      return runGeminiTask("ai.edit.image", () =>
        editSocialPostImage(
          generatedPost.image,
          editPrompt,
          currentDealer.name,
          currentDealer.logo,
        ),
      );
    },
    onMutate: () => setError(null),
    onSuccess: (newImage) => {
      if (generatedPost)
        setGeneratedPost({ ...generatedPost, image: newImage });
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

  const regenerateTextMutation = useMutation({
    mutationFn: async () => {
      if (!selectedImage || !generationParams || !currentDealer)
        throw new Error("Missing required data");
      const { generateSocialPostText } = await loadGeminiService();
      const newText = await runGeminiTask("ai.regenerate.text", () =>
        generateSocialPostText(
          selectedImage,
          generationParams.tone,
          currentDealer.name,
          generationParams.customerName,
          true,
          generationParams.creativeBrief,
        ),
      );
      return prepareCaptionForDelivery(newText, currentDealer.banned_phrases);
    },
    onMutate: () => setError(null),
    onSuccess: (prepared) => {
      if (!generatedPost) return;
      setGeneratedPost({
        ...generatedPost,
        text: prepared.caption,
        disclosures: prepared.disclosures,
        disclosureCategories: prepared.disclosureCategories,
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
    if (!selectedImage || !generationParams || !currentDealer) {
      throw new Error("Missing required data for caption variant");
    }
    const { generateSocialPostText } = await loadGeminiService();
    const variant = await runGeminiTask("ai.caption.variant", () =>
      generateSocialPostText(
        selectedImage,
        generationParams.tone,
        currentDealer.name,
        generationParams.customerName,
        true, // regeneration mode — higher temperature, guaranteed variation
        generationParams.creativeBrief,
      ),
    );
    prepareCaptionForDelivery(variant, currentDealer.banned_phrases);
    return variant;
  }, [
    selectedImage,
    generationParams,
    currentDealer,
    loadGeminiService,
    runGeminiTask,
  ]);

  const editTextMutation = useMutation({
    mutationFn: async (editPrompt: string) => {
      if (!generatedPost?.text || !editPrompt.trim())
        throw new Error("Missing required data");
      const { editSocialPostText } = await loadGeminiService();
      const tone = generationParams?.tone || preferredTone;
      const newText = await runGeminiTask("ai.edit.text", () =>
        editSocialPostText(generatedPost.text, editPrompt, tone),
      );
      return prepareCaptionForDelivery(newText, currentDealer?.banned_phrases);
    },
    onMutate: () => setError(null),
    onSuccess: (prepared) => {
      if (!generatedPost) return;
      setGeneratedPost({
        ...generatedPost,
        text: prepared.caption,
        disclosures: prepared.disclosures,
        disclosureCategories: prepared.disclosureCategories,
      });
    },
    onError: (err) => {
      const msg = `Failed to apply text edits. ${err instanceof Error ? err.message : String(err)}`;
      setError(msg);
      toastError(msg);
    },
  });

  const handleEditText = useCallback(
    async (editPrompt: string) => {
      await editTextMutation.mutateAsync(editPrompt);
    },
    [editTextMutation],
  );

  const generateVideoMutation = useMutation({
    mutationFn: async ({
      style,
      options,
    }: {
      style: VideoStyle;
      options: VideoRequestOptions;
    }) => {
      if (!generatedPost?.image)
        throw new Error("No image available for video generation");
      const { generatePostVideo } = await loadGeminiService();
      // Issue a controller bound to component lifecycle so the poll cancels
      // if the user navigates away.
      const controller = new AbortController();
      videoAbortControllersRef.current.add(controller);
      try {
        return await runGeminiTask("ai.generate.video", () =>
          generatePostVideo(
            generatedPost.image,
            style,
            options,
            controller.signal,
          ),
        );
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
    async (
      style: VideoStyle,
      options: VideoRequestOptions,
    ): Promise<string> => {
      return await generateVideoMutation.mutateAsync({ style, options });
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
    handleGenerateVideo,
    generateCaptionVariant,
  };
};
