import React from 'react';
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
    <nav className="w-full max-w-screen-2xl px-2 md:px-4 mx-auto">
      <ol className="flex flex-wrap items-center justify-center gap-3 sm:gap-5">
        {stepOrder.map(({ step, label }, index) => {
          const isActive = step === activeStep;
          const isComplete = index < activeIndex;

          return (
            <li key={label} className="flex items-center gap-2 text-xs sm:text-sm">
              <span
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full border text-xs font-bold transition-colors',
                  isActive && 'border-indigo-400 bg-indigo-500/30 text-white shadow shadow-indigo-500/30',
                  isComplete && !isActive && 'border-emerald-400 bg-emerald-500/20 text-emerald-200',
                  !isActive && !isComplete && 'border-white/20 bg-white/5 text-indigo-200'
                )}
              >
                {index + 1}
              </span>
              <span className={cn('uppercase tracking-wide', isActive ? 'text-white font-semibold' : 'text-indigo-200/70')}>{label}</span>
              {index !== stepOrder.length - 1 && (
                <div className="hidden sm:block w-10 border-t border-dashed border-white/20" aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
