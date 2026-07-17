import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Hash, Info, Plus, X, AlignLeft, Sparkles } from "lucide-react";
import { cn } from "../utils/classNames";
import {
  hashtagBudgetForPlatform,
  joinCaptionBodyAndTags,
  normalizeCaptionHashtags,
  parseHashtagInput,
  splitCaptionBodyAndTags,
} from "../utils/hashtags";
import { resolvePlatformOption } from "../services/platformCopy";

export interface CaptionStudioProps {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  /** Active caption-pack platform id, or null for primary. */
  platformId?: string | null;
  /** Compliance / a11y linkage when claims are blocked. */
  claimLocked?: boolean;
  className?: string;
}

const PLATFORM_TIPS: Record<string, string> = {
  instagram_feed:
    "Hook in line 1, warm story, store CTA. Keep tags on their own last line.",
  instagram_story:
    "One punchy line + store name. Hashtags are optional on Stories.",
  facebook_feed:
    "Conversational is fine — Facebook allows longer posts. Use 0–3 light tags only.",
  tiktok:
    "Scroll-stopping first line, casual voice, 3–5 descriptive tags.",
  gbp: "Factual and local. Keywords in the body matter more than hashtags.",
  marketplace:
    "Listing tone: clear value pitch and contact CTA. Skip heavy hashtags.",
  linkedin: "Professional tone; 1–3 tags max.",
  x_twitter: "Optional for most dealers — stay under 280 chars total.",
};

/**
 * Advanced caption editor: body and hashtags edit independently, with
 * platform-specific guidance and live fit stats.
 */
export const CaptionStudio: React.FC<CaptionStudioProps> = ({
  value,
  onChange,
  disabled = false,
  platformId = null,
  claimLocked = false,
  className,
}) => {
  const [body, setBody] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [combinedMode, setCombinedMode] = useState(false);
  const [combinedDraft, setCombinedDraft] = useState(value);
  // Track last emitted value so external resets (undo, platform tab) re-sync.
  const lastEmitted = React.useRef(value);

  // Sync from parent when value changes outside this editor.
  useEffect(() => {
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    const split = splitCaptionBodyAndTags(value);
    setBody(split.body);
    setTags(split.tags);
    setCombinedDraft(value);
  }, [value]);

  // Initial mount
  useEffect(() => {
    const split = splitCaptionBodyAndTags(value);
    setBody(split.body);
    setTags(split.tags);
    setCombinedDraft(value);
    lastEmitted.current = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  const emit = useCallback(
    (nextBody: string, nextTags: string[]) => {
      const joined = joinCaptionBodyAndTags(nextBody, nextTags);
      lastEmitted.current = joined;
      onChange(joined);
    },
    [onChange],
  );

  const handleBodyChange = (next: string) => {
    setBody(next);
    emit(next, tags);
  };

  const handleTagsChange = (nextTags: string[]) => {
    setTags(nextTags);
    emit(body, nextTags);
  };

  const addTagsFromDraft = () => {
    const parsed = parseHashtagInput(tagDraft);
    if (parsed.length === 0) return;
    const merged = parseHashtagInput([...tags, ...parsed].join(" "));
    handleTagsChange(merged);
    setTagDraft("");
  };

  const removeTag = (tag: string) => {
    handleTagsChange(tags.filter((t) => t.toLowerCase() !== tag.toLowerCase()));
  };

  const handleCombinedChange = (next: string) => {
    setCombinedDraft(next);
    const normalized = normalizeCaptionHashtags(next);
    lastEmitted.current = normalized;
    onChange(normalized);
    const split = splitCaptionBodyAndTags(normalized);
    setBody(split.body);
    setTags(split.tags);
  };

  const budget = hashtagBudgetForPlatform(platformId);
  const platformLabel = platformId
    ? resolvePlatformOption(platformId)?.label || platformId
    : "Primary (all platforms)";
  const tip =
    (platformId && PLATFORM_TIPS[platformId]) ||
    "Edit the caption body and hashtags separately. Hashtags auto-format to #PascalCase.";

  const bodyChars = body.length;
  const tagCount = tags.length;
  const totalChars = value.length;
  const tagStatus = useMemo(() => {
    if (!budget) return "ok" as const;
    if (tagCount > budget.max) return "over" as const;
    if (tagCount < budget.min) return "low" as const;
    return "ok" as const;
  }, [budget, tagCount]);

  return (
    <div className={cn("space-y-3", className)}>
      {/* Platform guidance */}
      <div className="rounded-xl border border-primary-500/20 bg-primary-500/5 px-3 py-2.5">
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary-300" />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-xs font-semibold text-primary-100">
                {platformLabel}
              </span>
              {budget && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    tagStatus === "over"
                      ? "bg-error-500/20 text-error-200"
                      : tagStatus === "low"
                        ? "bg-warning-500/15 text-warning-200"
                        : "bg-success-500/15 text-success-200",
                  )}
                >
                  <Hash className="h-2.5 w-2.5" />
                  {tagCount} tags · aim {budget.min}–{budget.max}
                </span>
              )}
              <span className="text-[10px] font-mono tabular-nums text-surface-500">
                {totalChars} chars
              </span>
            </div>
            <p className="text-[11px] leading-relaxed text-surface-300">
              {tip}
            </p>
            {budget?.note && (
              <p className="text-[10px] leading-relaxed text-surface-500">
                {budget.note}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Mode toggle */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wide text-surface-500">
          {combinedMode ? "Combined editor" : "Body + hashtags"}
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            if (!combinedMode) {
              setCombinedDraft(value);
            } else {
              const split = splitCaptionBodyAndTags(combinedDraft || value);
              setBody(split.body);
              setTags(split.tags);
            }
            setCombinedMode((m) => !m);
          }}
          className={cn(
            "inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors",
            "border-white/10 bg-white/[0.04] text-surface-300 hover:border-white/20 hover:bg-white/[0.08]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/70",
            "disabled:cursor-not-allowed disabled:opacity-40",
          )}
        >
          {combinedMode ? (
            <>
              <Sparkles className="h-3 w-3" />
              Split view
            </>
          ) : (
            <>
              <AlignLeft className="h-3 w-3" />
              One block
            </>
          )}
        </button>
      </div>

      {combinedMode ? (
        <textarea
          aria-label="Full caption text"
          aria-invalid={claimLocked || undefined}
          aria-describedby={claimLocked ? "caption-compliance-alert" : undefined}
          value={combinedDraft}
          onChange={(e) => handleCombinedChange(e.target.value)}
          disabled={disabled}
          className={cn(
            "h-52 w-full lg:h-64 lg:max-h-[28rem]",
            "bg-surface-800/50 text-surface-200 p-4 rounded-xl text-sm",
            "resize-y border-2 border-transparent leading-relaxed",
            "focus:border-primary-400 focus:ring-2 focus:ring-primary-400",
            "outline-none transition-all duration-300",
            "disabled:cursor-not-allowed disabled:opacity-60",
          )}
        />
      ) : (
        <>
          {/* Body */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="caption-body-editor"
                className="text-[11px] font-semibold uppercase tracking-wide text-surface-400"
              >
                Post body
              </label>
              <span className="text-[10px] font-mono tabular-nums text-surface-500">
                {bodyChars} chars
              </span>
            </div>
            <textarea
              id="caption-body-editor"
              aria-label="Caption body without hashtags"
              aria-invalid={claimLocked || undefined}
              aria-describedby={
                claimLocked ? "caption-compliance-alert" : undefined
              }
              value={body}
              onChange={(e) => handleBodyChange(e.target.value)}
              disabled={disabled}
              placeholder="Hook, story, and call to action…"
              className={cn(
                "h-36 w-full lg:h-44 lg:max-h-[20rem]",
                "bg-surface-800/50 text-surface-200 p-4 rounded-xl text-sm",
                "resize-y border-2 border-transparent leading-relaxed",
                "focus:border-primary-400 focus:ring-2 focus:ring-primary-400",
                "outline-none transition-all duration-300",
                "placeholder:text-surface-600",
                "disabled:cursor-not-allowed disabled:opacity-60",
              )}
            />
          </div>

          {/* Hashtags */}
          <div className="space-y-2 rounded-xl border border-white/10 bg-surface-900/50 p-3">
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-surface-400">
                <Hash className="h-3.5 w-3.5" />
                Hashtags
              </label>
              <span
                className={cn(
                  "text-[10px] font-mono tabular-nums",
                  tagStatus === "over"
                    ? "text-error-300"
                    : tagStatus === "low"
                      ? "text-warning-300"
                      : "text-surface-500",
                )}
              >
                {tagCount}
                {budget ? ` / ${budget.max} max` : ""}
              </span>
            </div>

            {tags.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5" aria-label="Hashtag list">
                {tags.map((tag) => (
                  <li key={tag}>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => removeTag(tag)}
                      className={cn(
                        "group inline-flex min-h-9 items-center gap-1 rounded-full border border-primary-400/30",
                        "bg-primary-500/10 px-2.5 py-1 text-xs font-semibold text-primary-100",
                        "transition-colors hover:border-error-400/40 hover:bg-error-500/15 hover:text-error-100",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/70",
                        "disabled:cursor-not-allowed disabled:opacity-50",
                      )}
                      aria-label={`Remove ${tag}`}
                      title="Tap to remove"
                    >
                      {tag}
                      <X className="h-3 w-3 opacity-60 group-hover:opacity-100" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] text-surface-500">
                No hashtags yet — add a few relevant ones for this platform.
              </p>
            )}

            <div className="flex gap-2">
              <input
                type="text"
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTagsFromDraft();
                  }
                }}
                disabled={disabled}
                placeholder="Add tag (e.g. NewCarDelivery or #LocalDealer)"
                aria-label="Add hashtag"
                className={cn(
                  "min-h-11 flex-1 rounded-lg border border-white/10 bg-surface-800/60 px-3 text-sm text-surface-100",
                  "placeholder:text-surface-600",
                  "focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-400/50",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                )}
              />
              <button
                type="button"
                disabled={disabled || !tagDraft.trim()}
                onClick={addTagsFromDraft}
                className={cn(
                  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg",
                  "border border-primary-400/40 bg-primary-500/20 text-primary-100",
                  "hover:bg-primary-500/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/70",
                  "disabled:cursor-not-allowed disabled:opacity-40",
                )}
                aria-label="Add hashtag"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <p className="text-[10px] leading-relaxed text-surface-500">
              Tags auto-format to single #PascalCase tokens (no spaces). Separate
              multiple with spaces or commas. Tap a chip to remove it.
            </p>
          </div>
        </>
      )}
    </div>
  );
};
