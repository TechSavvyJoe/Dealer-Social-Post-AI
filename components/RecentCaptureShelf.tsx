import React, { useCallback, useEffect, useState } from "react";
import { Archive, Loader2, RotateCcw, Trash2 } from "lucide-react";
import {
  MEDIA_ARCHIVE_CHANGED_EVENT,
  archivedMediaToDataUrl,
  deleteArchivedMedia,
  listDealerMedia,
  type ArchivedMediaRecord,
} from "../utils/creativeStorage";
import { triggerHapticFeedback } from "../utils/haptics";
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
      className="mt-5 rounded-2xl border border-hairline bg-surface-900/65 p-4 shadow-xl shadow-black/15 sm:p-5"
      aria-labelledby="recovery-shelf-heading"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-primary-200">
            <Archive className="h-4 w-4" aria-hidden="true" />
            <h2
              id="recovery-shelf-heading"
              className="text-sm font-semibold text-surface-50"
            >
              Recent originals
            </h2>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-surface-400">
            Private rescue copies on this device for up to 48 hours. They clear sooner
            when you log out.
          </p>
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-success-300">
          Backed up in app
        </span>
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
                className="relative block h-24 w-28 overflow-hidden rounded-xl border border-strong bg-surface-950 text-left transition-colors hover:border-primary-400/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
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
                <span className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/90 to-transparent px-2 pb-1.5 pt-6 text-[10px] font-semibold text-white">
                  {isOpening ? (
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  ) : (
                    <RotateCcw className="h-3 w-3" aria-hidden="true" />
                  )}
                  {isOpening ? "Opening" : "Reuse"}
                </span>
              </button>
              <button
                type="button"
                onClick={async () => {
                  triggerHapticFeedback();
                  await deleteArchivedMedia(record.id);
                }}
                className="absolute right-1.5 top-1.5 grid h-8 w-8 place-items-center rounded-full border border-strong bg-black/75 text-surface-100 shadow-md transition-colors hover:border-error-300/60 hover:bg-error-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error-300"
                aria-label={`Delete original photo ${index + 1}`}
                title="Delete recovery copy"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <p className="mt-1 truncate text-[10px] text-surface-500">
                {formatCaptureTime(record.createdAt)}
              </p>
            </article>
          );
        })}
      </div>
    </section>
  );
};
