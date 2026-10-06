import React, { useEffect, useRef } from "react";
import { Check } from "lucide-react";
import type { Dealer } from "../../types";
import { cn } from "../../utils/classNames";
import {
  SETTINGS_SECTION_LABELS,
  settingsSectionStatus,
  type SectionStatus,
  type SettingsSectionId,
} from "../../utils/dealerSetupStatus";
import { SETTINGS_SECTION_ORDER } from "./settingsModel";

/** The four areas a store sets up; Workflow has safe defaults and is not one. */
const COUNTED_AREAS = SETTINGS_SECTION_ORDER.filter((id) => id !== "workflow");

/** A section's status in words, for its accessible name. */
const statusWords = (status: SectionStatus): string | null => {
  switch (status.state) {
    case "ready":
      return "ready";
    case "partial":
      return `${status.ready} of ${status.total} ready`;
    case "empty":
      return "not started";
    default:
      return null;
  }
};

/**
 * A section's status mark: a check, "1 of 2" or "Not started"; nothing for
 * Workflow. Visual only: the button's name says the same in words.
 */
const StatusMark: React.FC<{ status: SectionStatus }> = ({ status }) => {
  switch (status.state) {
    case "ready":
      return (
        <Check
          className="h-4 w-4 shrink-0 text-ink-2"
          strokeWidth={2.25}
          aria-hidden="true"
        />
      );
    case "partial":
      return (
        <span
          aria-hidden="true"
          className="shrink-0 text-caption font-medium text-warning-ink"
        >
          {status.ready} of {status.total}
        </span>
      );
    case "empty":
      return (
        <span
          aria-hidden="true"
          className="shrink-0 text-caption font-medium text-warning-ink"
        >
          Not started
        </span>
      );
    default:
      return null;
  }
};

interface SettingsRailProps {
  /** The SAVED record: status never follows unsaved edits. */
  dealer: Dealer;
  section: SettingsSectionId;
  onSelect: (section: SettingsSectionId) => void;
  className?: string;
}

/**
 * The section list. One nav: a plain vertical list with a progress bar under
 * it from `lg`, a horizontally scrolling row of chips below `lg`, the same
 * buttons and marks in both.
 */
export const SettingsRail: React.FC<SettingsRailProps> = ({
  dealer,
  section,
  onSelect,
  className,
}) => {
  const statuses = settingsSectionStatus(dealer);
  const ready = COUNTED_AREAS.filter((id) => statuses[id].state === "ready").length;
  const selectedRef = useRef<HTMLButtonElement | null>(null);
  const mounted = useRef(false);

  // In the chip row the selected chip may sit past the edge; bring it into
  // view when the section changes (never on the first render, which would
  // scroll the page).
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    selectedRef.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [section]);

  return (
    <div className={cn("flex min-w-0 flex-col lg:gap-5", className)}>
      <nav
        aria-label="Dealership settings sections"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 py-3 sm:-mx-6 sm:px-6 lg:mx-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:p-0"
      >
        {SETTINGS_SECTION_ORDER.map((id) => {
          const selected = id === section;
          const words = statusWords(statuses[id]);
          return (
            <button
              key={id}
              ref={selected ? selectedRef : undefined}
              type="button"
              // "Channels, 1 of 2 ready": built in one string, so no reader
              // runs the label and the mark together.
              aria-label={
                words
                  ? `${SETTINGS_SECTION_LABELS[id]}, ${words}`
                  : SETTINGS_SECTION_LABELS[id]
              }
              aria-current={selected ? "page" : undefined}
              onClick={() => onSelect(id)}
              className={cn(
                "flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap text-sm font-semibold transition-colors duration-120 ease-out",
                // Below lg: a chip.
                "rounded-full border px-3.5",
                selected
                  ? "border-strong bg-panel-raised text-ink"
                  : "border-hairline text-ink-2 hover:border-strong hover:text-ink",
                // From lg: a rail row.
                "lg:justify-between lg:rounded-sm lg:border-0 lg:px-3 lg:text-base",
                selected
                  ? "lg:bg-panel-raised lg:font-semibold"
                  : "lg:bg-transparent lg:font-medium lg:hover:bg-fill-subtle",
              )}
            >
              <span>{SETTINGS_SECTION_LABELS[id]}</span>
              <StatusMark status={statuses[id]} />
            </button>
          );
        })}
      </nav>
      <div className="hidden flex-col gap-2 px-3 lg:flex">
        <div
          role="progressbar"
          aria-label="Store setup progress"
          aria-valuemin={0}
          aria-valuemax={COUNTED_AREAS.length}
          aria-valuenow={ready}
          className="h-1 overflow-hidden rounded-full bg-hairline"
        >
          <div
            className="h-full bg-ink-2 transition-[width] duration-180 ease-out motion-reduce:transition-none"
            style={{ width: `${(ready / COUNTED_AREAS.length) * 100}%` }}
          />
        </div>
        <p className="text-caption text-ink-2">
          {ready} of {COUNTED_AREAS.length} areas ready
        </p>
      </div>
    </div>
  );
};
