import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { useAppStore } from "../stores/appStore";
import { fetchPostCreativeDataUrl, type PostRecord } from "../services/posts";
import { homeTilesForDealer } from "../services/storeDefaults";
import { safeWebsiteReviewUrl } from "../services/websitePublishing";
import { usePostHistoryList } from "../hooks/usePostHistoryList";
import {
  savedPostIdentityIsSafe,
  toGeneratedPostFromRecord,
} from "../utils/historyPost";
import {
  STATUS_TONE_CLASS,
  postCategoryLabel,
  postDayLabel,
  postStatusCopy,
} from "../utils/postLabels";
import { toUiMessage } from "../utils/errorMessages";
import type { GeneratedPost, ImageSelection } from "../types";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Skeleton } from "./ui/Skeleton";
import { DeviceRecoveryGrid } from "./work/DeviceRecoveryGrid";

interface MyWorkProps {
  onBack: () => void;
  /** The app shell already supplies Back; embedded uses keep their own. */
  headerHasNavigation?: boolean;
  onOpenPost: (post: GeneratedPost) => void;
  onReusePhoto: (selection: ImageSelection) => void;
}

/** A failed load or open, with a full-size action that really retries it. */
const RetryNotice: React.FC<{ message: string; onRetry: () => void }> = ({
  message,
  onRetry,
}) => (
  <div className="mt-3 flex flex-col gap-3 rounded-md border border-error-ink/30 bg-error-fill px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
    <p role="alert" className="text-sm text-error-ink">
      {message}
    </p>
    <Button
      variant="secondary"
      className="shrink-0 self-start sm:self-auto"
      onClick={onRetry}
      leftIcon={<RefreshCw />}
    >
      Try again
    </Button>
  </div>
);

export const MyWork: React.FC<MyWorkProps> = ({
  onBack,
  headerHasNavigation = false,
  onOpenPost,
  onReusePhoto,
}) => {
  const dealer = useAppStore((s) => s.currentDealer);
  const person = useAppStore((s) => s.currentPerson);
  const role = useAppStore((s) => s.role);
  const {
    filtered,
    items,
    loading,
    loadingMore,
    error,
    nextCursor,
    load,
    openingId,
    websiteRetryingId,
    retryWebsite,
    identityGrounding,
    query,
    setQuery,
    statusFilter,
    setStatusFilter,
  } = usePostHistoryList();
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const alive = useRef(true);
  const openRequest = useRef(0);
  const failedPost = useRef<PostRecord | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      openRequest.current += 1;
    };
  }, []);
  const openPost = useCallback(
    async (post: (typeof items)[number]) => {
      if (
        post.image_review_required ||
        !savedPostIdentityIsSafe(post, identityGrounding) ||
        !post.creative_image_url
      )
        return;
      setOpening(post.id);
      setOpenError(null);
      const requestId = ++openRequest.current;
      const authEpoch = useAppStore.getState().authEpoch;
      try {
        const image = await fetchPostCreativeDataUrl(post.creative_image_url);
        if (
          !alive.current ||
          requestId !== openRequest.current ||
          authEpoch !== useAppStore.getState().authEpoch
        )
          return;
        onOpenPost(
          toGeneratedPostFromRecord(post, {
            role,
            currentPersonId: person?.id || "",
            image,
          }),
        );
      } catch (error) {
        if (
          alive.current &&
          requestId === openRequest.current &&
          authEpoch === useAppStore.getState().authEpoch
        ) {
          failedPost.current = post;
          setOpenError(
            toUiMessage(error, "Could not open this post. Try opening it again."),
          );
        }
      } finally {
        if (alive.current && requestId === openRequest.current) setOpening(null);
      }
    },
    [identityGrounding, onOpenPost, person?.id, role],
  );
  const team = role !== "salesperson";
  const tiles = useMemo(() => homeTilesForDealer(dealer), [dealer]);
  const now = new Date();

  return (
    <section
      className="mx-auto w-full max-w-3xl px-4 pb-12 pt-3 sm:px-6 lg:pt-8"
      aria-labelledby="my-work-heading"
    >
      {!headerHasNavigation && (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back"
          className="-ml-3"
          onClick={onBack}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
      )}
      <h1
        id="my-work-heading"
        className="mt-1 font-display text-3xl font-semibold text-ink sm:text-4xl"
      >
        {team ? "Team work" : "My work"}
      </h1>
      <p className="mt-1 text-sm text-ink-2">
        {team ? "Your team's posts, newest first." : "Open any post to share it again."}
      </p>

      <section className="mt-8" aria-labelledby="saved-posts-heading">
        <h2
          id="saved-posts-heading"
          className="font-display text-lg font-semibold text-ink"
        >
          Saved posts
        </h2>
        <div className="mt-3 space-y-3">
          <Input
            type="search"
            aria-label="Search saved posts"
            placeholder={
              team ? "Name, VIN, caption or teammate" : "Name, VIN or caption"
            }
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            leftIcon={<Search aria-hidden="true" />}
            aria-describedby="saved-post-search-scope"
            fullWidth
            rightAction={
              query ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setQuery("")}
                  className="grid min-h-11 min-w-11 place-items-center rounded-sm hover:text-ink"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : undefined
            }
          />
          <div className="flex items-center gap-2">
            <label htmlFor="saved-post-review" className="shrink-0 text-sm text-ink-2">
              Review
            </label>
            <select
              id="saved-post-review"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as typeof statusFilter)
              }
              className="min-h-11 min-w-0 flex-1 rounded-sm border border-strong bg-panel-raised px-3 text-base text-ink"
            >
              <option value="all">All posts</option>
              <option value="pending">Waiting for approval</option>
              <option value="approved">Approved</option>
              <option value="rejected">Changes requested</option>
              <option value="n_a">No review needed</option>
            </select>
          </div>
          <p id="saved-post-search-scope" className="text-caption text-ink-2">
            {loading
              ? "Loading posts…"
              : `${filtered.length} of ${items.length} loaded posts`}
            {nextCursor ? " · Load older posts to search further." : ""}
          </p>
        </div>
        {error && (
          <RetryNotice
            message={error}
            onRetry={() => void load(nextCursor || undefined)}
          />
        )}
        {openError && (
          <RetryNotice
            message={openError}
            onRetry={() => {
              if (failedPost.current) void openPost(failedPost.current);
            }}
          />
        )}
        {loading && !items.length ? (
          <div
            role="status"
            aria-label="Loading your posts"
            className="mt-3 border-t border-hairline"
          >
            {[0, 1, 2].map((n) => (
              <div
                key={n}
                className="flex min-h-16 items-center gap-3 border-b border-hairline py-3"
              >
                <Skeleton variant="rectangular" className="h-12 w-12 rounded-sm" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="w-1/2" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          // After a failed load the list is unknown, not empty: the notice
          // above is the whole story, so "No posts yet" would be a false claim.
          error ? null : (
            <div className="mt-3 border-t border-hairline py-8">
              <p className="text-base font-medium text-ink">
                {query.trim() || statusFilter !== "all"
                  ? "No matching posts"
                  : "No posts yet"}
              </p>
              <p className="mt-1 text-sm text-ink-2">
                {query.trim() || statusFilter !== "all"
                  ? nextCursor
                    ? "Try another search or load older posts below."
                    : "Try another search or clear your filters."
                  : team
                    ? "Posts your team makes will show here."
                    : "Pick a category on Home to make your first post."}
              </p>
              {query.trim() || statusFilter !== "all" ? (
                <Button
                  variant="secondary"
                  className="mt-3"
                  onClick={() => {
                    setQuery("");
                    setStatusFilter("all");
                  }}
                >
                  Clear filters
                </Button>
              ) : null}
            </div>
          )
        ) : (
          <ul className="mt-3 border-t border-hairline">
            {filtered.map((post) => {
              const blocked = Boolean(
                post.image_review_required ||
                !savedPostIdentityIsSafe(post, identityGrounding),
              );
              // The client's own identity check can hold a post the server
              // has not flagged; it reads exactly like a server hold.
              const status = postStatusCopy(
                blocked ? { ...post, identity_review_required: true } : post,
                { surface: "work", now },
              );
              const openable = !blocked && Boolean(post.creative_image_url);
              const busy = opening === post.id || openingId === post.id;
              const label = postCategoryLabel(post.scenario_id, dealer, tiles);
              const customer = post.customer_name?.trim();
              const day = postDayLabel(post.generated_at, now);
              const reviewUrl =
                post.website_publication && !blocked
                  ? safeWebsiteReviewUrl(post.website_publication.reviewUrl)
                  : undefined;
              const websiteError = Boolean(post.website_publication?.lastError);
              const dayId = `my-work-day-${post.id}`;
              const statusId = `my-work-status-${post.id}`;
              // In the team view the row says whose post it is; a screen
              // reader hears that too, between the day and the status.
              const ownerName = team ? post.salesperson_name?.trim() : "";
              const ownerId = `my-work-owner-${post.id}`;

              const thumb = (
                <span
                  aria-hidden="true"
                  className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-sm bg-fill-subtle text-ink-hint"
                >
                  {post.creative_image_url && !blocked ? (
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
              );
              const body = (
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-base font-medium text-ink">
                      {label}
                      {customer ? ` · ${customer}` : ""}
                    </span>
                    <span id={dayId} className="shrink-0 text-caption text-ink-2">
                      {day}
                    </span>
                  </span>
                  {ownerName ? (
                    <span
                      id={ownerId}
                      className="block truncate text-caption text-ink-2"
                    >
                      {ownerName}
                    </span>
                  ) : null}
                  <span id={statusId} className="mt-0.5 block">
                    <span
                      className={`block text-caption font-medium ${STATUS_TONE_CLASS[status.tone]}`}
                    >
                      {status.label}
                    </span>
                    {status.detail ? (
                      <span className="block text-caption text-ink-2">
                        {status.detail}
                      </span>
                    ) : null}
                    {!blocked && !post.creative_image_url ? (
                      <span className="block text-caption text-ink-2">
                        No image was saved with this post.
                      </span>
                    ) : null}
                  </span>
                </span>
              );

              return (
                <li key={post.id} className="border-b border-hairline">
                  {openable ? (
                    <button
                      type="button"
                      onClick={() => void openPost(post)}
                      disabled={busy}
                      aria-busy={busy || undefined}
                      aria-label={`Open ${label}${customer ? `, ${customer}` : ""}`}
                      aria-describedby={
                        ownerName
                          ? `${dayId} ${ownerId} ${statusId}`
                          : `${dayId} ${statusId}`
                      }
                      className="flex min-h-16 w-full items-center gap-3 py-3 text-left transition-colors duration-120 ease-out hover:bg-fill-subtle disabled:cursor-wait"
                    >
                      {thumb}
                      {body}
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
                  ) : (
                    <div className="flex min-h-16 items-center gap-3 py-3">
                      {thumb}
                      {body}
                    </div>
                  )}
                  {reviewUrl || websiteError ? (
                    <div className="-mt-1 flex flex-wrap items-center gap-x-4 pb-2 pl-[60px]">
                      {websiteError ? (
                        <span className="text-caption text-warning-ink">
                          Website draft needs attention
                        </span>
                      ) : null}
                      {reviewUrl ? (
                        <a
                          href={reviewUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-ink-2 transition-colors duration-120 ease-out hover:text-ink"
                        >
                          Website draft
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        </a>
                      ) : null}
                      {websiteError ? (
                        <Button
                          variant="ghost"
                          loading={websiteRetryingId === post.id}
                          onClick={() => void retryWebsite(post)}
                          leftIcon={<RefreshCw />}
                        >
                          Retry website draft
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {nextCursor && (
          <div className="mt-4 flex justify-center">
            <Button
              variant="secondary"
              loading={loadingMore}
              disabled={loading || loadingMore}
              onClick={() => void load(nextCursor)}
              leftIcon={<ChevronDown />}
            >
              Show older posts
            </Button>
          </div>
        )}
      </section>
      {dealer && (
        <DeviceRecoveryGrid dealerId={dealer.id} onReusePhoto={onReusePhoto} />
      )}
    </section>
  );
};
