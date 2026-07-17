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
  ScanLine,
  Car,
  X,
  Gem,
  Zap,
  PartyPopper,
  Gauge,
  Flame,
  Briefcase,
  Users,
  Smile,
  Megaphone,
  Command,
  CornerDownLeft,
  type LucideIcon,
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
import { Input, Textarea, Select } from "./ui/Input";
import { POST_TEMPLATES } from "./templates";
import { cn } from "../utils/classNames";
import { VinScanner } from "./VinScanner";
import { DecodedVehicle, vehicleToCreativeBrief } from "../services/vinDecoder";
import { PhotoReleaseModal } from "./PhotoReleaseModal";
import { useAppStore } from "../stores/appStore";
import { ShieldCheck } from "lucide-react";
import { CapturedRelease } from "../services/photoReleases";
import { SalespersonPicker } from "./SalespersonPicker";
import { ScenarioPicker } from "./ScenarioPicker";
import {
  PostScenario,
  POST_SCENARIOS,
  scenarioToCreativeBrief,
  findScenario,
  getScenariosForDealer,
} from "../services/postScenarios";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { ProgressiveImage } from "./ui/ProgressiveImage";

interface PostCustomizerProps {
  imageSrc: string;
  onGenerate: (
    style: StyleOption,
    tone: ToneOption,
    customerName: string,
    customText?: string,
    creativeBrief?: string,
    meta?: {
      salespersonName?: string;
      salespersonId?: string;
      vin?: string;
      hasRelease?: boolean;
      capturedRelease?: CapturedRelease;
    },
  ) => Promise<void> | void;
  onBack: () => void;
  dealershipName: string;
  defaultStyle: StyleOption;
  defaultTone: ToneOption;
  onStyleToneChange: (style: StyleOption, tone: ToneOption) => void;
  isDesktopLayout: boolean;
  isGenerating?: boolean;
}

// Style descriptions. Icons are lucide components (not emoji) so they render
// identically across OS/browser, sit on the baseline, and share one stroke weight.
const STYLE_INFO: Record<
  StyleOption,
  { icon: LucideIcon; desc: string; detail: string; aiHint: string }
> = {
  [StyleOption.Luxury]: {
    icon: Gem,
    desc: "Elegant & refined",
    detail: "Premium grade · real photo stays · clean type",
    aiHint:
      "Soft luxury grade and elegant type over the real delivery photo — no car swap.",
  },
  [StyleOption.Modern]: {
    icon: Zap,
    desc: "Bold & futuristic",
    detail: "High contrast · sharp sans · subtle overlays",
    aiHint:
      "Crisp modern type and contrast on the real photo — keep people and vehicle locked.",
  },
  [StyleOption.Friendly]: {
    icon: PartyPopper,
    desc: "Warm & playful",
    detail: "Bright · welcoming · community energy",
    aiHint:
      "Warm, friendly polish on the real moment — lively without cartoon rebuilds.",
  },
  [StyleOption.Sporty]: {
    icon: Gauge,
    desc: "Dynamic & energetic",
    detail: "Bold type · athletic energy · same car",
    aiHint:
      "Sporty type energy while preserving the exact car and customers from the photo.",
  },
};

const TONE_INFO: Record<ToneOption, { icon: LucideIcon; short: string }> = {
  [ToneOption.Excited]: { icon: Flame, short: "Hype & energy" },
  [ToneOption.Professional]: { icon: Briefcase, short: "Confident & refined" },
  [ToneOption.Family]: { icon: Users, short: "Warm & welcoming" },
  [ToneOption.Humorous]: { icon: Smile, short: "Fun & clever" },
  [ToneOption.Inspirational]: { icon: Sparkles, short: "Uplifting & forward" },
  [ToneOption.Promotional]: { icon: Megaphone, short: "CTA-focused" },
};

const TypewriterText: React.FC<{ text: string }> = ({ text }) => {
  const [displayedText, setDisplayedText] = useState("");

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplayedText(text);
      return;
    }

    let index = 0;
    let intervalId: ReturnType<typeof setInterval> | undefined;
    setDisplayedText("");
    // Small delay before starting to type to allow for "clearing" feel
    const timeout = setTimeout(() => {
      intervalId = setInterval(() => {
        setDisplayedText((prev) => text.slice(0, index + 1));
        index++;
        if (index === text.length && intervalId) clearInterval(intervalId);
      }, 15); // Typing speed
    }, 100);
    return () => {
      clearTimeout(timeout);
      if (intervalId) clearInterval(intervalId);
    };
  }, [text]);

  return <span>{displayedText}</span>;
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
  const [vinScannerOpen, setVinScannerOpen] = useState(false);
  const [decodedVehicle, setDecodedVehicle] = useState<DecodedVehicle | null>(
    null,
  );
  const [releaseModalOpen, setReleaseModalOpen] = useState(false);
  const [releaseValidationError, setReleaseValidationError] = useState(false);
  // Captured signature stays local until Generate. useGeneration durably saves
  // it before the customer photo is sent to an AI provider, then links that
  // same protected record to the created post.
  const [capturedRelease, setCapturedRelease] =
    useState<CapturedRelease | null>(null);
  const currentDealer = useAppStore((s) => s.currentDealer);

  // Post scenario — drives prompt context + default style/tone. "customer_delivery"
  // is the implicit default; an undefined value also resolves to that.
  const [scenarioId, setScenarioId] = useState<string>(POST_SCENARIOS[0].id);
  // Scenario lookup now considers the dealer's custom_scenarios JSON too.
  const activeScenario = useMemo(() => {
    const all = getScenariosForDealer(currentDealer?.custom_scenarios);
    return all.find((s) => s.id === scenarioId) || POST_SCENARIOS[0];
  }, [scenarioId, currentDealer?.custom_scenarios]);

  // Filter the style picker to the dealer's enabled set. Empty enabled_styles
  // = all enabled (default). Default style is pre-selected when the dealer set
  // one, overriding the user-level preferred style.
  const allowedStyles = useMemo<StyleOption[]>(() => {
    const raw = (currentDealer?.enabled_styles || "").trim();
    if (!raw) return Object.values(StyleOption);
    const allowedSet = new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    const filtered = Object.values(StyleOption).filter((s) =>
      allowedSet.has(s),
    );
    return filtered.length > 0 ? filtered : Object.values(StyleOption);
  }, [currentDealer?.enabled_styles]);

  const dealerDefaultStyle = currentDealer?.default_style as
    StyleOption | undefined;

  // Salesperson identity — picker pulls from the dealer's roster (if any),
  // falls back to a free-text input when the roster is empty. Persists last
  // selection in localStorage so the same iPad keeps the same identity.
  const [salesperson, setSalesperson] = useState<{
    id?: string;
    name: string;
  }>({ name: "" });
  const salespersonName = salesperson.name;

  // Sync with defaults. Order of precedence:
  //   1. Dealer-set default_style (if it's in the enabled set)
  //   2. User-level preferred style (if it's in the enabled set)
  //   3. First enabled style
  useEffect(() => {
    let nextStyle: StyleOption = defaultStyle;
    if (dealerDefaultStyle && allowedStyles.includes(dealerDefaultStyle)) {
      nextStyle = dealerDefaultStyle;
    } else if (!allowedStyles.includes(nextStyle)) {
      nextStyle = allowedStyles[0];
    }
    setStyle(nextStyle);
    setTone(defaultTone);
  }, [defaultStyle, defaultTone, dealerDefaultStyle, allowedStyles]);

  // When the salesperson picks a new scenario, retune style + tone to the
  // scenario's smart defaults — but respect the dealer's enabled_styles list
  // (don't pick a style the GSM has disabled).
  const handleScenarioChange = useCallback(
    (s: PostScenario | undefined) => {
      if (!s) return;
      setScenarioId(s.id);
      if (allowedStyles.includes(s.defaultStyle)) {
        setStyle(s.defaultStyle);
      }
      setTone(s.defaultTone);
    },
    [allowedStyles],
  );

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
    if (activeScenario.requiresCustomer && !capturedRelease) {
      setReleaseValidationError(true);
      setReleaseModalOpen(true);
      return;
    }
    setReleaseValidationError(false);
    let preparedText: string | undefined;

    const styleInfo = STYLE_INFO[style];
    const briefParts: string[] = [`Design DNA: ${styleInfo.aiHint}`];

    // Scenario context (Customer Delivery / Pre-Owned Spotlight / Service
    // Promo / etc). This goes near the top of the brief so it dominates the
    // default delivery-post framing where the scenarios diverge from it.
    // Custom dealer scenarios resolve via the dealer's custom_scenarios JSON.
    const scenarioBlock = scenarioToCreativeBrief(
      scenarioId,
      currentDealer?.custom_scenarios,
    );
    if (scenarioBlock) {
      briefParts.push(scenarioBlock);
    }

    // Inject decoded vehicle context if a VIN was scanned. This grounds the
    // model in concrete facts (year/make/model/trim/powertrain) so the caption
    // stops hallucinating equipment that isn't on the car.
    if (decodedVehicle && !decodedVehicle.empty) {
      const vehicleBrief = vehicleToCreativeBrief(decodedVehicle);
      if (vehicleBrief) {
        briefParts.push(`Vehicle facts (do not contradict): ${vehicleBrief}`);
      }
    }

    // Per-dealer brand voice / banned phrases / OEM affiliation. These come
    // from the dealers PocketBase record so each dealership can tune voice
    // without a code change.
    if (currentDealer?.brand_voice?.trim()) {
      briefParts.push(
        `Brand voice (match this exactly): ${currentDealer.brand_voice.trim()}`,
      );
    }
    if (currentDealer?.banned_phrases?.trim()) {
      const banned = currentDealer.banned_phrases
        .split(/[\n,]+/)
        .map((p) => p.trim())
        .filter(Boolean);
      if (banned.length > 0) {
        briefParts.push(
          `Forbidden phrases (do not use, even as a near-match): ${banned
            .map((p) => `"${p}"`)
            .join(", ")}.`,
        );
      }
    }
    if (currentDealer?.oem_affiliation?.trim()) {
      briefParts.push(
        `OEM affiliation: ${currentDealer.oem_affiliation.trim()}. Respect that manufacturer's brand-guideline tone and avoid claims that conflict with their advertising standards.`,
      );
    }

    // Identity context — tagline, website, address, hours give the model
    // grounded facts to weave in naturally (and never invent).
    const identityFacts: string[] = [];
    if (currentDealer?.tagline?.trim())
      identityFacts.push(`Tagline: "${currentDealer.tagline.trim()}"`);
    if (currentDealer?.website?.trim())
      identityFacts.push(`Website: ${currentDealer.website.trim()}`);
    if (currentDealer?.address?.trim())
      identityFacts.push(`Address: ${currentDealer.address.trim()}`);
    if (currentDealer?.hours?.trim())
      identityFacts.push(`Hours: ${currentDealer.hours.trim()}`);
    if (currentDealer?.phone?.trim())
      identityFacts.push(`Phone: ${currentDealer.phone.trim()}`);
    if (identityFacts.length > 0) {
      briefParts.push(
        `Dealership facts (may be referenced, never contradicted): ${identityFacts.join(
          "; ",
        )}.`,
      );
    }

    // Default hashtags + footer get appended to the final caption rather than
    // injected as suggestion text — guarantees they actually show up.
    const dealerHashtags = (currentDealer?.default_hashtags || "")
      .split(/[\n,]+/)
      .map((h) => h.trim())
      .filter(Boolean)
      .map((h) => (h.startsWith("#") ? h : `#${h}`));
    if (dealerHashtags.length > 0) {
      briefParts.push(
        `Required hashtags (include these exact hashtags in the post): ${dealerHashtags.join(
          " ",
        )}.`,
      );
    }
    const dealerFooter = (currentDealer?.default_footer || "").trim();
    if (dealerFooter) {
      briefParts.push(
        `Required footer (append verbatim AFTER the caption, BEFORE the hashtags): "${dealerFooter}"`,
      );
    }

    const creativeBrief = briefParts.join(" ");

    if (captionSource === "custom" && customMessage.trim()) {
      preparedText = customMessage.trim();
    }

    setIsSubmitting(true);
    try {
      await onGenerate(style, tone, customerName, preparedText, creativeBrief, {
        salespersonName: salesperson.name.trim() || undefined,
        salespersonId: salesperson.id,
        vin: decodedVehicle?.vin,
        hasRelease: !!capturedRelease,
        capturedRelease: capturedRelease || undefined,
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [
    captionSource,
    tone,
    style,
    customerName,
    customMessage,
    decodedVehicle,
    salesperson,
    capturedRelease,
    currentDealer,
    scenarioId,
    activeScenario.requiresCustomer,
    onGenerate,
  ]);

  const isBusy = isGenerating || isSubmitting;

  // Cmd/Ctrl+Enter fires the primary action (generate) from anywhere in the
  // customizer — including when focus is inside a text field. The shortcuts
  // hook intentionally bypasses its is-typing guard for the primary chord.
  useKeyboardShortcuts({
    onPrimary: () => {
      if (!isBusy) void handleGenerate();
    },
  });

  return (
    <div className="flex-1 flex items-start justify-center py-2 sm:py-4 px-2 sm:px-4">
      <motion.div
        className={cn(
          "w-full mx-auto",
          isDesktopLayout
            ? "max-w-6xl grid grid-cols-[minmax(0,1.15fr)_minmax(420px,0.85fr)] gap-6 items-start"
            : "max-w-2xl",
        )}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        {isDesktopLayout && (
          <section className="sticky top-24 overflow-hidden rounded-[1.75rem] border border-white/10 bg-surface-950 shadow-2xl shadow-black/30">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4 text-xs font-semibold tracking-[0.12em] text-surface-400">
              <span>PHOTO STAGE</span>
              <span className="text-primary-300">02 DETAILS</span>
            </div>
            <div className="relative grid min-h-[560px] place-items-center bg-black p-5">
              <ProgressiveImage
                src={imageSrc}
                alt="Selected post photo"
                className="max-h-[620px] w-full rounded-2xl object-contain shadow-2xl"
              />
              <div
                className="pointer-events-none absolute inset-x-8 top-1/2 h-px bg-primary-300/40 shadow-[0_0_16px_rgba(96,165,250,0.45)]"
                aria-hidden="true"
              />
            </div>
            <div className="flex items-center justify-between border-t border-white/10 px-5 py-4 text-xs text-surface-400">
              <span>Review the full frame before generating.</span>
              <button
                type="button"
                onClick={onBack}
                className="font-semibold text-surface-200 hover:text-white"
              >
                Change photo
              </button>
            </div>
          </section>
        )}

        <Card
          elevation={2}
          className="relative overflow-hidden border-white/10 bg-surface-900"
        >
          <CardHeader className="pb-3 relative">
            <div className="flex items-center gap-3">
              {/* Compact image preview */}
              <motion.div
                className={cn(
                  "w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden border border-white/20 flex-shrink-0 shadow-lg",
                  isDesktopLayout && "hidden",
                )}
                whileHover={{ scale: 1.05 }}
              >
                <ProgressiveImage
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
                  Pick a style — AI handles the rest
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-5 pt-0 relative">
            {/* Post scenario — selects which kind of post this is (delivery,
                pre-owned spotlight, service promo, etc). Tunes prompt + defaults. */}
            <ScenarioPicker
              value={scenarioId}
              onChange={handleScenarioChange}
            />

            {/* Salesperson — searchable roster picker w/ unrostered fallback */}
            <SalespersonPicker
              dealerId={currentDealer?.id ?? ""}
              value={salesperson}
              onChange={setSalesperson}
            />

            {/* Customer Name - Compact */}
            <Input
              label="Customer's name (optional)"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="First name"
              fullWidth
              className="bg-white/5 border-white/10 focus:border-primary-400 focus:bg-white/10 transition-colors"
            />

            {/* VIN Scanner — show pill if vehicle decoded, otherwise show CTA */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-surface-300 uppercase tracking-wide">
                Vehicle
              </label>
              {decodedVehicle && !decodedVehicle.empty ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex items-start gap-3 rounded-xl border border-success-500/40 bg-success-500/10 px-3 py-2.5"
                >
                  <Car className="h-4 w-4 text-success-300 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-success-100 truncate">
                      {decodedVehicle.summary}
                    </div>
                    <div className="text-[10px] font-mono text-success-300/80 truncate">
                      VIN {decodedVehicle.vin}
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label="Clear vehicle"
                    onClick={() => {
                      triggerHapticFeedback();
                      setDecodedVehicle(null);
                    }}
                    className="p-1 -mr-1 text-success-300/80 hover:text-success-100 rounded-full transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </motion.div>
              ) : (
                <Button
                  variant="outline"
                  size="md"
                  leftIcon={<ScanLine className="h-4 w-4" />}
                  onClick={() => {
                    triggerHapticFeedback();
                    setVinScannerOpen(true);
                  }}
                  fullWidth
                  className="border-dashed border-white/20 bg-white/5 hover:bg-white/10"
                >
                  Scan VIN (optional — boosts accuracy)
                </Button>
              )}
            </div>

            {/* Photo release — capture customer's signed consent before posting their photo */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-surface-300 uppercase tracking-wide">
                Photo release ·{" "}
                {activeScenario.requiresCustomer ? "required" : "optional"}
              </label>
              {capturedRelease ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex items-start gap-3 rounded-xl border border-success-500/40 bg-success-500/10 px-3 py-2.5"
                >
                  <ShieldCheck className="h-4 w-4 text-success-300 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-success-100">
                      Release captured for {capturedRelease.customerName}
                    </div>
                    <div className="text-[10px] text-success-300/80">
                      Will be saved when you generate the post.
                    </div>
                  </div>
                </motion.div>
              ) : (
                <Button
                  variant="outline"
                  size="md"
                  leftIcon={<ShieldCheck className="h-4 w-4" />}
                  onClick={() => {
                    triggerHapticFeedback();
                    setReleaseModalOpen(true);
                  }}
                  fullWidth
                  className="border-dashed border-white/20 bg-white/5 hover:bg-white/10"
                  disabled={!currentDealer}
                >
                  Capture customer release
                </Button>
              )}
              {releaseValidationError && !capturedRelease ? (
                <p
                  className="rounded-lg border border-error-500/30 bg-error-500/10 px-3 py-2 text-xs font-medium text-error-100"
                  role="alert"
                >
                  This customer-focused post needs a signed photo release before
                  the photo can be sent for AI processing.
                </p>
              ) : null}
            </div>

            {/* Style Selection - Simplified Grid */}
            <div className="space-y-2">
              <div className="flex justify-between items-baseline">
                <label className="text-xs font-medium text-surface-300 uppercase tracking-wide">
                  Design Style
                </label>
                <span className="text-[10px] text-surface-400 opacity-60">
                  Select one
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {allowedStyles.map((option) => {
                  const info = STYLE_INFO[option];
                  const isActive = option === style;
                  return (
                    <motion.button
                      key={option}
                      type="button"
                      aria-pressed={isActive}
                      onClick={(e) => {
                        triggerHapticFeedback();
                        setStyle(option);

                        // Ripple effect
                        const button = e.currentTarget;
                        const ripple = document.createElement("span");
                        const rect = button.getBoundingClientRect();
                        const size = Math.max(rect.width, rect.height);
                        const x = e.clientX - rect.left - size / 2;
                        const y = e.clientY - rect.top - size / 2;

                        ripple.style.width = ripple.style.height = `${size}px`;
                        ripple.style.left = `${x}px`;
                        ripple.style.top = `${y}px`;
                        ripple.className = "ripple";

                        button.appendChild(ripple);
                        setTimeout(() => ripple.remove(), 600);
                      }}
                      className={cn(
                        "relative flex items-center gap-2 rounded-xl border px-3 py-3 text-left transition-all overflow-hidden",
                        isActive
                          ? "border-primary-400 bg-primary-500/20 shadow-glow-primary"
                          : "border-white/10 bg-white/5 hover:border-primary-400/30 hover:bg-white/10",
                      )}
                      whileTap={{ scale: 0.98 }}
                    >
                      {isActive && (
                        <motion.div
                          layoutId="activeStyleGlow"
                          className="absolute inset-0 bg-primary-400/10"
                          initial={false}
                          transition={{ duration: 0.3 }}
                        />
                      )}
                      <info.icon
                        className={cn(
                          "h-5 w-5 flex-shrink-0 relative z-10 transition-colors",
                          isActive ? "text-primary-300" : "text-surface-400",
                        )}
                      />
                      <div className="flex-1 min-w-0 relative z-10">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              "text-sm font-semibold truncate transition-colors",
                              isActive ? "text-primary-100" : "text-surface-50",
                            )}
                          >
                            {option.split(" ")[0]}
                          </span>
                          {isActive && (
                            <motion.div
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                            >
                              <Check className="h-3.5 w-3.5 text-primary-400 flex-shrink-0" />
                            </motion.div>
                          )}
                        </div>
                        <span
                          className={cn(
                            "text-[11px] block leading-snug transition-colors",
                            isActive
                              ? "text-primary-200/80"
                              : "text-surface-400",
                          )}
                        >
                          {info.desc}
                        </span>
                        <span
                          className={cn(
                            "mt-0.5 text-[10px] block leading-snug transition-colors",
                            isActive ? "text-primary-200/60" : "text-surface-500",
                          )}
                        >
                          {info.detail}
                        </span>
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            </div>

            {/* Tone Selection - Horizontal Scroll on Mobile with Snap */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-surface-300 uppercase tracking-wide">
                Tone
              </label>
              <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 custom-scrollbar scroll-smooth snap-x snap-mandatory">
                {Object.values(ToneOption).map((option) => {
                  const info = TONE_INFO[option];
                  const isActive = option === tone;
                  return (
                    <motion.button
                      key={option}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => {
                        triggerHapticFeedback();
                        setTone(option);
                      }}
                      className={cn(
                        "relative flex items-center gap-1.5 rounded-full border px-4 py-2 whitespace-nowrap transition-all flex-shrink-0 snap-center",
                        isActive
                          ? "border-success-400 bg-success-500/20 shadow-glow-success"
                          : "border-white/10 bg-white/5 hover:border-success-400/30 hover:bg-white/10",
                      )}
                      whileTap={{ scale: 0.95 }}
                    >
                      <info.icon
                        className={cn(
                          "h-4 w-4 flex-shrink-0 transition-colors",
                          isActive ? "text-success-300" : "text-surface-400",
                        )}
                      />
                      <span
                        className={cn(
                          "text-xs font-semibold",
                          isActive ? "text-success-100" : "text-surface-300",
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
              <div className="flex gap-2 bg-surface-950/30 p-1 rounded-xl border border-white/5">
                <Button
                  variant={captionSource === "ai" ? "filled" : "ghost"}
                  aria-pressed={captionSource === "ai"}
                  size="sm"
                  leftIcon={<Sparkles className="h-3.5 w-3.5" />}
                  onClick={() => {
                    triggerHapticFeedback();
                    setCaptionSource("ai");
                  }}
                  className={cn(
                    "flex-1 rounded-lg",
                    captionSource !== "ai" &&
                      "text-surface-400 hover:text-surface-200",
                  )}
                >
                  AI Caption
                </Button>
                <Button
                  variant={captionSource === "custom" ? "filled" : "ghost"}
                  aria-pressed={captionSource === "custom"}
                  size="sm"
                  leftIcon={<Edit3 className="h-3.5 w-3.5" />}
                  onClick={() => {
                    triggerHapticFeedback();
                    setCaptionSource("custom");
                  }}
                  className={cn(
                    "flex-1 rounded-lg",
                    captionSource !== "custom" &&
                      "text-surface-400 hover:text-surface-200",
                  )}
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
                    className="bg-white/5 border-white/10 focus:border-primary-400"
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Advanced Options - Collapsible */}
            <div className="border-t border-white/10 pt-3">
              <button
                type="button"
                aria-expanded={showAdvanced}
                aria-controls="advanced-post-options"
                onClick={() => {
                  triggerHapticFeedback();
                  setShowAdvanced(!showAdvanced);
                }}
                className="flex items-center gap-2 text-xs text-surface-400 hover:text-surface-200 transition-colors w-full group"
              >
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 transition-transform group-hover:text-primary-400",
                    showAdvanced && "rotate-180",
                  )}
                />
                <span className="group-hover:text-primary-400 transition-colors">
                  Advanced options
                </span>
              </button>

              <AnimatePresence>
                {showAdvanced && (
                  <motion.div
                    id="advanced-post-options"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="pt-3 space-y-3"
                  >
                    {/* Template Selection */}
                    <div className="space-y-2 pb-2">
                      <Select
                        label="Use a template"
                        aria-label="Select template"
                        value={selectedTemplateId}
                        onChange={(e) => {
                          setSelectedTemplateId(e.target.value);
                          const template = templateOptions.find(
                            (t) => t.id === e.target.value,
                          );
                          if (template) {
                            setCustomMessage(
                              template.content
                                .replace(
                                  /\[Customer Name\]/g,
                                  customerName.trim() || "our amazing customer",
                                )
                                .replace(
                                  /\[Dealership Name\]/g,
                                  dealershipName,
                                ),
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
                      </Select>
                    </div>

                    {/* Style Preview */}
                    <div className="rounded-xl border border-primary-400/20 bg-primary-500/10 px-4 py-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Sparkles className="w-3 h-3 text-primary-300" />
                        <div className="text-[10px] uppercase tracking-wide text-primary-300 font-semibold">
                          AI Instruction
                        </div>
                      </div>
                      <p className="text-xs text-surface-200 leading-relaxed font-mono">
                        <TypewriterText text={STYLE_INFO[style].aiHint} />
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Generate Button - Full Width & Prominent */}
            <div className="flex flex-col gap-3 pt-2">
              <Button
                variant="filled"
                size="lg"
                leftIcon={
                  <Sparkles className={cn(isBusy && "animate-pulse")} />
                }
                rightIcon={!isBusy && <ChevronRight />}
                onClick={handleGenerate}
                disabled={isBusy}
                fullWidth
                className="relative overflow-hidden h-14 text-base"
                style={{
                  background:
                    "linear-gradient(135deg, var(--brand-primary-500), var(--brand-primary))",
                  boxShadow: "0 14px 30px -12px var(--brand-primary, #1d4ed8)",
                }}
              >
                {isBusy && (
                  <motion.div
                    className="absolute inset-0 bg-white/20"
                    initial={{ x: "-100%" }}
                    animate={{ x: "100%" }}
                    transition={{
                      repeat: Infinity,
                      duration: 1.5,
                      ease: "linear",
                    }}
                  />
                )}
                <span className="relative z-10 flex items-center gap-2">
                  {isBusy ? "Creating your post..." : "Generate Post"}
                  {!isBusy && (
                    <kbd className="hidden sm:inline-flex items-center gap-1 px-1.5 py-1 rounded bg-white/15 border border-white/20 text-white/80">
                      <Command className="w-3 h-3" />
                      <CornerDownLeft className="w-3 h-3" />
                    </kbd>
                  )}
                </span>
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
                className="text-surface-400 hover:text-surface-200"
              >
                Change photo
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <VinScanner
        isOpen={vinScannerOpen}
        onClose={() => setVinScannerOpen(false)}
        onVehicleDecoded={(vehicle) => {
          setDecodedVehicle(vehicle);
        }}
      />

      {currentDealer && (
        <PhotoReleaseModal
          isOpen={releaseModalOpen}
          onClose={() => setReleaseModalOpen(false)}
          dealershipName={currentDealer.name}
          vin={decodedVehicle?.vin}
          defaultCustomerName={customerName}
          onCaptured={(release) => {
            setCapturedRelease(release);
            setReleaseValidationError(false);
          }}
        />
      )}
    </div>
  );
};
