import React, { useCallback } from "react";
import { m, AnimatePresence } from "framer-motion";
import {
  Search,
  Loader2,
  Film,
  ShieldCheck,
  AlertCircle,
  Clock,
  CheckCircle2,
  XCircle,
  History,
  Download,
  ExternalLink,
  Image as ImageIcon,
  Calendar,
  Globe2,
  RefreshCw,
} from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { EmptyState } from "./ui/EmptyState";
import { ErrorBanner } from "./ui/ErrorBanner";
import { Skeleton } from "./ui/Skeleton";
import { ApprovalStatus } from "../services/posts";
import { cn } from "../utils/classNames";
import { LocalMediaArchive } from "./LocalMediaArchive";
import {
  safeWebsiteReviewUrl,
  type WebsitePublication,
} from "../services/websitePublishing";
import { toPublicCustomerLabel } from "../utils/customerIdentity";
import { savedPostIdentityIsSafe } from "../utils/historyPost";
import { usePostHistoryList } from "../hooks/usePostHistoryList";
import type { GeneratedPost } from "../types";

const STATUS_FILTERS: Array<{ key: ApprovalStatus | "all"; label: string }> = [
  { key: "all", label: "All" },
  { key: "approved", label: "Approved" },
  { key: "pending", label: "Pending" },
  { key: "rejected", label: "Rejected" },
  { key: "n_a", label: "No review" },
];

const formatWhen = (iso: string): string => {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    return sameDay
      ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString([], {
          month: "short",
          day: "numeric",
          year: now.getFullYear() === d.getFullYear() ? undefined : "2-digit",
        });
  } catch {
    return iso;
  }
};

const statusBadge = (status?: ApprovalStatus): React.ReactElement | null => {
  switch (status) {
    case "approved":
      return (
        <span className="inline-flex items-center gap-1 text-success-200 text-[11px]">
          <CheckCircle2 className="h-3 w-3" /> approved
        </span>
      );
    case "pending":
      return (
        <span className="inline-flex items-center gap-1 text-warning-200 text-[11px]">
          <Clock className="h-3 w-3" /> pending
        </span>
      );
    case "rejected":
      return (
        <span className="inline-flex items-center gap-1 text-error-200 text-[11px] [.theme-light_&]:text-error-800">
          <XCircle className="h-3 w-3" /> rejected
        </span>
      );
    default:
      return null;
  }
};

const websiteStatusBadge = (
  publication?: WebsitePublication,
): React.ReactElement | null => {
  if (!publication || publication.status === "not_requested") return null;
  const ready =
    (publication.status === "draft_ready" && !publication.lastError) ||
    publication.status === "published";
  const failed =
    publication.status === "failed" ||
    (publication.status === "draft_ready" && !!publication.lastError);
  const withdrawn = publication.status === "withdrawn";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px]",
        ready
          ? "text-success-200"
          : failed
            ? "text-error-200 [.theme-light_&]:text-error-800"
            : withdrawn
              ? "text-surface-400"
              : "text-info-200",
      )}
    >
      <Globe2 className="h-3 w-3" />
      {publication.status === "draft_ready"
        ? publication.lastError
          ? "site status check needs attention"
          : "site draft ready"
        : publication.status === "published"
          ? "site published"
          : publication.status === "failed"
            ? "site delivery failed"
            : publication.status === "withdrawn"
              ? "site draft withdrawn"
              : publication.status === "waiting_approval"
                ? "site waits for approval"
                : "site draft queued"}
    </span>
  );
};

/**
 * Searchable history of posts for the current dealership.
 * Posts with a stored creative can be reopened for share/export without regen.
 */
interface PostHistoryProps {
  onOpenCreative?: () => void;
  /**
   * Receives a reopened post instead of the store's direct open, so the
   * caller's own guarded path (the manager dashboard's `onOpenPost`) opens it.
   */
  onPostReady?: (post: GeneratedPost) => void;
}

export const PostHistory: React.FC<PostHistoryProps> = ({
  onOpenCreative,
  onPostReady,
}) => {
  const {
    dealer,
    role,
    identityGrounding,
    items,
    filtered,
    loading,
    loadingMore,
    error,
    nextCursor,
    query,
    setQuery,
    statusFilter,
    setStatusFilter,
    openingId,
    websiteRetryingId,
    load,
    openCreative,
    retryWebsite,
  } = usePostHistoryList({ onOpenCreative, onPostReady });

  const exportCsv = useCallback(() => {
    const rows = [
      [
        "generated_at",
        "salesperson",
        "customer",
        "vin",
        "style",
        "tone",
        "has_video",
        "has_release",
        "approval_status",
        "approved_by",
        "approved_at",
        "has_creative",
        "website_status",
      ],
      ...filtered.map((p) => [
        p.generated_at || "",
        p.salesperson_name || "",
        toPublicCustomerLabel(p.customer_name),
        p.vin || "",
        p.style || "",
        p.tone || "",
        p.has_video ? "true" : "false",
        p.has_release ? "true" : "false",
        p.approval_status || "",
        p.approved_by || "",
        p.approved_at || "",
        p.creative_image_url ? "true" : "false",
        p.website_publication?.status || "",
      ]),
    ];
    const csv = rows
      .map((r) =>
        r
          .map((cell) => {
            let s = String(cell);
            if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
            return `"${s.replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
          })
          .join(","),
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `posts-${dealer?.name || "dealer"}-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [filtered, dealer?.name]);

  return (
    <m.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg border border-hairline bg-surface-overlay p-4 sm:p-6 space-y-4"
    >
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div
            className="h-8 w-1.5 rounded-full"
            style={{ background: "var(--brand-primary)" }}
            aria-hidden="true"
          />
          <div>
            <h3 className="text-xl font-bold text-surface-50 flex items-center gap-2">
              <History className="h-5 w-5 text-primary-300" />
              {role === "salesperson" ? "My posts" : "Post history"}
            </h3>
            <p className="text-xs text-surface-400">
              {filtered.length} visible · {items.length}{" "}
              {items.length === 1 ? "post" : "posts"} loaded
              {error
                ? " · archive could not be checked"
                : nextCursor
                  ? " · older posts available"
                  : loading
                    ? " · checking archive…"
                    : " · archive up to date"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<Download className="h-3.5 w-3.5" />}
            onClick={exportCsv}
            disabled={filtered.length === 0}
            title="Download the filtered rows currently loaded"
          >
            Export CSV
          </Button>
        </div>
      </div>

      {dealer ? <LocalMediaArchive dealerId={dealer.id} /> : null}

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none" />
          <Input
            label=""
            type="search"
            aria-label="Search post history"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search loaded posts by name, VIN, salesperson…"
            fullWidth
            className="bg-fill-subtle border-hairline focus:border-primary-400 pl-9"
          />
        </div>
        <div className="flex bg-surface-950/60 p-1 rounded-xl border border-surface-800 overflow-x-auto">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={statusFilter === f.key}
              onClick={() => setStatusFilter(f.key)}
              className={cn(
                "min-h-11 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap",
                statusFilter === f.key
                  ? "bg-primary-500/30 text-primary-100 [.theme-light_&]:text-primary-950"
                  : "text-surface-400 hover:text-surface-200",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <ErrorBanner
          message={error}
          onRetry={() => void load(nextCursor || undefined)}
        />
      )}

      <AnimatePresence mode="wait">
        {loading && items.length === 0 ? (
          <m.div
            key="loading"
            className="space-y-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            aria-label="Loading post history"
          >
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-xl border border-surface-800 bg-surface-900/40 px-3 py-3"
              >
                <Skeleton variant="rectangular" width={48} height={48} />
                <div className="flex-1 space-y-2">
                  <Skeleton width="55%" height={12} />
                  <Skeleton width="35%" height={10} />
                </div>
                <Skeleton width={72} height={28} />
              </div>
            ))}
          </m.div>
        ) : filtered.length === 0 && error ? null : filtered.length === 0 ? (
          <m.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {items.length === 0 && !query.trim() && statusFilter === "all" ? (
              <EmptyState
                icon={History}
                title="No posts logged yet"
                description={
                  role === "salesperson"
                    ? "Your generated posts will show up here. New posts store the creative so you can reopen and share later."
                    : "Posts your team generates will show up here. New posts store the creative so you can reopen and share later."
                }
              />
            ) : (
              <EmptyState
                icon={Search}
                title="No matches"
                description={
                  nextCursor
                    ? "No matching posts in the loaded results. Load older posts to search further, or clear your filters."
                    : "No posts match your search and review filters. Try another search or clear your filters."
                }
                actionLabel="Clear filters"
                onAction={() => {
                  setQuery("");
                  setStatusFilter("all");
                }}
              />
            )}
          </m.div>
        ) : (
          <m.div
            key="rows"
            className="space-y-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="space-y-2 md:hidden">
              {filtered.map((post) => {
                const canOpen = Boolean(
                  post.creative_image_url && !post.image_review_required,
                );
                const isOpening = openingId === post.id;
                return (
                  <article
                    key={post.id}
                    className="flex min-w-0 gap-3 rounded-xl border border-hairline bg-surface-950/35 p-3"
                  >
                    {canOpen ? (
                      <button
                        type="button"
                        onClick={() => void openCreative(post)}
                        disabled={isOpening}
                        className="h-20 w-16 shrink-0 overflow-hidden rounded-lg border border-hairline bg-surface-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                        aria-label={`Open post from ${formatWhen(post.generated_at)}`}
                      >
                        <img
                          src={post.creative_image_url}
                          alt=""
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      </button>
                    ) : (
                      <div
                        className="flex h-20 w-16 shrink-0 items-center justify-center rounded-lg border border-hairline bg-surface-950/80 text-surface-600"
                        aria-label={
                          post.image_review_required
                            ? "Saved image held for safety review"
                            : "No stored image"
                        }
                      >
                        <ImageIcon className="h-5 w-5" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-surface-50">
                            {toPublicCustomerLabel(post.customer_name) ||
                              post.salesperson_name ||
                              "Social post"}
                          </p>
                          <p className="mt-0.5 text-[11px] text-surface-400">
                            {formatWhen(post.generated_at)}
                            {role !== "salesperson" && post.salesperson_name
                              ? ` · ${post.salesperson_name}`
                              : ""}
                            {role !== "salesperson" &&
                            post.salesperson_name &&
                            !post.attribution_authoritative
                              ? " · legacy attribution"
                              : ""}
                          </p>
                        </div>
                        {statusBadge(post.approval_status)}
                      </div>
                      <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-surface-300">
                        {post.image_review_required
                          ? "Image held for current on-pixel safety review"
                          : savedPostIdentityIsSafe(post, identityGrounding)
                            ? post.caption ||
                              `${post.style || "Post"} · ${post.tone || ""}`
                            : "Caption held for customer-name review"}
                      </p>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2 text-[10px] text-surface-400">
                          {post.has_video && (
                            <span className="inline-flex items-center gap-1">
                              <Film className="h-3 w-3" /> video
                            </span>
                          )}
                          {post.has_release && (
                            <span className="inline-flex items-center gap-1 text-success-200">
                              <ShieldCheck className="h-3 w-3" /> release
                            </span>
                          )}
                          {websiteStatusBadge(post.website_publication)}
                        </div>
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {!post.image_review_required &&
                          safeWebsiteReviewUrl(post.website_publication?.reviewUrl) ? (
                            <a
                              href={safeWebsiteReviewUrl(
                                post.website_publication?.reviewUrl,
                              )}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-success-400/25 bg-success-500/10 px-2 text-[10px] font-semibold text-success-100 [.theme-light_&]:text-success-900"
                            >
                              <Globe2 className="h-3 w-3" /> Site draft
                            </a>
                          ) : null}
                          {!post.image_review_required &&
                          (post.website_publication?.status === "failed" ||
                            (post.website_publication?.status === "draft_ready" &&
                              post.website_publication.lastError)) ? (
                            <button
                              type="button"
                              disabled={Boolean(websiteRetryingId)}
                              onClick={() => void retryWebsite(post)}
                              className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-error-400/25 bg-error-500/10 px-2 text-[10px] font-semibold text-error-100 disabled:opacity-50 [.theme-light_&]:text-error-800"
                            >
                              <RefreshCw
                                className={cn(
                                  "h-3 w-3",
                                  websiteRetryingId === post.id && "animate-spin",
                                )}
                              />
                              {post.website_publication.status === "draft_ready"
                                ? "Retry status"
                                : "Retry site"}
                            </button>
                          ) : null}
                          <Button
                            type="button"
                            size="sm"
                            variant={canOpen ? "outline" : "ghost"}
                            disabled={!canOpen || isOpening}
                            leftIcon={
                              isOpening ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <ExternalLink className="h-3.5 w-3.5" />
                              )
                            }
                            onClick={() => void openCreative(post)}
                          >
                            {isOpening ? "Opening…" : "Open"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-surface-400">
                    <th className="text-left py-2 px-2">Creative</th>
                    <th className="text-left py-2 px-2">When</th>
                    <th className="text-left py-2 px-2">Salesperson</th>
                    <th className="text-left py-2 px-2">Customer</th>
                    <th className="text-left py-2 px-2">Style / Tone</th>
                    <th className="text-left py-2 px-2">Status</th>
                    <th className="text-right py-2 px-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => {
                    const canOpen = Boolean(
                      p.creative_image_url && !p.image_review_required,
                    );
                    const isOpening = openingId === p.id;
                    return (
                      <tr
                        key={p.id}
                        className="border-t border-hairline hover:bg-fill-subtle transition-colors"
                      >
                        <td className="py-2 px-2">
                          {canOpen ? (
                            <button
                              type="button"
                              onClick={() => void openCreative(p)}
                              disabled={isOpening}
                              className="h-12 w-12 overflow-hidden rounded-lg border border-hairline bg-surface-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                              aria-label="Open creative"
                            >
                              <img
                                src={p.creative_image_url}
                                alt=""
                                className="h-full w-full object-cover"
                                loading="lazy"
                              />
                            </button>
                          ) : (
                            <div
                              className="flex h-12 w-12 items-center justify-center rounded-lg border border-hairline bg-surface-950/80 text-surface-600"
                              title={
                                p.image_review_required
                                  ? "Image held for current on-pixel safety review"
                                  : "No image stored (older log)"
                              }
                            >
                              <ImageIcon className="h-4 w-4" />
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-2 text-surface-300 whitespace-nowrap">
                          {formatWhen(p.generated_at)}
                        </td>
                        <td className="py-2 px-2 text-surface-50 font-semibold">
                          {p.salesperson_name || (
                            <span className="text-surface-400 italic">
                              unattributed
                            </span>
                          )}
                          {p.salesperson_name && !p.attribution_authoritative ? (
                            <div className="text-[10px] font-normal text-warning-200">
                              legacy attribution
                            </div>
                          ) : null}
                        </td>
                        <td className="py-2 px-2 text-surface-200">
                          {toPublicCustomerLabel(p.customer_name) || "—"}
                        </td>
                        <td className="py-2 px-2 text-surface-300">
                          <span className="text-[11px]">
                            {p.style || "—"}
                            {p.tone ? ` · ${p.tone}` : ""}
                          </span>
                          <div className="flex items-center gap-2 text-[10px] mt-0.5">
                            {p.has_video && (
                              <span className="inline-flex items-center gap-1 text-primary-200">
                                <Film className="h-3 w-3" /> video
                              </span>
                            )}
                            {p.has_release && (
                              <span className="inline-flex items-center gap-1 text-success-200">
                                <ShieldCheck className="h-3 w-3" /> release
                              </span>
                            )}
                            {p.scheduled_for && (
                              <span className="inline-flex items-center gap-1 text-emerald-300">
                                <Calendar className="h-3 w-3" /> share time set
                              </span>
                            )}
                            {websiteStatusBadge(p.website_publication)}
                          </div>
                        </td>
                        <td className="py-2 px-2">
                          {statusBadge(p.approval_status)}
                          {p.approval_status === "rejected" && p.rejection_reason ? (
                            // Without this the row says "rejected" and the
                            // salesperson has to go ask why.
                            <span className="mt-0.5 block max-w-[22rem] text-[11px] leading-snug text-error-200 [.theme-light_&]:text-error-800">
                              {p.rejection_reason}
                            </span>
                          ) : null}
                          {p.approved_by && (
                            <div className="text-[10px] text-surface-400">
                              by {p.approved_by}
                            </div>
                          )}
                          {p.website_publication?.lastError &&
                          (p.website_publication.status === "failed" ||
                            p.website_publication.status === "draft_ready") ? (
                            <div
                              className="mt-1 max-w-44 truncate text-[10px] text-warning-200"
                              title={p.website_publication.lastError}
                            >
                              Website status check needs attention
                            </div>
                          ) : null}
                        </td>
                        <td className="py-2 px-2 text-right">
                          <div className="flex justify-end gap-1.5">
                            {!p.image_review_required &&
                            safeWebsiteReviewUrl(p.website_publication?.reviewUrl) ? (
                              <a
                                href={safeWebsiteReviewUrl(
                                  p.website_publication?.reviewUrl,
                                )}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-success-400/25 bg-success-500/10 px-2 text-[10px] font-semibold text-success-100 [.theme-light_&]:text-success-900"
                                title="Review private website draft"
                              >
                                <Globe2 className="h-3 w-3" /> Site
                              </a>
                            ) : null}
                            {!p.image_review_required &&
                            (p.website_publication?.status === "failed" ||
                              (p.website_publication?.status === "draft_ready" &&
                                p.website_publication.lastError)) ? (
                              <button
                                type="button"
                                disabled={Boolean(websiteRetryingId)}
                                onClick={() => void retryWebsite(p)}
                                className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-error-400/25 bg-error-500/10 px-2 text-[10px] font-semibold text-error-100 disabled:opacity-50 [.theme-light_&]:text-error-800"
                              >
                                <RefreshCw
                                  className={cn(
                                    "h-3 w-3",
                                    websiteRetryingId === p.id && "animate-spin",
                                  )}
                                />
                                {p.website_publication.status === "draft_ready"
                                  ? "Retry status"
                                  : "Retry"}
                              </button>
                            ) : null}
                            <Button
                              type="button"
                              size="sm"
                              variant={canOpen ? "outline" : "ghost"}
                              disabled={!canOpen || isOpening}
                              leftIcon={
                                isOpening ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <ExternalLink className="h-3.5 w-3.5" />
                                )
                              }
                              onClick={() => void openCreative(p)}
                              title={
                                canOpen
                                  ? "Open for share / export"
                                  : p.image_review_required
                                    ? "Image held for current on-pixel safety review"
                                    : "No creative image on this older log"
                              }
                            >
                              {isOpening ? "Opening…" : "Open"}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </m.div>
        )}
      </AnimatePresence>

      {nextCursor ? (
        <div className="flex justify-center pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => void load(nextCursor)}
            disabled={loading || loadingMore}
            leftIcon={
              loadingMore ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <History className="h-4 w-4" />
              )
            }
          >
            {loadingMore ? "Loading older posts…" : "Load older posts"}
          </Button>
        </div>
      ) : null}

      <p className="text-[11px] text-surface-400 leading-relaxed flex items-start gap-1.5">
        <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        Open loads the stored creative into the post studio for copy, share, and
        multi-size export — no AI regeneration. Older rows without an image cannot be
        reopened.
      </p>
    </m.div>
  );
};
