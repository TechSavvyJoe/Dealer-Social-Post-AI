import React, { useState } from "react";
import { Download, Loader2, Play, Trash2 } from "lucide-react";
import type { ImageSelection } from "../../types";
import type {
  ArchivedMediaKind,
  ArchivedMediaRecord,
} from "../../utils/creativeStorage";
import { saveResultToastMessage } from "../../utils/mediaSave";
import { useToast } from "../ui/Toast";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { useDeviceMedia, type DeviceMediaPreview } from "../../hooks/useDeviceMedia";

/**
 * Original photos are listed beside the post images and videos: the 48-hour
 * rescue copy of the customer's photo is the one thing a salesperson needs
 * after a failed or interrupted post, and My work is where spec §3.1 keeps it
 * reachable. Module-level so useDeviceMedia's effect dependency stays stable.
 */
const MEDIA_KINDS: ArchivedMediaKind[] = ["capture", "generated-image", "video"];
/** The archive keeps at most 24 copies per dealer; show all of them. */
const MEDIA_LIMIT = 24;

const KIND_LABELS: Record<ArchivedMediaKind, string> = {
  capture: "Original photo",
  "generated-image": "Post image",
  video: "Video",
};

const formatWhen = (value: number) =>
  new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const extensionFor = (record: ArchivedMediaRecord) => {
  const type = (record.mimeType || "").toLowerCase();
  if (record.kind === "video") {
    if (type.includes("webm")) return "webm";
    if (type.includes("quicktime")) return "mov";
    return "mp4";
  }
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  return "jpg";
};

const filenameFor = (record: ArchivedMediaRecord) =>
  record.kind === "capture" && record.originalFilename
    ? record.originalFilename
    : `dealer-social-${record.id}.${extensionFor(record)}`;

/**
 * iOS Safari paints no frame for preload="metadata" until playback starts, so
 * the tile would be blank. A media fragment a moment in makes it decode and
 * show that frame; the object URL itself ignores the fragment.
 */
const firstFrameUrl = (url: string) => (url.includes("#") ? url : `${url}#t=0.1`);

type BusyAction = "save" | "reuse" | "delete";

interface DeviceRecoveryGridProps {
  dealerId: string;
  onReusePhoto: (selection: ImageSelection) => void;
}

export const DeviceRecoveryGrid: React.FC<DeviceRecoveryGridProps> = ({
  dealerId,
  onReusePhoto,
}) => {
  const toast = useToast();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ id: string; action: BusyAction } | null>(null);
  const { records, previews, remove, save, toDataUrl } = useDeviceMedia({
    dealerId,
    kinds: MEDIA_KINDS,
    limit: MEDIA_LIMIT,
  });

  if (!records.length) return null;
  const pending = records.find((record) => record.id === deleteId);
  const playing = previews.find(({ record }) => record.id === playingId);
  const isBusy = (id: string, action: BusyAction) =>
    busy?.id === id && busy.action === action;
  const originals = previews.filter(({ record }) => record.kind === "capture");
  const made = previews.filter(({ record }) => record.kind !== "capture");
  const madeVideos = made.filter(({ record }) => record.kind === "video").length;
  const madeHeading =
    madeVideos === 0
      ? "Post images"
      : madeVideos === made.length
        ? "Videos"
        : "Post images and videos";

  const saveRecord = async (record: ArchivedMediaRecord) => {
    setBusy({ id: record.id, action: "save" });
    try {
      const filename = filenameFor(record);
      const result = await save({
        kind: record.kind === "video" ? "video" : "image",
        filename,
        file: new File([record.blob], filename, { type: record.mimeType }),
      });
      if (result.method === "error") toast.error(saveResultToastMessage(result));
      else toast.success(saveResultToastMessage(result));
    } finally {
      setBusy(null);
    }
  };

  // Only an original goes back in as a source photo: a post image already
  // carries its overlays, which a new post would bake in a second time.
  const reuseOriginal = async (record: ArchivedMediaRecord) => {
    setBusy({ id: record.id, action: "reuse" });
    try {
      const dataUrl = await toDataUrl(record);
      onReusePhoto({
        workingImage: dataUrl,
        originalSource: record.blob,
        originalFilename: filenameFor(record),
      });
    } catch {
      toast.error("This photo could not be opened. Try again or take a new one.");
    } finally {
      setBusy(null);
    }
  };

  const renderRow = ({ record, url }: DeviceMediaPreview) => {
    const video = record.kind === "video";
    const label = KIND_LABELS[record.kind];
    const when = formatWhen(record.createdAt);
    const saving = isBusy(record.id, "save");
    return (
      <li
        key={record.id}
        className="flex min-h-16 flex-wrap items-center gap-x-3 gap-y-1 border-b border-hairline py-2"
      >
        {video ? (
          // The tile is the way to watch a recovered video before saving it.
          <button
            type="button"
            aria-label={`Play video from ${when}`}
            onClick={() => setPlayingId(record.id)}
            className="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-sm bg-fill-subtle"
          >
            <video
              src={firstFrameUrl(url)}
              muted
              playsInline
              preload="metadata"
              aria-hidden="true"
              tabIndex={-1}
              className="pointer-events-none h-full w-full object-cover"
            />
            <span
              aria-hidden="true"
              className="absolute inset-0 grid place-items-center"
            >
              <span className="grid h-6 w-6 place-items-center rounded-full bg-overlay text-ink">
                <Play className="h-3.5 w-3.5" />
              </span>
            </span>
          </button>
        ) : (
          <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-sm bg-fill-subtle">
            <img
              src={url}
              alt={`${label} from ${when}`}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          </span>
        )}
        <span className="min-w-[5.5rem] flex-1">
          <span className="block truncate text-sm font-medium text-ink">{label}</span>
          <span className="block truncate text-caption text-ink-2">{when}</span>
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {record.kind === "capture" ? (
            <Button
              variant="secondary"
              className="px-4"
              loading={isBusy(record.id, "reuse")}
              disabled={Boolean(busy)}
              aria-label={`Reuse ${label.toLowerCase()} from ${when}`}
              onClick={() => void reuseOriginal(record)}
            >
              Reuse
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            disabled={Boolean(busy)}
            aria-busy={saving || undefined}
            aria-label={`Save ${label.toLowerCase()} from ${when}`}
            onClick={() => void saveRecord(record)}
          >
            {saving ? (
              <Loader2
                className="h-5 w-5 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <Download className="h-5 w-5" aria-hidden="true" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={Boolean(busy)}
            aria-label={`Delete ${label.toLowerCase()} from ${when}`}
            onClick={() => setDeleteId(record.id)}
          >
            <Trash2 className="h-5 w-5" aria-hidden="true" />
          </Button>
        </span>
      </li>
    );
  };

  return (
    <>
      <section className="mt-10" aria-labelledby="device-recovery-heading">
        <h2
          id="device-recovery-heading"
          className="font-display text-lg font-semibold text-ink"
        >
          On this device
        </h2>
        <p className="mt-1 text-sm text-ink-2">
          Recovery copies are stored locally and do not include customer names.
        </p>
        {originals.length > 0 ? (
          <div className="mt-5">
            <h3
              id="device-originals-heading"
              className="text-sm font-semibold text-ink-2"
            >
              Original photos
            </h3>
            <ul
              aria-labelledby="device-originals-heading"
              className="mt-2 border-t border-hairline"
            >
              {originals.map(renderRow)}
            </ul>
          </div>
        ) : null}
        {made.length > 0 ? (
          <div className="mt-5">
            <h3 id="device-made-heading" className="text-sm font-semibold text-ink-2">
              {madeHeading}
            </h3>
            <ul
              aria-labelledby="device-made-heading"
              className="mt-2 border-t border-hairline"
            >
              {made.map(renderRow)}
            </ul>
          </div>
        ) : null}
      </section>
      <Modal
        isOpen={Boolean(pending)}
        onClose={() => setDeleteId(null)}
        title="Delete recovery copy"
        description="This local copy will be removed from this device."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteId(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={Boolean(pending) && isBusy(pending?.id ?? "", "delete")}
              onClick={async () => {
                if (pending) {
                  setBusy({ id: pending.id, action: "delete" });
                  try {
                    await remove(pending.id);
                  } finally {
                    setBusy(null);
                  }
                }
                setDeleteId(null);
              }}
            >
              Delete
            </Button>
          </div>
        }
      >
        <p className="text-sm text-ink-2">You can’t recover it after deletion.</p>
      </Modal>
      <Modal
        isOpen={Boolean(playing)}
        onClose={() => setPlayingId(null)}
        title={playing ? `Video from ${formatWhen(playing.record.createdAt)}` : "Video"}
        size="lg"
      >
        {playing ? (
          <video
            src={playing.url}
            controls
            playsInline
            preload="metadata"
            className="max-h-[70vh] w-full rounded-md bg-canvas object-contain"
          />
        ) : null}
      </Modal>
    </>
  );
};
