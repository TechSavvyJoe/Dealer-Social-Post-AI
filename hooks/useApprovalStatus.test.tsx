import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GeneratedPost } from "../types";

const mocks = vi.hoisted(() => ({
  getPostApprovalStatus: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock("../services/posts", () => ({
  getPostApprovalStatus: mocks.getPostApprovalStatus,
}));

vi.mock("../components/ui/Toast", () => ({
  useToast: () => ({
    success: mocks.toastSuccess,
    warning: mocks.toastWarning,
    error: vi.fn(),
  }),
}));

import { useApprovalStatus } from "./useApprovalStatus";

const basePost: GeneratedPost = {
  image: "data:image/png;base64,aW1hZ2U=",
  text: "Caption",
  captionSource: "ai",
  isBasicFallback: false,
  postId: "post-1",
};

describe("useApprovalStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.getPostApprovalStatus.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.toastWarning.mockReset();
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("is not review-required when the post never needed approval", () => {
    const { result } = renderHook(() =>
      useApprovalStatus({
        post: { ...basePost, approvalStatus: "n_a" },
        requiresApproval: false,
      }),
    );
    expect(result.current.reviewRequired).toBe(false);
    expect(result.current.approvalStatus).toBe("n_a");
    expect(mocks.getPostApprovalStatus).not.toHaveBeenCalled();
  });

  it("polls every 10 s while pending, and pauses while the tab is hidden", async () => {
    mocks.getPostApprovalStatus.mockResolvedValue({
      approval_status: "pending",
      image_review_required: false,
    });
    renderHook(() =>
      useApprovalStatus({
        post: { ...basePost, approvalStatus: "pending" },
        requiresApproval: true,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.getPostApprovalStatus).toHaveBeenCalledTimes(1);

    // Hide the tab: the next scheduled check must reschedule without calling
    // the network, then resume once visible again.
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(mocks.getPostApprovalStatus).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(mocks.getPostApprovalStatus).toHaveBeenCalledTimes(2);
  });

  it("toasts the verbatim approve message and stops polling once approved", async () => {
    mocks.getPostApprovalStatus.mockResolvedValue({
      approval_status: "approved",
      image_review_required: false,
    });
    const { result } = renderHook(() =>
      useApprovalStatus({
        post: { ...basePost, approvalStatus: "pending" },
        requiresApproval: true,
      }),
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.approvalStatus).toBe("approved");
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Manager approved this post. Delivery is unlocked.",
    );

    mocks.getPostApprovalStatus.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(mocks.getPostApprovalStatus).not.toHaveBeenCalled();
  });

  it("toasts the verbatim rejection reason and stores it", async () => {
    mocks.getPostApprovalStatus.mockResolvedValue({
      approval_status: "rejected",
      rejection_reason: "Pricing needs a disclosure",
      image_review_required: false,
    });
    const { result } = renderHook(() =>
      useApprovalStatus({
        post: { ...basePost, approvalStatus: "pending" },
        requiresApproval: true,
      }),
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.approvalStatus).toBe("rejected");
    expect(result.current.rejectionReason).toBe("Pricing needs a disclosure");
    expect(mocks.toastWarning).toHaveBeenCalledWith(
      "Manager asked for a change: Pricing needs a disclosure",
    );
  });

  it("aborts the in-flight request on unmount", async () => {
    let capturedSignal: AbortSignal | undefined;
    mocks.getPostApprovalStatus.mockImplementation(
      (_id: string, signal: AbortSignal) => {
        capturedSignal = signal;
        return new Promise(() => {});
      },
    );
    const { unmount } = renderHook(() =>
      useApprovalStatus({
        post: { ...basePost, approvalStatus: "pending" },
        requiresApproval: true,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(capturedSignal?.aborted).toBe(false);
    unmount();
    expect(capturedSignal?.aborted).toBe(true);
  });
});
