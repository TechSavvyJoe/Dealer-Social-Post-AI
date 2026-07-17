/**
 * Multi-format export for dealership social creatives.
 *
 * Same designed post → platform canvas sizes:
 *  - 1:1     1080×1080  Facebook / Instagram Feed
 *  - 9:16    1080×1920  IG Story, Reels, TikTok, Shorts
 *  - 1.91:1  1200×628   Facebook Marketplace / OG
 *  - 4:3     1200×900   Google Business Profile
 *
 * Fit mode is CONTAIN (letterbox), not cover-crop. Cover was chopping store
 * nameplates, logos, and faces on fun-mode / branded posts. Empty space is
 * filled with a blurred, darkened copy of the creative so the frame still
 * looks like a premium social asset rather than a hard black bar.
 */

export type ExportFormatId =
  | "feed_square"
  | "story_vertical"
  | "marketplace"
  | "gbp";

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
    description: "IG Story, Reels, TikTok, YouTube Shorts",
  },
  {
    id: "feed_square",
    label: "Feed (1:1)",
    filename: "post-feed-1x1.jpg",
    width: 1080,
    height: 1080,
    description: "Instagram Feed, Facebook Feed",
  },
  {
    id: "marketplace",
    label: "Marketplace (1.91:1)",
    filename: "post-marketplace-191x1.jpg",
    width: 1200,
    height: 628,
    description: "Facebook Marketplace, link previews",
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

/** Pure layout helper — contain (letterbox), never cover-crop. */
export const computeContainRect = (
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): { drawW: number; drawH: number; dx: number; dy: number; scale: number } => {
  const scale = Math.min(dstW / srcW, dstH / srcH);
  const drawW = Math.round(srcW * scale);
  const drawH = Math.round(srcH * scale);
  const dx = Math.round((dstW - drawW) / 2);
  const dy = Math.round((dstH - drawH) / 2);
  return { drawW, drawH, dx, dy, scale };
};

/**
 * Draw the full creative into the target canvas using contain + soft blur pad.
 * Never crops store text, faces, or vehicle out of the designed post.
 */
export const renderFormat = async (
  sourceDataUrl: string,
  format: ExportFormat,
): Promise<string> => {
  const img = await loadImage(sourceDataUrl);

  const canvas = document.createElement("canvas");
  canvas.width = format.width;
  canvas.height = format.height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  const { drawW, drawH, dx, dy } = computeContainRect(
    img.width,
    img.height,
    format.width,
    format.height,
  );

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // Soft premium backdrop: cover-fill with the source, blur, darken.
  // Falls back to near-black if filter is unsupported.
  try {
    const coverScale = Math.max(
      format.width / img.width,
      format.height / img.height,
    );
    const bgW = Math.round(img.width * coverScale * 1.08);
    const bgH = Math.round(img.height * coverScale * 1.08);
    const bgX = Math.round((format.width - bgW) / 2);
    const bgY = Math.round((format.height - bgH) / 2);
    ctx.save();
    ctx.filter = "blur(28px) brightness(0.45) saturate(1.05)";
    ctx.drawImage(img, bgX, bgY, bgW, bgH);
    ctx.restore();
  } catch {
    ctx.fillStyle = "#0a0a0c";
    ctx.fillRect(0, 0, format.width, format.height);
  }

  // Subtle vignette so the letterbox edges feel intentional
  const vignette = ctx.createRadialGradient(
    format.width / 2,
    format.height / 2,
    Math.min(format.width, format.height) * 0.25,
    format.width / 2,
    format.height / 2,
    Math.max(format.width, format.height) * 0.7,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, format.width, format.height);

  // Full creative, uncropped
  ctx.drawImage(img, dx, dy, drawW, drawH);

  // Hairline edge on the creative plate so it reads as a placed asset
  if (drawW < format.width - 2 || drawH < format.height - 2) {
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.strokeRect(dx + 0.5, dy + 0.5, drawW - 1, drawH - 1);
  }

  return canvas.toDataURL("image/jpeg", 0.93);
};

/**
 * Renders all four formats in parallel and returns them keyed by id.
 */
export const renderAllFormats = async (
  sourceDataUrl: string,
): Promise<Record<ExportFormatId, string>> => {
  const entries = await Promise.all(
    EXPORT_FORMATS.map(
      async (f) => [f.id, await renderFormat(sourceDataUrl, f)] as const,
    ),
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
 * gesture, so we space them out 250ms apart.
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
