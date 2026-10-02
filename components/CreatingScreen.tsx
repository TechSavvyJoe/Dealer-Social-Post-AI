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
        ? "Saving your post to My work…"
        : stage === "checks"
          ? "Checking your caption and photo…"
          : partsReady.image
            ? "Finishing your caption…"
            : "Creating the design from your photo…";
  return (
    <section
      className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-5 py-8 sm:px-8"
      aria-labelledby="creating-title"
    >
      <div className="relative overflow-hidden rounded-lg border border-hairline bg-panel">
        {imageSrc && (
          <img
            src={imageSrc}
            alt="Your source photo"
            className="aspect-[4/3] w-full object-contain opacity-40"
          />
        )}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="grid h-16 w-16 place-items-center rounded-full bg-panel text-brand-ink">
            <LoaderCircle
              className="h-8 w-8 motion-safe:animate-spin"
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
        {["Design", "Caption", "Checks"].map((label, index) => (
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
      <Button variant="secondary" className="mt-8 self-start" onClick={onCancel}>
        Cancel
      </Button>
    </section>
  );
};
