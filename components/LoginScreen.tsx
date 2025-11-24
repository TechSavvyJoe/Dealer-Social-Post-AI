import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings, Loader2, AlertCircle } from 'lucide-react';
import { Logo } from './Logo';
import { triggerHapticFeedback } from '../utils/haptics';
import { Dialpad } from './Dialpad';
import { Card, CardContent } from './ui/Card';
import { Button } from './ui/Button';
import { cn } from '../utils/classNames';

interface LoginScreenProps {
  onLogin: (dealerId: string) => Promise<boolean>;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onLogin,
}) => {
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
    <motion.div
      className="w-full max-w-sm mx-auto flex flex-col items-center justify-center p-4"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
    >
      {/* Logo */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.5 }}
      >
        <Logo className="w-full max-w-xs h-auto mx-auto mb-10" />
      </motion.div>

      {/* Login Card */}
      <Card elevation={4} className="w-full min-h-[380px] flex flex-col justify-center">
        <CardContent className="flex flex-col justify-center" padded>
          <AnimatePresence mode="wait">
            {isLoading ? (
              <motion.div
                key="loading"
                className="flex flex-col items-center justify-center py-12"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.3 }}
              >
                <Loader2 className="h-12 w-12 text-primary-400 animate-spin" />
                <p className="mt-4 text-sm text-surface-300">Authenticating...</p>
              </motion.div>
            ) : (
              <motion.div
                key="login-form"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="space-y-6"
              >
                {/* Title */}
                <motion.h1
                  className="text-2xl font-bold text-center text-surface-50"
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                >
                  Enter Dealer Code
                </motion.h1>

                {/* PIN Dots */}
                <div className="flex justify-center gap-4 py-4">
                  {[...Array(4)].map((_, i) => (
                    <motion.div
                      key={i}
                      className={cn(
                        'w-4 h-4 rounded-full transition-all duration-300',
                        i < dealerCode.length
                          ? 'bg-primary-400 shadow-glow-primary'
                          : 'bg-surface-700'
                      )}
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{
                        scale: i < dealerCode.length ? 1.2 : 1,
                        opacity: 1,
                      }}
                      transition={{
                        delay: 0.3 + i * 0.05,
                        type: 'spring',
                        stiffness: 400,
                        damping: 20,
                      }}
                    />
                  ))}
                </div>

                {/* Dialpad */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                >
                  <Dialpad onKeyPress={handleDialpadKeyPress} />
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Error Message */}
          <AnimatePresence>
            {error && !isLoading && (
              <motion.div
                className={cn(
                  'mt-4 bg-error-900/50 border border-error-700',
                  'text-error-300 px-4 py-3 rounded-xl',
                  'flex items-start gap-3 text-sm'
                )}
                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                transition={{ duration: 0.2 }}
              >
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <span className="leading-relaxed">{error}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>
    </motion.div>
  );
};
