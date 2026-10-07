import { useEffect, useState } from "react";
import { getPostApprovalStatus } from "../services/posts";
import { useAppStore } from "../stores/appStore";
import { adoptPostRevision } from "../utils/postRevision";
import { useToast } from "../components/ui/Toast";
import type { GeneratedPost } from "../types";

export interface UseApprovalStatusOptions {
  post: GeneratedPost;
  requiresApproval: boolean;
}

export interface UseApprovalStatusResult {
  /** True when this exact creative must clear manager review before delivery. */
  reviewRequired: boolean;
  approvalStatus: NonNullable<GeneratedPost["approvalStatus"]>;
  /** What the manager asked to be changed. Verbatim, may be empty. */
  rejectionReason: string;
  imageReviewRequired: boolean;
  approvalCheckError: string | null;
}

/**
 * Approval polling extracted verbatim from components/PostResult.tsx.
 *
 * Polls every 10 s while `reviewRequired && approvalStatus === "pending"`,
 * pauses while `document.hidden`, aborts on unmount. The approve/reject
 * toasts are verbatim, and the rejection reason is shown verbatim.
 */
export const useApprovalStatus = ({
  post,
  requiresApproval,
}: UseApprovalStatusOptions): UseApprovalStatusResult => {
  const toast = useToast();
  const [rejectionReason, setRejectionReason] = useState<string>(
    post.rejectionReason || "",
  );
  const [approvalStatus, setApprovalStatus] = useState<
    NonNullable<GeneratedPost["approvalStatus"]>
  >(
    post.approvalStatus ??
      (requiresApproval ? (post.postId ? "pending" : "submission_failed") : "n_a"),
  );
  const [approvalCheckError, setApprovalCheckError] = useState<string | null>(null);
  const [imageReviewRequired, setImageReviewRequired] = useState(
    Boolean(post.imageReviewRequired),
  );

  const reviewRequired =
    post.approvalStatus !== undefined
      ? post.approvalStatus !== "n_a"
      : requiresApproval;

  useEffect(() => {
    setApprovalStatus(
      post.approvalStatus ??
        (requiresApproval ? (post.postId ? "pending" : "submission_failed") : "n_a"),
    );
    setApprovalCheckError(null);
    setImageReviewRequired(Boolean(post.imageReviewRequired));
  }, [post.postId, post.approvalStatus, post.imageReviewRequired, requiresApproval]);

  useEffect(() => {
    if (!reviewRequired || approvalStatus !== "pending" || !post.postId) {
      return;
    }

    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let active = true;

    const schedule = () => {
      if (active) timeoutId = setTimeout(checkStatus, 10000);
    };
    const checkStatus = async () => {
      if (!active) return;
      if (typeof document !== "undefined" && document.hidden) {
        schedule();
        return;
      }
      const before = useAppStore.getState();
      const observed = {
        revision: before.generatedPost?.postRevision,
        authEpoch: before.authEpoch,
      };
      try {
        const result = await getPostApprovalStatus(
          post.postId as string,
          controller.signal,
        );
        if (!active || useAppStore.getState().authEpoch !== observed.authEpoch) return;
        const current = useAppStore.getState().generatedPost;
        if (
          current &&
          current.postId === post.postId &&
          current.postRevision !== observed.revision
        ) {
          schedule();
          return;
        }
        // A manager decision advances the post revision. This post left the
        // n_a state, so its content is immutable and the new token is safe to
        // adopt for share receipts.
        if (result.approval_status !== "n_a") {
          adoptPostRevision(post.postId as string, result.post_revision, observed);
        }
        setApprovalCheckError(null);
        setImageReviewRequired(Boolean(result.image_review_required));
        setApprovalStatus(result.approval_status);
        setRejectionReason(result.rejection_reason || "");
        if (result.approval_status === "approved") {
          toast.success("Your manager approved this post. You can share it now.");
          return;
        }
        if (result.approval_status === "rejected") {
          toast.warning(
            result.rejection_reason
              ? `Manager asked for a change: ${result.rejection_reason}`
              : "Your manager sent this back. Start a new post with the changes.",
          );
          return;
        }
        schedule();
      } catch (err) {
        if (!active || (err instanceof DOMException && err.name === "AbortError")) {
          return;
        }
        setApprovalCheckError(
          "Approval status could not be refreshed. We’ll keep checking.",
        );
        schedule();
      }
    };

    void checkStatus();
    return () => {
      active = false;
      controller.abort();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [approvalStatus, post.postId, reviewRequired, toast]);

  return {
    reviewRequired,
    approvalStatus,
    rejectionReason,
    imageReviewRequired,
    approvalCheckError,
  };
};
