import React, { useCallback, useEffect, useRef, useState } from "react";
import { m, AnimatePresence } from "framer-motion";
import {
  Globe,
  Music,
  Share2,
  Loader2,
  Check,
  AlertCircle,
  ClipboardPaste,
  ExternalLink,
  RefreshCw,
  ArrowRight,
} from "lucide-react";

const FacebookGlyph: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M13.5 21v-7.5h2.5l.5-3h-3v-2c0-.9.3-1.5 1.5-1.5H17V4.2c-.7-.1-1.5-.2-2.4-.2-2.4 0-4.1 1.5-4.1 4.1V10.5H8v3h2.5V21h3z" />
  </svg>
);
const InstagramGlyph: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
  </svg>
);
const XGlyph: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M18.244 2H21l-6.522 7.45L22 22h-6.78l-4.92-6.43L4.6 22H2l7.07-8.073L2 2h6.91l4.46 5.9L18.244 2zM17.13 20h1.74L7.95 4H6.1l11.03 16z" />
  </svg>
);
const LinkedinGlyph: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M4.98 3.5a2.5 2.5 0 11.001 5.001A2.5 2.5 0 014.98 3.5zM3 10h4v11H3V10zm7 0h3.8v1.5h.1c.5-.9 1.8-1.8 3.7-1.8 3.9 0 4.6 2.6 4.6 5.9V21h-4v-4.9c0-1.2 0-2.7-1.6-2.7s-1.9 1.3-1.9 2.6V21h-4V10z" />
  </svg>
);
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import {
  CORE_PUBLISH_IDS,
  copyPreparedCaption,
  downloadPreparedMedia,
  isMobileShareDevice,
  openPreparedTarget,
  orderPublishTargets,
  preparePublishShare,
  sharePrepared,
  type PreparedPublishShare,
  PublishStatus,
  PublishContent,
  PublishTarget,
} from "../services/publishTargets";
import { triggerHapticFeedback } from "../utils/haptics";
import { toUiMessage } from "../utils/errorMessages";
import { logEvent } from "../utils/telemetry";
import { cn } from "../utils/classNames";
import { captionIncludesDealershipMention } from "../utils/socialAttribution";

export interface PlatformShareCaption {
  text: string;
  disclosures?: string;
  blockedReason?: string;
}

export interface ShareQueueProgress {
  /** One-based position of the output currently being handed off. */
  current: number;
  total: number;
  /** Human-readable destination/format label for the next selected output. */
  nextLabel?: string;
}

interface ShareDialogProps {
  isOpen: boolean;
  onClose: () => void;
  content: PublishContent;
  platformCaptions?: Record<string, string | PlatformShareCaption>;
  selectedPlatformIds?: string[];
  /** Open directly on one exact delivery row and prepare it before Share now. */
  focusedTargetId?: string;
  /** Progress for the user-driven Share selected sequence. */
  queueProgress?: ShareQueueProgress;
  /** Advances only after the user explicitly finishes or skips this output. */
  onQueueAdvance?: () => void;
  /** Exact configured dealership mention expected in this destination's caption. */
  dealershipMention?: string;
}

type PreparationState =
  | { status: "preparing" }
  | { status: "ready"; item: PreparedPublishShare }
  | { status: "error"; message: string };

const ICON_MAP: Record<
  PublishTarget["icon"],
  React.ComponentType<{ className?: string }>
> = {
  facebook: FacebookGlyph,
  instagram: InstagramGlyph,
  music: Music,
  globe: Globe,
  twitter: XGlyph,
  linkedin: LinkedinGlyph,
  share2: Share2,
};

const CORE_SET = new Set<string>(CORE_PUBLISH_IDS);

const META_APP_IDS = new Set(["facebook_feed", "marketplace"]);
const FACEBOOK_TAG_TARGET_IDS = new Set(["facebook_feed", "marketplace"]);

/**
 * Salesperson-first share: prefer native social apps (existing logins),
 * never force a slow Facebook website re-login on the phone.
 */
export const ShareDialog: React.FC<ShareDialogProps> = ({
  isOpen,
  onClose,
  content,
  platformCaptions,
  selectedPlatformIds,
  focusedTargetId,
  queueProgress,
  onQueueAdvance,
  dealershipMention,
}) => {
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<{
    targetId: string;
    status: PublishStatus;
  } | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [preparation, setPreparation] = useState<Record<string, PreparationState>>({});
  const [operationError, setOperationError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "failed">(
    "idle",
  );
  const preparationGenerationRef = useRef(0);
  const targetRequestRef = useRef<Record<string, number>>({});
  const copyRequestRef = useRef(0);
  const onPhone = React.useMemo(() => isMobileShareDevice(), []);

  const allOrderedTargets = React.useMemo(
    () => orderPublishTargets(selectedPlatformIds),
    [selectedPlatformIds],
  );
  const orderedTargets = React.useMemo(() => {
    if (!focusedTargetId) return allOrderedTargets;
    const focused = allOrderedTargets.find((target) => target.id === focusedTargetId);
    return focused ? [focused] : allOrderedTargets;
  }, [allOrderedTargets, focusedTargetId]);
  const coreTargets = React.useMemo(
    () =>
      focusedTargetId
        ? orderedTargets
        : orderedTargets.filter((t) => CORE_SET.has(t.id)),
    [focusedTargetId, orderedTargets],
  );
  const moreTargets = React.useMemo(
    () => (focusedTargetId ? [] : orderedTargets.filter((t) => !CORE_SET.has(t.id))),
    [focusedTargetId, orderedTargets],
  );

  const contentForTarget = useCallback(
    (targetId: string): PublishContent => {
      const variant = platformCaptions?.[targetId];
      if (!variant) return content;
      if (typeof variant === "string") {
        return {
          ...content,
          text: variant.trim(),
          disclosures: undefined,
        };
      }
      if (variant.blockedReason) throw new Error(variant.blockedReason);
      return {
        ...content,
        text: variant.text.trim(),
        disclosures: variant.disclosures,
      };
    },
    [
      content.disclosures,
      content.hashtags,
      content.imageDataUrl,
      content.preparedFile,
      content.text,
      content.videoUrl,
      platformCaptions,
    ],
  );

  const prepareTarget = useCallback(
    async (target: PublishTarget, generation: number) => {
      const requestId = (targetRequestRef.current[target.id] || 0) + 1;
      targetRequestRef.current[target.id] = requestId;
      setPreparation((current) => ({
        ...current,
        [target.id]: { status: "preparing" },
      }));

      try {
        const item = await preparePublishShare(target.id, {
          ...contentForTarget(target.id),
        });
        if (
          preparationGenerationRef.current !== generation ||
          targetRequestRef.current[target.id] !== requestId
        ) {
          return;
        }
        setPreparation((current) => ({
          ...current,
          [target.id]: { status: "ready", item },
        }));
      } catch (err) {
        if (
          preparationGenerationRef.current !== generation ||
          targetRequestRef.current[target.id] !== requestId
        ) {
          return;
        }
        const detail =
          err instanceof Error && err.message
            ? err.message
            : "Check your connection and try again.";
        setPreparation((current) => ({
          ...current,
          [target.id]: {
            status: "error",
            message: `${target.label} media could not be prepared. ${detail}`,
          },
        }));
      }
    },
    [contentForTarget],
  );

  useEffect(() => {
    if (isOpen) return;
    preparationGenerationRef.current += 1;
    targetRequestRef.current = {};
    copyRequestRef.current += 1;
    // Release the prepared File/Blob as soon as the dialog closes. Retaining a
    // full MP4 here can push an iPhone PWA over its memory limit.
    setPreparation({});
    setSelectedTargetId(null);
    setBusy(null);
    setStatus(null);
    setOperationError(null);
    setCopyState("idle");
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const generation = preparationGenerationRef.current + 1;
    preparationGenerationRef.current = generation;
    targetRequestRef.current = {};
    // Rendering nine full-size canvases at once can exhaust an iPhone tab.
    // Prepare only the destination the salesperson actually selects.
    setPreparation({});
    setOperationError(null);
    setStatus(null);
    const focusedTarget = focusedTargetId
      ? orderedTargets.find((target) => target.id === focusedTargetId)
      : undefined;
    setSelectedTargetId(focusedTarget?.id || null);
    setCopyState("idle");
    copyRequestRef.current += 1;
    if (focusedTarget) {
      void prepareTarget(focusedTarget, generation);
    }

    return () => {
      if (preparationGenerationRef.current === generation) {
        preparationGenerationRef.current += 1;
      }
    };
  }, [focusedTargetId, isOpen]);

  const handlePick = useCallback(
    (target: PublishTarget) => {
      if (busy) return;
      triggerHapticFeedback();
      // Keep at most one full-size prepared File resident. Switching targets
      // invalidates older in-flight work and releases prior canvases/files for
      // garbage collection instead of accumulating every export on mobile.
      Object.keys(targetRequestRef.current).forEach((targetId) => {
        if (targetId !== target.id) {
          targetRequestRef.current[targetId] =
            (targetRequestRef.current[targetId] || 0) + 1;
        }
      });
      setPreparation((current) =>
        current[target.id] ? { [target.id]: current[target.id] } : {},
      );
      setSelectedTargetId(target.id);
      setStatus(null);
      setOperationError(null);
      setCopyState("copying");
      const copyRequest = copyRequestRef.current + 1;
      copyRequestRef.current = copyRequest;

      // Clipboard writes can be rejected by Safari/browser policy. Track the
      // actual result so the UI never claims the caption is ready when it is not.
      const prep = preparation[target.id];
      if (!prep || prep.status === "error") {
        setCopyState("idle");
        void prepareTarget(target, preparationGenerationRef.current);
        return;
      }
      if (prep?.status !== "ready") {
        setCopyState("idle");
        return;
      }
      const copyPromise = copyPreparedCaption(prep.item);
      void copyPromise.then((copied) => {
        if (copyRequestRef.current !== copyRequest) return;
        setCopyState(copied ? "copied" : "failed");
        if (!copied) {
          setOperationError(
            "Your browser did not allow clipboard access. Use Copy caption before opening the social app.",
          );
        }
      });
    },
    [busy, preparation, prepareTarget],
  );

  const handleShareNow = useCallback(async () => {
    if (!selectedTargetId || busy) return;
    const targetPreparation = preparation[selectedTargetId];
    if (targetPreparation?.status !== "ready") return;
    const item = targetPreparation.item;
    triggerHapticFeedback();
    setBusy(selectedTargetId);
    setStatus(null);
    try {
      // `sharePrepared` invokes navigator.share before its first await.
      const result = await sharePrepared(item);
      setStatus({ targetId: selectedTargetId, status: result });
      logEvent("share.attempt", {
        target: selectedTargetId,
        kind: result.kind,
        handoff: item.target.handoff,
      });
    } catch (err) {
      setStatus({
        targetId: selectedTargetId,
        status: {
          kind: "error",
          message: toUiMessage(err, "Sharing could not start. Try again."),
        },
      });
    } finally {
      setBusy(null);
    }
  }, [busy, preparation, selectedTargetId]);

  const selectedPreparation = selectedTargetId
    ? preparation[selectedTargetId]
    : undefined;
  const selectedPrepared =
    selectedPreparation?.status === "ready" ? selectedPreparation.item : undefined;
  const selectedTarget = selectedTargetId
    ? orderedTargets.find((target) => target.id === selectedTargetId)
    : undefined;
  const failedTargetCount = Object.values(preparation).filter(
    (item) => item.status === "error",
  ).length;
  const normalizedQueueProgress = queueProgress
    ? {
        current: Math.min(
          Math.max(1, Math.trunc(queueProgress.current) || 1),
          Math.max(1, Math.trunc(queueProgress.total) || 1),
        ),
        total: Math.max(1, Math.trunc(queueProgress.total) || 1),
        nextLabel: queueProgress.nextLabel?.trim(),
      }
    : null;
  const isSuccessfulHandoff = status?.status.kind === "shared";
  const queueActionLabel = normalizedQueueProgress
    ? normalizedQueueProgress.current >= normalizedQueueProgress.total
      ? "Finish sequence"
      : isSuccessfulHandoff
        ? `Next selected: ${normalizedQueueProgress.nextLabel || "next output"}`
        : `Skip to: ${normalizedQueueProgress.nextLabel || "next output"}`
    : null;
  const canAdvanceQueue =
    !!normalizedQueueProgress &&
    !!onQueueAdvance &&
    !!status &&
    status.status.kind !== "error";
  const focusedTagGuidance =
    focusedTargetId &&
    selectedPrepared &&
    dealershipMention &&
    captionIncludesDealershipMention(selectedPrepared.caption, dealershipMention)
      ? FACEBOOK_TAG_TARGET_IDS.has(focusedTargetId)
        ? "Dealership Page mention text is included in the caption. After you paste, Facebook may show a Page suggestion; tap the correct dealership Page to create a clickable mention."
        : focusedTargetId === "linkedin"
          ? "Dealership company mention text is included in the caption. After you paste, LinkedIn may show a company suggestion; tap the correct dealership company to create a clickable mention."
          : null
      : null;

  const handleCopySelected = useCallback(() => {
    if (!selectedPrepared || busy) return;
    triggerHapticFeedback();
    setOperationError(null);
    setCopyState("copying");
    const copyRequest = copyRequestRef.current + 1;
    copyRequestRef.current = copyRequest;
    void copyPreparedCaption(selectedPrepared).then((copied) => {
      if (copyRequestRef.current !== copyRequest) return;
      setCopyState(copied ? "copied" : "failed");
      if (!copied) {
        setOperationError(
          "Your browser did not allow clipboard access. Select and copy the caption manually.",
        );
      }
    });
  }, [busy, selectedPrepared]);

  const msg = (() => {
    const s = status?.status;
    if (!s) return null;
    if (s.kind === "error") return s.message;
    if (s.kind === "cancelled") {
      return s.message || "Cancelled. Caption is still on your clipboard.";
    }
    if (s.kind === "shared" || s.kind === "fallback") {
      return s.message || "Caption copied. Finish in the social app.";
    }
    return null;
  })();

  const showMetaChecklist =
    status &&
    META_APP_IDS.has(status.targetId) &&
    (status.status.kind === "shared" ||
      status.status.kind === "fallback" ||
      status.status.kind === "cancelled");

  const tile = (target: PublishTarget) => {
    const Icon = ICON_MAP[target.icon];
    const isBusy = busy === target.id;
    const isActive = selectedTargetId === target.id;
    const targetPreparation = preparation[target.id];
    const isPreparing = targetPreparation?.status === "preparing";
    const preparationFailed = targetPreparation?.status === "error";
    const ok =
      isActive &&
      (status?.status.kind === "shared" || status?.status.kind === "fallback");

    const shortHint = isPreparing
      ? "Preparing media…"
      : preparationFailed
        ? "Media preparation failed · select for retry options"
        : target.id === "facebook_feed"
          ? onPhone
            ? "Use Facebook app · paste caption · add from Photos"
            : isActive && copyState === "copied"
              ? "Caption copied · open Facebook · paste"
              : isActive && copyState === "failed"
                ? "Copy caption below · open Facebook · paste"
                : "Select to prepare caption and media"
          : target.id.startsWith("instagram")
            ? "Share photo · open Instagram · paste caption"
            : target.id === "tiktok"
              ? "Share media · open TikTok · paste caption"
              : target.hint;

    return (
      <button
        key={target.id}
        type="button"
        onClick={() => handlePick(target)}
        disabled={!!busy}
        className={cn(
          "flex min-h-[5.5rem] flex-col items-start gap-2 rounded-2xl border p-4 text-left transition-colors",
          target.id === "facebook_feed"
            ? "border-[#1877F2]/50 bg-[#1877F2]/15 hover:bg-[#1877F2]/20"
            : "border-hairline bg-fill-subtle hover:bg-fill-hover",
          isActive ? "ring-2 ring-primary-400/60" : "",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/70",
        )}
        aria-pressed={isActive}
        aria-label={`Share to ${target.label}${
          isPreparing
            ? ", preparing media"
            : preparationFailed
              ? ", media preparation failed"
              : targetPreparation?.status === "ready"
                ? ", media ready"
                : ""
        }`}
      >
        <div className="flex w-full items-center justify-between gap-2">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-xl text-white"
            style={{ background: target.accent }}
          >
            {isBusy || isPreparing ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            ) : preparationFailed ? (
              <AlertCircle className="h-5 w-5" aria-hidden="true" />
            ) : ok ? (
              <Check className="h-5 w-5" aria-hidden="true" />
            ) : (
              <Icon className="h-5 w-5" aria-hidden="true" />
            )}
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-surface-400">
            {target.handoff === "photos-then-app" || target.handoff === "clipboard-open"
              ? "App"
              : target.handoff === "share-file"
                ? "Share"
                : "Share"}
          </span>
        </div>
        <div>
          <div className="text-base font-semibold text-surface-50">{target.label}</div>
          <div className="mt-0.5 text-xs text-surface-400">{shortHint}</div>
        </div>
      </button>
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={focusedTargetId ? "Share exact output" : "Share"}
      description={
        focusedTargetId
          ? "This platform-ready file is prepared first. Then a fresh Share now tap opens your device sheet."
          : "Choose a destination. We prepare the right media before you share."
      }
      size="lg"
    >
      <div className="space-y-4">
        {focusedTargetId && normalizedQueueProgress ? (
          <div
            className="rounded-xl border border-primary-400/30 bg-primary-500/10 px-3 py-3"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="font-semibold text-primary-100">Share sequence</span>
              <span className="font-semibold tabular-nums text-primary-200">
                {normalizedQueueProgress.current} of {normalizedQueueProgress.total}
              </span>
            </div>
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-primary-950/35"
              role="progressbar"
              aria-label="Selected output sequence"
              aria-valuemin={1}
              aria-valuemax={normalizedQueueProgress.total}
              aria-valuenow={normalizedQueueProgress.current}
            >
              <div
                className="h-full rounded-full bg-primary-400 transition-[width]"
                style={{
                  width: `${(normalizedQueueProgress.current / normalizedQueueProgress.total) * 100}%`,
                }}
              />
            </div>
          </div>
        ) : null}

        <div className="flex items-start gap-2 rounded-xl border border-hairline bg-fill-subtle px-3 py-2.5 text-xs leading-relaxed text-surface-300">
          <ClipboardPaste className="mt-0.5 h-4 w-4 shrink-0 text-primary-300" />
          <div className="space-y-1">
            <p>
              <strong className="text-surface-100">Media prepares now</strong>, before
              you press Share now. Choose a destination, wait for ready, then use the
              Share now button to open your device&apos;s share sheet.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {coreTargets.map(tile)}
        </div>

        {moreTargets.length > 0 && (
          <details className="group rounded-xl border border-hairline bg-surface-950/40">
            <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-semibold text-surface-200 marker:content-none [&::-webkit-details-marker]:hidden">
              More options
              <span className="ml-2 text-xs font-normal text-surface-400 group-open:hidden">
                (Google, Marketplace, …)
              </span>
            </summary>
            <div className="grid grid-cols-2 gap-2 border-t border-hairline p-3 sm:grid-cols-3">
              {moreTargets.map(tile)}
            </div>
          </details>
        )}

        {failedTargetCount > 0 && selectedPreparation?.status !== "error" ? (
          <p
            className="rounded-xl border border-warning-500/25 bg-warning-500/10 px-3 py-2.5 text-xs text-warning-100"
            role="status"
          >
            {failedTargetCount === 1
              ? "One destination needs attention. Select its warning tile to retry."
              : `${failedTargetCount} destinations need attention. Select each warning tile to retry.`}
          </p>
        ) : null}

        {selectedPrepared ? (
          <div className="rounded-2xl border border-primary-400/25 bg-primary-500/[0.08] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div role="status">
                <p className="text-sm font-semibold text-surface-50">
                  {selectedPrepared.target.label} is ready
                </p>
                <p className="mt-1 text-xs text-surface-400">
                  {copyState === "copied"
                    ? "Caption copied. Share now opens the system sheet immediately."
                    : copyState === "failed"
                      ? "Media is ready. Copy the caption below before finishing."
                      : "Share now opens the system sheet immediately."}
                </p>
                {focusedTagGuidance ? (
                  <p className="mt-2 max-w-prose rounded-lg border border-primary-400/25 bg-primary-500/10 px-2.5 py-2 text-xs leading-relaxed text-primary-100">
                    {focusedTagGuidance}
                  </p>
                ) : null}
              </div>
              <div className="grid shrink-0 grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  size="lg"
                  className="min-h-12"
                  disabled={!!busy || copyState === "copying"}
                  leftIcon={
                    copyState === "copied" ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <ClipboardPaste className="h-4 w-4" />
                    )
                  }
                  onClick={handleCopySelected}
                >
                  {copyState === "copying"
                    ? "Copying…"
                    : copyState === "copied"
                      ? "Copied"
                      : "Copy caption"}
                </Button>
                <Button
                  variant="primary"
                  size="lg"
                  className="min-h-12"
                  disabled={!!busy}
                  leftIcon={
                    busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Share2 className="h-4 w-4" />
                    )
                  }
                  onClick={() => void handleShareNow()}
                >
                  Share now
                </Button>
              </div>
            </div>
          </div>
        ) : selectedPreparation?.status === "preparing" ? (
          <div
            className="flex min-h-20 items-center justify-center gap-2 rounded-xl border border-hairline bg-fill-subtle text-sm text-surface-400"
            role="status"
          >
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Preparing media…
          </div>
        ) : selectedPreparation?.status === "error" && selectedTarget ? (
          <div
            className="rounded-xl border border-error-500/30 bg-error-500/10 p-4 text-sm text-error-100 [.theme-light_&]:text-error-800"
            role="alert"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>{selectedPreparation.message}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 min-h-11"
              leftIcon={<RefreshCw className="h-4 w-4" />}
              onClick={() =>
                void prepareTarget(selectedTarget, preparationGenerationRef.current)
              }
            >
              Retry media preparation
            </Button>
          </div>
        ) : selectedTarget ? (
          <div
            className="rounded-xl border border-warning-500/25 bg-warning-500/10 p-4 text-sm text-warning-100"
            role="alert"
          >
            Media preparation did not start.
            <Button
              variant="outline"
              size="sm"
              className="mt-3 min-h-11"
              leftIcon={<RefreshCw className="h-4 w-4" />}
              onClick={() =>
                void prepareTarget(selectedTarget, preparationGenerationRef.current)
              }
            >
              Prepare media
            </Button>
          </div>
        ) : null}

        {operationError ? (
          <p
            className="rounded-xl border border-error-500/30 bg-error-500/10 px-3 py-2.5 text-xs text-error-100 [.theme-light_&]:text-error-800"
            role="alert"
          >
            {operationError}
          </p>
        ) : null}

        <AnimatePresence>
          {(msg || showMetaChecklist) && status && (
            <m.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={cn(
                "rounded-xl border px-3 py-2.5 text-xs leading-relaxed space-y-2",
                status.status.kind === "error"
                  ? "border-error-500/40 bg-error-500/10 text-error-100 [.theme-light_&]:text-error-800"
                  : status.status.kind === "cancelled"
                    ? "border-surface-600 bg-surface-900/60 text-surface-300"
                    : "border-success-500/40 bg-success-500/10 text-success-100",
              )}
              role={status.status.kind === "error" ? "alert" : "status"}
            >
              <div className="flex items-start gap-2">
                {status.status.kind === "error" ? (
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                ) : (
                  <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                )}
                <span>{msg}</span>
              </div>

              {showMetaChecklist && (
                <div className="rounded-lg border border-hairline bg-black/20 px-3 py-2 text-surface-100">
                  <p className="mb-1.5 font-semibold text-surface-50">
                    Finish in the Facebook app
                  </p>
                  <ol className="list-decimal space-y-1 pl-4 text-[11px] text-surface-300">
                    <li>
                      {copyState === "copied"
                        ? "Caption is confirmed on your clipboard"
                        : "Tap Copy caption below, then paste it in Facebook"}
                    </li>
                    <li>Save/share the photo into Photos if the sheet offered it</li>
                    <li>
                      Open the{" "}
                      <strong className="text-surface-100">Facebook app</strong> (blue
                      icon) — not a browser tab
                    </li>
                    <li>New post → long-press → Paste</li>
                    <li>Add photo from your library</li>
                  </ol>
                </div>
              )}

              {selectedPrepared && status.status.kind !== "error" ? (
                <div className="flex flex-wrap gap-2 border-t border-hairline pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCopyState("copying");
                      void copyPreparedCaption(selectedPrepared).then((ok) => {
                        setCopyState(ok ? "copied" : "failed");
                        setOperationError(ok ? null : "Could not copy the caption.");
                      });
                    }}
                    className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-hairline bg-fill-subtle px-3 py-2 text-xs font-semibold text-surface-100"
                  >
                    <ClipboardPaste className="h-3.5 w-3.5" />
                    {copyState === "copying"
                      ? "Copying…"
                      : copyState === "copied"
                        ? "Caption copied"
                        : "Copy caption"}
                  </button>
                  {selectedPrepared.file ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (!downloadPreparedMedia(selectedPrepared)) {
                          setOperationError(
                            "The browser could not start the media download. Try Share now again or use the main Save button.",
                          );
                        }
                      }}
                      className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-hairline bg-fill-subtle px-3 py-2 text-xs font-semibold text-surface-100"
                    >
                      Save media
                    </button>
                  ) : null}
                  {(onPhone || selectedPrepared.webUrl) && (
                    <button
                      type="button"
                      onClick={() => openPreparedTarget(selectedPrepared)}
                      className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-primary-400/30 bg-primary-500/15 px-3 py-2 text-xs font-semibold text-primary-100"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open {selectedPrepared.target.label}
                    </button>
                  )}
                </div>
              ) : null}

              {canAdvanceQueue && queueActionLabel ? (
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  fullWidth
                  className="min-h-11 border-t border-hairline"
                  rightIcon={<ArrowRight className="h-4 w-4" aria-hidden="true" />}
                  onClick={onQueueAdvance}
                >
                  {queueActionLabel}
                </Button>
              ) : null}
            </m.div>
          )}
        </AnimatePresence>
      </div>
    </Modal>
  );
};
