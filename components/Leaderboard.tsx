import React, { useCallback, useEffect, useRef, useState } from "react";
import { Trophy, Film, ShieldCheck, RefreshCw, Download } from "lucide-react";
import { Button } from "./ui/Button";
import { EmptyState } from "./ui/EmptyState";
import { ErrorBanner } from "./ui/ErrorBanner";
import { Skeleton } from "./ui/Skeleton";
import { cn } from "../utils/classNames";
import { toUiMessage } from "../utils/errorMessages";
import { getLeaderboard, LeaderboardEntry } from "../services/posts";
import { useAppStore } from "../stores/appStore";

type RangeKey = "week" | "month" | "30d" | "all";

/**
 * `phrase` finishes "N posts …" and "No posts …", so the summary line names
 * the active range in the manager's words instead of "in window".
 */
const RANGES: { key: RangeKey; label: string; phrase: string }[] = [
  { key: "week", label: "This week", phrase: "this week" },
  { key: "month", label: "This month", phrase: "this month" },
  { key: "30d", label: "Last 30 days", phrase: "in the last 30 days" },
  { key: "all", label: "All time", phrase: "all time" },
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
        setError(toUiMessage(err, "Could not load the leaderboard."));
    } finally {
      if (reqIdRef.current === myId) setLoading(false);
    }
  }, [currentDealer, range]);

  useEffect(() => {
    void load();
  }, [load]);

  const total = entries.reduce((acc, e) => acc + e.count, 0);
  const rangePhrase = RANGES.find((r) => r.key === range)?.phrase ?? RANGES[0].phrase;

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
    <section
      aria-labelledby="leaderboard-heading"
      className="space-y-4 rounded-md border border-hairline bg-panel p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 id="leaderboard-heading" className="text-ink">
            Salesperson leaderboard
          </h3>
          <p className="mt-0.5 text-sm text-ink-2">
            {`${total} post${total === 1 ? "" : "s"} ${rangePhrase.toLowerCase()}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="md"
            leftIcon={<Download className="h-4 w-4" />}
            onClick={exportCsv}
            disabled={entries.length === 0}
            title="Export leaderboard as CSV"
          >
            Export CSV
          </Button>
          <Button
            variant="ghost"
            size="md"
            leftIcon={<RefreshCw className="h-4 w-4" />}
            loading={loading}
            onClick={() => void load()}
            disabled={loading}
          >
            Refresh
          </Button>
        </div>
      </div>

      <div
        role="group"
        aria-label="Leaderboard range"
        className="grid grid-cols-2 gap-1 rounded-sm border border-hairline bg-panel-raised p-1 sm:inline-grid sm:grid-cols-4"
      >
        {RANGES.map((r) => {
          const selected = range === r.key;
          return (
            <button
              key={r.key}
              type="button"
              aria-pressed={selected}
              onClick={() => setRange(r.key)}
              className={cn(
                "min-h-11 rounded-sm px-3 text-sm font-semibold transition-colors duration-120 ease-out",
                selected ? "bg-overlay text-ink" : "text-ink-2 hover:text-ink",
              )}
            >
              {r.label}
            </button>
          );
        })}
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      {loading && entries.length === 0 ? (
        <div className="divide-y divide-hairline" aria-label="Loading leaderboard">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-3">
              <Skeleton width={24} height={24} />
              <div className="flex-1 space-y-2">
                <Skeleton width="45%" height={12} />
                <Skeleton width="30%" height={10} />
              </div>
              <Skeleton width={32} height={24} />
            </div>
          ))}
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={Trophy}
          title={range === "all" ? "No posts yet" : `No posts ${rangePhrase}`}
          description="Tell your team — first one on the board gets bragging rights."
        />
      ) : (
        <ol className="divide-y divide-hairline" aria-label="Salespeople by posts">
          {entries.map((entry, idx) => (
            <li key={entry.salesperson} className="flex items-center gap-3 py-3">
              <span
                className="grid h-6 w-6 shrink-0 place-items-center rounded-sm bg-panel-raised font-display text-sm font-medium tabular-nums text-ink"
                aria-hidden="true"
              >
                {idx + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-ink">
                  {entry.salesperson}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-ink-2">
                  {entry.videoCount > 0 && (
                    <span className="flex items-center gap-1" title="Posts with video">
                      <Film className="h-3.5 w-3.5" aria-hidden="true" />
                      {entry.videoCount}
                      <span className="sr-only"> with video</span>
                    </span>
                  )}
                  {entry.releaseCount > 0 && (
                    <span
                      className="flex items-center gap-1"
                      title="Posts with signed release"
                    >
                      <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                      {entry.releaseCount}
                      <span className="sr-only"> with a signed release</span>
                    </span>
                  )}
                  {(() => {
                    const t = entry.lastPostedAt ? Date.parse(entry.lastPostedAt) : NaN;
                    return Number.isNaN(t) ? null : (
                      <span>Last {new Date(t).toLocaleDateString()}</span>
                    );
                  })()}
                </div>
              </div>
              {/* Hero metric — the count is the point of a leaderboard, so it
                  dominates the row. */}
              <div className="shrink-0 text-right">
                <div className="font-display text-2xl font-semibold leading-7 tabular-nums text-ink">
                  {entry.count}
                </div>
                <div className="text-caption text-ink-2">
                  {entry.count === 1 ? "post" : "posts"}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
};
