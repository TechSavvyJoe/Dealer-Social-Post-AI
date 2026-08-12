import React from "react";

export type PlatformGlyphKey =
  | "instagram"
  | "facebook"
  | "tiktok"
  | "google_business"
  | "linkedin"
  | "x"
  | "marketplace"
  | "native"
  | "generic";

export type PlatformGlyphSize = "sm" | "md" | "lg";

export interface PlatformGlyphProps extends Omit<
  React.HTMLAttributes<HTMLSpanElement>,
  "children" | "aria-label"
> {
  /** Canonical destination id when one is available. */
  platformId?: string | null;
  /** Human-facing destination label; also supports legacy and future ids. */
  label?: string | null;
  /** Keep true when the destination name is already rendered beside the glyph. */
  decorative?: boolean;
  /** Required only when a standalone glyph needs wording other than its destination label. */
  accessibleLabel?: string;
  size?: PlatformGlyphSize;
}

const PLATFORM_ID_KEYS: Readonly<Record<string, PlatformGlyphKey>> = {
  instagram: "instagram",
  instagram_feed: "instagram",
  instagram_reel: "instagram",
  instagram_story: "instagram",
  facebook: "facebook",
  facebook_feed: "facebook",
  tiktok: "tiktok",
  google: "google_business",
  google_business: "google_business",
  google_business_profile: "google_business",
  gbp: "google_business",
  linkedin: "linkedin",
  x: "x",
  x_twitter: "x",
  twitter: "x",
  marketplace: "marketplace",
  facebook_marketplace: "marketplace",
  fb_marketplace: "marketplace",
  native: "native",
  native_share: "native",
  device_share: "native",
  share: "native",
};

const PLATFORM_NAMES: Readonly<Record<PlatformGlyphKey, string>> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  google_business: "Google Business",
  linkedin: "LinkedIn",
  x: "X",
  marketplace: "Facebook Marketplace",
  native: "Device share",
  generic: "Social platform",
};

const normalizePlatformValue = (value?: string | null): string =>
  value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") ?? "";

const inferPlatformGlyphKey = (value?: string | null): PlatformGlyphKey | null => {
  const normalized = normalizePlatformValue(value);
  if (!normalized) return null;

  const exactMatch = PLATFORM_ID_KEYS[normalized];
  if (exactMatch) return exactMatch;

  // Marketplace must win before Facebook because labels often contain both.
  if (normalized.includes("marketplace")) return "marketplace";
  if (normalized.includes("instagram") || /(^|_)ig($|_)/.test(normalized)) {
    return "instagram";
  }
  if (normalized.includes("facebook") || /(^|_)fb($|_)/.test(normalized)) {
    return "facebook";
  }
  if (normalized.includes("tiktok") || normalized.includes("tik_tok")) return "tiktok";
  if (
    normalized === "gbp" ||
    normalized.includes("google_business") ||
    normalized.includes("google_profile")
  ) {
    return "google_business";
  }
  if (normalized.includes("linkedin") || normalized.includes("linked_in")) {
    return "linkedin";
  }
  if (
    normalized === "x" ||
    normalized.startsWith("x_") ||
    normalized.includes("twitter")
  ) {
    return "x";
  }
  if (
    normalized.includes("native_share") ||
    normalized.includes("device_share") ||
    normalized === "share" ||
    normalized === "more"
  ) {
    return "native";
  }

  return null;
};

/**
 * Resolve persisted destination ids and user-facing labels to one visual family.
 * An unknown id can still be recovered from its label, while truly unknown
 * destinations receive a neutral globe instead of a misleading brand mark.
 */
export const resolvePlatformGlyphKey = (
  platformId?: string | null,
  label?: string | null,
): PlatformGlyphKey =>
  inferPlatformGlyphKey(platformId) ?? inferPlatformGlyphKey(label) ?? "generic";

interface GlyphSvgProps {
  className?: string;
}

const InstagramGlyph = ({ className }: GlyphSvgProps) => (
  <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
    <rect
      height="17"
      rx="5"
      stroke="currentColor"
      strokeWidth="2"
      width="17"
      x="3.5"
      y="3.5"
    />
    <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
    <circle cx="17.55" cy="6.55" fill="currentColor" r="1.15" />
  </svg>
);

const FacebookGlyph = ({ className }: GlyphSvgProps) => (
  <svg aria-hidden="true" className={className} fill="currentColor" viewBox="0 0 24 24">
    <path d="M13.6 21v-7.25h2.52l.48-3.1h-3V8.68c0-.9.25-1.51 1.54-1.51h1.61V4.4c-.28-.04-1.24-.12-2.36-.12-2.34 0-3.94 1.43-3.94 4.05v2.32H7.8v3.1h2.65V21h3.15Z" />
  </svg>
);

const TikTokGlyph = ({ className }: GlyphSvgProps) => {
  const note =
    "M13.7 3.15v9.45a4.55 4.55 0 1 1-3.35-4.4v3.08a1.7 1.7 0 1 0 .48 1.18V3.15h2.87Zm0 0c.36 2.16 1.65 3.47 3.95 3.98v2.9a8.04 8.04 0 0 1-3.95-1.55V3.15Z";

  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <path d={note} fill="#25F4EE" transform="translate(-.7 .45)" />
      <path d={note} fill="#FE2C55" transform="translate(.7 -.2)" />
      <path d={note} fill="white" />
    </svg>
  );
};

const GoogleBusinessGlyph = ({ className }: GlyphSvgProps) => (
  <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
    <path d="M5.2 10.2h13.6v9.1a1 1 0 0 1-1 1H6.2a1 1 0 0 1-1-1v-9.1Z" fill="#4285F4" />
    <path d="M4 8.5 5.7 4h3.16L8 8.5a2 2 0 0 1-4 0Z" fill="#EA4335" />
    <path d="M8 8.5 8.86 4H12v4.5a2 2 0 0 1-4 0Z" fill="#FBBC04" />
    <path d="M12 8.5V4h3.14L16 8.5a2 2 0 0 1-4 0Z" fill="#34A853" />
    <path d="M16 8.5 15.14 4h3.16L20 8.5a2 2 0 0 1-4 0Z" fill="#4285F4" />
    <path d="M8.15 13.25h7.7v7.05h-7.7z" fill="white" fillOpacity=".96" />
    <path d="M12 13.25v7.05" stroke="#D8E6FC" strokeWidth=".9" />
  </svg>
);

const LinkedInGlyph = ({ className }: GlyphSvgProps) => (
  <svg aria-hidden="true" className={className} fill="currentColor" viewBox="0 0 24 24">
    <path d="M6.25 8.1A2.05 2.05 0 1 0 6.25 4a2.05 2.05 0 0 0 0 4.1ZM4.45 9.7H8v10.15H4.45V9.7Zm5.58 0h3.4v1.39h.05c.47-.9 1.63-1.84 3.35-1.84 3.58 0 4.24 2.35 4.24 5.42v5.18h-3.54v-4.59c0-1.1-.02-2.5-1.53-2.5-1.53 0-1.77 1.19-1.77 2.42v4.67h-3.54V9.7h-.66Z" />
  </svg>
);

const XGlyph = ({ className }: GlyphSvgProps) => (
  <svg aria-hidden="true" className={className} fill="currentColor" viewBox="0 0 24 24">
    <path d="M17.67 4h2.74l-5.99 6.85L21.47 20h-5.52l-4.32-5.65L6.69 20H3.94l6.4-7.32L3.58 4H9.24l3.9 5.16L17.67 4Zm-.96 14.39h1.52L8.41 5.53H6.78l9.93 12.86Z" />
  </svg>
);

const MarketplaceGlyph = ({ className }: GlyphSvgProps) => (
  <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
    <path
      d="M5 10.25h14v8.1a1.4 1.4 0 0 1-1.4 1.4H6.4A1.4 1.4 0 0 1 5 18.35v-8.1Z"
      fill="white"
      fillOpacity=".96"
    />
    <path d="M7.25 13h3v6.75h-3z" fill="#1877F2" />
    <path d="M12 13h4.75v3.25H12z" fill="#CFE1FF" />
    <path d="M3.75 8.7 5.3 4.4h3.35L8 8.7a2.13 2.13 0 0 1-4.25 0Z" fill="white" />
    <path d="M8 8.7 8.65 4.4H12v4.3a2 2 0 0 1-4 0Z" fill="white" fillOpacity=".72" />
    <path d="M12 8.7V4.4h3.35L16 8.7a2 2 0 0 1-4 0Z" fill="white" />
    <path
      d="m16 8.7-.65-4.3h3.35l1.55 4.3A2.13 2.13 0 0 1 16 8.7Z"
      fill="white"
      fillOpacity=".72"
    />
  </svg>
);

const NativeShareGlyph = ({ className }: GlyphSvgProps) => (
  <svg
    aria-hidden="true"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.9"
    viewBox="0 0 24 24"
  >
    <path d="M12 15V3m0 0L8 7m4-4 4 4" />
    <path d="M7 10H5.75A1.75 1.75 0 0 0 4 11.75v6.5A1.75 1.75 0 0 0 5.75 20h12.5A1.75 1.75 0 0 0 20 18.25v-6.5A1.75 1.75 0 0 0 18.25 10H17" />
  </svg>
);

const GenericGlyph = ({ className }: GlyphSvgProps) => (
  <svg
    aria-hidden="true"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.8"
    viewBox="0 0 24 24"
  >
    <circle cx="12" cy="12" r="8.25" />
    <path d="M3.9 12h16.2M12 3.75c2.15 2.25 3.25 5 3.25 8.25S14.15 18 12 20.25C9.85 18 8.75 15.25 8.75 12S9.85 6 12 3.75Z" />
  </svg>
);

const GLYPHS: Readonly<Record<PlatformGlyphKey, React.FC<GlyphSvgProps>>> = {
  instagram: InstagramGlyph,
  facebook: FacebookGlyph,
  tiktok: TikTokGlyph,
  google_business: GoogleBusinessGlyph,
  linkedin: LinkedInGlyph,
  x: XGlyph,
  marketplace: MarketplaceGlyph,
  native: NativeShareGlyph,
  generic: GenericGlyph,
};

const TONE_CLASSES: Readonly<Record<PlatformGlyphKey, string>> = {
  instagram:
    "border-strong bg-[linear-gradient(135deg,#6d28d9_0%,#db2777_48%,#f97316_100%)] text-white shadow-[0_5px_14px_rgba(219,39,119,0.24)]",
  facebook:
    "border-[#4391f5] bg-[#1877f2] text-white shadow-[0_5px_14px_rgba(24,119,242,0.22)]",
  tiktok: "border-strong bg-[#09090b] text-white shadow-[0_5px_14px_rgba(0,0,0,0.28)]",
  google_business:
    "border-slate-200 bg-white text-slate-900 shadow-[0_5px_14px_rgba(15,23,42,0.14)]",
  linkedin:
    "border-[#2f7fbd] bg-[#0a66c2] text-white shadow-[0_5px_14px_rgba(10,102,194,0.22)]",
  x: "border-strong bg-[#050505] text-white shadow-[0_5px_14px_rgba(0,0,0,0.28)]",
  marketplace:
    "border-[#4391f5] bg-[linear-gradient(145deg,#2584ff,#0a5dd8)] text-white shadow-[0_5px_14px_rgba(24,119,242,0.22)]",
  native:
    "border-slate-600/70 bg-slate-800 text-slate-100 shadow-[0_5px_14px_rgba(2,6,23,0.2)]",
  generic:
    "border-slate-600/70 bg-slate-800 text-slate-200 shadow-[0_5px_14px_rgba(2,6,23,0.2)]",
};

const SIZE_CLASSES: Readonly<Record<PlatformGlyphSize, string>> = {
  sm: "size-6 rounded-[0.45rem]",
  md: "size-7 rounded-[0.55rem]",
  lg: "size-9 rounded-[0.7rem]",
};

const ICON_SIZE_CLASSES: Readonly<Record<PlatformGlyphSize, string>> = {
  sm: "size-4",
  md: "size-[1.15rem]",
  lg: "size-6",
};

export const PlatformGlyph: React.FC<PlatformGlyphProps> = ({
  platformId,
  label,
  decorative = true,
  accessibleLabel,
  size = "md",
  className,
  ...spanProps
}) => {
  const glyphKey = resolvePlatformGlyphKey(platformId, label);
  const Glyph = GLYPHS[glyphKey];
  const resolvedAccessibleLabel =
    accessibleLabel || label?.trim() || PLATFORM_NAMES[glyphKey];

  return (
    <span
      {...spanProps}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : resolvedAccessibleLabel}
      className={[
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden border",
        SIZE_CLASSES[size],
        TONE_CLASSES[glyphKey],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      data-platform-glyph={glyphKey}
      role={decorative ? undefined : "img"}
    >
      <Glyph className={ICON_SIZE_CLASSES[size]} />
    </span>
  );
};
