import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
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
} from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { EmptyState } from "./ui/EmptyState";
import { ErrorBanner } from "./ui/ErrorBanner";
import { Skeleton } from "./ui/Skeleton";
import {
  PostRecord,
  ApprovalStatus,
  fetchPostCreativeDataUrl,
  listPostsPage,
} from "../services/posts";
import { useAppStore } from "../stores/appStore";
import { AppStep, GeneratedPost } from "../types";
import { cn } from "../utils/classNames";
import { useToast } from "./ui/Toast";
import { LocalMediaArchive } from "./LocalMediaArchive";

const STATUS_FILTERS: Array<{ key: ApprovalStatus | "all"; label: string }> = [
  { key: "all", label: "All" },
  { key: "approved", label: "Approved" },
  { key: "pending", label: "Pending" },
  { key: "rejected", label: "Rejected" },
  { key: "n_a", label: "No review" },
];
const HISTORY_PAGE_SIZE = 50;

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
        <span className="inline-flex items-center gap-1 text-error-200 text-[11px]">
          <XCircle className="h-3 w-3" /> rejected
        </span>
      );
    default:
      return null;
  }
};

/**
 * Searchable history of posts for the current dealership.
 * Posts with a stored creative can be reopened for share/export without regen.
 */
interface PostHistoryProps {
  onOpenCreative?: () => void;
}

export const PostHistory: React.FC<PostHistoryProps> = ({ onOpenCreative }) => {
  const dealer = useAppStore((s) => s.currentDealer);
  const role = useAppStore((s) => s.role);
  const currentPersonId = useAppStore((s) => s.currentPerson?.id || "");
  const setGeneratedPost = useAppStore((s) => s.setGeneratedPost);
  const setSelectedImage = useAppStore((s) => s.setSelectedImage);
  const setStep = useAppStore((s) => s.setStep);
  const { success: toastSuccess, error: toastError } = useToast();
  const [items, setItems] = useState<PostRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ApprovalStatus | "all">("all");
  const [openingId, setOpeningId] = useState<string | null>(null);

  const reqIdRef = useRef(0);
  const load = useCallback(
    async (cursor?: string) => {
      if (!dealer) return;
      const append = Boolean(cursor);
      const myId = ++reqIdRef.current;
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setItems([]);
        setNextCursor(null);
      }
      setError(null);
      try {
        const page = await listPostsPage({
          limit: HISTORY_PAGE_SIZE,
          approvalStatus: statusFilter,
          cursor,
        });
        if (reqIdRef.current === myId) {
          setItems((current) => {
            if (!append) return page.items;
            const seen = new Set(current.map((post) => post.id));
            return [...current, ...page.items.filter((post) => !seen.has(post.id))];
          });
          setNextCursor(page.nextCursor || null);
        }
      } catch (err) {
        if (reqIdRef.current === myId)
          setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (reqIdRef.current === myId) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [dealer, statusFilter],
  );

  useEffect(() => {
    void load(undefined);
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((p) => {
      const haystack = [
        p.salesperson_name,
        p.customer_name,
        p.vin,
        p.style,
        p.tone,
        p.approved_by,
        p.caption,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [items, query]);

  const openCreative = useCallback(
    async (post: PostRecord) => {
      if (!post.creative_image_url) {
        toastError("No stored image for this post — only caption logs exist.");
        return;
      }
      setOpeningId(post.id);
      try {
        const image = await fetchPostCreativeDataUrl(post.creative_image_url);
        const approval =
          (post.approval_status as GeneratedPost["approvalStatus"]) || "n_a";
        const generated: GeneratedPost = {
          image,
          text: (post.caption || "").trim() || "—",
          captionSource: post.caption_source || undefined,
          isBasicFallback: post.caption_source === "basic_fallback",
          disclosures: post.disclosures || undefined,
          postId: post.id,
          approvalStatus: approval,
          releaseStatus: post.has_release
            ? "saved"
            : post.release_required && post.release_status !== "saved"
              ? "save_failed"
              : "not_required",
          historyReadOnly:
            role !== "salesperson" &&
            (!currentPersonId || post.salesperson_id !== currentPersonId),
          platformIds:
            post.platform_ids && post.platform_ids.length > 0
              ? post.platform_ids
              : undefined,
          platformCaptions: post.platform_captions,
          primaryFormatId: post.primary_format_id || undefined,
          imageAspectRatio: post.image_aspect_ratio || undefined,
        };
        // A stored creative may come from another device/session, so it does
        // not have the original capture needed for a true same-photo remix.
        // Clear any stale capture and expose only safe share/export actions.
        setSelectedImage(null);
        setGeneratedPost(generated);
        setStep(AppStep.RESULT);
        onOpenCreative?.();
        toastSuccess("Creative reopened — share or export without regenerating.");
      } catch (err) {
        toastError(
          err instanceof Error ? err.message : "Could not open this creative.",
        );
      } finally {
        setOpeningId(null);
      }
    },
    [
      onOpenCreative,
      currentPersonId,
      role,
      setGeneratedPost,
      setSelectedImage,
      setStep,
      toastError,
      toastSuccess,
    ],
  );

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
      ],
      ...filtered.map((p) => [
        p.generated_at || "",
        p.salesperson_name || "",
        p.customer_name || "",
        p.vin || "",
        p.style || "",
        p.tone || "",
        p.has_video ? "true" : "false",
        p.has_release ? "true" : "false",
        p.approval_status || "",
        p.approved_by || "",
        p.approved_at || "",
        p.creative_image_url ? "true" : "false",
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
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-surface-900/60 border border-surface-800 rounded-2xl p-4 sm:p-6 space-y-4 shadow-elevation-2 backdrop-blur-xl"
    >
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div
            className="h-8 w-1.5 rounded-full"
            style={{
              background:
                "linear-gradient(180deg, var(--brand-primary-400), var(--brand-primary))",
            }}
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
              {nextCursor ? " · older posts available" : " · archive up to date"}
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
            className="bg-white/5 border-white/10 focus:border-primary-400 pl-9"
          />
        </div>
        <div className="flex bg-surface-950/60 p-1 rounded-xl border border-surface-800 overflow-x-auto">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap",
                statusFilter === f.key
                  ? "bg-primary-500/30 text-primary-100"
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
          <motion.div
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
          </motion.div>
        ) : filtered.length === 0 ? (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {items.length === 0 ? (
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
                description={`Nothing matches “${query}”. Try a different name, VIN, or style.`}
              />
            )}
          </motion.div>
        ) : (
          <motion.div
            key="rows"
            className="space-y-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="space-y-2 md:hidden">
              {filtered.map((post) => {
                const canOpen = Boolean(post.creative_image_url);
                const isOpening = openingId === post.id;
                return (
                  <article
                    key={post.id}
                    className="flex min-w-0 gap-3 rounded-xl border border-white/8 bg-surface-950/35 p-3"
                  >
                    {canOpen ? (
                      <button
                        type="button"
                        onClick={() => void openCreative(post)}
                        disabled={isOpening}
                        className="h-20 w-16 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-surface-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
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
                        className="flex h-20 w-16 shrink-0 items-center justify-center rounded-lg border border-white/5 bg-surface-950/80 text-surface-600"
                        aria-label="No stored image"
                      >
                        <ImageIcon className="h-5 w-5" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-surface-50">
                            {post.customer_name ||
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
                        {post.caption || `${post.style || "Post"} · ${post.tone || ""}`}
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
                        </div>
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
                    const canOpen = Boolean(p.creative_image_url);
                    const isOpening = openingId === p.id;
                    return (
                      <tr
                        key={p.id}
                        className="border-t border-white/5 hover:bg-white/[0.02] transition-colors"
                      >
                        <td className="py-2 px-2">
                          {p.creative_image_url ? (
                            <button
                              type="button"
                              onClick={() => void openCreative(p)}
                              disabled={isOpening}
                              className="h-12 w-12 overflow-hidden rounded-lg border border-white/10 bg-surface-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
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
                              className="flex h-12 w-12 items-center justify-center rounded-lg border border-white/5 bg-surface-950/80 text-surface-600"
                              title="No image stored (older log)"
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
                            <span className="text-surface-500 italic">
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
                          {p.customer_name || "—"}
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
                                <Calendar className="h-3 w-3" /> scheduled
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2 px-2">
                          {statusBadge(p.approval_status)}
                          {p.approved_by && (
                            <div className="text-[10px] text-surface-500">
                              by {p.approved_by}
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-2 text-right">
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
                                : "No creative image on this older log"
                            }
                          >
                            {isOpening ? "Opening…" : "Open"}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {nextCursor ? (
              <div className="flex justify-center pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void load(nextCursor)}
                  disabled={loadingMore}
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
          </motion.div>
        )}
      </AnimatePresence>

      <p className="text-[11px] text-surface-500 leading-relaxed flex items-start gap-1.5">
        <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        Open loads the stored creative into the post studio for copy, share, and
        multi-size export — no AI regeneration. Older rows without an image cannot be
        reopened.
      </p>
    </motion.div>
  );
};
