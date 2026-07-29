import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const STORAGE_DATABASE = "dealer-social-post-ai";
const TEST_DOCUMENT_URL = "/__media-persistence-format-test__.html";
const SYNTHETIC_MP4_BYTES = [
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00,
  0x00, 0x00, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x31,
];

const useOnlyProject = (
  projectName: string,
  expectedName: string,
  reason: string,
): void => {
  test.skip(projectName !== expectedName, reason);
};

const openTestDocument = async (page: Page): Promise<void> => {
  await page.route(`**${TEST_DOCUMENT_URL}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><body></body></html>",
    });
  });
  await page.goto(TEST_DOCUMENT_URL);
};

test.describe("local media recovery and exact output canvases", () => {
  test("upgrades a v1 database, preserves archived video across reload, and clears all private media", async ({
    page,
  }, testInfo) => {
    useOnlyProject(
      testInfo.project.name,
      "chromium-desktop-1440",
      "One real Chromium database is sufficient for the IndexedDB migration contract.",
    );

    // Use a blank same-origin document so the React session bootstrap cannot
    // clear the deliberately seeded v1 database while this migration is tested.
    await openTestDocument(page);

    await page.evaluate(async (databaseName) => {
      await new Promise<void>((resolve, reject) => {
        const deletion = indexedDB.deleteDatabase(databaseName);
        deletion.onsuccess = () => resolve();
        deletion.onerror = () => reject(deletion.error);
        deletion.onblocked = () => reject(new Error("Database deletion was blocked"));
      });

      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(databaseName, 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore("creative-assets", { keyPath: "key" });
        };
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("creative-assets", "readwrite");
          transaction.objectStore("creative-assets").put({
            key: "dealer-a:selected",
            value: "data:image/jpeg;base64,b2xkLXBob3Rv",
            updatedAt: Date.now(),
            mediaEpoch: 0,
          });
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
        request.onerror = () => reject(request.error);
      });
    }, STORAGE_DATABASE);

    const upgraded = await page.evaluate(async (mp4Bytes) => {
      const moduleUrl = `${location.origin}/utils/creativeStorage.ts`;
      const storage = await import(moduleUrl);
      const selected = await storage.loadDealerCreative("dealer-a", "selected");
      const videoSourceUrl = URL.createObjectURL(
        new Blob([Uint8Array.from(mp4Bytes)], { type: "video/mp4" }),
      );
      const video = await storage.archiveDealerMedia("dealer-a", {
        kind: "video",
        source: videoSourceUrl,
        label: "Synthetic video",
      });
      URL.revokeObjectURL(videoSourceUrl);
      const captures = await storage.archiveDealerMedia("dealer-a", {
        kind: "capture",
        source: "data:image/jpeg;base64,c3ludGhldGljLWpwZWc=",
      });
      const rejectedProviderError = await storage.archiveDealerMedia("dealer-a", {
        kind: "video",
        source: new Blob(['{"error":"provider unavailable"}'], {
          type: "application/json",
        }),
      });

      const databaseShape = await new Promise<{
        version: number;
        stores: string[];
        archiveIndexes: string[];
      }>((resolve, reject) => {
        const request = indexedDB.open("dealer-social-post-ai", 2);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("media-archive", "readonly");
          const archive = transaction.objectStore("media-archive");
          resolve({
            version: database.version,
            stores: Array.from(database.objectStoreNames),
            archiveIndexes: Array.from(archive.indexNames),
          });
          database.close();
        };
        request.onerror = () => reject(request.error);
      });

      return {
        selected,
        videoId: video?.id ?? null,
        captureId: captures?.id ?? null,
        rejectedProviderErrorId: rejectedProviderError?.id ?? null,
        databaseShape,
      };
    }, SYNTHETIC_MP4_BYTES);

    expect(upgraded.selected).toBe("data:image/jpeg;base64,b2xkLXBob3Rv");
    expect(upgraded.videoId).toBeTruthy();
    expect(upgraded.captureId).toBeTruthy();
    expect(upgraded.rejectedProviderErrorId).toBeNull();
    expect(upgraded.databaseShape).toEqual({
      version: 2,
      stores: expect.arrayContaining(["creative-assets", "media-archive"]),
      archiveIndexes: ["dealerId"],
    });

    // A page reload closes the first module instance and proves that recovery
    // comes from the persisted Blob, not an in-memory/object-URL reference.
    await page.reload();
    const reloadedVideo = await page.evaluate(async () => {
      const moduleUrl = `${location.origin}/utils/creativeStorage.ts`;
      const storage = await import(moduleUrl);
      const records = await storage.listDealerMedia("dealer-a", {
        kinds: ["video"],
      });
      const record = records[0];
      return record
        ? {
            type: record.blob.type,
            mimeType: record.mimeType,
            bytes: Array.from(new Uint8Array(await record.blob.arrayBuffer())),
          }
        : null;
    });
    expect(reloadedVideo).toEqual({
      type: "video/mp4",
      mimeType: "video/mp4",
      bytes: SYNTHETIC_MP4_BYTES,
    });

    await page.evaluate(async () => {
      const storageModuleUrl = `${location.origin}/utils/creativeStorage.ts`;
      const mediaSaveModuleUrl = `${location.origin}/utils/mediaSave.ts`;
      const [storage, mediaSave] = await Promise.all([
        import(storageModuleUrl),
        import(mediaSaveModuleUrl),
      ]);
      const records = await storage.listDealerMedia("dealer-a", {
        kinds: ["video"],
      });
      const record = records[0];
      if (!record) throw new Error("Archived video was not available for Save");
      const filename = "dealer-social-recovered-video.mp4";
      const file = new File([record.blob], filename, {
        type: record.mimeType,
      });
      const button = document.createElement("button");
      button.id = "save-recovered-video";
      button.textContent = "Save recovered video";
      button.addEventListener("click", () => {
        void mediaSave.savePreparedMediaToLibrary({
          kind: "video",
          filename,
          file,
        });
      });
      document.body.appendChild(button);
    });
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#save-recovered-video").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("dealer-social-recovered-video.mp4");
    const downloadStream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of downloadStream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(SYNTHETIC_MP4_BYTES));

    const cleared = await page.evaluate(async () => {
      const moduleUrl = `${location.origin}/utils/creativeStorage.ts`;
      const storage = await import(moduleUrl);
      await storage.clearAllCreatives();
      const selected = await storage.loadDealerCreative("dealer-a", "selected");
      const archive = await storage.listDealerMedia("dealer-a");
      const rawCounts = await new Promise<Record<string, number>>((resolve, reject) => {
        const request = indexedDB.open("dealer-social-post-ai", 2);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(
            ["creative-assets", "media-archive"],
            "readonly",
          );
          const counts: Record<string, number> = {};
          let remaining = 2;
          for (const storeName of ["creative-assets", "media-archive"]) {
            const count = transaction.objectStore(storeName).count();
            count.onsuccess = () => {
              counts[storeName] = count.result;
              remaining -= 1;
              if (remaining === 0) {
                database.close();
                resolve(counts);
              }
            };
            count.onerror = () => reject(count.error);
          }
        };
        request.onerror = () => reject(request.error);
      });
      return { selected, archiveCount: archive.length, rawCounts };
    });

    expect(cleared).toEqual({
      selected: null,
      archiveCount: 0,
      rawCounts: {
        "creative-assets": 0,
        "media-archive": 0,
      },
    });
  });

  test("keeps original bytes separate from previews and purges stale private media", async ({
    page,
  }, testInfo) => {
    useOnlyProject(
      testInfo.project.name,
      "chromium-desktop-1440",
      "One real Chromium database is sufficient for the local privacy contract.",
    );
    await openTestDocument(page);

    const result = await page.evaluate(async (databaseName) => {
      localStorage.removeItem("__dsp_media_boundary_epoch_v1");
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(databaseName);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("Database deletion was blocked"));
      });

      const storage = await import(
        `${location.origin}/utils/creativeStorage.ts?privacy-contract`
      );
      const rawBytes = Uint8Array.from([0x00, 0x01, 0x02, 0xfe, 0xff]);
      const original = new Blob([rawBytes], { type: "image/heic" });
      const preview = "data:image/jpeg;base64,cHJldmlldy1qcGVn";
      const first = await storage.archiveDealerMedia("dealer-a", {
        kind: "capture",
        source: original,
        previewSource: preview,
        originalFilename: "delivery-original.heic",
      });
      const duplicate = await storage.archiveDealerMedia("dealer-a", {
        kind: "capture",
        source: original,
        previewSource: preview,
        originalFilename: "delivery-original.heic",
      });
      if (!first || !duplicate) throw new Error("Capture archive was unavailable");

      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName, 2);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const expiredAt = Date.now() - storage.PRIVATE_MEDIA_TTL_MS - 1_000;
      const transaction = database.transaction(
        ["creative-assets", "media-archive"],
        "readwrite",
      );
      transaction.objectStore("creative-assets").put({
        key: "dealer-a:selected",
        value: "data:image/jpeg;base64,c3RhbGU=",
        updatedAt: expiredAt,
        mediaEpoch: 0,
      });
      transaction.objectStore("creative-assets").put({
        key: "dealer-a:generated",
        value: "data:image/jpeg;base64,d3JvbmctZXBvY2g=",
        updatedAt: Date.now(),
        mediaEpoch: 99,
      });
      transaction.objectStore("media-archive").put({
        id: "expired-capture",
        dealerId: "dealer-a",
        kind: "capture",
        blob: new Blob([Uint8Array.from([9])], { type: "image/jpeg" }),
        mimeType: "image/jpeg",
        fingerprint: "expired",
        createdAt: expiredAt,
        expiresAt: expiredAt + storage.PRIVATE_MEDIA_TTL_MS,
        mediaEpoch: 0,
        label: "Expired capture",
      });
      transaction.objectStore("media-archive").put({
        id: "wrong-epoch-capture",
        dealerId: "dealer-a",
        kind: "capture",
        blob: new Blob([Uint8Array.from([8])], { type: "image/jpeg" }),
        mimeType: "image/jpeg",
        fingerprint: "wrong-epoch",
        createdAt: Date.now(),
        expiresAt: Date.now() + storage.PRIVATE_MEDIA_TTL_MS,
        mediaEpoch: 99,
        label: "Wrong epoch capture",
      });
      transaction.objectStore("media-archive").put({
        id: "legacy-capture-without-epoch",
        dealerId: "dealer-a",
        kind: "capture",
        blob: new Blob([Uint8Array.from([7])], { type: "image/jpeg" }),
        mimeType: "image/jpeg",
        fingerprint: "legacy",
        createdAt: Date.now(),
        expiresAt: Date.now() + storage.PRIVATE_MEDIA_TTL_MS,
        label: "Legacy capture",
      });
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();

      const records = await storage.listDealerMedia("dealer-a", {
        kinds: ["capture"],
      });
      const selected = await storage.loadDealerCreative("dealer-a", "selected");
      const generated = await storage.loadDealerCreative("dealer-a", "generated");
      const previewDataUrl = await storage.archivedMediaToDataUrl(records[0]);
      const storedRawBytes = Array.from(
        new Uint8Array(await records[0].blob.arrayBuffer()),
      );
      const counts = await new Promise<Record<string, number>>((resolve, reject) => {
        const request = indexedDB.open(databaseName, 2);
        request.onsuccess = () => {
          const opened = request.result;
          const countTransaction = opened.transaction(
            ["creative-assets", "media-archive"],
            "readonly",
          );
          const output: Record<string, number> = {};
          let remaining = 2;
          for (const storeName of ["creative-assets", "media-archive"]) {
            const count = countTransaction.objectStore(storeName).count();
            count.onsuccess = () => {
              output[storeName] = count.result;
              remaining -= 1;
              if (remaining === 0) {
                opened.close();
                resolve(output);
              }
            };
            count.onerror = () => reject(count.error);
          }
        };
        request.onerror = () => reject(request.error);
      });

      return {
        sameId: first.id === duplicate.id,
        recordCount: records.length,
        rawType: records[0].blob.type,
        previewType: records[0].previewBlob?.type,
        originalFilename: records[0].originalFilename,
        storedRawBytes,
        previewDataUrl,
        selected,
        generated,
        counts,
      };
    }, STORAGE_DATABASE);

    expect(result).toEqual({
      sameId: true,
      recordCount: 1,
      rawType: "image/heic",
      previewType: "image/jpeg",
      originalFilename: "delivery-original.heic",
      storedRawBytes: [0x00, 0x01, 0x02, 0xfe, 0xff],
      previewDataUrl: "data:image/jpeg;base64,cHJldmlldy1qcGVn",
      selected: null,
      generated: null,
      counts: {
        "creative-assets": 0,
        "media-archive": 1,
      },
    });
  });

  test("emits JPEGs whose decoded pixels exactly match every selected export format", async ({
    page,
  }, testInfo) => {
    useOnlyProject(
      testInfo.project.name,
      "chromium-desktop-1440",
      "One real Chromium canvas validates the encoded pixel dimensions.",
    );
    await openTestDocument(page);

    const outputs = await page.evaluate(async () => {
      const source = document.createElement("canvas");
      source.width = 1600;
      source.height = 900;
      const sourceContext = source.getContext("2d");
      if (!sourceContext) throw new Error("Source canvas unavailable");
      sourceContext.fillStyle = "#183153";
      sourceContext.fillRect(0, 0, source.width, source.height);
      sourceContext.fillStyle = "#f5f7ff";
      sourceContext.fillRect(240, 180, 1120, 540);

      const moduleUrl = `${location.origin}/utils/multiFormatExport.ts`;
      const exports = await import(moduleUrl);
      const decoded: Array<{
        id: string;
        expectedWidth: number;
        expectedHeight: number;
        width: number;
        height: number;
        mimePrefix: string;
      }> = [];

      for (const format of exports.EXPORT_FORMATS) {
        const rendered = await exports.renderFormat(
          source.toDataURL("image/png"),
          format,
        );
        const dimensions = await new Promise<{ width: number; height: number }>(
          (resolve, reject) => {
            const image = new Image();
            image.onload = () =>
              resolve({
                width: image.naturalWidth,
                height: image.naturalHeight,
              });
            image.onerror = () => reject(new Error(`Could not decode ${format.id}`));
            image.src = rendered;
          },
        );
        decoded.push({
          id: format.id,
          expectedWidth: format.width,
          expectedHeight: format.height,
          ...dimensions,
          mimePrefix: rendered.slice(0, 23),
        });
      }
      return decoded;
    });

    expect(outputs).toHaveLength(4);
    for (const output of outputs) {
      expect(
        { width: output.width, height: output.height },
        `${output.id} encoded dimensions`,
      ).toEqual({
        width: output.expectedWidth,
        height: output.expectedHeight,
      });
      expect(output.mimePrefix).toBe("data:image/jpeg;base64,");
    }
  });

  test("shares a synthetic MP4 inside the fresh WebKit save click", async ({
    page,
  }, testInfo) => {
    useOnlyProject(
      testInfo.project.name,
      "webkit-phone-390",
      "WebKit phone is the relevant transient-user-activation implementation.",
    );
    await openTestDocument(page);
    await page.locator("body").evaluate((body) => {
      body.innerHTML = '<button id="save">Save prepared video</button>';
    });

    await page.evaluate(async (mp4Bytes) => {
      Object.defineProperty(navigator, "userAgent", {
        configurable: true,
        value:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15",
      });
      Object.defineProperty(navigator, "canShare", {
        configurable: true,
        value: ({ files }: ShareData) =>
          Boolean(files?.length && files[0]?.type === "video/mp4"),
      });
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: (data: ShareData) => {
          const file = data.files?.[0];
          (
            window as typeof window & {
              shareReceipt?: {
                called: boolean;
                active: boolean;
                filename: string | null;
                mimeType: string | null;
              };
            }
          ).shareReceipt = {
            called: true,
            active: navigator.userActivation?.isActive ?? false,
            filename: file?.name ?? null,
            mimeType: file?.type ?? null,
          };
          return Promise.resolve();
        },
      });

      const moduleUrl = `${location.origin}/utils/mediaSave.ts`;
      const mediaSave = await import(moduleUrl);
      const file = new File([Uint8Array.from(mp4Bytes)], "delivery.mp4", {
        type: "video/mp4",
      });
      document
        .querySelector<HTMLButtonElement>("#save")
        ?.addEventListener("click", () => {
          void mediaSave.savePreparedMediaToLibrary({
            kind: "video",
            filename: file.name,
            file,
          });
        });
    }, SYNTHETIC_MP4_BYTES);

    await page.locator("#save").click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as typeof window & {
                shareReceipt?: {
                  called: boolean;
                  active: boolean;
                  filename: string | null;
                  mimeType: string | null;
                };
              }
            ).shareReceipt,
        ),
      )
      .toEqual({
        called: true,
        active: true,
        filename: "delivery.mp4",
        mimeType: "video/mp4",
      });
  });
});
