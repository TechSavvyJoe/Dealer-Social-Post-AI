import React, { useId } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Film,
  Image as ImageIcon,
  Layers3,
  Loader2,
  RefreshCw,
  Share2,
} from "lucide-react";
import { cn } from "../utils/classNames";

export type PlatformDeliveryStatus =
  "available" | "pending" | "ready" | "generating" | "failed";
export type PlatformDeliveryMediaKind = "image" | "video";

export interface PlatformDeliveryOutput {
  id: string;
  platformLabel: string;
  mediaKind: PlatformDeliveryMediaKind;
  ratio: string;
  width: number;
  height: number;
  status: PlatformDeliveryStatus;
  /** Static image used in delivery cards. Video playback belongs in the main preview. */
  poster?: string | null;
  /**
   * Backward-compatible image thumbnail. For video outputs this is only treated as a
   * poster while the video is not ready, so a video URL is never mounted per card.
   */
  thumbnail?: string | null;
  selected?: boolean;
  /** Exact File is already prepared, preserving fresh-tap mobile save/share. */
  actionsReady?: boolean;
  /** Locks Create/Retry when another output already owns the shared render job. */
  recoveryDisabled?: boolean;
  /** User-facing explanation for why this output cannot be created or retried. */
  recoveryDisabledReason?: string;
  /** Included in the guided multi-platform share queue. */
  batchSelected?: boolean;
  /** Pending/failed videos cannot enter the share queue until a file exists. */
  batchEligible?: boolean;
}

export interface PlatformDeliveryBoardProps {
  outputs: PlatformDeliveryOutput[];
  onSelect: (id: string) => void;
  onSave: (id: string) => void | Promise<void>;
  onShare: (id: string) => void | Promise<void>;
  onRetry: (id: string) => void | Promise<void>;
  title?: string;
  description?: string;
  className?: string;
  actionsDisabled?: boolean;
  /** Locks Create/Retry globally while a shared video render is in flight. */
  recoveryDisabled?: boolean;
  onToggleBatch?: (id: string, selected: boolean) => void;
  onToggleAll?: (selected: boolean) => void;
  onShareBatch?: () => void | Promise<void>;
  batchActionDisabled?: boolean;
}

const statusPresentation = {
  available: {
    label: "Available",
    detail: "Select this row to prepare its exact file",
    Icon: CheckCircle2,
    classes: "border-surface-500/50 bg-surface-800/55 text-surface-200",
  },
  pending: {
    label: "Needs video",
    detail: "Choose Create to render this video format",
    Icon: Film,
    classes: "border-warning-400/40 bg-warning-500/10 text-surface-100",
  },
  ready: {
    label: "Ready",
    detail: "Ready to save or share",
    Icon: CheckCircle2,
    classes: "border-success-400/40 bg-success-500/10 text-surface-100",
  },
  generating: {
    label: "Generating",
    detail: "Your platform-ready file is being prepared",
    Icon: Loader2,
    classes: "border-primary-400/40 bg-primary-500/10 text-surface-100",
  },
  failed: {
    label: "Needs retry",
    detail: "Generation did not finish",
    Icon: AlertCircle,
    classes: "border-error-400/40 bg-error-500/10 text-surface-100",
  },
} as const;

const outputName = (output: PlatformDeliveryOutput) =>
  `${output.platformLabel} ${output.mediaKind} ${output.ratio}`;

export const PlatformDeliveryBoard: React.FC<PlatformDeliveryBoardProps> = ({
  outputs,
  onSelect,
  onSave,
  onShare,
  onRetry,
  title = "Platform delivery",
  description = "Every file is prepared at the exact size selected for its destination.",
  className,
  actionsDisabled = false,
  recoveryDisabled = false,
  onToggleBatch,
  onToggleAll,
  onShareBatch,
  batchActionDisabled = false,
}) => {
  const headingId = useId();
  const descriptionId = useId();
  const readyCount = outputs.filter((output) => output.status === "ready").length;
  const batchEligibleOutputs = outputs.filter(
    (output) => output.batchEligible !== false,
  );
  const batchSelectedCount = batchEligibleOutputs.filter(
    (output) => output.batchSelected,
  ).length;
  const allBatchSelected =
    batchEligibleOutputs.length > 0 &&
    batchSelectedCount === batchEligibleOutputs.length;

  return (
    <section
      className={cn(
        "min-w-0 overflow-hidden rounded-2xl border border-surface-700/70",
        "bg-surface-900/95 shadow-[var(--shadow-lg)]",
        className,
      )}
      aria-labelledby={headingId}
      aria-describedby={descriptionId}
    >
      <header className="flex flex-col gap-3 border-b border-surface-700/70 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-primary-400/30 bg-primary-500/10 text-primary-200 [.theme-light_&]:text-primary-700">
              <Layers3 className="h-4 w-4" aria-hidden="true" />
            </span>
            <h2
              id={headingId}
              className="truncate text-base font-semibold tracking-tight text-surface-50"
            >
              {title}
            </h2>
          </div>
          <p
            id={descriptionId}
            className="mt-1.5 max-w-2xl text-xs leading-relaxed text-surface-400"
          >
            {description}
          </p>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
          <p
            className="mr-auto text-xs font-semibold tabular-nums text-surface-300"
            role="status"
            aria-live="polite"
          >
            {outputs.length === 0
              ? "No outputs yet"
              : `${readyCount} of ${outputs.length} prepared`}
          </p>
          {onToggleAll ? (
            <button
              type="button"
              disabled={batchEligibleOutputs.length === 0}
              className="min-h-11 shrink-0 whitespace-nowrap rounded-lg border border-surface-700 bg-surface-950/50 px-3 text-xs font-semibold text-surface-200 transition-colors hover:border-primary-400 disabled:cursor-not-allowed disabled:opacity-45"
              onClick={() => onToggleAll(!allBatchSelected)}
            >
              {allBatchSelected ? "Clear all" : "Select all"}
            </button>
          ) : null}
          {onShareBatch ? (
            <button
              type="button"
              disabled={batchActionDisabled || batchSelectedCount === 0}
              className="inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-primary-400/50 bg-primary-500/15 px-3 text-xs font-semibold text-surface-50 transition-colors hover:bg-primary-500/25 disabled:cursor-not-allowed disabled:opacity-45"
              onClick={() => void onShareBatch()}
            >
              <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
              {allBatchSelected
                ? `Share all ${batchEligibleOutputs.length}`
                : `Share selected ${batchSelectedCount}`}
            </button>
          ) : null}
        </div>
      </header>

      {outputs.length === 0 ? (
        <div className="grid min-h-36 place-items-center px-5 py-8 text-center">
          <div>
            <Layers3 className="mx-auto h-7 w-7 text-surface-600" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium text-surface-300">
              Choose a platform and format to create a deliverable.
            </p>
          </div>
        </div>
      ) : (
        <>
          <ul
            className="flex min-w-0 list-none snap-x snap-mandatory gap-3 overflow-x-auto p-3 [scrollbar-width:thin] sm:grid sm:snap-none sm:overflow-visible sm:p-4"
            aria-label="Platform-ready deliverables"
          >
            {outputs.map((output, index) => {
              const isReady = output.status === "ready";
              const isFailed = output.status === "failed";
              const canCreateOrRetry =
                output.status === "pending" || output.status === "failed";
              const actionsReady = output.actionsReady !== false;
              const recoveryLocked =
                recoveryDisabled || output.recoveryDisabled === true;
              const recoveryLockReason = output.recoveryDisabledReason
                ? output.recoveryDisabledReason
                : recoveryDisabled
                  ? "Another destination is already preparing this video format"
                  : undefined;
              const recoveryVerb = output.status === "pending" ? "Create" : "Retry";
              const batchEligible = output.batchEligible !== false;
              const presentation = statusPresentation[output.status];
              const StatusIcon = presentation.Icon;
              const MediaIcon = output.mediaKind === "video" ? Film : ImageIcon;
              const name = outputName(output);
              const statusId = `${headingId}-output-${index}-status`;
              const isLandscape = output.width >= output.height;
              const cardPoster =
                output.poster ??
                (output.mediaKind === "image" || output.status !== "ready"
                  ? output.thumbnail
                  : null);

              return (
                <li
                  key={output.id}
                  className={cn(
                    "w-[min(86vw,23rem)] shrink-0 snap-center overflow-hidden rounded-xl border",
                    "bg-surface-950/55 transition-[border-color,box-shadow,background-color] duration-200",
                    "sm:grid sm:w-auto sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center",
                    output.selected
                      ? "border-primary-400/70 bg-primary-500/[0.07] shadow-[0_0_0_1px_rgba(96,165,250,0.12),0_14px_36px_rgba(0,0,0,0.22)]"
                      : "border-surface-700/70 hover:border-surface-600",
                  )}
                  aria-current={output.selected ? "true" : undefined}
                >
                  <button
                    type="button"
                    className={cn(
                      "group grid min-h-[5.75rem] w-full min-w-0 grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-3 p-3 text-left",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-400",
                      "sm:min-h-[5rem] sm:p-3",
                    )}
                    onClick={() => onSelect(output.id)}
                    aria-pressed={Boolean(output.selected)}
                    aria-describedby={statusId}
                    aria-label={`Select ${name}, ${output.width} by ${output.height} pixels`}
                  >
                    <span className="grid h-[4.25rem] w-[4.25rem] place-items-center overflow-hidden rounded-lg border border-surface-700/70 bg-surface-950/80">
                      <span
                        className="relative grid place-items-center overflow-hidden rounded-[5px] bg-surface-900"
                        style={
                          isLandscape
                            ? {
                                width: "100%",
                                aspectRatio: `${output.width} / ${output.height}`,
                              }
                            : {
                                height: "100%",
                                aspectRatio: `${output.width} / ${output.height}`,
                              }
                        }
                      >
                        {cardPoster ? (
                          <img
                            src={cardPoster}
                            alt={`${name} poster`}
                            className="absolute inset-0 h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <MediaIcon
                            className="h-5 w-5 text-surface-500"
                            aria-hidden="true"
                          />
                        )}
                        {output.status === "generating" && (
                          <span className="absolute inset-0 grid place-items-center bg-black/55">
                            <Loader2
                              className="h-5 w-5 animate-spin text-white motion-reduce:animate-none"
                              aria-hidden="true"
                            />
                          </span>
                        )}
                      </span>
                    </span>

                    <span className="min-w-0">
                      <span className="flex min-w-0 items-center gap-2">
                        <MediaIcon
                          className="h-3.5 w-3.5 shrink-0 text-primary-300 [.theme-light_&]:text-primary-700"
                          aria-hidden="true"
                        />
                        <span className="truncate text-sm font-semibold text-surface-50">
                          {output.platformLabel}
                        </span>
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-xs font-medium capitalize text-surface-300">
                          {output.mediaKind}
                        </span>
                        <span
                          className="h-1 w-1 rounded-full bg-surface-600"
                          aria-hidden="true"
                        />
                        <span className="text-xs font-semibold tabular-nums text-primary-200 [.theme-light_&]:text-primary-700">
                          {output.ratio}
                        </span>
                      </span>
                      <span className="mt-1 block text-[11px] tabular-nums text-surface-400">
                        {output.width.toLocaleString()} ×{" "}
                        {output.height.toLocaleString()} px
                      </span>
                      <span
                        id={statusId}
                        className={cn(
                          "mt-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                          presentation.classes,
                        )}
                        role="status"
                        aria-live="polite"
                      >
                        <StatusIcon
                          className={cn(
                            "h-3 w-3",
                            output.status === "generating" &&
                              "animate-spin motion-reduce:animate-none",
                          )}
                          aria-hidden="true"
                        />
                        {presentation.label}
                        <span className="sr-only">. {presentation.detail}</span>
                      </span>
                    </span>
                  </button>

                  <div
                    className="grid grid-cols-3 gap-2 border-t border-surface-700/70 p-2.5 sm:w-[15.5rem] sm:border-l sm:border-t-0"
                    role="group"
                    aria-label={`${output.platformLabel} ${output.mediaKind} actions`}
                  >
                    {onToggleBatch ? (
                      <label
                        className={cn(
                          "col-span-3 flex min-h-11 items-center gap-2 rounded-lg border border-surface-700/70 bg-surface-900/55 px-2.5 text-xs font-semibold",
                          batchEligible
                            ? "cursor-pointer text-surface-200"
                            : "cursor-not-allowed text-surface-500",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(output.batchSelected)}
                          disabled={!batchEligible}
                          onChange={(event) => {
                            if (batchEligible) {
                              onToggleBatch(output.id, event.currentTarget.checked);
                            }
                          }}
                          className="h-4 w-4 accent-[var(--brand-primary)]"
                          aria-label={`Include ${name} in Share selected`}
                        />
                        {batchEligible
                          ? "Include in Share selected"
                          : "Create this video before selecting it"}
                      </label>
                    ) : null}
                    {canCreateOrRetry && output.recoveryDisabledReason ? (
                      <p className="col-span-3 rounded-lg border border-warning-400/25 bg-warning-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-surface-300">
                        {output.recoveryDisabledReason}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      disabled={actionsDisabled || !isReady || !actionsReady}
                      onClick={() => void onSave(output.id)}
                      className={cn(
                        "inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-lg border px-2 text-xs font-semibold",
                        "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success-300",
                        "border-success-400/40 bg-success-500/10 text-surface-100 hover:bg-success-500/20",
                        "disabled:cursor-not-allowed disabled:border-surface-700/60 disabled:bg-surface-900/40 disabled:text-surface-500",
                      )}
                      aria-label={`Save ${name}`}
                      title={
                        !output.selected
                          ? "Select this output first"
                          : isReady && actionsReady
                            ? `Save ${name}`
                            : "Preparing the exact file"
                      }
                    >
                      <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      Save
                    </button>
                    <button
                      type="button"
                      disabled={actionsDisabled || !isReady || !actionsReady}
                      onClick={() => void onShare(output.id)}
                      className={cn(
                        "inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-lg border px-2 text-xs font-semibold",
                        "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300",
                        "border-primary-400/40 bg-primary-500/10 text-surface-100 hover:bg-primary-500/20",
                        "disabled:cursor-not-allowed disabled:border-surface-700/60 disabled:bg-surface-900/40 disabled:text-surface-500",
                      )}
                      aria-label={`Share ${name}`}
                      title={
                        !output.selected
                          ? "Select this output first"
                          : isReady && actionsReady
                            ? `Share ${name}`
                            : "Preparing the exact file"
                      }
                    >
                      <Share2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      Share
                    </button>
                    <button
                      type="button"
                      disabled={actionsDisabled || recoveryLocked || !canCreateOrRetry}
                      onClick={() => void onRetry(output.id)}
                      className={cn(
                        "inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-lg border px-2 text-xs font-semibold",
                        "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error-300",
                        "border-error-400/40 bg-error-500/10 text-surface-100 hover:bg-error-500/20",
                        "disabled:cursor-not-allowed disabled:border-surface-700/60 disabled:bg-surface-900/40 disabled:text-surface-500",
                      )}
                      aria-label={`${recoveryVerb} ${name}`}
                      title={
                        recoveryLocked
                          ? recoveryLockReason
                          : isFailed
                            ? `Retry ${name}`
                            : output.status === "pending"
                              ? `Create ${name}`
                              : "Create or retry is available when the file still needs work"
                      }
                    >
                      <RefreshCw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      {recoveryVerb}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {outputs.length > 1 ? (
            <p className="px-4 pb-3 text-center text-[11px] font-medium text-surface-400 sm:hidden">
              Swipe sideways to review every platform output.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
};
