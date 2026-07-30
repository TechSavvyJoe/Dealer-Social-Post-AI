/**
 * Large camera and generated images do not belong in localStorage. Keep the
 * current workflow's two private assets in IndexedDB, while localStorage holds
 * only small metadata needed to reconstruct the screen after a refresh.
 */

const DATABASE_NAME = "dealer-social-post-ai";
const DATABASE_VERSION = 2;
const STORE_NAME = "creative-assets";
const ARCHIVE_STORE_NAME = "media-archive";
const READ_TIMEOUT_MS = 2_000;
const OPEN_TIMEOUT_MS = 5_000;
const MAX_ARCHIVE_ITEMS_PER_DEALER = 24;
const MAX_ARCHIVED_VIDEOS_PER_DEALER = 3;
export const PRIVATE_MEDIA_TTL_MS = 48 * 60 * 60 * 1_000;
const STORAGE_EPOCH_KEY = "__dsp_media_boundary_epoch_v1";
const STORAGE_BOUNDARY_CHANNEL = "dealer-social-media-boundary";
export const MEDIA_ARCHIVE_CHANGED_EVENT = "dealer-social-media-archive-changed";

export type CreativeSlot = "selected" | "generated";

interface StoredCreative {
  key: string;
  value: string;
  updatedAt: number;
  mediaEpoch: number;
}

export type ArchivedMediaKind = "capture" | "generated-image" | "video";

/**
 * Private, device-local recovery media. Customer names/captions are
 * intentionally omitted: durable customer history belongs on the
 * session-authorized backend, while this store is only a short rescue shelf.
 */
export interface ArchivedMediaRecord {
  id: string;
  dealerId: string;
  kind: ArchivedMediaKind;
  /** Untouched original/provider bytes used for recovery downloads. */
  blob: Blob;
  /** Browser-safe, orientation-normalized image used only for display/reuse. */
  previewBlob?: Blob;
  mimeType: string;
  originalFilename?: string;
  fingerprint: string;
  createdAt: number;
  expiresAt: number;
  mediaEpoch: number;
  label: string;
}

let databasePromise: Promise<IDBDatabase> | null = null;
let clearAllPromise: Promise<boolean> | null = null;
let storageEpoch = 0;

const persistedStorageEpoch = (): number => {
  if (typeof localStorage === "undefined") return storageEpoch;
  try {
    const parsed = Number(localStorage.getItem(STORAGE_EPOCH_KEY) || "0");
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : storageEpoch;
  } catch {
    return storageEpoch;
  }
};

const currentStorageEpoch = (): number => {
  storageEpoch = Math.max(storageEpoch, persistedStorageEpoch());
  return storageEpoch;
};

const mediaBoundaryChannel =
  typeof window !== "undefined" && typeof window.BroadcastChannel !== "undefined"
    ? new window.BroadcastChannel(STORAGE_BOUNDARY_CHANNEL)
    : null;

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_EPOCH_KEY) return;
    storageEpoch = Math.max(storageEpoch, Number(event.newValue || "0") || 0);
  });
  if (mediaBoundaryChannel) {
    mediaBoundaryChannel.onmessage = (event) => {
      const epoch = Number(event.data?.epoch || "0");
      if (Number.isSafeInteger(epoch)) storageEpoch = Math.max(storageEpoch, epoch);
    };
  }
}

const advanceStorageEpoch = (): void => {
  storageEpoch = currentStorageEpoch() + 1;
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(STORAGE_EPOCH_KEY, String(storageEpoch));
    } catch {
      /* private browsing/storage policy — BroadcastChannel remains available */
    }
  }
  mediaBoundaryChannel?.postMessage({ epoch: storageEpoch });
};

const notifyArchiveChanged = (dealerId: string) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(MEDIA_ARCHIVE_CHANGED_EVENT, {
      detail: { dealerId },
    }),
  );
};

const assetKey = (dealerId: string, slot: CreativeSlot) => `${dealerId}:${slot}`;

const openDatabase = (): Promise<IDBDatabase> => {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      databasePromise = null;
      reject(new Error("Creative storage did not become available in time"));
    }, OPEN_TIMEOUT_MS);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains(ARCHIVE_STORE_NAME)) {
        const archive = database.createObjectStore(ARCHIVE_STORE_NAME, {
          keyPath: "id",
        });
        archive.createIndex("dealerId", "dealerId", { unique: false });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      if (settled) {
        // An upgrade can finish after our timeout. Never leave that late
        // connection untracked and blocking a later privacy clear.
        database.close();
        return;
      }
      settled = true;
      clearTimeout(timeout);
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };
      resolve(database);
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      databasePromise = null;
      reject(request.error || new Error("Could not open creative storage"));
    };
    request.onblocked = () => {
      // Existing app tabs receive `versionchange` and close their connection.
      // Keep this request alive for the bounded timeout instead of rejecting
      // immediately and allowing a late, untracked connection to leak.
    };
  });
  return databasePromise;
};

const transactionDone = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error || new Error("Creative storage failed"));
    transaction.onabort = () =>
      reject(transaction.error || new Error("Creative storage was aborted"));
  });

const requestResult = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("Creative storage request failed"));
  });

const isFreshTimestamp = (timestamp: number, now: number): boolean =>
  Number.isFinite(timestamp) &&
  timestamp <= now + 5 * 60 * 1_000 &&
  timestamp > now - PRIVATE_MEDIA_TTL_MS;

const isCurrentCreative = (
  record: StoredCreative | undefined,
  epoch: number,
  now: number,
): boolean =>
  Boolean(
    record &&
    record.mediaEpoch === epoch &&
    typeof record.value === "string" &&
    isFreshTimestamp(record.updatedAt, now),
  );

const isCurrentArchiveRecord = (
  record: ArchivedMediaRecord,
  epoch: number,
  now: number,
): boolean =>
  record.mediaEpoch === epoch &&
  isFreshTimestamp(record.createdAt, now) &&
  Number.isFinite(record.expiresAt) &&
  record.expiresAt > now &&
  record.expiresAt <= record.createdAt + PRIVATE_MEDIA_TTL_MS;

/**
 * Enforce the privacy boundary on every storage read/write. Records created
 * before the current authenticated media epoch, legacy records with no epoch,
 * and records older than 48 hours are removed instead of merely hidden.
 */
const purgePrivateMedia = async (
  database: IDBDatabase,
  epoch: number,
  now = Date.now(),
): Promise<void> => {
  const transaction = database.transaction(
    [STORE_NAME, ARCHIVE_STORE_NAME],
    "readwrite",
  );
  const creativeStore = transaction.objectStore(STORE_NAME);
  const archiveStore = transaction.objectStore(ARCHIVE_STORE_NAME);
  const [creatives, archive] = await Promise.all([
    requestResult(creativeStore.getAll() as IDBRequest<StoredCreative[]>),
    requestResult(archiveStore.getAll() as IDBRequest<ArchivedMediaRecord[]>),
  ]);
  creatives.forEach((record) => {
    if (!isCurrentCreative(record, epoch, now)) creativeStore.delete(record.key);
  });
  archive.forEach((record) => {
    if (!isCurrentArchiveRecord(record, epoch, now)) archiveStore.delete(record.id);
  });
  await transactionDone(transaction);
};

const deleteCreativeIfEpochMatches = async (
  database: IDBDatabase,
  key: string,
  epoch: number,
): Promise<void> => {
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const store = transaction.objectStore(STORE_NAME);
  const existing = await requestResult(
    store.get(key) as IDBRequest<StoredCreative | undefined>,
  );
  if (existing?.mediaEpoch === epoch) store.delete(key);
  await transactionDone(transaction);
};

const deleteArchiveIfEpochMatches = async (
  database: IDBDatabase,
  id: string,
  epoch: number,
): Promise<void> => {
  const transaction = database.transaction(ARCHIVE_STORE_NAME, "readwrite");
  const store = transaction.objectStore(ARCHIVE_STORE_NAME);
  const existing = await requestResult(
    store.get(id) as IDBRequest<ArchivedMediaRecord | undefined>,
  );
  if (existing?.mediaEpoch === epoch) store.delete(id);
  await transactionDone(transaction);
};

export const saveDealerCreative = async (
  dealerId: string,
  slot: CreativeSlot,
  value: string | null,
): Promise<boolean> => {
  if (!dealerId) return false;
  const operationEpoch = currentStorageEpoch();
  try {
    const database = await openDatabase();
    if (operationEpoch !== currentStorageEpoch()) return false;
    await purgePrivateMedia(database, operationEpoch);
    if (operationEpoch !== currentStorageEpoch()) return false;
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    if (value) {
      const record: StoredCreative = {
        key: assetKey(dealerId, slot),
        value,
        updatedAt: Date.now(),
        mediaEpoch: operationEpoch,
      };
      store.put(record);
    } else {
      store.delete(assetKey(dealerId, slot));
    }
    await transactionDone(transaction);
    if (operationEpoch !== currentStorageEpoch()) {
      await deleteCreativeIfEpochMatches(
        database,
        assetKey(dealerId, slot),
        operationEpoch,
      );
      return false;
    }
    return true;
  } catch {
    return false;
  }
};

export const loadDealerCreative = async (
  dealerId: string,
  slot: CreativeSlot,
): Promise<string | null> => {
  if (!dealerId) return null;
  const operationEpoch = currentStorageEpoch();
  const read = async (): Promise<string | null> => {
    try {
      const database = await openDatabase();
      if (operationEpoch !== currentStorageEpoch()) return null;
      await purgePrivateMedia(database, operationEpoch);
      if (operationEpoch !== currentStorageEpoch()) return null;
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(assetKey(dealerId, slot));
      const record = await new Promise<StoredCreative | undefined>(
        (resolve, reject) => {
          request.onsuccess = () => resolve(request.result as StoredCreative);
          request.onerror = () => reject(request.error);
        },
      );
      if (
        operationEpoch !== currentStorageEpoch() ||
        !isCurrentCreative(record, operationEpoch, Date.now())
      ) {
        if (record?.mediaEpoch === operationEpoch) {
          await deleteCreativeIfEpochMatches(
            database,
            assetKey(dealerId, slot),
            operationEpoch,
          );
        }
        return null;
      }
      return typeof record?.value === "string" ? record.value : null;
    } catch {
      return null;
    }
  };

  return Promise.race([
    read(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), READ_TIMEOUT_MS)),
  ]);
};

export const clearDealerCreatives = async (dealerId: string): Promise<void> => {
  if (!dealerId) return;
  await Promise.all([
    saveDealerCreative(dealerId, "selected", null),
    saveDealerCreative(dealerId, "generated", null),
  ]);
};

const deleteCreativeDatabase = async (): Promise<boolean> => {
  if (typeof indexedDB === "undefined") return false;
  const pendingDatabase = databasePromise;
  databasePromise = null;
  if (pendingDatabase) {
    void pendingDatabase.then((database) => database.close()).catch(() => undefined);
  }

  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };
    const timeout = setTimeout(() => finish(false), OPEN_TIMEOUT_MS);
    request.onsuccess = () => finish(true);
    request.onerror = () => finish(false);
    request.onblocked = () => {
      // Other tabs using this module close on `versionchange`. Wait for that
      // coordination, but remain bounded so logout cannot hang forever.
    };
  });
};

const clearAllCreativesOnce = async (): Promise<boolean> => {
  try {
    const database = await openDatabase();
    const transaction = database.transaction(
      [STORE_NAME, ARCHIVE_STORE_NAME],
      "readwrite",
    );
    transaction.objectStore(STORE_NAME).clear();
    transaction.objectStore(ARCHIVE_STORE_NAME).clear();
    await transactionDone(transaction);
    return true;
  } catch {
    // If a migration/transaction is blocked, deleting the private cache is the
    // safest fallback. This also prevents a stale v1 tab from retaining media.
    return deleteCreativeDatabase();
  }
};

/** Remove every tenant's cached creative on logout, expiry, or auth rejection. */
export const clearAllCreatives = (): Promise<boolean> => {
  // Invalidate any selected/generated/archive write that started before this
  // authentication boundary. A stale async fetch must not repopulate storage
  // after the clear transaction commits.
  advanceStorageEpoch();
  if (clearAllPromise) return clearAllPromise;
  clearAllPromise = clearAllCreativesOnce().finally(() => {
    clearAllPromise = null;
  });
  return clearAllPromise;
};

const sourceToBlob = async (source: string | Blob): Promise<Blob> => {
  if (source instanceof Blob) return source;
  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`Could not preserve media (${response.status}).`);
  }
  return response.blob();
};

const normalizedMimeType = (value: string | undefined): string =>
  (value || "").split(";", 1)[0].trim().toLowerCase();

const mimeTypeFromFilename = (filename: string | undefined): string => {
  const extension = filename?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  switch (extension) {
    case "heic":
      return "image/heic";
    case "heif":
      return "image/heif";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "mp4":
      return "video/mp4";
    default:
      return "";
  }
};

const hasMp4Signature = async (blob: Blob): Promise<boolean> => {
  if (blob.size < 12) return false;
  const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  return (
    bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70
  );
};

/**
 * Provider error bodies sometimes arrive with a successful HTTP status. Keep
 * JSON/text out of the recovery shelf and require the MP4 `ftyp` signature
 * before any archived video can later be offered as a download.
 */
const normalizeArchivedBlob = async (
  kind: ArchivedMediaKind,
  blob: Blob,
  declaredType?: string,
): Promise<Blob | null> => {
  if (!blob.size) return null;
  const type = normalizedMimeType(blob.type || declaredType);
  if (
    type.startsWith("text/") ||
    /^(?:application\/(?:json|xml|javascript|problem\+json))$/.test(type)
  ) {
    return null;
  }

  if (kind === "video") {
    if (!(await hasMp4Signature(blob))) return null;
    return type === "video/mp4" ? blob : new Blob([blob], { type: "video/mp4" });
  }

  if (type && !type.startsWith("image/")) return null;
  if (!type) return new Blob([blob], { type: "image/jpeg" });
  return normalizedMimeType(blob.type) === type ? blob : new Blob([blob], { type });
};

const normalizePreviewBlob = async (
  source: string | Blob | undefined,
): Promise<Blob | undefined> => {
  if (!source) return undefined;
  const blob = await sourceToBlob(source);
  const type = normalizedMimeType(blob.type);
  if (
    !blob.size ||
    !["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"].includes(type)
  ) {
    return undefined;
  }
  return blob;
};

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");

/**
 * Fingerprint a bounded sample rather than reading a potentially large Veo
 * file fully into memory. Size plus first/middle/last samples makes accidental
 * collisions vanishingly unlikely for this short-lived device-local shelf.
 */
const mediaFingerprint = async (
  kind: ArchivedMediaKind,
  blob: Blob,
): Promise<string> => {
  const sampleSize = 64 * 1_024;
  const middleStart = Math.max(
    0,
    Math.floor(blob.size / 2) - Math.floor(sampleSize / 2),
  );
  const samples = await Promise.all([
    blob.slice(0, sampleSize).arrayBuffer(),
    blob.slice(middleStart, middleStart + sampleSize).arrayBuffer(),
    blob.slice(Math.max(0, blob.size - sampleSize)).arrayBuffer(),
  ]);
  const header = new TextEncoder().encode(
    `${kind}:${blob.size}:${normalizedMimeType(blob.type)}:`,
  );
  const byteLength =
    header.byteLength + samples.reduce((total, sample) => total + sample.byteLength, 0);
  const joined = new Uint8Array(byteLength);
  joined.set(header);
  let offset = header.byteLength;
  samples.forEach((sample) => {
    const bytes = new Uint8Array(sample);
    joined.set(bytes, offset);
    offset += bytes.byteLength;
  });

  if (typeof crypto !== "undefined" && crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", joined);
    return `sha256:${bytesToHex(new Uint8Array(digest))}`;
  }

  let fallback = 0x811c9dc5;
  joined.forEach((value) => {
    fallback ^= value;
    fallback = Math.imul(fallback, 0x01000193);
  });
  return `fnv1a:${(fallback >>> 0).toString(16).padStart(8, "0")}`;
};

const defaultArchiveLabel = (kind: ArchivedMediaKind): string => {
  switch (kind) {
    case "capture":
      return "Original photo";
    case "video":
      return "Generated video";
    case "generated-image":
      return "Generated image";
  }
};

const createArchiveId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `media-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const recordsForDealer = async (
  database: IDBDatabase,
  dealerId: string,
): Promise<ArchivedMediaRecord[]> => {
  const transaction = database.transaction(ARCHIVE_STORE_NAME, "readonly");
  const index = transaction.objectStore(ARCHIVE_STORE_NAME).index("dealerId");
  const records = await requestResult(
    index.getAll(IDBKeyRange.only(dealerId)) as IDBRequest<ArchivedMediaRecord[]>,
  );
  return records.sort((a, b) => b.createdAt - a.createdAt);
};

const pruneArchive = async (database: IDBDatabase, dealerId: string): Promise<void> => {
  const records = await recordsForDealer(database, dealerId);
  const retainedVideoIds = new Set(
    records
      .filter((record) => record.kind === "video")
      .slice(0, MAX_ARCHIVED_VIDEOS_PER_DEALER)
      .map((record) => record.id),
  );
  const keep = new Set(
    records
      .filter((record) => record.kind !== "video" || retainedVideoIds.has(record.id))
      .slice(0, MAX_ARCHIVE_ITEMS_PER_DEALER)
      .map((record) => record.id),
  );
  const remove = records.filter((record) => !keep.has(record.id));
  if (remove.length === 0) return;

  const transaction = database.transaction(ARCHIVE_STORE_NAME, "readwrite");
  const store = transaction.objectStore(ARCHIVE_STORE_NAME);
  remove.forEach((record) => store.delete(record.id));
  await transactionDone(transaction);
};

export const archiveDealerMedia = async (
  dealerId: string,
  input: {
    kind: ArchivedMediaKind;
    source: string | Blob;
    previewSource?: string | Blob;
    originalFilename?: string;
    label?: string;
  },
): Promise<ArchivedMediaRecord | null> => {
  if (!dealerId || !input.source) return null;
  const operationEpoch = currentStorageEpoch();
  try {
    const sourceBlob = await sourceToBlob(input.source);
    if (operationEpoch !== currentStorageEpoch()) return null;
    const declaredType =
      normalizedMimeType(sourceBlob.type) ||
      mimeTypeFromFilename(input.originalFilename);
    const blob = await normalizeArchivedBlob(input.kind, sourceBlob, declaredType);
    if (!blob) return null;
    const previewBlob =
      input.kind === "capture"
        ? await normalizePreviewBlob(input.previewSource)
        : undefined;
    if (operationEpoch !== currentStorageEpoch()) return null;
    const fingerprint = await mediaFingerprint(input.kind, blob);
    if (operationEpoch !== currentStorageEpoch()) return null;
    const database = await openDatabase();
    if (operationEpoch !== currentStorageEpoch()) return null;
    await purgePrivateMedia(database, operationEpoch);
    if (operationEpoch !== currentStorageEpoch()) return null;

    const duplicate = (await recordsForDealer(database, dealerId)).find(
      (candidate) =>
        candidate.mediaEpoch === operationEpoch &&
        candidate.kind === input.kind &&
        candidate.fingerprint === fingerprint,
    );
    if (duplicate) {
      const enriched =
        (previewBlob && !duplicate.previewBlob) ||
        (input.originalFilename && !duplicate.originalFilename)
          ? {
              ...duplicate,
              ...(previewBlob && !duplicate.previewBlob ? { previewBlob } : {}),
              ...(input.originalFilename && !duplicate.originalFilename
                ? { originalFilename: input.originalFilename }
                : {}),
            }
          : duplicate;
      if (enriched !== duplicate) {
        const transaction = database.transaction(ARCHIVE_STORE_NAME, "readwrite");
        transaction.objectStore(ARCHIVE_STORE_NAME).put(enriched);
        await transactionDone(transaction);
        if (operationEpoch !== currentStorageEpoch()) {
          await deleteArchiveIfEpochMatches(database, enriched.id, operationEpoch);
          return null;
        }
      }
      return enriched;
    }

    const createdAt = Date.now();
    const record: ArchivedMediaRecord = {
      id: createArchiveId(),
      dealerId,
      kind: input.kind,
      blob,
      ...(previewBlob ? { previewBlob } : {}),
      mimeType: blob.type || "image/jpeg",
      ...(input.originalFilename ? { originalFilename: input.originalFilename } : {}),
      fingerprint,
      createdAt,
      expiresAt: createdAt + PRIVATE_MEDIA_TTL_MS,
      mediaEpoch: operationEpoch,
      label: input.label || defaultArchiveLabel(input.kind),
    };
    if (operationEpoch !== currentStorageEpoch()) return null;
    const transaction = database.transaction(ARCHIVE_STORE_NAME, "readwrite");
    transaction.objectStore(ARCHIVE_STORE_NAME).put(record);
    await transactionDone(transaction);
    if (operationEpoch !== currentStorageEpoch()) {
      await deleteArchiveIfEpochMatches(database, record.id, operationEpoch);
      return null;
    }
    await pruneArchive(database, dealerId);
    if (operationEpoch !== currentStorageEpoch()) {
      await deleteArchiveIfEpochMatches(database, record.id, operationEpoch);
      return null;
    }
    notifyArchiveChanged(dealerId);
    return record;
  } catch {
    // Storage can be disabled or full on private/mobile browsers. The caller
    // keeps the active in-memory asset and can still offer Save to Photos.
    return null;
  }
};

export const listDealerMedia = async (
  dealerId: string,
  options: {
    kinds?: ArchivedMediaKind[];
    limit?: number;
  } = {},
): Promise<ArchivedMediaRecord[]> => {
  if (!dealerId) return [];
  const operationEpoch = currentStorageEpoch();
  try {
    const database = await openDatabase();
    if (operationEpoch !== currentStorageEpoch()) return [];
    await purgePrivateMedia(database, operationEpoch);
    if (operationEpoch !== currentStorageEpoch()) return [];
    const records = await recordsForDealer(database, dealerId);
    const allowed = options.kinds ? new Set(options.kinds) : null;
    const matching = records.filter(
      (record) =>
        isCurrentArchiveRecord(record, operationEpoch, Date.now()) &&
        (!allowed || allowed.has(record.kind)),
    );
    const normalized = await Promise.all(
      matching.map(async (record) => {
        const blob = await normalizeArchivedBlob(
          record.kind,
          record.blob,
          record.mimeType,
        );
        if (!blob) return null;
        const previewBlob = await normalizePreviewBlob(record.previewBlob);
        return {
          ...record,
          blob,
          ...(previewBlob ? { previewBlob } : { previewBlob: undefined }),
          mimeType: blob.type || "image/jpeg",
        };
      }),
    );
    if (operationEpoch !== currentStorageEpoch()) return [];
    return normalized
      .filter((record): record is ArchivedMediaRecord => Boolean(record))
      .slice(0, Math.max(1, options.limit ?? MAX_ARCHIVE_ITEMS_PER_DEALER));
  } catch {
    return [];
  }
};

export const deleteArchivedMedia = async (id: string): Promise<boolean> => {
  if (!id) return false;
  const operationEpoch = currentStorageEpoch();
  try {
    const database = await openDatabase();
    if (operationEpoch !== currentStorageEpoch()) return false;
    await purgePrivateMedia(database, operationEpoch);
    if (operationEpoch !== currentStorageEpoch()) return false;
    const readTransaction = database.transaction(ARCHIVE_STORE_NAME, "readonly");
    const existing = await requestResult(
      readTransaction.objectStore(ARCHIVE_STORE_NAME).get(id) as IDBRequest<
        ArchivedMediaRecord | undefined
      >,
    );
    const writeTransaction = database.transaction(ARCHIVE_STORE_NAME, "readwrite");
    writeTransaction.objectStore(ARCHIVE_STORE_NAME).delete(id);
    await transactionDone(writeTransaction);
    if (existing?.dealerId) notifyArchiveChanged(existing.dealerId);
    return true;
  } catch {
    return false;
  }
};

export const archivedMediaToDataUrl = (record: ArchivedMediaRecord): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Archived media could not be read."));
    reader.onerror = () =>
      reject(reader.error || new Error("Archived media could not be read."));
    reader.readAsDataURL(record.previewBlob || record.blob);
  });
