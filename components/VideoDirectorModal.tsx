import React, { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { VideoStyle, VideoRequestOptions } from "../types";
import { Icon } from "./Icons";
import { Button } from "./ui/Button";
import { StyleGrid } from "./video-director/StyleGrid";
import { PresetSelector } from "./video-director/PresetSelector";
import { ConfigPanel } from "./video-director/ConfigPanel";
import {
  defaultResolution,
  durations,
  presets,
  soundtracks,
  styles as videoStyles,
} from "./video-director/constants";

interface VideoDirectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectStyle: (style: VideoStyle, options: VideoRequestOptions) => void;
}

export const VideoDirectorModal: React.FC<VideoDirectorModalProps> = ({
  isOpen,
  onClose,
  onSelectStyle,
}) => {
  const [duration, setDuration] = useState<number>(durations[1].value);
  const [soundtrack, setSoundtrack] =
    useState<VideoRequestOptions["soundtrack"]>("cinematic");
  const [aspectPreference, setAspectPreference] =
    useState<VideoRequestOptions["aspectPreference"]>("auto");
  const [resolution, setResolution] =
    useState<VideoRequestOptions["resolution"]>(defaultResolution);
  const [pacing, setPacing] =
    useState<VideoRequestOptions["pacing"]>("cinematic");
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleStyleSelect = (style: VideoStyle) => {
    onSelectStyle(style, {
      durationSeconds: duration,
      soundtrack,
      aspectPreference,
      resolution,
      pacing,
    });
  };

  const selectionSummary = useMemo(() => {
    const soundtrackLabel =
      soundtracks.find((s) => s.value === soundtrack)?.label || soundtrack;
    return `${duration}s · ${soundtrackLabel} · ${
      aspectPreference === "auto" ? "auto aspect" : aspectPreference
    } · ${pacing === "snappy" ? "snappy motion" : "cinematic motion"}`;
  }, [duration, soundtrack, aspectPreference, pacing]);

  const handleConfigChange = (key: string, value: any) => {
    switch (key) {
      case "duration":
        setDuration(value);
        break;
      case "soundtrack":
        setSoundtrack(value);
        break;
      case "aspectPreference":
        setAspectPreference(value);
        break;
      case "pacing":
        setPacing(value);
        break;
    }
  };

  const handlePresetSelect = (values: (typeof presets)[number]["values"]) => {
    setDuration(values.durationSeconds);
    setSoundtrack(values.soundtrack);
    setAspectPreference(values.aspectPreference);
    setResolution(values.resolution);
    setPacing(values.pacing);
  };

  const quickPreset =
    presets.find((preset) => preset.badge === "Recommended") || presets[0];
  const quickStyle = videoStyles.find((style) => style.recommended) || videoStyles[0];

  const handleQuickGenerate = () => {
    const values = quickPreset?.values;
    const style = quickStyle?.style;
    if (!values || !style) return;

    setDuration(values.durationSeconds);
    setSoundtrack(values.soundtrack);
    setAspectPreference(values.aspectPreference);
    setResolution(values.resolution);
    setPacing(values.pacing);

    onSelectStyle(style, {
      durationSeconds: values.durationSeconds,
      soundtrack: values.soundtrack,
      aspectPreference: values.aspectPreference,
      resolution: values.resolution,
      pacing: values.pacing,
    });
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 bg-slate-950/85 backdrop-blur-md flex items-center justify-center z-50 p-4"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-labelledby="video-director-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="w-full max-w-7xl h-[90vh] bg-slate-900/95 border border-white/15 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
          >
            {/* Header */}
            <div className="flex justify-between items-center p-6 border-b border-white/10 bg-slate-900/50 backdrop-blur-sm z-10">
              <div className="flex items-center gap-4">
                <div className="p-2 bg-indigo-500/20 rounded-lg">
                  <Icon type="movie" className="w-6 h-6 text-indigo-400" />
                </div>
                <div>
                  <h2
                    id="video-director-title"
                    className="text-xl font-bold text-white"
                  >
                    AI Video Director
                  </h2>
                  <p className="text-xs text-indigo-200/70">
                    Configure your cinematic masterpiece
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <Button
                  variant="primary"
                  size="sm"
                  className="hidden sm:inline-flex items-center gap-2"
                  onClick={handleQuickGenerate}
                >
                  <Icon type="zap" className="w-4 h-4" />
                  Quick Generate
                </Button>
                <div className="hidden sm:flex items-center gap-2 text-[11px] text-indigo-100/80 bg-white/5 px-3 py-1.5 rounded-full border border-white/10">
                  <Icon type="info" className="w-3.5 h-3.5 text-indigo-300" />
                  <span className="font-medium">{selectionSummary}</span>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 hover:bg-white/10 rounded-full transition-colors text-slate-400 hover:text-white"
                  aria-label="Close"
                >
                  <Icon type="close" className="w-6 h-6" />
                </button>
              </div>
            </div>

            {/* Content - Split Pane */}
            <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
              {/* Left Panel: Config (Scrollable) */}
              <div className="w-full lg:w-[340px] flex flex-col border-r border-white/10 bg-slate-900/30 overflow-y-auto custom-scrollbar">
                <div className="p-5 space-y-5">
                  {/* Presets */}
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-300/80 mb-3">
                      Presets
                    </h3>
                    <PresetSelector
                      currentValues={{
                        duration,
                        soundtrack,
                        aspectPreference,
                        resolution,
                        pacing,
                      }}
                      onSelect={handlePresetSelect}
                    />
                  </div>

                  {/* Settings */}
                  <div className="pt-3 border-t border-white/5">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-300/80">
                        Settings
                      </h3>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px] px-2 text-indigo-300/70 hover:text-white"
                        onClick={() => {
                      setDuration(durations[1].value);
                      setSoundtrack("cinematic");
                      setAspectPreference("auto");
                      setResolution(defaultResolution);
                      setPacing("cinematic");
                    }}
                  >
                    Reset
                  </Button>
                </div>
                <ConfigPanel
                  values={{
                    duration,
                    soundtrack,
                    aspectPreference,
                    pacing,
                  }}
                  onChange={handleConfigChange}
                />
                  </div>
                </div>
              </div>

              {/* Right Panel: Style Grid (Scrollable) */}
              <div className="flex-1 flex flex-col bg-slate-950/30">
                <div className="p-6 h-full flex flex-col">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-4">
                    <div>
                      <h3 className="text-lg font-bold text-white mb-1">
                        Select a Style
                      </h3>
                      <p className="text-sm text-indigo-200/60">
                        Choose the visual theme for your video generation.
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="md:inline-flex"
                      onClick={handleQuickGenerate}
                    >
                      <Icon type="zap" className="w-4 h-4 mr-2" />
                      Quick Generate
                    </Button>
                  </div>

                  <div className="flex-1 min-h-0">
                    <StyleGrid onSelect={handleStyleSelect} />
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
