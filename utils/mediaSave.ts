/**
 * Save generated images/videos toward the device photo library.
 *
 * Browsers cannot write silently to Photos/Gallery (OS security). On phones the
 * reliable path is Web Share with a real File: iOS/Android then offer
 * "Save Image" / "Save Video" / Photos. Desktop falls back to a file download.
 */
import { dataUrlToBlob, imageFileExtension } from "./imageUtils";

export type SaveMediaKind = "image" | "video";

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

const blobToFile = (blob: Blob, filename: string, kind: SaveMediaKind): File => {
  const type =
    kind === "video"
      ? blob.type.startsWith("video/")
        ? blob.type
        : "video/mp4"
      : blob.type.startsWith("image/")
        ? blob.type
        : "image/jpeg";
  return new File([blob], filename, { type });
};

const sourceToBlob = async (sourceUrl: string): Promise<Blob> => {
  if (sourceUrl.startsWith("data:")) {
    return dataUrlToBlob(sourceUrl);
  }
  const res = await fetch(sourceUrl);
  if (!res.ok) {
    throw new Error(`Could not read media (${res.status}).`);
  }
  return res.blob();
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
  const kind = options.kind;
  const basename = (options.basename || "dealer-social-post").replace(
    /\.[a-z0-9]+$/i,
    "",
  );
  const filename =
    kind === "video"
      ? `${basename}.mp4`
      : `${basename}.${imageFileExtension(options.sourceUrl)}`;

  try {
    const blob = await sourceToBlob(options.sourceUrl);
    if (!blob || blob.size === 0) {
      return {
        method: "error",
        kind,
        message: "Nothing to save — media is empty.",
      };
    }
    const file = blobToFile(blob, filename, kind);
    const mobile = isMobilePhotoDevice();

    // Phone path: share sheet → Save Image / Save Video → Photos library
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
          await navigator.share(shareData);
          return { method: "photos-share", kind };
        }
      } catch (err) {
        const name = (err as DOMException)?.name;
        if (name === "AbortError") {
          return { method: "cancelled", kind };
        }
        // Fall through to download if share fails (unsupported file, etc.)
        console.warn("[mediaSave] share failed; falling back to download", err);
      }
    }

    // Desktop / fallback: classic download (Files / Downloads)
    const objectUrl =
      options.sourceUrl.startsWith("blob:") ||
      options.sourceUrl.startsWith("data:")
        ? options.sourceUrl.startsWith("blob:")
          ? options.sourceUrl
          : URL.createObjectURL(file)
        : URL.createObjectURL(file);

    const createdTemp =
      objectUrl !== options.sourceUrl && objectUrl.startsWith("blob:");
    try {
      triggerDownload(objectUrl, filename);
    } finally {
      if (createdTemp) {
        setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
      }
    }
    return { method: "download", kind };
  } catch (err) {
    return {
      method: "error",
      kind,
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
