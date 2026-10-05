import React, { useMemo } from "react";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { cn } from "../utils/classNames";
import {
  DAY_LABELS,
  DAY_ORDER,
  DayKey,
  TIME_OPTIONS,
  WeekHours,
  labelToMinutes,
  minutesToLabel,
} from "../utils/hoursFormat";

interface HoursPickerProps {
  value: WeekHours;
  onChange: (next: WeekHours) => void;
  preview?: string;
  className?: string;
  disabled?: boolean;
}

const DAY_ACCESSIBLE_LABELS: Record<DayKey, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

export const HoursPicker: React.FC<HoursPickerProps> = ({
  value,
  onChange,
  preview,
  className,
  disabled = false,
}) => {
  const controlIdPrefix = `hours-${React.useId().replace(/:/g, "")}`;
  const headingId = `${controlIdPrefix}-heading`;
  const selectClass =
    "min-h-11 rounded-sm border border-strong bg-panel-raised px-2 text-base text-ink transition-colors duration-120 ease-out focus:border-brand-ink disabled:cursor-not-allowed disabled:opacity-50";

  const updateDay = (day: DayKey, patch: Partial<WeekHours[DayKey]>) => {
    onChange({
      ...value,
      [day]: { ...value[day], ...patch },
    });
  };

  const copyWeekdays = () => {
    const mon = value.mon;
    const next = { ...value };
    for (const day of ["tue", "wed", "thu", "fri"] as DayKey[]) {
      next[day] = { ...mon };
    }
    onChange(next);
  };

  const timeValue = (minutes: number) => {
    const label = minutesToLabel(minutes);
    if (TIME_OPTIONS.includes(label)) return label;
    // Snap to nearest option
    let best = TIME_OPTIONS[0];
    let bestDist = Infinity;
    for (const opt of TIME_OPTIONS) {
      const m = labelToMinutes(opt);
      if (m == null) continue;
      const dist = Math.abs(m - minutes);
      if (dist < bestDist) {
        bestDist = dist;
        best = opt;
      }
    }
    return best;
  };

  const rows = useMemo(() => DAY_ORDER, []);

  // One panel with hairline-separated day rows: no card per weekday.
  return (
    <div
      role="group"
      aria-labelledby={headingId}
      className={cn(
        "rounded-md border border-hairline bg-panel px-4 py-3 sm:px-5",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline pb-2">
        <h4 id={headingId} className="text-ink">
          Business hours
        </h4>
        <Button
          type="button"
          variant="ghost"
          size="md"
          disabled={disabled || !value.mon.open}
          onClick={copyWeekdays}
        >
          Copy Mon → weekdays
        </Button>
      </div>

      <div role="list" aria-label="Hours by day">
        {rows.map((day) => {
          const row = value[day];
          return (
            <div
              key={day}
              role="listitem"
              className="grid grid-cols-1 items-center gap-2 border-b border-hairline py-3 last:border-b-0 sm:grid-cols-[8rem_1fr]"
            >
              <button
                type="button"
                disabled={disabled}
                onClick={() => updateDay(day, { open: !row.open })}
                className="flex min-h-11 items-center gap-3 rounded-sm text-left disabled:cursor-not-allowed disabled:opacity-50"
                aria-pressed={row.open}
              >
                <span className="w-10 text-sm font-semibold text-ink">
                  {DAY_LABELS[day]}
                </span>
                {row.open ? (
                  <Badge variant="success">Open</Badge>
                ) : (
                  <Badge variant="neutral">Closed</Badge>
                )}
              </button>

              {row.open ? (
                <div className="flex flex-wrap items-center gap-2">
                  <label className="sr-only" htmlFor={`${controlIdPrefix}-open-${day}`}>
                    {DAY_ACCESSIBLE_LABELS[day]} opens
                  </label>
                  <select
                    id={`${controlIdPrefix}-open-${day}`}
                    disabled={disabled}
                    className={selectClass}
                    value={timeValue(row.openMinutes)}
                    onChange={(e) => {
                      const m = labelToMinutes(e.target.value);
                      if (m != null) updateDay(day, { openMinutes: m });
                    }}
                  >
                    {TIME_OPTIONS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <span className="text-sm text-ink-2">to</span>
                  <label
                    className="sr-only"
                    htmlFor={`${controlIdPrefix}-close-${day}`}
                  >
                    {DAY_ACCESSIBLE_LABELS[day]} closes
                  </label>
                  <select
                    id={`${controlIdPrefix}-close-${day}`}
                    disabled={disabled}
                    className={selectClass}
                    value={timeValue(row.closeMinutes)}
                    onChange={(e) => {
                      const m = labelToMinutes(e.target.value);
                      if (m != null) updateDay(day, { closeMinutes: m });
                    }}
                  >
                    {TIME_OPTIONS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <p className="text-caption text-ink-2">
                  Tap the day to mark it open and set hours
                </p>
              )}
            </div>
          );
        })}
      </div>

      {preview ? (
        <p className="border-t border-hairline pt-3 text-sm text-ink-2">
          Preview: <span className="text-ink">{preview}</span>
        </p>
      ) : null}
    </div>
  );
};
