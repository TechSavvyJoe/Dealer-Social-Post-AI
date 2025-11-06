import React from 'react';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { AppStep } from '../types';
import { cn } from '../utils/classNames';

const stepOrder: Array<{ step: AppStep; label: string }> = [
  { step: AppStep.LOGIN, label: 'Login' },
  { step: AppStep.CAPTURE, label: 'Capture' },
  { step: AppStep.CUSTOMIZE, label: 'Customize' },
  { step: AppStep.GENERATING, label: 'Generating' },
  { step: AppStep.RESULT, label: 'Results' },
];

interface ProgressStepsProps {
  activeStep: AppStep;
}

export const ProgressSteps: React.FC<ProgressStepsProps> = ({ activeStep }) => {
  const activeIndex = stepOrder.findIndex(({ step }) => step === activeStep);

  return (
    <nav className="w-full max-w-screen-2xl px-2 md:px-4 mx-auto py-4">
      <ol className="flex flex-wrap items-center justify-center gap-2 sm:gap-4">
        {stepOrder.map(({ step, label }, index) => {
          const isActive = step === activeStep;
          const isComplete = index < activeIndex;
          const isUpcoming = index > activeIndex;

          return (
            <li key={label} className="flex items-center gap-2">
              {/* Step Circle */}
              <div className="flex flex-col items-center gap-1.5">
                <motion.div
                  className={cn(
                    'relative flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-full',
                    'border-2 transition-all duration-300',
                    'font-bold text-xs sm:text-sm',
                    isActive && cn(
                      'border-primary-400 bg-primary-500/30 text-surface-50',
                      'shadow-glow-primary scale-110'
                    ),
                    isComplete && cn(
                      'border-success-400 bg-success-500/30 text-success-100',
                      'shadow-lg shadow-success-500/20'
                    ),
                    isUpcoming && 'border-surface-600 bg-surface-800/50 text-surface-400'
                  )}
                  initial={false}
                  animate={{
                    scale: isActive ? 1.1 : 1,
                    backgroundColor: isActive
                      ? 'rgba(59, 130, 246, 0.3)'
                      : isComplete
                      ? 'rgba(34, 197, 94, 0.3)'
                      : 'rgba(30, 41, 59, 0.5)',
                  }}
                  transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                >
                  {isComplete ? (
                    <motion.div
                      initial={{ scale: 0, rotate: -180 }}
                      animate={{ scale: 1, rotate: 0 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 20 }}
                    >
                      <Check className="h-4 w-4 sm:h-5 sm:w-5" />
                    </motion.div>
                  ) : (
                    <span>{index + 1}</span>
                  )}

                  {/* Active pulse ring */}
                  {isActive && (
                    <motion.span
                      className="absolute inset-0 rounded-full border-2 border-primary-400"
                      initial={{ scale: 1, opacity: 0.8 }}
                      animate={{ scale: 1.3, opacity: 0 }}
                      transition={{
                        duration: 1.5,
                        repeat: Infinity,
                        ease: 'easeOut',
                      }}
                    />
                  )}
                </motion.div>

                {/* Label */}
                <motion.span
                  className={cn(
                    'text-[10px] sm:text-xs uppercase tracking-wider font-medium whitespace-nowrap',
                    'transition-all duration-300',
                    isActive && 'text-surface-50 font-semibold',
                    isComplete && 'text-success-300',
                    isUpcoming && 'text-surface-500'
                  )}
                  initial={false}
                  animate={{
                    opacity: isActive ? 1 : isComplete ? 0.9 : 0.6,
                  }}
                >
                  {label}
                </motion.span>
              </div>

              {/* Connector Line */}
              {index !== stepOrder.length - 1 && (
                <div className="hidden sm:flex items-center h-8 w-8 md:w-12 lg:w-16">
                  <div className="relative w-full h-[2px] overflow-hidden">
                    {/* Background line */}
                    <div className="absolute inset-0 bg-surface-700" />

                    {/* Progress line */}
                    <motion.div
                      className={cn(
                        'absolute inset-0 origin-left',
                        isComplete ? 'bg-success-400' : 'bg-primary-400'
                      )}
                      initial={{ scaleX: 0 }}
                      animate={{
                        scaleX: index < activeIndex ? 1 : 0,
                      }}
                      transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
                    />
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
