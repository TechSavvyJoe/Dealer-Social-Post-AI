import { VideoStyle, VideoRequestOptions } from "../../types";
import { IconProps } from "../Icons";

export type VideoStyleMeta = {
  style: VideoStyle;
  /** Salesperson-facing marketing name */
  label: string;
  icon: IconProps["type"];
  description: string;
  category: "Cinematic" | "Modern" | "Fun" | "Artistic" | "Transitions";
  recommended?: boolean;
  tags?: string[];
};

export const defaultResolution: VideoRequestOptions["resolution"] = "720p";

export const durations = [
  {
    value: 4,
    label: "4s",
    description: "Quick loop for Stories.",
  },
  { value: 6, label: "6s", description: "Best for Reels / TikTok delivery posts." },
  {
    value: 8,
    label: "8s",
    description: "Full-length showcase; required for 1080p quality.",
  },
];

export const soundtracks: Array<{
  value: VideoRequestOptions["soundtrack"];
  label: string;
  description: string;
}> = [
  {
    value: "cinematic",
    label: "Music On",
    description: "AI-generated score + ambience in the MP4.",
  },
  {
    value: "celebration",
    label: "Upbeat",
    description: "Higher-energy original music for delivery moments.",
  },
  {
    value: "none",
    label: "Silent",
    description: "No music — score later in your editor if needed.",
  },
];

export const aspectRatios: Array<{
  value: VideoRequestOptions["aspectPreference"];
  label: string;
  description: string;
}> = [
  {
    value: "9:16",
    label: "9:16 Vertical",
    description: "Reels, TikTok, Stories, Shorts.",
  },
  {
    value: "16:9",
    label: "16:9 Wide",
    description: "YouTube, Facebook landscape, ads.",
  },
];

/**
 * Creator Mode — top automotive marketing motion recipes only.
 * Identity-locked living photography for real delivery photos.
 *
 * This array IS the exposed slate: `EXPOSED_VIDEO_STYLES` below is derived from
 * it, and `UNEXPOSED_VIDEO_STYLES` names the enum members deliberately left out.
 */
export const styles: VideoStyleMeta[] = [
  {
    style: VideoStyle.GoldenRadiance,
    label: "Golden Delivery",
    icon: "sun",
    description: "Warm paint sheen + slow push — premium OEM handover.",
    category: "Cinematic",
    recommended: true,
    tags: ["default", "premium", "delivery"],
  },
  {
    style: VideoStyle.Spotlight,
    label: "Keys & Smile",
    icon: "sun",
    description: "Soft spotlight on faces + car nose — intimate delivery day.",
    category: "Cinematic",
    recommended: true,
    tags: ["people", "premium"],
  },
  {
    style: VideoStyle.VintageFilm,
    label: "Living Still",
    icon: "film",
    description: "Gentle Ken Burns — honest, scroll-stopping living photo.",
    category: "Artistic",
    recommended: true,
    tags: ["authentic"],
  },
  {
    style: VideoStyle.RoadTrip,
    label: "Lot Parallax",
    icon: "map",
    description: "Background drift only — ready-for-the-road energy.",
    category: "Transitions",
    recommended: true,
    tags: ["outdoor"],
  },
  {
    style: VideoStyle.PartyTime,
    label: "Tasteful Confetti",
    icon: "confetti",
    description: "Light celebration particles in empty space only.",
    category: "Fun",
    recommended: true,
    tags: ["celebration"],
  },
  {
    style: VideoStyle.LiquidChrome,
    label: "Paint Sheen",
    icon: "droplet",
    description: "Specular roll on real paint — product-hero luxury.",
    category: "Modern",
    recommended: true,
    tags: ["car-forward", "premium"],
  },
  {
    style: VideoStyle.StickerSlap,
    label: "Badge Pop",
    icon: "tag",
    description: "Small SOLD/keys badges in empty corners — TikTok-native.",
    category: "Fun",
    recommended: true,
    tags: ["engagement"],
  },
  {
    style: VideoStyle.EpicReveal,
    label: "Soft Hero Light",
    icon: "starburst",
    description: "Gentle light wrap — high-budget social hero without morph.",
    category: "Cinematic",
    recommended: true,
    tags: ["hero"],
  },
  // Optional / secondary — not shown in primary grid unless expanded
  {
    style: VideoStyle.CarSketch,
    label: "Soft Resolve",
    icon: "edit",
    description: "Brief sketch that dissolves into the real photo.",
    category: "Artistic",
    tags: ["optional"],
  },
  {
    style: VideoStyle.Blueprint,
    label: "Blueprint Fade",
    icon: "ruler",
    description: "Thin blueprint lines dissolving to the real car.",
    category: "Artistic",
    tags: ["optional"],
  },
  {
    style: VideoStyle.SpeedLines,
    label: "Edge Energy",
    icon: "zap",
    description: "Faint edge streaks; car and people stay sharp.",
    category: "Transitions",
    tags: ["optional"],
  },
];

/**
 * The exact `VideoStyle` members reachable from any UI surface, derived from
 * the slate above so the two can never drift.
 *
 * Nine further enum members still have working motion recipes in the prompt
 * layer and appear on posts generated before the slate was curated, so the enum
 * keeps them. They are listed in `UNEXPOSED_VIDEO_STYLES` and are intentionally
 * NOT offered anywhere in the product.
 */
export const EXPOSED_VIDEO_STYLES: readonly VideoStyle[] = styles.map((s) => s.style);

/**
 * Reachable only through persisted posts and prompt code — never rendered as a
 * choice. Removing an entry here means adding it to `styles` above; deleting it
 * from the `VideoStyle` enum would break already-saved posts.
 */
export const UNEXPOSED_VIDEO_STYLES: readonly VideoStyle[] = [
  VideoStyle.NeonPulse,
  VideoStyle.CometStrike,
  VideoStyle.HappyDance,
  VideoStyle.JumpingForJoy,
  VideoStyle.GlitchPop,
  VideoStyle.SmokeReveal,
  VideoStyle.FireEmbers,
  VideoStyle.GraffitiReveal,
  VideoStyle.HolographicScan,
];
