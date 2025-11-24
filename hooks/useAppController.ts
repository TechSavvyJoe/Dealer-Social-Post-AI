import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../stores/appStore';
import { useLayoutMode } from './useLayoutMode';
import { useGemini } from './useGemini';
import { useGeneration } from './useGeneration';
import { AppStep, StyleOption, ToneOption } from '../types';
import { logEvent } from '../utils/telemetry';

export const useAppController = () => {
  // Global State
  const { 
    step, currentDealer, selectedImage, generatedPost, error,
    preferredStyle, preferredTone, compactMode,
    setStep, setSelectedImage, setGeneratedPost, setError, 
    setPreferences, login, logout, reset, restoreSession 
  } = useAppStore();

  // Local UI State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isVideoDirectorOpen, setIsVideoDirectorOpen] = useState(false);
  
  // Crop Modal State
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [tempImageForCrop, setTempImageForCrop] = useState<string | null>(null);

  // Custom Hooks
  const isDesktopLayout = useLayoutMode();
  useGemini();
  const generationProps = useGeneration();

  // Initialization
  useEffect(() => {
    logEvent('app.boot');
    restoreSession();
  }, [restoreSession]);

  // Handlers
  const handleLogin = async (dealerId: string) => {
    const success = await login(dealerId);
    if (!success) setError("Invalid dealer ID");
    return success;
  };
  
  const handleStyleToneChange = useCallback((style: StyleOption, tone: ToneOption) => {
    setPreferences({ preferredStyle: style, preferredTone: tone });
  }, [setPreferences]);

  const handleImageSelected = useCallback((image: string) => {
    setTempImageForCrop(image);
    setCropModalOpen(true);
  }, []);

  const handleCropConfirm = useCallback((croppedImage: string) => {
    setSelectedImage(croppedImage);
    setGeneratedPost(null);
    setStep(AppStep.CUSTOMIZE);
    setError(null);
    setCropModalOpen(false);
    setTempImageForCrop(null);
  }, [setSelectedImage, setGeneratedPost, setStep, setError]);

  return {
    step,
    currentDealer,
    selectedImage,
    generatedPost,
    error,
    preferredStyle,
    preferredTone,
    compactMode,
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
