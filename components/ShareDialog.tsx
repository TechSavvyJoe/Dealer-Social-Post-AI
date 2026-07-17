import React, { useCallback, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Globe,
  Music,
  Share2,
  Loader2,
  Check,
  AlertCircle,
  Sparkles,
} from "lucide-react";

// lucide-react v1 doesn't ship brand-name icons (trademark policy). Inline
// minimal SVG glyphs in solid white so each tile still reads as the right
// platform without depending on third-party icon sets.
const FacebookGlyph: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M13.5 21v-7.5h2.5l.5-3h-3v-2c0-.9.3-1.5 1.5-1.5H17V4.2c-.7-.1-1.5-.2-2.4-.2-2.4 0-4.1 1.5-4.1 4.1V10.5H8v3h2.5V21h3z" />
  </svg>
);
const InstagramGlyph: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
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
import {
  orderPublishTargets,
  publishTo,
  PublishStatus,
  PublishContent,
  PublishTarget,
} from "../services/publishTargets";
import { fitCaptionToBudget } from "../utils/hashtags";
import { triggerHapticFeedback } from "../utils/haptics";
import { logEvent } from "../utils/telemetry";
import { cn } from "../utils/classNames";
import { useAppStore } from "../stores/appStore";

interface ShareDialogProps {
  isOpen: boolean;
  onClose: () => void;
  content: PublishContent;
  /**
   * Optional per-platform captions keyed by publish target id. When present,
   * each share tile uses its matching caption (still falls back to content.text).
   */
  platformCaptions?: Record<string, string>;
  /** Platforms selected at generate time — shown first with a “selected” badge. */
  selectedPlatformIds?: string[];
}

/** Append optional @handle / profile hints for dealers that configured socials. */
const hintWithDealerHandle = (
  target: PublishTarget,
  handles: {
    instagram?: string;
    facebook?: string;
    tiktok?: string;
    gbp?: string;
  },
): string => {
  if (target.id.startsWith("instagram") && handles.instagram) {
    return `${target.hint} · @${handles.instagram.replace(/^@/, "")}`;
  }
  if (target.id === "facebook_feed" && handles.facebook) {
    return `${target.hint} · ${handles.facebook.replace(/^https?:\/\//, "")}`;
  }
  if (target.id === "tiktok" && handles.tiktok) {
    return `${target.hint} · @${handles.tiktok.replace(/^@/, "")}`;
  }
  if (target.id === "gbp" && handles.gbp) {
    return `${target.hint} · profile linked`;
  }
  return target.hint;
};

const ICON_MAP: Record<PublishTarget["icon"], React.ComponentType<{ className?: string }>> = {
  facebook: FacebookGlyph,
  instagram: InstagramGlyph,
  music: Music,
  globe: Globe,
  twitter: XGlyph,
  linkedin: LinkedinGlyph,
  share2: Share2,
};

/**
 * Per-platform share dialog. Each tile pre-formats the caption + image for
 * its destination, copies text to clipboard, and triggers the native share
 * sheet with the rendered file — so the user lands inside the target app
 * with the post almost done.
 *
 * Direct API publishing is stubbed on every target today; when Joe wires up
 * the Meta Business API / TikTok Content Posting / GBP API, only the
 * `publishTo()` dispatcher swaps — this dialog stays the same.
 */
export const ShareDialog: React.FC<ShareDialogProps> = ({
  isOpen,
  onClose,
  content,
  platformCaptions,
  selectedPlatformIds,
}) => {
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<{
    targetId: string;
    status: PublishStatus;
  } | null>(null);
  const dealer = useAppStore((s) => s.currentDealer);
  const handles = React.useMemo(
    () => ({
      instagram: dealer?.instagram_handle,
      facebook: dealer?.facebook_url,
      tiktok: dealer?.tiktok_handle,
      gbp: dealer?.gbp_url,
    }),
    [dealer],
  );

  const selectedSet = React.useMemo(
    () => new Set((selectedPlatformIds || []).filter(Boolean)),
    [selectedPlatformIds],
  );
  const orderedTargets = React.useMemo(
    () => orderPublishTargets(selectedPlatformIds),
    [selectedPlatformIds],
  );

  const captionForTarget = useCallback(
    (targetId: string, budget: number): string => {
      const packCaption = platformCaptions?.[targetId]?.trim();
      return fitCaptionToBudget(packCaption || content.text, budget);
    },
    [content.text, platformCaptions],
  );

  const handlePick = useCallback(
    async (target: PublishTarget) => {
      if (busy) return;
      triggerHapticFeedback();
      setBusy(target.id);
      setStatus(null);
      try {
        const targetContent: PublishContent = {
          ...content,
          text: captionForTarget(target.id, target.charBudget),
        };
        const result = await publishTo(target.id, targetContent);
        setStatus({ targetId: target.id, status: result });
        logEvent("share.attempt", {
          target: target.id,
          kind: result.kind,
          via:
            result.kind === "shared" || result.kind === "fallback"
              ? (result as any).via
              : undefined,
          usedPackCaption: Boolean(platformCaptions?.[target.id]),
        });
        if (result.kind === "shared") {
          // Brief success display, then close
          window.setTimeout(() => onClose(), 1500);
        }
      } finally {
        setBusy(null);
      }
    },
    [busy, captionForTarget, content, onClose, platformCaptions]
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Share post"
      description="Instagram, Facebook, and TikTok first. Caption is fitted and copied; image is sized for each platform."
      size="lg"
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {orderedTargets.map((target) => {
            const Icon = ICON_MAP[target.icon];
            const isBusy = busy === target.id;
            const isDone =
              status?.targetId === target.id && status.status.kind === "shared";
            const isFallback =
              status?.targetId === target.id &&
              status.status.kind === "fallback";
            const isError =
              status?.targetId === target.id && status.status.kind === "error";
            const isSelected = selectedSet.has(target.id);

            // Prefer pack caption; fit to budget for the meter.
            const targetCaption = captionForTarget(
              target.id,
              target.charBudget,
            );
            const captionLen = targetCaption.length;
            const overBudget = captionLen > target.charBudget;
            const hasPackCaption = Boolean(platformCaptions?.[target.id]);

            return (
              <motion.button
                key={target.id}
                type="button"
                onClick={() => handlePick(target)}
                disabled={!!busy}
                whileHover={{ scale: busy ? 1 : 1.02 }}
                whileTap={{ scale: 0.98 }}
                className={cn(
                  "relative flex flex-col items-start gap-2 p-3 rounded-xl border text-left transition-colors overflow-hidden",
                  isSelected
                    ? "bg-primary-500/10 border-primary-400/40 hover:bg-primary-500/15"
                    : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20",
                  "disabled:opacity-60 disabled:cursor-not-allowed"
                )}
                style={{
                  boxShadow: isDone
                    ? `0 0 24px ${target.accent}30`
                    : undefined,
                }}
              >
                <div
                  className="absolute inset-0 opacity-0 hover:opacity-10 pointer-events-none transition-opacity"
                  style={{ background: target.accent }}
                />
                <div className="flex items-center justify-between w-full">
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center text-white"
                    style={{ background: target.accent }}
                  >
                    {isBusy ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : isDone ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <Icon className="w-4 h-4" />
                    )}
                  </div>
                  {isSelected ? (
                    <span className="text-[9px] uppercase tracking-wide text-primary-200 font-semibold">
                      selected
                    </span>
                  ) : target.directApiConnected ? (
                    <span className="text-[9px] uppercase tracking-wide text-success-300 font-semibold inline-flex items-center gap-1">
                      <Sparkles className="w-2.5 h-2.5" /> direct
                    </span>
                  ) : (
                    <span className="text-[9px] uppercase tracking-wide text-surface-500">
                      via share
                    </span>
                  )}
                </div>
                <div className="space-y-0.5 w-full">
                  <div className="text-sm font-semibold text-surface-50">
                    {target.label}
                  </div>
                  <div className="text-[10px] text-surface-400 leading-tight">
                    {hintWithDealerHandle(target, handles)}
                  </div>
                </div>
                <div
                  className={cn(
                    "text-[10px] font-mono tabular-nums",
                    overBudget ? "text-error-300" : "text-surface-500"
                  )}
                >
                  {captionLen}/{target.charBudget}
                  {overBudget && " · over"}
                  {hasPackCaption && !overBudget ? " · tailored" : ""}
                </div>
                {(isFallback || isError) && (
                  <div
                    className={cn(
                      "text-[10px] mt-1 leading-snug",
                      isError ? "text-error-300" : "text-warning-200"
                    )}
                  >
                    {status?.status.kind === "fallback" && status.status.message}
                    {status?.status.kind === "error" && status.status.message}
                  </div>
                )}
              </motion.button>
            );
          })}
        </div>

        <AnimatePresence>
          {status?.status.kind === "shared" && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="rounded-xl border border-success-500/40 bg-success-500/10 text-success-100 px-3 py-2 text-xs flex items-center gap-2"
            >
              <Check className="w-4 h-4" />
              Opened the share sheet — finish posting in the target app.
            </motion.div>
          )}
          {status?.status.kind === "cancelled" && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="rounded-xl border border-surface-700 bg-surface-900/60 text-surface-300 px-3 py-2 text-xs flex items-center gap-2"
            >
              <AlertCircle className="w-4 h-4" />
              Share cancelled. Caption is still on your clipboard if you want
              to paste it manually.
            </motion.div>
          )}
        </AnimatePresence>

        <div className="pt-2 border-t border-white/10 text-[11px] text-surface-500 leading-relaxed">
          <strong className="text-surface-300">Today:</strong> each platform
          opens your device's share sheet with the image (or video) attached
          and the caption on your clipboard.{" "}
          <strong className="text-surface-300">Coming later:</strong> direct
          one-tap publishing once Meta App Review, TikTok Content Posting, and
          Google Business Profile API connections are wired in.
        </div>
      </div>
    </Modal>
  );
};
