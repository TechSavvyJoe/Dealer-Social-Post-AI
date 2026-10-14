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
 * Server-derived ownership. `salesperson_id` was client-selectable on older
 * posts, so a matching display id is not permission to edit or archive.
 */
export const isAuthoritativePostOwner = (
  post: Pick<PostRecord, "attribution_authoritative" | "owner_person_id">,
  personId?: string,
): boolean =>
  Boolean(
    personId && post.attribution_authoritative && post.owner_person_id === personId,
  );

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
    postRevision: post.updated || undefined,
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
      role !== "salesperson" && !isAuthoritativePostOwner(post, currentPersonId),
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
  | "shared"
  | "downloaded"
  | "copied"
  | "waiting"
  | "changes"
  | "draft"
  | "review_blocked";

/**
 * The part of the server's share summary the status reads. Only `count` is
 * required so an older backend's (or a test's) partial summary still passes.
 */
export type HistoryShareSummaryInput = Pick<PostShareSummary, "count"> &
  Partial<
    Pick<
      PostShareSummary,
      | "last_via"
      | "last_channel"
      | "last_shared_at"
      | "sheet_count"
      | "last_sheet_channel"
      | "last_sheet_at"
    >
  >;

/**
 * The minimal shape postStatusFor needs — a subset of PostRecord, so a
 * PostRecord from the History list passes straight in. `share_summary` is the
 * derived summary GET /api/app/posts projects from `post_share_events`.
 */
export interface HistoryPostStatusInput {
  approval_status?: ApprovalStatus;
  identity_review_required?: boolean;
  image_review_required?: boolean;
  share_summary?: HistoryShareSummaryInput | null;
}

/**
 * Only a completed share sheet may be called "Shared"; a download or a copied
 * caption is not one (amendment B1). The server counts share-sheet events
 * apart from the latest event, so a copy made after a share cannot hide it.
 * An older backend that does not send that count is judged by its latest
 * event alone.
 */
export const wasSentToShareSheet = (summary: HistoryShareSummaryInput): boolean =>
  typeof summary.sheet_count === "number"
    ? summary.sheet_count > 0
    : summary.last_via === "share_sheet";

/**
 * The destination and time behind a post's share status: the latest
 * share-sheet event when there is one, otherwise the latest event (the
 * download or copy the status names). Empty strings when unknown.
 */
export const shareStatusDetail = (
  summary: HistoryShareSummaryInput,
): { channel: string; at: string } =>
  typeof summary.sheet_count === "number" && summary.sheet_count > 0
    ? { channel: summary.last_sheet_channel || "", at: summary.last_sheet_at || "" }
    : { channel: summary.last_channel || "", at: summary.last_shared_at || "" };

/**
 * A single, human status for a saved post, most-authoritative condition
 * first: a quarantined creative or caption always reads as blocked, a
 * manager's rejection always reads as "changes requested" even if the post
 * was shared before that rejection, and only then does an outstanding
 * approval or a share record decide the label. A share record reads as
 * "shared" only for the share sheet; a download or a copied caption keeps its
 * own name.
 */
export const postStatusFor = (record: HistoryPostStatusInput): HistoryPostStatus => {
  if (record.identity_review_required || record.image_review_required) {
    return "review_blocked";
  }
  if (record.approval_status === "rejected") return "changes";
  if (record.approval_status === "pending") return "waiting";
  const summary = record.share_summary;
  if (!summary) return "draft";
  if (wasSentToShareSheet(summary)) return "shared";
  if (summary.count > 0 && summary.last_via === "download") return "downloaded";
  if (summary.count > 0 && summary.last_via === "copy") return "copied";
  return "draft";
};
