import { useCallback, useEffect, useRef, useState } from "react";
import type { GeneratedPost, GenerationParams } from "../types";
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
/** One rendered Look: the image and the brief that produced it. */
type LookRender = { image: string; params: GenerationParams | null };

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
 * The Look this post was rendered with: the one whose style matches the brief
 * in the store, else the store's default Look.
 */
const seedLooks = (
  defaults: StoreDefaults,
  post: GeneratedPost,
): { lookId: StoreLook["id"]; cache: Map<string, LookRender> } => {
  const params = useAppStore.getState().generationParams;
  const lookId =
    defaults.looks.find((look) => look.style === params?.style)?.id ??
    defaults.defaultLookId;
  return {
    lookId,
    cache: new Map([[String(lookId), { image: post.image, params }]]),
  };
};

/**
 * The generation pipeline announces its own provider failures (it sets the
 * store error and shows a toast). Watch for that while a call runs so one
 * failure gets one message. Returns a stop function that reports whether the
 * pipeline spoke.
 */
const watchPipelineReport = (): (() => boolean) => {
  let reported = false;
  const unsubscribe = useAppStore.subscribe((state, previous) => {
    if (state.error && state.error !== previous.error) reported = true;
  });
  return () => {
    unsubscribe();
    return reported;
  };
};

/**
 * A refusal written for people (locked post, Look not enabled, no original
 * photo) is shown as is; anything technical gets the plain fallback.
 */
const plainReason = (error: unknown, fallback: string): string =>
  error instanceof Error && error.name === "Error" && error.message.trim()
    ? error.message.trim()
    : fallback;

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
  const [initialLooks] = useState(() => seedLooks(defaults, post));
  const [selectedLookId, setSelectedLookId] = useState<StoreLook["id"]>(
    initialLooks.lookId,
  );
  const [playfulPair, setPlayfulPair] = useState<{
    master: string;
    playful: string;
  } | null>(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const workspaceRef = useRef(workspaceKey(post));
  // Async work reads the selection from here so it never acts on a stale one.
  const selectedLookRef = useRef<StoreLook["id"]>(initialLooks.lookId);
  const lookCacheRef = useRef<Map<string, LookRender>>(initialLooks.cache);

  const selectLook = useCallback((lookId: StoreLook["id"]) => {
    selectedLookRef.current = lookId;
    if (mountedRef.current) setSelectedLookId(lookId);
  }, []);

  useEffect(() => {
    const nextWorkspace = workspaceKey(post);
    if (workspaceRef.current === nextWorkspace) return;
    workspaceRef.current = nextWorkspace;
    const next = seedLooks(defaults, post);
    lookCacheRef.current = next.cache;
    selectLook(next.lookId);
    setPlayfulPair(null);
  }, [defaults, post, selectLook]);

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
    toast.warning(lockReason || "This post can't be changed right now.");
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

  /** Remember what is on screen now, and its brief, as this Look's render. */
  const rememberLook = useCallback((lookId: StoreLook["id"]) => {
    const state = useAppStore.getState();
    const image = state.generatedPost?.image;
    if (image) {
      lookCacheRef.current.set(String(lookId), {
        image,
        params: state.generationParams,
      });
    }
  }, []);

  /**
   * Run provider work. A failure the pipeline did not already announce gets
   * one plain warning; a failure after the post changed underneath is silent.
   */
  const attempt = useCallback(
    async (
      fence: CreativeOperationFence,
      work: () => Promise<void>,
      onFailure: (error: unknown) => string,
    ): Promise<boolean> => {
      const stopWatching = watchPipelineReport();
      try {
        await work();
        return true;
      } catch (error) {
        const pipelineReported = stopWatching();
        if (fenceIsCurrent(fence) && !pipelineReported) {
          toast.warning(onFailure(error));
        }
        return false;
      } finally {
        stopWatching();
      }
    },
    [fenceIsCurrent, toast],
  );

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
    // The store's brief is the selected Look's (a cached switch restores it),
    // so the new version belongs to that Look.
    const renderedLookId = selectedLookRef.current;
    await run("Creating another version…", async () => {
      await attempt(
        fence,
        async () => {
          // These mutations both patch generatedPost. Keep them serialized so
          // a stale completion cannot overwrite the other's newer fields.
          await onRegenerateImage();
          if (!fenceIsCurrent(fence)) return;
          rememberLook(renderedLookId);
          await onRegenerateText();
        },
        () => "Couldn't create another version.",
      );
    });
  }, [
    attempt,
    captureFence,
    fenceIsCurrent,
    hasOriginalCapture,
    markTryAnotherUsed,
    onRegenerateImage,
    onRegenerateText,
    post,
    refuseLocked,
    rememberLook,
    run,
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
      if (refuseLocked() || !hasOriginalCapture || busyRef.current) return;
      const previousLookId = selectedLookRef.current;
      if (look.id === previousLookId) return;
      const cached = lookCacheRef.current.get(String(look.id));
      if (cached) {
        const store = useAppStore.getState();
        const current = store.generatedPost;
        if (current && post.postId && current.postId !== post.postId) return;
        selectLook(look.id);
        // Bring back this Look's brief too, so Try another renders this Look.
        if (cached.params) store.setGenerationParams(cached.params);
        selectCreative(cached.image);
        return;
      }
      if (!onChangeLook) {
        toast.warning("This Look is unavailable for the current post.");
        return;
      }
      const fence = captureFence();
      await run(`Applying ${look.label}…`, async () => {
        selectLook(look.id);
        const applied = await attempt(
          fence,
          () => onChangeLook(look.id),
          (error) => plainReason(error, `Couldn't apply ${look.label}. Try again.`),
        );
        if (!fenceIsCurrent(fence)) return;
        if (!applied) {
          // Put the selector back on the Look that is still on screen, so the
          // same Look can be chosen again to retry.
          selectLook(previousLookId);
          return;
        }
        rememberLook(look.id);
      });
    },
    [
      attempt,
      captureFence,
      fenceIsCurrent,
      hasOriginalCapture,
      onChangeLook,
      post.postId,
      refuseLocked,
      rememberLook,
      run,
      selectCreative,
      selectLook,
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
      const created = await attempt(
        fence,
        () => onFunMode(defaults.playfulStyleId || undefined),
        () => "Couldn't create a playful version. Try again.",
      );
      if (!created || !fenceIsCurrent(fence)) return;
      const playful = useAppStore.getState().generatedPost?.image;
      if (playful && playful !== master) setPlayfulPair({ master, playful });
    });
  }, [
    attempt,
    captureFence,
    defaults.playfulStyleId,
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
