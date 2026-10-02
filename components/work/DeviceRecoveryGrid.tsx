import React, { useState } from "react";
import { Download, Film, Image as ImageIcon, Loader2, Trash2 } from "lucide-react";
import type { ImageSelection } from "../../types";
import type { ArchivedMediaKind } from "../../utils/creativeStorage";
import { saveResultToastMessage } from "../../utils/mediaSave";
import { useToast } from "../ui/Toast";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { useDeviceMedia } from "../../hooks/useDeviceMedia";

const MEDIA_KINDS: ArchivedMediaKind[] = ["generated-image", "video"];
const formatWhen = (value: number) =>
  new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

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
  const [busyId, setBusyId] = useState<string | null>(null);
  const { records, previews, remove, save, toDataUrl } = useDeviceMedia({
    dealerId,
    kinds: MEDIA_KINDS,
    limit: 12,
  });

  if (!records.length) return null;
  const pending = records.find((record) => record.id === deleteId);

  return (
    <>
      <section className="space-y-3" aria-labelledby="device-recovery-heading">
        <div>
          <h2 id="device-recovery-heading" className="text-lg font-semibold text-ink">
            On this device
          </h2>
          <p className="mt-1 text-sm text-ink-2">
            Recovery copies are stored locally and do not include customer names.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {previews.map(({ record, url }, index) => {
            const video = record.kind === "video";
            const busy = busyId === record.id;
            return (
              <article
                key={record.id}
                className="overflow-hidden rounded-sm border border-hairline bg-panel-raised"
              >
                <div className="relative aspect-square bg-fill-subtle">
                  {video ? (
                    <video
                      src={url}
                      controls
                      playsInline
                      preload="metadata"
                      className="h-full w-full object-contain"
                      aria-label={`Recovered video ${index + 1}`}
                    />
                  ) : (
                    <img
                      src={url}
                      alt={`Recovered image ${index + 1}`}
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>
                <div className="space-y-2 p-3">
                  <div className="flex items-center gap-2 text-xs text-ink-2">
                    {video ? (
                      <Film className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    <span>{formatWhen(record.createdAt)}</span>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      disabled={Boolean(busyId)}
                      onClick={async () => {
                        setBusyId(record.id);
                        try {
                          const result = await save({
                            kind: video ? "video" : "image",
                            filename: `dealer-social-${record.id}.${video ? "mp4" : "jpg"}`,
                            file: new File(
                              [record.blob],
                              `dealer-social-${record.id}.${video ? "mp4" : "jpg"}`,
                              { type: record.mimeType },
                            ),
                          });
                          if (result.method === "error")
                            toast.error(saveResultToastMessage(result));
                          else toast.success(saveResultToastMessage(result));
                        } finally {
                          setBusyId(null);
                        }
                      }}
                      leftIcon={
                        busy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )
                      }
                    >
                      Save
                    </Button>
                    {!video && (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label="Reuse recovered image"
                        disabled={Boolean(busyId)}
                        onClick={async () => {
                          const dataUrl = await toDataUrl(record);
                          onReusePhoto({
                            workingImage: dataUrl,
                            originalSource: record.blob,
                            originalFilename: `dealer-social-${record.id}.jpg`,
                          });
                        }}
                      >
                        <ImageIcon className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label="Delete recovery copy"
                      disabled={Boolean(busyId)}
                      onClick={() => setDeleteId(record.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
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
              onClick={async () => {
                if (pending) {
                  setBusyId(pending.id);
                  await remove(pending.id);
                  setBusyId(null);
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
    </>
  );
};
