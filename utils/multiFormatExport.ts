/**
 * Multi-format export for dealership social creatives.
 *
 * Same designed post → platform canvas sizes:
 *  - 1:1     1080×1080  Facebook / Instagram Feed
 *  - 9:16    1080×1920  IG Story, Reels, TikTok, Shorts
 *  - 1.91:1  1200×628   Facebook Marketplace / OG
 *  - 4:3     1200×900   Google Business Profile
 *
 * Strategy: CONTAIN the full creative (never crop store text / faces), and
 * fill empty margins with a blurred cover of the same image — not hard black
 * bars. Blur is implemented via downscale/upscale (reliable across browsers;
 * ctx.filter blur is flaky with data-URL sources).
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
  const scale = Math.min(dstW / Math.max(srcW, 1), dstH / Math.max(srcH, 1));
  const drawW = Math.round(srcW * scale);
  const drawH = Math.round(srcH * scale);
  const dx = Math.round((dstW - drawW) / 2);
  const dy = Math.round((dstH - drawH) / 2);
  return { drawW, drawH, dx, dy, scale };
};

/** Cover layout — fills the frame (used only for the blurred backdrop). */
export const computeCoverRect = (
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): { drawW: number; drawH: number; dx: number; dy: number } => {
  const scale = Math.max(dstW / Math.max(srcW, 1), dstH / Math.max(srcH, 1)) * 1.12;
  const drawW = Math.round(srcW * scale);
  const drawH = Math.round(srcH * scale);
  const dx = Math.round((dstW - drawW) / 2);
  const dy = Math.round((dstH - drawH) / 2);
  return { drawW, drawH, dx, dy };
};

/**
 * Reliable soft blur fill: draw cover image to a tiny canvas, then scale up.
 * Avoids ctx.filter which often fails on data-URL creatives and leaves black.
 */
const drawBlurredCoverBackground = (
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dstW: number,
  dstH: number,
): void => {
  // Base tone from a sample so edges never look pure black even if blur fails
  try {
    const sample = document.createElement("canvas");
    sample.width = 8;
    sample.height = 8;
    const sctx = sample.getContext("2d");
    if (sctx) {
      sctx.drawImage(img, 0, 0, 8, 8);
      const data = sctx.getImageData(0, 0, 8, 8).data;
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        n++;
      }
      if (n > 0) {
        r = Math.round((r / n) * 0.35);
        g = Math.round((g / n) * 0.35);
        b = Math.round((b / n) * 0.35);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(0, 0, dstW, dstH);
      }
    }
  } catch {
    ctx.fillStyle = "#1a1520";
    ctx.fillRect(0, 0, dstW, dstH);
  }

  // Downscale heavily, then upscale = soft blur without CSS filter
  const tiny = document.createElement("canvas");
  const tinyW = Math.max(24, Math.round(dstW / 32));
  const tinyH = Math.max(24, Math.round(dstH / 32));
  tiny.width = tinyW;
  tiny.height = tinyH;
  const tctx = tiny.getContext("2d");
  if (!tctx) return;

  const cover = computeCoverRect(img.width, img.height, tinyW, tinyH);
  tctx.imageSmoothingEnabled = true;
  tctx.imageSmoothingQuality = "low";
  tctx.drawImage(img, cover.dx, cover.dy, cover.drawW, cover.drawH);

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.globalAlpha = 1;
  ctx.drawImage(tiny, 0, 0, dstW, dstH);
  // Darken so the sharp creative plate pops
  ctx.fillStyle = "rgba(0,0,0,0.42)";
  ctx.fillRect(0, 0, dstW, dstH);
  ctx.restore();
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

  // Always paint a premium fill first (never leave default transparent → black JPEG)
  drawBlurredCoverBackground(ctx, img, format.width, format.height);

  // Soft vignette toward edges
  const vignette = ctx.createRadialGradient(
    format.width / 2,
    format.height / 2,
    Math.min(format.width, format.height) * 0.2,
    format.width / 2,
    format.height / 2,
    Math.max(format.width, format.height) * 0.72,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.28)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, format.width, format.height);

  // Full creative, uncropped — centered
  ctx.drawImage(img, dx, dy, drawW, drawH);

  // Soft shadow plate under the creative for depth when letterboxed
  if (drawW < format.width - 4 || drawH < format.height - 4) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 8;
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 2;
    ctx.strokeRect(dx + 1, dy + 1, drawW - 2, drawH - 2);
    ctx.restore();
  }

  return canvas.toDataURL("image/jpeg", 0.94);
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
