/**
 * Post-log client. After the 1748000400 rule lockdown, the `posts` PocketBase
 * collection is locked from direct REST access. The frontend goes through
 * session-gated `/api/app/posts*` endpoints. The server forces the `dealer`
 * field from the dealer_session cookie, so the client never has to (and never
 * gets to) pick which dealership a post is logged against.
 *
 * Filters on the read endpoints use PocketBase's `filterParams` (the
 * `{:name}` form) server-side — no string interpolation, no injection.
 */

import { dataUrlToBlob } from "../utils/imageUtils";
import { assertAuthEpoch, captureAuthEpoch } from "../utils/authBoundary";
import type { ImageAspectRatio, MediaOutputMode, PrimaryImageFormatId } from "../types";
import { readApiError } from "./apiErrors";
import type { WebsiteDraft, WebsitePublication } from "./websitePublishing";

export type ApprovalStatus = "n_a" | "pending" | "approved" | "rejected";

export interface LogPostInput {
  /** Kept for backwards compat; ignored — the server uses the session dealer. */
  dealerId?: string;
  salespersonName?: string;
  /** Optional FK to the salespeople collection (preferred over free-text name). */
  salespersonId?: string;
  style?: string;
  tone?: string;
  customerName?: string;
  scenarioId?: string;
  vin?: string;
  hasRelease?: boolean;
  hasVideo?: boolean;
  /** When the dealer requires manager approval, log post as 'pending'. */
  requiresApproval?: boolean;
  /** The exact review copy submitted to the manager. */
  caption?: string;
  disclosures?: string;
  /** The exact generated image submitted for review. */
  imageDataUrl?: string;
  /** Prompt-free generation provenance used only for aggregate diagnostics. */
  captionSource?: "ai" | "custom" | "basic_fallback";
  generationTier?: "standard" | "studio";
  generationModel?: string;
  generationFallbackCount?: number;
  generationLastSuccessAt?: string;
  modelPolicyVersion?: string;
  /** Opaque server-event correlations; not credentials and never user-visible. */
  captionAttemptId?: string;
  imageAttemptId?: string;
  /** Selected destinations and authoritative output canvas for History reopen. */
  platformIds?: string[];
  mediaOutputMode?: MediaOutputMode;
  platformCaptions?: Record<string, string>;
  primaryFormatId?: PrimaryImageFormatId;
  imageAspectRatio?: ImageAspectRatio;
  /** ISO timestamp for when this post should be published */
  scheduledFor?: string;
  /** Private Customer Hub draft metadata; server controls any delivery. */
  websiteDraft?: WebsiteDraft;
}

export interface PostRecord {
  id: string;
  dealer: string;
  salesperson_name?: string;
  /** Optional FK to the salespeople collection — preferred over the free-text name when present. */
  salesperson_id?: string;
  /** True only for server-derived ownership; legacy display attribution is untrusted. */
  attribution_authoritative?: boolean;
  generated_at: string;
  style?: string;
  tone?: string;
  customer_name?: string;
  scenario_id?: string;
  vin?: string;
  has_release?: boolean;
  release_required?: boolean;
  release_status?: "not_required" | "pending" | "saved";
  has_video?: boolean;
  approval_status?: ApprovalStatus;
  approved_by?: string;
  approved_at?: string;
  caption?: string;
  caption_source?: "ai" | "custom" | "basic_fallback" | null;
  disclosures?: string;
  /** Validated destination/output profile captured when this creative was made. */
  platform_ids?: string[];
  media_output_mode?: MediaOutputMode;
  platform_captions?: Record<string, string>;
  primary_format_id?: PrimaryImageFormatId;
  image_aspect_ratio?: ImageAspectRatio;
  /** Session-authorized route; never a public PocketBase file URL. */
  creative_image_url?: string;
  scheduled_for?: string;
  website_draft?: WebsiteDraft;
  website_publication?: WebsitePublication;
}

export interface PostApprovalStatus {
  id: string;
  approval_status: ApprovalStatus;
  approved_by?: string;
  approved_at?: string;
}

export interface PostVideoStatus {
  id: string;
  has_video: true;
}

export interface UpdatePostDraftInput {
  caption: string;
  disclosures?: string;
  imageDataUrl?: string;
  platformCaptions?: Record<string, string>;
}

const jsonRequest = async <T>(url: string, init: RequestInit = {}): Promise<T> => {
  const requestAuthEpoch = captureAuthEpoch();
  assertAuthEpoch(requestAuthEpoch);
  const res = await fetch(url, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    throw await readApiError(res, { requestAuthEpoch });
  }
  const body = (await res.json()) as T;
  assertAuthEpoch(requestAuthEpoch);
  return body;
};

export const logPost = async (
  input: LogPostInput,
  requestAuthEpoch: number = captureAuthEpoch(),
): Promise<PostRecord | null> => {
  assertAuthEpoch(requestAuthEpoch);
  try {
    const form = new FormData();
    form.append("salesperson_name", input.salespersonName || "");
    form.append("salesperson_id", input.salespersonId || "");
    form.append("style", input.style || "");
    form.append("tone", input.tone || "");
    form.append("customer_name", input.customerName || "");
    form.append("scenario_id", input.scenarioId || "");
    form.append("vin", input.vin || "");
    form.append("has_release", input.hasRelease ? "true" : "false");
    form.append("has_video", input.hasVideo ? "true" : "false");
    if (input.captionSource) {
      form.append("caption_source", input.captionSource);
    }
    if (input.generationTier) {
      form.append("generation_tier", input.generationTier);
    }
    if (input.generationModel) {
      form.append("generation_model", input.generationModel);
    }
    if (typeof input.generationFallbackCount === "number") {
      form.append("generation_fallback_count", String(input.generationFallbackCount));
    }
    if (input.generationLastSuccessAt) {
      form.append("generation_last_success_at", input.generationLastSuccessAt);
    }
    if (input.modelPolicyVersion) {
      form.append("model_policy_version", input.modelPolicyVersion);
    }
    if (input.captionAttemptId) {
      form.append("caption_attempt_id", input.captionAttemptId);
    }
    if (input.imageAttemptId) {
      form.append("image_attempt_id", input.imageAttemptId);
    }
    if (Array.isArray(input.platformIds)) {
      form.append("platform_ids", JSON.stringify(input.platformIds));
    }
    if (input.mediaOutputMode) {
      form.append("media_output_mode", input.mediaOutputMode);
    }
    if (input.platformCaptions && Object.keys(input.platformCaptions).length > 0) {
      form.append("platform_captions", JSON.stringify(input.platformCaptions));
    }
    if (input.primaryFormatId) {
      form.append("primary_format_id", input.primaryFormatId);
    }
    if (input.imageAspectRatio) {
      form.append("image_aspect_ratio", input.imageAspectRatio);
    }
    if (input.scheduledFor) {
      form.append("scheduled_for", input.scheduledFor);
    }
    if (input.websiteDraft?.enabled) {
      form.append("website_draft", JSON.stringify(input.websiteDraft));
    }

    // Persist caption + creative whenever available so History can reopen
    // for re-share/export without regenerating. Approval-gated posts still
    // require both fields (server enforces).
    if (input.caption?.trim()) {
      form.append("caption", input.caption.trim());
    }
    if (input.disclosures?.trim()) {
      form.append("disclosures", input.disclosures.trim());
    }
    if (input.imageDataUrl) {
      const image = await dataUrlToBlob(input.imageDataUrl);
      const extension =
        image.type === "image/png"
          ? "png"
          : image.type === "image/webp"
            ? "webp"
            : "jpg";
      form.append("creative_image", image, `post-creative.${extension}`);
    } else if (input.requiresApproval) {
      throw new Error("Approval submission is missing its creative");
    }
    if (input.requiresApproval && !input.caption?.trim()) {
      throw new Error("Approval submission is missing its creative");
    }

    assertAuthEpoch(requestAuthEpoch);
    const res = await fetch("/api/app/posts", {
      method: "POST",
      credentials: "include",
      body: form,
    });
    if (!res.ok) {
      throw await readApiError(res, { requestAuthEpoch });
    }
    const post = (await res.json()) as PostRecord;
    assertAuthEpoch(requestAuthEpoch);
    return post;
  } catch (err) {
    // For approval-gated posts, a failed persist means the manager has nothing
    // to review — the caller MUST know so it can lock share/save and alert.
    if (input.requiresApproval) throw err;
    // Non-approval posts: preserve the user's flow but log clearly.
    console.warn("[posts.logPost] non-fatal persist failure", err);
    return null;
  }
};

/**
 * Read the approval state for a post submitted by this browser session. The
 * server binds the post to a hash of the opaque session token, so knowing a
 * post id alone is insufficient.
 */
export const getPostApprovalStatus = async (
  postId: string,
  signal?: AbortSignal,
): Promise<PostApprovalStatus> =>
  jsonRequest<PostApprovalStatus>(
    `/api/app/posts/${encodeURIComponent(postId)}/status`,
    { signal },
  );

/** Mark a completed render on the owner-scoped post record (idempotent). */
export const markPostVideoGenerated = async (
  postId: string,
): Promise<PostVideoStatus> =>
  jsonRequest<PostVideoStatus>(
    `/api/app/posts/${encodeURIComponent(postId)}/video-generated`,
    { method: "POST" },
  );

/**
 * Persist the latest non-approval draft so My Work reopens what the
 * salesperson actually edited, saved, and shared instead of the first model
 * response. The server revalidates ownership and compliance.
 */
export const updatePostDraft = async (
  postId: string,
  input: UpdatePostDraftInput,
): Promise<{ id: string; updated: true; post_revision: string }> => {
  const requestAuthEpoch = captureAuthEpoch();
  const form = new FormData();
  form.append("caption", input.caption.trim());
  form.append("disclosures", input.disclosures?.trim() || "");
  form.append("platform_captions", JSON.stringify(input.platformCaptions || {}));
  if (input.imageDataUrl) {
    const image = await dataUrlToBlob(input.imageDataUrl);
    const extension =
      image.type === "image/png" ? "png" : image.type === "image/webp" ? "webp" : "jpg";
    form.append("creative_image", image, `post-creative.${extension}`);
  }
  assertAuthEpoch(requestAuthEpoch);
  const res = await fetch(`/api/app/posts/${encodeURIComponent(postId)}/draft`, {
    method: "PATCH",
    credentials: "include",
    cache: "no-store",
    body: form,
  });
  if (!res.ok) {
    throw await readApiError(res, { requestAuthEpoch });
  }
  const updated = (await res.json()) as {
    id: string;
    updated: true;
    post_revision: string;
  };
  if (!updated.post_revision) {
    throw new Error("Saved draft response did not include its server revision");
  }
  assertAuthEpoch(requestAuthEpoch);
  return updated;
};

/** Set a scheduled publication timestamp on the owner-scoped post record. */
export const schedulePost = async (
  postId: string,
  scheduledFor: string,
): Promise<{ id: string; scheduled_for: string }> =>
  jsonRequest<{ id: string; scheduled_for: string }>(
    `/api/app/posts/${encodeURIComponent(postId)}/schedule`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduled_for: scheduledFor }),
    },
  );

/**
 * Load a stored creative image as a data URL (session-authenticated).
 * Used by History → reopen for share/export without regenerating.
 */
export const fetchPostCreativeDataUrl = async (
  creativeImageUrl: string,
): Promise<string> => {
  const requestAuthEpoch = captureAuthEpoch();
  assertAuthEpoch(requestAuthEpoch);
  const res = await fetch(creativeImageUrl, { credentials: "include" });
  if (!res.ok) {
    throw await readApiError(res, { requestAuthEpoch });
  }
  const blob = await res.blob();
  assertAuthEpoch(requestAuthEpoch);
  if (!blob.type.startsWith("image/") && blob.type !== "application/octet-stream") {
    throw new Error("Creative is not an image");
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assertAuthEpoch(requestAuthEpoch);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const mime = blob.type.startsWith("image/") ? blob.type : "image/jpeg";
  assertAuthEpoch(requestAuthEpoch);
  return `data:${mime};base64,${btoa(binary)}`;
};

export const setApprovalStatus = async (
  postId: string,
  status: "approved" | "rejected",
  approvedBy?: string,
): Promise<void> => {
  await jsonRequest(`/api/app/posts/${encodeURIComponent(postId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      approval_status: status,
      approved_by: approvedBy || "",
    }),
  });
};

export const listPendingPosts = async (
  _dealerId: string,
  limit = 50,
): Promise<PostRecord[]> => {
  const qs = new URLSearchParams({
    approval_status: "pending",
    limit: String(limit),
  });
  const res = await jsonRequest<{ items: PostRecord[] }>(
    `/api/app/posts?${qs.toString()}`,
  );
  return res.items || [];
};

export interface PostListPage {
  items: PostRecord[];
  nextCursor?: string;
}

export const listPostsPage = async (
  options: {
    limit?: number;
    approvalStatus?: ApprovalStatus | "all";
    cursor?: string;
  } = {},
): Promise<PostListPage> => {
  const qs = new URLSearchParams({
    limit: String(options.limit ?? 200),
  });
  if (options.approvalStatus && options.approvalStatus !== "all") {
    qs.set("approval_status", options.approvalStatus);
  }
  if (options.cursor) {
    qs.set("cursor", options.cursor);
  }
  const res = await jsonRequest<PostListPage>(`/api/app/posts?${qs.toString()}`);
  return {
    items: res.items || [],
    nextCursor: res.nextCursor || undefined,
  };
};

export const listPosts = async (
  options: {
    limit?: number;
    approvalStatus?: ApprovalStatus | "all";
  } = {},
): Promise<PostRecord[]> => (await listPostsPage(options)).items;

export interface LeaderboardEntry {
  salesperson: string;
  salespersonId?: string;
  count: number;
  videoCount: number;
  releaseCount: number;
  lastPostedAt: string;
}

/**
 * Aggregates posts by salesperson_name within the given UTC date range.
 * "Unattributed" bucket captures posts where salesperson_name is empty.
 * The `dealerId` param is kept for backwards compat; the server scopes to
 * the session's dealer.
 */
export const getLeaderboard = async (
  _dealerId: string,
  since: Date,
  until: Date = new Date(),
): Promise<LeaderboardEntry[]> => {
  const qs = new URLSearchParams({
    since: since.toISOString(),
    until: until.toISOString(),
    aggregate: "leaderboard",
  });
  const res = await jsonRequest<{ items: LeaderboardEntry[] }>(
    `/api/app/posts?${qs.toString()}`,
  );
  return (res.items || []).map((entry) => ({
    salesperson: entry.salesperson || "Unattributed",
    salespersonId: entry.salespersonId || undefined,
    count: Number(entry.count) || 0,
    videoCount: Number(entry.videoCount) || 0,
    releaseCount: Number(entry.releaseCount) || 0,
    lastPostedAt: entry.lastPostedAt || "",
  }));
};
