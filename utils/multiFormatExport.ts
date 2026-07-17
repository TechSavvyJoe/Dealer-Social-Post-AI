/**
 * Multi-format export.
 *
 * Same source image, four target aspect ratios sized for the four places
 * dealerships actually post:
 *
 *  - 1:1     1080×1080  Facebook Feed / Instagram Feed
 *  - 9:16    1080×1920  IG Story, IG Reels, TikTok, YouTube Shorts
 *  - 1.91:1  1200×628   Facebook Marketplace listing thumbnail
 *  - 4:3     1200×900   Google Business Profile post
 *
 * The source image is "object-fit: cover"-style center-cropped onto each canvas
 * so the subject (car) stays centered. A subtle padding stripe is added to the
 * 9:16 variant when the source is landscape, to avoid clipping the vehicle.
 */

export type ExportFormatId = "feed_square" | "story_vertical" | "marketplace" | "gbp";

export interface ExportFormat {
  id: ExportFormatId;
  label: string;
  filename: string;
  width: number;
  height: number;
  description: string;
}

/** Story/vertical first — most salesperson traffic is phone Stories/Reels. */
export const EXPORT_FORMATS: ExportFormat[] = [
  {
    id: "story_vertical",
    label: "Story / Reel (9:16)",
    filename: "post-story-9x16.jpg",
    width: 1080,
    height: 1920,
    description: "IG Story, IG Reels, TikTok, YouTube Shorts — recommended",
  },
  {
    id: "feed_square",
    label: "Feed (1:1)",
    filename: "post-feed-1x1.jpg",
    width: 1080,
    height: 1080,
    description: "Facebook Feed, Instagram Feed",
  },
  {
    id: "marketplace",
    label: "Marketplace (1.91:1)",
    filename: "post-marketplace-191x1.jpg",
    width: 1200,
    height: 628,
    description: "Facebook Marketplace, OG image",
  },
  {
    id: "gbp",
    label: "Google Business (4:3)",
    filename: "post-gbp-4x3.jpg",
    width: 1200,
    height: 900,
    description: "Google Business Profile post",
  },
];

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error("Could not load source image for multi-format export"));
    img.src = src;
  });

/**
 * Renders the source image onto a canvas of the given format with a center-
 * cropped "cover" fit. Returns a data URL (JPEG, quality 0.9).
 */
export const renderFormat = async (
  sourceDataUrl: string,
  format: ExportFormat
): Promise<string> => {
  const img = await loadImage(sourceDataUrl);

  const canvas = document.createElement("canvas");
  canvas.width = format.width;
  canvas.height = format.height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  // Fill with black so vertical letterboxes look intentional on landscape sources.
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, format.width, format.height);

  const srcAspect = img.width / img.height;
  const dstAspect = format.width / format.height;

  let drawW: number;
  let drawH: number;
  let dx: number;
  let dy: number;

  if (srcAspect > dstAspect) {
    // Source is wider than target → match height, crop sides
    drawH = format.height;
    drawW = format.height * srcAspect;
    dx = (format.width - drawW) / 2;
    dy = 0;
  } else {
    // Source is taller than (or equal to) target → match width, crop top/bottom
    drawW = format.width;
    drawH = format.width / srcAspect;
    dx = 0;
    dy = (format.height - drawH) / 2;
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, dx, dy, drawW, drawH);

  return canvas.toDataURL("image/jpeg", 0.9);
};

/**
 * Renders all four formats in parallel and returns them keyed by id.
 */
export const renderAllFormats = async (
  sourceDataUrl: string
): Promise<Record<ExportFormatId, string>> => {
  const entries = await Promise.all(
    EXPORT_FORMATS.map(async (f) => [f.id, await renderFormat(sourceDataUrl, f)] as const)
  );
  return Object.fromEntries(entries) as Record<ExportFormatId, string>;
};

const triggerDownload = (dataUrl: string, filename: string): void => {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

/**
 * Downloads formats. Browsers throttle multiple downloads from a single user
 * gesture, so we space them out 250ms apart — reliable in Chrome, Edge,
 * Safari, and Firefox.
 * @param formatIds optional subset; defaults to all four export sizes
 */
export const downloadAllFormats = async (
  sourceDataUrl: string,
  formatIds?: ExportFormatId[],
): Promise<void> => {
  const rendered = await renderAllFormats(sourceDataUrl);
  const formats =
    formatIds && formatIds.length > 0
      ? formatIds
          .map((id) => EXPORT_FORMATS.find((f) => f.id === id))
          .filter((f): f is ExportFormat => Boolean(f))
      : EXPORT_FORMATS;
  for (let i = 0; i < formats.length; i++) {
    const fmt = formats[i];
    triggerDownload(rendered[fmt.id], fmt.filename);
    if (i < formats.length - 1) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
};
