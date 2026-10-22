import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ChevronDown,
  Download,
  ExternalLink,
  FileText,
  Grid2X2,
  Image as ImageIcon,
  List,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Smartphone,
  Video,
  X,
} from "lucide-react";
import { useAppStore } from "../../stores/appStore";
import { usePostHistoryList } from "../../hooks/usePostHistoryList";
import {
  bulkArchivePosts,
  bulkRestorePosts,
  fetchPostCreativeDataUrl,
  getPostDetail,
  setApprovalStatus,
  type PostRecord,
} from "../../services/posts";
import type { WebsitePublication } from "../../services/websitePublishing";
import { homeTilesForDealer } from "../../services/storeDefaults";
import { toUiMessage } from "../../utils/errorMessages";
import {
  dayTimeLabel,
  postCategoryLabel,
  postStatusCopy,
} from "../../utils/postLabels";
import { isAuthoritativePostOwner } from "../../utils/historyPost";
import { workspaceRequestForPost } from "../../utils/postWorkspace";
import type { GeneratedPost, ImageSelection } from "../../types";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { DeviceRecoveryGrid } from "../work/DeviceRecoveryGrid";
import { PostInspector } from "./PostInspector";
import {
  loadedPostMetadataCsv,
  postIsHeld,
  reviewState,
} from "./workspacePresentation";
import "./workspace.css";

export interface ContentWorkspaceProps {
  mode?: "personal" | "manager";
  hideHeading?: boolean;
  onOpenPost?: (post: GeneratedPost) => void;
  onReusePhoto?: (selection: ImageSelection) => void;
  onCreateContent?: () => void;
  onOpenSpins?: () => void;
  onOpenWalkarounds?: () => void;
  ownerOptions?: { id: string; name: string }[];
}

/** Re-mount private detail/selection state at every authenticated identity boundary. */
export const ContentWorkspace: React.FC<ContentWorkspaceProps> = (props) => {
  const scope = useAppStore(
    (s) =>
      `${s.authEpoch}/${s.currentDealer?.id || ""}/${s.currentPerson?.id || ""}/${s.role}`,
  );
  return <WorkspaceBody key={`${scope}/${props.mode || "personal"}`} {...props} />;
};

const WorkspaceSelect: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}> = ({ label, value, onChange, children }) => (
  <label className="cw-select">
    <span className="sr-only">{label}</span>
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {children}
    </select>
    <ChevronDown size={16} aria-hidden="true" />
  </label>
);

const WorkspaceBody: React.FC<ContentWorkspaceProps> = ({
  mode = "personal",
  hideHeading = false,
  onOpenPost,
  onReusePhoto,
  onCreateContent,
  onOpenSpins,
  onOpenWalkarounds,
  ownerOptions = [],
}) => {
  const dealer = useAppStore((s) => s.currentDealer);
  const person = useAppStore((s) => s.currentPerson);
  const role = useAppStore((s) => s.role);
  const [detail, setDetail] = useState<PostRecord | null>(null);
  const publications = useRef(
    new Map<string, { version: number; publication: WebsitePublication }>(),
  );
  const publicationVersion = useRef(0);
  const onWebsitePublication = useCallback(
    (postId: string, publication: WebsitePublication) => {
      publications.current.set(postId, {
        version: ++publicationVersion.current,
        publication,
      });
      setDetail((current) =>
        current?.id === postId && current.dealer === dealer?.id
          ? { ...current, website_publication: publication }
          : current,
      );
    },
    [dealer?.id],
  );
  const history = usePostHistoryList({ onPostReady: onOpenPost, onWebsitePublication });
  const {
    items,
    filtered,
    loading,
    loadingMore,
    error,
    nextCursor,
    load,
    identityGrounding,
    query,
    setQuery,
    statusFilter,
    setStatusFilter,
    mediaFilter,
    setMediaFilter,
    websiteStatus,
    setWebsiteStatus,
    archived,
    setArchived,
    ownerPersonId,
    setOwnerPersonId,
    sort,
    setSort,
    since,
    setSince,
    setUntil,
    total,
    openCreative,
    openingId,
    retryWebsite,
    websiteRetryingId,
  } = history;
  const [collection, setCollection] = useState<"posts" | "device">("posts");
  const [view, setView] = useState<"list" | "grid">("list");
  const [dateRange, setDateRange] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailVersion, setDetailVersion] = useState(0);
  const [image, setImage] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [batch, setBatch] = useState<{ posts: PostRecord[]; restore: boolean } | null>(
    null,
  );
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const mounted = useRef(true);
  const openTrigger = useRef<HTMLElement | null>(null);
  const initialFilters = useRef(false);
  const selectAll = useRef<HTMLInputElement>(null);
  const tiles = useMemo(() => homeTilesForDealer(dealer), [dealer]);
  const titleFor = useCallback(
    (post: PostRecord) => postCategoryLabel(post.scenario_id, dealer, tiles),
    [dealer, tiles],
  );
  const manager =
    mode === "manager" && (role === "dealer_admin" || role === "super_admin");
  const ownPost = (post: PostRecord) =>
    post.dealer === dealer?.id && isAuthoritativePostOwner(post, person?.id);
  const canManage = (post: PostRecord) =>
    post.dealer === dealer?.id && (manager || ownPost(post));

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (initialFilters.current) return;
    initialFilters.current = true;
    if (manager) {
      setStatusFilter("pending");
      setSort("oldest_created");
    } else {
      setSort("newest_updated");
      if (role !== "salesperson" && person?.id) setOwnerPersonId(person.id);
    }
  }, [manager, person?.id, role, setOwnerPersonId, setSort, setStatusFilter]);
  useEffect(() => {
    setSelected(new Set());
    setActiveId(null);
    setNotice(null);
    setActionError(null);
  }, [
    query,
    statusFilter,
    mediaFilter,
    websiteStatus,
    archived,
    ownerPersonId,
    sort,
    since,
    collection,
  ]);

  const closeDetail = useCallback(() => {
    setActiveId(null);
    requestAnimationFrame(() => openTrigger.current?.focus());
  }, []);
  useEffect(() => {
    if (!activeId) return;
    const mobile = window.matchMedia("(max-width: 760px)");
    const previous = document.body.style.overflow;
    const update = () => {
      document.body.style.overflow = mobile.matches ? "hidden" : previous;
    };
    update();
    mobile.addEventListener("change", update);
    return () => {
      mobile.removeEventListener("change", update);
      document.body.style.overflow = previous;
    };
  }, [activeId]);
  useEffect(() => {
    if (!activeId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !batch && !rejecting) closeDetail();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId, batch, closeDetail, rejecting]);

  useEffect(() => {
    let current = true;
    setDetail(null);
    setImage(null);
    setImageError(null);
    setDetailError(null);
    setDetailLoading(Boolean(activeId));
    setImageLoading(false);
    if (!activeId) return;
    const epoch = useAppStore.getState().authEpoch;
    const requestedPublicationVersion = publicationVersion.current;
    void getPostDetail(activeId, identityGrounding)
      .then(async (post) => {
        if (!current || epoch !== useAppStore.getState().authEpoch) return;
        // A detail response can predate a retry/poll that finished while it was loading.
        const latestPublication = publications.current.get(post.id);
        setDetail(
          latestPublication && latestPublication.version > requestedPublicationVersion
            ? { ...post, website_publication: latestPublication.publication }
            : post,
        );
        setDetailLoading(false);
        if (!post.creative_image_url || postIsHeld(post, identityGrounding)) return;
        setImageLoading(true);
        try {
          const savedImage = await fetchPostCreativeDataUrl(post.creative_image_url);
          if (current && epoch === useAppStore.getState().authEpoch)
            setImage(savedImage);
        } catch (err) {
          if (current && epoch === useAppStore.getState().authEpoch)
            setImageError(toUiMessage(err, "Could not load the saved photo."));
        } finally {
          if (current && epoch === useAppStore.getState().authEpoch)
            setImageLoading(false);
        }
      })
      .catch((err) => {
        if (current && epoch === useAppStore.getState().authEpoch) {
          setDetailError(toUiMessage(err, "Could not load this post."));
          setDetailLoading(false);
        }
      });
    return () => {
      current = false;
    };
  }, [activeId, detailVersion, identityGrounding]);

  const clearFilters = () => {
    setQuery("");
    setStatusFilter("all");
    setMediaFilter("any");
    setWebsiteStatus("all");
    setSince(undefined);
    setUntil(undefined);
    setDateRange("all");
    setArchived("active");
    if (manager) setOwnerPersonId("");
  };
  const changeDate = (value: string) => {
    setDateRange(value);
    setUntil(undefined);
    if (value === "all") setSince(undefined);
    else {
      const from = new Date();
      from.setDate(from.getDate() - (Number(value) - 1));
      from.setHours(0, 0, 0, 0);
      setSince(from.toISOString());
    }
  };
  const selectable = filtered.filter(
    (post) => canManage(post) && workspaceRequestForPost(post),
  );
  const selectedPosts = filtered.filter((post) => selected.has(post.id));
  const allLoadedSelected =
    selectable.length > 0 &&
    selectable.slice(0, 50).every((post) => selected.has(post.id));
  useEffect(() => {
    if (selectAll.current)
      selectAll.current.indeterminate = selected.size > 0 && !allLoadedSelected;
  }, [allLoadedSelected, selected]);
  const hasFilters = Boolean(
    query.trim() ||
    statusFilter !== "all" ||
    mediaFilter !== "any" ||
    websiteStatus !== "all" ||
    since ||
    (manager && ownerPersonId),
  );
  const toggleSelection = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < 50) next.add(id);
      return next;
    });
  const nextPost = filtered.find(
    (post) => post.id !== activeId && post.approval_status === "pending",
  );
  const held = detail ? postIsHeld(detail, identityGrounding) : false;

  const exportLoaded = () => {
    const blob = new Blob([loadedPostMetadataCsv(filtered, identityGrounding)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `dealer-social-loaded-posts-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setNotice(
      `Exported metadata for ${filtered.length} loaded post${filtered.length === 1 ? "" : "s"}.`,
    );
  };

  const runBatch = async () => {
    if (!batch || busy) return;
    const pending = batch;
    const epoch = useAppStore.getState().authEpoch;
    setBusy("archive");
    setActionError(null);
    setNotice(null);
    try {
      const requests = pending.posts.map(workspaceRequestForPost);
      if (requests.some((request) => !request))
        throw new Error(
          "Reload the posts to verify their current versions before trying again.",
        );
      const result = await (pending.restore ? bulkRestorePosts : bulkArchivePosts)(
        requests.filter((request): request is NonNullable<typeof request> =>
          Boolean(request),
        ),
      );
      if (!mounted.current || epoch !== useAppStore.getState().authEpoch) return;
      const failures = result.results.filter((item) => !item.ok);
      const successes = result.results.filter((item) => item.ok);
      setSelected(new Set(failures.map((item) => item.id)));
      setNotice(
        `${successes.length} ${pending.restore ? "restored" : "archived"}${failures.length ? ` · ${failures.length} couldn’t be ${pending.restore ? "restored" : "archived"}` : ""}.`,
      );
      setActionError(
        failures
          .map(
            (item) =>
              `${pending.posts.find((post) => post.id === item.id) ? titleFor(pending.posts.find((post) => post.id === item.id)!) : "Post"}: ${item.message}`,
          )
          .join(" ") || null,
      );
      if (successes.some((item) => item.id === activeId)) setActiveId(null);
      setBatch(null);
      await load();
    } catch (err) {
      if (mounted.current && epoch === useAppStore.getState().authEpoch) {
        setActionError(toUiMessage(err, "Could not update the selected posts."));
        setBatch(null);
      }
    } finally {
      if (mounted.current && epoch === useAppStore.getState().authEpoch) setBusy(null);
    }
  };

  const decide = async (status: "approved" | "rejected") => {
    if (!detail || !manager || !detail.updated || busy) return;
    if (!person?.name?.trim()) {
      setActionError(
        "Your reviewer identity is unavailable. Sign in again before recording a decision.",
      );
      return;
    }
    if (status === "approved" && held) return;
    if (status === "rejected" && !reason.trim()) return;
    const epoch = useAppStore.getState().authEpoch;
    setBusy(status);
    setActionError(null);
    try {
      await setApprovalStatus(
        detail.id,
        status,
        person.name.trim(),
        status === "rejected" ? reason.trim() : undefined,
        detail.updated,
      );
      if (!mounted.current || epoch !== useAppStore.getState().authEpoch) return;
      setRejecting(false);
      setReason("");
      setNotice(
        status === "approved"
          ? "Post approved for this saved version."
          : "Changes requested for this saved version.",
      );
      setDetailVersion((value) => value + 1);
      await load();
    } catch (err) {
      if (mounted.current && epoch === useAppStore.getState().authEpoch)
        setActionError(
          toUiMessage(
            err,
            "Could not save the review decision. Refresh the post before trying again.",
          ),
        );
    } finally {
      if (mounted.current && epoch === useAppStore.getState().authEpoch) setBusy(null);
    }
  };

  const renderPost = (post: PostRecord) => {
    const blocked = postIsHeld(post, identityGrounding);
    const review = reviewState(post, blocked);
    const status = postStatusCopy(
      blocked ? { ...post, identity_review_required: true } : post,
      { surface: "work" },
    );
    const title = titleFor(post);
    const allowedSelection = canManage(post) && Boolean(workspaceRequestForPost(post));
    const owner = post.salesperson_name?.trim() || "Creator unavailable";
    return (
      <li
        key={post.id}
        className={`cw-row ${activeId === post.id ? "cw-row-active" : ""}`}
      >
        <label className="cw-row-check">
          <input
            type="checkbox"
            aria-label={`Select ${title} for bulk actions`}
            checked={selected.has(post.id)}
            disabled={
              !allowedSelection ||
              (!selected.has(post.id) && selected.size >= 50) ||
              Boolean(busy)
            }
            onChange={() => toggleSelection(post.id)}
          />
        </label>
        <button
          type="button"
          className="cw-row-main"
          aria-label={`Inspect ${title}${manager ? ` by ${owner}` : ""}`}
          aria-pressed={activeId === post.id}
          aria-describedby={
            status.status === "changes" && status.detail
              ? `cw-rejection-${post.id}`
              : undefined
          }
          onClick={(e) => {
            openTrigger.current = e.currentTarget;
            setActiveId(post.id);
          }}
        >
          <span className="cw-thumb" aria-hidden="true">
            {post.creative_image_url && !blocked ? (
              <img
                src={post.creative_image_url}
                alt=""
                loading="lazy"
                onError={(e) => {
                  e.currentTarget.style.visibility = "hidden";
                }}
              />
            ) : (
              <ImageIcon size={22} />
            )}
          </span>
          <span className="cw-row-copy">
            <strong>{title}</strong>
            <span>
              {blocked
                ? "Caption withheld for safety review."
                : post.caption?.trim() || "No caption saved."}
            </span>
            <small>
              {post.has_video ? "Video generated" : "Photo post"}
              {manager ? ` · ${owner}` : ""}
              {post.archived ? " · Archived" : ""}
            </small>
            {status.status === "changes" && status.detail && (
              <small
                id={`cw-rejection-${post.id}`}
                className="cw-row-reason"
                title={status.detail}
              >
                {status.detail}
              </small>
            )}
            {status.status !== "draft" &&
              status.status !== "waiting" &&
              status.status !== "changes" &&
              status.status !== "review_blocked" && (
                <small>
                  {status.label}
                  {status.detail ? ` · ${status.detail}` : ""}
                </small>
              )}
          </span>
          {manager && (
            <span className="cw-owner">
              <span className="cw-avatar">
                {owner
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((part) => part[0])
                  .join("")}
              </span>
              {owner}
            </span>
          )}
          <span className={`cw-status cw-status-${review.tone}`}>{review.label}</span>
          {!manager && (
            <span className="cw-media">
              {post.has_video ? <Video size={17} /> : <ImageIcon size={17} />}
              {post.has_video ? "Video generated" : "Photo"}
            </span>
          )}
          <span className="cw-updated">
            {dayTimeLabel(post.updated || post.generated_at) || "Date unavailable"}
          </span>
        </button>
      </li>
    );
  };

  return (
    <section
      className={`cw-workspace ${hideHeading ? "cw-embedded" : ""} ${manager ? "cw-manager" : ""} ${activeId ? "cw-has-detail" : ""}`}
      aria-label={manager ? "Dealership content workspace" : "My work workspace"}
    >
      {!hideHeading && (
        <div className="cw-heading">
          <div>
            <h1>{manager ? "Content" : "My work"}</h1>
            <p>
              {manager
                ? "Manage saved posts across your dealership."
                : "Your saved content, drafts and media."}
            </p>
          </div>
          {onCreateContent && (
            <Button onClick={onCreateContent} leftIcon={<Plus />}>
              Create content
            </Button>
          )}
        </div>
      )}
      <div className="cw-shell">
        <nav className="cw-collections" aria-label="Content collections">
          <button
            type="button"
            className={collection === "posts" ? "cw-tab-active" : ""}
            aria-current={collection === "posts" ? "page" : undefined}
            onClick={() => setCollection("posts")}
          >
            <FileText size={18} />
            Posts
          </button>
          {onOpenSpins && (
            <button type="button" onClick={onOpenSpins}>
              <RotateCcw size={18} />
              360 spins <ExternalLink size={13} />
            </button>
          )}
          {onOpenWalkarounds && (
            <button type="button" onClick={onOpenWalkarounds}>
              <Video size={18} />
              Walkaround studio <ExternalLink size={13} />
            </button>
          )}
          {onReusePhoto && (
            <button
              type="button"
              className={collection === "device" ? "cw-tab-active" : ""}
              aria-current={collection === "device" ? "page" : undefined}
              onClick={() => setCollection("device")}
            >
              <Smartphone size={18} />
              On this device
            </button>
          )}
        </nav>
        {collection === "device" ? (
          <div className="cw-device">
            <h2>Device recovery</h2>
            <p>
              Local copies expire after 48 hours and are cleared at logout. They don’t
              restore unsaved captions or sessions.
            </p>
            {dealer && onReusePhoto && (
              <DeviceRecoveryGrid
                dealerId={dealer.id}
                onReusePhoto={onReusePhoto}
                emptyContent={
                  <div className="cw-empty">
                    <Smartphone size={32} />
                    <h2>No recovery copies available on this device</h2>
                    <p>
                      Original photos, post images and videos saved locally will appear
                      here while their recovery copies are available.
                    </p>
                    {onCreateContent && (
                      <Button onClick={onCreateContent}>Create content</Button>
                    )}
                  </div>
                }
              />
            )}
          </div>
        ) : (
          <>
            <div className="cw-toolbar">
              <div className="cw-search">
                <Search size={18} aria-hidden="true" />
                <input
                  type="search"
                  aria-label="Search saved posts"
                  placeholder="Search saved content…"
                  maxLength={120}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {query && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => setQuery("")}
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
              <WorkspaceSelect
                label="Review status"
                value={statusFilter}
                onChange={(value) => setStatusFilter(value as typeof statusFilter)}
              >
                <option value="all">Status: All</option>
                <option value="pending">Waiting for review</option>
                <option value="approved">Approved</option>
                <option value="rejected">Changes requested</option>
                <option value="n_a">Review not required</option>
              </WorkspaceSelect>
              {manager && ownerOptions.length > 0 && (
                <WorkspaceSelect
                  label="Content owner"
                  value={ownerPersonId}
                  onChange={setOwnerPersonId}
                >
                  <option value="">Owner: Everyone</option>
                  {ownerOptions.map((owner) => (
                    <option key={owner.id} value={owner.id}>
                      {owner.name}
                    </option>
                  ))}
                </WorkspaceSelect>
              )}
              <WorkspaceSelect
                label="Media type"
                value={mediaFilter}
                onChange={(value) => setMediaFilter(value as typeof mediaFilter)}
              >
                <option value="any">Media: All</option>
                <option value="image">Photos</option>
                <option value="video_generated">Video generated</option>
              </WorkspaceSelect>
              <WorkspaceSelect
                label="Date range"
                value={dateRange}
                onChange={changeDate}
              >
                <option value="all">Date: Any time</option>
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
              </WorkspaceSelect>
              <WorkspaceSelect
                label="Sort posts"
                value={sort}
                onChange={(value) => setSort(value as typeof sort)}
              >
                <option value="newest_updated">Newest updated</option>
                <option value="newest_created">Newest created</option>
                <option value="oldest_created">Oldest created</option>
              </WorkspaceSelect>
              <div className="cw-view-toggle" aria-label="Results layout">
                <button
                  type="button"
                  aria-label="List view"
                  aria-pressed={view === "list"}
                  onClick={() => setView("list")}
                >
                  <List size={19} />
                </button>
                <button
                  type="button"
                  aria-label="Grid view"
                  aria-pressed={view === "grid"}
                  onClick={() => setView("grid")}
                >
                  <Grid2X2 size={19} />
                </button>
              </div>
            </div>
            <div className="cw-archive-filter">
              <button
                type="button"
                aria-pressed={archived === "active"}
                onClick={() => setArchived("active")}
              >
                Active posts
              </button>
              <button
                type="button"
                aria-pressed={archived === "archived"}
                onClick={() => setArchived("archived")}
              >
                <Archive size={15} />
                Archived
              </button>
              {hasFilters && (
                <button type="button" onClick={clearFilters}>
                  Clear filters <X size={14} />
                </button>
              )}
              <details className="cw-more">
                <summary>
                  More filters and actions <ChevronDown size={15} />
                  {websiteStatus !== "all" && (
                    <span
                      className="cw-filter-indicator"
                      aria-label="Website filter active"
                    >
                      1
                    </span>
                  )}
                </summary>
                <div className="cw-more-panel">
                  <span className="cw-more-label">Website activity</span>
                  <WorkspaceSelect
                    label="Website status"
                    value={websiteStatus}
                    onChange={(value) =>
                      setWebsiteStatus(value as typeof websiteStatus)
                    }
                  >
                    <option value="all">Website: All</option>
                    <option value="not_requested">Not requested</option>
                    <option value="waiting_approval">Waiting for approval</option>
                    <option value="queued">Queued</option>
                    <option value="delivering">Sending</option>
                    <option value="retrying">Retrying</option>
                    <option value="draft_ready">Ready for review</option>
                    <option value="failed">Failed</option>
                    <option value="published">Website published</option>
                    <option value="withdrawn">Withdrawn</option>
                  </WorkspaceSelect>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={loading || !filtered.length}
                    onClick={exportLoaded}
                    leftIcon={<Download size={16} />}
                  >
                    Export loaded results
                  </Button>
                  <p>
                    Metadata for {filtered.length} loaded posts only. Captions, customer
                    details and private media are excluded.
                  </p>
                </div>
              </details>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Refresh posts"
                disabled={loading || Boolean(busy)}
                onClick={() => {
                  void load();
                  setDetailVersion((value) => value + 1);
                }}
              >
                <RefreshCw size={17} />
              </Button>
            </div>
            {notice && (
              <p className="cw-notice" role="status">
                {notice}
              </p>
            )}
            {(error || actionError) && (
              <div className="cw-error">
                <p role="alert">{actionError || error}</p>
                <Button
                  variant="secondary"
                  onClick={() => {
                    const retryCursor = !actionError && error ? nextCursor : null;
                    setActionError(null);
                    void load(retryCursor || undefined);
                    setDetailVersion((value) => value + 1);
                  }}
                >
                  Try again
                </Button>
              </div>
            )}
            <div className="cw-body">
              <div className="cw-results">
                {selected.size ? (
                  <div className="cw-bulkbar">
                    <strong>{selected.size} selected</strong>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={Boolean(busy) || !selectedPosts.length}
                      onClick={() =>
                        setBatch({
                          posts: selectedPosts,
                          restore: archived === "archived",
                        })
                      }
                      leftIcon={archived === "archived" ? <RotateCcw /> : <Archive />}
                    >
                      {archived === "archived"
                        ? "Restore selected"
                        : "Archive selected"}
                    </Button>
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => setSelected(new Set())}
                    >
                      Clear selection
                    </button>
                  </div>
                ) : (
                  <p className="cw-result-count" aria-live="polite">
                    {loading
                      ? "Loading posts…"
                      : typeof total === "number"
                        ? `${total} post${total === 1 ? "" : "s"}${archived === "archived" ? " archived" : ""}`
                        : `${items.length} loaded post${items.length === 1 ? "" : "s"}`}
                  </p>
                )}
                {filtered.length > 0 && (
                  <div
                    className={`cw-table-head ${view === "grid" ? "cw-grid-head" : ""}`}
                  >
                    <label>
                      <input
                        ref={selectAll}
                        type="checkbox"
                        aria-label="Select up to 50 loaded posts"
                        checked={allLoadedSelected}
                        disabled={!selectable.length || Boolean(busy)}
                        onChange={() =>
                          setSelected(
                            allLoadedSelected
                              ? new Set()
                              : new Set(selectable.slice(0, 50).map((post) => post.id)),
                          )
                        }
                      />
                    </label>
                    <span>Content</span>
                    {manager && <span>Creator</span>}
                    <span>Review</span>
                    {!manager && <span>Media</span>}
                    <span>Updated</span>
                  </div>
                )}
                {loading && !filtered.length ? (
                  <div className="cw-loading" role="status">
                    <Loader2 className="animate-spin" />
                    Loading saved content…
                  </div>
                ) : !filtered.length && !error ? (
                  <div className="cw-empty">
                    <FileText size={32} />
                    <h2>
                      {hasFilters
                        ? "No matching posts"
                        : archived === "archived"
                          ? "No archived posts"
                          : "No posts yet"}
                    </h2>
                    <p>
                      {hasFilters
                        ? "Try another search or clear your filters."
                        : archived === "archived"
                          ? "Archived posts stay here until you restore them."
                          : "Pick a category on Home to make your first post."}
                    </p>
                    {hasFilters ? (
                      <Button variant="secondary" onClick={clearFilters}>
                        Clear filters
                      </Button>
                    ) : onCreateContent && archived === "active" ? (
                      <Button onClick={onCreateContent}>Create content</Button>
                    ) : null}
                  </div>
                ) : (
                  <ul className={`cw-posts cw-${view}`} aria-label="Saved posts">
                    {filtered.map(renderPost)}
                  </ul>
                )}
                {nextCursor && (
                  <Button
                    variant="secondary"
                    className="cw-load-more"
                    loading={loadingMore}
                    disabled={loading || Boolean(busy)}
                    onClick={() => void load(nextCursor)}
                  >
                    Load more
                  </Button>
                )}
              </div>
              <PostInspector
                active={Boolean(activeId)}
                post={detail}
                title={detail ? titleFor(detail) : "Post"}
                loading={detailLoading}
                error={detailError}
                image={image}
                imageLoading={imageLoading}
                imageError={imageError}
                held={held}
                canOpen={Boolean(
                  detail && ownPost(detail) && detail.creative_image_url && !held,
                )}
                canRetryWebsite={Boolean(
                  detail && canManage(detail) && !held && !detail.archived,
                )}
                canReview={Boolean(
                  detail &&
                  manager &&
                  detail.approval_status === "pending" &&
                  !detail.archived &&
                  detail.updated,
                )}
                canArchive={Boolean(
                  detail && canManage(detail) && workspaceRequestForPost(detail),
                )}
                busy={openingId === activeId ? "open" : busy}
                onClose={closeDetail}
                onReload={() => setDetailVersion((value) => value + 1)}
                onOpen={() => {
                  if (detail) void openCreative(detail);
                }}
                onArchive={() => {
                  if (detail)
                    setBatch({ posts: [detail], restore: Boolean(detail.archived) });
                }}
                onApprove={() => void decide("approved")}
                onRequestChanges={() => {
                  setReason("");
                  setRejecting(true);
                }}
                onReviewNext={() => {
                  if (nextPost) setActiveId(nextPost.id);
                }}
                hasNext={manager && Boolean(nextPost)}
                onRetryWebsite={() => {
                  if (detail && canManage(detail) && !held && !detail.archived)
                    void retryWebsite(detail);
                }}
                websiteRetrying={websiteRetryingId === activeId}
              />
            </div>
          </>
        )}
      </div>
      <Modal
        isOpen={Boolean(batch)}
        disableClose={Boolean(busy)}
        onClose={() => setBatch(null)}
        title={
          batch
            ? `${batch.restore ? "Restore" : "Archive"} ${batch.posts.length} post${batch.posts.length === 1 ? "" : "s"}?`
            : "Archive posts"
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              disabled={Boolean(busy)}
              onClick={() => setBatch(null)}
            >
              Cancel
            </Button>
            <Button loading={busy === "archive"} onClick={() => void runBatch()}>
              {batch?.restore ? "Restore posts" : "Archive posts"}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-ink-2">
          {batch?.restore
            ? "Posts return to active work with their existing owner, review status and safety holds."
            : "They move to Archived and can be restored. This does not remove content already shared or published."}
        </p>
      </Modal>
      <Modal
        isOpen={rejecting && Boolean(detail)}
        disableClose={Boolean(busy)}
        onClose={() => setRejecting(false)}
        title="Request changes"
        description="Your decision applies to this saved version."
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              disabled={Boolean(busy)}
              onClick={() => setRejecting(false)}
            >
              Cancel
            </Button>
            <Button
              loading={busy === "rejected"}
              disabled={!reason.trim()}
              onClick={() => void decide("rejected")}
            >
              Send changes request
            </Button>
          </div>
        }
      >
        <label className="cw-reason-label">
          What should change?
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Add a specific instruction for the creator…"
            maxLength={280}
            rows={4}
            autoFocus
          />
        </label>
      </Modal>
    </section>
  );
};
