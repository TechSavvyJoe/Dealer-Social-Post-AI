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

export interface PreparedMediaSave {
  kind: SaveMediaKind;
  file: File;
  filename: string;
}

export type SaveMediaResult =
  | { method: "photos-share"; kind: SaveMediaKind }
  | { method: "download"; kind: SaveMediaKind }
  | { method: "cancelled"; kind: SaveMediaKind }
  | { method: "error"; kind: SaveMediaKind; message: string };

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
  const res = await fetch(sourceUrl);
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

export const downloadPreparedMediaFile = (
  file: File,
  filename: string = file.name,
): boolean => {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") {
    return false;
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    triggerDownload(objectUrl, filename);
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    console.warn("[mediaSave] download could not start", error);
    return false;
  }
  setTimeout(() => URL.revokeObjectURL(objectUrl), DOWNLOAD_URL_REVOKE_DELAY_MS);
  return true;
};

export const prepareMediaForSave = async (options: {
  sourceUrl: string | Blob;
  kind: SaveMediaKind;
  basename?: string;
}): Promise<PreparedMediaSave> => {
  const kind = options.kind;
  const requestedBasename = options.basename || "dealer-social-post";
  const basename = requestedBasename.replace(/\.[a-z0-9]+$/i, "");
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
    const shareData: ShareData = {
      files: [file],
      title: kind === "video" ? "Save video to Photos" : "Save photo to Photos",
      text:
        kind === "video"
          ? "Save this video to your photo library"
          : "Save this photo to your photo library",
    };
    try {
      const canShareFiles =
        typeof navigator.canShare !== "function" ||
        navigator.canShare({ files: [file] });
      if (canShareFiles) {
        const sharePromise = navigator.share(shareData);
        await sharePromise;
        return { method: "photos-share", kind };
      }
    } catch (err) {
      const name = (err as DOMException)?.name;
      if (name === "AbortError") {
        return { method: "cancelled", kind };
      }
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
