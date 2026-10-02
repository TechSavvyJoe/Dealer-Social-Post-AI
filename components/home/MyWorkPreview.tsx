import React from "react";
import { ChevronRight, Images } from "lucide-react";
import type { PostRecord } from "../../services/posts";
import { postStatusFor } from "../../utils/historyPost";

const scenarioLabel = (scenarioId?: string) => {
  if (scenarioId === "customer_delivery") return "Delivery";
  if (scenarioId === "new_arrival") return "New arrival";
  if (scenarioId === "service_promotion") return "Service";
  if (scenarioId === "team_anniversary") return "Team";
  return "Post";
};

const statusText = (post: PostRecord) => {
  const status = postStatusFor(post);
  if (status === "waiting") return "Waiting for approval";
  if (status === "changes") return "Changes requested";
  if (status === "review_blocked") return "Review needed";
  if (status === "shared") {
    const channel = post.share_summary?.last_channel.includes("instagram")
      ? "Instagram"
      : post.share_summary?.last_channel === "linkedin"
        ? "LinkedIn"
        : "Facebook";
    const time = post.share_summary?.last_shared_at
      ? new Date(post.share_summary.last_shared_at).toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : "Shared";
    return `Shared to ${channel} · ${time}`;
  }
  return "Draft";
};

export const MyWorkPreview: React.FC<{
  posts: PostRecord[];
  loading: boolean;
  error: string | null;
  openingId: string | null;
  onSeeAll: () => void;
  onRetry: () => void;
  onOpen: (post: PostRecord) => void;
}> = ({ posts, loading, error, openingId, onSeeAll, onRetry, onOpen }) => (
  <section
    aria-labelledby="my-work-heading"
    className="overflow-hidden rounded-lg border border-hairline bg-panel"
  >
    <div className="flex min-h-16 items-center justify-between border-b border-hairline px-4">
      <div>
        <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-brand-ink">
          Recent studio work
        </p>
        <h2
          id="my-work-heading"
          className="font-display text-xl font-semibold text-ink"
        >
          My work
        </h2>
      </div>
      <button type="button" onClick={onSeeAll} className="min-h-11 px-1 text-brand-ink">
        See all
      </button>
    </div>
    <div className="px-4">
      {loading ? (
        <p role="status" className="py-6 text-sm text-ink-2">
          Loading your work…
        </p>
      ) : error ? (
        <div className="py-5">
          <p role="alert" className="text-sm text-error-ink">
            {error}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 min-h-11 text-brand-ink"
          >
            Try again
          </button>
        </div>
      ) : posts.length === 0 ? (
        <div className="py-7 text-center">
          <span className="mx-auto grid h-11 w-11 place-items-center rounded-md border border-hairline bg-panel-raised text-ink-2">
            <Images className="h-5 w-5" aria-hidden="true" />
          </span>
          <p className="mt-3 font-medium text-ink">Your recent posts will show here.</p>
          <p className="mx-auto mt-1 max-w-56 text-sm text-ink-2">
            Choose a category to make your first post.
          </p>
        </div>
      ) : (
        posts.slice(0, 3).map((post) => (
          <button
            key={post.id}
            type="button"
            onClick={() => onOpen(post)}
            disabled={openingId === post.id}
            className="flex min-h-[92px] w-full items-center gap-3 border-b border-hairline py-3 text-left transition-colors last:border-b-0 hover:bg-fill-subtle"
          >
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md border border-hairline bg-panel-raised">
              {post.creative_image_url ? (
                <img
                  src={post.creative_image_url}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-medium text-ink">
                {scenarioLabel(post.scenario_id)}
                {post.customer_name ? ` · ${post.customer_name}` : ""}
              </div>
              <div className="truncate text-sm text-ink-2">{statusText(post)}</div>
            </div>
            <ChevronRight
              className="h-5 w-5 shrink-0 text-ink-hint"
              aria-hidden="true"
            />
          </button>
        ))
      )}
    </div>
  </section>
);
