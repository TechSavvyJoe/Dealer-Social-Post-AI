import React from "react";
import { m } from "framer-motion";
import { Check } from "lucide-react";
import { AppStep } from "../types";
import { cn } from "../utils/classNames";

const stepOrder: Array<{ step: AppStep; label: string }> = [
  { step: AppStep.LOGIN, label: "Sign in" },
  { step: AppStep.CAPTURE, label: "Capture" },
  { step: AppStep.CUSTOMIZE, label: "Customize" },
  { step: AppStep.GENERATING, label: "Generating" },
  { step: AppStep.RESULT, label: "Results" },
];

interface ProgressStepsProps {
  activeStep: AppStep;
}

export const ProgressSteps: React.FC<ProgressStepsProps> = ({ activeStep }) => {
  const activeIndex = stepOrder.findIndex(({ step }) => step === activeStep);

  return (
    <nav
      className="mx-auto w-full max-w-screen-2xl shrink-0 px-2 py-2.5 md:px-4"
      aria-label="Progress"
    >
      <ol className="flex flex-wrap items-center justify-center gap-2 sm:gap-4">
        {stepOrder.map(({ step, label }, index) => {
          const isActive = step === activeStep;
          const isComplete = index < activeIndex;
          const isUpcoming = index > activeIndex;

          return (
            <li
              key={label}
              className="flex items-center gap-2"
              aria-current={isActive ? "step" : undefined}
            >
              {/* Step Circle */}
              <div className="flex flex-col items-center gap-1.5">
                <m.div
                  className={cn(
                    "relative flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-full",
                    "border transition-all duration-300",
                    "font-semibold text-xs sm:text-sm",
                    isActive &&
                      cn(
                        "border-primary-400 bg-primary-500/20 text-surface-50",
                        "shadow-lg shadow-primary-950/20",
                      ),
                    isComplete &&
                      cn("border-success-500/50 bg-success-500/10 text-success-100"),
                    isUpcoming && "border-hairline bg-surface-800/45 text-surface-400",
                  )}
                  initial={false}
                  animate={{
                    scale: isActive ? 1.04 : 1,
                  }}
                  transition={{ type: "spring", stiffness: 400, damping: 25 }}
                >
                  {isComplete ? (
                    <m.div
                      initial={{ scale: 0, rotate: -180 }}
                      animate={{ scale: 1, rotate: 0 }}
                      transition={{
                        type: "spring",
                        stiffness: 500,
                        damping: 20,
                      }}
                    >
                      <Check className="h-4 w-4 sm:h-5 sm:w-5" />
                    </m.div>
                  ) : (
                    <span>{index + 1}</span>
                  )}
                </m.div>

                {/* Label */}
                <m.span
                  className={cn(
                    "text-[10px] sm:text-xs tracking-wide font-medium whitespace-nowrap",
                    "transition-all duration-300",
                    isActive && "text-surface-50 font-semibold",
                    isComplete && "text-success-300",
                    isUpcoming && "text-surface-500",
                  )}
                  initial={false}
                  animate={{
                    opacity: isActive ? 1 : isComplete ? 0.9 : 0.6,
                  }}
                >
                  {label}
                </m.span>
              </div>

              {/* Connector Line */}
              {index !== stepOrder.length - 1 && (
                <div className="hidden sm:flex items-center h-8 w-8 md:w-12 lg:w-16">
                  <div className="relative w-full h-[2px] overflow-hidden">
                    {/* Background line */}
                    <div className="absolute inset-0 bg-fill-hover" />

                    {/* Progress line */}
                    <m.div
                      className={cn(
                        "absolute inset-0 origin-left",
                        isComplete ? "bg-success-400" : "bg-primary-400",
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
