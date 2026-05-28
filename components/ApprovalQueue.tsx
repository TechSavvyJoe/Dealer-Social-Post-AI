import React, { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  X,
  Clock,
  Loader2,
  RefreshCw,
  Film,
  ShieldCheck,
} from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import {
  listPendingPosts,
  setApprovalStatus,
  PostRecord,
} from "../services/posts";
import { useAppStore } from "../stores/appStore";

const formatTime = (iso: string) => {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMin = Math.round((now.getTime() - d.getTime()) / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.round(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
};

export const ApprovalQueue: React.FC = () => {
  const currentDealer = useAppStore((s) => s.currentDealer);
  const [pending, setPending] = useState<PostRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approver, setApprover] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    if (!currentDealer) return;
    setLoading(true);
    setError(null);
    try {
      const items = await listPendingPosts(currentDealer.id);
      setPending(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [currentDealer]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAction = async (
    post: PostRecord,
    status: "approved" | "rejected"
  ) => {
    if (!approver.trim()) {
      setError("Enter your manager name first so the approval is logged.");
      return;
    }
    setError(null);
    setBusy((b) => ({ ...b, [post.id]: true }));
    try {
      await setApprovalStatus(post.id, status, approver.trim());
      setPending((prev) => prev.filter((p) => p.id !== post.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy((b) => ({ ...b, [post.id]: false }));
    }
  };

  // Hide the entire queue if this dealer doesn't use the approval gate.
  if (currentDealer && !currentDealer.requires_approval && pending.length === 0) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white/5 border border-white/15 rounded-2xl p-4 sm:p-6 space-y-4"
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
              <Clock className="h-5 w-5 text-amber-400" />
              Pending Approvals
            </h3>
            <p className="text-xs text-surface-400">
              {pending.length} post{pending.length === 1 ? "" : "s"} awaiting manager review
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
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

      <Input
        label="Reviewing as (manager name — required to approve)"
        value={approver}
        onChange={(e) => setApprover(e.target.value)}
        placeholder="e.g. Joe G. (GSM)"
        fullWidth
        className="bg-white/5 border-white/10 focus:border-primary-400"
      />

      {error && (
        <div className="rounded-xl border border-error-700/50 bg-error-900/40 px-3 py-2 text-error-100 text-xs">
          {error}
        </div>
      )}

      <AnimatePresence>
        {pending.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="py-8 text-center text-sm text-surface-400"
          >
            Nothing pending — your team's clear.
          </motion.div>
        ) : (
          <ul className="space-y-2">
            {pending.map((post) => (
              <motion.li
                key={post.id}
                layout
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="rounded-xl border border-white/10 bg-surface-900/40 p-3 flex flex-wrap items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-surface-50">
                    {post.salesperson_name || "Unattributed"}
                    {post.customer_name && (
                      <span className="text-surface-400 font-normal">
                        {" "}
                        · {post.customer_name}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-surface-400 flex items-center gap-2 flex-wrap mt-1">
                    <span>{formatTime(post.generated_at)}</span>
                    {post.style && <span>· {post.style}</span>}
                    {post.tone && <span>· {post.tone}</span>}
                    {post.vin && <span className="font-mono">· {post.vin}</span>}
                    {post.has_video && (
                      <span className="flex items-center gap-1 text-primary-200">
                        <Film className="h-3 w-3" /> video
                      </span>
                    )}
                    {post.has_release && (
                      <span className="flex items-center gap-1 text-success-200">
                        <ShieldCheck className="h-3 w-3" /> release
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    leftIcon={
                      busy[post.id] ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <X className="h-3.5 w-3.5" />
                      )
                    }
                    onClick={() => handleAction(post, "rejected")}
                    disabled={busy[post.id]}
                  >
                    Reject
                  </Button>
                  <Button
                    variant="filled"
                    size="sm"
                    leftIcon={
                      busy[post.id] ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )
                    }
                    onClick={() => handleAction(post, "approved")}
                    disabled={busy[post.id]}
                  >
                    Approve
                  </Button>
                </div>
              </motion.li>
            ))}
          </ul>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
