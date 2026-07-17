/**
 * Publish target registry.
 *
 * Each "publish target" knows:
 *  - what dimensions / aspect ratio the receiving platform prefers
 *  - what caption-length budget it has
 *  - how to actually publish to it
 *
 * Today every target's `publish()` falls back to the Web Share API plus a
 * platform-specific deep link / web-intent URL. The signature is shaped so a
 * future direct integration (Meta Business API, TikTok Content Posting API,
 * Google Business Profile API) slips in by swapping ONE function — the rest
 * of the app keeps calling `publish(targetId, content)` and doesn't care
 * whether it goes through the share sheet or an OAuth-backed API.
 */
import { ExportFormatId, renderFormat, EXPORT_FORMATS } from "../utils/multiFormatExport";
import { dataUrlToBlob } from "../utils/imageUtils";
import { fitCaptionToBudget } from "../utils/hashtags";

export type PublishStatus =
  | { kind: "shared"; via: "web-share" | "direct-api" }
  | { kind: "fallback"; via: "url-intent" | "download-copy"; message: string }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

export interface PublishContent {
  /** Final caption text with disclosures already appended. */
  text: string;
  /** Hashtags as a single space-separated string (may already be in `text`). */
  hashtags?: string;
  /** Source generated image as data URL (or http URL). */
  imageDataUrl?: string;
  /** Optional rendered video as a blob URL. */
  videoUrl?: string;
}

export interface PublishTarget {
  id: string;
  label: string;
  /** Lucide icon name (rendered by the dialog). */
  icon: "facebook" | "instagram" | "music" | "globe" | "twitter" | "linkedin" | "share2";
  /** Color used for the platform's tile glow. Reads like the brand. */
  accent: string;
  /** Which canvas format from multiFormatExport to render for this platform. */
  format: ExportFormatId;
  /** Max recommended caption length on this platform. */
  charBudget: number;
  /** Whether the platform accepts video shares well. */
  supportsVideo: boolean;
  /** Whether direct-API publishing is wired today. (All false right now.) */
  directApiConnected: boolean;
  /** Short "what happens when you tap this" copy for the tile. */
  hint: string;
  /**
   * Web fallback URL when Web Share API is unavailable. `{text}` and `{url}`
   * placeholders get substituted. Some platforms (IG, TikTok) have no useful
   * web fallback — those return null and we fall back to a copy-to-clipboard
   * + download workflow.
   */
  webIntentUrl?: (content: PublishContent) => string | null;
}

/** Dealership-first order: Instagram, Facebook, TikTok, Google — then secondary. */
export const PUBLISH_TARGETS: PublishTarget[] = [
  {
    id: "instagram_feed",
    label: "Instagram Feed",
    icon: "instagram",
    accent: "#E1306C",
    format: "feed_square",
    charBudget: 2200,
    supportsVideo: true,
    directApiConnected: false,
    hint: "1:1 image · caption auto-copied · share to IG app",
    webIntentUrl: () => "https://www.instagram.com/",
  },
  {
    id: "instagram_story",
    label: "Instagram Story",
    icon: "instagram",
    accent: "#C13584",
    format: "story_vertical",
    charBudget: 2200,
    supportsVideo: true,
    directApiConnected: false,
    hint: "9:16 image or video · share to IG Stories",
    webIntentUrl: () => "https://www.instagram.com/",
  },
  {
    id: "facebook_feed",
    label: "Facebook",
    icon: "facebook",
    accent: "#1877F2",
    format: "feed_square",
    charBudget: 63206,
    supportsVideo: true,
    directApiConnected: false,
    hint: "Facebook feed · caption copied · open FB app or site to paste",
    // Quote-only sharer.php is unreliable without a public URL. Open Facebook
    // and rely on clipboard caption + downloaded image (same path as IG).
    webIntentUrl: () => "https://www.facebook.com/",
  },
  {
    id: "tiktok",
    label: "TikTok",
    icon: "music",
    accent: "#FF0050",
    format: "story_vertical",
    charBudget: 2200,
    supportsVideo: true,
    directApiConnected: false,
    hint: "9:16 video preferred · share to TikTok",
    webIntentUrl: () => "https://www.tiktok.com/upload",
  },
  {
    id: "gbp",
    label: "Google Business",
    icon: "globe",
    accent: "#4285F4",
    format: "gbp",
    charBudget: 1500,
    supportsVideo: false,
    directApiConnected: false,
    hint: "4:3 image · post to your GBP profile",
    webIntentUrl: () => "https://business.google.com/posts/",
  },
  {
    id: "marketplace",
    label: "FB Marketplace",
    icon: "facebook",
    accent: "#1877F2",
    format: "marketplace",
    charBudget: 9999,
    supportsVideo: false,
    directApiConnected: false,
    hint: "1.91:1 image · best for listings · share sheet",
    webIntentUrl: () => "https://www.facebook.com/marketplace/create/item/",
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    icon: "linkedin",
    accent: "#0A66C2",
    format: "feed_square",
    charBudget: 3000,
    supportsVideo: false,
    directApiConnected: false,
    hint: "1:1 image · share intent",
    webIntentUrl: (c) =>
      `https://www.linkedin.com/shareArticle?mini=true&summary=${encodeURIComponent(c.text)}`,
  },
  {
    id: "x_twitter",
    label: "X / Twitter",
    icon: "twitter",
    accent: "#1DA1F2",
    format: "feed_square",
    charBudget: 280,
    supportsVideo: true,
    directApiConnected: false,
    hint: "Optional · most dealerships skip X · 280-char limit",
    webIntentUrl: (c) =>
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(
        fitCaptionToBudget(c.text, 280),
      )}`,
  },
  {
    id: "native_share",
    label: "More…",
    icon: "share2",
    accent: "#94a3b8",
    format: "feed_square",
    charBudget: 4000,
    supportsVideo: true,
    directApiConnected: false,
    hint: "Native share sheet — pick any app installed on your device",
    webIntentUrl: () => null,
  },
];

/**
 * Always-on core share destinations for dealerships.
 * Facebook is intentionally included so it never gets buried or filtered out.
 */
export const CORE_PUBLISH_IDS = [
  "instagram_feed",
  "facebook_feed",
  "tiktok",
] as const;

/**
 * Order targets for Share UI:
 * 1) Core dealer channels (IG Feed, Facebook, TikTok) — always first
 * 2) Other platforms the user selected at generate time
 * 3) Remaining destinations
 * 4) Native "More…" last
 */
export const orderPublishTargets = (
  selectedPlatformIds?: string[] | null,
): PublishTarget[] => {
  const selected = new Set((selectedPlatformIds || []).filter(Boolean));
  const byId = new Map(PUBLISH_TARGETS.map((t) => [t.id, t]));
  const used = new Set<string>();
  const result: PublishTarget[] = [];

  const push = (id: string) => {
    if (used.has(id) || id === "native_share") return;
    const t = byId.get(id);
    if (!t) return;
    used.add(id);
    result.push(t);
  };

  for (const id of CORE_PUBLISH_IDS) push(id);
  for (const id of selected) push(id);
  for (const t of PUBLISH_TARGETS) {
    if (t.id === "native_share") continue;
    push(t.id);
  }
  const more = byId.get("native_share");
  if (more) result.push(more);
  return result;
};

const findTarget = (id: string): PublishTarget | undefined =>
  PUBLISH_TARGETS.find((t) => t.id === id);

const copyTextToClipboard = async (text: string): Promise<boolean> => {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy approach */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
};

const triggerDownload = (url: string, filename: string) => {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

/**
 * Publish via the appropriate path for this target.
 *
 * Strategy:
 *   1. If the target has a direct API integration wired (none today), use it.
 *   2. Otherwise, render the platform-specific format, build the right file,
 *      copy the caption to clipboard, and try `navigator.share()` with the
 *      file. iOS/Android open the system share sheet and the user picks
 *      the target app — the app receives the file + text.
 *   3. If Web Share isn't supported or fails, fall back to the platform's web
 *      intent URL (opens FB sharer / Twitter intent / GBP composer in a new
 *      tab) plus a downloaded image + clipboard caption so the user can
 *      paste manually.
 */
export const publishTo = async (
  targetId: string,
  content: PublishContent
): Promise<PublishStatus> => {
  const target = findTarget(targetId);
  if (!target) return { kind: "error", message: "Unknown publish target" };

  try {
    // Render the platform-specific image. The "native share" target uses the
    // square fallback unless we have a video.
    let formatId = target.format;
    let file: File | null = null;

    if (target.supportsVideo && content.videoUrl) {
      try {
        const res = await fetch(content.videoUrl);
        const blob = await res.blob();
        file = new File([blob], `dealer-social-post-${target.id}.mp4`, {
          type: blob.type || "video/mp4",
        });
      } catch {
        /* fall back to image */
      }
    }

    if (!file && content.imageDataUrl) {
      const fmt = EXPORT_FORMATS.find((f) => f.id === formatId);
      if (fmt) {
        const formatted = await renderFormat(content.imageDataUrl, fmt);
        const blob = await dataUrlToBlob(formatted);
        file = new File([blob], `dealer-social-post-${target.id}.jpg`, {
          type: "image/jpeg",
        });
      }
    }

    // Fit caption to platform budget (drop hashtags first — never mid-tag cut).
    const captionForShare = fitCaptionToBudget(
      content.text,
      target.charBudget,
    );
    await copyTextToClipboard(captionForShare);

    // Prefer fitted text for intents as well
    content = { ...content, text: captionForShare };

    // Attempt Web Share API
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.share === "function"
    ) {
      const shareData: ShareData = {
        title: target.label,
        text: captionForShare,
        ...(file ? { files: [file] } : {}),
      };
      try {
        if (
          file &&
          typeof (navigator as any).canShare === "function" &&
          !(navigator as any).canShare({ files: [file] })
        ) {
          // canShare says no, drop files and try text-only
          delete (shareData as any).files;
        }
        await navigator.share(shareData);
        return { kind: "shared", via: "web-share" };
      } catch (err) {
        // AbortError = user cancelled the share sheet
        const name = (err as DOMException)?.name;
        if (name === "AbortError") {
          return { kind: "cancelled" };
        }
        // Otherwise fall through to URL/download fallback
      }
    }

    // Fallback path — open the platform's web intent URL if any, download
    // the file, and rely on the clipboard text for the caption.
    if (file) {
      const dlUrl = URL.createObjectURL(file);
      triggerDownload(dlUrl, file.name);
      setTimeout(() => URL.revokeObjectURL(dlUrl), 4000);
    }
    const intent = target.webIntentUrl?.(content);
    if (intent) {
      window.open(intent, "_blank", "noopener,noreferrer");
      return {
        kind: "fallback",
        via: "url-intent",
        message: `Opened ${target.label} in a new tab. Caption is on your clipboard, image was downloaded.`,
      };
    }
    return {
      kind: "fallback",
      via: "download-copy",
      message: `Image downloaded and caption copied. Paste them into ${target.label} manually.`,
    };
  } catch (err) {
    return {
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
};
