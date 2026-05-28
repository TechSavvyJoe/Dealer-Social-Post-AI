import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Trophy, Film, ShieldCheck, Loader2, RefreshCw } from "lucide-react";
import { Button } from "./ui/Button";
import {
  getLeaderboard,
  LeaderboardEntry,
} from "../services/posts";
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
          0
        )
      );
    }
    case "month":
      return new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)
      );
    case "30d": {
      return new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate() - 30,
          0,
          0,
          0,
          0
        )
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
  if (rank === 1) return "text-slate-300";
  if (rank === 2) return "text-orange-400";
  return "text-surface-500";
};

export const Leaderboard: React.FC = () => {
  const currentDealer = useAppStore((s) => s.currentDealer);
  const [range, setRange] = useState<RangeKey>("week");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useMemo(
    () => async () => {
      if (!currentDealer) return;
      setLoading(true);
      setError(null);
      try {
        const since = startOfRange(range);
        const data = await getLeaderboard(currentDealer.id, since);
        setEntries(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [currentDealer, range]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const total = entries.reduce((acc, e) => acc + e.count, 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white/5 border border-white/15 rounded-2xl p-4 sm:p-6 space-y-4"
    >
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          {/* Brand accent stripe — visible white-label cue regardless of logo presence */}
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
              <Trophy className="h-5 w-5 text-amber-400" />
              Salesperson Leaderboard
            </h3>
            <p className="text-xs text-surface-400">
              {total} post{total === 1 ? "" : "s"} in window
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-surface-950/40 p-1 rounded-xl border border-white/5">
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

      {error && (
        <div className="rounded-xl border border-error-700/50 bg-error-900/40 px-3 py-2 text-error-100 text-xs">
          {error}
        </div>
      )}

      <AnimatePresence mode="wait">
        {loading && entries.length === 0 ? (
          <motion.div
            key="loading"
            className="py-12 flex items-center justify-center text-surface-400 text-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
          </motion.div>
        ) : entries.length === 0 ? (
          <motion.div
            key="empty"
            className="py-12 text-center text-sm text-surface-400"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            No posts yet in this window. Tell your team — first one on the
            board gets bragging rights.
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
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-surface-900/40 px-3 py-2.5"
              >
                <div className="flex-shrink-0 w-9 h-9 rounded-full bg-white/5 flex items-center justify-center">
                  {idx < 3 ? (
                    <Trophy className={`h-4 w-4 ${trophyTint(idx)}`} />
                  ) : (
                    <span className="text-xs text-surface-400 font-mono">
                      {ordinal(idx + 1)}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-surface-50 truncate">
                    {entry.salesperson}
                  </div>
                  <div className="text-[10px] text-surface-500 flex items-center gap-3">
                    <span>
                      Last post {new Date(entry.lastPostedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs flex-shrink-0">
                  {entry.videoCount > 0 && (
                    <span
                      className="flex items-center gap-1 text-primary-200"
                      title="Posts with video"
                    >
                      <Film className="h-3 w-3" /> {entry.videoCount}
                    </span>
                  )}
                  {entry.releaseCount > 0 && (
                    <span
                      className="flex items-center gap-1 text-success-200"
                      title="Posts with signed release"
                    >
                      <ShieldCheck className="h-3 w-3" /> {entry.releaseCount}
                    </span>
                  )}
                  <span className="text-lg font-bold text-surface-50 tabular-nums">
                    {entry.count}
                  </span>
                </div>
              </motion.li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
