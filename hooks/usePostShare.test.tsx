import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GeneratedPost } from "../types";
import type { PlatformDestinationId } from "../services/platformOutputs";

const mocks = vi.hoisted(() => ({
  preparePublishShare: vi.fn(),
  sharePrepared: vi.fn(),
  copyPreparedCaption: vi.fn(),
  downloadPreparedMedia: vi.fn(),
  openPreparedTarget: vi.fn(),
  recordPostShared: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("../services/publishTargets", () => ({
  preparePublishShare: mocks.preparePublishShare,
  sharePrepared: mocks.sharePrepared,
  copyPreparedCaption: mocks.copyPreparedCaption,
  downloadPreparedMedia: mocks.downloadPreparedMedia,
  openPreparedTarget: mocks.openPreparedTarget,
}));
vi.mock("../services/posts", () => ({ recordPostShared: mocks.recordPostShared }));
vi.mock("../utils/telemetry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/telemetry")>()),
  logError: mocks.logError,
}));

import { usePostShare } from "./usePostShare";
import { useAppStore } from "../stores/appStore";
import { ApiError } from "../services/apiErrors";

const file = new File(["image"], "facebook.jpg", { type: "image/jpeg" });
const post: GeneratedPost = {
  postId: "post-1",
  postRevision: "revision-1",
  image: "data:image/jpeg;base64,aW1hZ2U=",
  text: "Delivery day",
};

const options = (
  text = "Delivery day",
  channelId: PlatformDestinationId = "facebook_feed",
) => ({
  post,
  channelId,
  channelLabel: channelId === "facebook_feed" ? "Facebook" : "Instagram",
  content: { text, preparedFile: file },
  expectedPostRevision: "revision-1",
  flushDraft: vi.fn(async () => true),
});

/** The connection manager only notifies on a change, so drop first. */
const reconnect = async () => {
  await act(async () => {
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
    await Promise.resolve();
    await Promise.resolve();
  });
};

/** Prepare, share once, and let the fire-and-forget receipt settle. */
const shareOnce = async (result: { current: ReturnType<typeof usePostShare> }) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
  await act(async () => {
    await result.current.share();
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

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
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
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
        message: "Reopen this post from My work to keep going.",
      });
    });
    expect(mocks.sharePrepared).not.toHaveBeenCalled();
  });

  it.each([
    [true, "Caption copied. Paste it into your Facebook post, then tap Post there."],
    [false, "Tap Copy caption, then paste it into your Facebook post."],
  ])(
    "says whether the caption reached the clipboard after a share (copied: %s)",
    async (captionCopied, detail) => {
      mocks.sharePrepared.mockResolvedValue({
        kind: "shared",
        via: "web-share",
        pasteRequired: true,
        captionCopied,
      });
      const { result } = renderHook(() => usePostShare(options()));
      await shareOnce(result);

      expect(result.current.feedback).toEqual({
        title: "Shared to Facebook",
        detail,
        via: "share_sheet",
      });

      // Copy caption next to Done: the media is already in the post.
      await act(async () => {
        await result.current.copyCaption();
      });
      expect(result.current.feedback).toEqual({
        title: "Caption copied",
        detail: "Paste it into your Facebook post.",
        via: "copy",
      });
    },
  );

  it("keeps Save file, Copy caption and Open up after the share sheet fails, until the channel changes", async () => {
    mocks.sharePrepared.mockResolvedValue({
      kind: "fallback",
      via: "download-copy",
      pasteRequired: true,
      message: "The share sheet could not open. Save the media or open the app below.",
    });
    const { result, rerender } = renderHook(
      ({ channel }: { channel: PlatformDestinationId }) =>
        usePostShare(options("Delivery day", channel)),
      { initialProps: { channel: "facebook_feed" as PlatformDestinationId } },
    );
    await shareOnce(result);

    expect(result.current.feedback).toEqual({
      title: "Share sheet didn't open",
      detail: "Save the image and copy the caption below, then open Facebook.",
      via: "copy",
      fallback: true,
    });
    expect(result.current.fallbackActive).toBe(true);
    expect(mocks.recordPostShared).not.toHaveBeenCalled();

    // Using one manual control must not take the others away, and its
    // success message is not the share-sheet warning.
    await act(async () => {
      await result.current.copyCaption();
    });
    expect(result.current.feedback).toEqual({
      title: "Caption copied",
      detail: "Paste it into Facebook with the image.",
      via: "copy",
    });
    expect(result.current.fallbackActive).toBe(true);
    act(() => {
      result.current.download();
    });
    expect(result.current.feedback).toEqual({
      title: "Image downloaded",
      detail: "Copy the caption, then post both in Facebook.",
      via: "download",
    });
    expect(result.current.fallbackActive).toBe(true);

    rerender({ channel: "instagram_feed" });
    expect(result.current.feedback).toBeNull();
    expect(result.current.fallbackActive).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await act(async () => {
      await result.current.copyCaption();
    });
    expect(result.current.feedback).toEqual({
      title: "Caption copied",
      detail: "Paste it into Instagram with the image.",
      via: "copy",
    });
  });

  it("clears the manual controls once a later share goes through", async () => {
    mocks.sharePrepared
      .mockResolvedValueOnce({
        kind: "fallback",
        via: "download-copy",
        pasteRequired: true,
        message: "The share sheet didn't open.",
      })
      .mockResolvedValueOnce({
        kind: "shared",
        via: "web-share",
        pasteRequired: true,
        captionCopied: true,
      });
    const { result } = renderHook(() => usePostShare(options()));
    await shareOnce(result);
    expect(result.current.fallbackActive).toBe(true);
    await act(async () => {
      await result.current.share();
    });
    expect(result.current.fallbackActive).toBe(false);
    expect(result.current.feedback?.title).toBe("Shared to Facebook");
  });

  it("knows a reopened post already shared to this channel has its media in the post", async () => {
    const shared: GeneratedPost = {
      ...post,
      sharedTo: [
        {
          channel: "facebook_feed",
          via: "share_sheet",
          at: "2026-10-04T12:00:00.000Z",
        },
      ],
    };
    const { result } = renderHook(() => usePostShare({ ...options(), post: shared }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await act(async () => {
      await result.current.copyCaption();
    });
    expect(result.current.feedback?.detail).toBe("Paste it into your Facebook post.");

    // A share to another channel says nothing about this one.
    const elsewhere: GeneratedPost = {
      ...post,
      sharedTo: [
        {
          channel: "instagram_feed",
          via: "share_sheet",
          at: "2026-10-04T12:00:00.000Z",
        },
      ],
    };
    const other = renderHook(() => usePostShare({ ...options(), post: elsewhere }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await act(async () => {
      await other.result.current.copyCaption();
    });
    expect(other.result.current.feedback?.detail).toBe(
      "Paste it into Facebook with the image.",
    );
  });

  it("tells a desktop salesperson what to do after Download and Copy caption", async () => {
    const { result } = renderHook(() => usePostShare(options()));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    act(() => {
      expect(result.current.download()).toBe(true);
    });
    expect(result.current.feedback).toEqual({
      title: "Image downloaded",
      detail: "Copy the caption, then post both in Facebook.",
      via: "download",
    });
    await act(async () => {
      await result.current.copyCaption();
    });
    expect(result.current.feedback).toEqual({
      title: "Caption copied",
      detail: "Paste it into Facebook with the image.",
      via: "copy",
    });
  });

  it("names a video as a video in the feedback", async () => {
    const video = new File(["video"], "reel.mp4", { type: "video/mp4" });
    mocks.sharePrepared.mockResolvedValue({
      kind: "fallback",
      via: "download-copy",
      pasteRequired: true,
      message: "The share sheet could not open.",
    });
    const input = {
      ...options(),
      content: { text: "Delivery day", preparedFile: video, videoUrl: "blob:reel" },
    };
    const { result } = renderHook(() => usePostShare(input));
    await shareOnce(result);
    expect(result.current.feedback?.detail).toBe(
      "Save the video and copy the caption below, then open Facebook.",
    );
    act(() => {
      result.current.download();
    });
    expect(result.current.feedback?.title).toBe("Video downloaded");
  });

  it("explains a preparation that has not finished or failed in plain words", async () => {
    // Share tapped before the 300 ms preparation has even started.
    const early = renderHook(() => usePostShare(options()));
    await act(async () => {
      expect(await early.result.current.share()).toEqual({
        kind: "error",
        message: "Still getting it ready.",
      });
    });
    early.unmount();

    // A stable input, as the Post screen passes, so the failure stays visible.
    mocks.preparePublishShare.mockRejectedValueOnce(new Error(""));
    const input = options("Another caption");
    const failing = renderHook(() => usePostShare(input));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(failing.result.current.preparationStatus).toBe("failed");
    expect(failing.result.current.preparationError).toBe(
      "Couldn't get the image ready.",
    );
  });

  it.each([
    ["a stale revision", 409, "POST_SHARE_REVISION_CONFLICT"],
    ["a delivery lock", 403, "POST_DELIVERY_LOCKED"],
  ])(
    "logs and drops a receipt refused for %s, and never resends it",
    async (_label, status, code) => {
      mocks.recordPostShared.mockRejectedValueOnce(
        new ApiError("This post changed before the share receipt was recorded.", {
          status,
          code,
        }),
      );
      const { result } = renderHook(() => usePostShare(options()));
      await shareOnce(result);

      expect(mocks.recordPostShared).toHaveBeenCalledTimes(1);
      expect(mocks.logError).toHaveBeenCalledWith("post.share_receipt_rejected", {
        postId: "post-1",
        status,
        errorCode: code,
      });
      // The share itself happened, so it still shows on this device.
      expect(result.current.feedback?.title).toBe("Shared to Facebook");

      await reconnect();
      expect(mocks.recordPostShared).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ["a network error", new TypeError("Failed to fetch")],
    ["a 503", new ApiError("Unavailable", { status: 503, code: "UNAVAILABLE" })],
    ["a 408", new ApiError("Request timeout", { status: 408 })],
    ["a 429", new ApiError("Too many requests", { status: 429, code: "LOCKED" })],
  ])(
    "retries a receipt lost to %s exactly once, on the next online event",
    async (_label, error) => {
      let failRetry: (reason: unknown) => void = () => {};
      mocks.recordPostShared.mockRejectedValueOnce(error).mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            failRetry = reject;
          }),
      );
      const { result } = renderHook(() => usePostShare(options()));
      await shareOnce(result);
      expect(mocks.recordPostShared).toHaveBeenCalledTimes(1);
      expect(mocks.logError).not.toHaveBeenCalled();

      await reconnect();
      expect(mocks.recordPostShared).toHaveBeenCalledTimes(2);
      expect(mocks.recordPostShared).toHaveBeenLastCalledWith("post-1", {
        channel: "facebook_feed",
        via: "share_sheet",
        expectedPostRevision: "revision-1",
      });

      // A flapping connection while the retry is still in flight adds nothing.
      await reconnect();
      expect(mocks.recordPostShared).toHaveBeenCalledTimes(2);

      await act(async () => {
        failRetry(error);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(mocks.logError).toHaveBeenCalledWith(
        "post.share_receipt_failed",
        expect.objectContaining({ postId: "post-1" }),
      );

      await reconnect();
      expect(mocks.recordPostShared).toHaveBeenCalledTimes(2);
    },
  );

  it("keeps a share-sheet receipt lost in transit when a later Copy caption records", async () => {
    mocks.recordPostShared
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({
        id: "share-2",
        channel: "facebook_feed",
        via: "copy",
        shared_at: "2026-10-05T12:00:00.000Z",
        deduplicated: false,
        post_revision: "revision-1",
      });
    const { result } = renderHook(() => usePostShare(options()));
    await shareOnce(result);
    await act(async () => {
      await result.current.copyCaption();
      await Promise.resolve();
    });
    expect(mocks.recordPostShared).toHaveBeenCalledTimes(2);

    await reconnect();
    expect(mocks.recordPostShared).toHaveBeenCalledTimes(3);
    expect(mocks.recordPostShared).toHaveBeenLastCalledWith("post-1", {
      channel: "facebook_feed",
      via: "share_sheet",
      expectedPostRevision: "revision-1",
    });
  });

  it("retries every method's lost receipt, not just the last one", async () => {
    mocks.recordPostShared
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => usePostShare(options()));
    await shareOnce(result);
    act(() => {
      result.current.download();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.recordPostShared).toHaveBeenCalledTimes(2);

    await reconnect();
    expect(mocks.recordPostShared).toHaveBeenCalledTimes(4);
    const retried = mocks.recordPostShared.mock.calls
      .slice(2)
      .map(([, receipt]) => receipt.via)
      .sort();
    expect(retried).toEqual(["download", "share_sheet"]);
  });

  it.each([
    ["echoes the revision it checked", "revision-1"],
    ["carries a different revision", "revision-2"],
  ])(
    "never rolls back a newer revision a draft save adopted while the receipt was in flight (receipt %s)",
    async (_label, receiptRevision) => {
      let resolveRecord: (value: unknown) => void = () => {};
      mocks.recordPostShared.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRecord = resolve;
          }),
      );
      const { result } = renderHook(() => usePostShare(options()));
      await shareOnce(result);
      expect(mocks.recordPostShared).toHaveBeenCalledTimes(1);

      const current = useAppStore.getState().generatedPost as GeneratedPost;
      useAppStore.setState({
        generatedPost: { ...current, postRevision: "revision-3" },
      });
      await act(async () => {
        resolveRecord({
          id: "share-1",
          channel: "facebook_feed",
          via: "share_sheet",
          shared_at: "2026-10-05T12:00:00.000Z",
          deduplicated: false,
          post_revision: receiptRevision,
        });
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(useAppStore.getState().generatedPost?.postRevision).toBe("revision-3");
    },
  );

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
