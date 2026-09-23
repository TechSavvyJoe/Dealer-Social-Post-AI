/**
 * Pure mapping/derivation for History reopen.
 *
 * Extracted verbatim from components/PostHistory.tsx so the reopen mapping
 * and the identity-quarantine gate have one definition, shared by the old
 * History screen and the hooks that will replace it. No behavior changed:
 * see __tests__/rejectionReason.test.ts and
 * __tests__/postOutputProfilePersistence.test.ts for the pinned strings that
 * moved here.
 */
import { ApprovalStatus, PostRecord, PostShareSummary } from "../services/posts";
import { resolveHistoryPlatformIds } from "../services/platformCopy";
import { GeneratedPost, UserRole } from "../types";
import { toPublicCustomerLabel } from "./customerIdentity";
import { captionUsesOnlyExpectedCustomer } from "./captionQuality";
import { stripCanonicalDisclosures } from "./complianceDisclosures";

/**
 * A saved post's caption/copy is safe to reopen or surface in search only
 * when it cannot be read as naming an unauthorized customer. Moved verbatim
 * from components/PostHistory.tsx (savedPostIdentityIsSafe).
 */
export const savedPostIdentityIsSafe = (
  post: PostRecord,
  grounding?: { dealerName?: string; oemAffiliation?: string },
): boolean => {
  if (post.identity_review_required) return false;
  const publicCustomer = toPublicCustomerLabel(post.customer_name);
  const allowedPhrases = [
    grounding?.dealerName,
    grounding?.oemAffiliation,
    post.website_draft?.vehicleDescription,
  ];
  const copy = [
    post.caption,
    ...Object.values(post.platform_captions || {}),
    post.website_draft?.title,
    post.website_draft?.body,
    post.website_draft?.altText,
  ].filter((value): value is string => Boolean(value?.trim()));
  if (
    post.website_draft?.customerDisplayName &&
    post.website_draft.customerDisplayName.normalize("NFKC").trim().toLowerCase() !==
      publicCustomer.toLowerCase()
  ) {
    return false;
  }
  // The record's own salesperson is legitimate in its prose ("Ask for Joe"),
  // never the celebrated customer — the same split the server applies.
  const maskedPhrases = [
    post.salesperson_name,
    toPublicCustomerLabel(post.salesperson_name),
  ];
  // Canonical disclosure material is stripped first, as the server's History
  // projection does: it is fixed legal copy, never a name.
  return copy.every((caption) =>
    captionUsesOnlyExpectedCustomer(
      stripCanonicalDisclosures(caption),
      publicCustomer,
      {
        allowedPhrases,
        maskedPhrases,
        rejectAnyCustomerIdentity: Boolean(post.release_required && !publicCustomer),
      },
    ),
  );
};

export interface ToGeneratedPostOptions {
  role: UserRole;
  currentPersonId: string;
  /** Result of fetchPostCreativeDataUrl(post.creative_image_url). */
  image: string;
}

/**
 * Builds the GeneratedPost a reopened History record hydrates into. Moved
 * verbatim from components/PostHistory.tsx's openCreative — the async image
 * fetch and the store writes stay with the caller (hooks/usePostHistoryList).
 */
export const toGeneratedPostFromRecord = (
  post: PostRecord,
  { role, currentPersonId, image }: ToGeneratedPostOptions,
): GeneratedPost => {
  const approval = (post.approval_status as GeneratedPost["approvalStatus"]) || "n_a";
  return {
    image,
    text: (post.caption || "").trim() || "—",
    customerDisplayName: toPublicCustomerLabel(post.customer_name),
    customerIdentityRequired: Boolean(post.release_required),
    scenarioId: post.scenario_id || undefined,
    captionSource: post.caption_source || undefined,
    isBasicFallback: post.caption_source === "basic_fallback",
    disclosures: post.disclosures || undefined,
    postId: post.id,
    approvalStatus: approval,
    // The reason travels with the rejection, or the reopened result
    // screen falls back to the generic "a manager rejected this" copy
    // and the salesperson is back to guessing what to change.
    rejectionReason: post.rejection_reason || undefined,
    releaseStatus: post.has_release
      ? "saved"
      : post.release_required && post.release_status !== "saved"
        ? "save_failed"
        : "not_required",
    historyReadOnly:
      role !== "salesperson" &&
      (!currentPersonId || post.salesperson_id !== currentPersonId),
    // Preserve an explicit empty selection for Website-only posts while
    // restoring social destinations for records created before
    // platform_ids existed.
    platformIds: resolveHistoryPlatformIds(post.platform_ids, post.platform_captions),
    mediaOutputMode: post.media_output_mode || "photo",
    platformCaptions: post.platform_captions,
    primaryFormatId: post.primary_format_id || undefined,
    imageAspectRatio: post.image_aspect_ratio || undefined,
    websiteDraft: post.website_draft,
    websitePublication: post.website_publication,
    // `image_review_required` is computed by the backend against the
    // current model policy. Persist the explicit safe result so a direct
    // private-session restore does not mistake this reviewed record for
    // an unversioned legacy creative.
    imageReviewRequired: false,
  };
};

export type HistoryPostStatus =
  "shared" | "waiting" | "changes" | "draft" | "review_blocked";

/**
 * The minimal shape postStatusFor needs — a subset of PostRecord, so a
 * PostRecord from the History list passes straight in. `share_summary` is the
 * derived summary GET /api/app/posts projects from `post_share_events`; only
 * its count decides the status.
 */
export interface HistoryPostStatusInput {
  approval_status?: ApprovalStatus;
  identity_review_required?: boolean;
  image_review_required?: boolean;
  share_summary?: Pick<PostShareSummary, "count"> | null;
}

/**
 * A single, human status for a saved post, most-authoritative condition
 * first: a quarantined creative or caption always reads as blocked, a
 * manager's rejection always reads as "changes requested" even if the post
 * was shared before that rejection, and only then does an outstanding
 * approval or a share record decide the label.
 */
export const postStatusFor = (record: HistoryPostStatusInput): HistoryPostStatus => {
  if (record.identity_review_required || record.image_review_required) {
    return "review_blocked";
  }
  if (record.approval_status === "rejected") return "changes";
  if (record.approval_status === "pending") return "waiting";
  if (record.share_summary && record.share_summary.count > 0) return "shared";
  return "draft";
};
