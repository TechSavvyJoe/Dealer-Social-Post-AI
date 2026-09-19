import React, { useCallback, useEffect, useState } from "react";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";
import {
  MEDIA_ARCHIVE_CHANGED_EVENT,
  archivedMediaToDataUrl,
  deleteArchivedMedia,
  listDealerMedia,
  type ArchivedMediaRecord,
} from "../utils/creativeStorage";
import { triggerHapticFeedback } from "../utils/haptics";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import type { ImageSelection } from "../types";

interface RecentCaptureShelfProps {
  dealerId: string;
  onSelect: (selection: ImageSelection) => void;
}

const formatCaptureTime = (createdAt: number) =>
  new Date(createdAt).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/**
 * Short-lived, private recovery shelf for originals captured in this browser.
 * The preview is normalized for display, while Save still receives the
 * untouched original Blob. Durable customer/post history remains server-side.
 */
export const RecentCaptureShelf: React.FC<RecentCaptureShelfProps> = ({
  dealerId,
  onSelect,
}) => {
  const [records, setRecords] = useState<ArchivedMediaRecord[]>([]);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRecords(
      await listDealerMedia(dealerId, {
        kinds: ["capture"],
        limit: 8,
      }),
    );
  }, [dealerId]);

  useEffect(() => {
    void load();
    const handleChange = (event: Event) => {
      const changedDealer = (event as CustomEvent<{ dealerId?: string }>).detail
        ?.dealerId;
      if (!changedDealer || changedDealer === dealerId) void load();
    };
    window.addEventListener(MEDIA_ARCHIVE_CHANGED_EVENT, handleChange);
    return () => window.removeEventListener(MEDIA_ARCHIVE_CHANGED_EVENT, handleChange);
  }, [dealerId, load]);

  const [previewUrls, setPreviewUrls] = useState<
    Array<{ record: ArchivedMediaRecord; url: string }>
  >([]);

  useEffect(() => {
    // Object URL creation belongs in an effect, not render. React StrictMode
    // can discard a render before registering its cleanup, which would leak
    // every URL created by useMemo during that discarded render.
    const next = records.map((record) => ({
      record,
      url: URL.createObjectURL(record.previewBlob || record.blob),
    }));
    setPreviewUrls(next);
    return () => {
      next.forEach(({ url }) => URL.revokeObjectURL(url));
    };
  }, [records]);

  if (records.length === 0) return null;

  return (
    <section
      className="mt-6 border-t border-hairline pt-5"
      aria-labelledby="recovery-shelf-heading"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="recovery-shelf-heading" className="text-lg font-semibold text-ink">
            Recent originals
          </h2>
          <p className="mt-1 text-caption text-ink-2">
            Private rescue copies on this device for up to 48 hours. They clear sooner
            when you log out.
          </p>
        </div>
        <Badge variant="success" uppercase={false}>
          Backed up
        </Badge>
      </div>

      <div className="mt-3 flex gap-3 overflow-x-auto pb-1" role="list">
        {previewUrls.map(({ record, url }, index) => {
          const isOpening = openingId === record.id;
          return (
            <article
              key={record.id}
              className="group relative w-28 shrink-0"
              role="listitem"
            >
              <button
                type="button"
                onClick={async () => {
                  triggerHapticFeedback();
                  setOpeningId(record.id);
                  try {
                    onSelect({
                      workingImage: await archivedMediaToDataUrl(record),
                      originalSource: record.blob,
                      originalFilename: record.originalFilename,
                    });
                  } finally {
                    setOpeningId(null);
                  }
                }}
                disabled={Boolean(openingId)}
                className="print relative block h-24 w-28 overflow-hidden rounded-sm bg-panel-raised text-left transition-colors hover:border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
                aria-label={`Reuse original photo ${index + 1} from ${formatCaptureTime(
                  record.createdAt,
                )}`}
              >
                <img
                  src={url}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
                <span className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-overlay/80 px-2 pb-1.5 pt-2 text-2xs font-semibold text-ink">
                  {isOpening ? (
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  ) : (
                    <RotateCcw className="h-3 w-3" aria-hidden="true" />
                  )}
                  {isOpening ? "Opening" : "Reuse"}
                </span>
              </button>
              <Button
                type="button"
                onClick={async () => {
                  triggerHapticFeedback();
                  await deleteArchivedMedia(record.id);
                }}
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1 bg-overlay/80"
                aria-label={`Delete original photo ${index + 1}`}
                title="Delete recovery copy"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
              <p className="mt-1 truncate text-2xs text-ink-2">
                {formatCaptureTime(record.createdAt)}
              </p>
            </article>
          );
        })}
      </div>
    </section>
  );
};
