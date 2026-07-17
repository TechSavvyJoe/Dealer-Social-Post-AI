import React from "react";
import { AlertTriangle, Hash, Info } from "lucide-react";
import {
  PLATFORM_LIMITS,
  evaluate,
  countHashtags,
} from "../utils/platformLimits";
import { cn } from "../utils/classNames";

/** Map publish / Share-to ids → PLATFORM_LIMITS row ids. */
const PLATFORM_ID_MAP: Record<string, string> = {
  instagram_feed: "instagram",
  instagram_story: "instagram",
  facebook_feed: "facebook",
  tiktok: "tiktok",
  gbp: "gbp",
  marketplace: "marketplace",
  x_twitter: "x",
  linkedin: "facebook", // no dedicated LI meter — approximate with FB length
};

interface PlatformLimitMeterProps {
  /** The text that will actually be posted (caption + disclosures + hashtags). */
  text: string;
  className?: string;
  /** When set, only show meters for these Share-to platforms (plus always IG/FB/TikTok core if empty). */
  platformIds?: string[];
}

const stateClasses: Record<
  "ok" | "fold" | "over",
  { dot: string; bar: string; label: string }
> = {
  ok: {
    dot: "bg-success-400",
    bar: "bg-success-500/70",
    label: "text-surface-300",
  },
  fold: {
    dot: "bg-warning-400",
    bar: "bg-warning-500/70",
    label: "text-warning-200",
  },
  over: {
    dot: "bg-error-400",
    bar: "bg-error-500/80",
    label: "text-error-200 font-semibold",
  },
};

export const PlatformLimitMeter: React.FC<PlatformLimitMeterProps> = ({
  text,
  className,
  platformIds,
}) => {
  const hashtags = countHashtags(text);

  const limits = (() => {
    if (!platformIds?.length) {
      // Dealer-first defaults: IG, Facebook, TikTok, Google — hide X by default
      return PLATFORM_LIMITS.filter((l) => l.id !== "x");
    }
    const wanted = new Set(
      platformIds
        .map((id) => PLATFORM_ID_MAP[id] || id)
        .filter(Boolean),
    );
    const filtered = PLATFORM_LIMITS.filter((l) => wanted.has(l.id));
    return filtered.length > 0
      ? filtered
      : PLATFORM_LIMITS.filter((l) => l.id !== "x");
  })();

  return (
    <div
      className={cn(
        "rounded-xl border border-white/10 bg-surface-900/40 p-3 space-y-2",
        className
      )}
    >
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-surface-400">
        <span className="flex items-center gap-1">
          <Info className="w-3 h-3" />
          Platform fit
        </span>
        <span className="flex items-center gap-1">
          <Hash className="w-3 h-3" /> {hashtags} hashtags
        </span>
      </div>

      <div className="space-y-1.5">
        {limits.map((limit) => {
          const { count, state } = evaluate(text, limit);
          const pct = Math.min(100, (count / limit.maxChars) * 100);
          const klass = stateClasses[state];
          const hashtagWarning =
            limit.maxHashtags !== undefined && hashtags > limit.maxHashtags;
          return (
            <div key={limit.id} className="flex items-center gap-2">
              <div className={cn("w-1.5 h-1.5 rounded-full", klass.dot)} />
              <span className={cn("text-[11px] flex-shrink-0 w-28", klass.label)}>
                {limit.label}
              </span>
              <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", klass.bar)}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span
                className={cn(
                  "text-[10px] font-mono tabular-nums flex-shrink-0 w-16 text-right",
                  klass.label
                )}
              >
                {count}/{limit.maxChars}
              </span>
              {(state === "over" || hashtagWarning) && (
                <AlertTriangle
                  className="w-3 h-3 text-error-400 flex-shrink-0"
                  aria-label={
                    state === "over"
                      ? `Over the ${limit.label} limit`
                      : `Too many hashtags for ${limit.label}`
                  }
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
