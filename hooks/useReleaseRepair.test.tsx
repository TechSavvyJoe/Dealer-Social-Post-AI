import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GeneratedPost } from "../types";

const mocks = vi.hoisted(() => ({
  store: {} as Record<string, unknown>,
  setGeneratedPost: vi.fn(),
  linkReleaseToPostWithRetry: vi.fn(),
  toastSuccess: vi.fn(),
  connectionSubscribers: new Set<(online: boolean) => void>(),
  isOnline: true,
}));

vi.mock("../services/photoReleases", () => ({
  linkReleaseToPostWithRetry: mocks.linkReleaseToPostWithRetry,
}));

vi.mock("../utils/connectionManager", () => ({
  connectionManager: {
    get isOnline() {
      return mocks.isOnline;
    },
    subscribe: (listener: (online: boolean) => void) => {
      mocks.connectionSubscribers.add(listener);
      return () => mocks.connectionSubscribers.delete(listener);
    },
  },
}));

vi.mock("../stores/appStore", () => ({
  useAppStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.store),
    { getState: () => mocks.store },
  ),
}));

vi.mock("../utils/telemetry", () => ({
  logError: vi.fn(),
}));

vi.mock("../components/ui/Toast", () => ({
  useToast: () => ({
    success: mocks.toastSuccess,
    warning: vi.fn(),
    error: vi.fn(),
  }),
}));

import { useReleaseRepair } from "./useReleaseRepair";

const basePost: GeneratedPost = {
  image: "data:image/png;base64,aW1hZ2U=",
  text: "Caption",
  captionSource: "ai",
  isBasicFallback: false,
  postId: "post-1",
  postRevision: "revision-before-link",
  releaseId: "release-1",
  releaseStatus: "save_failed",
  releaseLinkStatus: "link_failed",
};

describe("useReleaseRepair", () => {
  beforeEach(() => {
    mocks.connectionSubscribers.clear();
    mocks.isOnline = true;
    mocks.store.generatedPost = undefined;
    mocks.setGeneratedPost.mockReset();
    mocks.store.setGeneratedPost = mocks.setGeneratedPost;
    mocks.linkReleaseToPostWithRetry.mockReset();
    mocks.toastSuccess.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("flags the recoverable case only when saved-with-signature but link-failed", () => {
    const { result } = renderHook(() => useReleaseRepair({ post: basePost }));
    expect(result.current.releaseLinkRepairable).toBe(true);

    const { result: notRecoverable } = renderHook(() =>
      useReleaseRepair({ post: { ...basePost, releaseLinkStatus: undefined } }),
    );
    expect(notRecoverable.current.releaseLinkRepairable).toBe(false);
  });

  it("a manual retry links the release and unlocks delivery", async () => {
    mocks.linkReleaseToPostWithRetry.mockResolvedValue({
      id: "release-1",
      post_id: "post-1",
      has_release: true,
      post_revision: "revision-after-link",
    });
    const { result } = renderHook(() => useReleaseRepair({ post: basePost }));

    await act(async () => {
      await result.current.retry("manual");
    });

    expect(mocks.linkReleaseToPostWithRetry).toHaveBeenCalledWith(
      "release-1",
      "post-1",
    );
    expect(result.current.releaseStatus).toBe("saved");
    expect(result.current.releaseLinkStatus).toBeUndefined();
    expect(mocks.setGeneratedPost).toHaveBeenCalledWith(
      expect.objectContaining({ postRevision: "revision-after-link" }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Photo release saved to this post. Copy, share, save, and export are unlocked.",
    );
  });

  it("keeps the signed release and shows an online-aware notice on failure", async () => {
    mocks.linkReleaseToPostWithRetry.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useReleaseRepair({ post: basePost }));

    await act(async () => {
      await result.current.retry("manual");
    });

    expect(result.current.releaseStatus).toBe("save_failed");
    expect(result.current.notice).toContain("Nothing was lost");
    expect(result.current.notice).not.toContain("offline");

    mocks.isOnline = false;
    await act(async () => {
      await result.current.retry("manual");
    });
    expect(result.current.notice).toContain("You are offline");
  });

  it("retries automatically exactly once per mount when the connection returns", async () => {
    mocks.linkReleaseToPostWithRetry.mockResolvedValue({
      id: "release-1",
      post_id: "post-1",
      has_release: true,
      post_revision: "revision-after-link",
    });
    renderHook(() => useReleaseRepair({ post: basePost }));

    expect(mocks.connectionSubscribers.size).toBe(1);

    await act(async () => {
      mocks.connectionSubscribers.forEach((listener) => listener(true));
      await Promise.resolve();
    });
    expect(mocks.linkReleaseToPostWithRetry).toHaveBeenCalledTimes(1);

    // A second reconnect event must not fire a second automatic retry — the
    // button stays available, but the auto-retry is spent.
    await act(async () => {
      mocks.connectionSubscribers.forEach((listener) => listener(true));
      await Promise.resolve();
    });
    expect(mocks.linkReleaseToPostWithRetry).toHaveBeenCalledTimes(1);
  });

  it("resets the reconnect budget and re-hydrates state for a different post", () => {
    const { result, rerender } = renderHook(
      ({ post }: { post: GeneratedPost }) => useReleaseRepair({ post }),
      { initialProps: { post: basePost } },
    );
    expect(result.current.releaseStatus).toBe("save_failed");

    rerender({
      post: { ...basePost, postId: "post-2", releaseStatus: "saved" },
    });
    expect(result.current.releaseStatus).toBe("saved");
  });
  it("keeps a newer revision while a release-link reply is delayed", async () => {
    let resolve!: (value: unknown) => void;
    mocks.store.generatedPost = basePost;
    mocks.linkReleaseToPostWithRetry.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { result } = renderHook(() => useReleaseRepair({ post: basePost }));
    let retry!: Promise<void>;
    act(() => {
      retry = result.current.retry("manual");
    });
    mocks.store.generatedPost = { ...basePost, postRevision: "newer-revision" };
    await act(async () => {
      resolve({ post_revision: "older-link-revision" });
      await retry;
    });
    expect(mocks.setGeneratedPost).toHaveBeenCalledWith(
      expect.objectContaining({
        postRevision: "newer-revision",
        releaseStatus: "saved",
      }),
    );
  });
});
