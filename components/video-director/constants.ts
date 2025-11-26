import { VideoStyle, VideoRequestOptions } from '../../types';
import { IconProps } from '../Icons';

export const durations = [
  { value: 4, label: '4 seconds', description: 'Perfect for looping stories and reels.' },
  { value: 6, label: '6 seconds', description: 'Adds room for dramatic reveals.' },
];

export const soundtracks: Array<{ value: VideoRequestOptions['soundtrack']; label: string; description: string }> = [
  { value: 'celebration', label: 'Celebration beat', description: 'Upbeat claps and synth pulses.' },
  { value: 'cinematic', label: 'Cinematic swell', description: 'Ambient pads with a smooth rise.' },
  { value: 'none', label: 'No soundtrack', description: 'Silence — bring your own vibe.' },
];

export const styles: { style: VideoStyle; icon: IconProps['type']; description: string }[] = [
  { style: VideoStyle.EpicReveal, icon: 'starburst', description: 'A cinematic, slow zoom with dramatic lens flares.' },
  { style: VideoStyle.PartyTime, icon: 'confetti', description: 'A vibrant celebration with falling confetti.' },
  { style: VideoStyle.GoldenRadiance, icon: 'sun', description: 'A luxurious sweep of golden light makes the car shine.' },
  { style: VideoStyle.NeonPulse, icon: 'zap', description: 'A futuristic animation with glowing neon lines.' },
  { style: VideoStyle.SmokeReveal, icon: 'cloud', description: 'A cool reveal from a cloud of colored smoke.' },
  { style: VideoStyle.FireEmbers, icon: 'fire', description: 'Epic, rising embers create a powerful, fiery mood.' },
  { style: VideoStyle.SpeedLines, icon: 'zap', description: 'Dynamic motion lines rush past for a speedy feel.' },
  { style: VideoStyle.VintageFilm, icon: 'film', description: 'A retro 8mm look with film grain and light leaks.' },
  { style: VideoStyle.CometStrike, icon: 'shooting-star', description: 'A magical reveal with a sparkling streak of light.' },
  { style: VideoStyle.GlitchPop, icon: 'zap', description: 'A modern, trendy effect with digital glitches and static.' },
  { style: VideoStyle.Spotlight, icon: 'sun', description: 'A theatrical spotlight scans and finds the subjects.' },
  { style: VideoStyle.CarSketch, icon: 'edit', description: 'An artistic reveal, sketching the scene onto the screen.' },
  { style: VideoStyle.HappyDance, icon: 'music-note', description: 'Customer does a happy dance to celebrate.' },
  { style: VideoStyle.JumpingForJoy, icon: 'arrow-up', description: 'Customer jumps for joy in an energetic burst.' },
  { style: VideoStyle.LiquidChrome, icon: 'droplet', description: 'A futuristic reveal with flowing liquid metal.' },
  { style: VideoStyle.StickerSlap, icon: 'tag', description: 'Fun, animated stickers slap onto the screen.' },
  { style: VideoStyle.GraffitiReveal, icon: 'swatch', description: 'A cool, urban reveal with spray paint art.' },
  { style: VideoStyle.HolographicScan, icon: 'cpu-chip', description: 'A techy, sci-fi hologram materializes the image.' },
  { style: VideoStyle.RoadTrip, icon: 'map', description: 'An animated map route hints at adventures ahead.' },
  { style: VideoStyle.Blueprint, icon: 'ruler', description: 'A technical drawing animates and becomes the photo.' },
];

export const aspectRatios: Array<{ value: VideoRequestOptions['aspectPreference']; label: string; description: string }> = [
  { value: 'auto', label: 'Match photo', description: 'Auto-detect landscape or vertical.' },
  { value: '9:16', label: 'Vertical', description: 'Ideal for Reels, Shorts, and TikTok.' },
  { value: '16:9', label: 'Widescreen', description: 'Best for YouTube & horizontal ads.' },
];

export const resolutions: Array<{ value: VideoRequestOptions['resolution']; label: string; description: string }> = [
  { value: '720p', label: '720p', description: 'Fast render and smaller file size.' },
  { value: '1080p', label: '1080p', description: 'Sharper export for hero posts.' },
];

export const pacingOptions: Array<{ value: VideoRequestOptions['pacing']; label: string; description: string }> = [
  { value: 'cinematic', label: 'Cinematic', description: 'Smooth moves and graceful easing.' },
  { value: 'snappy', label: 'Snappy', description: 'Quick cuts and energetic pacing.' },
];

export const presets = [
  {
    label: 'Story mode',
    description: '9:16 · 6s · celebration · snappy',
    values: { durationSeconds: 6, soundtrack: 'celebration' as const, aspectPreference: '9:16' as const, resolution: '1080p' as const, pacing: 'snappy' as const },
  },
  {
    label: 'Hero widescreen',
    description: '16:9 · 6s · cinematic · 1080p',
    values: { durationSeconds: 6, soundtrack: 'cinematic' as const, aspectPreference: '16:9' as const, resolution: '1080p' as const, pacing: 'cinematic' as const },
  },
];
