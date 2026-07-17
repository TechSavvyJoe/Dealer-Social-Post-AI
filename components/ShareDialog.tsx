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
  ExternalLink,
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
  isMobileShareDevice,
  openNativeAppOrWeb,
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

const META_APP_IDS = new Set(["facebook_feed", "marketplace"]);

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
}) => {
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<{
    targetId: string;
    status: PublishStatus;
  } | null>(null);
  const onPhone = React.useMemo(() => isMobileShareDevice(), []);

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

  const openFacebookApp = useCallback(() => {
    triggerHapticFeedback();
    openNativeAppOrWeb("fb://feed", null);
  }, []);

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
    const isActive = status?.targetId === target.id;
    const ok =
      isActive &&
      (status?.status.kind === "shared" || status?.status.kind === "fallback");

    const shortHint =
      target.id === "facebook_feed"
        ? onPhone
          ? "Use Facebook app · paste caption · add from Photos"
          : "Caption copied · open Facebook · paste"
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
            {target.handoff === "photos-then-app" ||
            target.handoff === "clipboard-open"
              ? "App"
              : target.handoff === "share-file"
                ? "Share"
                : "Share"}
          </span>
        </div>
        <div>
          <div className="text-base font-semibold text-surface-50">
            {target.label}
          </div>
          <div className="mt-0.5 text-xs text-surface-400">{shortHint}</div>
        </div>
      </button>
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Share"
      description="Post from the Facebook / Instagram / TikTok apps you already use — not a slow website login."
      size="lg"
    >
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-xs leading-relaxed text-surface-300">
          <ClipboardPaste className="mt-0.5 h-4 w-4 shrink-0 text-primary-300" />
          <div className="space-y-1">
            <p>
              <strong className="text-surface-100">Caption is copied</strong> for
              Paste in the app. We cannot auto-fill Facebook or Instagram (phone
              security).
            </p>
            <p>
              <strong className="text-surface-100">Use the app icons</strong>{" "}
              (Facebook, Instagram, TikTok) you already log into. Website tabs
              may ask you to log in again and feel slow — that is Safari/Chrome,
              not your Facebook app session.
            </p>
          </div>
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
          {(msg || showMetaChecklist) && status && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={cn(
                "rounded-xl border px-3 py-2.5 text-xs leading-relaxed space-y-2",
                status.status.kind === "error"
                  ? "border-error-500/40 bg-error-500/10 text-error-100"
                  : status.status.kind === "cancelled"
                    ? "border-surface-600 bg-surface-900/60 text-surface-300"
                    : "border-success-500/40 bg-success-500/10 text-success-100",
              )}
              role="status"
            >
              <div className="flex items-start gap-2">
                {status.status.kind === "error" ? (
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <Check className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <span>{msg}</span>
              </div>

              {showMetaChecklist && (
                <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-surface-100">
                  <p className="mb-1.5 font-semibold text-surface-50">
                    Finish in the Facebook app
                  </p>
                  <ol className="list-decimal space-y-1 pl-4 text-[11px] text-surface-300">
                    <li>Caption is already on your clipboard</li>
                    <li>
                      Save/share the photo into Photos if the sheet offered it
                    </li>
                    <li>
                      Open the <strong className="text-surface-100">Facebook app</strong>{" "}
                      (blue icon) — not a browser tab
                    </li>
                    <li>New post → long-press → Paste</li>
                    <li>Add photo from your library</li>
                  </ol>
                  {onPhone && (
                    <button
                      type="button"
                      onClick={openFacebookApp}
                      className="mt-2 inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#1877F2]/50 bg-[#1877F2]/20 px-3 py-2 text-xs font-semibold text-white"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open Facebook app
                    </button>
                  )}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Modal>
  );
};
