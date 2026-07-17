import React, { useEffect, useState, useCallback, memo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { VideoStyle, VideoRequestOptions } from "../types";
import { Icon } from "./Icons";
import { triggerHapticFeedback } from "../utils/haptics";
import { Modal } from "./ui/Modal";
import {
  defaultResolution,
  styles as videoStyles,
} from "./video-director/constants";

// Get top recommended styles for quick selection
const QUICK_STYLES = videoStyles.filter((s) => s.recommended).slice(0, 4);
const ALL_STYLES = videoStyles.slice(0, 8); // Show first 8 styles for "More" section

interface VideoDirectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectStyle: (style: VideoStyle, options: VideoRequestOptions) => void;
}

// Memoized style button for performance
const StyleButton = memo(
  ({
    style,
    icon,
    description,
    isRecommended,
    onSelect,
  }: {
    style: VideoStyle;
    icon: string;
    description: string;
    isRecommended?: boolean;
    onSelect: (style: VideoStyle) => void;
  }) => (
    <button
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
        {style}
      </span>
      <span className="mt-1 text-[11px] text-white/60 text-center line-clamp-1">
        {description}
      </span>
    </button>
  ),
);

export const VideoDirectorModal: React.FC<VideoDirectorModalProps> = memo(
  ({ isOpen, onClose, onSelectStyle }) => {
    const [showMore, setShowMore] = useState(false);

    // Match source photo aspect (letterboxed server-side). Cinematic pacing
    // avoids snappy zoom morphs that invent a second car.
    const defaultOptions: VideoRequestOptions = {
      durationSeconds: 6,
      soundtrack: "cinematic",
      aspectPreference: "auto",
      resolution: defaultResolution,
      pacing: "cinematic",
    };

    const handleStyleSelect = useCallback(
      (style: VideoStyle) => {
        onSelectStyle(style, defaultOptions);
      },
      [onSelectStyle],
    );

    return (
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        size="lg"
        title="Create video"
        description="Locked to your delivery photo — subtle campaign motion only."
        className="bg-surface-900 border-surface-800"
      >
        {/* Recommended Styles - Main Section */}
        <div className="mb-4">
          <p className="text-xs font-semibold text-primary-300/80 uppercase tracking-wide mb-3">
            Recommended
          </p>
          <div className="grid grid-cols-2 gap-3">
            {QUICK_STYLES.map(({ style, icon, description }) => (
              <StyleButton
                key={style}
                style={style}
                icon={icon}
                description={description}
                isRecommended
                onSelect={handleStyleSelect}
              />
            ))}
          </div>
        </div>

        {/* More Styles - Collapsible */}
        <div className="border-t border-white/10 pt-2">
          <button
            onClick={() => {
              triggerHapticFeedback();
              setShowMore(!showMore);
            }}
            className="w-full px-2 py-3 flex items-center justify-between text-sm text-white/70 hover:text-white hover:bg-white/5 transition-colors touch-manipulation rounded-lg"
          >
            <span>{showMore ? "Hide" : "Show"} more styles</span>
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
                <div className="pt-2 pb-2 grid grid-cols-2 gap-3">
                  {ALL_STYLES.filter((s) => !s.recommended).map(
                    ({ style, icon, description }) => (
                      <StyleButton
                        key={style}
                        style={style}
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

        {/* Footer hint */}
        <div className="mt-6 pt-4 border-t border-white/10">
          <p className="text-xs text-center text-white/50">
            Videos are 6 seconds • Optimized for Instagram Reels
          </p>
        </div>
      </Modal>
    );
  },
);
