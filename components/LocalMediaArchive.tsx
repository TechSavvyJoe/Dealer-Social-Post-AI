import React, { useCallback, useEffect, useState } from "react";
import { Download, Film, Image as ImageIcon, Loader2, Trash2 } from "lucide-react";
import {
  MEDIA_ARCHIVE_CHANGED_EVENT,
  deleteArchivedMedia,
  listDealerMedia,
  type ArchivedMediaRecord,
} from "../utils/creativeStorage";
import {
  savePreparedMediaToLibrary,
  saveResultToastMessage,
  type PreparedMediaSave,
} from "../utils/mediaSave";
import { triggerHapticFeedback } from "../utils/haptics";
import { useToast } from "./ui/Toast";

interface LocalMediaArchiveProps {
  dealerId: string;
}

const mediaFile = (record: ArchivedMediaRecord): PreparedMediaSave => {
  const kind = record.kind === "video" ? "video" : "image";
  const extension =
    kind === "video"
      ? "mp4"
      : record.mimeType === "image/png"
        ? "png"
        : record.mimeType === "image/webp"
          ? "webp"
          : "jpg";
  const filename = `dealer-social-${record.kind}-${new Date(record.createdAt)
    .toISOString()
    .replace(/[:.]/g, "-")}.${extension}`;
  return {
    kind,
    filename,
    file: new File([record.blob], filename, {
      type: record.mimeType || (kind === "video" ? "video/mp4" : "image/jpeg"),
    }),
  };
};

const when = (createdAt: number) =>
  new Date(createdAt).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/**
 * Device-local recovery for generated media. Blob URLs cannot survive a
 * refresh, so the actual Blob is stored in IndexedDB and a fresh preview URL
 * is created here. Records intentionally contain no customer names/captions.
 */
export const LocalMediaArchive: React.FC<LocalMediaArchiveProps> = ({ dealerId }) => {
  const toast = useToast();
  const [records, setRecords] = useState<ArchivedMediaRecord[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRecords(
      await listDealerMedia(dealerId, {
        kinds: ["generated-image", "video"],
        limit: 12,
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

  const [previews, setPreviews] = useState<
    Array<{ record: ArchivedMediaRecord; url: string }>
  >([]);

  useEffect(() => {
    // Creating URLs during render leaks the URL from React StrictMode's
    // intentionally discarded render. Effect cleanup now owns each URL set.
    const next = records.map((record) => ({
      record,
      url: URL.createObjectURL(record.previewBlob || record.blob),
    }));
    setPreviews(next);
    return () => {
      next.forEach(({ url }) => URL.revokeObjectURL(url));
    };
  }, [records]);

  if (records.length === 0) return null;

  return (
    <section
      className="space-y-3 rounded-2xl border border-hairline bg-surface-950/35 p-3 sm:p-4"
      aria-labelledby="local-media-heading"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3
            id="local-media-heading"
            className="flex items-center gap-2 text-sm font-semibold text-surface-50"
          >
            <Film className="h-4 w-4 text-primary-300" aria-hidden="true" />
            Recent media on this device
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-surface-400">
            Rescue copies for generated images and videos remain for up to 48 hours and
            clear sooner on logout.
          </p>
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-surface-500">
          Local only
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {previews.map(({ record, url }, index) => {
          const isVideo = record.kind === "video";
          const isBusy = busyId === record.id;
          return (
            <article
              key={record.id}
              className="min-w-0 overflow-hidden rounded-xl border border-hairline bg-surface-900/70"
            >
              <div className="relative aspect-square overflow-hidden bg-black">
                {isVideo ? (
                  <video
                    src={url}
                    controls
                    playsInline
                    preload="metadata"
                    className="h-full w-full object-contain"
                    aria-label={`Generated video ${index + 1}`}
                  />
                ) : (
                  <img
                    src={url}
                    alt={`Generated image ${index + 1}`}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                )}
                <span className="pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1 rounded-full border border-strong bg-black/70 px-2 py-1 text-[10px] font-semibold text-white">
                  {isVideo ? (
                    <Film className="h-3 w-3" aria-hidden="true" />
                  ) : (
                    <ImageIcon className="h-3 w-3" aria-hidden="true" />
                  )}
                  {isVideo ? "Video" : "Image"}
                </span>
              </div>
              <div className="space-y-2 p-2.5">
                <p className="truncate text-[10px] text-surface-400">
                  {when(record.createdAt)}
                </p>
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <button
                    type="button"
                    disabled={Boolean(busyId)}
                    onClick={async () => {
                      triggerHapticFeedback();
                      setBusyId(record.id);
                      try {
                        // The File is built synchronously before the first
                        // await, keeping navigator.share in this click.
                        const result = await savePreparedMediaToLibrary(
                          mediaFile(record),
                        );
                        if (result.method === "error") {
                          toast.error(saveResultToastMessage(result));
                        } else if (result.method === "cancelled") {
                          toast.warning(saveResultToastMessage(result));
                        } else {
                          toast.success(saveResultToastMessage(result));
                        }
                      } finally {
                        setBusyId(null);
                      }
                    }}
                    className="inline-flex min-h-10 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-success-400/25 bg-success-500/10 px-2 text-xs font-semibold text-success-100 transition-colors hover:bg-success-500/15 disabled:opacity-50 [.theme-light_&]:text-success-900"
                  >
                    {isBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                    Save
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(busyId)}
                    onClick={async () => {
                      triggerHapticFeedback();
                      setBusyId(record.id);
                      try {
                        await deleteArchivedMedia(record.id);
                      } finally {
                        setBusyId(null);
                      }
                    }}
                    className="grid min-h-10 min-w-10 place-items-center rounded-lg border border-hairline bg-fill-subtle text-surface-300 transition-colors hover:border-error-400/40 hover:bg-error-500/10 hover:text-error-200 disabled:opacity-50 [.theme-light_&]:text-error-800"
                    aria-label={`Delete ${isVideo ? "video" : "image"} ${index + 1}`}
                    title="Delete local copy"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
};
