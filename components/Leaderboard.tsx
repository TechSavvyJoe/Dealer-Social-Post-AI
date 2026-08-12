import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Trophy, Film, ShieldCheck, Loader2, RefreshCw, Download } from "lucide-react";
import { Button } from "./ui/Button";
import { EmptyState } from "./ui/EmptyState";
import { ErrorBanner } from "./ui/ErrorBanner";
import { Skeleton } from "./ui/Skeleton";
import { cn } from "../utils/classNames";
import { getLeaderboard, LeaderboardEntry } from "../services/posts";
import { useAppStore } from "../stores/appStore";

type RangeKey = "week" | "month" | "30d" | "all";

const RANGES: { key: RangeKey; label: string; days?: number }[] = [
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "30d", label: "Last 30 days" },
  { key: "all", label: "All-time" },
];

/**
 * Range boundaries are computed in UTC to match how PocketBase stores
 * `generated_at` (always ISO 8601 UTC). Using local time here caused
 * posts made near midnight to flicker between "this week" and "last week"
 * depending on the viewer's clock. Now: a post is in a week iff its UTC
 * timestamp falls between the UTC Monday and now in UTC.
 */
const startOfRange = (range: RangeKey): Date => {
  const now = new Date();
  switch (range) {
    case "week": {
      const day = now.getUTCDay(); // 0=Sunday, 1=Monday, ...
      const diff = (day + 6) % 7; // Monday-start offset
      return new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate() - diff,
          0,
          0,
          0,
          0,
        ),
      );
    }
    case "month":
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
    case "30d": {
      return new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate() - 30,
          0,
          0,
          0,
          0,
        ),
      );
    }
    case "all":
    default:
      return new Date(Date.UTC(2000, 0, 1));
  }
};

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

const trophyTint = (rank: number) => {
  if (rank === 0) return "text-amber-400";
  if (rank === 1) return "text-surface-300";
  if (rank === 2) return "text-orange-400";
  return "text-surface-500";
};

export const Leaderboard: React.FC = () => {
  const currentDealer = useAppStore((s) => s.currentDealer);
  const [range, setRange] = useState<RangeKey>("week");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Monotonic request id: when `range`/dealer changes quickly, an older fetch
  // can resolve after a newer one — only the latest request may write state.
  const reqIdRef = useRef(0);
  const load = useCallback(async () => {
    if (!currentDealer) return;
    const myId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const since = startOfRange(range);
      const data = await getLeaderboard(currentDealer.id, since);
      if (reqIdRef.current === myId) setEntries(data);
    } catch (err) {
      if (reqIdRef.current === myId)
        setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (reqIdRef.current === myId) setLoading(false);
    }
  }, [currentDealer, range]);

  useEffect(() => {
    void load();
  }, [load]);

  const total = entries.reduce((acc, e) => acc + e.count, 0);

  const exportCsv = React.useCallback(() => {
    const rows = [
      [
        "rank",
        "salesperson",
        "posts_count",
        "video_count",
        "release_count",
        "last_posted_at",
      ],
      ...entries.map((e, idx) => [
        idx + 1,
        e.salesperson || "",
        e.count,
        e.videoCount,
        e.releaseCount,
        e.lastPostedAt || "",
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

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `leaderboard-${currentDealer?.name || "dealer"}-${range}-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [entries, currentDealer?.name, range]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg border border-hairline bg-surface-overlay p-4 sm:p-6 space-y-4"
    >
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          {/* Brand accent stripe — visible white-label cue regardless of logo presence */}
          <div
            className="h-8 w-1.5 rounded-full"
            style={{ background: "var(--brand-primary)" }}
            aria-hidden="true"
          />
          <div>
            <h3 className="text-xl font-bold text-surface-50 flex items-center gap-2">
              <Trophy className="h-5 w-5 text-amber-400" />
              Salesperson Leaderboard
            </h3>
            <p className="text-xs text-surface-400">
              {total} post{total === 1 ? "" : "s"} in window
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex bg-surface-950/60 p-1 rounded-xl border border-surface-800">
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  range === r.key
                    ? "bg-primary-500/30 text-primary-100"
                    : "text-surface-400 hover:text-surface-200"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<Download className="h-3.5 w-3.5" />}
            onClick={exportCsv}
            disabled={entries.length === 0}
            title="Export leaderboard as CSV"
          >
            Export CSV
          </Button>
          <Button
            variant="ghost"
            size="sm"
            leftIcon={
              loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )
            }
            onClick={() => void load()}
            disabled={loading}
          >
            Refresh
          </Button>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      <AnimatePresence mode="wait">
        {loading && entries.length === 0 ? (
          <motion.div
            key="loading"
            className="space-y-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            aria-label="Loading leaderboard"
          >
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-xl border border-surface-800 bg-surface-900/40 px-3 py-2.5"
              >
                <Skeleton variant="circular" width={36} height={36} />
                <div className="flex-1 space-y-2">
                  <Skeleton width="45%" height={12} />
                  <Skeleton width="30%" height={10} />
                </div>
                <Skeleton width={32} height={24} />
              </div>
            ))}
          </motion.div>
        ) : entries.length === 0 ? (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <EmptyState
              icon={Trophy}
              title="No posts yet in this window"
              description="Tell your team — first one on the board gets bragging rights."
            />
          </motion.div>
        ) : (
          <motion.ul
            key="entries"
            className="space-y-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {entries.map((entry, idx) => (
              <motion.li
                key={entry.salesperson}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.03 }}
                className={cn(
                  "flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors",
                  idx === 0
                    ? "border-amber-400/30 bg-amber-500/[0.06]"
                    : "border-surface-800 bg-surface-900/40",
                )}
              >
                <div
                  className={cn(
                    "flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center",
                    idx === 0 ? "bg-amber-500/15" : "bg-fill-subtle",
                  )}
                >
                  {idx < 3 ? (
                    <Trophy className={`h-4 w-4 ${trophyTint(idx)}`} />
                  ) : (
                    <span className="text-xs text-surface-400 font-semibold tabular-nums">
                      {ordinal(idx + 1)}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-surface-50 truncate">
                    {entry.salesperson}
                  </div>
                  <div className="text-[11px] text-surface-500 flex items-center gap-3 mt-0.5">
                    {entry.videoCount > 0 && (
                      <span
                        className="flex items-center gap-1 text-primary-300/80"
                        title="Posts with video"
                      >
                        <Film className="h-3 w-3" /> {entry.videoCount}
                      </span>
                    )}
                    {entry.releaseCount > 0 && (
                      <span
                        className="flex items-center gap-1 text-success-300/80"
                        title="Posts with signed release"
                      >
                        <ShieldCheck className="h-3 w-3" /> {entry.releaseCount}
                      </span>
                    )}
                    {(() => {
                      const t = entry.lastPostedAt
                        ? Date.parse(entry.lastPostedAt)
                        : NaN;
                      return Number.isNaN(t) ? null : (
                        <span>Last {new Date(t).toLocaleDateString()}</span>
                      );
                    })()}
                  </div>
                </div>
                {/* Hero metric — the count is the point of a leaderboard, so it
                    dominates the row. */}
                <div className="flex-shrink-0 text-right leading-none">
                  <div
                    className={cn(
                      "text-2xl font-extrabold tabular-nums",
                      idx === 0 ? "text-amber-200" : "text-surface-50",
                    )}
                  >
                    {entry.count}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-surface-500 mt-0.5">
                    {entry.count === 1 ? "post" : "posts"}
                  </div>
                </div>
              </motion.li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
