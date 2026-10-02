import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GeneratedPost } from "../types";

const mocks = vi.hoisted(() => ({
  preparePublishShare: vi.fn(),
  sharePrepared: vi.fn(),
  copyPreparedCaption: vi.fn(),
  downloadPreparedMedia: vi.fn(),
  openPreparedTarget: vi.fn(),
  recordPostShared: vi.fn(),
}));

vi.mock("../services/publishTargets", () => ({
  preparePublishShare: mocks.preparePublishShare,
  sharePrepared: mocks.sharePrepared,
  copyPreparedCaption: mocks.copyPreparedCaption,
  downloadPreparedMedia: mocks.downloadPreparedMedia,
  openPreparedTarget: mocks.openPreparedTarget,
}));
vi.mock("../services/posts", () => ({ recordPostShared: mocks.recordPostShared }));

import { usePostShare } from "./usePostShare";
import { useAppStore } from "../stores/appStore";

const file = new File(["image"], "facebook.jpg", { type: "image/jpeg" });
const post: GeneratedPost = {
  postId: "post-1",
  postRevision: "revision-1",
  image: "data:image/jpeg;base64,aW1hZ2U=",
  text: "Delivery day",
};

const options = (text = "Delivery day", channelId = "facebook_feed" as const) => ({
  post,
  channelId,
  channelLabel: channelId === "facebook_feed" ? "Facebook" : "Instagram",
  content: { text, preparedFile: file },
  expectedPostRevision: "revision-1",
  flushDraft: vi.fn(async () => true),
});

describe("usePostShare", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.preparePublishShare.mockImplementation(async (targetId, content) => ({
      target: { id: targetId, label: targetId },
      content,
      caption: content.text,
      file: content.preparedFile,
      webUrl: "https://example.com",
    }));
    mocks.sharePrepared.mockResolvedValue({
      kind: "shared",
      via: "web-share",
      pasteRequired: true,
    });
    mocks.copyPreparedCaption.mockResolvedValue(true);
    mocks.downloadPreparedMedia.mockReturnValue(true);
    mocks.openPreparedTarget.mockReturnValue("native");
    mocks.recordPostShared.mockResolvedValue({
      id: "share-1",
      channel: "facebook_feed",
      via: "share_sheet",
      shared_at: "2026-09-23T12:00:00.000Z",
      deduplicated: false,
      post_revision: "revision-2",
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: vi.fn(() => true),
    });
    useAppStore.setState({ generatedPost: post });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("invokes the already-prepared share synchronously before autosave work", async () => {
    const input = options();
    const { result } = renderHook(() => usePostShare(input));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(result.current.preparationStatus).toBe("ready");

    let microtaskPassed = false;
    void Promise.resolve().then(() => {
      microtaskPassed = true;
    });
    let sharePromise!: Promise<unknown>;
    act(() => {
      sharePromise = result.current.share();
      expect(mocks.sharePrepared).toHaveBeenCalledTimes(1);
      expect(microtaskPassed).toBe(false);
    });
    await act(async () => {
      await sharePromise;
    });

    expect(input.flushDraft).toHaveBeenCalledTimes(1);
    expect(mocks.recordPostShared).toHaveBeenCalledWith("post-1", {
      channel: "facebook_feed",
      via: "share_sheet",
      expectedPostRevision: "revision-1",
    });
    expect(result.current.feedback?.title).toBe("Shared to Facebook");
    expect(useAppStore.getState().generatedPost?.sharedTo).toHaveLength(1);
  });

  it("invalidates stale preparation immediately, then re-prepares after a caption edit", async () => {
    const { result, rerender } = renderHook(
      ({ caption }) => usePostShare(options(caption)),
      { initialProps: { caption: "First caption" } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(result.current.shareDisabled).toBe(false);

    rerender({ caption: "Edited caption" });
    expect(result.current.shareDisabled).toBe(true);
    expect(result.current.prepared).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(299);
    });
    expect(mocks.preparePublishShare).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.preparationStatus).toBe("ready");
    expect(mocks.preparePublishShare).toHaveBeenLastCalledWith(
      "facebook_feed",
      expect.objectContaining({ text: "Edited caption", preparedFile: file }),
    );
  });

  it("records desktop copy and download through their honest methods", async () => {
    const { result } = renderHook(() => usePostShare(options()));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await act(async () => {
      await result.current.copyCaption();
    });
    act(() => {
      expect(result.current.download()).toBe(true);
    });
    expect(mocks.recordPostShared).toHaveBeenCalledWith("post-1", {
      channel: "facebook_feed",
      via: "copy",
      expectedPostRevision: "revision-1",
    });
    expect(mocks.recordPostShared).toHaveBeenCalledWith("post-1", {
      channel: "facebook_feed",
      via: "download",
      expectedPostRevision: "revision-1",
    });
  });

  it("records against the latest revision observed after a same-post repair", async () => {
    const { result, rerender } = renderHook(
      ({ revision }) => usePostShare({ ...options(), expectedPostRevision: revision }),
      { initialProps: { revision: "revision-1" } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    rerender({ revision: "revision-2" });
    await act(async () => {
      await result.current.copyCaption();
    });

    expect(mocks.recordPostShared).toHaveBeenCalledWith("post-1", {
      channel: "facebook_feed",
      via: "copy",
      expectedPostRevision: "revision-2",
    });
  });

  it("does not prepare or deliver while the current draft is unsaved", async () => {
    const input = {
      ...options(),
      blockedReason: "The current caption and image must be saved before delivery.",
    };
    const { result } = renderHook(() => usePostShare(input));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(result.current.shareDisabled).toBe(true);
    expect(result.current.prepared).toBeNull();
    expect(mocks.preparePublishShare).not.toHaveBeenCalled();
    await act(async () => {
      expect(await result.current.copyCaption()).toBe(false);
    });
    expect(result.current.download()).toBe(false);
    await act(async () => {
      expect(await result.current.share()).toMatchObject({ kind: "error" });
    });
    expect(mocks.sharePrepared).not.toHaveBeenCalled();
    expect(input.flushDraft).toHaveBeenCalledTimes(1);
    expect(mocks.recordPostShared).not.toHaveBeenCalled();
  });

  it("blocks a saved post when its compare-and-set revision is absent", async () => {
    const input = { ...options(), expectedPostRevision: undefined };
    const { result } = renderHook(() => usePostShare(input));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(result.current.shareDisabled).toBe(true);
    expect(mocks.preparePublishShare).not.toHaveBeenCalled();
    await act(async () => {
      expect(await result.current.share()).toMatchObject({
        kind: "error",
        message: expect.stringMatching(/missing its revision/i),
      });
    });
    expect(mocks.sharePrepared).not.toHaveBeenCalled();
  });

  it("contains no await before the synchronous sharePrepared call", async () => {
    const [{ readFile }, { join }] = await Promise.all([
      import("node:fs/promises"),
      import("node:path"),
    ]);
    const source = await readFile(join(process.cwd(), "hooks/usePostShare.ts"), "utf8");
    const body = source.slice(source.indexOf("const share = useCallback"));
    const beforeCall = body.slice(0, body.indexOf("sharePrepared(activePrepared)"));
    expect(beforeCall).not.toContain("await ");
  });
});
