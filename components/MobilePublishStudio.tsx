import React, { useEffect, useId, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Film,
  History,
  Loader2,
  LogOut,
  MoreHorizontal,
  RefreshCw,
  Settings,
  Share2,
  Sparkles,
} from "lucide-react";
import { cn } from "../utils/classNames";
import type { PlatformDeliveryOutput } from "./PlatformDeliveryBoard";
import { PlatformGlyph } from "./PlatformGlyph";

interface MobilePublishStudioProps {
  outputs: PlatformDeliveryOutput[];
  title: string;
  mediaPreview: React.ReactNode;
  caption: string;
  postingAs?: string;
  captionNote?: string;
  emptyStatusLabel?: string;
  emptyStatusDetail?: string;
  emptyMetadata?: string;
  copied?: boolean;
  onSelect: (id: string) => void;
  onRetry: (id: string) => void | Promise<void>;
  onToggleBatch?: (id: string, selected: boolean) => void;
  onToggleAll?: (selected: boolean) => void;
  onShareBatch?: () => void | Promise<void>;
  onCopyCaption: () => void | Promise<void>;
  onEditCaption?: () => void;
  onBack: () => void;
  onRemix?: () => void;
  onShowSettings?: () => void;
  onShowHistory?: () => void;
  onRequestLogout?: () => void;
  actionsDisabled?: boolean;
  recoveryDisabled?: boolean;
  batchActionDisabled?: boolean;
  /** Backward-compatible shared caption lock. Prefer the separate controls below. */
  captionActionsDisabled?: boolean;
  copyCaptionDisabled?: boolean;
  editCaptionDisabled?: boolean;
}

const mobileStatus = {
  available: {
    label: "Preparing",
    detail: "The exact file will be prepared when selected.",
    Icon: Loader2,
    tone: "border-surface-600 bg-surface-800/80 text-surface-200",
  },
  pending: {
    label: "Needs video",
    detail: "Create this video before saving or sharing it.",
    Icon: Film,
    tone: "border-warning-400/35 bg-warning-500/10 text-warning-100",
  },
  ready: {
    label: "Ready",
    detail: "File ready. Caption is included when you share.",
    Icon: CheckCircle2,
    tone: "border-success-400/35 bg-success-500/10 text-success-100",
  },
  generating: {
    label: "Preparing",
    detail: "Creating the exact file for this destination.",
    Icon: Loader2,
    tone: "border-primary-400/35 bg-primary-500/10 text-primary-100",
  },
  failed: {
    label: "Needs retry",
    detail: "The file did not finish preparing.",
    Icon: RefreshCw,
    tone: "border-error-400/35 bg-error-500/10 text-error-100",
  },
} as const;

const outputName = (output: PlatformDeliveryOutput) =>
  `${output.platformLabel} ${output.mediaKind} ${output.ratio}`;

/**
 * Phone-first review surface. The output rail, focused media, caption, and
 * readiness state stay together while the existing PostResult callbacks remain
 * authoritative for preparation, approval, save, and sharing.
 */
export const MobilePublishStudio: React.FC<MobilePublishStudioProps> = ({
  outputs,
  title,
  mediaPreview,
  caption,
  postingAs,
  captionNote,
  emptyStatusLabel,
  emptyStatusDetail,
  emptyMetadata,
  copied = false,
  onSelect,
  onRetry,
  onToggleBatch,
  onToggleAll,
  onShareBatch,
  onCopyCaption,
  onEditCaption,
  onBack,
  onRemix,
  onShowSettings,
  onShowHistory,
  onRequestLogout,
  actionsDisabled = false,
  recoveryDisabled = false,
  batchActionDisabled = false,
  captionActionsDisabled = false,
  copyCaptionDisabled,
  editCaptionDisabled,
}) => {
  const captionId = useId();
  const menuId = useId();
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const activeOutput = outputs.find((output) => output.selected) ?? outputs[0];
  const batchEligibleOutputs = outputs.filter(
    (output) => output.batchEligible !== false,
  );
  const batchSelectedCount = batchEligibleOutputs.filter(
    (output) => output.batchSelected,
  ).length;
  const allBatchSelected =
    batchEligibleOutputs.length > 0 &&
    batchSelectedCount === batchEligibleOutputs.length;
  const status = activeOutput
    ? mobileStatus[activeOutput.status]
    : mobileStatus.available;
  const StatusIcon = status.Icon;
  const canRetry =
    activeOutput?.status === "pending" || activeOutput?.status === "failed";
  const captionCanExpand = caption.length > 80 || caption.includes("\n");
  const hasMenuActions = Boolean(
    onRemix || onShowSettings || onShowHistory || onRequestLogout,
  );

  useEffect(() => {
    if (!menuOpen) return;

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (
        menuRef.current &&
        event.target instanceof Node &&
        !menuRef.current.contains(event.target)
      ) {
        setMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        requestAnimationFrame(() => menuButtonRef.current?.focus());
      }
    };

    window.addEventListener("pointerdown", closeOnOutsidePress);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePress);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  const runMenuAction = (action?: () => void) => {
    setMenuOpen(false);
    action?.();
  };

  return (
    <section
      className="min-w-0 overflow-hidden rounded-[1.35rem] border border-white/10 bg-[linear-gradient(160deg,rgba(13,25,43,0.98),rgba(5,12,23,0.98))] shadow-[0_22px_70px_rgba(0,0,0,0.36)]"
      aria-label="Platform delivery"
      data-testid="mobile-publish-studio"
    >
      <header className="relative flex min-w-0 items-center gap-2.5 border-b border-white/10 px-3 py-2">
        <button
          type="button"
          onClick={onBack}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-surface-100 transition-colors hover:bg-white/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
          aria-label="New photo"
          title="Create a new post"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-primary-300">
            {title}
          </p>
          <h1 className="truncate text-base font-semibold tracking-tight text-surface-50">
            {activeOutput?.platformLabel || title}
          </h1>
          <div className="mt-0.5 flex min-w-0 items-center justify-center gap-1 text-[10px] text-surface-400">
            {postingAs ? (
              <span
                className="inline-flex min-w-0 max-w-[9.5rem] items-center gap-1 rounded-full border border-primary-400/25 bg-primary-500/10 px-1.5 py-0.5 leading-none"
                aria-label={`Posting as ${postingAs}`}
              >
                <span className="shrink-0 text-primary-200">Posting as</span>
                <strong className="truncate font-semibold text-surface-100">
                  {postingAs}
                </strong>
              </span>
            ) : null}
            {activeOutput ? (
              <>
                {postingAs ? <span aria-hidden="true">·</span> : null}
                <span className="shrink-0 tabular-nums">
                  {activeOutput.mediaKind === "image" ? "Photo" : "Video"} ·{" "}
                  {activeOutput.ratio}
                  <span className="hidden min-[390px]:inline">
                    {" "}
                    · {activeOutput.width}×{activeOutput.height}
                  </span>
                </span>
              </>
            ) : (
              <span>{emptyMetadata || "Choose a destination output"}</span>
            )}
          </div>
        </div>
        {hasMenuActions ? (
          <div ref={menuRef} className="relative shrink-0">
            <button
              ref={menuButtonRef}
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              className="grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-surface-100 transition-colors hover:bg-white/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
              aria-label="More publishing options"
              aria-expanded={menuOpen}
              aria-controls={menuOpen ? menuId : undefined}
            >
              <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
            </button>
            {menuOpen ? (
              <div
                id={menuId}
                className="absolute right-0 top-full z-30 mt-2 w-48 overflow-hidden rounded-xl border border-white/15 bg-surface-950/98 p-1.5 text-left shadow-2xl shadow-black/50 backdrop-blur-xl"
                role="group"
                aria-label="Publishing options"
              >
                {onShowHistory ? (
                  <button
                    type="button"
                    onClick={() => runMenuAction(onShowHistory)}
                    className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 text-sm font-medium text-surface-100 hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                  >
                    <History className="h-4 w-4 text-primary-300" aria-hidden="true" />
                    My work
                  </button>
                ) : null}
                {onShowSettings ? (
                  <button
                    type="button"
                    onClick={() => runMenuAction(onShowSettings)}
                    className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 text-sm font-medium text-surface-100 hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                  >
                    <Settings className="h-4 w-4 text-surface-300" aria-hidden="true" />
                    Settings
                  </button>
                ) : null}
                {onRemix ? (
                  <button
                    type="button"
                    onClick={() => runMenuAction(onRemix)}
                    className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 text-sm font-medium text-surface-100 hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                  >
                    <Sparkles className="h-4 w-4 text-primary-300" aria-hidden="true" />
                    Remix this photo
                  </button>
                ) : null}
                {onRequestLogout ? (
                  <>
                    <div className="my-1 border-t border-white/10" aria-hidden="true" />
                    <button
                      type="button"
                      onClick={() => runMenuAction(onRequestLogout)}
                      className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 text-sm font-medium text-error-200 hover:bg-error-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error-400"
                    >
                      <LogOut className="h-4 w-4" aria-hidden="true" />
                      Log out
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <span className="h-11 w-11 shrink-0" aria-hidden="true" />
        )}
      </header>

      {outputs.length > 0 ? (
        <div className="border-b border-white/10 bg-black/10 py-1.5">
          <ul
            className="flex list-none snap-x snap-mandatory gap-1.5 overflow-x-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            aria-label="Mobile platform outputs"
          >
            {outputs.map((output) => {
              const selected = Boolean(output.selected);
              const batchEligible = output.batchEligible !== false;
              const outputStatus = mobileStatus[output.status];

              return (
                <li
                  key={output.id}
                  className={cn(
                    "grid h-11 w-[9.25rem] shrink-0 snap-center grid-cols-[minmax(0,1fr)_2.75rem] overflow-hidden rounded-lg border",
                    selected
                      ? "border-primary-400/75 bg-primary-500/15 shadow-[0_0_0_1px_rgba(96,165,250,0.15),0_12px_28px_rgba(0,0,0,0.24)]"
                      : "border-white/10 bg-white/[0.045]",
                  )}
                >
                  <button
                    type="button"
                    className={cn(
                      "flex h-full min-w-0 items-center gap-1.5 px-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-400",
                      !onToggleBatch && "col-span-2",
                    )}
                    onClick={() => onSelect(output.id)}
                    aria-pressed={selected}
                    aria-label={`Select ${outputName(output)}, ${output.width} by ${output.height} pixels`}
                  >
                    <PlatformGlyph label={output.platformLabel} size="sm" />
                    <span className="min-w-0">
                      <span className="block max-w-[6.1rem] truncate text-[11px] font-semibold leading-tight text-surface-50">
                        {output.platformLabel}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1 text-[9px] leading-none tabular-nums text-surface-400">
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            output.status === "ready"
                              ? "bg-success-400"
                              : output.status === "failed"
                                ? "bg-error-400"
                                : output.status === "pending"
                                  ? "bg-warning-400"
                                  : "bg-primary-400",
                          )}
                          aria-hidden="true"
                        />
                        {output.ratio} · {outputStatus.label}
                      </span>
                    </span>
                  </button>
                  {onToggleBatch ? (
                    <label
                      className={cn(
                        "grid h-11 w-11 place-items-center border-l border-white/10",
                        batchEligible
                          ? "cursor-pointer"
                          : "cursor-not-allowed opacity-45",
                      )}
                      title={
                        batchEligible
                          ? `Include ${outputName(output)} in guided sharing`
                          : "Create this video before adding it to guided sharing"
                      }
                    >
                      <span className="grid h-5 w-5 place-items-center rounded-full border border-white/20 bg-surface-950/90">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 accent-[var(--brand-primary)]"
                          checked={Boolean(output.batchSelected)}
                          disabled={!batchEligible}
                          onChange={(event) => {
                            if (batchEligible) {
                              onToggleBatch(output.id, event.currentTarget.checked);
                            }
                          }}
                          aria-label={`Include ${outputName(output)} in Share selected`}
                        />
                      </span>
                    </label>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {outputs.length > 1 ? (
            <p className="sr-only">Swipe to choose an exact platform file.</p>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-2 p-2">
        <div
          className="relative grid h-[clamp(10rem,38svh,20rem)] min-h-0 place-items-center overflow-hidden rounded-[1.15rem] border border-white/10 bg-black shadow-[0_18px_45px_rgba(0,0,0,0.4)] [@media(max-height:700px)]:h-56 [@media(max-height:600px)]:!h-40"
          role="region"
          aria-label="Media preview"
        >
          {mediaPreview}
        </div>

        <section
          className="rounded-xl border border-white/10 bg-white/[0.045] p-2.5"
          aria-label="Focused caption"
        >
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-surface-100">
                {activeOutput
                  ? `${activeOutput.platformLabel} caption`
                  : "Post caption"}
              </p>
              {captionNote ? (
                <p className="mt-0.5 truncate text-[10px] text-surface-400">
                  {captionNote}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 gap-1.5">
              {onEditCaption ? (
                <button
                  type="button"
                  disabled={editCaptionDisabled ?? captionActionsDisabled}
                  onClick={onEditCaption}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-primary-400/30 bg-primary-500/10 px-2.5 text-[11px] font-semibold text-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  Edit with AI
                </button>
              ) : null}
              <button
                type="button"
                disabled={copyCaptionDisabled ?? captionActionsDisabled}
                onClick={() => void onCopyCaption()}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.05] px-2.5 text-[11px] font-semibold text-surface-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 disabled:cursor-not-allowed disabled:opacity-45"
                aria-label="Copy caption"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-success-300" aria-hidden="true" />
                ) : null}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
          <div className="flex items-end gap-2">
            <p
              id={captionId}
              className={cn(
                "min-w-0 flex-1 whitespace-pre-line text-[13px] leading-relaxed text-surface-200",
                !captionExpanded && "line-clamp-2",
              )}
            >
              {caption}
            </p>
            {captionCanExpand ? (
              <button
                type="button"
                aria-controls={captionId}
                aria-expanded={captionExpanded}
                aria-label={
                  captionExpanded ? "Collapse full caption" : "Show full caption"
                }
                onClick={() => setCaptionExpanded((expanded) => !expanded)}
                className="min-h-11 shrink-0 rounded-lg px-1.5 text-[11px] font-semibold text-primary-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
              >
                {captionExpanded ? "Less" : "More"}
              </button>
            ) : null}
          </div>
        </section>

        <div
          className={cn(
            "flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2",
            status.tone,
          )}
          role="status"
          aria-live="polite"
        >
          <StatusIcon
            className={cn(
              "h-4 w-4 shrink-0",
              activeOutput?.status === "generating" &&
                "animate-spin motion-reduce:animate-none",
            )}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold">
              {activeOutput ? status.label : emptyStatusLabel || status.label}
            </p>
            <p className="truncate text-[10px] opacity-75">
              {activeOutput?.recoveryDisabledReason ||
                (activeOutput ? status.detail : emptyStatusDetail || status.detail)}
            </p>
          </div>
          {canRetry && activeOutput ? (
            <button
              type="button"
              disabled={
                actionsDisabled ||
                recoveryDisabled ||
                activeOutput.recoveryDisabled === true
              }
              onClick={() => void onRetry(activeOutput.id)}
              className="min-h-9 shrink-0 rounded-lg border border-current/25 bg-black/10 px-3 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current disabled:cursor-not-allowed disabled:opacity-45"
              aria-label={`${activeOutput.status === "pending" ? "Create" : "Retry"} ${outputName(activeOutput)}`}
              title={activeOutput.recoveryDisabledReason}
            >
              {activeOutput.status === "pending" ? "Create" : "Retry"}
            </button>
          ) : null}
        </div>

        {onToggleAll || onShareBatch ? (
          <div
            className="flex min-h-11 items-center gap-2 rounded-xl border border-white/10 bg-black/15 p-1.5"
            aria-label="Guided sharing selection"
          >
            <p className="min-w-0 flex-1 pl-1 text-[11px] font-medium text-surface-400">
              <span className="font-semibold text-surface-100">
                {batchSelectedCount}
              </span>{" "}
              selected
            </p>
            {onToggleAll ? (
              <button
                type="button"
                disabled={batchEligibleOutputs.length === 0}
                onClick={() => onToggleAll(!allBatchSelected)}
                className="min-h-9 rounded-lg border border-white/10 bg-white/[0.05] px-2.5 text-[11px] font-semibold text-surface-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {allBatchSelected ? "Clear all" : "Select all"}
              </button>
            ) : null}
            {onShareBatch ? (
              <button
                type="button"
                disabled={
                  batchActionDisabled || actionsDisabled || batchSelectedCount === 0
                }
                onClick={() => void onShareBatch()}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-primary-400/45 bg-primary-500/20 px-2.5 text-[11px] font-semibold text-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
                {allBatchSelected
                  ? `Share all ${batchEligibleOutputs.length}`
                  : `Share selected ${batchSelectedCount}`}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
};
