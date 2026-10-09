import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GeneratedPost } from "../types";
import type {
  CaptionSetDeliveryAnalysis,
  DeliveryCaption,
} from "../utils/complianceDisclosures";
import type { UseDraftAutosaveOptions } from "./useDraftAutosave";

const mocks = vi.hoisted(() => ({
  updatePostDraft: vi.fn(),
}));

vi.mock("../services/posts", () => ({
  updatePostDraft: mocks.updatePostDraft,
}));

vi.mock("../utils/telemetry", () => ({
  logError: vi.fn(),
}));

import { useDraftAutosave } from "./useDraftAutosave";
import { useAppStore } from "../stores/appStore";
import { ApiError } from "../services/apiErrors";
import { logError } from "../utils/telemetry";

const basePost: GeneratedPost = {
  image: "data:image/png;base64,aW1hZ2U=",
  text: "Original caption",
  captionSource: "ai",
  isBasicFallback: false,
  postId: "post-1",
  postRevision: "rev-0",
};

const analysisFor = (caption: string): DeliveryCaption => ({
  caption,
  disclosures: "",
  disclosureCategories: [],
  compliance: { text: caption, matches: [], prohibited: [], changed: false },
});

const emptySetAnalysis: CaptionSetDeliveryAnalysis = {
  disclosures: "",
  disclosureCategories: [],
  matches: [],
  prohibited: [],
};
const emptyGrounding = {};

// A fresh, but STABLE (not re-created per render), options object — matching
// how the real caller (components/PostResult.tsx) passes memoized values.
const baseOptions = (
  overrides: Partial<UseDraftAutosaveOptions> = {},
): UseDraftAutosaveOptions => ({
  post: basePost,
  editable: true,
  primaryCaption: "Original caption",
  captionAnalysis: analysisFor("Original caption"),
  captionSetAnalysis: emptySetAnalysis,
  effectivePack: undefined,
  identityLocked: false,
  grounding: emptyGrounding,
  ...overrides,
});

describe("useDraftAutosave", () => {
  beforeEach(() => {
    mocks.updatePostDraft.mockReset();
    useAppStore.setState({ generatedPost: { ...basePost } });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("does not save when the caption has not changed from the seeded post", async () => {
    const options = baseOptions();
    renderHook(() => useDraftAutosave(options));
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.updatePostDraft).not.toHaveBeenCalled();
  });

  it("cancels an edit undone before the debounce and does not save it on leave", async () => {
    vi.useFakeTimers();
    const { result, rerender, unmount } = renderHook(
      (props: UseDraftAutosaveOptions) => useDraftAutosave(props),
      { initialProps: baseOptions() },
    );
    rerender(
      baseOptions({
        primaryCaption: "Unwanted caption",
        captionAnalysis: analysisFor("Unwanted caption"),
      }),
    );
    rerender(baseOptions());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(result.current.status).toBe("idle");
    unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.updatePostDraft).not.toHaveBeenCalled();
  });

  it.each(["empty", "prohibited", "identity"])(
    "discards the queued valid caption when the visible caption becomes %s",
    async (kind) => {
      vi.useFakeTimers();
      const { result, rerender } = renderHook(
        (props: UseDraftAutosaveOptions) => useDraftAutosave(props),
        { initialProps: baseOptions() },
      );
      rerender(
        baseOptions({
          primaryCaption: "Earlier caption",
          captionAnalysis: analysisFor("Earlier caption"),
        }),
      );
      const next = analysisFor(kind === "empty" ? "" : "Latest caption");
      if (kind === "prohibited")
        next.compliance.prohibited = [{ prohibited: true } as never];
      rerender(
        baseOptions({
          primaryCaption: next.caption,
          captionAnalysis: next,
          identityLocked: kind === "identity",
        }),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
        await result.current.retry();
      });
      expect(mocks.updatePostDraft).not.toHaveBeenCalled();
      expect(result.current.status).toBe("idle");
    },
  );

  it("saves an undo after the earlier edit has already started saving", async () => {
    vi.useFakeTimers();
    let resolveFirst!: (value: { post_revision: string }) => void;
    mocks.updatePostDraft
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ post_revision: "rev-2" });
    const { result, rerender } = renderHook(
      (props: UseDraftAutosaveOptions) => useDraftAutosave(props),
      { initialProps: baseOptions() },
    );
    rerender(
      baseOptions({
        primaryCaption: "Unwanted caption",
        captionAnalysis: analysisFor("Unwanted caption"),
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    rerender(baseOptions());
    resolveFirst({ post_revision: "rev-1" });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(useAppStore.getState().generatedPost?.text).toBe("Original caption");
    expect(result.current.status).toBe("saving");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(mocks.updatePostDraft).toHaveBeenLastCalledWith(
      "post-1",
      expect.objectContaining({
        caption: "Original caption",
        expectedPostRevision: "rev-1",
      }),
    );
    expect(result.current.status).toBe("saved");
  });

  it("does not mark an invalid visible caption saved when an older in-flight save finishes", async () => {
    vi.useFakeTimers();
    let resolveSave!: (value: { post_revision: string }) => void;
    mocks.updatePostDraft.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    const { result, rerender } = renderHook(
      (props: UseDraftAutosaveOptions) => useDraftAutosave(props),
      { initialProps: baseOptions() },
    );
    rerender(
      baseOptions({
        primaryCaption: "Earlier caption",
        captionAnalysis: analysisFor("Earlier caption"),
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    rerender(baseOptions({ primaryCaption: "", captionAnalysis: analysisFor("") }));
    resolveSave({ post_revision: "rev-1" });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.status).toBe("idle");
    expect(useAppStore.getState().generatedPost?.text).toBe("Original caption");
    expect(result.current.lastRevisionRef.current).toBe("rev-1");
  });

  it("drops queued work after the signed-in workspace changes", async () => {
    const { result } = renderHook(() => useDraftAutosave(baseOptions()));
    act(() => {
      result.current.stage({ caption: "Earlier workspace caption", disclosures: "" });
    });
    const saving = result.current.flush();
    useAppStore.setState({ authEpoch: useAppStore.getState().authEpoch + 1 });
    await act(async () => {
      await expect(saving).resolves.toBe(false);
    });
    expect(mocks.updatePostDraft).not.toHaveBeenCalled();
  });

  it("discards every queued predecessor when the latest visible caption is emptied", async () => {
    const { result, rerender } = renderHook(
      (props: UseDraftAutosaveOptions) => useDraftAutosave(props),
      { initialProps: baseOptions() },
    );
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      result.current.stage({ caption: "First queued edit", disclosures: "" });
      first = result.current.flush();
      result.current.stage({ caption: "Second queued edit", disclosures: "" });
      second = result.current.flush();
    });
    rerender(baseOptions({ primaryCaption: "", captionAnalysis: analysisFor("") }));
    await act(async () => {
      await expect(first).resolves.toBe(false);
      await expect(second).resolves.toBe(false);
    });
    expect(mocks.updatePostDraft).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it("debounces 600ms after a caption change before saving", async () => {
    vi.useFakeTimers();
    mocks.updatePostDraft.mockResolvedValue({
      id: "post-1",
      updated: true,
      post_revision: "rev-1",
    });
    const { result, rerender } = renderHook(
      (props: UseDraftAutosaveOptions) => useDraftAutosave(props),
      { initialProps: baseOptions() },
    );

    rerender(
      baseOptions({
        primaryCaption: "Edited caption",
        captionAnalysis: analysisFor("Edited caption"),
      }),
    );

    expect(result.current.status).toBe("saving");
    expect(mocks.updatePostDraft).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(599);
    });
    expect(mocks.updatePostDraft).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mocks.updatePostDraft).toHaveBeenCalledTimes(1);
    expect(mocks.updatePostDraft).toHaveBeenCalledWith(
      "post-1",
      expect.objectContaining({ expectedPostRevision: "rev-0" }),
    );
    expect(result.current.status).toBe("saved");
    expect(result.current.lastRevisionRef.current).toBe("rev-1");
  });

  it("keeps a newer local draft visible while an older save finishes", async () => {
    let resolveFirst: (value: {
      id: string;
      updated: true;
      post_revision: string;
    }) => void = () => {};
    const firstCall = new Promise<{ id: string; updated: true; post_revision: string }>(
      (resolve) => {
        resolveFirst = resolve;
      },
    );
    let resolveSecond: (value: {
      id: string;
      updated: true;
      post_revision: string;
    }) => void = () => {};
    const secondCall = new Promise<{
      id: string;
      updated: true;
      post_revision: string;
    }>((resolve) => {
      resolveSecond = resolve;
    });
    mocks.updatePostDraft
      .mockImplementationOnce(() => firstCall)
      .mockImplementationOnce(() => secondCall);

    const options = baseOptions();
    const { result } = renderHook(() => useDraftAutosave(options));

    act(() => {
      result.current.stage({ caption: "First edit", disclosures: "" });
    });
    const firstFlush = result.current.flush();
    // Queue a second, later save behind the first via the serialized chain.
    act(() => {
      result.current.stage({ caption: "Second edit", disclosures: "" });
    });
    const secondFlush = result.current.flush();

    resolveFirst({ id: "post-1", updated: true, post_revision: "rev-1" });
    await act(async () => {
      await firstFlush;
    });
    expect(useAppStore.getState().generatedPost).toMatchObject({
      text: "Original caption",
      postRevision: "rev-1",
    });
    expect(result.current.status).toBe("saving");

    resolveSecond({ id: "post-1", updated: true, post_revision: "rev-2" });
    await act(async () => {
      await secondFlush;
    });

    // The serialized chain guarantees the second save's revision is what's
    // kept, since it only runs after the first has fully settled.
    expect(result.current.lastRevisionRef.current).toBe("rev-2");
    expect(useAppStore.getState().generatedPost).toMatchObject({
      text: "Second edit",
      postRevision: "rev-2",
    });
    expect(mocks.updatePostDraft.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ expectedPostRevision: "rev-1" }),
    );
  });

  it("treats a saved post with no revision as a conflict, not a failed connection", async () => {
    const { result } = renderHook(() =>
      useDraftAutosave(baseOptions({ post: { ...basePost, postRevision: undefined } })),
    );
    act(() => {
      result.current.stage({ caption: "Edited caption", disclosures: "" });
    });
    await act(async () => {
      await expect(result.current.flush()).resolves.toBe(false);
    });
    expect(mocks.updatePostDraft).not.toHaveBeenCalled();
    // "failed" would offer a Retry save that can never succeed.
    expect(result.current.status).toBe("conflict");
    expect(logError).toHaveBeenCalledWith(
      "post.draft_sync_conflict",
      expect.objectContaining({ postId: "post-1" }),
    );

    await act(async () => {
      await expect(result.current.retry()).resolves.toBe(false);
    });
    act(() => {
      result.current.stage({ caption: "Another edit", disclosures: "" });
    });
    expect(result.current.status).toBe("conflict");
    expect(mocks.updatePostDraft).not.toHaveBeenCalled();
  });

  it("adopts a newer same-post revision before the next save", async () => {
    mocks.updatePostDraft.mockResolvedValue({
      id: "post-1",
      updated: true,
      post_revision: "rev-3",
    });
    const { result, rerender } = renderHook(
      ({ post }: { post: GeneratedPost }) => useDraftAutosave(baseOptions({ post })),
      { initialProps: { post: { ...basePost, postRevision: "rev-1" } } },
    );

    const linkedPost = {
      ...basePost,
      postRevision: "rev-2",
      releaseStatus: "saved" as const,
    };
    useAppStore.setState({ generatedPost: linkedPost });
    rerender({ post: linkedPost });
    act(() => {
      result.current.stage({ caption: "Edit after release repair", disclosures: "" });
    });
    await act(async () => {
      await result.current.flush();
    });

    expect(mocks.updatePostDraft).toHaveBeenCalledWith(
      "post-1",
      expect.objectContaining({ expectedPostRevision: "rev-2" }),
    );
    expect(result.current.lastRevisionRef.current).toBe("rev-3");
  });

  it("never autosaves a caption with a prohibited claim or an identity failure", async () => {
    const prohibitedAnalysis = analysisFor("Guaranteed approval!");
    prohibitedAnalysis.compliance.prohibited = [
      {
        category: "prohibited_phrase",
        triggerPhrase: "guaranteed approval",
        prohibited: true,
      } as never,
    ];
    const options = baseOptions({
      primaryCaption: "Guaranteed approval!",
      captionAnalysis: prohibitedAnalysis,
    });
    renderHook(() => useDraftAutosave(options));
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.updatePostDraft).not.toHaveBeenCalled();

    const identityOptions = baseOptions({
      primaryCaption: "Edited caption",
      captionAnalysis: analysisFor("Edited caption"),
      identityLocked: true,
    });
    renderHook(() => useDraftAutosave(identityOptions));
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.updatePostDraft).not.toHaveBeenCalled();
  });

  it("does not save when not editable, and flush is a no-op", async () => {
    const options = baseOptions({
      editable: false,
      primaryCaption: "Edited caption",
      captionAnalysis: analysisFor("Edited caption"),
    });
    const { result } = renderHook(() => useDraftAutosave(options));
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.updatePostDraft).not.toHaveBeenCalled();
    await act(async () => {
      const flushed = await result.current.flush();
      expect(flushed).toBe(true);
    });
  });

  it("sets status to failed on a save error, and retry re-attempts it", async () => {
    mocks.updatePostDraft.mockRejectedValueOnce(new Error("network"));
    const options = baseOptions();
    const { result } = renderHook(() => useDraftAutosave(options));

    act(() => {
      result.current.stage({ caption: "Edited caption", disclosures: "" });
    });
    await act(async () => {
      await result.current.flush();
    });
    expect(result.current.status).toBe("failed");

    mocks.updatePostDraft.mockResolvedValueOnce({
      id: "post-1",
      updated: true,
      post_revision: "rev-1",
    });
    act(() => {
      result.current.stage({ caption: "Edited caption", disclosures: "" });
    });
    await act(async () => {
      await result.current.retry();
    });
    expect(result.current.status).toBe("saved");
  });

  it.each(["POST_DRAFT_REVISION_CONFLICT", "POST_DRAFT_REVISION_REQUIRED"])(
    "stops on %s: status conflict, and Retry save never resends the stale token",
    async (code) => {
      mocks.updatePostDraft.mockRejectedValue(
        new ApiError("This draft changed in another window.", { status: 409, code }),
      );
      const options = baseOptions();
      const { result } = renderHook(() => useDraftAutosave(options));

      act(() => {
        result.current.stage({ caption: "Edited caption", disclosures: "" });
      });
      await act(async () => {
        await expect(result.current.flush()).resolves.toBe(false);
      });
      expect(result.current.status).toBe("conflict");
      expect(logError).toHaveBeenCalledWith(
        "post.draft_sync_conflict",
        expect.objectContaining({ postId: "post-1" }),
      );

      await act(async () => {
        await expect(result.current.retry()).resolves.toBe(false);
        await expect(result.current.retry()).resolves.toBe(false);
      });
      expect(mocks.updatePostDraft).toHaveBeenCalledTimes(1);
      expect(result.current.status).toBe("conflict");

      // A later edit cannot clear it either, and never claims to be saving:
      // the "changed somewhere else" banner stays up while the edit is kept.
      act(() => {
        result.current.stage({ caption: "Another edit", disclosures: "" });
      });
      expect(result.current.status).toBe("conflict");
      await act(async () => {
        await result.current.flush();
      });
      expect(mocks.updatePostDraft).toHaveBeenCalledTimes(1);
      expect(result.current.status).toBe("conflict");
    },
  );

  it("keeps the conflict state while the salesperson keeps typing", async () => {
    vi.useFakeTimers();
    mocks.updatePostDraft.mockRejectedValue(
      new ApiError("changed", { status: 409, code: "POST_DRAFT_REVISION_CONFLICT" }),
    );
    const { result, rerender } = renderHook(
      (props: UseDraftAutosaveOptions) => useDraftAutosave(props),
      { initialProps: baseOptions() },
    );
    rerender(
      baseOptions({
        primaryCaption: "First edit",
        captionAnalysis: analysisFor("First edit"),
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(result.current.status).toBe("conflict");
    expect(mocks.updatePostDraft).toHaveBeenCalledTimes(1);

    rerender(
      baseOptions({
        primaryCaption: "Second edit",
        captionAnalysis: analysisFor("Second edit"),
      }),
    );
    expect(result.current.status).toBe("conflict");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(result.current.status).toBe("conflict");
    expect(mocks.updatePostDraft).toHaveBeenCalledTimes(1);
  });

  it("starts a different post without the previous post's conflict", async () => {
    mocks.updatePostDraft.mockRejectedValueOnce(
      new ApiError("changed", { status: 409, code: "POST_DRAFT_REVISION_CONFLICT" }),
    );
    const secondPost: GeneratedPost = {
      ...basePost,
      postId: "post-2",
      postRevision: "rev-9",
    };
    const first = baseOptions();
    const second = baseOptions({ post: secondPost });
    const { result, rerender } = renderHook(
      (props: UseDraftAutosaveOptions) => useDraftAutosave(props),
      { initialProps: first },
    );
    act(() => {
      result.current.stage({ caption: "Edited caption", disclosures: "" });
    });
    await act(async () => {
      await result.current.flush();
    });
    expect(result.current.status).toBe("conflict");

    useAppStore.setState({ generatedPost: { ...secondPost } });
    mocks.updatePostDraft.mockResolvedValueOnce({
      id: "post-2",
      updated: true,
      post_revision: "rev-10",
    });
    rerender(second);
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.status).toBe("idle");
    // The first post's queued save (flushed by the switch) stayed blocked.
    expect(mocks.updatePostDraft).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.stage({ caption: "Second post edit", disclosures: "" });
    });
    await act(async () => {
      await expect(result.current.retry()).resolves.toBe(true);
    });
    expect(mocks.updatePostDraft).toHaveBeenCalledTimes(2);
    expect(mocks.updatePostDraft).toHaveBeenLastCalledWith(
      "post-2",
      expect.objectContaining({
        caption: "Second post edit",
        expectedPostRevision: "rev-9",
      }),
    );
    expect(result.current.status).toBe("saved");
  });

  it("treats a network error as failed, and Retry save resends the same draft", async () => {
    mocks.updatePostDraft
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ id: "post-1", updated: true, post_revision: "rev-1" });
    const options = baseOptions();
    const { result } = renderHook(() => useDraftAutosave(options));

    act(() => {
      result.current.stage({ caption: "Edited caption", disclosures: "" });
    });
    await act(async () => {
      await result.current.flush();
    });
    expect(result.current.status).toBe("failed");
    expect(logError).toHaveBeenCalledWith(
      "post.draft_sync_failed",
      expect.objectContaining({ postId: "post-1" }),
    );

    // No re-stage: Retry save alone must send the edit that failed.
    await act(async () => {
      await expect(result.current.retry()).resolves.toBe(true);
    });
    expect(mocks.updatePostDraft).toHaveBeenCalledTimes(2);
    expect(mocks.updatePostDraft.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        caption: "Edited caption",
        expectedPostRevision: "rev-0",
      }),
    );
    expect(result.current.status).toBe("saved");
    expect(result.current.lastRevisionRef.current).toBe("rev-1");
  });

  it("keeps a revision adopted into the store while a save is in flight", async () => {
    let resolveSave: (value: {
      id: string;
      updated: true;
      post_revision: string;
    }) => void = () => {};
    mocks.updatePostDraft.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    const options = baseOptions();
    const { result } = renderHook(() => useDraftAutosave(options));

    act(() => {
      result.current.stage({ caption: "Edited caption", disclosures: "" });
    });
    let saving!: Promise<boolean>;
    act(() => {
      saving = result.current.flush();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.updatePostDraft).toHaveBeenCalledTimes(1);

    // A manager decision lands (adoptPostRevision) before the save answers.
    useAppStore.setState({
      generatedPost: { ...basePost, postRevision: "rev-approved" },
    });
    resolveSave({ id: "post-1", updated: true, post_revision: "rev-1" });
    await act(async () => {
      await saving;
    });

    expect(result.current.lastRevisionRef.current).toBe("rev-approved");
    expect(useAppStore.getState().generatedPost).toMatchObject({
      text: "Edited caption",
      postRevision: "rev-approved",
    });
  });

  it("flushes the pending save on unmount", async () => {
    mocks.updatePostDraft.mockResolvedValue({
      id: "post-1",
      updated: true,
      post_revision: "rev-1",
    });
    const options = baseOptions();
    const { result, unmount } = renderHook(() => useDraftAutosave(options));

    act(() => {
      result.current.stage({ caption: "Edited caption", disclosures: "" });
    });
    unmount();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.updatePostDraft).toHaveBeenCalledTimes(1);
  });
});
