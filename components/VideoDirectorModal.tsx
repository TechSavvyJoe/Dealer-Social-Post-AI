import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { VideoStyle, VideoRequestOptions } from '../types';
import { Icon } from './Icons';
import { Button } from './ui/Button';
import { StyleGrid } from './video-director/StyleGrid';
import { PresetSelector } from './video-director/PresetSelector';
import { ConfigPanel } from './video-director/ConfigPanel';
import { durations, presets } from './video-director/constants';

interface VideoDirectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectStyle: (style: VideoStyle, options: VideoRequestOptions) => void;
}

export const VideoDirectorModal: React.FC<VideoDirectorModalProps> = ({ isOpen, onClose, onSelectStyle }) => {
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

  const selectionSummary = useMemo(() => {
    return `${duration}s · ${soundtrack === 'none' ? 'no soundtrack' : soundtrack} · ${aspectPreference === 'auto' ? 'auto aspect' : aspectPreference} · ${resolution} · ${pacing}`;
  }, [duration, soundtrack, aspectPreference, resolution, pacing]);

  const handleConfigChange = (key: string, value: any) => {
    switch (key) {
      case 'duration': setDuration(value); break;
      case 'soundtrack': setSoundtrack(value); break;
      case 'aspectPreference': setAspectPreference(value); break;
      case 'resolution': setResolution(value); break;
      case 'pacing': setPacing(value); break;
    }
  };

  const handlePresetSelect = (values: typeof presets[number]['values']) => {
    setDuration(values.durationSeconds);
    setSoundtrack(values.soundtrack);
    setAspectPreference(values.aspectPreference);
    setResolution(values.resolution);
    setPacing(values.pacing);
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
                  <h2 id="video-director-title" className="text-xl font-bold text-white">AI Video Director</h2>
                  <p className="text-xs text-indigo-200/70">Configure your cinematic masterpiece</p>
                </div>
              </div>
              
              <div className="flex items-center gap-4">
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
              
              {/* Left Panel: Preview & Config (Scrollable) */}
              <div className="w-full lg:w-[400px] xl:w-[450px] flex flex-col border-r border-white/10 bg-slate-900/30 overflow-y-auto custom-scrollbar">
                <div className="p-6 space-y-8">
                  
                  {/* Live Preview Placeholder */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-300/80">Live Preview</h3>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">AI Simulation</span>
                    </div>
                    <div className="aspect-video w-full bg-slate-950 rounded-xl border border-white/10 relative overflow-hidden group">
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="text-center space-y-2 opacity-50 group-hover:opacity-100 transition-opacity">
                          <Icon type="play" className="w-12 h-12 text-white/20 mx-auto" />
                          <p className="text-xs text-white/40">Preview updates with settings</p>
                        </div>
                      </div>
                      {/* Animated gradient overlay to simulate activity */}
                      <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500/10 via-transparent to-purple-500/10 opacity-50" />
                    </div>
                  </div>

                  {/* Presets */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-300/80">Quick Presets</h3>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px] px-2 text-indigo-300 hover:text-white"
                        onClick={() => {
                          setDuration(durations[1].value);
                          setSoundtrack('celebration');
                          setAspectPreference('auto');
                          setResolution('1080p');
                          setPacing('cinematic');
                        }}
                      >
                        Reset Default
                      </Button>
                    </div>
                    <PresetSelector 
                      currentValues={{ duration, soundtrack, aspectPreference, resolution, pacing }}
                      onSelect={handlePresetSelect}
                    />
                  </div>

                  {/* Detailed Config */}
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-300/80 mb-3">Detailed Configuration</h3>
                    <ConfigPanel 
                      values={{ duration, soundtrack, aspectPreference, resolution, pacing }}
                      onChange={handleConfigChange}
                    />
                  </div>
                </div>
              </div>

              {/* Right Panel: Style Grid (Scrollable) */}
              <div className="flex-1 flex flex-col bg-slate-950/30">
                <div className="p-6 h-full flex flex-col">
                  <div className="mb-4">
                    <h3 className="text-lg font-bold text-white mb-1">Select a Style</h3>
                    <p className="text-sm text-indigo-200/60">Choose the visual theme for your video generation.</p>
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
