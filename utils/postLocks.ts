/**
 * Pure delivery-lock derivation extracted from components/PostResult.tsx.
 *
 * This module owns two things that used to live inline in the result screen:
 *
 * 1. `checkCaptionIdentity` — the single wrapper around
 *    `captionUsesOnlyExpectedCustomer` (utils/captionQuality.ts) that supplies
 *    the dealership's allowed phrases and the salesperson's masked phrases.
 *    The bare `captionUsesOnlyExpectedCustomer` must never be called directly
 *    by a screen; every caller goes through this wrapper so the allowed/masked
 *    phrase rules cannot drift between call sites.
 *
 * 2. `derivePostLocks` — the delivery-lock precedence ladder: image review,
 *    then identity, then claims, then release, then approval. Every message
 *    below is copied verbatim from the original inline computation; no wording
 *    changed in this extraction.
 */
import type { GeneratedPost } from "../types";
import {
  prohibitedClaimsMessage,
  stripCanonicalDisclosures,
  type DisclosureMatch,
} from "./complianceDisclosures";
import { captionUsesOnlyExpectedCustomer } from "./captionQuality";
import { toPublicCustomerLabel } from "./customerIdentity";

/** Inputs the identity-guard wrapper needs to evaluate one caption. */
export interface CaptionIdentityContext {
  /** Public-safe customer label the caption is allowed to celebrate. */
  customerDisplayName?: string;
  dealerName?: string;
  oemAffiliation?: string;
  vehicleDescription?: string;
  /** The signed-in salesperson's name — legitimate in prose, never the celebrated customer. */
  currentPersonName?: string;
  customerIdentityRequired?: boolean;
  /** True when the website draft's kind is "customer_story". */
  isCustomerStory?: boolean;
}

/**
 * The identity-guard wrapper (formerly PostResult.tsx's inline
 * `customerIdentityIsSafe`): allowedPhrases = dealer name/OEM/vehicle
 * description, maskedPhrases = salesperson name + first name. Canonical
 * disclosure material is stripped first, as the server's share route does.
 */
export const checkCaptionIdentity = (
  caption: string,
  context: CaptionIdentityContext,
): boolean =>
  captionUsesOnlyExpectedCustomer(
    stripCanonicalDisclosures(caption),
    context.customerDisplayName,
    {
      allowedPhrases: [
        context.dealerName,
        context.oemAffiliation,
        context.vehicleDescription,
      ],
      maskedPhrases: [
        context.currentPersonName,
        toPublicCustomerLabel(context.currentPersonName),
      ],
      rejectAnyCustomerIdentity: Boolean(
        (context.customerIdentityRequired || context.isCustomerStory) &&
        !toPublicCustomerLabel(context.customerDisplayName),
      ),
    },
  );

/** True when any caption in the set fails the identity guard. */
export const deriveIdentityLocked = (
  captions: string[],
  context: CaptionIdentityContext,
): boolean => captions.some((caption) => !checkCaptionIdentity(caption, context));

export type PostLockKind =
  "image_review" | "identity" | "claim" | "release" | "approval";

export interface PostLockReason {
  kind: PostLockKind;
  /** The compact ladder value shown in the action bar ("Delivery locked · {label}"). */
  label: string;
  /** The full banner heading for this kind. */
  title: string;
  /** The full explanatory sentence for this kind. */
  message: string;
}

export interface DerivePostLocksInput {
  /** [currentPrimaryCaption, ...variants] exactly as the original identityLocked memo built it. */
  captions: string[];
  identity: CaptionIdentityContext;
  /** captionSetAnalysis.prohibited */
  prohibited: DisclosureMatch[];
  imageReviewRequired: boolean;
  reviewRequired: boolean;
  approvalStatus: GeneratedPost["approvalStatus"];
  rejectionReason: string;
  releaseStatus: GeneratedPost["releaseStatus"];
  releaseLinkStatus: GeneratedPost["releaseLinkStatus"];
  releaseId?: string;
  postId?: string;
  customerDisplayName?: string;
}

export interface PostLocks {
  identityLocked: boolean;
  approvalLocked: boolean;
  releaseLocked: boolean;
  releaseLinkRepairable: boolean;
  claimLocked: boolean;
  deliveryLocked: boolean;
  /** Verbatim per-kind banner copy, preserved for the four independent banners. */
  imageReviewMessage: string;
  identityMessage: string;
  claimMessage: string;
  releaseTitle: string;
  releaseMessage: string;
  approvalMessage: string;
  /** The single precedence-selected reason (action bar label/toasts). */
  primary: PostLockReason;
}

export const derivePostLocks = (input: DerivePostLocksInput): PostLocks => {
  const identityLocked = deriveIdentityLocked(input.captions, input.identity);
  const approvalLocked = input.reviewRequired && input.approvalStatus !== "approved";
  // The gate itself is unchanged: delivery stays locked for BOTH release
  // failures. Only the explanation and the remedy differ below.
  const releaseLocked = input.releaseStatus === "save_failed";
  /**
   * The recoverable variant: the customer's signature is durably stored on the
   * server and only its association with this post is missing, so both ids
   * needed to repair it are already in hand.
   */
  const releaseLinkRepairable =
    releaseLocked &&
    input.releaseLinkStatus === "link_failed" &&
    Boolean(input.releaseId) &&
    Boolean(input.postId);
  const claimLocked = input.prohibited.length > 0;
  const deliveryLocked =
    input.imageReviewRequired ||
    approvalLocked ||
    releaseLocked ||
    claimLocked ||
    identityLocked;

  // Two different failures, two different truths. The harsher wording is
  // reserved for the case where consent may genuinely be missing; claiming a
  // stored signature "was not stored" sent salespeople back to customers who
  // had already driven away.
  const releaseTitle = releaseLinkRepairable
    ? "Photo release not attached yet"
    : "Photo release not saved";
  const releaseMessage = releaseLinkRepairable
    ? "The customer's signed release was captured and saved — nothing needs to be signed again. Only its link to this post did not finish, so copy, share, save, and export stay locked until it does. Retry saving the release below."
    : "The signed photo release was not stored, so consent cannot be verified. Copy, share, save, and export remain locked; check your connection and create another post to retry.";
  const claimMessage = claimLocked ? prohibitedClaimsMessage(input.prohibited) : "";
  const identityMessage = identityLocked
    ? input.customerDisplayName
      ? `This copy appears to name someone other than ${input.customerDisplayName}. Correct every caption before saving, copying, scheduling, sharing, or sending it to the website.`
      : "This customer-required copy includes a name without an approved public customer label. Remove the name or add the approved customer first name before delivery."
    : "";
  const imageReviewMessage = input.imageReviewRequired
    ? "This saved image predates the current on-pixel customer-name, logo, and source-fidelity review. It cannot be copied, saved, shared, scheduled, approved, or sent to the website. Create a new post from the original photo."
    : "";
  const approvalMessage =
    input.approvalStatus === "approved"
      ? "Manager approved this exact creative. Save, share, and export are unlocked; start a new post to make changes."
      : input.approvalStatus === "rejected"
        ? input.rejectionReason
          ? `A manager asked for a change: ${input.rejectionReason} Delivery stays locked until you create another post.`
          : "A manager rejected this creative. Delivery remains locked; create another post with the requested changes."
        : input.approvalStatus === "submission_failed"
          ? "This creative could not be submitted for approval. Delivery remains locked; check your connection and create another post to retry."
          : "This exact image and caption are awaiting manager approval. Save, share, and export unlock automatically after approval.";

  const message = input.imageReviewRequired
    ? imageReviewMessage
    : identityLocked
      ? identityMessage
      : claimLocked
        ? claimMessage
        : releaseLocked
          ? releaseMessage
          : approvalMessage;
  const label = input.imageReviewRequired
    ? "Image review required"
    : identityLocked
      ? "Customer blocked"
      : claimLocked
        ? "Claim blocked"
        : releaseLocked
          ? releaseLinkRepairable
            ? "Release not attached"
            : "Release not saved"
          : "Approval pending";
  const kind: PostLockKind = input.imageReviewRequired
    ? "image_review"
    : identityLocked
      ? "identity"
      : claimLocked
        ? "claim"
        : releaseLocked
          ? "release"
          : "approval";
  const title = input.imageReviewRequired
    ? "Image safety review required"
    : identityLocked
      ? "Customer name blocked"
      : claimLocked
        ? "Caption claim blocked"
        : releaseLocked
          ? releaseTitle
          : label;

  return {
    identityLocked,
    approvalLocked,
    releaseLocked,
    releaseLinkRepairable,
    claimLocked,
    deliveryLocked,
    imageReviewMessage,
    identityMessage,
    claimMessage,
    releaseTitle,
    releaseMessage,
    approvalMessage,
    primary: { kind, label, title, message },
  };
};
