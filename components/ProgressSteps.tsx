import React from "react";
import { AppStep } from "../types";
import { cn } from "../utils/classNames";

const segments: Array<{ label: string; index: number }> = [
  { label: "Photo", index: 1 },
  { label: "Details", index: 2 },
  { label: "Post", index: 3 },
];

function stepToIndex(step: AppStep): number | null {
  switch (step) {
    case AppStep.CAPTURE:
      return 1;
    case AppStep.CUSTOMIZE:
      return 2;
    case AppStep.GENERATING:
    case AppStep.RESULT:
      return 3;
    default:
      return null;
  }
}

interface ProgressStepsProps {
  activeStep: AppStep;
}

export const ProgressSteps: React.FC<ProgressStepsProps> = ({ activeStep }) => {
  if (activeStep === AppStep.LOGIN || activeStep === AppStep.RESULT) {
    return null;
  }

  const currentIndex = stepToIndex(activeStep);
  if (currentIndex === null) {
    return null;
  }

  const currentSegment = segments.find((segment) => segment.index === currentIndex);

  return (
    <nav
      className="mx-auto w-full max-w-[70rem] shrink-0 px-4 py-3 sm:px-6 lg:px-8"
      aria-label="Progress"
    >
      <p className="mb-2 text-sm font-medium text-ink sm:hidden" aria-hidden="true">
        Step {currentIndex} of 3 · {currentSegment?.label}
      </p>
      <ol className="flex items-center gap-3">
        {segments.map((segment) => {
          const isActive = segment.index === currentIndex;
          const isFilled = segment.index <= currentIndex;

          return (
            <li
              key={segment.label}
              className="flex-1"
              aria-current={isActive ? "step" : undefined}
            >
              <div
                className={cn(
                  "h-0.5 w-full rounded-full",
                  isFilled ? "bg-brand-fill" : "bg-hairline",
                )}
              />
              <span
                className={cn(
                  "sr-only sm:not-sr-only sm:mt-1.5 sm:block text-sm font-medium",
                  isActive ? "text-ink" : "text-ink-3",
                )}
              >
                {segment.label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
