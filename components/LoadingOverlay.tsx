import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import { ProgressBar } from './ui/ProgressBar';

interface LoadingOverlayProps {
  progress: number;
  message?: string;
}

const LOADING_MESSAGES = [
  "Analyzing pixel composition...",
  "Consulting the style guide...",
  "Mixing digital paints...",
  "Applying lighting effects...",
  "Polishing the final details...",
  "Almost there...",
];

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ progress, message }) => {
  const [currentMessageIndex, setCurrentMessageIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentMessageIndex((prev) => (prev + 1) % LOADING_MESSAGES.length);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  const displayMessage = message || LOADING_MESSAGES[currentMessageIndex];

  return (
    <div className="flex flex-col items-center justify-center w-full h-full min-h-[400px] max-w-md mx-auto p-8">
      <div className="relative w-24 h-24 mb-8">
        {/* Outer pulsing ring */}
        <motion.div
          className="absolute inset-0 rounded-full border-4 border-primary-500/20"
          animate={{ scale: [1, 1.1, 1], opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        />
        
        {/* Spinning gradient ring */}
        <motion.div
          className="absolute inset-0 rounded-full border-4 border-primary-500 border-t-transparent"
          animate={{ rotate: 360 }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
        />
        
        {/* Center icon */}
        <div className="absolute inset-0 flex items-center justify-center">
          <motion.div
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
          >
            <Sparkles className="w-8 h-8 text-primary-400" />
          </motion.div>
        </div>
      </div>

      <motion.h2
        className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary-400 to-secondary-400 mb-6 text-center"
        animate={{ opacity: [0.8, 1, 0.8] }}
        transition={{ duration: 2, repeat: Infinity }}
      >
        Crafting Magic
      </motion.h2>

      <div className="w-full space-y-4">
        <ProgressBar value={progress} className="w-full" />
        
        <div className="h-6 relative overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.p
              key={displayMessage}
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -20, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="text-sm text-surface-300 text-center w-full absolute"
            >
              {displayMessage}
            </motion.p>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};
