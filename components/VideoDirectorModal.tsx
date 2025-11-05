import React, { useState } from 'react';
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
  onSelect: (style: VideoStyle) => void;
}

const durations = [
  { value: 4, label: '4 seconds', description: 'Perfect for quick social loops.' },
  { value: 6, label: '6 seconds', description: 'Adds room for dramatic reveals.' },
];

const soundtracks: Array<{ value: VideoRequestOptions['soundtrack']; label: string; description: string }> = [
  { value: 'none', label: 'No soundtrack', description: 'Silence — bring your own vibe.' },
  { value: 'celebration', label: 'Celebration beat', description: 'Upbeat claps and synth pulses.' },
  { value: 'cinematic', label: 'Cinematic swell', description: 'Ambient pads with a smooth rise.' },
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

const StyleCard: React.FC<StyleCardProps> = React.memo(({ style, icon, onSelect }) => {
  const handleClick = () => {
    triggerHapticFeedback();
    onSelect(style);
  };

  return (
    <button
      onClick={handleClick}
      className="group flex flex-col items-center justify-center text-center p-3 bg-white/5 border border-white/10 rounded-xl aspect-square transition-all duration-200 hover:bg-indigo-500/20 hover:border-indigo-400 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-indigo-400"
      title={style}
    >
      <Icon type={icon} className="w-8 h-8 sm:w-10 sm:h-10 text-indigo-400 transition-colors duration-200" />
      <h3 className="mt-2 font-semibold text-white text-xs text-center break-words">{style}</h3>
    </button>
  );
});

export const VideoDirectorModal: React.FC<VideoDirectorModalProps> = ({ isOpen, onClose, onSelectStyle }) => {
  if (!isOpen) return null;

  const [duration, setDuration] = useState<number>(durations[0].value);
  const [soundtrack, setSoundtrack] = useState<VideoRequestOptions['soundtrack']>('celebration');

  const handleStyleSelect = (style: VideoStyle) => {
    onSelectStyle(style, { durationSeconds: duration, soundtrack });
  };

  return (
    <div
      className="fixed inset-0 bg-slate-950/80 backdrop-blur-lg flex items-center justify-center z-50 p-4 animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="video-director-title"
    >
      <div
        className="w-full max-w-4xl bg-white/10 border border-white/20 rounded-2xl shadow-2xl p-6 sm:p-8 flex flex-col"
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

        <p className="text-center text-indigo-300 mb-6">Choose a style, duration, and soundtrack — we&apos;ll handle the cinematic finishing touches.</p>

        <div className="mb-5 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h3 className="text-sm font-semibold text-white mb-3">Clip duration</h3>
            <div className="flex flex-col gap-2">
              {durations.map(({ value, label, description }) => (
                <button
                  key={value}
                  onClick={() => { triggerHapticFeedback(); setDuration(value); }}
                  className={cn(
                    'flex flex-col rounded-lg border px-3 py-2 text-left transition-all',
                    duration === value ? 'border-indigo-400 bg-indigo-500/20 text-white' : 'border-white/10 bg-white/5 text-indigo-100 hover:border-indigo-400/50'
                  )}
                >
                  <span className="text-sm font-semibold">{label}</span>
                  <span className="text-xs text-indigo-100/70">{description}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h3 className="text-sm font-semibold text-white mb-3">Soundtrack</h3>
            <div className="flex flex-col gap-2">
              {soundtracks.map(({ value, label, description }) => (
                <button
                  key={value}
                  onClick={() => { triggerHapticFeedback(); setSoundtrack(value); }}
                  className={cn(
                    'flex flex-col rounded-lg border px-3 py-2 text-left transition-all',
                    soundtrack === value ? 'border-emerald-400 bg-emerald-500/20 text-white' : 'border-white/10 bg-white/5 text-indigo-100 hover:border-emerald-400/40'
                  )}
                >
                  <span className="text-sm font-semibold">{label}</span>
                  <span className="text-xs text-indigo-100/70">{description}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border border-white/5 rounded-xl bg-white/5 px-4 py-3 mb-5 text-xs text-indigo-100/80">
          <span>Queued clips play back-to-back; you can prepare multiple stylings while one renders.</span>
          <Button variant="ghost" size="sm" onClick={() => { setDuration(4); setSoundtrack('celebration'); }}>Reset</Button>
        </div>

        <div className="overflow-y-auto max-h-[50vh] pr-2 -mr-2">
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
            {styles.map(({ style, icon }) => (
                <StyleCard key={style} style={style} icon={icon} onSelect={handleStyleSelect} />
            ))}
            </div>
        </div>
      </div>
    </div>
  );
};
