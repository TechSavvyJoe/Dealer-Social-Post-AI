import React from 'react';
import { motion } from 'framer-motion';
import { Settings, LogOut } from 'lucide-react';
import { Dealer } from '../types';
import { triggerHapticFeedback } from '../utils/haptics';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { cn } from '../utils/classNames';

interface HeaderProps {
  dealer: Dealer;
  onLogout: () => void;
  onShowSettings: () => void;
  isApiKeyConfigured: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  dealer,
  onLogout,
  onShowSettings,
  isApiKeyConfigured
}) => {
  const handleLogout = () => {
    triggerHapticFeedback();
    onLogout();
  };

  const handleOpenSettings = () => {
    triggerHapticFeedback();
    onShowSettings();
  };

  return (
    <motion.header
      className={cn(
        'w-full sticky top-0 z-40',
        'bg-surface-900/60 backdrop-blur-xl',
        'border-b border-white/10',
        'shadow-elevation-2'
      )}
      initial={{ y: -100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
    >
      <div className="mx-auto flex w-full max-w-screen-2xl items-center justify-between px-4 py-3 sm:px-6 lg:px-10">
        {/* Dealer Info */}
        <motion.div
          className="flex items-center gap-3"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1, duration: 0.4 }}
        >
          {dealer.logo ? (
            <div className="relative">
              <img
                src={dealer.logo}
                alt={`${dealer.name} Logo`}
                className="w-10 h-10 object-contain rounded-xl bg-white/10 p-1.5 ring-1 ring-white/10"
              />
            </div>
          ) : (
            <div
              className={cn(
                'w-10 h-10 rounded-xl flex items-center justify-center',
                'font-bold text-white text-xl',
                'bg-gradient-to-br from-primary-500 to-secondary-600',
                'shadow-elevation-2'
              )}
            >
              {dealer.name.charAt(0)}
            </div>
          )}
          <span className="font-bold text-surface-50 text-lg tracking-tight">
            {dealer.name}
          </span>
        </motion.div>

        {/* Actions */}
        <motion.div
          className="flex items-center gap-2 sm:gap-3"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2, duration: 0.4 }}
        >
          {/* API Status Badge */}
          <div className="hidden sm:block">
            {!isApiKeyConfigured && (
              <Badge
                variant="warning"
                dot
              >
                Add API Key
              </Badge>
            )}
          </div>

          {/* Settings Button */}
          <Button
            variant="tinted"
            size="sm"
            leftIcon={<Settings />}
            onClick={handleOpenSettings}
          >
            <span className="hidden sm:inline">Settings</span>
          </Button>

          {/* Logout Button */}
          <Button
            variant="outline"
            size="sm"
            leftIcon={<LogOut />}
            onClick={handleLogout}
            className="hover:bg-error-500/20 hover:border-error-500/50 hover:text-error-300"
          >
            <span className="hidden sm:inline">Logout</span>
          </Button>
        </motion.div>
      </div>
    </motion.header>
  );
};
