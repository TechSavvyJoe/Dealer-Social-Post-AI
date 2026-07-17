import React, { useCallback, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Globe,
  Music,
  Share2,
  Loader2,
  Check,
  AlertCircle,
  ClipboardPaste,
} from "lucide-react";

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
  CORE_PUBLISH_IDS,
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
  platformCaptions?: Record<string, string>;
  selectedPlatformIds?: string[];
}

const ICON_MAP: Record<PublishTarget["icon"], React.ComponentType<{ className?: string }>> = {
  facebook: FacebookGlyph,
  instagram: InstagramGlyph,
  music: Music,
  globe: Globe,
  twitter: XGlyph,
  linkedin: LinkedinGlyph,
  share2: Share2,
};

const CORE_SET = new Set<string>(CORE_PUBLISH_IDS);

/** Simple, salesperson-first share sheet. */
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

  const orderedTargets = React.useMemo(
    () => orderPublishTargets(selectedPlatformIds),
    [selectedPlatformIds],
  );
  const coreTargets = React.useMemo(
    () => orderedTargets.filter((t) => CORE_SET.has(t.id)),
    [orderedTargets],
  );
  const moreTargets = React.useMemo(
    () => orderedTargets.filter((t) => !CORE_SET.has(t.id)),
    [orderedTargets],
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
        const result = await publishTo(target.id, {
          ...content,
          text: captionForTarget(target.id, target.charBudget),
        });
        setStatus({ targetId: target.id, status: result });
        logEvent("share.attempt", {
          target: target.id,
          kind: result.kind,
          handoff: target.handoff,
        });
      } finally {
        setBusy(null);
      }
    },
    [busy, captionForTarget, content],
  );

  const msg = (() => {
    const s = status?.status;
    if (!s) return null;
    if (s.kind === "error") return s.message;
    if (s.kind === "cancelled") {
      return "Cancelled. Caption is still copied — paste when you are ready.";
    }
    if (s.kind === "shared" || s.kind === "fallback") {
      return (
        s.message ||
        "Caption copied. In the app: create post → long-press → Paste → add the photo."
      );
    }
    return null;
  })();

  const tile = (target: PublishTarget) => {
    const Icon = ICON_MAP[target.icon];
    const isBusy = busy === target.id;
    const isActive = status?.targetId === target.id;
    const ok =
      isActive &&
      (status?.status.kind === "shared" || status?.status.kind === "fallback");

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
            : "border-white/10 bg-white/5 hover:bg-white/10",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/70",
        )}
        aria-label={`Share to ${target.label}`}
      >
        <div className="flex w-full items-center justify-between gap-2">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-xl text-white"
            style={{ background: target.accent }}
          >
            {isBusy ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : ok ? (
              <Check className="h-5 w-5" />
            ) : (
              <Icon className="h-5 w-5" />
            )}
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-surface-400">
            {target.handoff === "clipboard-open" ? "Open app" : "Share"}
          </span>
        </div>
        <div>
          <div className="text-base font-semibold text-surface-50">
            {target.label}
          </div>
          <div className="mt-0.5 text-xs text-surface-400">
            {target.id === "facebook_feed"
              ? "Copies caption · opens Facebook · paste there"
              : target.id.startsWith("instagram")
                ? "Sends photo · paste caption in Instagram"
                : target.id === "tiktok"
                  ? "Sends media · paste caption in TikTok"
                  : target.hint}
          </div>
        </div>
      </button>
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Share"
      description="1) Tap a network  2) Paste caption in the app  3) Add the photo"
      size="lg"
    >
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-xs text-surface-300">
          <ClipboardPaste className="mt-0.5 h-4 w-4 shrink-0 text-primary-300" />
          <p>
            <strong className="text-surface-100">Caption is copied for you.</strong>{" "}
            Apps like Facebook and Instagram never auto-fill text from a browser —
            long-press the post box and choose <strong className="text-surface-100">Paste</strong>.
            On iPhone, Facebook usually will not appear in the system share list —
            use the Facebook button here instead.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {coreTargets.map(tile)}
        </div>

        {moreTargets.length > 0 && (
          <details className="group rounded-xl border border-white/10 bg-surface-950/40">
            <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-semibold text-surface-200 marker:content-none [&::-webkit-details-marker]:hidden">
              More options
              <span className="ml-2 text-xs font-normal text-surface-500 group-open:hidden">
                (Google, Marketplace, …)
              </span>
            </summary>
            <div className="grid grid-cols-2 gap-2 border-t border-white/5 p-3 sm:grid-cols-3">
              {moreTargets.map(tile)}
            </div>
          </details>
        )}

        <AnimatePresence>
          {msg && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={cn(
                "flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs leading-relaxed",
                status?.status.kind === "error"
                  ? "border-error-500/40 bg-error-500/10 text-error-100"
                  : "border-success-500/40 bg-success-500/10 text-success-100",
              )}
              role="status"
            >
              {status?.status.kind === "error" ? (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <Check className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <span>{msg}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Modal>
  );
};
