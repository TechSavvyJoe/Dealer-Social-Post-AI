import React, { useState } from 'react';
import { Logo } from './Logo';
import { triggerHapticFeedback } from '../utils/haptics';
import { Icon } from './Icons';
import { Dialpad } from './Dialpad';

interface LoginScreenProps {
  onLogin: (dealerId: string) => Promise<boolean>;
  onShowSettings?: () => void;
  isApiKeyConfigured?: boolean;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin, onShowSettings, isApiKeyConfigured = false }) => {
  const [dealerCode, setDealerCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleDialpadKeyPress = async (key: string) => {
    triggerHapticFeedback();
    if (isLoading) return;
    setError(null);

    let currentCode = dealerCode;
    if (key === 'backspace') {
      currentCode = currentCode.slice(0, -1);
    } else if (currentCode.length < 4) {
      currentCode += key;
    }
    setDealerCode(currentCode);

    if (currentCode.length === 4) {
      setIsLoading(true);
      setError(null);
      try {
        const loginSuccess = await onLogin(currentCode);
        if (!loginSuccess) {
          setError('Dealer code not found.');
          setTimeout(() => {
              setDealerCode('');
          }, 1000);
        }
      } catch (e) {
         setError(e instanceof Error ? e.message : 'An unknown error occurred.');
      } finally {
        setIsLoading(false);
      }
    }
  };

  return (
    <div className="w-full max-w-sm mx-auto flex flex-col items-center justify-center p-4">
      <Logo className="w-full max-w-xs h-auto mx-auto mb-10" />
      <div className="w-full bg-white/10 backdrop-blur-lg border border-white/20 p-6 sm:p-8 rounded-2xl shadow-2xl min-h-[380px] flex flex-col justify-center">
        {isLoading ? (
            <div className="flex items-center justify-center">
                <svg className="animate-spin h-8 w-8 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
            </div>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-center text-white mb-4">Enter Dealer Code</h1>
            {!isApiKeyConfigured && (
              <div className="mb-4 bg-amber-500/10 border border-amber-400/30 text-amber-100 px-4 py-2 rounded-lg text-sm flex items-center gap-2">
                  <Icon type="settings" className="w-5 h-5" />
                  <span>Add your Gemini API key to unlock AI-powered post creation.</span>
              </div>
            )}
            <div className="flex justify-center gap-4 mb-8">
              {[...Array(4)].map((_, i) => (
                <div key={i} className={`w-4 h-4 rounded-full transition-all duration-300 ${i < dealerCode.length ? 'bg-indigo-400 scale-110' : 'bg-white/20'}`}></div>
              ))}
            </div>
            <Dialpad onKeyPress={handleDialpadKeyPress} />
            <button
              type="button"
              onClick={() => { triggerHapticFeedback(); onShowSettings?.(); }}
              className="mt-6 flex items-center justify-center gap-2 text-sm font-semibold text-indigo-200 hover:text-white transition-colors"
            >
              <Icon type="settings" className="w-4 h-4" />
              <span>{isApiKeyConfigured ? 'Manage API Key' : 'Add API Key'}</span>
            </button>
          </>
        )}

        {error && !isLoading && (
            <div className="mt-4 bg-red-900/50 border border-red-700 text-red-300 px-4 py-2 rounded-lg flex items-center gap-2 text-sm animate-fade-in">
                 <Icon type="error" className="w-5 h-5 flex-shrink-0"/>
                 <span>{error}</span>
            </div>
        )}
      </div>
    </div>
  );
};
