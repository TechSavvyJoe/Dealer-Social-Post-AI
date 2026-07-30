import React, { useMemo } from "react";
import { Clock } from "lucide-react";
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
  const selectClass =
    "rounded-lg border border-white/10 bg-surface-950/60 px-2 py-1.5 text-sm text-surface-100 focus:border-primary-400 focus:outline-none disabled:opacity-50";

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

  return (
    <div
      className={cn(
        "space-y-3 rounded-xl border border-white/10 bg-surface-950/40 p-3 sm:p-4",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-surface-50">
          <Clock className="h-4 w-4 text-primary-300" aria-hidden="true" />
          Business hours
        </div>
        <button
          type="button"
          disabled={disabled || !value.mon.open}
          onClick={copyWeekdays}
          className="text-xs font-semibold text-primary-300 hover:text-primary-200 disabled:opacity-40"
        >
          Copy Mon → weekdays
        </button>
      </div>

      <div className="space-y-2" role="list" aria-label="Hours by day">
        {rows.map((day) => {
          const row = value[day];
          return (
            <div
              key={day}
              role="listitem"
              className={cn(
                "grid grid-cols-1 items-center gap-2 rounded-lg border px-3 py-2 sm:grid-cols-[5.5rem_1fr]",
                row.open
                  ? "border-primary-500/30 bg-primary-500/5"
                  : "border-white/5 bg-white/[0.02] opacity-80",
              )}
            >
              <button
                type="button"
                disabled={disabled}
                onClick={() => updateDay(day, { open: !row.open })}
                className="flex items-center gap-2 text-left"
                aria-pressed={row.open}
              >
                <span className="w-10 text-sm font-semibold text-surface-100">
                  {DAY_LABELS[day]}
                </span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                    row.open
                      ? "bg-success-500/15 text-success-300"
                      : "bg-surface-800 text-surface-400",
                  )}
                >
                  {row.open ? "Open" : "Closed"}
                </span>
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
                  <span className="text-xs text-surface-500">to</span>
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
                <p className="text-xs text-surface-500">
                  Tap the day to mark it open and set hours
                </p>
              )}
            </div>
          );
        })}
      </div>

      {preview ? (
        <p className="text-xs text-surface-400">
          Preview: <span className="font-mono text-primary-200/90">{preview}</span>
        </p>
      ) : null}
    </div>
  );
};
