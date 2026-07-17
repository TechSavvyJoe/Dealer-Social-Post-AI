import { VideoStyle, VideoRequestOptions } from "../../types";
import { IconProps } from "../Icons";

export type VideoStyleMeta = {
  style: VideoStyle;
  icon: IconProps["type"];
  description: string;
  category: "Cinematic" | "Modern" | "Fun" | "Artistic" | "Transitions";
  recommended?: boolean;
  tags?: string[];
};

export type VideoPreset = {
  label: string;
  description: string;
  badge?: string;
  platform?: string;
  values: {
    durationSeconds: number;
    soundtrack: VideoRequestOptions["soundtrack"];
    aspectPreference: VideoRequestOptions["aspectPreference"];
    resolution: VideoRequestOptions["resolution"];
    pacing: VideoRequestOptions["pacing"];
  };
};

// 720p supports every exposed 4s/6s preset. Google restricts 1080p to 8s,
// so selecting it implicitly would make the quick presets invalid.
export const defaultResolution: VideoRequestOptions["resolution"] = "720p";

export const durations = [
  {
    value: 4,
    label: "4s",
    description: "Perfect for looping stories and reels.",
  },
  { value: 6, label: "6s", description: "Adds room for dramatic reveals." },
];

export const soundtracks: Array<{
  value: VideoRequestOptions["soundtrack"];
  label: string;
  description: string;
}> = [
  {
    value: "cinematic",
    label: "Music On",
    description: "Polished soundtrack that auto-matches the pacing.",
  },
  {
    value: "none",
    label: "No Music",
    description: "Generate a silent cut you can score later.",
  },
];

export const aspectRatios: Array<{
  value: VideoRequestOptions["aspectPreference"];
  label: string;
  description: string;
}> = [
  {
    value: "auto",
    label: "Auto",
    description: "Match photo + letterbox for Veo (recommended).",
  },
  {
    value: "9:16",
    label: "9:16",
    description: "Ideal for Reels, Shorts, and TikTok.",
  },
  {
    value: "16:9",
    label: "16:9",
    description: "Best for YouTube & horizontal ads.",
  },
  {
    value: "1:1",
    label: "1:1",
    description: "Square feed posts and carousels.",
  },
];

export const pacingOptions: Array<{
  value: VideoRequestOptions["pacing"];
  label: string;
  description: string;
}> = [
  {
    value: "cinematic",
    label: "Cinematic",
    description: "Smooth moves and graceful easing.",
  },
  {
    value: "snappy",
    label: "Snappy",
    description: "Quick cuts and energetic pacing.",
  },
];

/**
 * Recommended styles are photo-locked micro-motion only.
 * Avoid "reveal / materialize / zoom" as primary picks — those morph.
 */
export const styles: VideoStyleMeta[] = [
  {
    style: VideoStyle.GoldenRadiance,
    icon: "sun",
    description: "Warm light sweep on the real paint and faces.",
    category: "Cinematic",
    recommended: true,
    tags: ["premium", "highlight"],
  },
  {
    style: VideoStyle.PartyTime,
    icon: "confetti",
    description: "Tasteful confetti in empty space; photo stays locked.",
    category: "Fun",
    recommended: true,
    tags: ["celebration"],
  },
  {
    style: VideoStyle.VintageFilm,
    icon: "film",
    description: "Film grain + micro handheld over the same frame.",
    category: "Artistic",
    recommended: true,
    tags: ["retro"],
  },
  {
    style: VideoStyle.Spotlight,
    icon: "sun",
    description: "Soft spotlight brightens the existing subjects.",
    category: "Cinematic",
    recommended: true,
    tags: ["premium"],
  },
  {
    style: VideoStyle.EpicReveal,
    icon: "starburst",
    description: "Locked framing with gentle light wrap — no hard zoom.",
    category: "Cinematic",
    tags: ["hero", "premium"],
  },
  {
    style: VideoStyle.FireEmbers,
    icon: "fire",
    description: "Soft rising embers in empty space only.",
    category: "Cinematic",
    tags: ["dramatic"],
  },
  {
    style: VideoStyle.CarSketch,
    icon: "edit",
    description: "Brief sketch overlay that dissolves into the real photo.",
    category: "Artistic",
    tags: ["hand-drawn"],
  },
  {
    style: VideoStyle.Blueprint,
    icon: "ruler",
    description: "Thin blueprint lines over the real delivery photo.",
    category: "Artistic",
    tags: ["technical"],
  },
  {
    style: VideoStyle.HolographicScan,
    icon: "cpu-chip",
    description: "Soft scan lines that resolve to the same photo.",
    category: "Modern",
    tags: ["tech", "futuristic"],
  },
  {
    style: VideoStyle.NeonPulse,
    icon: "zap",
    description: "Soft edge glow pulse on existing car lines.",
    category: "Modern",
    tags: ["digital"],
  },
  {
    style: VideoStyle.GlitchPop,
    icon: "zap",
    description: "One tasteful micro-glitch that resolves immediately.",
    category: "Modern",
    tags: ["trendy"],
  },
  {
    style: VideoStyle.LiquidChrome,
    icon: "droplet",
    description: "Specular roll across existing paint only.",
    category: "Modern",
    tags: ["premium", "sleek"],
  },
  {
    style: VideoStyle.CometStrike,
    icon: "shooting-star",
    description: "Stardust in empty background regions only.",
    category: "Transitions",
    tags: ["sparkle"],
  },
  {
    style: VideoStyle.SmokeReveal,
    icon: "cloud",
    description: "Edge haze that clears to the same delivery photo.",
    category: "Transitions",
    tags: ["moody"],
  },
  {
    style: VideoStyle.SpeedLines,
    icon: "zap",
    description: "Faint edge streaks; car and people stay sharp.",
    category: "Transitions",
    tags: ["speed"],
  },
  {
    style: VideoStyle.RoadTrip,
    icon: "map",
    description: "Gentle background parallax; hero still locked.",
    category: "Transitions",
    tags: ["story"],
  },
  {
    style: VideoStyle.HappyDance,
    icon: "music-note",
    description: "Micro frame pulse — people stay planted.",
    category: "Fun",
    tags: ["character"],
  },
  {
    style: VideoStyle.JumpingForJoy,
    icon: "arrow-up",
    description: "Energy on existing smiles only — no invented jump.",
    category: "Fun",
    tags: ["character"],
  },
  {
    style: VideoStyle.StickerSlap,
    icon: "tag",
    description: "Small badges in empty corners only.",
    category: "Fun",
    tags: ["playful"],
  },
  {
    style: VideoStyle.GraffitiReveal,
    icon: "swatch",
    description: "Brief color wash at edges; composition unchanged.",
    category: "Fun",
    tags: ["urban"],
  },
];

export const styleCategories = [
  "Cinematic",
  "Modern",
  "Fun",
  "Artistic",
  "Transitions",
] as const;

export const presets: VideoPreset[] = [
  {
    label: "Instagram Reels",
    platform: "IG",
    badge: "Recommended",
    description: "Auto · 6s · music · cinematic (letterboxed)",
    values: {
      durationSeconds: 6,
      soundtrack: "cinematic",
      aspectPreference: "auto",
      resolution: defaultResolution,
      pacing: "cinematic",
    },
  },
  {
    label: "TikTok Hype",
    platform: "TikTok",
    description: "Auto · 6s · music · cinematic",
    values: {
      durationSeconds: 6,
      soundtrack: "cinematic",
      aspectPreference: "auto",
      resolution: defaultResolution,
      pacing: "cinematic",
    },
  },
  {
    label: "LinkedIn Pro",
    platform: "LinkedIn",
    description: "16:9 · 6s · no music · cinematic",
    values: {
      durationSeconds: 6,
      soundtrack: "none",
      aspectPreference: "16:9",
      resolution: defaultResolution,
      pacing: "cinematic",
    },
  },
  {
    label: "YouTube Short",
    platform: "YouTube",
    description: "Auto · 6s · music · cinematic",
    values: {
      durationSeconds: 6,
      soundtrack: "cinematic",
      aspectPreference: "auto",
      resolution: defaultResolution,
      pacing: "cinematic",
    },
  },
  {
    label: "Square Carousel",
    platform: "Instagram",
    description: "Auto · 4s · music · cinematic",
    values: {
      durationSeconds: 4,
      soundtrack: "cinematic",
      aspectPreference: "auto",
      resolution: defaultResolution,
      pacing: "cinematic",
    },
  },
  {
    label: "Quick Loop",
    badge: "Fast",
    description: "Auto · 4s · music · cinematic",
    values: {
      durationSeconds: 4,
      soundtrack: "cinematic",
      aspectPreference: "auto",
      resolution: defaultResolution,
      pacing: "cinematic",
    },
  },
  {
    label: "Showroom Highlight",
    badge: "Cinematic",
    description: "16:9 · 6s · music · cinematic",
    values: {
      durationSeconds: 6,
      soundtrack: "cinematic",
      aspectPreference: "16:9",
      resolution: defaultResolution,
      pacing: "cinematic",
    },
  },
  {
    label: "Silent Story",
    description: "Auto · 6s · no music · cinematic",
    values: {
      durationSeconds: 6,
      soundtrack: "none",
      aspectPreference: "auto",
      resolution: defaultResolution,
      pacing: "cinematic",
    },
  },
];
