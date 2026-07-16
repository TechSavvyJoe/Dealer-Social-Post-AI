import { useState, useEffect, useCallback } from "react";
import { useAppStore } from "../stores/appStore";
import { useShallow } from "zustand/react/shallow";
import { useLayoutMode } from "./useLayoutMode";
import { useGemini } from "./useGemini";
import { useGeneration } from "./useGeneration";
import { useDealerTheme } from "./useDealerTheme";
import { AppStep, StyleOption, ToneOption } from "../types";
import { logEvent } from "../utils/telemetry";

export const useAppController = () => {
  // Global State
  const {
    step,
    currentDealer,
    selectedImage,
    generatedPost,
    error,
    preferredStyle,
    preferredTone,
    compactMode,
    isRestoringSession,
    setStep,
    setSelectedImage,
    setGeneratedPost,
    setError,
    setPreferences,
    login,
    logout,
    reset,
    restoreSession,
  } = useAppStore(
    useShallow((state) => ({
      step: state.step,
      currentDealer: state.currentDealer,
      selectedImage: state.selectedImage,
      generatedPost: state.generatedPost,
      error: state.error,
      preferredStyle: state.preferredStyle,
      preferredTone: state.preferredTone,
      compactMode: state.compactMode,
      isRestoringSession: state.isRestoringSession,
      setStep: state.setStep,
      setSelectedImage: state.setSelectedImage,
      setGeneratedPost: state.setGeneratedPost,
      setError: state.setError,
      setPreferences: state.setPreferences,
      login: state.login,
      logout: state.logout,
      reset: state.reset,
      restoreSession: state.restoreSession,
    })),
  );

  // Local UI State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isVideoDirectorOpen, setIsVideoDirectorOpen] = useState(false);

  // Crop Modal State
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [tempImageForCrop, setTempImageForCrop] = useState<string | null>(null);

  // Custom Hooks
  const isDesktopLayout = useLayoutMode();
  useGemini();
  useDealerTheme();
  const generationProps = useGeneration();

  // Initialization
  useEffect(() => {
    logEvent("app.boot");
    restoreSession();
  }, [restoreSession]);

  // Handlers
  const handleLogin = async (dealerId: string) => {
    // The store distinguishes an invalid credential from an unavailable
    // backend. Do not overwrite that authoritative, user-actionable message.
    return login(dealerId);
  };

  const handleStyleToneChange = useCallback(
    (style: StyleOption, tone: ToneOption) => {
      setPreferences({ preferredStyle: style, preferredTone: tone });
    },
    [setPreferences],
  );

  const handleImageSelected = useCallback((image: string) => {
    setTempImageForCrop(image);
    setCropModalOpen(true);
  }, []);

  const handleCropConfirm = useCallback(
    (croppedImage: string) => {
      setSelectedImage(croppedImage);
      setGeneratedPost(null);
      setStep(AppStep.CUSTOMIZE);
      setError(null);
      setCropModalOpen(false);
      setTempImageForCrop(null);
    },
    [setSelectedImage, setGeneratedPost, setStep, setError],
  );

  return {
    step,
    currentDealer,
    selectedImage,
    generatedPost,
    error,
    preferredStyle,
    preferredTone,
    compactMode,
    isRestoringSession,
    setStep,
    setError,
    setPreferences,
    logout,
    reset,
    isSettingsOpen,
    setIsSettingsOpen,
    isVideoDirectorOpen,
    setIsVideoDirectorOpen,
    cropModalOpen,
    setCropModalOpen,
    tempImageForCrop,
    isDesktopLayout,
    ...generationProps,
    handleLogin,
    handleStyleToneChange,
    handleImageSelected,
    handleCropConfirm,
  };
};
