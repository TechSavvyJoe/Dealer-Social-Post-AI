import { useCallback, useEffect, useRef, useState } from "react";
import type { GeneratedPost } from "../types";
import type { StoreDefaults, StoreLook } from "../services/storeDefaults";
import type { UseVideoJobsResult } from "./useVideoJobs";
import { useAppStore } from "../stores/appStore";
import { useToast } from "../components/ui/Toast";

type PostWithCreativeBudget = GeneratedPost & { tryAnotherUsed?: boolean };
type CreativeOperationFence = {
  authEpoch: number;
  workspace: string;
  postId?: string;
};

export interface UsePostCreativeToolsOptions {
  post: GeneratedPost;
  defaults: StoreDefaults;
  locked: boolean;
  lockReason: string;
  hasOriginalCapture: boolean;
  onRegenerateImage: () => Promise<void>;
  onRegenerateText: () => Promise<void>;
  onChangeLook?: (look: StoreLook["id"]) => Promise<void>;
  onFunMode: (styleName?: string) => Promise<void>;
  video: Pick<
    UseVideoJobsResult,
    "startVideoJob" | "houseMotionOptions" | "isVideoLoading"
  >;
}

export interface UsePostCreativeToolsResult {
  busy: boolean;
  busyLabel: string;
  selectedLookId: StoreLook["id"];
  tryAnotherUsed: boolean;
  playfulPair: { master: string; playful: string } | null;
  tryAnother: () => Promise<void>;
  changeLook: (look: StoreLook) => Promise<void>;
  addVideo: () => Promise<void>;
  togglePlayful: () => Promise<void>;
  selectCreative: (image: string) => void;
}

const workspaceKey = (post: GeneratedPost): string =>
  post.postId || post.aiMeta?.image.attemptId || post.image;

/**
 * Bounded Post-screen creative actions. Look renders and the playful pair are
 * deliberately memory-only; only the one-shot Try another budget travels with
 * the post so a remount cannot grant another paid regeneration.
 */
export const usePostCreativeTools = ({
  post,
  defaults,
  locked,
  lockReason,
  hasOriginalCapture,
  onRegenerateImage,
  onRegenerateText,
  onChangeLook,
  onFunMode,
  video,
}: UsePostCreativeToolsOptions): UsePostCreativeToolsResult => {
  const toast = useToast();
  const [busyLabel, setBusyLabel] = useState("");
  const [selectedLookId, setSelectedLookId] = useState<StoreLook["id"]>(
    defaults.defaultLookId,
  );
  const [playfulPair, setPlayfulPair] = useState<{
    master: string;
    playful: string;
  } | null>(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const workspaceRef = useRef(workspaceKey(post));
  const lookCacheRef = useRef<Map<string, string>>(
    new Map([[String(defaults.defaultLookId), post.image]]),
  );

  useEffect(() => {
    const nextWorkspace = workspaceKey(post);
    if (workspaceRef.current === nextWorkspace) return;
    workspaceRef.current = nextWorkspace;
    lookCacheRef.current = new Map([[String(defaults.defaultLookId), post.image]]);
    setSelectedLookId(defaults.defaultLookId);
    setPlayfulPair(null);
  }, [defaults.defaultLookId, post]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const captureFence = useCallback(
    (): CreativeOperationFence => ({
      authEpoch: useAppStore.getState().authEpoch,
      workspace: workspaceRef.current,
      postId: post.postId,
    }),
    [post.postId],
  );

  const fenceIsCurrent = useCallback((fence: CreativeOperationFence): boolean => {
    if (!mountedRef.current) return false;
    const store = useAppStore.getState();
    if (store.authEpoch !== fence.authEpoch) return false;
    if (workspaceRef.current !== fence.workspace) return false;
    return !fence.postId || store.generatedPost?.postId === fence.postId;
  }, []);

  const refuseLocked = useCallback((): boolean => {
    if (!locked) return false;
    toast.warning(lockReason || "This creative cannot be changed right now.");
    return true;
  }, [lockReason, locked, toast]);

  const run = useCallback(async (label: string, action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusyLabel(label);
    try {
      await action();
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusyLabel("");
    }
  }, []);

  const markTryAnotherUsed = useCallback(() => {
    const store = useAppStore.getState();
    const current = store.generatedPost;
    if (current && post.postId && current.postId !== post.postId) return;
    const base = current || post;
    store.setGeneratedPost({
      ...base,
      tryAnotherUsed: true,
    } as GeneratedPost);
  }, [post]);

  const tryAnother = useCallback(async () => {
    if (refuseLocked() || !hasOriginalCapture || busyRef.current) return;
    if ((post as PostWithCreativeBudget).tryAnotherUsed) {
      toast.warning(
        "Already used once on this post. A manager can regenerate it for you.",
      );
      return;
    }
    // Spend the budget before provider work begins so two taps in one frame or
    // a partial provider failure cannot buy an extra attempt.
    markTryAnotherUsed();
    const fence = captureFence();
    await run("Creating another version…", async () => {
      // These mutations both patch generatedPost. Keep them serialized so a
      // stale completion cannot overwrite the other mutation's newer fields.
      await onRegenerateImage();
      if (!fenceIsCurrent(fence)) return;
      await onRegenerateText();
      if (!fenceIsCurrent(fence)) return;
      const current = useAppStore.getState().generatedPost;
      if (current?.image) {
        lookCacheRef.current.set(String(selectedLookId), current.image);
      }
    });
  }, [
    hasOriginalCapture,
    captureFence,
    fenceIsCurrent,
    markTryAnotherUsed,
    onRegenerateImage,
    onRegenerateText,
    post,
    refuseLocked,
    run,
    selectedLookId,
    toast,
  ]);

  const selectCreative = useCallback(
    (image: string) => {
      if (refuseLocked() || !image) return;
      const store = useAppStore.getState();
      const current = store.generatedPost;
      if (current && post.postId && current.postId !== post.postId) return;
      const base = current || post;
      if (base.image === image) return;
      store.setGeneratedPost({ ...base, image }, { archive: false });
    },
    [post, refuseLocked],
  );

  const changeLook = useCallback(
    async (look: StoreLook) => {
      if (
        refuseLocked() ||
        !hasOriginalCapture ||
        busyRef.current ||
        look.id === selectedLookId
      ) {
        return;
      }
      const cached = lookCacheRef.current.get(String(look.id));
      setSelectedLookId(look.id);
      if (cached) {
        selectCreative(cached);
        return;
      }
      if (!onChangeLook) {
        toast.warning("This Look is unavailable for the current post.");
        return;
      }
      const fence = captureFence();
      await run(`Applying ${look.label}…`, async () => {
        await onChangeLook(look.id);
        if (!fenceIsCurrent(fence)) return;
        const current = useAppStore.getState().generatedPost;
        if (current?.image) lookCacheRef.current.set(String(look.id), current.image);
      });
    },
    [
      hasOriginalCapture,
      captureFence,
      fenceIsCurrent,
      onChangeLook,
      refuseLocked,
      run,
      selectCreative,
      selectedLookId,
      toast,
    ],
  );

  const addVideo = useCallback(async () => {
    if (refuseLocked() || !hasOriginalCapture || busyRef.current) return;
    if (!defaults.videoAllowed || !defaults.motion || !video.houseMotionOptions) {
      toast.warning("Video is not available for this type of post.");
      return;
    }
    await run("Creating video…", () =>
      video.startVideoJob(defaults.motion!.style, video.houseMotionOptions!),
    );
  }, [
    defaults.motion,
    defaults.videoAllowed,
    hasOriginalCapture,
    refuseLocked,
    run,
    toast,
    video,
  ]);

  const togglePlayful = useCallback(async () => {
    if (refuseLocked() || !hasOriginalCapture || busyRef.current) return;
    if (playfulPair) {
      const currentImage = useAppStore.getState().generatedPost?.image || post.image;
      selectCreative(
        currentImage === playfulPair.playful ? playfulPair.master : playfulPair.playful,
      );
      return;
    }
    if (!defaults.playfulStyleId) {
      toast.warning("Playful is not available for this type of post.");
      return;
    }
    const master = post.image;
    const fence = captureFence();
    await run("Creating a playful version…", async () => {
      await onFunMode(defaults.playfulStyleId || undefined);
      if (!fenceIsCurrent(fence)) return;
      const playful = useAppStore.getState().generatedPost?.image;
      if (playful && playful !== master) setPlayfulPair({ master, playful });
    });
  }, [
    defaults.playfulStyleId,
    captureFence,
    fenceIsCurrent,
    hasOriginalCapture,
    onFunMode,
    playfulPair,
    post.image,
    refuseLocked,
    run,
    selectCreative,
    toast,
  ]);

  return {
    busy: Boolean(busyLabel || video.isVideoLoading),
    busyLabel: busyLabel || (video.isVideoLoading ? "Creating video…" : ""),
    selectedLookId,
    tryAnotherUsed: Boolean((post as PostWithCreativeBudget).tryAnotherUsed),
    playfulPair,
    tryAnother,
    changeLook,
    addVideo,
    togglePlayful,
    selectCreative,
  };
};
