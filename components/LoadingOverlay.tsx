import React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Check, Sparkles } from "lucide-react";
import { ProgressBar } from "./ui/ProgressBar";
import { cn } from "../utils/classNames";

interface LoadingOverlayProps {
  progress: number;
  message?: string;
}

const GENERATION_STAGES = [
  { label: "Photo", detail: "Reviewing the source photo", startsAt: 0 },
  {
    label: "Design",
    detail: "Building the dealership-ready creative",
    startsAt: 24,
  },
  {
    label: "Caption",
    detail: "Writing the caption and checking tone",
    startsAt: 58,
  },
  {
    label: "Review",
    detail: "Finishing compliance and quality checks",
    startsAt: 84,
  },
] as const;

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({
  progress,
  message,
}) => {
  const shouldReduceMotion = useReducedMotion();
  const clampedProgress = Math.min(100, Math.max(0, progress));
  const activeStageIndex = GENERATION_STAGES.reduce(
    (current, stage, index) =>
      clampedProgress >= stage.startsAt ? index : current,
    0,
  );
  const statusMessage =
    message?.trim() || GENERATION_STAGES[activeStageIndex].detail;

  return (
    <div
      className="flex w-full flex-1 items-center justify-center px-4 py-10"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-busy="true"
    >
      <motion.div
        className="w-full max-w-lg rounded-2xl border border-white/10 bg-surface-900/75 p-5 shadow-2xl shadow-black/20 backdrop-blur-lg sm:p-7"
        initial={shouldReduceMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: shouldReduceMotion ? 0 : 0.3 }}
      >
        <div className="mb-6 flex items-start gap-4">
          <motion.div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-primary-400/20 bg-primary-500/10 text-primary-300"
            animate={shouldReduceMotion ? undefined : { scale: [1, 1.04, 1] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            aria-hidden="true"
          >
            <Sparkles className="h-5 w-5" />
          </motion.div>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-300">
                Studio render
              </span>
              <span className="font-mono text-xs tabular-nums text-surface-400">
                {Math.round(clampedProgress)}%
              </span>
            </div>
            <h2 className="text-2xl font-semibold tracking-tight text-surface-50">
              Building your post
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-surface-300">
              {statusMessage}
            </p>
          </div>
        </div>

        <ProgressBar
          value={clampedProgress}
          className="w-full"
          showShimmer={!shouldReduceMotion}
          loadingLabel={statusMessage}
        />

        <ol
          className="mt-5 grid grid-cols-4 gap-2"
          aria-label="Post generation stages"
        >
          {GENERATION_STAGES.map((stage, index) => {
            const isComplete =
              index < activeStageIndex || clampedProgress === 100;
            const isActive =
              index === activeStageIndex && clampedProgress < 100;

            return (
              <li
                key={stage.label}
                className={cn(
                  "flex min-w-0 flex-col gap-1 border-t-2 pt-2 text-[10px] font-semibold uppercase tracking-wide",
                  isComplete && "border-success-400 text-success-300",
                  isActive && "border-primary-400 text-primary-200",
                  !isComplete &&
                    !isActive &&
                    "border-white/10 text-surface-500",
                )}
                aria-current={isActive ? "step" : undefined}
              >
                <span className="flex items-center gap-1 truncate">
                  {isComplete ? (
                    <Check className="h-3 w-3 shrink-0" aria-hidden="true" />
                  ) : null}
                  {stage.label}
                </span>
              </li>
            );
          })}
        </ol>

        <p className="mt-5 text-center text-xs text-surface-500">
          Keep this screen open while the image and caption finish.
        </p>
      </motion.div>
    </div>
  );
};
