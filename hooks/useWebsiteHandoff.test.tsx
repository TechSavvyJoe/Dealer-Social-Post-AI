import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GeneratedPost } from "../types";
import type { WebsiteDraft, WebsitePublication } from "../services/websitePublishing";

const mocks = vi.hoisted(() => ({
  store: {} as Record<string, unknown>,
  setGeneratedPost: vi.fn(),
  getWebsitePublication: vi.fn(),
  enqueueWebsitePublication: vi.fn(),
  retryWebsitePublication: vi.fn(),
  listWebsiteDestinations: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("../services/websitePublishing", async () => {
  const actual = await vi.importActual<typeof import("../services/websitePublishing")>(
    "../services/websitePublishing",
  );
  return {
    ...actual,
    getWebsitePublication: mocks.getWebsitePublication,
    enqueueWebsitePublication: mocks.enqueueWebsitePublication,
    retryWebsitePublication: mocks.retryWebsitePublication,
    listWebsiteDestinations: mocks.listWebsiteDestinations,
  };
});

vi.mock("../stores/appStore", () => ({
  useAppStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.store),
    { getState: () => mocks.store },
  ),
}));

vi.mock("../components/ui/Toast", () => ({
  useToast: () => ({
    success: mocks.toastSuccess,
    warning: mocks.toastWarning,
    error: mocks.toastError,
  }),
}));

import { useWebsiteHandoff, type WebsiteHandoffAutosave } from "./useWebsiteHandoff";

const websiteDraft: WebsiteDraft = {
  enabled: true,
  kind: "site_update",
  category: "inventory",
  title: "Fresh arrival",
  body: "Body copy",
  altText: "alt",
  schemaVersion: 1,
};

const basePost: GeneratedPost = {
  image: "data:image/png;base64,aW1hZ2U=",
  text: "Caption",
  captionSource: "ai",
  isBasicFallback: false,
  postId: "post-1",
  websiteDraft,
  websitePublication: { status: "not_requested" },
};

const baseCaptions = {
  activeCaptionPlatform: null,
  primaryCaption: "Caption",
  editedText: "Caption",
  bannedPhrases: undefined,
  deliveryLanguageAllowed: true,
  effectivePack: undefined,
  disclosures: "",
};

// Mirrors the real useDraftAutosave: flush compare-and-sets from the last
// observed revision, then replaces it with the saved revision.
const stubAutosave = (): WebsiteHandoffAutosave => {
  const lastRevisionRef: { current: string | null } = { current: "rev-0" };
  return {
    stage: vi.fn(),
    flush: vi.fn(async () => {
      lastRevisionRef.current = "rev-1";
      return true;
    }),
    lastRevisionRef,
  };
};

describe("useWebsiteHandoff", () => {
  beforeEach(() => {
    mocks.store.generatedPost = { ...basePost };
    mocks.store.setGeneratedPost = mocks.setGeneratedPost;
    mocks.setGeneratedPost.mockReset();
    mocks.getWebsitePublication.mockReset();
    mocks.enqueueWebsitePublication.mockReset();
    mocks.retryWebsitePublication.mockReset();
    mocks.listWebsiteDestinations.mockReset().mockResolvedValue([]);
    mocks.toastSuccess.mockReset();
    mocks.toastWarning.mockReset();
    mocks.toastError.mockReset();
    mocks.getWebsitePublication.mockResolvedValue({ status: "not_requested" });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("hydrates the authoritative status once per dealer:post", async () => {
    // "published" is settled (no needs-refresh polling), which isolates this
    // test to the hydrate effect alone.
    mocks.getWebsitePublication.mockResolvedValue({
      status: "published",
      reviewUrl: "https://hub.example/review/1",
    });
    const { result, rerender } = renderHook(
      (props: Parameters<typeof useWebsiteHandoff>[0]) => useWebsiteHandoff(props),
      {
        initialProps: {
          post: basePost,
          dealerId: "dealer-1",
          dealer: null,
          imageBusy: false,
          textBusy: false,
          captions: baseCaptions,
        },
      },
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.getWebsitePublication).toHaveBeenCalledTimes(1);
    expect(result.current.publication?.status).toBe("published");

    // A re-render with the same dealer/post never re-hydrates.
    rerender({
      post: basePost,
      dealerId: "dealer-1",
      dealer: null,
      imageBusy: true,
      textBusy: false,
      captions: baseCaptions,
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.getWebsitePublication).toHaveBeenCalledTimes(1);
  });

  it("send aborts and restores the authoritative state when the creative changed mid-send", async () => {
    mocks.getWebsitePublication.mockResolvedValue({ status: "not_requested" });
    const { result } = renderHook(() =>
      useWebsiteHandoff({
        post: basePost,
        dealerId: "dealer-1",
        dealer: null,
        imageBusy: false,
        textBusy: false,
        captions: baseCaptions,
      }),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Simulate the image changing (e.g. a regenerate) in the store while the
    // send is prepared — enqueueWebsitePublication must never be called.
    mocks.store.generatedPost = {
      ...basePost,
      image: "data:image/png;base64,Y2hhbmdlZA==",
    };
    mocks.getWebsitePublication.mockResolvedValueOnce({ status: "not_requested" });

    const autosave = stubAutosave();
    await act(async () => {
      await result.current.send({
        autosave,
        deliveryLocked: false,
        deliveryGateMessage: "",
      });
    });

    expect(mocks.enqueueWebsitePublication).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith(
      "The creative changed while the website draft was being prepared. Review it and send again.",
    );
  });

  it("send enqueues with the exact expected revision and persists the result", async () => {
    mocks.getWebsitePublication.mockResolvedValue({ status: "not_requested" });
    mocks.enqueueWebsitePublication.mockResolvedValue({
      status: "waiting_approval",
      websiteDraft,
    });
    const { result } = renderHook(() =>
      useWebsiteHandoff({
        post: basePost,
        dealerId: "dealer-1",
        dealer: null,
        imageBusy: false,
        textBusy: false,
        captions: baseCaptions,
      }),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // "waiting_approval" needs refresh polling, so keep any later
    // getWebsitePublication call (from that effect racing the send) in sync
    // with what the send itself just recorded.
    mocks.getWebsitePublication.mockResolvedValue({ status: "waiting_approval" });

    const autosave = stubAutosave();
    await act(async () => {
      await result.current.send({
        autosave,
        deliveryLocked: false,
        deliveryGateMessage: "",
      });
    });

    expect(autosave.stage).toHaveBeenCalled();
    expect(autosave.flush).toHaveBeenCalled();
    expect(mocks.enqueueWebsitePublication).toHaveBeenCalledWith(
      "post-1",
      expect.objectContaining({ enabled: true }),
      "rev-1",
    );
    expect(result.current.publication?.status).toBe("waiting_approval");
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Final private website draft sent for manager approval.",
    );
    expect(result.current.handoffStarted).toBe(true);
  });

  it("adopts the revision the hand-off claim returns, so the next share receipt is current", async () => {
    // A real store: every write lands where the next read sees it.
    mocks.setGeneratedPost.mockImplementation((next: GeneratedPost) => {
      mocks.store.generatedPost = next;
    });
    mocks.store.generatedPost = { ...basePost, postRevision: "rev-1" };
    mocks.getWebsitePublication.mockResolvedValue({ status: "not_requested" });
    mocks.enqueueWebsitePublication.mockResolvedValue({
      status: "queued",
      websiteDraft,
      post_revision: "rev-2",
    });
    const { result } = renderHook(() =>
      useWebsiteHandoff({
        post: { ...basePost, postRevision: "rev-1" },
        dealerId: "dealer-1",
        dealer: null,
        imageBusy: false,
        textBusy: false,
        captions: baseCaptions,
      }),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    mocks.getWebsitePublication.mockResolvedValue({ status: "queued" });

    await act(async () => {
      await result.current.send({
        autosave: stubAutosave(),
        deliveryLocked: false,
        deliveryGateMessage: "",
      });
    });

    expect(mocks.enqueueWebsitePublication).toHaveBeenCalledWith(
      "post-1",
      expect.objectContaining({ enabled: true }),
      "rev-1",
    );
    expect((mocks.store.generatedPost as GeneratedPost).postRevision).toBe("rev-2");
    expect(mocks.setGeneratedPost).toHaveBeenCalledWith(
      expect.objectContaining({ postId: "post-1", postRevision: "rev-2" }),
      { archive: false },
    );
  });

  it("send refuses when delivery is locked", async () => {
    const { result } = renderHook(() =>
      useWebsiteHandoff({
        post: basePost,
        dealerId: "dealer-1",
        dealer: null,
        imageBusy: false,
        textBusy: false,
        captions: baseCaptions,
      }),
    );
    await act(async () => {
      await Promise.resolve();
    });

    const autosave = stubAutosave();
    await act(async () => {
      await result.current.send({
        autosave,
        deliveryLocked: true,
        deliveryGateMessage: "Delivery locked · Approval pending",
      });
    });

    expect(mocks.toastWarning).toHaveBeenCalledWith(
      "Delivery locked · Approval pending",
    );
    expect(mocks.enqueueWebsitePublication).not.toHaveBeenCalled();
    expect(autosave.flush).not.toHaveBeenCalled();
  });

  it("retry queues another attempt and updates status", async () => {
    mocks.getWebsitePublication.mockResolvedValue({ status: "failed" });
    // "published" is settled, so the result is not immediately overwritten by
    // the needs-status-refresh polling effect racing the assertion below.
    mocks.retryWebsitePublication.mockResolvedValue({ status: "published" });
    const { result } = renderHook(() =>
      useWebsiteHandoff({
        post: basePost,
        dealerId: "dealer-1",
        dealer: null,
        imageBusy: false,
        textBusy: false,
        captions: baseCaptions,
      }),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.retry();
    });

    expect(mocks.retryWebsitePublication).toHaveBeenCalledWith("post-1");
    expect(result.current.publication?.status).toBe("published");
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Private website draft queued again.",
    );
  });
  it("requires a reopen when an enqueue response is lost and the handoff was recorded", async () => {
    mocks.store.generatedPost = { ...basePost, postRevision: "rev-0" };
    mocks.getWebsitePublication.mockResolvedValue({ status: "not_requested" });
    const { result } = renderHook(() =>
      useWebsiteHandoff({
        post: basePost,
        dealerId: "dealer-1",
        dealer: null,
        imageBusy: false,
        textBusy: false,
        captions: baseCaptions,
      }),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    mocks.enqueueWebsitePublication.mockRejectedValue(new TypeError("Failed to fetch"));
    mocks.getWebsitePublication.mockResolvedValue({ status: "ready", websiteDraft });
    await act(async () => {
      await result.current.send({
        autosave: stubAutosave(),
        deliveryLocked: false,
        deliveryGateMessage: "",
      });
    });
    expect(result.current.revisionRecoveryRequired).toBe(true);
    expect(result.current.checkError).toContain("Reopen this post");
    expect(mocks.setGeneratedPost).toHaveBeenCalledWith(
      expect.objectContaining({ postRevision: undefined }),
    );
  });
});
