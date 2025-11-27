import { VideoStyle, VideoRequestOptions } from '../../types';
import { IconProps } from '../Icons';

export type VideoStyleMeta = {
  style: VideoStyle;
  icon: IconProps['type'];
  description: string;
  category: 'Cinematic' | 'Modern' | 'Fun' | 'Artistic' | 'Transitions';
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
    soundtrack: VideoRequestOptions['soundtrack'];
    aspectPreference: VideoRequestOptions['aspectPreference'];
    resolution: VideoRequestOptions['resolution'];
    pacing: VideoRequestOptions['pacing'];
  };
};

export const defaultResolution: VideoRequestOptions['resolution'] = '1080p';

export const durations = [
  { value: 4, label: '4s', description: 'Perfect for looping stories and reels.' },
  { value: 6, label: '6s', description: 'Adds room for dramatic reveals.' },
];

export const soundtracks: Array<{ value: VideoRequestOptions['soundtrack']; label: string; description: string }> = [
  { value: 'cinematic', label: 'Music On', description: 'Polished soundtrack that auto-matches the pacing.' },
  { value: 'none', label: 'No Music', description: 'Generate a silent cut you can score later.' },
];

export const aspectRatios: Array<{ value: VideoRequestOptions['aspectPreference']; label: string; description: string }> = [
  { value: 'auto', label: 'Auto', description: 'Auto-detect landscape or vertical.' },
  { value: '9:16', label: '9:16', description: 'Ideal for Reels, Shorts, and TikTok.' },
  { value: '16:9', label: '16:9', description: 'Best for YouTube & horizontal ads.' },
  { value: '1:1', label: '1:1', description: 'Square feed posts and carousels.' },
];

export const pacingOptions: Array<{ value: VideoRequestOptions['pacing']; label: string; description: string }> = [
  { value: 'cinematic', label: 'Cinematic', description: 'Smooth moves and graceful easing.' },
  { value: 'snappy', label: 'Snappy', description: 'Quick cuts and energetic pacing.' },
];

export const styles: VideoStyleMeta[] = [
  { style: VideoStyle.EpicReveal, icon: 'starburst', description: 'A cinematic, slow zoom with dramatic lens flares.', category: 'Cinematic', recommended: true, tags: ['hero', 'premium'] },
  { style: VideoStyle.GoldenRadiance, icon: 'sun', description: 'A luxurious sweep of golden light makes the car shine.', category: 'Cinematic', recommended: true, tags: ['premium', 'highlight'] },
  { style: VideoStyle.Spotlight, icon: 'sun', description: 'A theatrical spotlight scans and finds the subjects.', category: 'Cinematic', tags: ['reveal'] },
  { style: VideoStyle.FireEmbers, icon: 'fire', description: 'Epic, rising embers create a powerful, fiery mood.', category: 'Cinematic', tags: ['dramatic'] },
  { style: VideoStyle.VintageFilm, icon: 'film', description: 'A retro 8mm look with film grain and light leaks.', category: 'Artistic', tags: ['retro'] },
  { style: VideoStyle.CarSketch, icon: 'edit', description: 'An artistic reveal, sketching the scene onto the screen.', category: 'Artistic', tags: ['hand-drawn'] },
  { style: VideoStyle.Blueprint, icon: 'ruler', description: 'A technical drawing animates and becomes the photo.', category: 'Artistic', tags: ['technical'] },
  { style: VideoStyle.HolographicScan, icon: 'cpu-chip', description: 'A techy, sci-fi hologram materializes the image.', category: 'Modern', recommended: true, tags: ['tech', 'futuristic'] },
  { style: VideoStyle.NeonPulse, icon: 'zap', description: 'A futuristic animation with glowing neon lines.', category: 'Modern', tags: ['digital'] },
  { style: VideoStyle.GlitchPop, icon: 'zap', description: 'A modern, trendy effect with digital glitches and static.', category: 'Modern', tags: ['trendy'] },
  { style: VideoStyle.LiquidChrome, icon: 'droplet', description: 'A futuristic reveal with flowing liquid metal.', category: 'Modern', tags: ['premium', 'sleek'] },
  { style: VideoStyle.CometStrike, icon: 'shooting-star', description: 'A magical reveal with a sparkling streak of light.', category: 'Transitions', tags: ['reveal'] },
  { style: VideoStyle.SmokeReveal, icon: 'cloud', description: 'A cool reveal from a cloud of colored smoke.', category: 'Transitions', tags: ['moody'] },
  { style: VideoStyle.SpeedLines, icon: 'zap', description: 'Dynamic motion lines rush past for a speedy feel.', category: 'Transitions', tags: ['speed'] },
  { style: VideoStyle.RoadTrip, icon: 'map', description: 'An animated map route hints at adventures ahead.', category: 'Transitions', tags: ['story'] },
  { style: VideoStyle.PartyTime, icon: 'confetti', description: 'A vibrant celebration with falling confetti.', category: 'Fun', recommended: true, tags: ['celebration'] },
  { style: VideoStyle.HappyDance, icon: 'music-note', description: 'Customer does a happy dance to celebrate.', category: 'Fun', tags: ['character'] },
  { style: VideoStyle.JumpingForJoy, icon: 'arrow-up', description: 'Customer jumps for joy in an energetic burst.', category: 'Fun', tags: ['character'] },
  { style: VideoStyle.StickerSlap, icon: 'tag', description: 'Fun, animated stickers slap onto the screen.', category: 'Fun', tags: ['playful'] },
  { style: VideoStyle.GraffitiReveal, icon: 'swatch', description: 'A cool, urban reveal with spray paint art.', category: 'Fun', tags: ['urban'] },
];

export const styleCategories = ['Cinematic', 'Modern', 'Fun', 'Artistic', 'Transitions'] as const;

export const presets: VideoPreset[] = [
  {
    label: 'Instagram Reels',
    platform: 'IG',
    badge: 'Recommended',
    description: '9:16 · 6s · music · snappy',
    values: { durationSeconds: 6, soundtrack: 'cinematic', aspectPreference: '9:16', resolution: defaultResolution, pacing: 'snappy' },
  },
  {
    label: 'TikTok Hype',
    platform: 'TikTok',
    description: '9:16 · 6s · music · snappy',
    values: { durationSeconds: 6, soundtrack: 'cinematic', aspectPreference: '9:16', resolution: defaultResolution, pacing: 'snappy' },
  },
  {
    label: 'LinkedIn Pro',
    platform: 'LinkedIn',
    description: '16:9 · 6s · no music · cinematic',
    values: { durationSeconds: 6, soundtrack: 'none', aspectPreference: '16:9', resolution: defaultResolution, pacing: 'cinematic' },
  },
  {
    label: 'YouTube Short',
    platform: 'YouTube',
    description: '9:16 · 6s · music · cinematic',
    values: { durationSeconds: 6, soundtrack: 'cinematic', aspectPreference: '9:16', resolution: defaultResolution, pacing: 'cinematic' },
  },
  {
    label: 'Square Carousel',
    platform: 'Instagram',
    description: '1:1 · 4s · music · snappy',
    values: { durationSeconds: 4, soundtrack: 'cinematic', aspectPreference: '1:1', resolution: defaultResolution, pacing: 'snappy' },
  },
  {
    label: 'Quick Loop',
    badge: 'Fast',
    description: 'Auto · 4s · music · snappy',
    values: { durationSeconds: 4, soundtrack: 'cinematic', aspectPreference: 'auto', resolution: defaultResolution, pacing: 'snappy' },
  },
  {
    label: 'Showroom Highlight',
    badge: 'Cinematic',
    description: '16:9 · 6s · music · cinematic',
    values: { durationSeconds: 6, soundtrack: 'cinematic', aspectPreference: '16:9', resolution: defaultResolution, pacing: 'cinematic' },
  },
  {
    label: 'Silent Story',
    description: '9:16 · 6s · no music · cinematic',
    values: { durationSeconds: 6, soundtrack: 'none', aspectPreference: '9:16', resolution: defaultResolution, pacing: 'cinematic' },
  },
];
