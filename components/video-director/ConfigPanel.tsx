import React from "react";
import { cn } from "../../utils/classNames";
import { triggerHapticFeedback } from "../../utils/haptics";
import {
  durations,
  soundtracks,
  aspectRatios,
  pacingOptions,
  defaultResolution,
} from "./constants";
import { VideoRequestOptions } from "../../types";

interface ConfigPanelProps {
  values: {
    duration: number;
    soundtrack: VideoRequestOptions["soundtrack"];
    aspectPreference: VideoRequestOptions["aspectPreference"];
    pacing: VideoRequestOptions["pacing"];
  };
  onChange: (key: keyof ConfigPanelProps["values"], value: any) => void;
}

export const ConfigPanel: React.FC<ConfigPanelProps> = ({ values, onChange }) => {
  const handleChange = (key: keyof ConfigPanelProps["values"], value: any) => {
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
              onClick={() => handleChange("duration", value)}
              className={cn(
                "flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-all",
                values.duration === value
                  ? "border-primary-400 bg-primary-500/20 text-white"
                  : "border-surface-800 bg-surface-900/60 text-surface-300 hover:border-primary-400/50",
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
              onClick={() => handleChange("aspectPreference", value)}
              className={cn(
                "flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-all",
                values.aspectPreference === value
                  ? "border-primary-400 bg-primary-500/20 text-white"
                  : "border-surface-800 bg-surface-900/60 text-surface-300 hover:border-primary-400/50",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Quality row - Resolution + Pacing */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-white/80">
            Motion feel (optional)
          </h3>
          <span className="text-[10px] text-white/50">
            Resolution locked at {defaultResolution}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {pacingOptions.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => handleChange("pacing", value)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-sm font-medium transition-all",
                values.pacing === value
                  ? "border-primary-400 bg-primary-500/20 text-white"
                  : "border-surface-800 bg-surface-900/60 text-surface-300 hover:border-primary-400/50",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Soundtrack - Full width */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-white/80">Soundtrack</h3>
        <div className="flex gap-2">
          {soundtracks.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => handleChange("soundtrack", value)}
              className={cn(
                "flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-all",
                values.soundtrack === value
                  ? "border-primary-400 bg-primary-500/20 text-white"
                  : "border-surface-800 bg-surface-900/60 text-surface-300 hover:border-primary-400/50",
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
