import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Download, Loader2, Check, Image as ImageIcon } from "lucide-react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import {
  EXPORT_FORMATS,
  ExportFormatId,
  downloadAllFormats,
  renderAllFormats,
} from "../utils/multiFormatExport";
import { orderExportFormatsByPreference } from "../services/platformCopy";
import { triggerHapticFeedback } from "../utils/haptics";
import { logEvent } from "../utils/telemetry";

interface MultiFormatExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceImageUrl: string;
  /**
   * Preferred export format order from selected "Share to" platforms.
   * Formats not listed still appear after the preferred ones.
   */
  priorityFormatIds?: ExportFormatId[];
}

export const MultiFormatExportModal: React.FC<MultiFormatExportModalProps> = ({
  isOpen,
  onClose,
  sourceImageUrl,
  priorityFormatIds,
}) => {
  const [rendered, setRendered] = useState<Record<ExportFormatId, string> | null>(
    null,
  );
  const [renderError, setRenderError] = useState<string | null>(null);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const [individuallyDownloaded, setIndividuallyDownloaded] = useState<
    Set<ExportFormatId>
  >(new Set());

  const orderedFormats = useMemo(
    () =>
      orderExportFormatsByPreference(EXPORT_FORMATS, priorityFormatIds ?? []),
    [priorityFormatIds],
  );

  // Render previews when the modal opens.
  useEffect(() => {
    if (!isOpen) {
      setRendered(null);
      setRenderError(null);
      setIndividuallyDownloaded(new Set());
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const all = await renderAllFormats(sourceImageUrl);
        if (!cancelled) setRendered(all);
      } catch (err) {
        if (!cancelled) {
          setRenderError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, sourceImageUrl]);

  const handleDownloadOne = (id: ExportFormatId) => {
    if (!rendered) return;
    const fmt = EXPORT_FORMATS.find((f) => f.id === id);
    if (!fmt) return;
    triggerHapticFeedback();
    const link = document.createElement("a");
    link.href = rendered[id];
    link.download = fmt.filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setIndividuallyDownloaded((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    logEvent("export.multiformat.single", { format: id });
  };

  const matchedIds = useMemo(() => {
    if (priorityFormatIds && priorityFormatIds.length > 0) {
      return priorityFormatIds;
    }
    return EXPORT_FORMATS.map((f) => f.id);
  }, [priorityFormatIds]);

  const handleDownloadMatched = async () => {
    if (isDownloadingAll) return;
    triggerHapticFeedback();
    setIsDownloadingAll(true);
    try {
      await downloadAllFormats(sourceImageUrl, matchedIds);
      setIndividuallyDownloaded((prev) => {
        const next = new Set(prev);
        matchedIds.forEach((id) => next.add(id));
        return next;
      });
      logEvent("export.multiformat.matched", { count: matchedIds.length });
    } catch (err) {
      setRenderError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDownloadingAll(false);
    }
  };

  const handleDownloadAll = async () => {
    if (isDownloadingAll) return;
    triggerHapticFeedback();
    setIsDownloadingAll(true);
    try {
      await downloadAllFormats(sourceImageUrl);
      setIndividuallyDownloaded(new Set(EXPORT_FORMATS.map((f) => f.id)));
      logEvent("export.multiformat.all");
    } catch (err) {
      setRenderError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDownloadingAll(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Export for your platforms"
      description={
        priorityFormatIds && priorityFormatIds.length > 0
          ? "Sizes matched to your Share-to selection are listed first. Download matched or all four."
          : "Same post, four sizes for Instagram, Facebook, TikTok, Marketplace, and Google."
      }
      size="xl"
    >
      <div className="space-y-5">
        {renderError && (
          <div className="rounded-xl border border-error-700/50 bg-error-900/40 px-4 py-3 text-error-100 text-sm">
            {renderError}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {orderedFormats.map((fmt) => {
            const preview = rendered?.[fmt.id];
            const downloaded = individuallyDownloaded.has(fmt.id);
            const isPreferred =
              !!priorityFormatIds?.length && priorityFormatIds.includes(fmt.id);
            return (
              <motion.div
                key={fmt.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={
                  isPreferred
                    ? "flex flex-col rounded-2xl border border-primary-400/30 bg-primary-500/5 overflow-hidden"
                    : "flex flex-col rounded-2xl border border-white/10 bg-white/5 overflow-hidden"
                }
              >
                {/* Preview uses the real export aspect so black side bars aren't
                    a UI artifact from forcing 9:16 into a 4:3 box. */}
                <div
                  className="w-full bg-surface-950 flex items-center justify-center overflow-hidden relative max-h-[280px]"
                  style={{
                    aspectRatio: `${fmt.width} / ${fmt.height}`,
                  }}
                >
                  {preview ? (
                    <img
                      src={preview}
                      alt={fmt.label}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-surface-400">
                      <Loader2 className="h-6 w-6 animate-spin" />
                      <span className="text-xs">Rendering {fmt.label}…</span>
                    </div>
                  )}
                </div>
                <div className="p-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-surface-50 flex items-center gap-2">
                      <ImageIcon className="h-3.5 w-3.5 text-primary-300" />
                      {fmt.label}
                      {isPreferred ? (
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-primary-300">
                          matched
                        </span>
                      ) : null}
                    </div>
                    <div className="text-[11px] text-surface-400 truncate">
                      {fmt.width}×{fmt.height} · {fmt.description}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={downloaded ? "outline" : "filled"}
                    leftIcon={
                      downloaded ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )
                    }
                    onClick={() => handleDownloadOne(fmt.id)}
                    disabled={!preview}
                  >
                    {downloaded ? "Saved" : "Save"}
                  </Button>
                </div>
              </motion.div>
            );
          })}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 pt-2 border-t border-white/10">
          <Button
            variant="filled"
            size="md"
            fullWidth
            leftIcon={
              isDownloadingAll ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )
            }
            onClick={handleDownloadMatched}
            disabled={!rendered || isDownloadingAll}
          >
            {isDownloadingAll
              ? "Downloading…"
              : `Download matched (${matchedIds.length})`}
          </Button>
          {matchedIds.length < EXPORT_FORMATS.length ? (
            <Button
              variant="outline"
              size="md"
              fullWidth
              onClick={handleDownloadAll}
              disabled={!rendered || isDownloadingAll}
            >
              All 4 sizes
            </Button>
          ) : null}
          <Button variant="ghost" size="md" onClick={onClose}>
            Done
          </Button>
        </div>

        <p className="text-[11px] text-surface-500 leading-relaxed">
          Tip: your browser may ask to allow multiple downloads — click "Allow"
          once and files save to your Downloads folder.
        </p>
      </div>
    </Modal>
  );
};
