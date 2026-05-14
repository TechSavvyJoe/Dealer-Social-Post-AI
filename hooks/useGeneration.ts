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

  const cleanupTimers = useCallback(() => {
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return cleanupTimers;
  }, [cleanupTimers]);

  const generateMutation = useMutation({
    mutationFn: async (params: {
      style: StyleOption;
      tone: ToneOption;
      customerName: string;
      customText?: string;
      creativeBrief?: string;
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
    onSuccess: async (result) => {
      cleanupTimers();
      setGenerationProgress(100);
      setProgressMessage("Complete!");
      await new Promise((resolve) => setTimeout(resolve, 500));
      setGeneratedPost(result);
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
      creativeBrief?: string
    ) => {
      await generateMutation.mutateAsync({
        style,
        tone,
        customerName,
        customText,
        creativeBrief
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
      if (generatedPost) setGeneratedPost({ ...generatedPost, text: newText });
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
      if (generatedPost) setGeneratedPost({ ...generatedPost, text: newText });
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
      return runGeminiTask("ai.generate.video", () =>
        generatePostVideo(generatedPost.image, style, options)
      );
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
  };
};
