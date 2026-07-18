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
}

export interface PostRecord {
  id: string;
  dealer: string;
  salesperson_name?: string;
  /** Optional FK to the salespeople collection — preferred over the free-text name when present. */
  salesperson_id?: string;
  generated_at: string;
  style?: string;
  tone?: string;
  customer_name?: string;
  vin?: string;
  has_release?: boolean;
  has_video?: boolean;
  approval_status?: ApprovalStatus;
  approved_by?: string;
  approved_at?: string;
  caption?: string;
  disclosures?: string;
  /** Session-authorized route; never a public PocketBase file URL. */
  creative_image_url?: string;
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

const jsonRequest = async <T>(url: string, init: RequestInit = {}): Promise<T> => {
  const res = await fetch(url, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body?.error || detail;
    } catch {
      /* not json */
    }
    throw new Error(`${url}: ${detail}`);
  }
  return (await res.json()) as T;
};

export const logPost = async (input: LogPostInput): Promise<PostRecord | null> => {
  try {
    const form = new FormData();
    form.append("salesperson_name", input.salespersonName || "");
    form.append("salesperson_id", input.salespersonId || "");
    form.append("style", input.style || "");
    form.append("tone", input.tone || "");
    form.append("customer_name", input.customerName || "");
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

    const res = await fetch("/api/app/posts", {
      method: "POST",
      credentials: "include",
      body: form,
    });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = await res.json();
        detail = body?.error || detail;
      } catch {
        /* not json */
      }
      throw new Error(`Post submission failed: ${detail}`);
    }
    return (await res.json()) as PostRecord;
  } catch (err) {
    // Logging a post should never break the user's flow.
    console.warn("[posts.logPost] failed (non-fatal)", err);
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
 * Load a stored creative image as a data URL (session-authenticated).
 * Used by History → reopen for share/export without regenerating.
 */
export const fetchPostCreativeDataUrl = async (
  creativeImageUrl: string,
): Promise<string> => {
  const res = await fetch(creativeImageUrl, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`Could not load creative (${res.status})`);
  }
  const blob = await res.blob();
  if (!blob.type.startsWith("image/") && blob.type !== "application/octet-stream") {
    throw new Error("Creative is not an image");
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const mime = blob.type.startsWith("image/") ? blob.type : "image/jpeg";
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

export interface LeaderboardEntry {
  salesperson: string;
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
    limit: "1000",
  });
  const res = await jsonRequest<{ items: PostRecord[] }>(
    `/api/app/posts?${qs.toString()}`,
  );
  const items = res.items || [];

  const map = new Map<string, LeaderboardEntry>();
  for (const item of items) {
    const key = (item.salesperson_name || "").trim() || "Unattributed";
    const entry = map.get(key) || {
      salesperson: key,
      count: 0,
      videoCount: 0,
      releaseCount: 0,
      lastPostedAt: "",
    };
    entry.count += 1;
    if (item.has_video) entry.videoCount += 1;
    if (item.has_release) entry.releaseCount += 1;
    // Compare numerically (not lexically) and only from VALID timestamps, so a
    // missing/empty generated_at can't seed an "Invalid Date" into the UI and
    // mixed offset formats (Z vs +00:00) don't pick the wrong "last posted".
    const ts = item.generated_at ? Date.parse(item.generated_at) : NaN;
    if (!Number.isNaN(ts)) {
      const prev = entry.lastPostedAt ? Date.parse(entry.lastPostedAt) : NaN;
      if (Number.isNaN(prev) || ts > prev) {
        entry.lastPostedAt = item.generated_at;
      }
    }
    map.set(key, entry);
  }

  return Array.from(map.values()).sort((a, b) => b.count - a.count);
};
