/**
 * Structured business hours ↔ caption-friendly free-text on dealers.hours.
 */

export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export interface DayHours {
  open: boolean;
  /** Minutes from midnight, e.g. 9:00 AM = 540 */
  openMinutes: number;
  closeMinutes: number;
}

export type WeekHours = Record<DayKey, DayHours>;

export const DAY_ORDER: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export const DAY_LABELS: Record<DayKey, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

const DEFAULT_OPEN = 9 * 60;
const DEFAULT_CLOSE = 20 * 60;

export const defaultWeekHours = (): WeekHours => {
  const week = {} as WeekHours;
  for (const day of DAY_ORDER) {
    const isWeekend = day === "sat" || day === "sun";
    week[day] = {
      open: day !== "sun",
      openMinutes: DEFAULT_OPEN,
      closeMinutes: day === "sat" ? 18 * 60 : isWeekend ? DEFAULT_CLOSE : DEFAULT_CLOSE,
    };
    if (day === "sun") {
      week[day] = {
        open: false,
        openMinutes: DEFAULT_OPEN,
        closeMinutes: DEFAULT_CLOSE,
      };
    }
  }
  return week;
};

export const minutesToLabel = (minutes: number): string => {
  const clamped = Math.max(0, Math.min(23 * 60 + 30, minutes));
  const h24 = Math.floor(clamped / 60);
  const m = clamped % 60;
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`;
};

export const labelToMinutes = (label: string): number | null => {
  const match = label.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const period = match[3].toUpperCase();
  if (h < 1 || h > 12 || m < 0 || m > 59) return null;
  if (period === "AM") {
    if (h === 12) h = 0;
  } else if (h !== 12) {
    h += 12;
  }
  return h * 60 + m;
};

/** 30-minute steps from 6:00 AM through 11:30 PM */
export const TIME_OPTIONS: string[] = (() => {
  const opts: string[] = [];
  for (let minutes = 6 * 60; minutes <= 23 * 60 + 30; minutes += 30) {
    opts.push(minutesToLabel(minutes));
  }
  return opts;
})();

const DAY_ALIASES: Record<string, DayKey> = {
  mon: "mon",
  monday: "mon",
  tue: "tue",
  tues: "tue",
  tuesday: "tue",
  wed: "wed",
  wednesday: "wed",
  thu: "thu",
  thur: "thu",
  thurs: "thu",
  thursday: "thu",
  fri: "fri",
  friday: "fri",
  sat: "sat",
  saturday: "sat",
  sun: "sun",
  sunday: "sun",
};

const parseTimeToken = (raw: string): number | null => {
  const cleaned = raw.replace(/\./g, "").trim();
  const withMinutes = cleaned.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (withMinutes) {
    const h = parseInt(withMinutes[1], 10);
    const m = parseInt(withMinutes[2], 10);
    let period = (withMinutes[3] || "").toUpperCase();
    if (!period) {
      // 24h-ish fallback
      if (h > 23 || m > 59) return null;
      return h * 60 + m;
    }
    return labelToMinutes(`${h}:${m.toString().padStart(2, "0")} ${period}`);
  }
  const plain = cleaned.match(/^(\d{1,2})\s*(am|pm)$/i);
  if (plain) {
    return labelToMinutes(`${plain[1]}:00 ${plain[2].toUpperCase()}`);
  }
  return null;
};

/**
 * Best-effort parse of free-text hours. Returns null when unparseable so the
 * UI can start from defaults while still showing the original string once.
 */
export const parseHoursString = (
  input: string | undefined | null,
): WeekHours | null => {
  const text = (input || "").trim();
  if (!text) return defaultWeekHours();

  const week = defaultWeekHours();
  for (const day of DAY_ORDER) {
    week[day] = { open: false, openMinutes: DEFAULT_OPEN, closeMinutes: DEFAULT_CLOSE };
  }

  let matchedAny = false;
  const segments = text
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const segment of segments) {
    const closed = /closed/i.test(segment);
    const rangeMatch = segment.match(
      /^([A-Za-z]{3,9})(?:\s*[–—\-]\s*([A-Za-z]{3,9}))?\s+(.+)$/,
    );
    if (!rangeMatch) continue;

    const startKey = DAY_ALIASES[rangeMatch[1].toLowerCase()];
    const endKey = rangeMatch[2] ? DAY_ALIASES[rangeMatch[2].toLowerCase()] : startKey;
    if (!startKey || !endKey) continue;

    const startIdx = DAY_ORDER.indexOf(startKey);
    const endIdx = DAY_ORDER.indexOf(endKey);
    if (startIdx < 0 || endIdx < 0) continue;

    let openMinutes = DEFAULT_OPEN;
    let closeMinutes = DEFAULT_CLOSE;
    if (!closed) {
      const times = rangeMatch[3]
        .split(/[–—\-]| to /i)
        .map((t) => t.trim())
        .filter(Boolean);
      if (times.length >= 2) {
        const o = parseTimeToken(times[0]);
        const c = parseTimeToken(times[1]);
        if (o == null || c == null) continue;
        openMinutes = o;
        closeMinutes = c;
      } else {
        continue;
      }
    }

    for (let i = startIdx; i <= endIdx; i++) {
      const day = DAY_ORDER[i];
      week[day] = {
        open: !closed,
        openMinutes,
        closeMinutes,
      };
      matchedAny = true;
    }
  }

  return matchedAny ? week : null;
};

const collapseOpenRuns = (week: WeekHours): string[] => {
  const parts: string[] = [];
  let i = 0;
  while (i < DAY_ORDER.length) {
    const day = DAY_ORDER[i];
    const cur = week[day];
    if (!cur.open) {
      // Collect closed runs only if we already have content (or always for Sun-style).
      let j = i;
      while (j < DAY_ORDER.length && !week[DAY_ORDER[j]].open) j++;
      const startLabel = DAY_LABELS[DAY_ORDER[i]];
      const endLabel = DAY_LABELS[DAY_ORDER[j - 1]];
      parts.push(
        i === j - 1 ? `${startLabel} closed` : `${startLabel}–${endLabel} closed`,
      );
      i = j;
      continue;
    }

    let j = i + 1;
    while (
      j < DAY_ORDER.length &&
      week[DAY_ORDER[j]].open &&
      week[DAY_ORDER[j]].openMinutes === cur.openMinutes &&
      week[DAY_ORDER[j]].closeMinutes === cur.closeMinutes
    ) {
      j++;
    }
    const startLabel = DAY_LABELS[DAY_ORDER[i]];
    const endLabel = DAY_LABELS[DAY_ORDER[j - 1]];
    const range = i === j - 1 ? startLabel : `${startLabel}–${endLabel}`;
    parts.push(
      `${range} ${minutesToLabel(cur.openMinutes)}–${minutesToLabel(cur.closeMinutes)}`,
    );
    i = j;
  }
  return parts;
};

export const serializeHours = (week: WeekHours): string => {
  // Prefer collapsing open days; skip trailing "closed" chains that are all closed if entire week closed.
  const anyOpen = DAY_ORDER.some((d) => week[d].open);
  if (!anyOpen) return "Closed";
  return collapseOpenRuns(week).join(", ");
};
