import React from "react";
import { Check, LoaderCircle } from "lucide-react";
import { Button } from "./ui/Button";
import type { GenerationPartsReady, GenerationStage } from "../hooks/useGeneration";

interface CreatingScreenProps {
  imageSrc: string | null;
  stage: GenerationStage;
  partsReady: GenerationPartsReady;
  onCancel: () => void;
}

const STEP_LABELS = ["Design", "Caption", "Final check"] as const;

/** Progress follows provider and persistence boundaries, never a timer. */
export const CreatingScreen: React.FC<CreatingScreenProps> = ({
  imageSrc,
  stage,
  partsReady,
  onCancel,
}) => {
  const done = [partsReady.image, partsReady.caption, false];
  const active =
    stage === "checks" || stage === "saving" ? 2 : partsReady.image ? 1 : 0;
  const detail =
    stage === "signature"
      ? "Saving the customer’s signature…"
      : stage === "saving"
        ? "Saving to My work…"
        : stage === "checks"
          ? "Running a final check on the caption and image…"
          : partsReady.image
            ? "Writing your caption…"
            : "Designing from your photo…";
  return (
    <section
      className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-start px-5 pb-8 pt-6 sm:px-8 sm:pt-10"
      aria-labelledby="creating-title"
    >
      {/* The photo lies on the light table at its own aspect and full
          strength, so it reads as the post being made, not a failed load. */}
      <div className="table-lit relative overflow-hidden rounded-lg border border-hairline p-3">
        {imageSrc ? (
          <img
            src={imageSrc}
            alt="Your source photo"
            className="print mx-auto block max-h-[52svh] w-auto object-contain"
          />
        ) : (
          <div className="h-48" aria-hidden="true" />
        )}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-overlay/90 text-brand-ink">
            <LoaderCircle
              className="h-7 w-7 motion-safe:animate-spin"
              aria-hidden="true"
            />
          </span>
        </div>
      </div>
      <div className="mt-7" role="status" aria-live="polite">
        <h1
          id="creating-title"
          className="font-display text-3xl font-semibold text-ink"
        >
          Creating your post…
        </h1>
        <p className="mt-2 text-ink-2">{detail}</p>
      </div>
      <ol className="mt-6 grid grid-cols-3 gap-3" aria-label="Post generation stages">
        {STEP_LABELS.map((label, index) => (
          <li
            key={label}
            aria-current={index === active ? "step" : undefined}
            className={`flex items-center gap-2 border-t-2 pt-3 text-sm font-medium ${done[index] || index === active ? "border-brand-fill text-ink" : "border-hairline text-ink-2"}`}
          >
            {done[index] && <Check className="h-4 w-4" aria-hidden="true" />}
            {label}
          </li>
        ))}
      </ol>
      <div className="mt-8 flex items-center gap-3">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <p className="text-sm text-ink-2">Cancel keeps your photo and details.</p>
      </div>
    </section>
  );
};
