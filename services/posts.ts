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
}

const jsonRequest = async <T>(
  url: string,
  init: RequestInit = {}
): Promise<T> => {
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

export const logPost = async (
  input: LogPostInput
): Promise<PostRecord | null> => {
  try {
    return await jsonRequest<PostRecord>("/api/app/posts", {
      method: "POST",
      body: JSON.stringify({
        salesperson_name: input.salespersonName || "",
        salesperson_id: input.salespersonId || "",
        style: input.style || "",
        tone: input.tone || "",
        customer_name: input.customerName || "",
        vin: input.vin || "",
        has_release: !!input.hasRelease,
        has_video: !!input.hasVideo,
        approval_status: input.requiresApproval ? "pending" : "n_a",
      }),
    });
  } catch (err) {
    // Logging a post should never break the user's flow.
    console.warn("[posts.logPost] failed (non-fatal)", err);
    return null;
  }
};

export const setApprovalStatus = async (
  postId: string,
  status: ApprovalStatus,
  approvedBy?: string
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
  limit = 50
): Promise<PostRecord[]> => {
  const qs = new URLSearchParams({
    approval_status: "pending",
    limit: String(limit),
  });
  const res = await jsonRequest<{ items: PostRecord[] }>(
    `/api/app/posts?${qs.toString()}`
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
  until: Date = new Date()
): Promise<LeaderboardEntry[]> => {
  const qs = new URLSearchParams({
    since: since.toISOString(),
    until: until.toISOString(),
    limit: "1000",
  });
  const res = await jsonRequest<{ items: PostRecord[] }>(
    `/api/app/posts?${qs.toString()}`
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
      lastPostedAt: item.generated_at,
    };
    entry.count += 1;
    if (item.has_video) entry.videoCount += 1;
    if (item.has_release) entry.releaseCount += 1;
    if (item.generated_at > entry.lastPostedAt) {
      entry.lastPostedAt = item.generated_at;
    }
    map.set(key, entry);
  }

  return Array.from(map.values()).sort((a, b) => b.count - a.count);
};
