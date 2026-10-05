/**
 * Plain-words status for a post's private dealership-website draft, ported
 * from the retired result screen (PostResult.tsx `websitePublicationCopy`,
 * `friendlyWebsiteDeliveryError` and `websitePrivacyFlagCopy`).
 *
 * The one rule this copy keeps: nothing here says the post is public unless
 * Customer Hub reports `published`. Every other state is a private draft.
 */
import type {
  WebsitePrivacyFlag,
  WebsitePublication,
} from "../services/websitePublishing";

export type WebsiteStatusTone = "neutral" | "info" | "warning" | "success" | "error";

export interface WebsiteStatusCopy {
  title: string;
  detail: string;
  tone: WebsiteStatusTone;
}

const websiteErrorDetail = (code?: string): string => {
  switch ((code || "").trim()) {
    case "destination_rejected_payload":
    case "destination_image_rejected":
      return "Customer Hub couldn't accept the image, so nothing was published. Check the post, then try again.";
    case "queue_unavailable":
    case "destination_unavailable":
      return "The website connection is down for now. Your post is still saved.";
    case "approval_pending":
      return "Your manager needs to approve this post before the draft can be sent.";
    case "release_pending":
      return "The photo release has to finish saving before this draft can be sent.";
    default:
      return "The private draft didn't send. Your post is still saved, so it's safe to try again.";
  }
};

export const websiteStatusCopy = (
  publication: WebsitePublication | undefined,
  hasSavedPost = true,
): WebsiteStatusCopy => {
  switch (publication?.status) {
    case "not_requested":
      return {
        title: "Not sent yet",
        detail:
          "Send one private draft when the post looks right. Nothing is public until it's published in Customer Hub.",
        tone: "neutral",
      };
    case "waiting_approval":
      return {
        title: "Waiting for approval",
        detail: "The private draft is sent after your manager approves this post.",
        tone: "warning",
      };
    case "queued":
    case "retrying":
      return {
        title: "Draft queued",
        detail: "It's lined up to send. Nothing is public yet.",
        tone: "info",
      };
    case "delivering":
      return {
        title: "Sending the private draft",
        detail: "Customer Hub is receiving it. Nothing is public yet.",
        tone: "info",
      };
    case "draft_ready":
      return publication.lastError
        ? {
            title: "Draft ready, status not confirmed",
            detail:
              "The draft is safe. Check the status again once you're back online.",
            tone: "warning",
          }
        : {
            title: "Private draft ready",
            detail: "Review it in Customer Hub, then publish it there.",
            tone: "success",
          };
    case "published":
      return {
        title: "Published on the website",
        detail: "Customer Hub says this post is public.",
        tone: "success",
      };
    case "failed":
      return hasSavedPost
        ? {
            title: "Draft didn't send",
            detail: websiteErrorDetail(publication.lastError),
            tone: "error",
          }
        : {
            title: "Post not saved",
            detail: "This post never saved. Start a new one when you're online.",
            tone: "error",
          };
    case "withdrawn":
      return {
        title: "Draft withdrawn",
        detail: "It's no longer queued or public.",
        tone: "neutral",
      };
    default:
      return {
        title: "Private website draft",
        detail: "Nothing is public until it's published in Customer Hub.",
        tone: "neutral",
      };
  }
};

const PRIVACY_FLAG_COPY: Record<WebsitePrivacyFlag, string> = {
  faces_visible: "faces",
  license_plate_visible: "license plates",
  personal_information_visible: "personal information",
  minor_may_be_visible: "children",
  review_visual_privacy: "anything private",
};

/**
 * The advisory privacy note for a website draft, or null when the draft has
 * no flags. Unknown flags are ignored; the note never claims anything was
 * found, only what to look for.
 */
export const websitePrivacyNote = (
  flags: readonly string[] | undefined,
): string | null => {
  const items = Array.from(
    new Set(
      (flags || [])
        .map((flag) => PRIVACY_FLAG_COPY[flag as WebsitePrivacyFlag])
        .filter((item): item is string => Boolean(item)),
    ),
  );
  if (items.length === 0) return null;
  const list =
    items.length === 1
      ? items[0]
      : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
  return `Review the entire image for ${list} before it goes on the website.`;
};
