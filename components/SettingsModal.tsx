import React from 'react';
import { Icon } from './Icons';
import { triggerHapticFeedback } from '../utils/haptics';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  compactMode: boolean;
  onToggleCompactMode: (value: boolean) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, compactMode, onToggleCompactMode }) => {
  if (!isOpen) return null;

  const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      triggerHapticFeedback();
      onClose();
    }
  };

  const handleClose = () => {
    triggerHapticFeedback();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-slate-950/80 backdrop-blur-lg flex items-center justify-center z-50 p-4 animate-fade-in"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
    >
      <div
        className="w-full max-w-lg bg-white/10 border border-white/15 rounded-2xl shadow-2xl p-6 sm:p-8 flex flex-col gap-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="settings-modal-title" className="text-2xl font-bold text-white flex items-center gap-2">
            <Icon type="settings" className="w-6 h-6 text-indigo-300" />
            Settings
          </h2>
          <button
            onClick={handleClose}
            className="text-slate-400 hover:text-white transition-colors"
            aria-label="Close settings"
          >
            <Icon type="close" className="w-6 h-6" />
          </button>
        </div>

        {/* Compact mode toggle */}
        <div className="mt-2">
          <label className="flex items-center justify-between gap-3 text-sm text-slate-200">
            <span className="flex-1">
              Compact mode
              <span className="block text-xs text-slate-400">Reduce spacing on desktop for a denser layout.</span>
            </span>
            <input
              type="checkbox"
              checked={compactMode}
              onChange={(e) => { triggerHapticFeedback(); onToggleCompactMode(e.target.checked); }}
              className="h-5 w-5 rounded border-white/20 bg-slate-900/60 text-indigo-500 focus:ring-indigo-400"
            />
          </label>
        </div>

        <div className="mt-4 flex flex-col-reverse sm:flex-row sm:items-center justify-end gap-3">
          <button
            onClick={handleClose}
            className="w-full sm:w-auto bg-white/10 border border-white/20 text-white font-semibold px-4 py-2 rounded-lg hover:bg-white/20 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
