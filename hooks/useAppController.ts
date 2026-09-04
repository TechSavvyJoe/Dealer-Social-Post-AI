import { useState, useEffect, useCallback, useRef } from "react";
import { useAppStore, type SessionLoginRequest } from "../stores/appStore";
import { useShallow } from "zustand/react/shallow";
import { useLayoutMode } from "./useLayoutMode";
import { loadGeminiService, useGemini } from "./useGemini";
import { loadPublishPipeline } from "../services/publishPipeline";
import { useGeneration } from "./useGeneration";
import { useDealerTheme } from "./useDealerTheme";
import { AppStep, StyleOption, ToneOption, type ImageSelection } from "../types";
import { isCreativeSystemEnabled } from "../services/creativeSystem";
import { logEvent } from "../utils/telemetry";
import { archiveDealerMedia } from "../utils/creativeStorage";

export const useAppController = () => {
  // Global State
  const {
    step,
    currentDealer,
    currentPerson,
    role,
    isImpersonating,
    selectedImage,
    generatedPost,
    error,
    preferredStyle,
    preferredTone,
    imageQualityTier,
    isRestoringSession,
    setStep,
    setSelectedImage,
    setGeneratedPost,
    setError,
    setPreferences,
    login,
    logout,
    reset,
    startRemix,
    restoreSession,
  } = useAppStore(
    useShallow((state) => ({
      step: state.step,
      currentDealer: state.currentDealer,
      currentPerson: state.currentPerson,
      role: state.role,
      isImpersonating: state.isImpersonating,
      selectedImage: state.selectedImage,
      generatedPost: state.generatedPost,
      error: state.error,
      preferredStyle: state.preferredStyle,
      preferredTone: state.preferredTone,
      imageQualityTier: state.imageQualityTier,
      isRestoringSession: state.isRestoringSession,
      setStep: state.setStep,
      setSelectedImage: state.setSelectedImage,
      setGeneratedPost: state.setGeneratedPost,
      setError: state.setError,
      setPreferences: state.setPreferences,
      login: state.login,
      logout: state.logout,
      reset: state.reset,
      startRemix: state.startRemix,
      restoreSession: state.restoreSession,
    })),
  );

  // Local UI State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isVideoDirectorOpen, setIsVideoDirectorOpen] = useState(false);

  // Crop Modal State
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [tempImageForCrop, setTempImageForCrop] = useState<string | null>(null);
  const [tempOriginalForBackup, setTempOriginalForBackup] = useState<
    string | Blob | null
  >(null);
  const [tempOriginalFilename, setTempOriginalFilename] = useState<string | undefined>(
    undefined,
  );
  const [originalBackupStatus, setOriginalBackupStatus] = useState<
    "idle" | "saving" | "saved" | "unavailable"
  >("idle");
  const originalBackupRequestRef = useRef(0);
  const previousAuthIdentityRef = useRef("");

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

  // Warm the AI-service chunk (~63 kB gzip) while the user is still picking
  // style and tone, so the first Generate spends its time on the model call
  // instead of a chunk download over lot LTE. loadGeminiService memoizes and
  // un-caches failed imports, so a lost race here costs nothing.
  useEffect(() => {
    if (step === AppStep.CUSTOMIZE) {
      void loadGeminiService().catch(() => {});
    }
  }, [step]);

  // Warm the publish-pipeline chunk (consent gating, caption compliance,
  // platform copy, export rendering, post persistence) as soon as the user
  // reaches Capture — everything after the Generate tap awaits this module.
  // CUSTOMIZE is included for sessions restored straight into the editor.
  // loadPublishPipeline memoizes and un-caches failed imports, so a lost race
  // here costs nothing.
  useEffect(() => {
    if (step === AppStep.CAPTURE || step === AppStep.CUSTOMIZE) {
      void loadPublishPipeline().catch(() => {});
    }
  }, [step]);

  useEffect(() => {
    const authIdentity = currentDealer
      ? `${currentDealer.id}:${currentPerson?.id || ""}:${role}:${isImpersonating ? "impersonating" : "direct"}`
      : "";
    const identityChanged =
      previousAuthIdentityRef.current &&
      previousAuthIdentityRef.current !== authIdentity;
    if (!authIdentity || identityChanged) {
      setIsSettingsOpen(false);
      setIsVideoDirectorOpen(false);
      setCropModalOpen(false);
      setTempImageForCrop(null);
      setTempOriginalForBackup(null);
      setTempOriginalFilename(undefined);
      setOriginalBackupStatus("idle");
      originalBackupRequestRef.current += 1;
    }
    previousAuthIdentityRef.current = authIdentity;
  }, [
    currentDealer,
    currentPerson?.id,
    isImpersonating,
    role,
    setIsSettingsOpen,
    setIsVideoDirectorOpen,
  ]);

  // Handlers
  const handleLogin = async (
    credentials: SessionLoginRequest,
    turnstileToken?: string,
  ) => {
    // The store distinguishes an invalid credential from an unavailable
    // backend. Do not overwrite that authoritative, user-actionable message.
    return login(credentials, turnstileToken);
  };

  // Per-device style/tone memory is one of the three authorities that fight
  // over the same two values today (spec §4.1). Under the creative system the
  // dealership Look is the only authority, so the memory is retired: nothing
  // is written, and therefore nothing stale can seed a later post. Every
  // dealership that has not opted in keeps today's persistence untouched.
  const handleStyleToneChange = useCallback(
    (style: StyleOption, tone: ToneOption) => {
      if (isCreativeSystemEnabled(currentDealer)) return;
      setPreferences({ preferredStyle: style, preferredTone: tone });
    },
    [currentDealer, setPreferences],
  );

  const handleImageSelected = useCallback(
    (selection: ImageSelection) => {
      const requestId = originalBackupRequestRef.current + 1;
      originalBackupRequestRef.current = requestId;
      setTempImageForCrop(selection.workingImage);
      setTempOriginalForBackup(selection.originalSource);
      setTempOriginalFilename(selection.originalFilename);
      setCropModalOpen(true);
      setOriginalBackupStatus("saving");
      const dealerId = currentDealer?.id;
      if (!dealerId) {
        setOriginalBackupStatus("unavailable");
        return;
      }
      void archiveDealerMedia(dealerId, {
        kind: "capture",
        source: selection.originalSource,
        previewSource: selection.workingImage,
        originalFilename: selection.originalFilename,
        label: "Original photo",
      }).then((record) => {
        if (originalBackupRequestRef.current !== requestId) return;
        setOriginalBackupStatus(record ? "saved" : "unavailable");
        logEvent("media.capture.backup", {
          outcome: record ? "saved" : "unavailable",
        });
      });
    },
    [currentDealer?.id],
  );

  const handleCropConfirm = useCallback(
    (croppedImage: string) => {
      setSelectedImage(croppedImage);
      setGeneratedPost(null);
      setStep(AppStep.CUSTOMIZE);
      setError(null);
      setCropModalOpen(false);
      setTempImageForCrop(null);
      setTempOriginalForBackup(null);
      setTempOriginalFilename(undefined);
      originalBackupRequestRef.current += 1;
      setOriginalBackupStatus("idle");
    },
    [setSelectedImage, setGeneratedPost, setStep, setError],
  );

  const handleCropClose = useCallback(() => {
    originalBackupRequestRef.current += 1;
    setCropModalOpen(false);
    setTempImageForCrop(null);
    setTempOriginalForBackup(null);
    setTempOriginalFilename(undefined);
    setOriginalBackupStatus("idle");
  }, []);

  return {
    step,
    currentDealer,
    selectedImage,
    generatedPost,
    error,
    preferredStyle,
    preferredTone,
    imageQualityTier,
    isRestoringSession,
    setStep,
    setError,
    setPreferences,
    logout,
    reset,
    startRemix,
    isSettingsOpen,
    setIsSettingsOpen,
    isVideoDirectorOpen,
    setIsVideoDirectorOpen,
    cropModalOpen,
    setCropModalOpen,
    tempImageForCrop,
    tempOriginalForBackup,
    tempOriginalFilename,
    originalBackupStatus,
    isDesktopLayout,
    ...generationProps,
    handleLogin,
    handleStyleToneChange,
    handleImageSelected,
    handleCropConfirm,
    handleCropClose,
  };
};
