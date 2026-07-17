import React, { useState, useCallback, memo } from "react";
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
  {
    id: "square",
    label: "Square-friendly",
    sub: "Feed posts (letterboxed)",
    aspect: "1:1",
    soundtrack: "cinematic",
    duration: 6,
  },
];

interface VideoDirectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectStyle: (style: VideoStyle, options: VideoRequestOptions) => void;
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
      className="group relative flex flex-col items-center p-4 sm:p-5 bg-surface-900/60 hover:bg-primary-500/15
               border border-surface-800 hover:border-primary-400 rounded-2xl transition-all duration-150
               active:scale-95 touch-manipulation w-full h-full"
    >
      {isRecommended && (
        <span className="absolute -top-2 -right-2 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/30 text-emerald-300 border border-emerald-400/40">
          ★
        </span>
      )}
      <Icon
        type={icon as any}
        className="w-10 h-10 sm:w-12 sm:h-12 text-primary-300 group-hover:text-primary-200 transition-colors"
      />
      <span className="mt-2 font-semibold text-white text-sm text-center">
        {label}
      </span>
      <span className="mt-1 text-[11px] text-white/60 text-center line-clamp-2">
        {description}
      </span>
    </button>
  ),
);

export const VideoDirectorModal: React.FC<VideoDirectorModalProps> = memo(
  ({ isOpen, onClose, onSelectStyle }) => {
    const [showMore, setShowMore] = useState(false);
    // Default vertical + music for dealership Reels/TikTok (not silent landscape).
    const [aspectPreference, setAspectPreference] =
      useState<VideoRequestOptions["aspectPreference"]>("9:16");
    const [soundtrack, setSoundtrack] =
      useState<VideoRequestOptions["soundtrack"]>("cinematic");
    const [duration, setDuration] = useState(6);
    const [activePreset, setActivePreset] = useState("vertical");

    const buildOptions = useCallback((): VideoRequestOptions => {
      return {
        durationSeconds: duration,
        soundtrack,
        aspectPreference,
        resolution: defaultResolution,
        pacing: "cinematic",
      };
    }, [aspectPreference, duration, soundtrack]);

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
      setDuration(preset.duration);
    };

    return (
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        size="lg"
        title="Creator video"
        description="Automotive marketing motion for real delivery photos. Format → sound → style."
        className="bg-surface-900 border-surface-800"
      >
        <div className="mb-4 space-y-4">
          <p className="text-xs leading-relaxed text-surface-400">
            Built for dealership social: living photography, paint sheen, tasteful
            celebration — not fake CGI cars. Vertical 9:16 for Reels/TikTok.
            Music on by default; tap{" "}
            <strong className="text-surface-200">Tap for sound</strong> after
            render.
          </p>

          {/* Platform format presets */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-primary-300/80">
              Format for
            </h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {FORMAT_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
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
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-white/80">
                Aspect ratio
              </h3>
              <div className="flex flex-wrap gap-2">
                {aspectRatios.map(({ value, label, description }) => (
                  <button
                    key={value}
                    type="button"
                    title={description}
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
                Veo renders{" "}
                <strong className="text-surface-300">9:16</strong> (vertical) or{" "}
                <strong className="text-surface-300">16:9</strong> (wide). Square
                uses letterboxing into a supported ratio.
              </p>
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-white/80">Sound</h3>
              <div className="flex gap-2">
                {soundtracks.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
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
              <div className="flex gap-2">
                {durations.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
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
            </div>
          </div>
        </div>

        <div className="mb-4">
          <p className="text-xs font-semibold text-primary-300/80 uppercase tracking-wide mb-3">
            Marketing styles
          </p>
          <div className="grid grid-cols-2 gap-3">
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
              <span>
                {showMore ? "Hide" : "Show"} extra styles
              </span>
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
                    Optional extras. Prefer starred marketing styles for
                    customer delivery photos.
                  </p>
                  <div className="pt-1 pb-2 grid grid-cols-2 gap-3">
                    {EXPERIMENTAL_STYLES.map(
                      ({ style, label, icon, description }) => (
                        <StyleButton
                          key={style}
                          style={style}
                          label={label}
                          icon={icon}
                          description={description}
                          onSelect={handleStyleSelect}
                        />
                      ),
                    )}
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
