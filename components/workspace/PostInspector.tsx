import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Archive,
  ArrowLeft,
  Check,
  ChevronRight,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  X,
} from "lucide-react";
import type { PostRecord } from "../../services/posts";
import { safeWebsiteReviewUrl } from "../../services/websitePublishing";
import { dayTimeLabel, postStatusCopy } from "../../utils/postLabels";
import { shareStatusDetail, wasSentToShareSheet } from "../../utils/historyPost";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { reviewState, websiteStateLabel } from "./workspacePresentation";

interface PostInspectorProps {
  active: boolean;
  post: PostRecord | null;
  title: string;
  loading: boolean;
  error: string | null;
  image: string | null;
  imageLoading: boolean;
  imageError: string | null;
  held: boolean;
  canOpen: boolean;
  canRetryWebsite: boolean;
  canReview: boolean;
  canArchive: boolean;
  busy: string | null;
  onClose: () => void;
  onReload: () => void;
  onOpen: () => void;
  onArchive: () => void;
  onApprove: () => void;
  onRequestChanges: () => void;
  onReviewNext: () => void;
  hasNext: boolean;
  onRetryWebsite: () => void;
  websiteRetrying: boolean;
}

export const PostInspector: React.FC<PostInspectorProps> = ({
  active,
  post,
  title,
  loading,
  error,
  image,
  imageLoading,
  imageError,
  held,
  canOpen,
  canRetryWebsite,
  canReview,
  canArchive,
  busy,
  onClose,
  onReload,
  onOpen,
  onArchive,
  onApprove,
  onRequestChanges,
  onReviewNext,
  hasNext,
  onRetryWebsite,
  websiteRetrying,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [headerBottom, setHeaderBottom] = useState(0);
  const surface = useRef<HTMLElement>(null);
  const [mobile, setMobile] = useState(
    () => window.matchMedia("(max-width: 760px)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => setMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useLayoutEffect(() => {
    if (!active || !mobile) return;
    const header = document.querySelector("header");
    const shell = header?.parentElement;
    const measure = () =>
      setHeaderBottom(Math.max(0, header?.getBoundingClientRect().bottom || 0));
    const resize =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    const observeChrome = () => {
      resize?.disconnect();
      if (shell) {
        resize?.observe(shell);
        for (const child of Array.from(shell.children)) {
          resize?.observe(child);
          if (child === header) break;
        }
      }
      measure();
    };
    const mutation = new MutationObserver(observeChrome);
    if (shell) mutation.observe(shell, { childList: true });
    observeChrome();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      resize?.disconnect();
      mutation.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [active, mobile]);
  useEffect(() => {
    if (active && mobile)
      surface.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [active, mobile]);
  useEffect(() => {
    setExpanded(false);
  }, [post?.id, held]);
  const review = post ? reviewState(post, held) : null;
  const activity = post
    ? postStatusCopy({ share_summary: post.share_summary }, { surface: "work" })
    : null;
  const activityAt = post?.share_summary
    ? shareStatusDetail(post.share_summary).at
    : "";
  const latestExport =
    post?.share_summary &&
    wasSentToShareSheet(post.share_summary) &&
    post.share_summary.last_via !== "share_sheet"
      ? postStatusCopy(
          { share_summary: { ...post.share_summary, sheet_count: 0 } },
          { surface: "work" },
        )
      : null;
  const reviewUrl =
    post && !held
      ? safeWebsiteReviewUrl(post.website_publication?.reviewUrl)
      : undefined;
  return (
    <aside
      ref={surface}
      className="cw-inspector"
      style={{ "--cw-header-bottom": `${headerBottom}px` } as React.CSSProperties}
      role={active && mobile ? "dialog" : undefined}
      aria-modal={active && mobile ? true : undefined}
      aria-label="Content details"
      aria-busy={loading || undefined}
      onKeyDown={(event) => {
        if (!active || !mobile || event.key !== "Tab" || expanded) return;
        const controls = Array.from(
          surface.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled)",
          ) || [],
        ).filter((element) => element.getAttribute("tabindex") !== "-1");
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (
          (event.shiftKey && document.activeElement === first) ||
          (!event.shiftKey && document.activeElement === last)
        ) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        }
      }}
    >
      <div className="cw-inspector-nav">
        <button type="button" className="cw-detail-back" onClick={onClose}>
          <ArrowLeft size={18} /> Back to results
        </button>
        <span>Content details</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close content details"
          onClick={onClose}
        >
          <X size={18} />
        </Button>
      </div>
      {loading ? (
        <div className="cw-detail-state" role="status">
          <Loader2 className="animate-spin" />
          Loading post details…
        </div>
      ) : error ? (
        <div className="cw-detail-state">
          <p role="alert">{error}</p>
          <Button variant="secondary" onClick={onReload}>
            Try again
          </Button>
        </div>
      ) : post ? (
        <div className="cw-inspector-content">
          <div className="cw-preview">
            {held ? (
              <div className="cw-preview-message">
                <ShieldCheck />
                <strong>Held for safety review</strong>
                <p>
                  This post can’t be reopened. Create a corrected post before sharing
                  it.
                </p>
              </div>
            ) : imageLoading ? (
              <div className="cw-preview-message" role="status">
                <Loader2 className="animate-spin" />
                Loading saved photo…
              </div>
            ) : image ? (
              <button
                type="button"
                aria-label="View saved photo"
                onClick={() => setExpanded(true)}
              >
                <img src={image} alt={`Saved creative for ${title}`} />
              </button>
            ) : (
              <div className="cw-preview-message">
                <ImageIcon />
                <span>{imageError || "No image was saved with this post."}</span>
                {imageError && (
                  <Button variant="secondary" onClick={onReload}>
                    Retry photo
                  </Button>
                )}
              </div>
            )}
          </div>
          <h2>{title}</h2>
          {post.salesperson_name && (
            <p className="cw-detail-owner">Created by {post.salesperson_name}</p>
          )}
          <p className="cw-caption">
            {held
              ? "Caption withheld for safety review."
              : post.caption?.trim() || "No caption saved."}
          </p>
          {!post.archived && canOpen && (
            <div className="cw-detail-actions">
              <Button
                loading={busy === "open"}
                onClick={onOpen}
                leftIcon={<FileText />}
              >
                Open post
              </Button>
              <p>Edit captions and use the post’s available share options.</p>
            </div>
          )}
          {canReview && (
            <div className="cw-review-actions">
              <Button
                loading={busy === "approved"}
                disabled={
                  Boolean(busy) ||
                  held ||
                  Boolean(
                    post.release_required &&
                    !post.has_release &&
                    post.release_status !== "saved",
                  )
                }
                onClick={onApprove}
                leftIcon={<Check />}
              >
                Approve
              </Button>
              <Button
                variant="secondary"
                disabled={Boolean(busy)}
                onClick={onRequestChanges}
              >
                Request changes
              </Button>
            </div>
          )}
          <dl className="cw-detail-facts">
            <div>
              <dt>
                <ShieldCheck size={17} />
                Consent
              </dt>
              <dd>
                {post.has_release || post.release_status === "saved"
                  ? "Release saved"
                  : post.release_required
                    ? "Release required before approval or sharing"
                    : "Release not required"}
              </dd>
            </div>
            <div>
              <dt>
                <ShieldCheck size={17} />
                Review
              </dt>
              <dd>
                <span className={`cw-status cw-status-${review?.tone}`}>
                  {review?.label}
                </span>
                {post.rejection_reason && !held && <p>{post.rejection_reason}</p>}
                {post.approved_by && (
                  <p>
                    {post.approved_by}
                    {post.approved_at ? ` · ${dayTimeLabel(post.approved_at)}` : ""}
                  </p>
                )}
              </dd>
            </div>
            <div>
              <dt>
                <ImageIcon size={17} />
                Media
              </dt>
              <dd>
                {held
                  ? "Preview withheld"
                  : image
                    ? "Photo available"
                    : imageLoading
                      ? "Loading photo…"
                      : "Photo unavailable"}
                {post.has_video && (
                  <p className="cw-video-notice">
                    Video generated — saved clip unavailable. Historical clips aren’t
                    stored with this post. Check On this device for a recovery copy.
                  </p>
                )}
              </dd>
            </div>
            <div>
              <dt>
                <FileText size={17} />
                Activity
              </dt>
              <dd>
                {held ? (
                  <p>Activity details withheld while this post is held.</p>
                ) : activity?.status !== "draft" ? (
                  <p>
                    {activity?.label}
                    {activity?.detail ? ` · ${activity.detail}` : ""}
                  </p>
                ) : (
                  <p>No share or export recorded.</p>
                )}
                {activityAt && !held && <p>{dayTimeLabel(activityAt)}</p>}
                {latestExport && !held && (
                  <p>
                    {latestExport.label}
                    {post.share_summary?.last_shared_at
                      ? ` · ${dayTimeLabel(post.share_summary.last_shared_at)}`
                      : ""}
                  </p>
                )}
                {!held && <p>{websiteStateLabel(post.website_publication?.status)}</p>}
              </dd>
            </div>
            <div>
              <dt>Saved</dt>
              <dd>{dayTimeLabel(post.generated_at) || "Date unavailable"}</dd>
            </div>
            {post.updated && (
              <div>
                <dt>Updated</dt>
                <dd>{dayTimeLabel(post.updated)}</dd>
              </div>
            )}
            {post.archived && (
              <div>
                <dt>Archived</dt>
                <dd>{dayTimeLabel(post.archived_at) || "Archived"}</dd>
              </div>
            )}
          </dl>
          {!held && reviewUrl && (
            <a
              className="cw-review-link"
              href={reviewUrl}
              target="_blank"
              rel="noreferrer"
            >
              Review website draft <ExternalLink size={16} />
            </a>
          )}
          {!held && post.website_publication?.lastError && (
            <div className="cw-website-error">
              <p>Website draft needs attention</p>
              <Button
                variant="secondary"
                loading={websiteRetrying}
                disabled={!canRetryWebsite || Boolean(busy)}
                onClick={onRetryWebsite}
                leftIcon={<RefreshCw />}
              >
                Retry website draft
              </Button>
            </div>
          )}
          {hasNext && (
            <Button
              variant="secondary"
              disabled={Boolean(busy)}
              onClick={onReviewNext}
              rightIcon={<ChevronRight />}
            >
              Review next
            </Button>
          )}
          <div className="cw-archive-action">
            <Button
              variant="ghost"
              disabled={!canArchive || Boolean(busy)}
              onClick={onArchive}
              leftIcon={post.archived ? <RotateCcw /> : <Archive />}
            >
              {post.archived ? "Restore post" : "Archive post"}
            </Button>
            {!canArchive && (
              <p>Reload details to verify this post’s current version.</p>
            )}
          </div>
        </div>
      ) : (
        <div className="cw-detail-state cw-inspector-placeholder">
          <FileText size={32} />
          <h2>Select a post</h2>
          <p>Inspect its saved media, review status and recorded activity.</p>
        </div>
      )}
      <Modal
        isOpen={expanded && Boolean(image) && !held}
        onClose={() => setExpanded(false)}
        title="Saved photo"
        size="xl"
      >
        {image && !held && (
          <img
            src={image}
            alt={`Saved creative for ${title}`}
            className="w-full max-h-[75vh] object-contain"
          />
        )}
      </Modal>
    </aside>
  );
};
