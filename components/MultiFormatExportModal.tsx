import React, { useEffect, useState } from "react";
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
import { triggerHapticFeedback } from "../utils/haptics";
import { logEvent } from "../utils/telemetry";

interface MultiFormatExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceImageUrl: string;
}

export const MultiFormatExportModal: React.FC<MultiFormatExportModalProps> = ({
  isOpen,
  onClose,
  sourceImageUrl,
}) => {
  const [rendered, setRendered] = useState<Record<ExportFormatId, string> | null>(
    null
  );
  const [renderError, setRenderError] = useState<string | null>(null);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const [individuallyDownloaded, setIndividuallyDownloaded] = useState<
    Set<ExportFormatId>
  >(new Set());

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
      title="Export for every platform"
      description="Same post, four sizes. Download all at once or pick what you need."
      size="xl"
    >
      <div className="space-y-5">
        {renderError && (
          <div className="rounded-xl border border-error-700/50 bg-error-900/40 px-4 py-3 text-error-100 text-sm">
            {renderError}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {EXPORT_FORMATS.map((fmt) => {
            const preview = rendered?.[fmt.id];
            const downloaded = individuallyDownloaded.has(fmt.id);
            return (
              <motion.div
                key={fmt.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col rounded-2xl border border-white/10 bg-white/5 overflow-hidden"
              >
                <div className="aspect-[4/3] bg-black flex items-center justify-center overflow-hidden relative">
                  {preview ? (
                    <img
                      src={preview}
                      alt={fmt.label}
                      className="max-w-full max-h-full object-contain"
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
            onClick={handleDownloadAll}
            disabled={!rendered || isDownloadingAll}
          >
            {isDownloadingAll ? "Downloading…" : "Download all 4 formats"}
          </Button>
          <Button variant="ghost" size="md" onClick={onClose}>
            Done
          </Button>
        </div>

        <p className="text-[11px] text-surface-500 leading-relaxed">
          Tip: your browser may ask to allow multiple downloads — click "Allow"
          once and all four files save to your Downloads folder.
        </p>
      </div>
    </Modal>
  );
};
