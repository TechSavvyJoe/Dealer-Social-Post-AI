import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Hash, Plus, X, AlignLeft } from "lucide-react";
import { cn } from "../utils/classNames";
import {
  hashtagBudgetForPlatform,
  joinCaptionBodyAndTags,
  normalizeCaptionHashtags,
  parseHashtagInput,
  splitCaptionBodyAndTags,
} from "../utils/hashtags";
import { resolvePlatformOption } from "../services/platformCopy";
import { Textarea } from "./ui/Input";

export interface CaptionStudioProps {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  /** Active caption-pack platform id, or null for primary. */
  platformId?: string | null;
  /** Compliance / a11y linkage when claims are blocked. */
  claimLocked?: boolean;
  /** Keeps the editor within the desktop publishing workspace's first viewport. */
  compact?: boolean;
  /**
   * Suppresses the hashtag chip editor and its toggle, leaving one plain
   * caption field. Brand mode keeps the caption on the publish surface but
   * moves chip editing behind the "Studio tools" disclosure, so the same
   * editor serves both places instead of mounting a second one.
   */
  hideHashtagEditor?: boolean;
  className?: string;
}

/**
 * Advanced caption editor: body and hashtags edit independently, with
 * platform-specific guidance and live fit stats.
 */
export const CaptionStudio: React.FC<CaptionStudioProps> = ({
  value,
  onChange,
  hideHashtagEditor = false,
  disabled = false,
  platformId = null,
  claimLocked = false,
  compact = false,
  className,
}) => {
  const [body, setBody] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  // Single text box by default — salespeople shouldn't hunt for settings.
  const [combinedModeState, setCombinedMode] = useState(true);
  // Suppressed: the split view is unreachable, so stay in the plain field.
  const combinedMode = hideHashtagEditor ? true : combinedModeState;
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
    <div className={cn(compact ? "space-y-2" : "space-y-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-surface-400">
          <span className="font-semibold text-surface-200">{platformLabel}</span>
          <span className="font-mono tabular-nums text-surface-400">
            {totalChars} chars
          </span>
          {budget && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                tagStatus === "over"
                  ? "bg-error-500/20 text-error-200 [.theme-light_&]:text-error-800"
                  : "bg-white/5 text-surface-300",
              )}
            >
              <Hash className="h-2.5 w-2.5" />
              {tagCount} hashtags
            </span>
          )}
        </div>
        {!hideHashtagEditor && (
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
                <Hash className="h-3 w-3" />
                Edit hashtags
              </>
            ) : (
              <>
                <AlignLeft className="h-3 w-3" />
                Simple view
              </>
            )}
          </button>
        )}
      </div>

      {combinedMode ? (
        // Shared field system: one focus treatment (the app-wide field focus
        // border) instead of a bespoke ring stacked on the global brand ring.
        <Textarea
          aria-label="Full caption text"
          aria-invalid={claimLocked || undefined}
          aria-describedby={claimLocked ? "caption-compliance-alert" : undefined}
          value={combinedDraft}
          onChange={(e) => handleCombinedChange(e.target.value)}
          disabled={disabled}
          fullWidth
          placeholder="Your social post appears here automatically…"
          className={cn(
            compact
              ? "h-36 min-h-[8rem] lg:h-40 lg:max-h-[18rem]"
              : "h-56 min-h-[12rem] lg:h-72 lg:max-h-[28rem]",
            "resize-y leading-relaxed",
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
              <span className="text-[10px] font-mono tabular-nums text-surface-400">
                {bodyChars} chars
              </span>
            </div>
            <Textarea
              id="caption-body-editor"
              aria-label="Caption body without hashtags"
              aria-invalid={claimLocked || undefined}
              aria-describedby={claimLocked ? "caption-compliance-alert" : undefined}
              value={body}
              onChange={(e) => handleBodyChange(e.target.value)}
              disabled={disabled}
              fullWidth
              placeholder="Post body…"
              className={cn(
                compact
                  ? "h-28 lg:h-32 lg:max-h-[15rem]"
                  : "h-36 lg:h-44 lg:max-h-[20rem]",
                "resize-y leading-relaxed",
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
                      : "text-surface-400",
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
                        "bg-primary-500/10 px-2.5 py-1 text-xs font-semibold text-primary-100 [.theme-light_&]:text-primary-950",
                        "transition-colors hover:border-error-400/40 hover:bg-error-500/15 hover:text-error-100 [.theme-light_&]:text-error-800",
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
              <p className="text-[11px] text-surface-400">
                Hashtags appear automatically with each AI caption. Add more only if you
                want a custom tag.
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
                  "border border-primary-400/40 bg-primary-500/20 text-primary-100 [.theme-light_&]:text-primary-950",
                  "hover:bg-primary-500/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/70",
                  "disabled:cursor-not-allowed disabled:opacity-40",
                )}
                aria-label="Add hashtag"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <p className="text-[10px] leading-relaxed text-surface-400">
              AI ships 4–5 discovery tags plus your store brand tag. Optional: type a
              phrase and press Enter to add. Tap a chip to remove.
            </p>
          </div>
        </>
      )}
    </div>
  );
};
