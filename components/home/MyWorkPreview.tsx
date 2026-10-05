import React, { useMemo } from "react";
import { ChevronRight, Image as ImageIcon, Loader2, RefreshCw } from "lucide-react";
import type { PostRecord } from "../../services/posts";
import { homeTilesForDealer } from "../../services/storeDefaults";
import { useAppStore } from "../../stores/appStore";
import { savedPostIdentityIsSafe } from "../../utils/historyPost";
import {
  STATUS_TONE_CLASS,
  postCategoryLabel,
  postStatusCopy,
} from "../../utils/postLabels";
import { Button } from "../ui/Button";
import { Skeleton } from "../ui/Skeleton";

const PREVIEW_COUNT = 3;

interface MyWorkPreviewProps {
  posts: PostRecord[];
  loading: boolean;
  error: string | null;
  openingId: string | null;
  onSeeAll: () => void;
  onRetry: () => void;
  onOpen: (post: PostRecord) => void;
}

/**
 * Home's "My work": the last three posts as plain hairline rows under a
 * title-2 header. A bordered panel only beside the tiles on desktop; on a
 * phone it is part of the page, as the Home artboard shows.
 */
export const MyWorkPreview: React.FC<MyWorkPreviewProps> = ({
  posts,
  loading,
  error,
  openingId,
  onSeeAll,
  onRetry,
  onOpen,
}) => {
  const dealer = useAppStore((s) => s.currentDealer);
  const tiles = useMemo(() => homeTilesForDealer(dealer), [dealer]);
  // The same grounding usePostHistoryList checks before it opens a post, so
  // Home holds exactly the posts My work holds.
  const grounding = useMemo(
    () => ({ dealerName: dealer?.name, oemAffiliation: dealer?.oem_affiliation }),
    [dealer?.name, dealer?.oem_affiliation],
  );
  const now = new Date();

  return (
    <section
      aria-labelledby="my-work-preview-heading"
      className="lg:overflow-hidden lg:rounded-md lg:border lg:border-hairline lg:bg-panel"
    >
      <div className="flex min-h-12 items-center justify-between border-b border-hairline lg:px-4">
        <h2
          id="my-work-preview-heading"
          className="font-display text-lg font-semibold text-ink"
        >
          My work
        </h2>
        <button
          type="button"
          onClick={onSeeAll}
          className="-mr-1 min-h-11 px-1 text-sm font-medium text-brand-ink"
        >
          See all
        </button>
      </div>
      <div className="lg:px-4">
        {loading && posts.length === 0 ? (
          <div role="status" aria-label="Loading your posts">
            {Array.from({ length: PREVIEW_COUNT }, (_, index) => (
              <div
                key={index}
                className="flex min-h-16 items-center gap-3 border-b border-hairline py-2 last:border-b-0"
              >
                <Skeleton variant="rectangular" className="h-12 w-12 rounded-sm" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="py-5">
            <p role="alert" className="text-sm text-error-ink">
              {error}
            </p>
            <Button
              variant="secondary"
              className="mt-3"
              onClick={onRetry}
              leftIcon={<RefreshCw />}
            >
              Try again
            </Button>
          </div>
        ) : posts.length === 0 ? (
          <div className="py-6">
            <p className="text-base font-medium text-ink">No posts yet</p>
            <p className="mt-1 text-sm text-ink-2">
              Choose a category to make your first post.
            </p>
          </div>
        ) : (
          <ul>
            {posts.slice(0, PREVIEW_COUNT).map((post) => {
              const label = postCategoryLabel(post.scenario_id, dealer, tiles);
              const customer = post.customer_name?.trim();
              // The client's own identity check can hold a post the server has
              // not flagged; it reads exactly like a server hold, as in My work.
              const held = Boolean(
                post.image_review_required || !savedPostIdentityIsSafe(post, grounding),
              );
              const status = postStatusCopy(
                held ? { ...post, identity_review_required: true } : post,
                { surface: "home", now },
              );
              const busy = openingId === post.id;
              const statusId = `my-work-preview-status-${post.id}`;
              return (
                <li key={post.id} className="border-b border-hairline last:border-b-0">
                  <button
                    type="button"
                    onClick={() => onOpen(post)}
                    disabled={busy}
                    aria-busy={busy || undefined}
                    aria-label={`Open ${label}${customer ? `, ${customer}` : ""}`}
                    aria-describedby={statusId}
                    className="flex min-h-16 w-full items-center gap-3 py-2 text-left transition-colors duration-120 ease-out hover:bg-fill-subtle disabled:cursor-wait"
                  >
                    <span
                      aria-hidden="true"
                      className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-sm bg-fill-subtle text-ink-hint"
                    >
                      {post.creative_image_url && !held ? (
                        <img
                          src={post.creative_image_url}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <ImageIcon className="h-5 w-5" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-medium text-ink">
                        {label}
                        {customer ? ` · ${customer}` : ""}
                      </span>
                      <span
                        id={statusId}
                        className={`block truncate text-caption ${STATUS_TONE_CLASS[status.tone]}`}
                      >
                        {status.label}
                      </span>
                    </span>
                    {busy ? (
                      <Loader2
                        className="h-5 w-5 shrink-0 animate-spin text-ink-hint motion-reduce:animate-none"
                        aria-hidden="true"
                      />
                    ) : (
                      <ChevronRight
                        className="h-5 w-5 shrink-0 text-ink-hint"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
};
