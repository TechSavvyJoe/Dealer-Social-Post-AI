import type { PostRecord } from "../../services/posts";
import type { PostStatusTone } from "../../utils/postLabels";
import { savedPostIdentityIsSafe } from "../../utils/historyPost";

export const postIsHeld = (
  post: PostRecord,
  grounding: { dealerName?: string; oemAffiliation?: string },
) => Boolean(post.image_review_required || !savedPostIdentityIsSafe(post, grounding));

export const reviewState = (
  post: PostRecord,
  held: boolean,
): { label: string; tone: PostStatusTone } => {
  if (held) return { label: "Held for safety review", tone: "warning" };
  switch (post.approval_status) {
    case "pending":
      return { label: "Waiting for review", tone: "warning" };
    case "approved":
      return { label: "Approved", tone: "success" };
    case "rejected":
      return { label: "Changes requested", tone: "error" };
    default:
      return { label: "Review not required", tone: "neutral" };
  }
};

export const websiteStateLabel = (status?: string) =>
  ({
    not_requested: "Website · Not requested",
    waiting_approval: "Website draft · Waiting for approval",
    queued: "Website draft · Queued",
    delivering: "Website draft · Sending",
    retrying: "Website draft · Retrying",
    draft_ready: "Website draft · Ready for review",
    failed: "Website draft · Failed",
    published: "Website published",
    withdrawn: "Website draft · Withdrawn",
  })[status || "not_requested"] || "Website status unavailable";

/** Matches the History CSV escaping contract and guards spaced formula prefixes. */
const csvCell = (value: string) => {
  const safe = /^[\s]*[=+\-@]|^[\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
};

/** Deliberately excludes caption, customer/VIN data, and all private media/review URLs. */
export const loadedPostMetadataCsv = (
  posts: PostRecord[],
  grounding: { dealerName?: string; oemAffiliation?: string },
) =>
  [
    [
      "post_id",
      "saved_at",
      "updated_at",
      "creator",
      "review",
      "archived",
      "media",
      "website_status",
    ],
    ...posts.map((post) => {
      const held = postIsHeld(post, grounding);
      return [
        post.id,
        post.generated_at || "",
        post.updated || "",
        post.salesperson_name || "",
        reviewState(post, held).label,
        post.archived ? "true" : "false",
        held
          ? "Withheld for safety review"
          : post.has_video
            ? "Video generated; saved clip unavailable"
            : "Photo post",
        held
          ? "Withheld for safety review"
          : websiteStateLabel(post.website_publication?.status),
      ];
    }),
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");
