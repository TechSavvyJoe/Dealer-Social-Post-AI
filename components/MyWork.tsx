import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useAppStore } from "../stores/appStore";
import { fetchPostCreativeDataUrl, type PostRecord } from "../services/posts";
import { safeWebsiteReviewUrl } from "../services/websitePublishing";
import { usePostHistoryList } from "../hooks/usePostHistoryList";
import {
  postStatusFor,
  savedPostIdentityIsSafe,
  toGeneratedPostFromRecord,
} from "../utils/historyPost";
import { toPublicCustomerLabel } from "../utils/customerIdentity";
import { toUiMessage } from "../utils/errorMessages";
import type { GeneratedPost, ImageSelection } from "../types";
import { Button } from "./ui/Button";
import { ErrorBanner } from "./ui/ErrorBanner";
import { Skeleton } from "./ui/Skeleton";
import { DeviceRecoveryGrid } from "./work/DeviceRecoveryGrid";

interface MyWorkProps {
  onBack: () => void;
  onOpenPost: (post: GeneratedPost) => void;
  onReusePhoto: (selection: ImageSelection) => void;
}
const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
const categoryLabel = (post: { scenario_id?: string; style?: string }) =>
  post.scenario_id?.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) ||
  post.style ||
  "Social post";
const channelLabel = (channel?: string) =>
  channel?.includes("instagram")
    ? "Instagram"
    : channel?.includes("tiktok")
      ? "TikTok"
      : channel?.includes("gbp")
        ? "Google Business Profile"
        : "Facebook";

export const MyWork: React.FC<MyWorkProps> = ({ onBack, onOpenPost, onReusePhoto }) => {
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
  const heading = useMemo(
    () => (role === "salesperson" ? "My work" : "Team work"),
    [role],
  );
  return (
    <div
      className="mx-auto w-full max-w-5xl space-y-8 px-4 py-6 sm:px-6"
      aria-labelledby="my-work-heading"
    >
      <div className="flex items-center gap-3 border-b border-hairline pb-5">
        <Button variant="ghost" size="icon" aria-label="Back" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 id="my-work-heading" className="text-2xl font-semibold text-ink">
            {heading}
          </h1>
          <p className="mt-1 text-sm text-ink-2">
            Saved posts and recovery copies from this device.
          </p>
        </div>
      </div>
      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      {openError && (
        <ErrorBanner
          message={openError}
          onRetry={() => {
            if (failedPost.current) void openPost(failedPost.current);
          }}
        />
      )}
      <section className="space-y-3" aria-labelledby="saved-posts-heading">
        <h2 id="saved-posts-heading" className="text-lg font-semibold text-ink">
          Saved posts
        </h2>
        {loading && !items.length ? (
          <div className="space-y-2">
            {[1, 2, 3].map((n) => (
              <Skeleton key={n} height={72} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-sm border border-dashed border-hairline p-8 text-center">
            <p className="font-medium text-ink">No posts yet</p>
            <p className="mt-1 text-sm text-ink-2">
              Posts you save or share will appear here.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-hairline border-y border-hairline">
            {filtered.map((post) => {
              const blocked = Boolean(
                post.image_review_required ||
                !savedPostIdentityIsSafe(post, identityGrounding),
              );
              const status = postStatusFor(post);
              const busy = opening === post.id || openingId === post.id;
              return (
                <article
                  key={post.id}
                  className="grid grid-cols-[64px_1fr_auto] items-center gap-3 py-3 sm:grid-cols-[80px_1fr_auto]"
                >
                  {post.creative_image_url && !blocked ? (
                    <button
                      type="button"
                      className="h-16 w-16 overflow-hidden rounded-sm border border-hairline bg-fill-subtle sm:h-20 sm:w-20"
                      onClick={() => void openPost(post)}
                      disabled={busy}
                      aria-label={`Open ${categoryLabel(post)}`}
                    >
                      <img
                        src={post.creative_image_url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </button>
                  ) : (
                    <div
                      className="grid h-16 w-16 place-items-center rounded-sm border border-hairline bg-fill-subtle text-ink-2 sm:h-20 sm:w-20"
                      aria-label="Post image unavailable"
                    >
                      <ImageIcon className="h-5 w-5" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">
                      {categoryLabel(post)}
                    </p>
                    <p className="mt-1 text-xs text-ink-2">
                      {dateLabel(post.generated_at)}
                      {role !== "salesperson" && post.salesperson_name
                        ? ` · ${post.salesperson_name}`
                        : ""}
                    </p>
                    {status === "changes" && (
                      <p className="mt-1 text-xs text-error-ink">
                        Changes requested: {post.rejection_reason || "manager review"}
                      </p>
                    )}
                    {blocked && (
                      <p className="mt-1 text-xs text-warning-ink">
                        Held for safety review; this post cannot be reopened.
                      </p>
                    )}
                    {post.website_publication?.lastError && (
                      <p className="mt-1 text-xs text-warning-ink">
                        Website status needs attention
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className="text-right text-xs font-medium text-ink-2">
                      {status === "shared"
                        ? `Shared · ${channelLabel(post.share_summary?.last_channel)}`
                        : status === "waiting"
                          ? "Waiting for approval"
                          : status === "changes"
                            ? "Changes requested"
                            : status === "review_blocked"
                              ? "Held for review"
                              : "Draft"}
                    </span>
                    {status === "shared" && (
                      <span className="text-[11px] text-ink-2">
                        sent to the share sheet
                      </span>
                    )}
                    {post.website_publication &&
                      safeWebsiteReviewUrl(post.website_publication.reviewUrl) &&
                      !blocked && (
                        <a
                          href={safeWebsiteReviewUrl(
                            post.website_publication.reviewUrl,
                          )}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-brand-ink"
                        >
                          Website draft <ExternalLink className="inline h-3 w-3" />
                        </a>
                      )}
                    {post.website_publication?.lastError && (
                      <Button
                        size="xs"
                        variant="ghost"
                        loading={websiteRetryingId === post.id}
                        onClick={() => void retryWebsite(post)}
                        leftIcon={<RefreshCw className="h-3 w-3" />}
                      >
                        Retry
                      </Button>
                    )}
                    {!blocked && (
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void openPost(post)}
                        leftIcon={
                          busy ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : undefined
                        }
                      >
                        Open
                      </Button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {nextCursor && (
          <div className="flex justify-center pt-2">
            <Button
              variant="outline"
              loading={loadingMore}
              onClick={() => void load(nextCursor)}
              leftIcon={<ChevronDown className="h-4 w-4" />}
            >
              Load more
            </Button>
          </div>
        )}
      </section>
      {dealer && (
        <DeviceRecoveryGrid dealerId={dealer.id} onReusePhoto={onReusePhoto} />
      )}
    </div>
  );
};
