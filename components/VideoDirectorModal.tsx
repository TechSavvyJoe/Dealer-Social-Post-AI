import React, { useState, useCallback, useEffect, memo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { VideoStyle, VideoRequestOptions } from "../types";
import { Icon } from "./Icons";
import { triggerHapticFeedback } from "../utils/haptics";
import { Modal } from "./ui/Modal";
import { cn } from "../utils/classNames";
import {
  defaultResolution,
  durations,
  soundtracks,
  aspectRatios,
  styles as videoStyles,
} from "./video-director/constants";

// Recommended = top automotive marketing motion recipes
const QUICK_STYLES = videoStyles.filter((s) => s.recommended);
const EXPERIMENTAL_STYLES = videoStyles.filter((s) => !s.recommended);

const VIDEO_QUALITIES: Array<{
  value: VideoRequestOptions["resolution"];
  label: string;
  detail: string;
}> = [
  {
    value: "720p",
    label: "Fast 720p",
    detail: "Quicker everyday render",
  },
  {
    value: "1080p",
    label: "Quality 1080p",
    detail: "Best detail · fixed at 8s",
  },
];

/** One-tap formats for the channels dealerships actually post to. */
const FORMAT_PRESETS: Array<{
  id: string;
  label: string;
  sub: string;
  aspect: VideoRequestOptions["aspectPreference"];
  soundtrack: VideoRequestOptions["soundtrack"];
  duration: number;
}> = [
  {
    id: "vertical",
    label: "Vertical 9:16",
    sub: "Reels · TikTok · Stories",
    aspect: "9:16",
    soundtrack: "cinematic",
    duration: 6,
  },
  {
    id: "horizontal",
    label: "Wide 16:9",
    sub: "YouTube · Facebook feed",
    aspect: "16:9",
    soundtrack: "cinematic",
    duration: 6,
  },
];

interface VideoDirectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectStyle: (style: VideoStyle, options: VideoRequestOptions) => void;
  /** Inherit the safest supported video ratio from selected destinations. */
  defaultAspect?: "9:16" | "16:9";
}

const StyleButton = memo(
  ({
    style,
    label,
    icon,
    description,
    isRecommended,
    onSelect,
  }: {
    style: VideoStyle;
    label: string;
    icon: string;
    description: string;
    isRecommended?: boolean;
    onSelect: (style: VideoStyle) => void;
  }) => (
    <button
      type="button"
      onClick={() => {
        triggerHapticFeedback();
        onSelect(style);
      }}
      className="group relative flex items-center p-3 sm:p-3 bg-surface-900/60 hover:bg-primary-500/15
               border border-surface-800 hover:border-primary-400 rounded-xl transition-all duration-150
               active:scale-95 touch-manipulation w-full text-left gap-3"
    >
      <div className="shrink-0">
        <Icon
          type={icon as any}
          className="w-8 h-8 sm:w-9 sm:h-9 text-primary-300 group-hover:text-primary-200 transition-colors"
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-white text-sm truncate">{label}</span>
          {isRecommended && (
            <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/30 text-emerald-300 border border-emerald-400/40 uppercase tracking-wide font-bold">
              ★ Pro
            </span>
          )}
        </div>
        <span className="block mt-0.5 text-[11px] text-white/60 truncate">
          {description}
        </span>
      </div>
    </button>
  ),
);

export const VideoDirectorModal: React.FC<VideoDirectorModalProps> = memo(
  ({ isOpen, onClose, onSelectStyle, defaultAspect = "9:16" }) => {
    const [showMore, setShowMore] = useState(false);
    // Default vertical + music for dealership Reels/TikTok (not silent landscape).
    const [aspectPreference, setAspectPreference] =
      useState<VideoRequestOptions["aspectPreference"]>("9:16");
    const [soundtrack, setSoundtrack] =
      useState<VideoRequestOptions["soundtrack"]>("cinematic");
    const [duration, setDuration] = useState(6);
    const [resolution, setResolution] =
      useState<VideoRequestOptions["resolution"]>(defaultResolution);
    const [activePreset, setActivePreset] = useState("vertical");

    useEffect(() => {
      if (!isOpen) return;
      setAspectPreference(defaultAspect);
      setActivePreset(defaultAspect === "9:16" ? "vertical" : "horizontal");
    }, [defaultAspect, isOpen]);

    const buildOptions = useCallback((): VideoRequestOptions => {
      return {
        durationSeconds: resolution === "1080p" ? 8 : duration,
        soundtrack,
        aspectPreference,
        resolution,
        pacing: "cinematic",
      };
    }, [aspectPreference, duration, resolution, soundtrack]);

    const handleStyleSelect = useCallback(
      (style: VideoStyle) => {
        onSelectStyle(style, buildOptions());
      },
      [buildOptions, onSelectStyle],
    );

    const applyPreset = (presetId: string) => {
      const preset = FORMAT_PRESETS.find((p) => p.id === presetId);
      if (!preset) return;
      triggerHapticFeedback();
      setActivePreset(preset.id);
      setAspectPreference(preset.aspect);
      setSoundtrack(preset.soundtrack);
      setDuration(resolution === "1080p" ? 8 : preset.duration);
    };

    return (
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        size="lg"
        title="Creator video"
        description="Automotive marketing motion for real delivery photos. Format → quality → sound → style."
        className="bg-surface-900 border-surface-800"
      >
        <div className="mb-4 space-y-4">
          <p className="text-xs leading-relaxed text-surface-400">
            Built for dealership social: living photography, paint sheen, tasteful
            celebration — not fake CGI cars. Vertical 9:16 for Reels/TikTok. Music on by
            default; tap <strong className="text-surface-200">Tap for sound</strong>{" "}
            after render.
          </p>

          {/* Platform format presets */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-primary-300/80">
              Format for
            </h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {FORMAT_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={activePreset === p.id}
                  onClick={() => applyPreset(p.id)}
                  className={cn(
                    "rounded-xl border px-3 py-2.5 text-left transition-colors",
                    activePreset === p.id
                      ? "border-primary-400 bg-primary-500/20 text-white"
                      : "border-surface-800 bg-surface-900/60 text-surface-300 hover:border-primary-400/50",
                  )}
                >
                  <div className="text-sm font-semibold">{p.label}</div>
                  <div className="text-[11px] opacity-80">{p.sub}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Aspect + sound + duration */}
          <div className="space-y-3 rounded-xl border border-white/10 bg-surface-950/40 p-3">
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold text-white/80">
                Video quality
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {VIDEO_QUALITIES.map(({ value, label, detail }) => (
                  <button
                    key={value}
                    type="button"
                    aria-label={`${label}. ${detail}`}
                    aria-pressed={resolution === value}
                    onClick={() => {
                      triggerHapticFeedback();
                      setResolution(value);
                      if (value === "1080p") setDuration(8);
                    }}
                    className={cn(
                      "min-h-14 rounded-lg border px-2.5 py-2 text-left transition-all",
                      resolution === value
                        ? "border-primary-400 bg-primary-500/20 text-white"
                        : "border-surface-800 bg-surface-900/60 text-surface-300 hover:border-primary-400/50",
                    )}
                  >
                    <span className="block text-sm font-semibold">{label}</span>
                    <span className="mt-0.5 block text-[10px] leading-tight opacity-75">
                      {detail}
                    </span>
                  </button>
                ))}
              </div>
              <p
                aria-live="polite"
                className="text-[10px] leading-relaxed text-surface-500"
              >
                {resolution === "1080p"
                  ? "Quality mode uses the premium 1080p model and requires an 8-second video."
                  : "Fast mode uses the 720p model and usually finishes sooner."}
              </p>
            </fieldset>

            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-white/80">Aspect ratio</h3>
              <div className="flex flex-wrap gap-2">
                {aspectRatios.map(({ value, label, description }) => (
                  <button
                    key={value}
                    type="button"
                    title={description}
                    aria-pressed={aspectPreference === value}
                    onClick={() => {
                      triggerHapticFeedback();
                      setAspectPreference(value);
                      setActivePreset("");
                    }}
                    className={cn(
                      "min-h-10 flex-1 rounded-lg border px-2 py-2 text-sm font-medium transition-all sm:min-w-[4.5rem]",
                      aspectPreference === value
                        ? "border-primary-400 bg-primary-500/20 text-white"
                        : "border-surface-800 bg-surface-900/60 text-surface-300 hover:border-primary-400/50",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-surface-500">
                Veo renders <strong className="text-surface-300">9:16</strong>{" "}
                (vertical) or <strong className="text-surface-300">16:9</strong> (wide).
                The file and label always use the same ratio.
              </p>
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-white/80">Sound</h3>
              <div className="flex gap-2">
                {soundtracks.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={soundtrack === value}
                    onClick={() => {
                      triggerHapticFeedback();
                      setSoundtrack(value);
                    }}
                    className={cn(
                      "min-h-10 flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-all",
                      soundtrack === value
                        ? "border-primary-400 bg-primary-500/20 text-white"
                        : "border-surface-800 bg-surface-900/60 text-surface-300 hover:border-primary-400/50",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-white/80">Length</h3>
              {resolution === "1080p" ? (
                <div
                  role="status"
                  className="flex min-h-10 items-center justify-between rounded-lg border border-primary-400 bg-primary-500/20 px-3 py-2 text-sm text-white"
                >
                  <span className="font-semibold">8 seconds</span>
                  <span className="text-[10px] text-primary-100/80">
                    Required for 1080p
                  </span>
                </div>
              ) : (
                <div className="flex gap-2">
                  {durations.map(({ value, label, description }) => (
                    <button
                      key={value}
                      type="button"
                      title={description}
                      aria-pressed={duration === value}
                      onClick={() => {
                        triggerHapticFeedback();
                        setDuration(value);
                      }}
                      className={cn(
                        "min-h-10 flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-all",
                        duration === value
                          ? "border-primary-400 bg-primary-500/20 text-white"
                          : "border-surface-800 bg-surface-900/60 text-surface-300 hover:border-primary-400/50",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mb-4">
          <p className="text-xs font-semibold text-primary-300/80 uppercase tracking-wide mb-2">
            Marketing styles
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {QUICK_STYLES.map(({ style, label, icon, description }) => (
              <StyleButton
                key={style}
                style={style}
                label={label}
                icon={icon}
                description={description}
                isRecommended
                onSelect={handleStyleSelect}
              />
            ))}
          </div>
        </div>

        {EXPERIMENTAL_STYLES.length > 0 && (
          <div className="border-t border-white/10 pt-2">
            <button
              type="button"
              onClick={() => {
                triggerHapticFeedback();
                setShowMore(!showMore);
              }}
              className="w-full px-2 py-3 flex items-center justify-between text-sm text-white/70 hover:text-white hover:bg-white/5 transition-colors touch-manipulation rounded-lg"
            >
              <span>{showMore ? "Hide" : "Show"} extra styles</span>
              <Icon
                type="chevron-down"
                className={`w-5 h-5 transition-transform duration-200 ${
                  showMore ? "rotate-180" : ""
                }`}
              />
            </button>

            <AnimatePresence>
              {showMore && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <p className="px-1 pb-2 text-[11px] text-surface-400 leading-snug">
                    Optional extras. Prefer starred marketing styles for customer
                    delivery photos.
                  </p>
                  <div className="pt-1 pb-2 grid grid-cols-2 gap-3">
                    {EXPERIMENTAL_STYLES.map(({ style, label, icon, description }) => (
                      <StyleButton
                        key={style}
                        style={style}
                        label={label}
                        icon={icon}
                        description={description}
                        onSelect={handleStyleSelect}
                      />
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </Modal>
    );
  },
);

VideoDirectorModal.displayName = "VideoDirectorModal";
