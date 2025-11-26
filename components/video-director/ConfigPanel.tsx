import React from 'react';
import { cn } from '../../utils/classNames';
import { triggerHapticFeedback } from '../../utils/haptics';
import { durations, soundtracks, aspectRatios, resolutions, pacingOptions } from './constants';
import { VideoRequestOptions } from '../../types';

interface ConfigPanelProps {
  values: {
    duration: number;
    soundtrack: VideoRequestOptions['soundtrack'];
    aspectPreference: VideoRequestOptions['aspectPreference'];
    resolution: VideoRequestOptions['resolution'];
    pacing: VideoRequestOptions['pacing'];
  };
  onChange: (key: keyof ConfigPanelProps['values'], value: any) => void;
}

export const ConfigPanel: React.FC<ConfigPanelProps> = ({ values, onChange }) => {
  const handleChange = (key: keyof ConfigPanelProps['values'], value: any) => {
    triggerHapticFeedback();
    onChange(key, value);
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-slate-900/80 p-4">
          <h3 className="text-sm font-semibold text-white mb-3">Clip duration</h3>
          <div className="grid grid-cols-2 gap-2">
            {durations.map(({ value, label, description }) => (
              <button
                key={value}
                onClick={() => handleChange('duration', value)}
                className={cn(
                  'flex flex-col rounded-lg border px-3 py-2 text-left transition-all',
                  values.duration === value ? 'border-indigo-400 bg-indigo-500/30 text-white' : 'border-white/15 bg-slate-900/70 text-indigo-100 hover:border-indigo-400/50'
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
          <div className="grid grid-cols-1 gap-2">
            {soundtracks.map(({ value, label, description }) => (
              <button
                key={value}
                onClick={() => handleChange('soundtrack', value)}
                className={cn(
                  'flex flex-col rounded-lg border px-3 py-2 text-left transition-all',
                  values.soundtrack === value ? 'border-emerald-400 bg-emerald-500/25 text-white' : 'border-white/15 bg-slate-900/70 text-indigo-100 hover:border-emerald-400/40'
                )}
              >
                <span className="text-sm font-semibold">{label}</span>
                <span className="text-xs text-indigo-100/70">{description}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-white/10 bg-slate-900/80 p-4">
          <h3 className="text-sm font-semibold text-white mb-3">Aspect</h3>
          <div className="flex flex-col gap-2">
            {aspectRatios.map(({ value, label, description }) => (
              <button
                key={value}
                onClick={() => handleChange('aspectPreference', value)}
                className={cn(
                  'flex flex-col rounded-lg border px-3 py-2 text-left transition-all',
                  values.aspectPreference === value ? 'border-sky-400 bg-sky-500/25 text-white' : 'border-white/15 bg-slate-900/70 text-indigo-100 hover:border-sky-400/40'
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
                onClick={() => handleChange('resolution', value)}
                className={cn(
                  'flex flex-col rounded-lg border px-3 py-2 text-left transition-all',
                  values.resolution === value ? 'border-fuchsia-400 bg-fuchsia-500/25 text-white' : 'border-white/15 bg-slate-900/70 text-indigo-100 hover:border-fuchsia-400/40'
                )}
              >
                <span className="text-sm font-semibold">{label}</span>
                <span className="text-xs text-indigo-100/70">{description}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-slate-900/80 p-4">
          <h3 className="text-sm font-semibold text-white mb-3">Motion</h3>
          <div className="flex flex-col gap-2">
            {pacingOptions.map(({ value, label, description }) => (
              <button
                key={value}
                onClick={() => handleChange('pacing', value)}
                className={cn(
                  'flex flex-col rounded-lg border px-3 py-2 text-left transition-all',
                  values.pacing === value ? 'border-amber-400 bg-amber-500/25 text-white' : 'border-white/15 bg-slate-900/70 text-indigo-100 hover:border-amber-400/40'
                )}
              >
                <span className="text-sm font-semibold">{label}</span>
                <span className="text-xs text-indigo-100/70">{description}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
