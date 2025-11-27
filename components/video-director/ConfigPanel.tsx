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
    <div className="space-y-4">
      {/* Duration - Compact inline */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-white/80">Duration</h3>
        <div className="flex gap-2">
          {durations.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => handleChange('duration', value)}
              className={cn(
                'flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-all',
                values.duration === value
                  ? 'border-indigo-400 bg-indigo-500/30 text-white'
                  : 'border-white/10 bg-slate-900/50 text-indigo-100/80 hover:border-indigo-400/50'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Aspect - Compact inline */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-white/80">Aspect</h3>
        <div className="flex gap-2">
          {aspectRatios.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => handleChange('aspectPreference', value)}
              className={cn(
                'flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-all',
                values.aspectPreference === value
                  ? 'border-sky-400 bg-sky-500/30 text-white'
                  : 'border-white/10 bg-slate-900/50 text-indigo-100/80 hover:border-sky-400/50'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Quality row - Resolution + Pacing */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-white/80">Quality</h3>
          <div className="flex flex-col gap-1.5">
            {resolutions.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => handleChange('resolution', value)}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-sm font-medium transition-all',
                  values.resolution === value
                    ? 'border-fuchsia-400 bg-fuchsia-500/30 text-white'
                    : 'border-white/10 bg-slate-900/50 text-indigo-100/80 hover:border-fuchsia-400/50'
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-white/80">Motion</h3>
          <div className="flex flex-col gap-1.5">
            {pacingOptions.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => handleChange('pacing', value)}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-sm font-medium transition-all',
                  values.pacing === value
                    ? 'border-amber-400 bg-amber-500/30 text-white'
                    : 'border-white/10 bg-slate-900/50 text-indigo-100/80 hover:border-amber-400/50'
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Soundtrack - Full width */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-white/80">Soundtrack</h3>
        <div className="flex gap-2">
          {soundtracks.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => handleChange('soundtrack', value)}
              className={cn(
                'flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-all',
                values.soundtrack === value
                  ? 'border-emerald-400 bg-emerald-500/30 text-white'
                  : 'border-white/10 bg-slate-900/50 text-indigo-100/80 hover:border-emerald-400/50'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
