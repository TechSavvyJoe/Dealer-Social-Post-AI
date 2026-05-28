import { useCallback, useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { useAppStore } from "../stores/appStore";
import { useGemini } from "./useGemini";
import {
  StyleOption,
  ToneOption,
  VideoStyle,
  VideoRequestOptions,
  AppStep,
} from "../types";
import { useToast } from "../components/ui/Toast";
import { normalizeError, recoveryHint } from "../utils/errorHandler";
import { logPost } from "../services/posts";
import { applyDisclosures } from "../utils/complianceDisclosures";
import { logEvent, logError } from "../utils/telemetry";
import { saveRelease, CapturedRelease } from "../services/photoReleases";

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
  } = useAppStore();

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
      if (!selectedImage || !currentDealer) throw new Error("Missing required data");

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
          params.creativeBrief
        )
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
          const increment = Math.max(0.1, remaining * 0.05 * (Math.random() + 0.5));
          return prev + increment;
        });
      }, 800);

      timeoutsRef.current.push(setTimeout(() => setProgressMessage("Consulting the style guide..."), 2000));
      timeoutsRef.current.push(setTimeout(() => setProgressMessage("Crafting the perfect caption..."), 4500));
      timeoutsRef.current.push(setTimeout(() => setProgressMessage("Applying final polish..."), 7000));
      timeoutsRef.current.push(setTimeout(() => setProgressMessage("AI is thinking hard... this might take a moment."), 15000));
      timeoutsRef.current.push(setTimeout(() => setProgressMessage("Still working... generating high-quality content."), 30000));
      timeoutsRef.current.push(setTimeout(() => setProgressMessage("Almost there! Thanks for your patience."), 60000));
      timeoutsRef.current.push(setTimeout(() => setProgressMessage("Finalizing your post..."), 90000));
    },
    onSuccess: async (result, variables) => {
      cleanupTimers();
      setGenerationProgress(100);
      setProgressMessage("Complete!");

      // Scan the caption for compliance triggers. Disclosures go into a
      // separate `disclosures` field so the editable caption textarea
      // never contains them (and a salesperson can't silently delete them).
      const compliance = applyDisclosures(result.text);
      if (compliance.prohibited.length > 0) {
        logEvent("compliance.prohibited_detected", {
          phrases: compliance.prohibited.map((p) => p.triggerPhrase),
        });
      }
      if (compliance.changed && compliance.matches.length > 0) {
        logEvent("compliance.disclosures_detected", {
          categories: Array.from(
            new Set(compliance.matches.map((m) => m.category))
          ),
        });
      }
      // Strip any pre-existing footer from the caption (idempotent) and put
      // the disclosure block into its own field.
      const captionOnly = result.text
        .split("\n\n— Disclosures —")[0]
        .trimEnd();
      const disclosureBlock = compliance.text.startsWith(captionOnly)
        ? compliance.text.slice(captionOnly.length).trim()
        : "";
      const finalPost = {
        ...result,
        text: captionOnly,
        disclosures: disclosureBlock,
        disclosureCategories: Array.from(
          new Set(compliance.matches.map((m) => m.category))
        ),
      };

      // Log post + (if a release was captured) save it linked to the post.
      // Both are fire-and-forget; failures are logged but never block the user.
      if (currentDealer) {
        void (async () => {
          const post = await logPost({
            dealerId: currentDealer.id,
            salespersonName: variables.meta?.salespersonName,
            salespersonId: variables.meta?.salespersonId,
            style: variables.style,
            tone: variables.tone,
            customerName: variables.customerName,
            vin: variables.meta?.vin,
            hasRelease: !!variables.meta?.capturedRelease,
            hasVideo: false,
            requiresApproval: !!currentDealer.requires_approval,
          });
          const captured = variables.meta?.capturedRelease;
          if (captured && post) {
            try {
              await saveRelease({
                customerName: captured.customerName,
                signaturePngDataUrl: captured.signaturePngDataUrl,
                vin: captured.vin,
                postId: post.id,
                notes: `Released for social media use by ${currentDealer.name}.`,
              });
            } catch (err) {
              logError("photo_release.save_failed", {
                message: err instanceof Error ? err.message : String(err),
                postId: post.id,
              });
            }
          }
        })();
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
    }
  });

  const handleGenerate = useCallback(
    async (
      style: StyleOption,
      tone: ToneOption,
      customerName: string,
      customText?: string,
      creativeBrief?: string,
      meta?: GenerationMeta
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
    [generateMutation]
  );

  const regenerateImageMutation = useMutation({
    mutationFn: async () => {
      if (!selectedImage || !generationParams || !currentDealer) throw new Error("Missing required data");
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
          generationParams.creativeBrief
        )
      );
    },
    onMutate: () => setError(null),
    onSuccess: (result) => setGeneratedPost(result),
    onError: (err) => {
      const normalized = normalizeError(err);
      const msg = `Failed to regenerate image. ${normalized.message} ${recoveryHint(normalized)}`;
      setError(msg);
      toastError(msg);
    }
  });

  const handleRegenerateImage = useCallback(async () => {
    await regenerateImageMutation.mutateAsync();
  }, [regenerateImageMutation]);

  const funModeMutation = useMutation({
    mutationFn: async (styleName?: string) => {
      if (!selectedImage || !currentDealer) throw new Error("Missing required data");
      const { generateFunSocialPostImage } = await loadGeminiService();
      return runGeminiTask("ai.fun", () =>
        generateFunSocialPostImage(
          selectedImage,
          currentDealer.name,
          currentDealer.logo,
          styleName
        )
      );
    },
    onMutate: () => setError(null),
    onSuccess: (newImage) => {
      if (generatedPost) setGeneratedPost({ ...generatedPost, image: newImage });
    },
    onError: (err) => {
      const normalized = normalizeError(err);
      const msg = `Failed to generate fun image. ${normalized.message} ${recoveryHint(normalized)}`;
      setError(msg);
      toastError(msg);
    }
  });

  const handleFunMode = useCallback(async (styleName?: string) => {
    await funModeMutation.mutateAsync(styleName);
  }, [funModeMutation]);

  const editImageMutation = useMutation({
    mutationFn: async (editPrompt: string) => {
      if (!generatedPost?.image || !editPrompt.trim() || !currentDealer) throw new Error("Missing required data");
      const { editSocialPostImage } = await loadGeminiService();
      return runGeminiTask("ai.edit.image", () =>
        editSocialPostImage(
          generatedPost.image,
          editPrompt,
          currentDealer.name,
          currentDealer.logo
        )
      );
    },
    onMutate: () => setError(null),
    onSuccess: (newImage) => {
      if (generatedPost) setGeneratedPost({ ...generatedPost, image: newImage });
    },
    onError: (err) => {
      const normalized = normalizeError(err);
      const msg = `Failed to apply image edits. ${normalized.message} ${recoveryHint(normalized)}`;
      setError(msg);
      toastError(msg);
    }
  });

  const handleEditImage = useCallback(async (editPrompt: string) => {
    await editImageMutation.mutateAsync(editPrompt);
  }, [editImageMutation]);

  const regenerateTextMutation = useMutation({
    mutationFn: async () => {
      if (!selectedImage || !generationParams || !currentDealer) throw new Error("Missing required data");
      const { generateSocialPostText } = await loadGeminiService();
      return runGeminiTask("ai.regenerate.text", () =>
        generateSocialPostText(
          selectedImage,
          generationParams.tone,
          currentDealer.name,
          generationParams.customerName,
          true,
          generationParams.creativeBrief
        )
      );
    },
    onMutate: () => setError(null),
    onSuccess: (newText) => {
      if (!generatedPost) return;
      const compliance = applyDisclosures(newText);
      const captionOnly = newText.split("\n\n— Disclosures —")[0].trimEnd();
      const disclosureBlock = compliance.text.startsWith(captionOnly)
        ? compliance.text.slice(captionOnly.length).trim()
        : "";
      setGeneratedPost({
        ...generatedPost,
        text: captionOnly,
        disclosures: disclosureBlock,
        disclosureCategories: Array.from(
          new Set(compliance.matches.map((m) => m.category))
        ),
      });
    },
    onError: (err) => {
      const normalized = normalizeError(err);
      const msg = `Failed to regenerate text. ${normalized.message} ${recoveryHint(normalized)}`;
      setError(msg);
      toastError(msg);
    }
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
    return await runGeminiTask("ai.caption.variant", () =>
      generateSocialPostText(
        selectedImage,
        generationParams.tone,
        currentDealer.name,
        generationParams.customerName,
        true, // regeneration mode — higher temperature, guaranteed variation
        generationParams.creativeBrief
      )
    );
  }, [
    selectedImage,
    generationParams,
    currentDealer,
    loadGeminiService,
    runGeminiTask,
  ]);

  const editTextMutation = useMutation({
    mutationFn: async (editPrompt: string) => {
      if (!generatedPost?.text || !editPrompt.trim()) throw new Error("Missing required data");
      const { editSocialPostText } = await loadGeminiService();
      const tone = generationParams?.tone || preferredTone;
      return runGeminiTask("ai.edit.text", () =>
        editSocialPostText(generatedPost.text, editPrompt, tone)
      );
    },
    onMutate: () => setError(null),
    onSuccess: (newText) => {
      if (!generatedPost) return;
      const compliance = applyDisclosures(newText);
      const captionOnly = newText.split("\n\n— Disclosures —")[0].trimEnd();
      const disclosureBlock = compliance.text.startsWith(captionOnly)
        ? compliance.text.slice(captionOnly.length).trim()
        : "";
      setGeneratedPost({
        ...generatedPost,
        text: captionOnly,
        disclosures: disclosureBlock,
        disclosureCategories: Array.from(
          new Set(compliance.matches.map((m) => m.category))
        ),
      });
    },
    onError: (err) => {
      const msg = `Failed to apply text edits. ${err instanceof Error ? err.message : String(err)}`;
      setError(msg);
      toastError(msg);
    }
  });

  const handleEditText = useCallback(async (editPrompt: string) => {
    await editTextMutation.mutateAsync(editPrompt);
  }, [editTextMutation]);

  const generateVideoMutation = useMutation({
    mutationFn: async ({ style, options }: { style: VideoStyle, options: VideoRequestOptions }) => {
      if (!generatedPost?.image) throw new Error("No image available for video generation");
      const { generatePostVideo } = await loadGeminiService();
      // Issue a controller bound to component lifecycle so the poll cancels
      // if the user navigates away.
      const controller = new AbortController();
      videoAbortControllersRef.current.add(controller);
      try {
        return await runGeminiTask("ai.generate.video", () =>
          generatePostVideo(generatedPost.image, style, options, controller.signal)
        );
      } finally {
        videoAbortControllersRef.current.delete(controller);
      }
    },
    onError: (err) => {
      const normalized = normalizeError(err);
      const msg = `Failed to generate video. ${normalized.message} ${recoveryHint(normalized)}`;
      toastError(msg);
    }
  });

  const handleGenerateVideo = useCallback(
    async (style: VideoStyle, options: VideoRequestOptions): Promise<string> => {
      return await generateVideoMutation.mutateAsync({ style, options });
    },
    [generateVideoMutation]
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
