import React, { useEffect, useState } from 'react';
import { VideoStyle, VideoRequestOptions } from '../types';
import { Icon, IconProps } from './Icons';
import { triggerHapticFeedback } from '../utils/haptics';
import { Button } from './ui/Button';
import { cn } from '../utils/classNames';

interface VideoDirectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectStyle: (style: VideoStyle, options: VideoRequestOptions) => void;
}

interface StyleCardProps {
  style: VideoStyle;
  icon: IconProps['type'];
  description: string;
  onSelect: (style: VideoStyle) => void;
}

const durations = [
  { value: 4, label: '4 seconds', description: 'Perfect for looping stories and reels.' },
  { value: 6, label: '6 seconds', description: 'Adds room for dramatic reveals.' },
  { value: 8, label: '8 seconds', description: 'Balanced length for social + ads.' },
  { value: 10, label: '10 seconds', description: 'More space for cinematic pacing.' },
];

const soundtracks: Array<{ value: VideoRequestOptions['soundtrack']; label: string; description: string }> = [
  { value: 'none', label: 'No soundtrack', description: 'Silence — bring your own vibe.' },
  { value: 'celebration', label: 'Celebration beat', description: 'Upbeat claps and synth pulses.' },
  { value: 'cinematic', label: 'Cinematic swell', description: 'Ambient pads with a smooth rise.' },
  { value: 'anthemic', label: 'Anthemic hype', description: 'Modern stadium drums and buildups.' },
  { value: 'funk', label: 'Funky groove', description: 'Bass-forward groove with swagger.' },
];

const styles: { style: VideoStyle; icon: IconProps['type']; description: string }[] = [
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

const aspectRatios: Array<{ value: VideoRequestOptions['aspectPreference']; label: string; description: string }> = [
  { value: 'auto', label: 'Match photo', description: 'Auto-detect landscape or vertical.' },
  { value: '16:9', label: 'Widescreen 16:9', description: 'Best for YouTube & horizontal ads.' },
  { value: '9:16', label: 'Vertical 9:16', description: 'Ideal for Reels, Shorts, and TikTok.' },
  { value: '1:1', label: 'Square 1:1', description: 'Great for grid posts and feeds.' },
];

const resolutions: Array<{ value: VideoRequestOptions['resolution']; label: string; description: string }> = [
  { value: '720p', label: '720p', description: 'Fast render and smaller file size.' },
  { value: '1080p', label: '1080p', description: 'Sharper export for hero posts.' },
];

const pacingOptions: Array<{ value: VideoRequestOptions['pacing']; label: string; description: string }> = [
  { value: 'cinematic', label: 'Cinematic', description: 'Smooth moves and graceful easing.' },
  { value: 'snappy', label: 'Snappy', description: 'Quick cuts and energetic pacing.' },
];

const presets = [
  {
    label: 'Story mode',
    description: '9:16 · 6s · snappy · celebration · 1080p',
    values: { durationSeconds: 6, soundtrack: 'celebration' as const, aspectPreference: '9:16' as const, resolution: '1080p' as const, pacing: 'snappy' as const },
  },
  {
    label: 'Hero ad',
    description: '16:9 · 10s · cinematic · anthemic · 1080p',
    values: { durationSeconds: 10, soundtrack: 'anthemic' as const, aspectPreference: '16:9' as const, resolution: '1080p' as const, pacing: 'cinematic' as const },
  },
  {
    label: 'Square feed',
    description: '1:1 · 8s · funk · cinematic · 720p',
    values: { durationSeconds: 8, soundtrack: 'funk' as const, aspectPreference: '1:1' as const, resolution: '720p' as const, pacing: 'cinematic' as const },
  },
];

const StyleCard: React.FC<StyleCardProps> = React.memo(({ style, icon, description, onSelect }) => {
  const handleClick = () => {
    triggerHapticFeedback();
    onSelect(style);
  };

  return (
    <button
      onClick={handleClick}
      className="group flex flex-col items-center justify-center text-center p-3 bg-white/5 border border-white/10 rounded-xl aspect-square transition-all duration-200 hover:bg-indigo-500/20 hover:border-indigo-400 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-indigo-400"
      title={description}
      aria-label={`${style}: ${description}`}
    >
      <Icon type={icon} className="w-8 h-8 sm:w-10 sm:h-10 text-indigo-400 transition-colors duration-200" />
      <h3 className="mt-2 font-semibold text-white text-xs text-center break-words leading-tight">{style}</h3>
      <p className="mt-1 text-[11px] text-indigo-100/80 line-clamp-2">{description}</p>
    </button>
  );
});

export const VideoDirectorModal: React.FC<VideoDirectorModalProps> = ({ isOpen, onClose, onSelectStyle }) => {
  if (!isOpen) return null;

  const [duration, setDuration] = useState<number>(durations[1].value);
  const [soundtrack, setSoundtrack] = useState<VideoRequestOptions['soundtrack']>('celebration');
  const [aspectPreference, setAspectPreference] = useState<VideoRequestOptions['aspectPreference']>('auto');
  const [resolution, setResolution] = useState<VideoRequestOptions['resolution']>('1080p');
  const [pacing, setPacing] = useState<VideoRequestOptions['pacing']>('cinematic');

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleStyleSelect = (style: VideoStyle) => {
    onSelectStyle(style, { durationSeconds: duration, soundtrack, aspectPreference, resolution, pacing });
  };

  return (
    <div
      className="fixed inset-0 bg-slate-950/85 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="video-director-title"
    >
      <div
        className="w-full max-w-4xl bg-slate-900/90 border border-white/15 rounded-2xl shadow-2xl p-6 sm:p-8 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-6">
          <h2 id="video-director-title" className="text-2xl sm:text-3xl font-bold text-white flex items-center gap-3">
            <Icon type="movie" className="w-8 h-8 text-indigo-400" />
            AI Video Director
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
            aria-label="Close"
          >
            <Icon type="close" className="w-7 h-7" />
          </button>
        </div>

        <p className="text-center text-indigo-300 mb-6">Choose a style, duration, soundtrack, and framing — we&apos;ll handle the cinematic finishing touches.</p>

        <div className="flex flex-col gap-2 mb-5">
          <h3 className="text-sm font-semibold text-white">Presets</h3>
          <div className="grid gap-2 sm:grid-cols-3">
            {presets.map((preset) => (
              <button
                key={preset.label}
                onClick={() => {
                  triggerHapticFeedback();
                  setDuration(preset.values.durationSeconds);
                  setSoundtrack(preset.values.soundtrack);
                  setAspectPreference(preset.values.aspectPreference);
                  setResolution(preset.values.resolution);
                  setPacing(preset.values.pacing);
                }}
                className="rounded-xl border border-white/15 bg-slate-900/70 hover:border-primary-400/60 hover:bg-primary-500/10 transition-all text-left px-3 py-2"
              >
                <div className="text-sm font-semibold text-white">{preset.label}</div>
                <div className="text-[11px] text-indigo-100/80">{preset.description}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="mb-5 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-slate-900/80 p-4">
            <h3 className="text-sm font-semibold text-white mb-3">Clip duration</h3>
            <div className="grid grid-cols-2 gap-2">
              {durations.map(({ value, label, description }) => (
                <button
                  key={value}
                  onClick={() => { triggerHapticFeedback(); setDuration(value); }}
                  className={cn(
                    'flex flex-col rounded-lg border px-3 py-2 text-left transition-all',
                    duration === value ? 'border-indigo-400 bg-indigo-500/30 text-white' : 'border-white/15 bg-slate-900/70 text-indigo-100 hover:border-indigo-400/50'
                  )}
                >
                  <span className="text-sm font-semibold">{label}</span>
                  <span className="text-xs text-indigo-100/70">{description}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-slate-900/80 p-4">
            <h3 className="text-sm font-semibold text-white mb-3">Soundtrack</h3>
            <div className="grid grid-cols-1 sm:grid-cols-1 gap-2">
              {soundtracks.map(({ value, label, description }) => (
                <button
                  key={value}
                  onClick={() => { triggerHapticFeedback(); setSoundtrack(value); }}
                  className={cn(
                    'flex flex-col rounded-lg border px-3 py-2 text-left transition-all',
                    soundtrack === value ? 'border-emerald-400 bg-emerald-500/25 text-white' : 'border-white/15 bg-slate-900/70 text-indigo-100 hover:border-emerald-400/40'
                  )}
                >
                  <span className="text-sm font-semibold">{label}</span>
                  <span className="text-xs text-indigo-100/70">{description}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mb-5 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-slate-900/80 p-4">
            <h3 className="text-sm font-semibold text-white mb-3">Aspect & framing</h3>
            <div className="flex flex-col gap-2">
              {aspectRatios.map(({ value, label, description }) => (
                <button
                  key={value}
                  onClick={() => { triggerHapticFeedback(); setAspectPreference(value); }}
                  className={cn(
                    'flex flex-col rounded-lg border px-3 py-2 text-left transition-all',
                    aspectPreference === value ? 'border-sky-400 bg-sky-500/25 text-white' : 'border-white/15 bg-slate-900/70 text-indigo-100 hover:border-sky-400/40'
                  )}
                >
                  <span className="text-sm font-semibold">{label}</span>
                  <span className="text-xs text-indigo-100/70">{description}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-slate-900/80 p-4">
            <h3 className="text-sm font-semibold text-white mb-3">Resolution</h3>
            <div className="flex flex-col gap-2">
              {resolutions.map(({ value, label, description }) => (
                <button
                  key={value}
                  onClick={() => { triggerHapticFeedback(); setResolution(value); }}
                  className={cn(
                    'flex flex-col rounded-lg border px-3 py-2 text-left transition-all',
                    resolution === value ? 'border-fuchsia-400 bg-fuchsia-500/25 text-white' : 'border-white/15 bg-slate-900/70 text-indigo-100 hover:border-fuchsia-400/40'
                  )}
                >
                  <span className="text-sm font-semibold">{label}</span>
                  <span className="text-xs text-indigo-100/70">{description}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-slate-900/80 p-4">
            <h3 className="text-sm font-semibold text-white mb-3">Motion pacing</h3>
            <div className="flex flex-col gap-2">
              {pacingOptions.map(({ value, label, description }) => (
                <button
                  key={value}
                  onClick={() => { triggerHapticFeedback(); setPacing(value); }}
                  className={cn(
                    'flex flex-col rounded-lg border px-3 py-2 text-left transition-all',
                    pacing === value ? 'border-amber-400 bg-amber-500/25 text-white' : 'border-white/15 bg-slate-900/70 text-indigo-100 hover:border-amber-400/40'
                  )}
                >
                  <span className="text-sm font-semibold">{label}</span>
                  <span className="text-xs text-indigo-100/70">{description}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border border-white/10 rounded-xl bg-slate-900/80 px-4 py-3 mb-5 text-xs text-indigo-100/80">
          <span>Queued clips play back-to-back; you can prepare multiple stylings while one renders.</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setDuration(durations[1].value);
              setSoundtrack('celebration');
              setAspectPreference('auto');
              setResolution('1080p');
              setPacing('cinematic');
            }}
          >
            Reset
          </Button>
        </div>

        <div className="overflow-y-auto max-h-[50vh] pr-2 -mr-2">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {styles.map(({ style, icon, description }) => (
                <StyleCard key={style} style={style} icon={icon} description={description} onSelect={handleStyleSelect} />
            ))}
            </div>
        </div>
      </div>
    </div>
  );
};
