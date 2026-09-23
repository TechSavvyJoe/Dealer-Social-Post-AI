import { useCallback, useEffect, useState } from "react";
import {
  MEDIA_ARCHIVE_CHANGED_EVENT,
  archivedMediaToDataUrl,
  deleteArchivedMedia,
  listDealerMedia,
  type ArchivedMediaKind,
  type ArchivedMediaRecord,
} from "../utils/creativeStorage";
import {
  savePreparedMediaToLibrary,
  type PreparedMediaSave,
  type SaveMediaResult,
} from "../utils/mediaSave";

export interface UseDeviceMediaOptions {
  dealerId: string;
  /** Pass a module-level constant array — see components/LocalMediaArchive.tsx
   * and components/RecentCaptureShelf.tsx — so this stays a stable dependency,
   * matching the original per-screen effects exactly (dealerId was their only
   * relevant trigger; kinds/limit were hardcoded literals). */
  kinds: ArchivedMediaKind[];
  limit: number;
}

export interface DeviceMediaPreview {
  record: ArchivedMediaRecord;
  url: string;
}

export interface UseDeviceMediaResult {
  records: ArchivedMediaRecord[];
  /** Object-URL previews, created and revoked in an effect (not render) so
   * React StrictMode's discarded render cannot leak a URL. */
  previews: DeviceMediaPreview[];
  reload: () => Promise<void>;
  remove: (id: string) => Promise<boolean>;
  save: (prepared: PreparedMediaSave) => Promise<SaveMediaResult>;
  toDataUrl: (record: ArchivedMediaRecord) => Promise<string>;
}

/**
 * Device-local recovery media: list by kind, object-URL lifecycle, save
 * toward the device library, delete. Reacts to the same
 * MEDIA_ARCHIVE_CHANGED_EVENT the logout purge already dispatches (moved
 * verbatim from components/LocalMediaArchive.tsx and
 * components/RecentCaptureShelf.tsx, which shared this exact logic).
 */
export const useDeviceMedia = ({
  dealerId,
  kinds,
  limit,
}: UseDeviceMediaOptions): UseDeviceMediaResult => {
  const [records, setRecords] = useState<ArchivedMediaRecord[]>([]);

  const load = useCallback(async () => {
    setRecords(await listDealerMedia(dealerId, { kinds, limit }));
  }, [dealerId, kinds, limit]);

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

  const [previews, setPreviews] = useState<DeviceMediaPreview[]>([]);

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

  const remove = useCallback((id: string) => deleteArchivedMedia(id), []);
  const save = useCallback(
    (prepared: PreparedMediaSave) => savePreparedMediaToLibrary(prepared),
    [],
  );
  const toDataUrl = useCallback(
    (record: ArchivedMediaRecord) => archivedMediaToDataUrl(record),
    [],
  );

  return { records, previews, reload: load, remove, save, toDataUrl };
};
