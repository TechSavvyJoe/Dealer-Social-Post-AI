import React from 'react';
import { Dealer } from '../types';
import { triggerHapticFeedback } from '../utils/haptics';
import { Icon } from './Icons';

interface HeaderProps {
  dealer: Dealer;
  onLogout: () => void;
  onShowSettings: () => void;
  isApiKeyConfigured: boolean;
}

export const Header: React.FC<HeaderProps> = ({ dealer, onLogout, onShowSettings, isApiKeyConfigured }) => {
  const handleLogout = () => {
    triggerHapticFeedback();
    onLogout();
  };

  const handleOpenSettings = () => {
    triggerHapticFeedback();
    onShowSettings();
  };

  const statusLabel = isApiKeyConfigured ? 'Gemini Ready' : 'Add API Key';
  const statusClasses = isApiKeyConfigured
    ? 'bg-emerald-500/15 text-emerald-100 border-emerald-400/40'
    : 'bg-amber-500/15 text-amber-100 border-amber-400/40';

  return (
    <header className="w-full bg-slate-900/50 backdrop-blur-sm p-3 border-b border-white/10 flex items-center justify-between sticky top-0 z-40">
      <div className="flex items-center gap-3">
        {dealer.logo ? (
          <img src={dealer.logo} alt={`${dealer.name} Logo`} className="w-10 h-10 object-contain rounded-md bg-white/10 p-1" />
        ) : (
          <div className="w-10 h-10 bg-indigo-600 rounded-md flex items-center justify-center font-bold text-white text-xl">
            {dealer.name.charAt(0)}
          </div>
        )}
        <span className="font-bold text-white text-lg">{dealer.name}</span>
      </div>
      <div className="flex items-center gap-2 sm:gap-3">
        <span className={`hidden sm:flex items-center gap-1 sm:gap-2 px-3 py-1 rounded-full border text-xs font-semibold tracking-wide ${statusClasses}`}>
          <span className={`w-2 h-2 rounded-full ${isApiKeyConfigured ? 'bg-emerald-300' : 'bg-amber-300'}`}></span>
          {statusLabel}
        </span>
        <button
          onClick={handleOpenSettings}
          className="flex items-center gap-2 bg-white/10 border border-white/20 text-white font-semibold text-sm py-2 px-3 sm:px-4 rounded-lg hover:bg-white/20 transition-colors"
        >
          <Icon type="settings" className="w-4 h-4" />
          <span className="hidden sm:inline">Settings</span>
        </button>
        <button
          onClick={handleLogout}
          className="bg-white/10 border border-white/20 text-white font-semibold text-sm py-2 px-3 sm:px-4 rounded-lg hover:bg-red-500/50 hover:border-red-400 transition-colors"
        >
          Logout
        </button>
      </div>
    </header>
  );
};
