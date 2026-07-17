/**
 * Publish target registry + handoff strategies.
 *
 * Important platform realities (especially Apple Share Sheet):
 *  - Browsers cannot auto-fill captions into Facebook / Instagram / TikTok.
 *    We always copy the caption to the clipboard so the salesperson can Paste.
 *  - Facebook (and often Marketplace) rarely appear in Safari/PWA share sheets
 *    for web-originated image files — Meta does not register for those UTIs the
 *    way Messages/Mail/Photos do. Relying on the share sheet makes FB look "missing".
 *  - Instagram / TikTok more often appear for image/video file shares; caption
 *    still must be pasted manually after the media lands in the app.
 *
 * Direct API publishing (Meta Graph, TikTok Content Posting, GBP) is still
 * stubbed — swap only the publish path when OAuth is wired.
 */
import { ExportFormatId, renderFormat, EXPORT_FORMATS } from "../utils/multiFormatExport";
import { dataUrlToBlob } from "../utils/imageUtils";
import { fitCaptionToBudget } from "../utils/hashtags";

export type PublishStatus =
  | {
      kind: "shared";
      via: "web-share" | "direct-api";
      /** Always true today — remind user to paste caption into the app. */
      pasteRequired: boolean;
      message?: string;
    }
  | {
      kind: "fallback";
      via: "url-intent" | "download-copy" | "clipboard-open";
      message: string;
      pasteRequired: boolean;
    }
  | { kind: "cancelled"; pasteRequired: boolean; message?: string }
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

/**
 * How media + caption are handed to the destination app.
 * - clipboard-open: copy caption, save media, open app/site (Facebook — share sheet unreliable)
 * - share-file: system share sheet with media file; caption stays on clipboard for paste
 * - share-any: generic share sheet (More…)
 * - share-or-intent: try share sheet, then web intent URL
 */
export type ShareHandoff =
  | "clipboard-open"
  | "share-file"
  | "share-any"
  | "share-or-intent";

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
  /** How this tile hands off on mobile/desktop browsers. */
  handoff: ShareHandoff;
  /**
   * Optional deep-link tried before the https webIntentUrl on mobile.
   * Fail quietly — deep links are best-effort and not available in all browsers.
   */
  appSchemeUrl?: string;
  /**
   * Web fallback URL when Web Share API is unavailable / skipped.
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
    handoff: "share-file",
    hint: "Photo via share sheet · paste caption in IG",
    appSchemeUrl: "instagram://app",
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
    handoff: "share-file",
    hint: "9:16 via share sheet · Stories may skip caption",
    appSchemeUrl: "instagram://story-camera",
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
    // Facebook almost never appears in Safari/PWA share sheets for web images.
    handoff: "clipboard-open",
    hint: "Caption copied · opens Facebook · paste + add photo",
    appSchemeUrl: "fb://feed",
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
    handoff: "share-file",
    hint: "Media via share sheet · paste caption in TikTok",
    appSchemeUrl: "tiktok://",
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
    handoff: "share-or-intent",
    hint: "4:3 image · caption copied · open GBP posts",
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
    handoff: "clipboard-open",
    hint: "Caption copied · opens Marketplace · paste + photos",
    appSchemeUrl: "fb://marketplace",
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
    handoff: "share-or-intent",
    hint: "1:1 image · paste caption if needed",
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
    handoff: "share-or-intent",
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
    handoff: "share-any",
    hint: "Apple/Android share sheet — apps that support this photo type",
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

export const copyTextToClipboard = async (text: string): Promise<boolean> => {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy approach */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.width = "1px";
    ta.style.height = "1px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
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
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const isAppleTouchDevice = (): boolean => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS desktop UA
  return (
    navigator.platform === "MacIntel" &&
    typeof navigator.maxTouchPoints === "number" &&
    navigator.maxTouchPoints > 1
  );
};

/** Best-effort open of native app scheme, then https. */
const openAppOrWeb = (appScheme: string | undefined, webUrl: string | null) => {
  if (typeof window === "undefined") return;
  if (webUrl) {
    // Prefer https in a new tab — more reliable than app schemes in Safari.
    // Try app scheme first only on touch devices; fall through quickly.
    if (appScheme && isAppleTouchDevice()) {
      try {
        // Hidden iframe avoids navigating the PWA away if scheme fails.
        const iframe = document.createElement("iframe");
        iframe.style.display = "none";
        iframe.src = appScheme;
        document.body.appendChild(iframe);
        window.setTimeout(() => {
          try {
            document.body.removeChild(iframe);
          } catch {
            /* ignore */
          }
        }, 1500);
      } catch {
        /* ignore */
      }
    }
    window.open(webUrl, "_blank", "noopener,noreferrer");
  } else if (appScheme) {
    window.location.href = appScheme;
  }
};

const pasteHintFor = (label: string): string =>
  `Caption is on your clipboard. In ${label}, create the post, then long-press → Paste (or ⌘V / Ctrl+V). Browsers cannot auto-fill Facebook/Instagram captions.`;

/**
 * Try the system share sheet with a media file.
 * On iOS, sharing *files only* (no text) surfaces more image apps (Photos, IG).
 * Caption is never auto-injected by Meta apps — clipboard is the paste path.
 */
const tryWebShareFile = async (
  file: File | null,
  caption: string,
  title: string,
  opts: { includeText: boolean },
): Promise<"shared" | "cancelled" | "unavailable"> => {
  if (
    typeof navigator === "undefined" ||
    typeof navigator.share !== "function"
  ) {
    return "unavailable";
  }

  const shareData: ShareData = {
    title,
  };
  if (opts.includeText) {
    shareData.text = caption;
  }
  if (file) {
    try {
      if (
        typeof navigator.canShare === "function" &&
        !navigator.canShare({ files: [file] })
      ) {
        // File share not supported — text-only if allowed
        if (opts.includeText) {
          await navigator.share({ title, text: caption });
          return "shared";
        }
        return "unavailable";
      }
      shareData.files = [file];
    } catch {
      if (!opts.includeText) return "unavailable";
    }
  } else if (opts.includeText) {
    shareData.text = caption;
  } else {
    return "unavailable";
  }

  try {
    await navigator.share(shareData);
    // Re-copy after share sheet closes — some iOS sessions leave clipboard stale
    // or the user still needs paste after attaching media in the destination app.
    await copyTextToClipboard(caption);
    return "shared";
  } catch (err) {
    const name = (err as DOMException)?.name;
    if (name === "AbortError") return "cancelled";
    return "unavailable";
  }
};

const buildShareFile = async (
  target: PublishTarget,
  content: PublishContent,
): Promise<File | null> => {
  if (target.supportsVideo && content.videoUrl) {
    try {
      const res = await fetch(content.videoUrl);
      const blob = await res.blob();
      return new File([blob], `dealer-social-post-${target.id}.mp4`, {
        type: blob.type || "video/mp4",
      });
    } catch {
      /* fall back to image */
    }
  }

  if (content.imageDataUrl) {
    const fmt = EXPORT_FORMATS.find((f) => f.id === target.format);
    if (fmt) {
      const formatted = await renderFormat(content.imageDataUrl, fmt);
      const blob = await dataUrlToBlob(formatted);
      return new File([blob], `dealer-social-post-${target.id}.jpg`, {
        type: "image/jpeg",
      });
    }
  }
  return null;
};

/**
 * Publish via the appropriate path for this target.
 */
export const publishTo = async (
  targetId: string,
  content: PublishContent,
): Promise<PublishStatus> => {
  const target = findTarget(targetId);
  if (!target) return { kind: "error", message: "Unknown publish target" };

  try {
    const file = await buildShareFile(target, content);

    const captionForShare = fitCaptionToBudget(
      content.text,
      target.charBudget,
    );
    const copied = await copyTextToClipboard(captionForShare);
    content = { ...content, text: captionForShare };

    const downloadFile = () => {
      if (!file) return;
      const dlUrl = URL.createObjectURL(file);
      triggerDownload(dlUrl, file.name);
      setTimeout(() => URL.revokeObjectURL(dlUrl), 4000);
    };

    const webUrl = target.webIntentUrl?.(content) ?? null;
    const pasteMsg = pasteHintFor(target.label);
    const copyWarn = copied
      ? ""
      : " (Clipboard copy may have failed — use Copy caption on the post screen first.)";

    // ── Facebook / Marketplace: never depend on Apple Share Sheet ──────────
    if (target.handoff === "clipboard-open") {
      downloadFile();
      openAppOrWeb(target.appSchemeUrl, webUrl);
      return {
        kind: "fallback",
        via: "clipboard-open",
        pasteRequired: true,
        message: [
          `${target.label} is ready.`,
          pasteMsg + copyWarn,
          file
            ? "Photo/video was downloaded — add it from Downloads or Photos when composing."
            : "Add your photo from the post screen if needed.",
          isAppleTouchDevice()
            ? "Note: Facebook usually does not appear in Apple’s Share Sheet for web apps — that’s an iOS/Meta limit, not a missing button. This path opens Facebook directly."
            : "",
        ]
          .filter(Boolean)
          .join(" "),
      };
    }

    // ── Instagram / TikTok: share sheet with media file; caption on clipboard ─
    if (target.handoff === "share-file") {
      // Files-only share surfaces photo/video destinations (IG often shows;
      // Facebook usually still will not).
      const result = await tryWebShareFile(file, captionForShare, target.label, {
        includeText: false,
      });
      if (result === "shared") {
        return {
          kind: "shared",
          via: "web-share",
          pasteRequired: true,
          message: `${target.label}: media sent to the share sheet. ${pasteMsg}`,
        };
      }
      if (result === "cancelled") {
        await copyTextToClipboard(captionForShare);
        return {
          kind: "cancelled",
          pasteRequired: true,
          message: `Share cancelled. ${pasteMsg}`,
        };
      }
      // Fallback: download + open app/web
      downloadFile();
      openAppOrWeb(target.appSchemeUrl, webUrl);
      return {
        kind: "fallback",
        via: webUrl ? "url-intent" : "download-copy",
        pasteRequired: true,
        message: [
          `Opened ${target.label}.`,
          pasteMsg + copyWarn,
          file ? "Media was downloaded — attach it in the app." : "",
        ]
          .filter(Boolean)
          .join(" "),
      };
    }

    // ── More… generic share sheet ──────────────────────────────────────────
    if (target.handoff === "share-any") {
      // Include text so Messages/Mail/etc get both; apps that ignore text still
      // get the file when present.
      const result = await tryWebShareFile(file, captionForShare, target.label, {
        includeText: true,
      });
      if (result === "shared") {
        return {
          kind: "shared",
          via: "web-share",
          pasteRequired: true,
          message: `Share sheet opened. If Facebook is missing, use the Facebook button instead — Apple often hides it for web shares. ${pasteMsg}`,
        };
      }
      if (result === "cancelled") {
        await copyTextToClipboard(captionForShare);
        return {
          kind: "cancelled",
          pasteRequired: true,
          message: `Share cancelled. ${pasteMsg}`,
        };
      }
      downloadFile();
      return {
        kind: "fallback",
        via: "download-copy",
        pasteRequired: true,
        message: `Share sheet unavailable. Media downloaded. ${pasteMsg}${copyWarn}`,
      };
    }

    // ── share-or-intent (LinkedIn, X, GBP) ─────────────────────────────────
    {
      const result = await tryWebShareFile(file, captionForShare, target.label, {
        includeText: true,
      });
      if (result === "shared") {
        return {
          kind: "shared",
          via: "web-share",
          pasteRequired: true,
          message: pasteMsg,
        };
      }
      if (result === "cancelled") {
        await copyTextToClipboard(captionForShare);
        return {
          kind: "cancelled",
          pasteRequired: true,
          message: `Share cancelled. ${pasteMsg}`,
        };
      }
      downloadFile();
      if (webUrl) {
        window.open(webUrl, "_blank", "noopener,noreferrer");
        return {
          kind: "fallback",
          via: "url-intent",
          pasteRequired: true,
          message: `Opened ${target.label}. ${pasteMsg}${copyWarn}${
            file ? " Media was downloaded." : ""
          }`,
        };
      }
      return {
        kind: "fallback",
        via: "download-copy",
        pasteRequired: true,
        message: `Media downloaded. ${pasteMsg}${copyWarn}`,
      };
    }
  } catch (err) {
    return {
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
};
