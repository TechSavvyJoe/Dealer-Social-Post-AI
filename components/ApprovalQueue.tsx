import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  X,
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
import { cn } from "../utils/classNames";
import { useAppStore } from "../stores/appStore";
import { PUBLISH_TARGETS } from "../services/publishTargets";
import { toPublicCustomerLabel } from "../utils/customerIdentity";
import { toUiMessage } from "../utils/errorMessages";

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
  // Which decision is being sent for each post, so only that button spins.
  const [busy, setBusy] = useState<Record<string, "approved" | "rejected" | undefined>>(
    {},
  );

  // Monotonic request id so a stale dealer's response can't overwrite the
  // current dealer's pending list if the dealer changes mid-fetch.
  const reqIdRef = useRef(0);
  const load = useCallback(async () => {
    if (!currentDealer) return;
    const myId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const items = await listPendingPosts(currentDealer.id, undefined, {
        dealerName: currentDealer.name,
        oemAffiliation: currentDealer.oem_affiliation,
      });
      if (reqIdRef.current === myId) setPending(items);
    } catch (err) {
      if (reqIdRef.current === myId)
        setError(toUiMessage(err, "Could not load pending posts."));
    } finally {
      if (reqIdRef.current === myId) setLoading(false);
    }
  }, [currentDealer]);

  useEffect(() => {
    void load();
  }, [load]);

  // Rejecting opens a note field for that one post. A rejection with no note
  // leaves the salesperson reading "make the requested changes" with nothing
  // requested, so the backend requires one and the UI collects it here.
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  /** The reasons managers actually give, so the common case is one tap. */
  const QUICK_REASONS = [
    "Pricing claim needs a disclosure",
    "Wrong or unclear photo",
    "Customer name should not appear",
    "Caption is off-brand",
  ];

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
      setError("Enter your name first so the decision is logged.");
      return;
    }
    if (status === "rejected" && !reason.trim()) {
      setError("Tell the salesperson what to change before rejecting this post.");
      return;
    }
    setError(null);
    setBusy((b) => ({ ...b, [post.id]: status }));
    try {
      await setApprovalStatus(
        post.id,
        status,
        approver.trim(),
        status === "rejected" ? reason.trim() : undefined,
      );
      setPending((prev) => prev.filter((p) => p.id !== post.id));
      setRejectingId(null);
      setReason("");
    } catch (err) {
      setError(toUiMessage(err, "Could not load the approval queue."));
    } finally {
      setBusy((b) => ({ ...b, [post.id]: undefined }));
    }
  };

  // Hide the entire queue if this dealer doesn't use the approval gate.
  if (currentDealer && !currentDealer.requires_approval && pending.length === 0) {
    return null;
  }

  return (
    <section
      aria-labelledby="approval-queue-heading"
      className="space-y-4 rounded-md border border-hairline bg-panel p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 id="approval-queue-heading" className="text-ink">
            Waiting for approval
          </h3>
          <p className="mt-0.5 text-sm text-ink-2">
            {pending.length} post{pending.length === 1 ? "" : "s"} awaiting manager
            review
          </p>
        </div>
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

      <Input
        label="Your name"
        value={approver}
        onChange={(e) => setApprover(e.target.value)}
        placeholder="e.g. Joe G. (GSM)"
        helperText="Saved with each approve or reject decision."
        fullWidth
      />

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      {loading && pending.length === 0 ? (
        <div
          className="flex min-h-32 items-center justify-center gap-2 text-sm text-ink-2"
          role="status"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading approval queue…
        </div>
      ) : pending.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="All caught up"
          description="Nothing pending — your team's clear. New posts that need approval will appear here."
        />
      ) : (
        <ul className="divide-y divide-hairline border-t border-hairline">
          {pending.map((post) => {
            const hasReviewCreative = Boolean(post.creative_image_url && post.caption);
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
            const customerLabel = toPublicCustomerLabel(post.customer_name);
            return (
              <li key={post.id} className="flex flex-wrap items-center gap-3 py-4">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-ink">
                    {post.salesperson_name || "Unattributed"}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-ink-2">
                    <span>{formatTime(post.generated_at)}</span>
                    {customerLabel && <span>Customer: {customerLabel}</span>}
                    {post.style && <span>{post.style}</span>}
                    {post.tone && <span>{post.tone}</span>}
                    {post.vin && <span>VIN {post.vin}</span>}
                    {post.has_video && (
                      <span className="flex items-center gap-1">
                        <Film className="h-3.5 w-3.5" aria-hidden="true" /> Video
                      </span>
                    )}
                    {post.has_release && (
                      <span className="flex items-center gap-1">
                        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />{" "}
                        Release
                      </span>
                    )}
                    {post.scheduled_for && (
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" aria-hidden="true" /> Share
                        time set
                      </span>
                    )}
                  </div>
                </div>
                <div className="order-3 grid w-full gap-4 sm:grid-cols-[minmax(0,12rem)_1fr]">
                  {post.creative_image_url ? (
                    <img
                      src={post.creative_image_url}
                      alt={`Post waiting for approval for ${customerLabel || "customer delivery"}`}
                      loading="lazy"
                      className="aspect-square w-full rounded-lg border border-hairline bg-canvas object-contain"
                    />
                  ) : (
                    <div className="flex aspect-square w-full items-center justify-center rounded-lg border border-dashed border-error-ink/40 bg-error-fill px-3 text-center text-sm text-error-ink">
                      Review image unavailable
                    </div>
                  )}
                  <div className="min-w-0 space-y-3">
                    <div>
                      <p className="mb-1 text-caption font-medium text-ink-2">
                        Submitted caption
                      </p>
                      <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-ink">
                        {post.caption || "Review caption unavailable"}
                      </p>
                    </div>
                    {post.platform_captions &&
                    Object.keys(post.platform_captions).length > 0 ? (
                      <div className="space-y-2">
                        <p className="text-caption font-medium text-ink-2">
                          Channel captions included in this approval
                        </p>
                        {Object.entries(post.platform_captions).map(
                          ([platformId, caption]) => (
                            <div
                              key={platformId}
                              className="rounded-sm bg-panel-raised px-3 py-2"
                            >
                              <p className="mb-1 text-caption font-medium text-ink-2">
                                {PLATFORM_LABELS.get(platformId) || platformId}
                              </p>
                              <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-ink">
                                {caption}
                              </p>
                            </div>
                          ),
                        )}
                      </div>
                    ) : null}
                    {post.disclosures ? (
                      <div className="rounded-sm border border-warning-ink/30 bg-warning-fill px-3 py-2">
                        <p className="mb-1 text-caption font-medium text-warning-ink">
                          Required disclosures
                        </p>
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
                          {post.disclosures}
                        </p>
                      </div>
                    ) : null}
                    {!hasReviewCreative ? (
                      <p className="text-sm font-medium text-error-ink">
                        This older post cannot be approved without its image and
                        caption. Reject it and have the salesperson resubmit.
                      </p>
                    ) : null}
                    {!releaseReady ? (
                      <p
                        className="rounded-sm border border-warning-ink/30 bg-warning-fill px-3 py-2 text-sm font-medium text-warning-ink"
                        role="alert"
                      >
                        Approval is locked until the customer photo release is securely
                        linked and verified. Reject this item and have the salesperson
                        recapture consent if it does not recover.
                      </p>
                    ) : null}
                    {identityReviewRequired ? (
                      <p
                        className="rounded-sm border border-error-ink/30 bg-error-fill px-3 py-2 text-sm font-medium text-error-ink"
                        role="alert"
                      >
                        Customer-name review required. This legacy copy was quarantined
                        and cannot be approved or shared. Reject it and have the
                        salesperson submit corrected copy.
                      </p>
                    ) : null}
                    {imageReviewRequired ? (
                      <p
                        className="rounded-sm border border-error-ink/30 bg-error-fill px-3 py-2 text-sm font-medium text-error-ink"
                        role="alert"
                      >
                        Image safety review required. This image predates the current
                        on-pixel customer-name, logo, and source-fidelity checks. Reject
                        it and have the salesperson create a new post.
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="order-4 flex w-full flex-wrap items-center justify-end gap-2">
                  <Button
                    variant="secondary"
                    size="md"
                    leftIcon={<X className="h-4 w-4" />}
                    onClick={() => {
                      setError(null);
                      setReason("");
                      setRejectingId(rejectingId === post.id ? null : post.id);
                    }}
                    disabled={Boolean(busy[post.id])}
                    aria-expanded={rejectingId === post.id}
                  >
                    Reject
                  </Button>
                  {rejectingId === post.id ? (
                    <div className="order-first w-full space-y-3 rounded-md border border-hairline bg-panel-raised p-3">
                      <label
                        htmlFor={`reject-reason-${post.id}`}
                        className="block text-sm font-semibold text-ink"
                      >
                        What should they change?
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {QUICK_REASONS.map((quick) => (
                          <button
                            key={quick}
                            type="button"
                            aria-pressed={reason === quick}
                            onClick={() => setReason(quick)}
                            className={cn(
                              "min-h-11 rounded-full border px-3 text-sm transition-colors duration-120 ease-out",
                              reason === quick
                                ? "border-brand-ink bg-brand-tint text-ink"
                                : "border-hairline bg-panel text-ink-2 hover:border-strong hover:text-ink",
                            )}
                          >
                            {quick}
                          </button>
                        ))}
                      </div>
                      <textarea
                        id={`reject-reason-${post.id}`}
                        value={reason}
                        onChange={(e) => setReason(e.target.value.slice(0, 280))}
                        maxLength={280}
                        rows={2}
                        placeholder="The salesperson sees this, so be specific."
                        className="w-full rounded-sm border border-strong bg-panel px-3 py-2 text-base text-ink placeholder:text-ink-hint transition-colors duration-120 ease-out focus:border-brand-ink"
                      />
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="md"
                          onClick={() => {
                            setRejectingId(null);
                            setReason("");
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="danger"
                          size="md"
                          onClick={() => handleAction(post, "rejected")}
                          loading={busy[post.id] === "rejected"}
                          disabled={Boolean(busy[post.id]) || !reason.trim()}
                        >
                          Send rejection
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  <Button
                    variant="primary"
                    size="md"
                    leftIcon={<Check className="h-4 w-4" />}
                    loading={busy[post.id] === "approved"}
                    onClick={() => handleAction(post, "approved")}
                    disabled={Boolean(busy[post.id]) || !canApprove}
                    title={
                      canApprove
                        ? "Approve this post"
                        : imageReviewRequired
                          ? "Image safety review required; reject and resubmit"
                          : identityReviewRequired
                            ? "Customer-name review required; reject and resubmit"
                            : !hasReviewCreative
                              ? "The post image is unavailable; reject and resubmit"
                              : "Verified customer consent is required before approval"
                    }
                  >
                    Approve
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};
