import React, { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  X,
  Clock,
  Loader2,
  Film,
  ShieldCheck,
  CheckCircle2,
  Calendar,
  RefreshCw,
} from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { EmptyState } from "./ui/EmptyState";
import { ErrorBanner } from "./ui/ErrorBanner";
import { listPendingPosts, setApprovalStatus, PostRecord } from "../services/posts";
import { useAppStore } from "../stores/appStore";
import { PUBLISH_TARGETS } from "../services/publishTargets";
import { toPublicCustomerLabel } from "../utils/customerIdentity";

const PLATFORM_LABELS = new Map(
  PUBLISH_TARGETS.map((target) => [target.id, target.label]),
);

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

  // Monotonic request id so a stale dealer's response can't overwrite the
  // current dealer's pending list if the dealer changes mid-fetch.
  const reqIdRef = useRef(0);
  const load = useCallback(async () => {
    if (!currentDealer) return;
    const myId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const items = await listPendingPosts(currentDealer.id);
      if (reqIdRef.current === myId) setPending(items);
    } catch (err) {
      if (reqIdRef.current === myId)
        setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (reqIdRef.current === myId) setLoading(false);
    }
  }, [currentDealer]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAction = async (post: PostRecord, status: "approved" | "rejected") => {
    if (status === "approved" && post.image_review_required) {
      setError(
        "This post is quarantined because its image predates the current on-pixel safety review. Reject it and have the salesperson create a new post from the original photo.",
      );
      return;
    }
    if (status === "approved" && post.identity_review_required) {
      setError(
        "This post is quarantined for customer-name review. Reject it and have the salesperson submit corrected copy.",
      );
      return;
    }
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
              <Clock className="h-5 w-5 text-amber-400" />
              Pending Approvals
            </h3>
            <p className="text-xs text-surface-400">
              {pending.length} post{pending.length === 1 ? "" : "s"} awaiting manager
              review
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
        className="bg-fill-subtle border-hairline focus:border-primary-400"
      />

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      <AnimatePresence>
        {loading && pending.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex min-h-32 items-center justify-center gap-2 text-sm text-surface-300"
            role="status"
          >
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading approval queue…
          </motion.div>
        ) : pending.length === 0 ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <EmptyState
              icon={CheckCircle2}
              title="All caught up"
              description="Nothing pending — your team's clear. New posts that need approval will appear here."
            />
          </motion.div>
        ) : (
          <ul className="space-y-2">
            {pending.map((post) => {
              const hasReviewCreative = Boolean(
                post.creative_image_url && post.caption,
              );
              const releaseReady =
                !post.release_required ||
                (post.has_release && post.release_status === "saved");
              const identityReviewRequired = Boolean(post.identity_review_required);
              const imageReviewRequired = Boolean(post.image_review_required);
              const canApprove =
                hasReviewCreative &&
                releaseReady &&
                !identityReviewRequired &&
                !imageReviewRequired;
              return (
                <motion.li
                  key={post.id}
                  layout
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="rounded-xl border border-surface-800 bg-surface-900/40 p-3 flex flex-wrap items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-surface-50">
                      {post.salesperson_name || "Unattributed"}
                      {toPublicCustomerLabel(post.customer_name) && (
                        <span className="text-surface-400 font-normal">
                          {" "}
                          · {toPublicCustomerLabel(post.customer_name)}
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
                      {post.scheduled_for && (
                        <span className="flex items-center gap-1 text-emerald-300">
                          <Calendar className="h-3 w-3" /> scheduled
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="order-3 grid w-full gap-3 rounded-xl border border-hairline bg-black/15 p-3 sm:grid-cols-[minmax(0,12rem)_1fr]">
                    {post.creative_image_url ? (
                      <img
                        src={post.creative_image_url}
                        alt={`Creative awaiting approval for ${toPublicCustomerLabel(post.customer_name) || "customer delivery"}`}
                        loading="lazy"
                        className="aspect-square w-full rounded-lg border border-hairline bg-surface-950 object-contain"
                      />
                    ) : (
                      <div className="flex aspect-square w-full items-center justify-center rounded-lg border border-dashed border-error-500/30 bg-error-500/5 px-3 text-center text-xs text-error-200">
                        Review image unavailable
                      </div>
                    )}
                    <div className="min-w-0 space-y-3">
                      <div>
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-surface-400">
                          Submitted caption
                        </p>
                        <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-surface-100">
                          {post.caption || "Review caption unavailable"}
                        </p>
                      </div>
                      {post.platform_captions &&
                      Object.keys(post.platform_captions).length > 0 ? (
                        <div className="space-y-2 rounded-lg border border-primary-400/20 bg-primary-500/[0.07] p-3">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary-200">
                            Destination captions included in this approval
                          </p>
                          {Object.entries(post.platform_captions).map(
                            ([platformId, caption]) => (
                              <div
                                key={platformId}
                                className="rounded-md border border-hairline bg-black/15 px-3 py-2"
                              >
                                <p className="mb-1 text-[10px] font-semibold text-surface-300">
                                  {PLATFORM_LABELS.get(platformId) || platformId}
                                </p>
                                <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-surface-100">
                                  {caption}
                                </p>
                              </div>
                            ),
                          )}
                        </div>
                      ) : null}
                      {post.disclosures ? (
                        <div className="rounded-lg border border-warning-500/20 bg-warning-500/10 px-3 py-2">
                          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-warning-300">
                            Required disclosures
                          </p>
                          <p className="whitespace-pre-wrap text-xs leading-relaxed text-warning-100/80">
                            {post.disclosures}
                          </p>
                        </div>
                      ) : null}
                      {!hasReviewCreative ? (
                        <p className="text-xs font-medium text-error-200">
                          This legacy item cannot be approved without reviewable
                          creative. Reject it and have the salesperson resubmit.
                        </p>
                      ) : null}
                      {!releaseReady ? (
                        <p
                          className="rounded-lg border border-warning-500/25 bg-warning-500/10 px-3 py-2 text-xs font-medium text-warning-100"
                          role="alert"
                        >
                          Approval is locked until the customer photo release is
                          securely linked and verified. Reject this item and have the
                          salesperson recapture consent if it does not recover.
                        </p>
                      ) : null}
                      {identityReviewRequired ? (
                        <p
                          className="rounded-lg border border-error-500/25 bg-error-500/10 px-3 py-2 text-xs font-medium text-error-100"
                          role="alert"
                        >
                          Customer-name review required. This legacy copy was
                          quarantined and cannot be approved or shared. Reject it and
                          have the salesperson submit corrected copy.
                        </p>
                      ) : null}
                      {imageReviewRequired ? (
                        <p
                          className="rounded-lg border border-error-500/25 bg-error-500/10 px-3 py-2 text-xs font-medium text-error-100"
                          role="alert"
                        >
                          Image safety review required. This creative predates the
                          current on-pixel customer-name, logo, and source-fidelity
                          checks. Reject it and have the salesperson create a new post.
                        </p>
                      ) : null}
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
                      disabled={busy[post.id] || !canApprove}
                      title={
                        canApprove
                          ? "Approve this exact creative"
                          : imageReviewRequired
                            ? "Image safety review required; reject and resubmit"
                            : identityReviewRequired
                              ? "Customer-name review required; reject and resubmit"
                              : !hasReviewCreative
                                ? "Creative is unavailable; reject and resubmit"
                                : "Verified customer consent is required before approval"
                      }
                    >
                      Approve
                    </Button>
                  </div>
                </motion.li>
              );
            })}
          </ul>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
