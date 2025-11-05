import React, { useEffect, useState } from 'react';
import { Icon } from './Icons';
import { triggerHapticFeedback } from '../utils/haptics';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialApiKey: string;
  defaultRemember: boolean;
  onSave: (options: { apiKey: string; remember: boolean }) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, initialApiKey, defaultRemember, onSave }) => {
  const [apiKey, setApiKey] = useState(initialApiKey);
  const [remember, setRemember] = useState(defaultRemember);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setApiKey(initialApiKey);
    setRemember(defaultRemember);
    setShowKey(false);
  }, [isOpen, initialApiKey, defaultRemember]);

  if (!isOpen) return null;

  const sanitizedKey = apiKey.trim();
  const canPersist = sanitizedKey.length > 0;

  const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      triggerHapticFeedback();
      onClose();
    }
  };

  const handleSave = () => {
    triggerHapticFeedback();
    onSave({ apiKey: sanitizedKey, remember: remember && canPersist });
  };

  const handleCancel = () => {
    triggerHapticFeedback();
    onClose();
  };

  const handleToggleVisibility = () => {
    triggerHapticFeedback();
    setShowKey((prev) => !prev);
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
            onClick={handleCancel}
            className="text-slate-400 hover:text-white transition-colors"
            aria-label="Close settings"
          >
            <Icon type="close" className="w-6 h-6" />
          </button>
        </div>

        <p className="text-sm text-slate-300 leading-relaxed">
          Connect your Gemini API key to let the app generate AI-enhanced social posts. Keys are stored locally on this device only.
        </p>

        <div className="space-y-3">
          <label htmlFor="gemini-api-key" className="block text-sm font-semibold text-slate-200">
            Gemini API Key
          </label>
          <div className="relative">
            <input
              id="gemini-api-key"
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="Paste your key here"
              className="w-full bg-slate-900/60 border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400"
            />
            <button
              type="button"
              onClick={handleToggleVisibility}
              className="absolute inset-y-0 right-0 px-4 text-sm font-semibold text-indigo-200 hover:text-white transition-colors"
            >
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
          <p className="text-xs text-slate-400">
            Need a key? Visit{' '}
            <a href="https://ai.google.dev/gemini-api/docs/api-key" target="_blank" rel="noreferrer" className="text-indigo-300 hover:text-indigo-200 underline">
              ai.google.dev/gemini-api/docs/api-key
            </a>
          </p>
        </div>

        <label className={`flex items-center gap-2 text-sm text-slate-200 ${canPersist ? '' : 'opacity-60'}`}>
          <input
            type="checkbox"
            checked={remember && canPersist}
            onChange={(event) => setRemember(event.target.checked)}
            disabled={!canPersist}
            className="rounded border-white/20 bg-slate-900/60 text-indigo-500 focus:ring-indigo-400"
          />
          Remember this key on this device
        </label>

        <div className="mt-2 space-y-2 text-xs text-slate-400">
          <p>Leaving the field blank and saving will remove the current key.</p>
          <p>Dealers with multiple locations can use different keys per device.</p>
        </div>

        <div className="mt-4 flex flex-col-reverse sm:flex-row sm:items-center justify-end gap-3">
          <button
            onClick={handleCancel}
            className="w-full sm:w-auto bg-white/10 border border-white/20 text-white font-semibold px-4 py-2 rounded-lg hover:bg-white/20 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="w-full sm:w-auto bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold px-5 py-2 rounded-lg hover:scale-105 transition-transform duration-300"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
};
