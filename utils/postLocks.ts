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
 *    then identity, then claims, then release, then approval. The precedence
 *    and every gate are unchanged from the original inline computation. The
 *    image-review, identity, claim-title and approval copy was rewritten in
 *    the salesperson's words for the Post screen; the release title and
 *    message are deliberately untouched (see the note on their two truths).
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
  "save" | "image_review" | "identity" | "claim" | "release" | "approval";

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
  saveStatus?: GeneratedPost["saveStatus"];
  customerDisplayName?: string;
}

export interface PostLocks {
  identityLocked: boolean;
  approvalLocked: boolean;
  releaseLocked: boolean;
  releaseLinkRepairable: boolean;
  claimLocked: boolean;
  deliveryLocked: boolean;
  /** Per-kind banner copy, kept separate for the four independent banners. */
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
    (input.saveStatus !== undefined && input.saveStatus !== "saved") ||
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
      ? `The caption seems to name someone other than ${input.customerDisplayName}. Edit the caption to remove that name, then share.`
      : "The caption names a person who hasn't signed a release. Remove the name or use the customer's first name."
    : "";
  const imageReviewMessage = input.imageReviewRequired
    ? "This image was made before our latest safety check, so it can't be shared or sent for approval. Start a new post from the original photo."
    : "";
  // "Unlocks here" is literal: useApprovalStatus polls the post's status and
  // the lock clears on this screen as soon as a manager approves.
  const approvalMessage =
    input.approvalStatus === "approved"
      ? "Your manager approved this post. You can share it now. To change anything, start a new post."
      : input.approvalStatus === "rejected"
        ? input.rejectionReason
          ? `Your manager asked for a change: ${input.rejectionReason} Start a new post to make it.`
          : "Your manager sent this back. Start a new post with the changes."
        : input.approvalStatus === "submission_failed"
          ? "This post couldn't be sent for approval. Check your connection, then start a new post."
          : "Your manager needs to approve this image and caption. It's saved in My work, and sharing unlocks here as soon as it's approved.";

  // Only a pending post is waiting on anyone; a sent-back or unsent post
  // must not be titled as if it were.
  const approvalLabel =
    input.approvalStatus === "rejected"
      ? "Changes requested"
      : input.approvalStatus === "submission_failed"
        ? "Not sent for approval"
        : "Waiting for approval";

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
          : approvalLabel;
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
    ? "This image needs to be remade"
    : identityLocked
      ? "Check the customer's name"
      : claimLocked
        ? "Caption needs a fix"
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
    primary:
      input.saveStatus !== undefined && input.saveStatus !== "saved"
        ? {
            kind: "save",
            label: "Post not saved",
            title:
              input.saveStatus === "saving"
                ? "Saving your post"
                : "Your post is ready, but not saved",
            message:
              input.saveStatus === "saving"
                ? "Keep this work open while the save finishes."
                : "Your image and caption are still here. Retry saving this same post before sharing; no new AI generation is needed.",
          }
        : { kind, label, title, message },
  };
};
