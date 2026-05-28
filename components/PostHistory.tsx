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
} from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { EmptyState } from "./ui/EmptyState";
import { ErrorBanner } from "./ui/ErrorBanner";
import { Skeleton } from "./ui/Skeleton";
import { PostRecord, ApprovalStatus } from "../services/posts";
import { useAppStore } from "../stores/appStore";
import { cn } from "../utils/classNames";

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
        <span className="inline-flex items-center gap-1 text-error-200 text-[11px]">
          <XCircle className="h-3 w-3" /> rejected
        </span>
      );
    default:
      return null;
  }
};

/**
 * Searchable, filterable history of every post logged against the current
 * dealership. Lives inside AdminDashboard. Backs onto the session-gated
 * /api/app/posts endpoint (server-side parameterized filters, no injection).
 */
export const PostHistory: React.FC = () => {
  const dealer = useAppStore((s) => s.currentDealer);
  const [items, setItems] = useState<PostRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ApprovalStatus | "all">("all");

  // Monotonic request id: toggling `statusFilter` fast can resolve responses
  // out of order — only the most recent request is allowed to write state.
  const reqIdRef = useRef(0);
  const load = useCallback(async () => {
    if (!dealer) return;
    const myId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ limit: "200" });
      if (statusFilter !== "all") qs.set("approval_status", statusFilter);
      const res = await fetch(`/api/app/posts?${qs.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`/api/app/posts ${res.status}`);
      const body = (await res.json()) as { items: PostRecord[] };
      if (reqIdRef.current === myId) setItems(body.items || []);
    } catch (err) {
      if (reqIdRef.current === myId)
        setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (reqIdRef.current === myId) setLoading(false);
    }
  }, [dealer, statusFilter]);

  useEffect(() => {
    void load();
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
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [items, query]);

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
      ]),
    ];
    const csv = rows
      .map((r) =>
        r
          .map((cell) => {
            let s = String(cell);
            // CSV formula-injection guard: a cell beginning with = + - @ (or a
            // control char) is executed as a formula when the export is opened
            // in Excel/Sheets. These fields are salesperson-controlled free
            // text, so neutralize with a leading apostrophe.
            if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
            return `"${s.replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
          })
          .join(",")
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
      className="bg-white/5 border border-white/10 rounded-2xl p-4 sm:p-6 space-y-4 shadow-elevation-2 backdrop-blur-xl"
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
              Post History
            </h3>
            <p className="text-xs text-surface-400">
              {filtered.length} of {items.length}{" "}
              {items.length === 1 ? "post" : "posts"} shown
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
            title="Download visible rows as CSV for compliance / reporting"
          >
            Export CSV
          </Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none" />
          <Input
            label=""
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, VIN, salesperson, style…"
            fullWidth
            className="bg-white/5 border-white/10 focus:border-primary-400 pl-9"
          />
        </div>
        <div className="flex bg-surface-950/40 p-1 rounded-xl border border-white/5 overflow-x-auto">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap",
                statusFilter === f.key
                  ? "bg-primary-500/30 text-primary-100"
                  : "text-surface-400 hover:text-surface-200"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

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
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-surface-900/40 px-3 py-3"
              >
                <Skeleton variant="rectangular" width={40} height={40} />
                <div className="flex-1 space-y-2">
                  <Skeleton width="55%" height={12} />
                  <Skeleton width="35%" height={10} />
                </div>
                <Skeleton width={64} height={20} />
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
                description="Posts your team generates for this dealership will show up here, with VIN, salesperson, and approval status."
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
            className="overflow-x-auto -mx-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-surface-400">
                  <th className="text-left py-2 px-2">When</th>
                  <th className="text-left py-2 px-2">Salesperson</th>
                  <th className="text-left py-2 px-2">Customer</th>
                  <th className="text-left py-2 px-2">VIN</th>
                  <th className="text-left py-2 px-2">Style / Tone</th>
                  <th className="text-left py-2 px-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr
                    key={p.id}
                    className="border-t border-white/5 hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="py-2 px-2 text-surface-300 whitespace-nowrap">
                      {formatWhen(p.generated_at)}
                    </td>
                    <td className="py-2 px-2 text-surface-50 font-semibold">
                      {p.salesperson_name || (
                        <span className="text-surface-500 italic">unattributed</span>
                      )}
                    </td>
                    <td className="py-2 px-2 text-surface-200">
                      {p.customer_name || "—"}
                    </td>
                    <td className="py-2 px-2 text-surface-400 font-mono text-[11px]">
                      {p.vin || "—"}
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
                  </tr>
                ))}
              </tbody>
            </table>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
