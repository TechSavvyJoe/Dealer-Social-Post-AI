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
  grounding: {},
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

  it("fails closed instead of overwriting when a saved post has no revision", async () => {
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
    expect(result.current.status).toBe("failed");
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
