import { useCallback, useState } from "react";
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
    preferredTone,
    setGeneratedPost,
    setError,
    setStep,
  } = useAppStore();

  const { runGeminiTask, loadGeminiService } = useGemini();

  const [lastGenerationParams, setLastGenerationParams] = useState<{
    style: StyleOption;
    tone: ToneOption;
    customerName: string;
    customText?: string;
    creativeBrief?: string;
  } | null>(null);

  const [generationProgress, setGenerationProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");

  const handleGenerate = useCallback(
    async (
      style: StyleOption,
      tone: ToneOption,
      customerName: string,
      customText?: string,
      creativeBrief?: string
    ) => {
      if (!selectedImage || !currentDealer) return;

      setStep(AppStep.GENERATING);
      setError(null);
      setGenerationProgress(0);
      setProgressMessage("Analyzing your image...");
      setLastGenerationParams({
        style,
        tone,
        customerName,
        customText,
        creativeBrief,
      });

      const progressInterval = setInterval(() => {
        setGenerationProgress((prev) => {
          // Asymptotic approach to 95%
          if (prev >= 95) return prev;
          const remaining = 95 - prev;
          // Slow down significantly as we get closer
          const increment = Math.max(
            0.1,
            remaining * 0.05 * (Math.random() + 0.5)
          );
          return prev + increment;
        });
      }, 800);

      // Keep track of timeouts to clear them
      const timeouts: NodeJS.Timeout[] = [];

      try {
        const { generateSocialPost } = await loadGeminiService();

        timeouts.push(
          setTimeout(
            () => setProgressMessage("Consulting the style guide..."),
            2000
          )
        );
        timeouts.push(
          setTimeout(
            () => setProgressMessage("Crafting the perfect caption..."),
            4500
          )
        );
        timeouts.push(
          setTimeout(() => setProgressMessage("Applying final polish..."), 7000)
        );

        // Add messages for longer waits
        timeouts.push(
          setTimeout(
            () =>
              setProgressMessage(
                "AI is thinking hard... this might take a moment."
              ),
            15000
          )
        );
        timeouts.push(
          setTimeout(
            () =>
              setProgressMessage(
                "Still working... generating high-quality content."
              ),
            30000
          )
        );
        timeouts.push(
          setTimeout(
            () => setProgressMessage("Almost there! Thanks for your patience."),
            60000
          )
        );
        timeouts.push(
          setTimeout(() => setProgressMessage("Finalizing your post..."), 90000)
        );

        const result = await runGeminiTask("ai.generate", () =>
          generateSocialPost(
            selectedImage,
            style,
            tone,
            currentDealer.name,
            customerName,
            currentDealer.logo,
            customText,
            creativeBrief
          )
        );

        clearInterval(progressInterval);
        timeouts.forEach(clearTimeout);
        setGenerationProgress(100);
        setProgressMessage("Complete!");
        await new Promise((resolve) => setTimeout(resolve, 500));

        setGeneratedPost(result);
        setStep(AppStep.RESULT);
      } catch (err) {
        clearInterval(progressInterval);
        timeouts.forEach(clearTimeout);
        const normalized = normalizeError(err);
        const fullMsg = `Failed to generate your post. ${
          normalized.message
        } ${recoveryHint(normalized)}`;
        setError(fullMsg);
        toastError(fullMsg);
        setStep(AppStep.CUSTOMIZE);
      }
    },
    [
      selectedImage,
      currentDealer,
      runGeminiTask,
      setStep,
      setError,
      setGeneratedPost,
      loadGeminiService,
      toastError,
    ]
  );

  const handleRegenerateImage = useCallback(async () => {
    if (!selectedImage || !lastGenerationParams || !currentDealer) return;
    setError(null);
    try {
      const { generateSocialPost } = await loadGeminiService();
      const result = await runGeminiTask("ai.regenerate.image", () =>
        generateSocialPost(
          selectedImage,
          lastGenerationParams.style,
          lastGenerationParams.tone,
          currentDealer.name,
          lastGenerationParams.customerName,
          currentDealer.logo,
          lastGenerationParams.customText || generatedPost?.text,
          lastGenerationParams.creativeBrief
        )
      );
      setGeneratedPost(result);
    } catch (err) {
      const normalized = normalizeError(err);
      const msg = `Failed to regenerate image. ${
        normalized.message
      } ${recoveryHint(normalized)}`;
      setError(msg);
      toastError(msg);
    }
  }, [
    selectedImage,
    lastGenerationParams,
    currentDealer,
    generatedPost,
    runGeminiTask,
    setGeneratedPost,
    setError,
    loadGeminiService,
    toastError,
  ]);

  const handleFunMode = useCallback(
    async (styleName?: string) => {
      if (!selectedImage || !currentDealer) return;
      setError(null);
      try {
        const { generateFunSocialPostImage } = await loadGeminiService();
        const newImage = await runGeminiTask("ai.fun", () =>
          generateFunSocialPostImage(
            selectedImage,
            currentDealer.name,
            currentDealer.logo,
            styleName
          )
        );
        if (generatedPost)
          setGeneratedPost({ ...generatedPost, image: newImage });
      } catch (err) {
        const normalized = normalizeError(err);
        const msg = `Failed to generate fun image. ${
          normalized.message
        } ${recoveryHint(normalized)}`;
        setError(msg);
        toastError(msg);
      }
    },
    [
      selectedImage,
      currentDealer,
      generatedPost,
      runGeminiTask,
      setGeneratedPost,
      setError,
      loadGeminiService,
      toastError,
    ]
  );

  const handleEditImage = useCallback(
    async (editPrompt: string) => {
      if (!generatedPost?.image || !editPrompt.trim() || !currentDealer) return;
      setError(null);
      try {
        const { editSocialPostImage } = await loadGeminiService();
        const newImage = await runGeminiTask("ai.edit.image", () =>
          editSocialPostImage(
            generatedPost.image,
            editPrompt,
            currentDealer.name,
            currentDealer.logo
          )
        );
        if (generatedPost)
          setGeneratedPost({ ...generatedPost, image: newImage });
      } catch (err) {
        const normalized = normalizeError(err);
        const msg = `Failed to apply image edits. ${
          normalized.message
        } ${recoveryHint(normalized)}`;
        setError(msg);
        toastError(msg);
      }
    },
    [
      generatedPost,
      currentDealer,
      runGeminiTask,
      setGeneratedPost,
      setError,
      loadGeminiService,
      toastError,
    ]
  );

  const handleRegenerateText = useCallback(async () => {
    if (!selectedImage || !lastGenerationParams || !currentDealer) return;
    setError(null);
    try {
      const { generateSocialPostText } = await loadGeminiService();
      const newText = await runGeminiTask("ai.regenerate.text", () =>
        generateSocialPostText(
          selectedImage,
          lastGenerationParams.tone,
          currentDealer.name,
          lastGenerationParams.customerName,
          true,
          lastGenerationParams.creativeBrief
        )
      );
      if (generatedPost) setGeneratedPost({ ...generatedPost, text: newText });
    } catch (err) {
      const normalized = normalizeError(err);
      const msg = `Failed to regenerate text. ${
        normalized.message
      } ${recoveryHint(normalized)}`;
      setError(msg);
      toastError(msg);
    }
  }, [
    selectedImage,
    lastGenerationParams,
    currentDealer,
    generatedPost,
    runGeminiTask,
    setGeneratedPost,
    setError,
    loadGeminiService,
    toastError,
  ]);

  const handleEditText = useCallback(
    async (editPrompt: string) => {
      if (!generatedPost?.text || !editPrompt.trim()) return;
      setError(null);
      try {
        const { editSocialPostText } = await loadGeminiService();
        const tone = lastGenerationParams?.tone || preferredTone;
        const newText = await runGeminiTask("ai.edit.text", () =>
          editSocialPostText(generatedPost.text, editPrompt, tone)
        );
        if (generatedPost)
          setGeneratedPost({ ...generatedPost, text: newText });
      } catch (err) {
        const msg = `Failed to apply text edits. ${
          err instanceof Error ? err.message : String(err)
        }`;
        setError(msg);
        toastError(msg);
      }
    },
    [
      generatedPost,
      lastGenerationParams,
      preferredTone,
      runGeminiTask,
      setGeneratedPost,
      setError,
      loadGeminiService,
      toastError,
    ]
  );

  const handleGenerateVideo = useCallback(
    async (
      style: VideoStyle,
      options: VideoRequestOptions
    ): Promise<string> => {
      if (!generatedPost?.image)
        throw new Error("No image available for video generation");

      try {
        const { generatePostVideo } = await loadGeminiService();
        return await runGeminiTask("ai.generate.video", () =>
          generatePostVideo(generatedPost.image, style, options)
        );
      } catch (err) {
        const normalized = normalizeError(err);
        const msg = `Failed to generate video. ${
          normalized.message
        } ${recoveryHint(normalized)}`;
        toastError(msg);
        throw normalized;
      }
    },
    [generatedPost, runGeminiTask, loadGeminiService, toastError]
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
