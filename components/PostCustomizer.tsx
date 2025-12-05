import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Edit3,
  FileText,
  Check,
  Camera,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { StyleOption, ToneOption } from "../types";
import { triggerHapticFeedback } from "../utils/haptics";
import { Button } from "./ui/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/Card";
import { Badge } from "./ui/Badge";
import { Input, Textarea } from "./ui/Input";
import { POST_TEMPLATES } from "./templates";
import { cn } from "../utils/classNames";

interface PostCustomizerProps {
  imageSrc: string;
  onGenerate: (
    style: StyleOption,
    tone: ToneOption,
    customerName: string,
    customText?: string,
    creativeBrief?: string
  ) => Promise<void> | void;
  onBack: () => void;
  dealershipName: string;
  defaultStyle: StyleOption;
  defaultTone: ToneOption;
  onStyleToneChange: (style: StyleOption, tone: ToneOption) => void;
  isDesktopLayout: boolean;
  isGenerating?: boolean;
}

// Simplified style descriptions
const STYLE_INFO: Record<
  StyleOption,
  { emoji: string; desc: string; aiHint: string }
> = {
  [StyleOption.Luxury]: {
    emoji: "✨",
    desc: "Elegant & refined",
    aiHint:
      "Deliver a luxurious, editorial layout with elevated metallic detailing.",
  },
  [StyleOption.Modern]: {
    emoji: "⚡",
    desc: "Bold & futuristic",
    aiHint:
      "Create an avant-garde, high-contrast composition with geometric overlays.",
  },
  [StyleOption.Friendly]: {
    emoji: "🎉",
    desc: "Warm & playful",
    aiHint:
      "Deliver a cheerful, handcrafted layout with warm colors and lively motion.",
  },
  [StyleOption.Sporty]: {
    emoji: "🏎️",
    desc: "Dynamic & energetic",
    aiHint:
      "Produce a high-energy layout with motion trails and glowing accents.",
  },
};

const TONE_INFO: Record<ToneOption, { emoji: string; short: string }> = {
  [ToneOption.Excited]: { emoji: "🔥", short: "Hype & energy" },
  [ToneOption.Professional]: { emoji: "💼", short: "Confident & refined" },
  [ToneOption.Family]: { emoji: "👨‍👩‍👧", short: "Warm & welcoming" },
  [ToneOption.Humorous]: { emoji: "😄", short: "Fun & clever" },
  [ToneOption.Inspirational]: { emoji: "🌟", short: "Uplifting & forward" },
  [ToneOption.Promotional]: { emoji: "📣", short: "CTA-focused" },
};

type CaptionSource = "ai" | "custom";

export const PostCustomizer: React.FC<PostCustomizerProps> = ({
  imageSrc,
  onGenerate,
  onBack,
  dealershipName,
  defaultStyle,
  defaultTone,
  onStyleToneChange,
  isDesktopLayout,
  isGenerating = false,
}) => {
  const [customerName, setCustomerName] = useState("");
  const [style, setStyle] = useState<StyleOption>(defaultStyle);
  const [tone, setTone] = useState<ToneOption>(defaultTone);
  const [customMessage, setCustomMessage] = useState("");
  const [captionSource, setCaptionSource] = useState<CaptionSource>("ai");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Sync with defaults
  useEffect(() => {
    setStyle(defaultStyle);
    setTone(defaultTone);
  }, [defaultStyle, defaultTone]);

  // Notify parent
  useEffect(() => {
    onStyleToneChange(style, tone);
  }, [style, tone, onStyleToneChange]);

  const templateOptions = useMemo(() => POST_TEMPLATES, []);

  useEffect(() => {
    if (templateOptions.length > 0 && !selectedTemplateId) {
      setSelectedTemplateId(templateOptions[0].id);
    }
  }, [templateOptions, selectedTemplateId]);

  const handleGenerate = useCallback(async () => {
    triggerHapticFeedback();
    let preparedText: string | undefined;
    let creativeBrief: string | undefined;

    const styleInfo = STYLE_INFO[style];
    creativeBrief = `Design DNA: ${styleInfo.aiHint}`;

    if (captionSource === "custom" && customMessage.trim()) {
      preparedText = customMessage.trim();
    }

    setIsSubmitting(true);
    try {
      await onGenerate(style, tone, customerName, preparedText, creativeBrief);
    } finally {
      setIsSubmitting(false);
    }
  }, [captionSource, tone, style, customerName, customMessage, onGenerate]);

  const isBusy = isGenerating || isSubmitting;

  return (
    <div className="flex-1 flex items-start justify-center py-2 sm:py-4 px-2 sm:px-4">
      <motion.div
        className="w-full max-w-2xl mx-auto"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Card elevation={2}>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              {/* Compact image preview */}
              <motion.div
                className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden border border-white/20 flex-shrink-0"
                whileHover={{ scale: 1.05 }}
              >
                <img
                  src={imageSrc}
                  alt="Preview"
                  className="w-full h-full object-cover"
                />
              </motion.div>
              <div className="flex-1 min-w-0">
                <CardTitle className="text-lg sm:text-xl">
                  Create Your Post
                </CardTitle>
                <CardDescription className="text-xs sm:text-sm">
                  Pick a style and let AI do the magic
                </CardDescription>
              </div>
              <Button
                variant="plain"
                size="sm"
                onClick={() => {
                  triggerHapticFeedback();
                  onBack();
                }}
                className="flex-shrink-0"
              >
                <Camera className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>

          <CardContent className="space-y-4 pt-0">
            {/* Customer Name - Compact */}
            <Input
              label="Customer's name (optional)"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="First name"
              fullWidth
            />

            {/* Style Selection - Simplified Grid */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-surface-300 uppercase tracking-wide">
                Design Style
              </label>
              <div className="grid grid-cols-2 gap-2">
                {Object.values(StyleOption).map((option) => {
                  const info = STYLE_INFO[option];
                  const isActive = option === style;
                  return (
                    <motion.button
                      key={option}
                      onClick={() => {
                        triggerHapticFeedback();
                        setStyle(option);
                      }}
                      className={cn(
                        "flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-all",
                        isActive
                          ? "border-primary-400 bg-primary-500/20 shadow-lg shadow-primary-500/20"
                          : "border-white/10 bg-white/5 hover:border-primary-400/50 hover:bg-white/10"
                      )}
                      whileTap={{ scale: 0.97 }}
                    >
                      <span className="text-lg">{info.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium text-surface-50 truncate">
                            {option.split(" ")[0]}
                          </span>
                          {isActive && (
                            <Check className="h-3.5 w-3.5 text-primary-400 flex-shrink-0" />
                          )}
                        </div>
                        <span className="text-[11px] text-surface-400 block truncate">
                          {info.desc}
                        </span>
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            </div>

            {/* Tone Selection - Horizontal Scroll on Mobile */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-surface-300 uppercase tracking-wide">
                Tone
              </label>
              <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
                {Object.values(ToneOption).map((option) => {
                  const info = TONE_INFO[option];
                  const isActive = option === tone;
                  return (
                    <motion.button
                      key={option}
                      onClick={() => {
                        triggerHapticFeedback();
                        setTone(option);
                      }}
                      className={cn(
                        "flex items-center gap-1.5 rounded-full border px-3 py-1.5 whitespace-nowrap transition-all flex-shrink-0",
                        isActive
                          ? "border-success-400 bg-success-500/20"
                          : "border-white/10 bg-white/5 hover:border-success-400/50"
                      )}
                      whileTap={{ scale: 0.95 }}
                    >
                      <span className="text-sm">{info.emoji}</span>
                      <span
                        className={cn(
                          "text-xs font-medium",
                          isActive ? "text-success-300" : "text-surface-300"
                        )}
                      >
                        {option}
                      </span>
                    </motion.button>
                  );
                })}
              </div>
            </div>

            {/* Caption Mode Toggle */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-surface-300 uppercase tracking-wide">
                Caption
              </label>
              <div className="flex gap-2">
                <Button
                  variant={captionSource === "ai" ? "filled" : "tinted"}
                  size="sm"
                  leftIcon={<Sparkles className="h-3.5 w-3.5" />}
                  onClick={() => {
                    triggerHapticFeedback();
                    setCaptionSource("ai");
                  }}
                  className="flex-1"
                >
                  AI Magic
                </Button>
                <Button
                  variant={captionSource === "custom" ? "filled" : "tinted"}
                  size="sm"
                  leftIcon={<Edit3 className="h-3.5 w-3.5" />}
                  onClick={() => {
                    triggerHapticFeedback();
                    setCaptionSource("custom");
                  }}
                  className="flex-1"
                >
                  Write My Own
                </Button>
              </div>
            </div>

            {/* Custom Message Input */}
            <AnimatePresence mode="wait">
              {captionSource === "custom" && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <Textarea
                    label="Your caption"
                    value={customMessage}
                    onChange={(e) => setCustomMessage(e.target.value)}
                    rows={3}
                    placeholder="Write your caption here..."
                    fullWidth
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Advanced Options - Collapsible */}
            <div className="border-t border-white/10 pt-3">
              <button
                onClick={() => {
                  triggerHapticFeedback();
                  setShowAdvanced(!showAdvanced);
                }}
                className="flex items-center gap-2 text-xs text-surface-400 hover:text-surface-200 transition-colors w-full"
              >
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 transition-transform",
                    showAdvanced && "rotate-180"
                  )}
                />
                <span>Advanced options</span>
              </button>

              <AnimatePresence>
                {showAdvanced && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="pt-3 space-y-3"
                  >
                    {/* Template Selection */}
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-surface-300">
                        Use a template
                      </label>
                      <select
                        aria-label="Select template"
                        className={cn(
                          "w-full rounded-xl border border-surface-700",
                          "bg-surface-900/60 px-3 py-2 text-sm text-surface-50",
                          "focus:border-primary-500 focus:outline-none transition-colors"
                        )}
                        value={selectedTemplateId}
                        onChange={(e) => {
                          setSelectedTemplateId(e.target.value);
                          const template = templateOptions.find(
                            (t) => t.id === e.target.value
                          );
                          if (template) {
                            setCustomMessage(
                              template.content
                                .replace(
                                  /\[Customer Name\]/g,
                                  customerName.trim() || "our amazing customer"
                                )
                                .replace(/\[Dealership Name\]/g, dealershipName)
                            );
                            setCaptionSource("custom");
                          }
                        }}
                      >
                        <option value="">Select a template...</option>
                        {templateOptions.map((template) => (
                          <option key={template.id} value={template.id}>
                            {template.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Style Preview */}
                    <div className="rounded-xl border border-primary-400/20 bg-primary-500/10 px-3 py-2">
                      <div className="text-[10px] uppercase tracking-wide text-primary-300 mb-1">
                        AI will create
                      </div>
                      <p className="text-xs text-surface-200">
                        {STYLE_INFO[style].aiHint}
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Generate Button - Full Width & Prominent */}
            <div className="flex flex-col gap-2 pt-2">
              <Button
                variant="filled"
                size="lg"
                leftIcon={
                  <Sparkles className={cn(isBusy && "animate-pulse")} />
                }
                rightIcon={<ChevronRight />}
                onClick={handleGenerate}
                disabled={isBusy}
                fullWidth
              >
                {isBusy ? "Creating your post..." : "Generate Post"}
              </Button>
              <Button
                variant="plain"
                size="sm"
                leftIcon={<Camera className="h-3.5 w-3.5" />}
                onClick={() => {
                  triggerHapticFeedback();
                  onBack();
                }}
                fullWidth
              >
                Change photo
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
};
