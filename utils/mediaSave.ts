/**
 * Save generated images/videos toward the device photo library.
 *
 * Browsers cannot write silently to Photos/Gallery (OS security). On phones the
 * reliable path is Web Share with a real File: iOS/Android then offer
 * "Save Image" / "Save Video" / Photos. Desktop falls back to a file download.
 */
import { dataUrlToBlob, imageFileExtension } from "./imageUtils";

export type SaveMediaKind = "image" | "video";

// Large Veo files may still be streaming from a blob URL after the anchor click
// returns, especially in mobile Safari. Four seconds was short enough for iOS
// to surface a "Failed to load" download. Keep the URL alive for one minute.
export const DOWNLOAD_URL_REVOKE_DELAY_MS = 60_000;
// Some iOS releases leave the Web Share promise pending after "Save Video" or
// "Save Image" succeeds. Do not leave the app permanently busy behind the
// native sheet. The result still means "share sheet opened", never "saved".
export const WEB_SHARE_SETTLE_TIMEOUT_MS = 30_000;

export interface PreparedMediaSave {
  kind: SaveMediaKind;
  file: File;
  filename: string;
}

export interface ExpectedVideoMetadata {
  width: number;
  height: number;
  durationSeconds: number;
}

export interface ValidatedVideoMetadata {
  width: number;
  height: number;
  durationSeconds: number;
}

export type SaveMediaResult =
  | { method: "photos-share"; kind: SaveMediaKind }
  | { method: "photos-share-pending"; kind: SaveMediaKind }
  | { method: "download"; kind: SaveMediaKind }
  | { method: "cancelled"; kind: SaveMediaKind }
  | { method: "error"; kind: SaveMediaKind; message: string };

export type WebShareAttempt =
  | { kind: "completed" }
  | { kind: "started" }
  | { kind: "cancelled" }
  | { kind: "unavailable"; error?: unknown };

export const isMobilePhotoDevice = (): boolean => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod|Android/i.test(ua)) return true;
  // iPadOS desktop UA
  return (
    navigator.platform === "MacIntel" &&
    typeof navigator.maxTouchPoints === "number" &&
    navigator.maxTouchPoints > 1
  );
};

const triggerDownload = (href: string, filename: string) => {
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

const heifExtensionFromName = (name: string | undefined): "heic" | "heif" | null => {
  const match = name?.match(/\.(heic|heif)$/i);
  return match ? (match[1].toLowerCase() as "heic" | "heif") : null;
};

const imageMimeFromFilename = (filename: string): string | null => {
  const extension = heifExtensionFromName(filename);
  return extension ? `image/${extension}` : null;
};

const safeBasename = (value: string): string =>
  value
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[.\s-]+|[.\s-]+$/g, "")
    .slice(0, 120) || "dealer-social-post";

const blobToFile = (blob: Blob, filename: string, kind: SaveMediaKind): File => {
  const type =
    kind === "video"
      ? blob.type.startsWith("video/")
        ? blob.type
        : "video/mp4"
      : blob.type.startsWith("image/")
        ? blob.type
        : imageMimeFromFilename(filename) || "image/jpeg";
  return new File([blob], filename, { type });
};

const sourceToBlob = async (sourceUrl: string | Blob): Promise<Blob> => {
  if (sourceUrl instanceof Blob) return sourceUrl;
  if (sourceUrl.startsWith("data:")) {
    return dataUrlToBlob(sourceUrl);
  }
  let credentials: RequestCredentials = "omit";
  try {
    const base =
      typeof window !== "undefined" && window.location?.href
        ? window.location.href
        : "http://localhost/";
    const parsed = new URL(sourceUrl, base);
    if (!["http:", "https:", "blob:"].includes(parsed.protocol)) {
      throw new Error("Media URL uses an unsupported protocol.");
    }
    if (
      parsed.protocol !== "blob:" &&
      typeof window !== "undefined" &&
      parsed.origin === window.location.origin
    ) {
      // Session-gated media endpoints need the PocketBase cookie. Do not send
      // credentials to arbitrary cross-origin image hosts.
      credentials = "include";
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("unsupported protocol")) {
      throw error;
    }
    throw new Error("Media URL is invalid.");
  }
  const res = await fetch(sourceUrl, {
    credentials,
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Could not read media (${res.status}).`);
  }
  return res.blob();
};

const readBlobHeader = async (blob: Blob): Promise<Uint8Array> => {
  const header = blob.slice(0, 16);
  if (typeof header.arrayBuffer === "function") {
    return new Uint8Array(await header.arrayBuffer());
  }
  if (typeof FileReader !== "undefined") {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () =>
        reader.result instanceof ArrayBuffer
          ? resolve(new Uint8Array(reader.result))
          : reject(new Error("Video header could not be read."));
      reader.onerror = () =>
        reject(reader.error || new Error("Video header could not be read."));
      reader.readAsArrayBuffer(header);
    });
  }
  throw new Error("Video header could not be read.");
};

const normalizeMp4Blob = async (blob: Blob): Promise<Blob> => {
  if (blob.size < 12) {
    throw new Error("Video is incomplete and cannot be saved.");
  }
  const header = await readBlobHeader(blob);
  const isMp4 =
    header.length >= 8 &&
    header[4] === 0x66 &&
    header[5] === 0x74 &&
    header[6] === 0x79 &&
    header[7] === 0x70;
  if (!isMp4) {
    throw new Error("Video download did not contain playable MP4 media.");
  }
  return blob.type.toLowerCase() === "video/mp4"
    ? blob
    : blob.slice(0, blob.size, "video/mp4");
};

/**
 * Let the browser decode the exact generated clip before an output is labeled
 * ready. An MP4 header alone cannot prove its orientation, pixels, or length.
 */
export const validateVideoMetadata = (
  source: string | Blob,
  expected: ExpectedVideoMetadata,
  timeoutMs = 15_000,
): Promise<ValidatedVideoMetadata> => {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") {
    return Promise.reject(
      new Error("Video details cannot be verified in this browser."),
    );
  }

  const video = document.createElement("video");
  const ownedObjectUrl = source instanceof Blob ? URL.createObjectURL(source) : null;
  const sourceUrl = source instanceof Blob ? (ownedObjectUrl as string) : source;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (
      result:
        { ok: true; metadata: ValidatedVideoMetadata } | { ok: false; error: Error },
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("error", handleError);
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.remove();
      if (ownedObjectUrl) URL.revokeObjectURL(ownedObjectUrl);
      if (result.ok) resolve(result.metadata);
      else reject(result.error);
    };
    const handleLoadedMetadata = () => {
      const metadata = {
        width: Number(video.videoWidth),
        height: Number(video.videoHeight),
        durationSeconds: Number(video.duration),
      };
      const durationToleranceSeconds = 0.75;
      if (
        metadata.width !== expected.width ||
        metadata.height !== expected.height ||
        !Number.isFinite(metadata.durationSeconds) ||
        Math.abs(metadata.durationSeconds - expected.durationSeconds) >
          durationToleranceSeconds
      ) {
        finish({
          ok: false,
          error: new Error(
            `Video output did not match ${expected.width}×${expected.height} at ${expected.durationSeconds} seconds. Create it again before sharing.`,
          ),
        });
        return;
      }
      finish({ ok: true, metadata });
    };
    const handleError = () =>
      finish({
        ok: false,
        error: new Error(
          "Video details could not be verified. Create it again before sharing.",
        ),
      });
    const timer = setTimeout(
      () =>
        finish({
          ok: false,
          error: new Error(
            "Video verification timed out. Check the connection and try again.",
          ),
        }),
      Math.max(1, timeoutMs),
    );

    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    // WebKit can defer metadata loading for detached media. Keep the probe
    // connected without affecting layout, focus, or the visible preview.
    video.setAttribute("aria-hidden", "true");
    video.tabIndex = -1;
    video.style.cssText =
      "position:absolute;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;";
    document.body.appendChild(video);
    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("error", handleError);
    video.src = sourceUrl;
    video.load();
  });
};

export const downloadPreparedMediaFile = (
  file: File,
  filename: string = file.name,
): boolean => {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") {
    return false;
  }
  let objectUrl: string | null = null;
  try {
    objectUrl = URL.createObjectURL(file);
    triggerDownload(objectUrl, filename);
  } catch (error) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    console.warn("[mediaSave] download could not start", error);
    return false;
  }
  const downloadUrl = objectUrl;
  setTimeout(() => URL.revokeObjectURL(downloadUrl), DOWNLOAD_URL_REVOKE_DELAY_MS);
  return true;
};

/**
 * Invoke Web Share immediately, before any asynchronous boundary.
 *
 * WebKit has shipped versions where `navigator.share()` returns `undefined`
 * when activation is missing, and versions where the promise never settles
 * after saving to Photos. Treat the former as unavailable and bound the latter
 * so the app cannot remain stuck in a busy state.
 */
export const invokeWebShareNow = (
  shareData: ShareData,
  timeoutMs: number = WEB_SHARE_SETTLE_TIMEOUT_MS,
): Promise<WebShareAttempt> => {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") {
    return Promise.resolve({ kind: "unavailable" });
  }

  let shareResult: Promise<void> | undefined;
  try {
    shareResult = (
      navigator.share as unknown as (data?: ShareData) => Promise<void> | undefined
    )(shareData);
  } catch (error) {
    return Promise.resolve({ kind: "unavailable", error });
  }

  if (!shareResult || typeof shareResult.then !== "function") {
    return Promise.resolve({
      kind: "unavailable",
      error: new Error("The browser did not start the share sheet."),
    });
  }

  return new Promise<WebShareAttempt>((resolve) => {
    let settled = false;
    const finish = (result: WebShareAttempt) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish({ kind: "started" }), Math.max(1, timeoutMs));
    void Promise.resolve(shareResult).then(
      () => finish({ kind: "completed" }),
      (error: unknown) => {
        if ((error as DOMException)?.name === "AbortError") {
          finish({ kind: "cancelled" });
          return;
        }
        finish({ kind: "unavailable", error });
      },
    );
  });
};

export const prepareMediaForSave = async (options: {
  sourceUrl: string | Blob;
  kind: SaveMediaKind;
  basename?: string;
}): Promise<PreparedMediaSave> => {
  const kind = options.kind;
  const requestedBasename = options.basename || "dealer-social-post";
  const basename = safeBasename(requestedBasename);
  const blobSourceName =
    options.sourceUrl instanceof File ? options.sourceUrl.name : undefined;
  const untypedHeifExtension =
    options.sourceUrl instanceof Blob && !options.sourceUrl.type
      ? heifExtensionFromName(blobSourceName) ||
        heifExtensionFromName(requestedBasename)
      : null;
  const filename =
    kind === "video"
      ? `${basename}.mp4`
      : `${basename}.${
          options.sourceUrl instanceof Blob
            ? options.sourceUrl.type === "image/png"
              ? "png"
              : options.sourceUrl.type === "image/webp"
                ? "webp"
                : options.sourceUrl.type === "image/heic"
                  ? "heic"
                  : options.sourceUrl.type === "image/heif"
                    ? "heif"
                    : untypedHeifExtension
                      ? untypedHeifExtension
                      : "jpg"
            : imageFileExtension(options.sourceUrl)
        }`;
  let blob = await sourceToBlob(options.sourceUrl);
  if (!blob || blob.size === 0) {
    throw new Error("Nothing to save — media is empty.");
  }
  if (kind === "video") {
    blob = await normalizeMp4Blob(blob);
  }
  return {
    kind,
    filename,
    file: blobToFile(blob, filename, kind),
  };
};

/**
 * Use only with media prepared before the click. `navigator.share()` is called
 * synchronously, before the first await, so WebKit keeps transient activation.
 */
export const savePreparedMediaToLibrary = async (
  prepared: PreparedMediaSave,
): Promise<SaveMediaResult> => {
  const { file, filename, kind } = prepared;
  const mobile = isMobilePhotoDevice();

  if (
    mobile &&
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function"
  ) {
    // File-only payloads surface Photos and media apps more reliably in
    // WebKit. Adding text can make a valid MP4 unshareable on iOS.
    const shareData: ShareData = { files: [file] };
    try {
      const canShareFiles =
        typeof navigator.canShare !== "function" || navigator.canShare(shareData);
      if (canShareFiles) {
        // `invokeWebShareNow` calls navigator.share synchronously.
        const attempt = await invokeWebShareNow(shareData);
        if (attempt.kind === "completed") return { method: "photos-share", kind };
        if (attempt.kind === "started") return { method: "photos-share-pending", kind };
        if (attempt.kind === "cancelled") {
          return { method: "cancelled", kind };
        }
        if (attempt.error) {
          console.warn(
            "[mediaSave] share failed; falling back to download",
            attempt.error,
          );
        }
      }
    } catch (err) {
      console.warn("[mediaSave] share failed; falling back to download", err);
    }
  }

  if (!downloadPreparedMediaFile(file, filename)) {
    return {
      method: "error",
      kind,
      message: "The browser could not start the media download.",
    };
  }
  return { method: "download", kind };
};

/**
 * Prefer system share (Save to Photos) on phones; download on desktop / fallback.
 */
export const saveMediaToLibrary = async (options: {
  sourceUrl: string;
  kind: SaveMediaKind;
  /** Base name without extension for images; videos use .mp4 */
  basename?: string;
}): Promise<SaveMediaResult> => {
  try {
    return await savePreparedMediaToLibrary(await prepareMediaForSave(options));
  } catch (err) {
    return {
      method: "error",
      kind: options.kind,
      message: err instanceof Error ? err.message : String(err),
    };
  }
};

export const saveResultToastMessage = (result: SaveMediaResult): string => {
  switch (result.method) {
    case "photos-share-pending":
      return "The save sheet opened, but saving is not confirmed. Keep this screen open until your file is saved.";
    case "photos-share":
      return result.kind === "video"
        ? "Share sheet opened — tap Save Video to add it to your Photos library."
        : "Share sheet opened — tap Save Image to add it to your Photos library.";
    case "download":
      return result.kind === "video"
        ? "Video downloaded. On a phone, open the file and use Share → Save Video if it is not in Photos yet."
        : "Image downloaded. On a phone, open the file and use Share → Save Image if it is not in Photos yet.";
    case "cancelled":
      return "Save cancelled.";
    case "error":
      return result.message || "Could not save media.";
  }
};
