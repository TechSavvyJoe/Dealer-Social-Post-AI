import React from 'react';
import { cn } from '../../utils/classNames';
import { triggerHapticFeedback } from '../../utils/haptics';
import { presets } from './constants';
import { VideoRequestOptions } from '../../types';

interface PresetSelectorProps {
  currentValues: {
    duration: number;
    soundtrack: VideoRequestOptions['soundtrack'];
    aspectPreference: VideoRequestOptions['aspectPreference'];
    resolution: VideoRequestOptions['resolution'];
    pacing: VideoRequestOptions['pacing'];
  };
  onSelect: (values: typeof presets[number]['values']) => void;
}

export const PresetSelector: React.FC<PresetSelectorProps> = ({ currentValues, onSelect }) => {
  const matchesPreset = (preset: (typeof presets)[number]) => {
    const { values } = preset;
    return (
      values.durationSeconds === currentValues.duration &&
      values.soundtrack === currentValues.soundtrack &&
      values.aspectPreference === currentValues.aspectPreference &&
      values.resolution === currentValues.resolution &&
      values.pacing === currentValues.pacing
    );
  };

  return (
    <div className="flex flex-col gap-2 mb-5">
      <h3 className="text-sm font-semibold text-white">Presets</h3>
      <div className="grid gap-2 sm:grid-cols-3">
        {presets.map((preset) => (
          <button
            key={preset.label}
            onClick={() => {
              triggerHapticFeedback();
              onSelect(preset.values);
            }}
            className={cn(
              "rounded-xl border border-white/15 bg-slate-900/70 hover:border-primary-400/60 hover:bg-primary-500/10 transition-all text-left px-3 py-2",
              matchesPreset(preset) && "border-primary-400 bg-primary-500/10 shadow-[0_0_0_1px_rgba(129,140,248,0.35)]"
            )}
          >
            <div className="text-sm font-semibold text-white">{preset.label}</div>
            <div className="text-[11px] text-indigo-100/80">{preset.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
};
