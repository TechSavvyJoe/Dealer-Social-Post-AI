import React from 'react';
import { Dealer } from '../types';
import { triggerHapticFeedback } from '../utils/haptics';

interface HeaderProps {
  dealer: Dealer;
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({ dealer, onLogout }) => {
  const handleLogout = () => {
    triggerHapticFeedback();
    onLogout();
  };

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
      <button
        onClick={handleLogout}
        className="bg-white/10 border border-white/20 text-white font-semibold text-sm py-2 px-4 rounded-lg hover:bg-red-500/50 hover:border-red-400 transition-colors"
      >
        Logout
      </button>
    </header>
  );
};