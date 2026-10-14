import React, { useEffect, useState } from "react";
import { m, AnimatePresence } from "framer-motion";
import { Loader2, Check, RefreshCw, Sparkles } from "lucide-react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { triggerHapticFeedback } from "../utils/haptics";
import { cn } from "../utils/classNames";
import { toUiMessage } from "../utils/errorMessages";

interface CaptionAlternativesModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Returns a single fresh, fully-prepared caption (brand kit +
   * delivery-language gating + disclosures already applied) — the modal
   * calls this N times in parallel and must use each result as-is. It
   * intentionally does NOT re-run prepareCaptionForDelivery itself: a second
   * pass here has no scenario/brandKit context of its own, so it would drop
   * the delivery-language gate and re-apply the dealer's brand kit blind.
   */
  generateOne: () => Promise<{
    caption: string;
    disclosures: string;
    disclosureCategories: string[];
  }>;
  /** Caption + (separately) disclosures get merged before being passed back to host. */
  onSelect: (next: {
    text: string;
    disclosures: string;
    disclosureCategories: string[];
  }) => void;
  /** How many alternatives to fetch. Default 3. */
  count?: number;
}

interface Variant {
  id: number;
  text: string;
  loading: boolean;
  error?: string;
  disclosures?: string;
  disclosureCategories?: string[];
}

/**
 * Three-at-a-time caption picker. Fires N parallel generation calls and
 * surfaces each as a card. User picks one → host replaces its editable
 * caption. The disclosure footer is split per-variant (each generation may
 * trigger different compliance language) and travels with the selection.
 */
export const CaptionAlternativesModal: React.FC<CaptionAlternativesModalProps> = ({
  isOpen,
  onClose,
  generateOne,
  onSelect,
  count = 3,
}) => {
  const [variants, setVariants] = useState<Variant[]>([]);
  const [picked, setPicked] = useState<number | null>(null);

  // The 3 parallel generations resolve independently, so the announcement is
  // keyed off an any-loading boolean: the live-region text stays constant
  // while work is in flight and changes exactly once at completion.
  const anyLoading = variants.some((v) => v.loading);
  const failedCount = variants.filter((v) => v.error).length;

  const runOne = async (id: number): Promise<Variant> => {
    try {
      const prepared = await generateOne();
      return {
        id,
        text: prepared.caption,
        loading: false,
        disclosures: prepared.disclosures,
        disclosureCategories: prepared.disclosureCategories,
      };
    } catch (err) {
      return {
        id,
        text: "",
        loading: false,
        error: toUiMessage(err, "Could not generate this caption."),
      };
    }
  };

  const runAll = async () => {
    const initial: Variant[] = Array.from({ length: count }, (_, i) => ({
      id: i,
      text: "",
      loading: true,
    }));
    setVariants(initial);
    // Fire all in parallel, swap each into state as it resolves.
    initial.forEach((v) => {
      runOne(v.id).then((finished) => {
        setVariants((prev) => prev.map((p) => (p.id === v.id ? finished : p)));
      });
    });
  };

  // Kick off when the modal opens
  useEffect(() => {
    if (!isOpen) {
      setVariants([]);
      setPicked(null);
      return;
    }
    let cancelled = false;
    const initial: Variant[] = Array.from({ length: count }, (_, i) => ({
      id: i,
      text: "",
      loading: true,
    }));
    setVariants(initial);
    initial.forEach((v) => {
      runOne(v.id).then((finished) => {
        if (!cancelled) {
          setVariants((prev) => prev.map((p) => (p.id === v.id ? finished : p)));
        }
      });
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const handlePick = (v: Variant) => {
    if (v.loading || v.error) return;
    triggerHapticFeedback();
    setPicked(v.id);
    onSelect({
      text: v.text,
      disclosures: v.disclosures || "",
      disclosureCategories: v.disclosureCategories || [],
    });
    window.setTimeout(() => onClose(), 800);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="3 caption alternatives"
      description="Three fresh takes from the same image + brief. Pick the one that lands."
      size="xl"
    >
      <div className="space-y-3">
        <div className="sr-only" role="status" aria-live="polite">
          {variants.length === 0
            ? ""
            : anyLoading
              ? "Generating caption alternatives…"
              : failedCount > 0
                ? `${variants.length - failedCount} of ${variants.length} caption alternatives ready, ${failedCount} failed.`
                : `${variants.length} caption alternatives ready.`}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {variants.map((v) => {
            const isPicked = picked === v.id;
            return (
              <m.button
                key={v.id}
                type="button"
                onClick={() => handlePick(v)}
                disabled={v.loading || !!v.error || picked !== null}
                whileHover={!v.loading && !v.error ? { scale: 1.01 } : undefined}
                whileTap={!v.loading && !v.error ? { scale: 0.99 } : undefined}
                className={cn(
                  "relative flex flex-col text-left rounded-xl border p-3 transition-colors min-h-[220px]",
                  isPicked
                    ? "border-success-500/50 bg-success-500/10"
                    : v.error
                      ? "border-error-500/40 bg-error-500/5"
                      : v.loading
                        ? "border-hairline bg-fill-subtle"
                        : "border-hairline bg-fill-subtle hover:border-primary-400/50 hover:bg-fill-hover",
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[10px] uppercase tracking-wide text-surface-400 font-semibold">
                    Variant {v.id + 1}
                  </div>
                  {isPicked && (
                    <div className="text-success-300">
                      <Check className="w-4 h-4" />
                    </div>
                  )}
                  {v.loading && (
                    <Loader2 className="w-4 h-4 text-surface-400 animate-spin" />
                  )}
                </div>
                {v.error ? (
                  <div className="flex-1 flex items-center justify-center text-xs text-error-300 in-[.theme-light]:text-error-800">
                    Failed: {v.error}
                  </div>
                ) : v.loading ? (
                  <div className="flex-1 flex items-center justify-center text-xs text-surface-400">
                    Generating…
                  </div>
                ) : (
                  <div className="flex-1 text-sm text-surface-100 leading-relaxed whitespace-pre-line">
                    {v.text}
                  </div>
                )}
                {v.disclosures && (
                  <div className="mt-2 text-[10px] text-warning-300/80 truncate">
                    + compliance footer ({v.disclosureCategories?.join(", ") || "auto"})
                  </div>
                )}
              </m.button>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-hairline">
          <div className="text-[11px] text-surface-400 flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            Tap any variant to use it. Compliance disclosures stay attached.
          </div>
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
            onClick={() => void runAll()}
            disabled={variants.some((v) => v.loading) || picked !== null}
          >
            Regenerate all
          </Button>
        </div>
      </div>
    </Modal>
  );
};
