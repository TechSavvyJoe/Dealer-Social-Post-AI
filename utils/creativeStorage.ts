/**
 * Large camera and generated images do not belong in localStorage. Keep the
 * current workflow's two private assets in IndexedDB, while localStorage holds
 * only small metadata needed to reconstruct the screen after a refresh.
 */

const DATABASE_NAME = "dealer-social-post-ai";
const DATABASE_VERSION = 1;
const STORE_NAME = "creative-assets";
const READ_TIMEOUT_MS = 2_000;

export type CreativeSlot = "selected" | "generated";

interface StoredCreative {
  key: string;
  value: string;
  updatedAt: number;
}

let databasePromise: Promise<IDBDatabase> | null = null;

const assetKey = (dealerId: string, slot: CreativeSlot) =>
  `${dealerId}:${slot}`;

const openDatabase = (): Promise<IDBDatabase> => {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };
      resolve(database);
    };
    request.onerror = () => {
      databasePromise = null;
      reject(request.error || new Error("Could not open creative storage"));
    };
    request.onblocked = () => {
      databasePromise = null;
      reject(new Error("Creative storage upgrade was blocked"));
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

export const saveDealerCreative = async (
  dealerId: string,
  slot: CreativeSlot,
  value: string | null,
): Promise<boolean> => {
  if (!dealerId) return false;
  try {
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    if (value) {
      const record: StoredCreative = {
        key: assetKey(dealerId, slot),
        value,
        updatedAt: Date.now(),
      };
      store.put(record);
    } else {
      store.delete(assetKey(dealerId, slot));
    }
    await transactionDone(transaction);
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
  const read = async (): Promise<string | null> => {
    try {
      const database = await openDatabase();
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction
        .objectStore(STORE_NAME)
        .get(assetKey(dealerId, slot));
      const record = await new Promise<StoredCreative | undefined>(
        (resolve, reject) => {
          request.onsuccess = () => resolve(request.result as StoredCreative);
          request.onerror = () => reject(request.error);
        },
      );
      return typeof record?.value === "string" ? record.value : null;
    } catch {
      return null;
    }
  };

  return Promise.race([
    read(),
    new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), READ_TIMEOUT_MS),
    ),
  ]);
};

export const clearDealerCreatives = async (dealerId: string): Promise<void> => {
  if (!dealerId) return;
  await Promise.all([
    saveDealerCreative(dealerId, "selected", null),
    saveDealerCreative(dealerId, "generated", null),
  ]);
};

/** Remove every tenant's cached creative on logout, expiry, or auth rejection. */
export const clearAllCreatives = async (): Promise<void> => {
  try {
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).clear();
    await transactionDone(transaction);
  } catch {
    // Storage may be disabled (private browsing / browser policy). Nothing to clear.
  }
};
