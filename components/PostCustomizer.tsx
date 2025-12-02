import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Edit3,
  FileText,
  Check,
  Camera,
  Settings,
  ChevronRight,
  AlertCircle,
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
import { Tooltip } from "./ui/Tooltip";
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

interface StyleGuideMeta {
  subtitle: string;
  talkingPoints: string[];
  aiHint: string;
}

const STYLE_GUIDES: Record<StyleOption, StyleGuideMeta> = {
  [StyleOption.Luxury]: {
    subtitle: "Polished metallic typography with rich gold highlights.",
    talkingPoints: [
      "Think upscale magazine spreads and premium concierge vibes.",
      "Use refined serif typography and generous negative space.",
      "Lean into champagne, onyx, and warm spotlight accents.",
    ],
    aiHint:
      "Deliver a luxurious, editorial layout with elevated metallic detailing and intimate spotlighting.",
  },
  [StyleOption.Modern]: {
    subtitle: "Bold geometrics with crisp lighting and high contrast.",
    talkingPoints: [
      "Inspired by tech keynote splash screens and futurist posters.",
      "Pair punchy sans-serifs with diagonal cuts and modular grids.",
      "Play with neon glows, deep shadows, and asymmetry.",
    ],
    aiHint:
      "Create an avant-garde, high-contrast composition with geometric overlays and futuristic motion cues.",
  },
  [StyleOption.Friendly]: {
    subtitle: "Rounded lettering, warm tones, and playful stickers.",
    talkingPoints: [
      "Channel illustrated scrapbooks and joyful community boards.",
      "Use handwritten or bubbly fonts with sticker-like callouts.",
      "Include confetti, playful doodles, and warm sunshine palettes.",
    ],
    aiHint:
      "Deliver a cheerful, handcrafted layout with sticker motifs, warm colors, and lively motion.",
  },
  [StyleOption.Sporty]: {
    subtitle: "Dynamic angles with motion streaks and neon highlights.",
    talkingPoints: [
      "Reference racing posters and performance car commercials.",
      "Tilt typography, add motion blur, and spotlight velocity.",
      "Electric blues, reds, and neon accents keep energy high.",
    ],
    aiHint:
      "Produce an aggressive, high-energy layout bursting with motion trails, angled type, and glowing accents.",
  },
};

const TONE_DESCRIPTIONS: Record<ToneOption, string> = {
  [ToneOption.Excited]:
    "Amp up the energy with hype-driven copy and exclamation points.",
  [ToneOption.Professional]:
    "Confident, refined language perfect for luxury or fleet messaging.",
  [ToneOption.Family]:
    "Warm, welcoming storytelling that highlights togetherness.",
  [ToneOption.Humorous]: "Clever, fun copy with lighthearted wordplay.",
  [ToneOption.Inspirational]:
    "Forward-looking language that celebrates big milestones.",
  [ToneOption.Promotional]:
    "CTA-focused copy that teases offers without specifying pricing.",
};

type CaptionSource = "ai" | "prompted" | "template" | "custom";

const AI_FLAVORS = [
  {
    id: "hero",
    label: "Spotlight Moment",
    description:
      "Lean into the triumph of the delivery and make the customer feel like a star.",
  },
  {
    id: "story",
    label: "Mini Story",
    description:
      "Tell a short, cinematic story about their journey to this new ride.",
  },
  {
    id: "community",
    label: "Dealership Family",
    description:
      "Celebrate the relationship with the team and invite others to join the family.",
  },
];

interface StyleCardProps {
  option: StyleOption;
  current: StyleOption;
  onSelect: (option: StyleOption) => void;
}

const StyleCard: React.FC<StyleCardProps> = ({ option, current, onSelect }) => {
  const meta = STYLE_GUIDES[option];
  const isActive = option === current;

  return (
    <motion.button
      onClick={() => {
        triggerHapticFeedback();
        onSelect(option);
      }}
      className={cn(
        "group flex flex-col gap-3 rounded-2xl border px-4 py-5 text-left",
        "transition-all duration-200",
        isActive
          ? "border-primary-400 glass-strong shadow-glow-primary"
          : "border-white/10 glass hover:border-primary-400/70 hover:glass-strong"
      )}
      whileHover={{ scale: 1.02, y: -2 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
    >
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-surface-50">
            {option}
          </span>
          {isActive && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 500, damping: 25 }}
            >
              <Badge variant="success" dot pulse size="sm">
                Selected
              </Badge>
            </motion.div>
          )}
        </div>
        <p className="text-xs text-surface-300 leading-relaxed">
          {meta.subtitle}
        </p>
        <ul className="space-y-1 text-[11px] text-surface-400">
          {meta.talkingPoints.map((point, idx) => (
            <motion.li
              key={point}
              className="flex gap-2"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.05 }}
            >
              <span className="mt-1 block h-1 w-1 rounded-full bg-primary-400" aria-hidden="true"></span>
              {point}
            </motion.li>
          ))}
        </ul>
      </div>
    </motion.button>
  );
};

interface ToneTileProps {
  tone: ToneOption;
  current: ToneOption;
  onSelect: (tone: ToneOption) => void;
}

const ToneTile: React.FC<ToneTileProps> = ({ tone, current, onSelect }) => {
  const isActive = tone === current;
  return (
    <motion.button
      onClick={() => {
        triggerHapticFeedback();
        onSelect(tone);
      }}
      className={cn(
        "rounded-xl border px-3 py-3 text-left transition-all duration-200",
        isActive
          ? "border-success-400/70 bg-success-500/20 shadow-lg shadow-success-500/20"
          : "border-white/10 glass hover:border-success-400/50 hover:glass-strong"
      )}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-surface-50">
        {isActive ? (
          <Check className="h-4 w-4 text-success-400" />
        ) : (
          <Sparkles className="h-4 w-4 text-primary-400" />
        )}
        {tone}
      </div>
      <p className="mt-2 text-xs text-surface-300 leading-relaxed">
        {TONE_DESCRIPTIONS[tone]}
      </p>
    </motion.button>
  );
};

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
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiFlavor, setAiFlavor] = useState(AI_FLAVORS[0].id);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [lastSavedStyle, setLastSavedStyle] =
    useState<StyleOption>(defaultStyle);
  const [lastSavedTone, setLastSavedTone] = useState<ToneOption>(defaultTone);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Consolidate state initialization to prevent cascading re-renders
  useEffect(() => {
    setStyle(defaultStyle);
    setTone(defaultTone);
    setLastSavedStyle(defaultStyle);
    setLastSavedTone(defaultTone);
  }, [defaultStyle, defaultTone]);

  // Notify parent of changes
  useEffect(() => {
    onStyleToneChange(style, tone);
  }, [style, tone, onStyleToneChange]);

  useEffect(() => {
    if (captionSource !== "prompted") {
      setAiPrompt("");
    }
  }, [captionSource]);

  const templateOptions = useMemo(() => POST_TEMPLATES, []);

  useEffect(() => {
    if (templateOptions.length > 0 && !selectedTemplateId) {
      setSelectedTemplateId(templateOptions[0].id);
    }
  }, [templateOptions, selectedTemplateId]);

  const selectedStyleGuide = STYLE_GUIDES[style];

  const handleGenerate = useCallback(async () => {
    triggerHapticFeedback();
    let preparedText: string | undefined;
    let creativeBrief: string | undefined;

    const styleBriefSections: string[] = [];
    if (selectedStyleGuide) {
      styleBriefSections.push(`Design DNA: ${selectedStyleGuide.aiHint}`);
      if (selectedStyleGuide.talkingPoints.length > 0) {
        styleBriefSections.push("Execution pillars:");
        styleBriefSections.push(
          ...selectedStyleGuide.talkingPoints.map((point) => `- ${point}`)
        );
      }
    }
    const baseStyleBrief = styleBriefSections.join("\n");

    if (captionSource === "template") {
      const template = templateOptions.find(
        (tpl) => tpl.id === selectedTemplateId
      );
      if (template) {
        preparedText = template.content
          .replace(
            /\[Customer Name\]/g,
            customerName.trim() || "our amazing customer"
          )
          .replace(/\[Dealership Name\]/g, dealershipName);
      }
      creativeBrief = baseStyleBrief || undefined;
    } else if (captionSource === "custom") {
      preparedText = customMessage.trim() || undefined;
      creativeBrief = baseStyleBrief || undefined;
    } else if (captionSource === "prompted") {
      const userPrompt = aiPrompt.trim();
      creativeBrief =
        [
          baseStyleBrief,
          userPrompt ? `Custom prompt: ${userPrompt}` : undefined,
        ]
          .filter(Boolean)
          .join("\n\n") || undefined;
    } else {
      const flavor = AI_FLAVORS.find((flavor) => flavor.id === aiFlavor);
      creativeBrief =
        [
          baseStyleBrief,
          flavor ? `AI storytelling focus: ${flavor.description}` : undefined,
        ]
          .filter(Boolean)
          .join("\n\n") || undefined;
    }

    setIsSubmitting(true);
    try {
      await onGenerate(style, tone, customerName, preparedText, creativeBrief);
      setLastSavedStyle(style);
      setLastSavedTone(tone);
    } finally {
      setIsSubmitting(false);
    }
  }, [
    captionSource,
    tone,
    style,
    customerName,
    customMessage,
    dealershipName,
    onGenerate,
    selectedTemplateId,
    templateOptions,
    aiPrompt,
    aiFlavor,
    selectedStyleGuide,
  ]);

  const showPromptWarning = captionSource === "prompted" && !aiPrompt.trim();
  const isBusy = isGenerating || isSubmitting;

  return (
    <motion.div
      className="w-full max-w-6xl mx-auto px-1 sm:px-0"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <Card elevation={3}>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div className="flex-1">
            <CardTitle>Customize the Experience</CardTitle>
            <CardDescription>
              Dial in the visuals and tone; we&apos;ll instantly remember your
              choices for the next post.
            </CardDescription>
          </div>
          <Tooltip label="Back to photo">
            <Button
              variant="plain"
              size="sm"
              onClick={() => {
                triggerHapticFeedback();
                onBack();
              }}
            >
              <Camera className="h-4 w-4" />
            </Button>
          </Tooltip>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
            <Badge variant="primary" size="sm">
              {style}
            </Badge>
            <Badge variant="success" size="sm">
              {tone}
            </Badge>
            <Badge variant="neutral" size="sm">
              {captionSource === "ai"
                ? "AI Auto"
                : captionSource === "prompted"
                ? "AI Remix"
                : captionSource === "template"
                ? "Template"
                : "Custom"}
            </Badge>
            <Badge variant="success" size="sm">
              AI Ready
            </Badge>
            {(style !== lastSavedStyle || tone !== lastSavedTone) && (
              <span className="text-[11px] text-surface-200/80">
                New look selected · not generated yet
              </span>
            )}
          </div>

          <div
            className={cn(
              "grid gap-6",
              isDesktopLayout &&
                "lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]"
            )}
          >
            {/* Main Content */}
            <div className="space-y-6">
              {/* Customer Name Input */}
              <Input
                label="Customer's first name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Optional"
                fullWidth
              />

              {/* Design Direction */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold uppercase tracking-wide text-primary-300">
                    Design Direction
                  </h4>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="tinted"
                      size="xs"
                      onClick={() => {
                        triggerHapticFeedback();
                        setStyle(defaultStyle);
                        setTone(defaultTone);
                      }}
                    >
                      Reset to defaults
                    </Button>
                  </div>
                </div>
                <div
                  className={cn(
                    "grid gap-3",
                    isDesktopLayout
                      ? "grid-cols-2"
                      : "grid-cols-1 sm:grid-cols-2"
                  )}
                >
                  {Object.values(StyleOption).map((option) => (
                    <StyleCard
                      key={option}
                      option={option}
                      current={style}
                      onSelect={setStyle}
                    />
                  ))}
                </div>
              </div>

              {/* Caption Strategy */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold uppercase tracking-wide text-primary-300">
                  Caption Strategy
                </h4>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Button
                    variant={captionSource === "ai" ? "filled" : "tinted"}
                    size="sm"
                    leftIcon={<Sparkles />}
                    onClick={() => {
                      triggerHapticFeedback();
                      setCaptionSource("ai");
                    }}
                  >
                    AI Auto-Magic
                  </Button>
                  <Button
                    variant={captionSource === "prompted" ? "filled" : "tinted"}
                    size="sm"
                    leftIcon={<Edit3 />}
                    onClick={() => {
                      triggerHapticFeedback();
                      setCaptionSource("prompted");
                    }}
                  >
                    AI Remix
                  </Button>
                  <Button
                    variant={captionSource === "template" ? "filled" : "tinted"}
                    size="sm"
                    leftIcon={<FileText />}
                    onClick={() => {
                      triggerHapticFeedback();
                      setCaptionSource("template");
                    }}
                  >
                    Templates
                  </Button>
                  <Button
                    variant={captionSource === "custom" ? "filled" : "tinted"}
                    size="sm"
                    leftIcon={<Edit3 />}
                    onClick={() => {
                      triggerHapticFeedback();
                      setCaptionSource("custom");
                    }}
                  >
                    Write my own
                  </Button>
                </div>

                {/* AI Auto-Magic Options */}
                <AnimatePresence mode="wait">
                  {captionSource === "ai" && (
                    <motion.div
                      className="space-y-4"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.3 }}
                    >
                      {/* Tone Options */}
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {Object.values(ToneOption).map((option) => (
                          <ToneTile
                            key={option}
                            tone={option}
                            current={tone}
                            onSelect={setTone}
                          />
                        ))}
                      </div>

                      {/* AI Flavors */}
                      <div className="space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-primary-300">
                          Tell the AI what to emphasize
                        </span>
                        <div className="grid gap-2 sm:grid-cols-3">
                          {AI_FLAVORS.map(({ id, label, description }) => (
                            <motion.button
                              key={id}
                              onClick={() => {
                                triggerHapticFeedback();
                                setAiFlavor(id);
                              }}
                              className={cn(
                                "rounded-lg border px-3 py-2 text-left text-xs transition-all",
                                aiFlavor === id
                                  ? "border-primary-400 bg-primary-500/25 text-surface-50 shadow"
                                  : "border-white/10 glass text-surface-200 hover:border-primary-400/40"
                              )}
                              whileHover={{ scale: 1.02 }}
                              whileTap={{ scale: 0.98 }}
                            >
                              <span className="font-semibold block text-sm">
                                {label}
                              </span>
                              <span className="text-[11px] leading-relaxed text-surface-300">
                                {description}
                              </span>
                            </motion.button>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {/* Template Selection */}
                  {captionSource === "template" && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="flex flex-col gap-2"
                    >
                      <label htmlFor="template-select" className="text-xs font-semibold uppercase tracking-wide text-primary-300">
                        Template
                      </label>
                      <select
                        id="template-select"
                        aria-label="Select template"
                        className={cn(
                          "rounded-xl border-2 border-surface-700",
                          "bg-surface-900/60 px-4 py-3 text-sm text-surface-50",
                          "focus:border-primary-500 focus:outline-none transition-colors"
                        )}
                        value={selectedTemplateId}
                        onChange={(event) =>
                          setSelectedTemplateId(event.target.value)
                        }
                      >
                        {templateOptions.map((template) => (
                          <option key={template.id} value={template.id}>
                            {template.name}
                          </option>
                        ))}
                      </select>
                    </motion.div>
                  )}

                  {/* Custom Message */}
                  {captionSource === "custom" && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                    >
                      <Textarea
                        label="Your message"
                        value={customMessage}
                        onChange={(e) => setCustomMessage(e.target.value)}
                        rows={4}
                        placeholder="We'll inject this copy straight into the design."
                        fullWidth
                      />
                    </motion.div>
                  )}

                  {/* AI Prompt */}
                  {captionSource === "prompted" && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                    >
                      <Textarea
                        label="Describe the vibe you want"
                        value={aiPrompt}
                        onChange={(e) => setAiPrompt(e.target.value)}
                        rows={4}
                        placeholder="e.g., Celebrate how they found their dream off-road rig and shout out the weekend adventures ahead."
                        fullWidth
                        helperText={
                          showPromptWarning
                            ? "Add a prompt to enable AI remix."
                            : undefined
                        }
                      />
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Action Buttons */}
                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between pt-2">
                  <Button
                    variant="tinted"
                    size="md"
                    leftIcon={<Camera />}
                    onClick={() => {
                      triggerHapticFeedback();
                      onBack();
                    }}
                  >
                    Change photo
                  </Button>
                  <motion.div
                    className="relative"
                    initial={false}
                    animate={{
                      opacity: isBusy ? 0.85 : 1,
                      scale: isBusy ? 0.99 : 1,
                    }}
                  >
                    <Button
                      variant="filled"
                      size="lg"
                      leftIcon={
                        <Sparkles className={cn(isBusy && "animate-pulse")} />
                      }
                      rightIcon={<ChevronRight />}
                      onClick={handleGenerate}
                      disabled={showPromptWarning || isBusy}
                    >
                      {showPromptWarning
                        ? "Add prompt to generate"
                        : isBusy
                        ? "Generating..."
                        : "Generate hero image & caption"}
                    </Button>
                    <AnimatePresence>
                      {isBusy && (
                        <motion.div
                          className="absolute inset-0 rounded-xl border border-primary-200/40 pointer-events-none"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.2 }}
                        />
                      )}
                    </AnimatePresence>
                  </motion.div>
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <aside className="space-y-4">
              {/* Image Preview */}
              <motion.div
                className="overflow-hidden rounded-2xl border border-white/10 glass"
                whileHover={{ scale: 1.02 }}
                transition={{ type: "spring", stiffness: 400, damping: 25 }}
              >
                <img
                  src={imageSrc}
                  alt="User-captured photo for social media post generation"
                  className="h-full w-full object-cover aspect-square"
                />
              </motion.div>

              {/* Style Playbook */}
              <Card solid elevation={2}>
                <CardContent className="space-y-3" padded>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wide text-primary-300">
                      Style Playbook
                    </span>
                    <Badge variant="primary">{style}</Badge>
                  </div>
                  <p className="text-sm text-surface-200 leading-relaxed">
                    {selectedStyleGuide.subtitle}
                  </p>
                  <ul className="space-y-2 text-[12px] text-surface-300">
                    {selectedStyleGuide.talkingPoints.map((point) => (
                      <li key={point} className="flex gap-2">
                        <span className="mt-1 block h-1.5 w-1.5 rounded-full bg-primary-400/80"></span>
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="rounded-xl border border-primary-400/30 bg-primary-500/10 px-3 py-2 text-[12px] text-surface-200">
                    <strong className="block text-primary-300 text-xs uppercase tracking-wide mb-1">
                      AI Brief
                    </strong>
                    <span>{selectedStyleGuide.aiHint}</span>
                  </div>
                </CardContent>
              </Card>

              {/* Tone Focus */}
              <Card solid elevation={2}>
                <CardContent padded>
                  <span className="text-xs font-semibold uppercase tracking-wide text-primary-300">
                    Tone Focus
                  </span>
                  <p className="mt-2 text-sm text-surface-200">
                    {TONE_DESCRIPTIONS[tone]}
                  </p>
                </CardContent>
              </Card>
            </aside>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
};
