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
import {
  ExportFormatId,
  renderFormat,
  EXPORT_FORMATS,
} from "../utils/multiFormatExport";
import { dataUrlToBlob } from "../utils/imageUtils";
import { fitCaptionToBudget } from "../utils/hashtags";
import {
  downloadPreparedMediaFile,
  invokeWebShareNow,
  prepareMediaForSave,
} from "../utils/mediaSave";

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
  /** Editable caption body. Legacy callers may still include a disclosure marker. */
  text: string;
  /** Immutable compliance footer; target fitting never truncates this block. */
  disclosures?: string;
  /** Hashtags as a single space-separated string (may already be in `text`). */
  hashtags?: string;
  /** Source generated image as data URL (or http URL). */
  imageDataUrl?: string;
  /** Optional rendered video as a blob URL. */
  videoUrl?: string;
  /**
   * Already-prepared exact delivery file. Passing the canonical File avoids a
   * second video fetch or canvas render before mobile sharing.
   */
  preparedFile?: File;
}

/**
 * How media + caption are handed to the destination app.
 * - photos-then-app: copy caption, put media on share/save path, open native app
 *   (Facebook / Marketplace — do NOT open facebook.com on phones)
 * - share-file: system share sheet with media file (IG / TikTok)
 * - share-any: generic share sheet (More…)
 * - share-or-intent: try share sheet, then web intent (GBP / LinkedIn / X)
 * - clipboard-open: legacy alias for photos-then-app
 */
export type ShareHandoff =
  "photos-then-app" | "clipboard-open" | "share-file" | "share-any" | "share-or-intent";

export interface PublishTarget {
  id: string;
  label: string;
  /** Lucide icon name (rendered by the dialog). */
  icon:
    "facebook" | "instagram" | "music" | "globe" | "twitter" | "linkedin" | "share2";
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
    format: "feed_portrait",
    charBudget: 2200,
    supportsVideo: true,
    directApiConnected: false,
    handoff: "share-file",
    hint: "Photo via share sheet · paste caption in IG",
    appSchemeUrl: "instagram://app",
    webIntentUrl: () => "https://www.instagram.com/",
  },
  {
    id: "instagram_reel",
    label: "Instagram Reel",
    icon: "instagram",
    accent: "#D62976",
    format: "story_vertical",
    charBudget: 2200,
    supportsVideo: true,
    directApiConnected: false,
    handoff: "share-file",
    hint: "9:16 video via share sheet · paste caption in Instagram",
    appSchemeUrl: "instagram://camera",
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
    format: "feed_portrait",
    charBudget: 63206,
    supportsVideo: true,
    directApiConnected: false,
    // Prefer native FB app + Photos — never force facebook.com login in Safari.
    handoff: "photos-then-app",
    hint: "Copy · share/save photo · open Facebook app · paste",
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
    supportsVideo: true,
    directApiConnected: false,
    handoff: "share-or-intent",
    hint: "Exact photo or video · caption copied · open GBP posts",
    webIntentUrl: () => "https://business.google.com/posts/",
  },
  {
    id: "marketplace",
    label: "FB Marketplace",
    icon: "facebook",
    accent: "#1877F2",
    format: "marketplace",
    charBudget: 9999,
    supportsVideo: true,
    directApiConnected: false,
    handoff: "photos-then-app",
    hint: "Copy · save photo · Facebook app → Marketplace → Sell",
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
    supportsVideo: true,
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
    format: "social_landscape",
    charBudget: 280,
    supportsVideo: true,
    directApiConnected: false,
    handoff: "share-or-intent",
    hint: "Optional · most dealerships skip X · 280-char limit",
    webIntentUrl: (c) =>
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(c.text)}`,
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
export const CORE_PUBLISH_IDS = ["instagram_feed", "facebook_feed", "tiktok"] as const;

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

export const isMobileShareDevice = (): boolean => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod|Android/i.test(ua)) return true;
  return isAppleTouchDevice();
};

/**
 * Open the native app when possible. On phones we NEVER auto-open Meta web
 * (facebook.com / instagram.com) — that forces a slow browser re-login and
 * does not use the logged-in Facebook/Instagram apps salespeople already use.
 *
 * Desktop may open the web URL as a fallback.
 */
export const openNativeAppOrWeb = (
  appScheme: string | undefined,
  webUrl: string | null,
  opts?: { allowWebOnMobile?: boolean },
): "native" | "web" | "none" => {
  if (typeof window === "undefined") return "none";
  const mobile = isMobileShareDevice();
  const allowWebOnMobile = opts?.allowWebOnMobile === true;

  if (mobile && appScheme) {
    try {
      // location.href is more reliable than a hidden iframe for many iOS builds.
      window.location.href = appScheme;
      return "native";
    } catch {
      /* fall through */
    }
  }

  if (webUrl && (!mobile || allowWebOnMobile)) {
    window.open(webUrl, "_blank", "noopener,noreferrer");
    return "web";
  }

  if (!mobile && appScheme) {
    try {
      window.location.href = appScheme;
      return "native";
    } catch {
      return "none";
    }
  }
  return "none";
};

const pasteHintFor = (label: string): string =>
  `Caption is on your clipboard. In ${label}, create the post, then long-press → Paste (or ⌘V / Ctrl+V). Browsers cannot auto-fill Facebook/Instagram captions.`;

/**
 * Select the richest payload the current browser says it can share without
 * dropping prepared media. WebKit frequently rejects file + text while
 * accepting the exact same file on its own.
 */
const chooseSharePayload = (
  file: File | null,
  caption: string,
  title: string,
  includeText: boolean,
): ShareData | null => {
  const canShare = (data: ShareData): boolean => {
    try {
      return typeof navigator.canShare !== "function" || navigator.canShare(data);
    } catch {
      return false;
    }
  };

  if (file) {
    const combined: ShareData = {
      files: [file],
      ...(includeText ? { title, text: caption } : {}),
    };
    // Safari can report file + text as shareable while omitting media apps or
    // rejecting the actual handoff. Apple gets the media-only payload and the
    // already-copied caption remains the explicit paste path.
    if (!isAppleTouchDevice() && canShare(combined)) return combined;

    // Never turn a selected video/photo into a text-only share. A file-only
    // sheet is the reliable iOS path; the caption remains an explicit Copy.
    const fileOnly: ShareData = { files: [file] };
    if (canShare(fileOnly)) return fileOnly;
    return null;
  }

  if (!includeText) return null;
  const textOnly: ShareData = { title, text: caption };
  return canShare(textOnly) ? textOnly : null;
};

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
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") {
    return "unavailable";
  }

  const shareData = chooseSharePayload(file, caption, title, opts.includeText);
  if (!shareData) return "unavailable";

  const attempt = await invokeWebShareNow(shareData);
  if (attempt.kind === "completed" || attempt.kind === "started") {
    // Re-copy after share sheet closes — some iOS sessions leave clipboard stale
    // or the user still needs paste after attaching media in the destination app.
    await copyTextToClipboard(caption);
    return "shared";
  }
  if (attempt.kind === "cancelled") return "cancelled";
  return "unavailable";
};

const buildShareFile = async (
  target: PublishTarget,
  content: PublishContent,
): Promise<File | null> => {
  if (content.preparedFile) {
    const isVideoFile = content.preparedFile.type.startsWith("video/");
    if (isVideoFile && !target.supportsVideo) {
      throw new Error(
        `${target.label} is configured for a photo in this workflow. Choose a photo output instead of substituting the still image for your selected video.`,
      );
    }
    return content.preparedFile;
  }
  if (content.videoUrl) {
    if (!target.supportsVideo) {
      throw new Error(
        `${target.label} is configured for a photo in this workflow. Choose a photo output instead of substituting the still image for your selected video.`,
      );
    }
    // Use the same authenticated-fetch, MP4-signature, MIME, and extension
    // validation as direct Save. Never disguise a 401/JSON body as an .mp4 or
    // silently share the still image when the user selected a video.
    return (
      await prepareMediaForSave({
        sourceUrl: content.videoUrl,
        kind: "video",
        basename: `dealer-social-post-${target.id}`,
      })
    ).file;
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

export interface PreparedPublishShare {
  target: PublishTarget;
  content: PublishContent;
  caption: string;
  file: File | null;
  webUrl: string | null;
}

/**
 * Fit only the editable body while preserving the complete compliance footer.
 * If a destination cannot hold both, fail closed instead of publishing a
 * legally incomplete disclosure.
 */
export const fitPublishCaptionToBudget = (
  content: Pick<PublishContent, "text" | "disclosures">,
  maxChars: number,
): string => {
  const legacyMarkerIndex = content.text.indexOf("— Disclosures —");
  const rawBody = (
    legacyMarkerIndex >= 0 ? content.text.slice(0, legacyMarkerIndex) : content.text
  ).trim();
  const trailingMentionMatch = rawBody.match(/(?:^|\n{2,})(@[^\n]{1,100})$/u);
  const dealershipMention = trailingMentionMatch?.[1]?.trim() || "";
  const body = dealershipMention
    ? rawBody.slice(0, trailingMentionMatch?.index ?? rawBody.length).trim()
    : rawBody;
  const disclosure = (
    content.disclosures ||
    (legacyMarkerIndex >= 0 ? content.text.slice(legacyMarkerIndex) : "")
  ).trim();

  const canonicalDisclosure = disclosure
    ? disclosure.startsWith("— Disclosures —")
      ? disclosure
      : `— Disclosures —\n${disclosure}`
    : "";
  const protectedSuffix = [dealershipMention, canonicalDisclosure]
    .filter(Boolean)
    .join("\n\n");
  if (!protectedSuffix) return fitCaptionToBudget(body, maxChars);
  if (!body) {
    if (protectedSuffix.length > maxChars) {
      throw new Error(
        "The dealership mention or required compliance disclosures exceed this destination's character limit.",
      );
    }
    return protectedSuffix;
  }

  const separator = "\n\n";
  const bodyBudget = maxChars - protectedSuffix.length - separator.length;
  if (bodyBudget < 1) {
    throw new Error(
      `The dealership mention or required compliance disclosures exceed this destination's ${maxChars}-character limit. Choose another destination or revise the advertised terms.`,
    );
  }
  const fittedBody = fitCaptionToBudget(body, bodyBudget);
  if (!fittedBody) {
    throw new Error(
      "The caption cannot fit alongside its dealership mention and required compliance disclosures. Revise it before sharing.",
    );
  }
  const combined = `${fittedBody}\n\n${protectedSuffix}`;
  if (combined.length > maxChars) {
    throw new Error(
      "The caption cannot fit without truncating its dealership mention or required compliance disclosures.",
    );
  }
  return combined;
};

/**
 * Expensive media work belongs before the user presses Share now. In
 * particular, canvas rendering and video fetches can outlive Safari's
 * transient user-activation window.
 */
export const preparePublishShare = async (
  targetId: string,
  content: PublishContent,
): Promise<PreparedPublishShare> => {
  const target = findTarget(targetId);
  if (!target) throw new Error("Unknown publish target");
  const caption = fitPublishCaptionToBudget(content, target.charBudget);
  const scopedContent = { ...content, text: caption, disclosures: undefined };
  const file = await buildShareFile(target, scopedContent);
  return {
    target,
    content: scopedContent,
    caption,
    file,
    webUrl: target.webIntentUrl?.(scopedContent) ?? null,
  };
};

/**
 * Invoke `navigator.share()` before the first await. Call this directly from a
 * fresh click handler; doing so preserves WebKit transient user activation.
 */
export const sharePrepared = async (
  prepared: PreparedPublishShare,
): Promise<PublishStatus> => {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") {
    return {
      kind: "fallback",
      via: "download-copy",
      pasteRequired: true,
      message:
        "System sharing is unavailable. Copy the caption, save the media, then open the app.",
    };
  }

  const includeText =
    prepared.target.handoff === "share-any" ||
    prepared.target.handoff === "share-or-intent";
  if (prepared.content.videoUrl && !prepared.file) {
    return {
      kind: "error",
      message:
        "The selected video is not prepared. Retry media preparation; the app will not substitute a still image.",
    };
  }
  const shareData = chooseSharePayload(
    prepared.file,
    prepared.caption,
    prepared.target.label,
    includeText,
  );
  if (!shareData) {
    return {
      kind: "fallback",
      via: "download-copy",
      pasteRequired: true,
      message:
        "This browser cannot share the prepared media. Save it, then open the app.",
    };
  }

  try {
    // Do not move any asynchronous preparation above this call.
    const sharePromise = invokeWebShareNow(shareData);
    const clipboardPromise = copyTextToClipboard(prepared.caption);
    const attempt = await sharePromise;
    if (attempt.kind === "cancelled") {
      return {
        kind: "cancelled",
        pasteRequired: true,
        message: "Share cancelled. The prepared media is still ready.",
      };
    }
    if (attempt.kind === "unavailable") {
      return {
        kind: "fallback",
        via: "download-copy",
        pasteRequired: true,
        message:
          "The share sheet could not open. Save the media or open the app below.",
      };
    }
    const copied = await clipboardPromise;
    return {
      kind: "shared",
      via: "web-share",
      pasteRequired: true,
      message: copied
        ? "Media sent to the share sheet. The caption is ready to paste in the destination app."
        : "Media sent to the share sheet. Use Copy caption below before finishing the post.",
    };
  } catch {
    return {
      kind: "fallback",
      via: "download-copy",
      pasteRequired: true,
      message: "The share sheet could not open. Save the media or open the app below.",
    };
  }
};

export const copyPreparedCaption = (prepared: PreparedPublishShare): Promise<boolean> =>
  copyTextToClipboard(prepared.caption);

export const downloadPreparedMedia = (prepared: PreparedPublishShare): boolean => {
  if (!prepared.file) return false;
  return downloadPreparedMediaFile(prepared.file);
};

/** App/web handoff is intentionally a separate, explicit click after sharing. */
export const openPreparedTarget = (
  prepared: PreparedPublishShare,
): "native" | "web" | "none" =>
  openNativeAppOrWeb(prepared.target.appSchemeUrl, prepared.webUrl, {
    allowWebOnMobile: false,
  });

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

    const captionForShare = fitPublishCaptionToBudget(content, target.charBudget);
    const copied = await copyTextToClipboard(captionForShare);
    content = { ...content, text: captionForShare, disclosures: undefined };

    const downloadFile = () => {
      if (!file) return;
      downloadPreparedMediaFile(file);
    };

    const webUrl = target.webIntentUrl?.(content) ?? null;
    const pasteMsg = pasteHintFor(target.label);
    const copyWarn = copied
      ? ""
      : " (Clipboard copy may have failed — use Copy caption on the post screen first.)";

    // ── Facebook / Marketplace: Photos + native app (no Safari re-login) ───
    if (target.handoff === "clipboard-open" || target.handoff === "photos-then-app") {
      const mobile = isMobileShareDevice();
      let mediaNote = "";

      if (file && mobile) {
        // Share sheet: user can Save Image (Photos) or pick Facebook if it appears.
        const shareResult = await tryWebShareFile(
          file,
          captionForShare,
          `Share ${target.label} photo`,
          { includeText: false },
        );
        if (shareResult === "shared") {
          await copyTextToClipboard(captionForShare);
          // Best-effort open native app after share (user may already be in FB).
          openNativeAppOrWeb(target.appSchemeUrl, null);
          return {
            kind: "shared",
            via: "web-share",
            pasteRequired: true,
            message: [
              `${target.label}: caption is on your clipboard.`,
              "If you chose Save Image/Video, the media is in Photos.",
              "If you chose Facebook, finish the post in the Facebook app.",
              "In Facebook: New post → long-press → Paste → add photo from library.",
              "Use the Facebook app (not Safari) so you stay logged in.",
            ].join(" "),
          };
        }
        if (shareResult === "cancelled") {
          await copyTextToClipboard(captionForShare);
          return {
            kind: "cancelled",
            pasteRequired: true,
            message: `Cancelled. Caption is still copied — open the Facebook app when ready and Paste.`,
          };
        }
        downloadFile();
        mediaNote =
          "Photo/video was downloaded. Save it to Photos if needed, then add it in the Facebook app.";
      } else {
        downloadFile();
        mediaNote = file
          ? "Photo/video was downloaded — attach it when composing."
          : "";
      }

      if (mobile) {
        openNativeAppOrWeb(target.appSchemeUrl, null);
        return {
          kind: "fallback",
          via: "clipboard-open",
          pasteRequired: true,
          message: [
            `${target.label}: caption copied.${copyWarn}`,
            mediaNote,
            "Open the Facebook app (blue icon) — not the website — so your existing login is used.",
            "New post → Paste caption → add photo from Photos.",
            isAppleTouchDevice()
              ? "Facebook often does not appear in Apple’s share list for web apps; that is normal."
              : "",
          ]
            .filter(Boolean)
            .join(" "),
        };
      }

      // Desktop: download + optional web is fine
      openNativeAppOrWeb(undefined, webUrl);
      return {
        kind: "fallback",
        via: "url-intent",
        pasteRequired: true,
        message: [`${target.label}: caption copied.${copyWarn}`, mediaNote, pasteMsg]
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
          message: `${target.label}: media sent to the share sheet. ${pasteMsg} Prefer the app (not the website) so you stay logged in.`,
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
      // Fallback: native app only on phone — do not force web re-login
      downloadFile();
      if (isMobileShareDevice()) {
        openNativeAppOrWeb(target.appSchemeUrl, null);
        return {
          kind: "fallback",
          via: "download-copy",
          pasteRequired: true,
          message: [
            `Caption copied.${copyWarn}`,
            file ? "Media downloaded / ready to attach from Photos." : "",
            `Open the ${target.label} app → new post → Paste → pick media from library.`,
          ]
            .filter(Boolean)
            .join(" "),
        };
      }
      openNativeAppOrWeb(undefined, webUrl);
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
