import React, { useCallback, useEffect, useMemo, useState } from "react";
import { m, AnimatePresence } from "framer-motion";
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
  Layers,
  Flame,
  Briefcase,
  Users,
  Smile,
  Megaphone,
  Command,
  CornerDownLeft,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Image as ImageIcon,
  Film,
  Globe2,
  LockKeyhole,
  type LucideIcon,
} from "lucide-react";
import {
  StyleOption,
  ToneOption,
  type GenerationParams,
  type MediaOutputMode,
  type PrimaryImageFormatId,
} from "../types";
import { triggerHapticFeedback } from "../utils/haptics";
import { Button } from "./ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { Input, Textarea, Select } from "./ui/Input";
import {
  POST_TEMPLATES,
  renderPostTemplate,
  replaceCustomerIdentity,
} from "./templates";
import { cn } from "../utils/classNames";
import { VinScanner } from "./VinScanner";
import { DecodedVehicle, vehicleToCreativeBrief } from "../services/vinDecoder";
import { PhotoReleaseModal } from "./PhotoReleaseModal";
import { useAppStore } from "../stores/appStore";
import { CapturedRelease } from "../services/photoReleases";
import { ScenarioPicker } from "./ScenarioPicker";
import {
  PostScenario,
  POST_SCENARIOS,
  scenarioToCreativeBrief,
  getScenariosForDealer,
} from "../services/postScenarios";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { ProgressiveImage } from "./ui/ProgressiveImage";
import {
  DEFAULT_PLATFORM_IDS,
  getPrimaryImageProfile,
  getPlatformOptions,
  getSecondaryPlatformOptions,
  platformsToCreativeBrief,
  resolvePrimaryImageProfile,
  type PrimaryImageProfile,
  type PlatformId,
} from "../services/platformCopy";
import { brandHashtagFromName, formatHashtag } from "../utils/hashtags";
import {
  releaseAuthorizesPublicLabel,
  toPublicCustomerLabel,
} from "../utils/customerIdentity";
import { captionUsesOnlyExpectedCustomer } from "../utils/captionQuality";
import {
  listWebsiteDestinations,
  type WebsiteDestination,
} from "../services/websitePublishing";

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
      scenarioId?: string;
      customerIdentityRequired?: boolean;
      hasRelease?: boolean;
      capturedRelease?: CapturedRelease;
      websiteEnabled?: boolean;
      websiteVehicleDescription?: string;
    },
    platformIds?: PlatformId[],
    outputProfile?: PrimaryImageProfile,
    mediaOutputMode?: MediaOutputMode,
  ) => Promise<void> | void;
  onBack: () => void;
  dealershipName: string;
  defaultStyle: StyleOption;
  defaultTone: ToneOption;
  onStyleToneChange: (style: StyleOption, tone: ToneOption) => void;
  isDesktopLayout: boolean;
  isGenerating?: boolean;
  /**
   * Previous exact delivery choices, supplied only when retrying or remixing
   * the current capture. A brand-new capture intentionally omits this value.
   */
  initialGenerationParams?: GenerationParams | null;
}

const normalizeReleaseVin = (value: string | undefined): string =>
  (value || "").trim().toUpperCase();

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
  [StyleOption.DepthPop]: {
    icon: Layers,
    desc: "3D depth pop",
    detail: "Headline behind the car · subject glow · thumbnail energy",
    aiHint:
      "Oversized headline tucked behind the real car with a glow outline — modern 3D depth.",
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

const OUTPUT_FORMAT_CHOICES: Array<{
  id: PrimaryImageFormatId;
  label: string;
  size: string;
}> = [
  { id: "story_vertical", label: "Story / Reel", size: "1080×1920" },
  { id: "feed_portrait", label: "Feed portrait", size: "1080×1350" },
  { id: "feed_square", label: "Feed", size: "1080×1080" },
  { id: "marketplace", label: "Marketplace", size: "1200×628" },
  { id: "gbp", label: "Google", size: "1200×900" },
];

const isMediaOutputMode = (value: unknown): value is MediaOutputMode =>
  value === "photo" || value === "video" || value === "both";

const isStyleOption = (value: unknown): value is StyleOption =>
  Object.values(StyleOption).includes(value as StyleOption);

const isToneOption = (value: unknown): value is ToneOption =>
  Object.values(ToneOption).includes(value as ToneOption);

const isPrimaryImageFormatId = (value: unknown): value is PrimaryImageFormatId =>
  OUTPUT_FORMAT_CHOICES.some((format) => format.id === value);

interface CreativeBriefSections {
  dealershipName: string;
  scenarioBlock?: string;
  vehicleBlock?: string;
  oemBlock?: string;
  designBlock: string;
  /** Dealer brand voice — a brand contract, so it rides inside the caption window. */
  voiceBlock?: string;
  supportingBlocks: string[];
  platformBlock?: string;
}

/** Keep immutable grounding facts ahead of verbose destination guidance. */
export const composeGenerationCreativeBrief = ({
  dealershipName,
  scenarioBlock,
  vehicleBlock,
  oemBlock,
  designBlock,
  voiceBlock,
  supportingBlocks,
  platformBlock,
}: CreativeBriefSections): string => {
  const bounded = (value: string | undefined, limit: number) =>
    (value || "").trim().slice(0, limit);
  // The caption model intentionally reads only the first 900 characters of
  // this shared brief. Keep every immutable grounding block inside an 850-char
  // worst-case envelope so a verbose custom scenario cannot push vehicle, OEM,
  // or design facts out of the live caption prompt. The remaining budget is
  // still available to the image model for dealer and destination guidance.
  // Brand voice sits second: identity + voice never exceed 320 chars, so the
  // dealership's voice can no longer be pushed out of the caption window by a
  // verbose scenario or VIN block. Design DNA is last because the caption
  // model also receives style guidance through its own styleHint.
  const essential = [
    `Dealership identity (use this exact name): "${bounded(dealershipName, 100)}".`,
    bounded(voiceBlock, 220),
    bounded(scenarioBlock, 240),
    bounded(vehicleBlock, 220),
    bounded(oemBlock, 120),
    bounded(designBlock, 120),
  ].filter(Boolean);
  const supporting = supportingBlocks.map((part) => bounded(part, 220)).filter(Boolean);
  const platform = bounded(platformBlock, 500);
  return [...essential, ...supporting, platform]
    .filter(Boolean)
    .join(" ")
    .slice(0, 1400);
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
  initialGenerationParams,
}) => {
  const currentDealer = useAppStore((s) => s.currentDealer);
  const currentPerson = useAppStore((s) => s.currentPerson);
  const restoredCustomerName = toPublicCustomerLabel(
    typeof initialGenerationParams?.customerName === "string"
      ? initialGenerationParams.customerName
      : "",
  );
  const restoredCustomText =
    typeof initialGenerationParams?.customText === "string"
      ? initialGenerationParams.customText
      : "";
  const restoredScenario =
    getScenariosForDealer(currentDealer?.custom_scenarios).find(
      (scenario) => scenario.id === initialGenerationParams?.scenarioId,
    ) || POST_SCENARIOS[0];
  const restoredScenarioNeedsCustomerRelease =
    restoredScenario.requiresCustomer || restoredScenario.category === "delivery";
  const restoredCustomTextIsSafe = captionUsesOnlyExpectedCustomer(
    restoredCustomText,
    restoredCustomerName,
    {
      allowedPhrases: [dealershipName],
      rejectAnyCustomerIdentity:
        restoredScenarioNeedsCustomerRelease && !restoredCustomerName,
    },
  );
  const safeRestoredCustomText = restoredCustomTextIsSafe ? restoredCustomText : "";
  const [customerName, setCustomerName] = useState(restoredCustomerName);
  const [style, setStyle] = useState<StyleOption>(() =>
    isStyleOption(initialGenerationParams?.style)
      ? initialGenerationParams.style
      : defaultStyle,
  );
  const primaryPlatformOptions = useMemo(() => getPlatformOptions(), []);
  const secondaryPlatformOptions = useMemo(() => getSecondaryPlatformOptions(), []);
  const platformOptions = useMemo(
    () => [...primaryPlatformOptions, ...secondaryPlatformOptions],
    [primaryPlatformOptions, secondaryPlatformOptions],
  );
  const supportedPlatformIds = useMemo(
    () => new Set(platformOptions.map((platform) => platform.id)),
    [platformOptions],
  );
  const initialPlatforms = useMemo(() => {
    const hasRestoredSelection = Array.isArray(initialGenerationParams?.platformIds);
    const restored = Array.from(
      new Set(
        (initialGenerationParams?.platformIds || []).filter((platformId) =>
          supportedPlatformIds.has(platformId),
        ),
      ),
    );
    // An explicit empty array is an intentional Website-only destination.
    // Only legacy/new sessions with no saved destination state receive the
    // social defaults.
    if (hasRestoredSelection) return restored;
    // Older Website-only drafts predate explicit empty platform persistence.
    // Restoring one must not reintroduce a default social destination.
    return initialGenerationParams?.websiteEnabled ? [] : [...DEFAULT_PLATFORM_IDS];
  }, [
    initialGenerationParams?.platformIds,
    initialGenerationParams?.websiteEnabled,
    supportedPlatformIds,
  ]);
  const [selectedPlatforms, setSelectedPlatforms] =
    useState<PlatformId[]>(initialPlatforms);
  const [platformSelectionTouched, setPlatformSelectionTouched] = useState(() =>
    Array.isArray(initialGenerationParams?.platformIds),
  );
  const [websiteSelected, setWebsiteSelected] = useState(
    Boolean(initialGenerationParams?.websiteEnabled),
  );
  const [websiteDestination, setWebsiteDestination] =
    useState<WebsiteDestination | null>(null);
  const [websiteAvailability, setWebsiteAvailability] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");
  const [showMorePlatforms, setShowMorePlatforms] = useState(() => {
    const restored = new Set(initialGenerationParams?.platformIds || []);
    return secondaryPlatformOptions.some((platform) => restored.has(platform.id));
  });
  const selectedSecondaryCount = useMemo(
    () =>
      secondaryPlatformOptions.filter((platform) =>
        selectedPlatforms.includes(platform.id),
      ).length,
    [secondaryPlatformOptions, selectedPlatforms],
  );
  const [mediaOutputMode, setMediaOutputMode] = useState<MediaOutputMode>(() =>
    isMediaOutputMode(initialGenerationParams?.mediaOutputMode)
      ? initialGenerationParams.mediaOutputMode
      : "photo",
  );
  const [primaryFormatOverride, setPrimaryFormatOverride] =
    useState<PrimaryImageFormatId | null>(() => {
      const restoredFormat = initialGenerationParams?.primaryFormatId;
      return isPrimaryImageFormatId(restoredFormat) ? restoredFormat : null;
    });
  const suggestedImageProfile = useMemo(
    () => resolvePrimaryImageProfile(selectedPlatforms),
    [selectedPlatforms],
  );
  const primaryImageProfile = useMemo(
    () =>
      primaryFormatOverride
        ? getPrimaryImageProfile(primaryFormatOverride)
        : suggestedImageProfile,
    [primaryFormatOverride, suggestedImageProfile],
  );
  const [tone, setTone] = useState<ToneOption>(() =>
    isToneOption(initialGenerationParams?.tone)
      ? initialGenerationParams.tone
      : defaultTone,
  );
  const [customMessage, setCustomMessage] = useState(safeRestoredCustomText);
  const [captionSource, setCaptionSource] = useState<CaptionSource>(() =>
    safeRestoredCustomText.trim() ? "custom" : "ai",
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [vinScannerOpen, setVinScannerOpen] = useState(false);
  const [decodedVehicle, setDecodedVehicle] = useState<DecodedVehicle | null>(null);
  const [releaseModalOpen, setReleaseModalOpen] = useState(false);
  const [releaseValidationError, setReleaseValidationError] = useState(false);
  const [captionIdentityError, setCaptionIdentityError] = useState(
    restoredCustomText && !restoredCustomTextIsSafe
      ? "A saved caption contained a different customer name, so it was quarantined. Generate a fresh caption or write a corrected one."
      : "",
  );
  // Captured signature stays local until Generate. useGeneration durably saves
  // it before the customer photo is sent to an AI provider, then links that
  // same protected record to the created post.
  const [capturedRelease, setCapturedRelease] = useState<CapturedRelease | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setWebsiteAvailability("loading");
    void listWebsiteDestinations(controller.signal)
      .then((destinations) => {
        const destination =
          destinations.find((item) => item.id === "joe_customer_hub") ||
          destinations[0] ||
          null;
        setWebsiteDestination(destination);
        const ready = Boolean(destination?.enabled);
        setWebsiteAvailability(ready ? "ready" : "unavailable");
        if (!ready) setWebsiteSelected(false);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setWebsiteDestination(null);
        setWebsiteAvailability("unavailable");
        setWebsiteSelected(false);
      });
    return () => controller.abort();
  }, [currentDealer?.id]);

  // Post scenario — drives prompt context + default style/tone. "customer_delivery"
  // is the implicit default; an undefined value also resolves to that.
  const [scenarioId, setScenarioId] = useState<string>(() => {
    const restoredScenarioId = initialGenerationParams?.scenarioId;
    return restoredScenarioId &&
      getScenariosForDealer(currentDealer?.custom_scenarios).some(
        (scenario) => scenario.id === restoredScenarioId,
      )
      ? restoredScenarioId
      : POST_SCENARIOS[0].id;
  });
  // Scenario lookup now considers the dealer's custom_scenarios JSON too.
  const activeScenario = useMemo(() => {
    const all = getScenariosForDealer(currentDealer?.custom_scenarios);
    return all.find((s) => s.id === scenarioId) || POST_SCENARIOS[0];
  }, [scenarioId, currentDealer?.custom_scenarios]);
  const scenarioNeedsCustomerRelease =
    activeScenario.requiresCustomer || activeScenario.category === "delivery";

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
    const filtered = Object.values(StyleOption).filter((s) => allowedSet.has(s));
    return filtered.length > 0 ? filtered : Object.values(StyleOption);
  }, [currentDealer?.enabled_styles]);

  const dealerDefaultStyle = currentDealer?.default_style as StyleOption | undefined;

  // Sync with defaults. A safe retry/remix seed wins when it is still allowed;
  // otherwise use the dealer default, user preference, then first enabled style.
  useEffect(() => {
    const restoredStyle = initialGenerationParams?.style;
    let nextStyle: StyleOption =
      isStyleOption(restoredStyle) && allowedStyles.includes(restoredStyle)
        ? restoredStyle
        : defaultStyle;
    if (
      !(isStyleOption(restoredStyle) && allowedStyles.includes(restoredStyle)) &&
      dealerDefaultStyle &&
      allowedStyles.includes(dealerDefaultStyle)
    ) {
      nextStyle = dealerDefaultStyle;
    } else if (!allowedStyles.includes(nextStyle)) {
      nextStyle = allowedStyles[0];
    }
    setStyle(nextStyle);
    setTone(
      isToneOption(initialGenerationParams?.tone)
        ? initialGenerationParams.tone
        : defaultTone,
    );
  }, [
    defaultStyle,
    defaultTone,
    dealerDefaultStyle,
    allowedStyles,
    initialGenerationParams?.style,
    initialGenerationParams?.tone,
  ]);

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

  const togglePlatform = useCallback((id: PlatformId) => {
    triggerHapticFeedback();
    setPlatformSelectionTouched(true);
    setSelectedPlatforms((prev) => {
      if (prev.includes(id)) {
        return prev.filter((p) => p !== id);
      }
      return [...prev, id];
    });
  }, []);

  // Notify parent
  useEffect(() => {
    onStyleToneChange(style, tone);
  }, [style, tone, onStyleToneChange]);

  const templateOptions = useMemo(() => POST_TEMPLATES, []);

  const handleCustomerNameChange = useCallback(
    (nextCustomerName: string) => {
      const previousCustomerName = customerName;
      const publicCustomerName = toPublicCustomerLabel(nextCustomerName);
      setCustomerName(publicCustomerName);
      setCaptionIdentityError("");

      const selectedTemplate = templateOptions.find(
        (template) => template.id === selectedTemplateId,
      );
      if (selectedTemplate) {
        setCustomMessage(
          renderPostTemplate(selectedTemplate.content, {
            customerName: publicCustomerName,
            dealershipName,
          }),
        );
        return;
      }

      if (captionSource === "custom" && previousCustomerName.trim()) {
        setCustomMessage((current) =>
          replaceCustomerIdentity(current, previousCustomerName, publicCustomerName),
        );
      }
    },
    [captionSource, customerName, dealershipName, selectedTemplateId, templateOptions],
  );

  const handleGenerate = useCallback(async () => {
    triggerHapticFeedback();
    if (selectedPlatforms.length === 0 && !websiteSelected) return;
    if (scenarioNeedsCustomerRelease && !capturedRelease) {
      setReleaseValidationError(true);
      setReleaseModalOpen(true);
      return;
    }
    if (
      capturedRelease &&
      (!releaseAuthorizesPublicLabel(capturedRelease.customerName, customerName) ||
        normalizeReleaseVin(capturedRelease.vin) !==
          normalizeReleaseVin(decodedVehicle?.vin))
    ) {
      // A signature is authority for one exact customer/vehicle pair. If
      // restored or stale UI state ever diverges, discard it before any
      // provider request and require a fresh acknowledgement.
      setCapturedRelease(null);
      setReleaseValidationError(true);
      setReleaseModalOpen(true);
      return;
    }
    setReleaseValidationError(false);
    let preparedText: string | undefined;

    const styleInfo = STYLE_INFO[style];
    const supportingBriefParts: string[] = [];

    // Scenario context (Customer Delivery / Pre-Owned Spotlight / Service
    // Promo / etc). This goes near the top of the brief so it dominates the
    // default delivery-post framing where the scenarios diverge from it.
    // Custom dealer scenarios resolve via the dealer's custom_scenarios JSON.
    const scenarioBlock = scenarioToCreativeBrief(
      scenarioId,
      currentDealer?.custom_scenarios,
    );
    const platformBrief = platformsToCreativeBrief(selectedPlatforms, dealershipName);

    // Inject decoded vehicle context if a VIN was scanned. This grounds the
    // model in concrete facts (year/make/model/trim/powertrain) so the caption
    // stops hallucinating equipment that isn't on the car.
    let vehicleBlock = "";
    if (decodedVehicle && !decodedVehicle.empty) {
      const vehicleBrief = vehicleToCreativeBrief(decodedVehicle);
      if (vehicleBrief) {
        vehicleBlock = `Vehicle facts (do not contradict): ${vehicleBrief}`;
      }
    }

    const oemBlock = currentDealer?.oem_affiliation?.trim()
      ? `OEM affiliation: ${currentDealer.oem_affiliation.trim()}. Respect that manufacturer's brand-guideline tone and avoid claims that conflict with their advertising standards.`
      : "";

    // Per-dealer brand voice / banned phrases / OEM affiliation. These come
    // from the dealers PocketBase record so each dealership can tune voice
    // without a code change.
    const voiceBlock = currentDealer?.brand_voice?.trim()
      ? `Brand voice (match this exactly): ${currentDealer.brand_voice.trim()}`
      : "";
    if (currentDealer?.banned_phrases?.trim()) {
      const banned = currentDealer.banned_phrases
        .split(/[\n,]+/)
        .map((p) => p.trim())
        .filter(Boolean);
      if (banned.length > 0) {
        supportingBriefParts.push(
          `Forbidden phrases (do not use, even as a near-match): ${banned
            .map((p) => `"${p}"`)
            .join(", ")}.`,
        );
      }
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
      supportingBriefParts.push(
        `Dealership facts (may be referenced, never contradicted): ${identityFacts.join(
          "; ",
        )}.`,
      );
    }

    // Default hashtags + footer — sanitize to #PascalCase so IG/FB/TikTok
    // recognize every tag (spaces inside #tags break platforms).
    const dealerHashtags = (currentDealer?.default_hashtags || "")
      .split(/[\n,]+/)
      .map((h) => h.trim())
      .filter(Boolean)
      .map((h) => formatHashtag(h))
      .filter(Boolean);
    const brandTag = currentDealer?.name
      ? brandHashtagFromName(currentDealer.name)
      : "";
    const requiredTags = Array.from(
      new Set([brandTag, ...dealerHashtags].filter(Boolean)),
    );
    if (requiredTags.length > 0) {
      supportingBriefParts.push(
        `Required hashtags (each is one continuous #PascalCase token, space-separated on the last line): ${requiredTags.join(
          " ",
        )}.`,
      );
    }
    const dealerFooter = (currentDealer?.default_footer || "").trim();
    if (dealerFooter) {
      supportingBriefParts.push(
        `Required footer (append verbatim AFTER the caption, BEFORE the hashtags): "${dealerFooter}"`,
      );
    }

    // Immutable scenario, dealer, vehicle, and OEM facts lead. Destination
    // guidance is useful but expendable when the prompt budget is full.
    const creativeBrief = composeGenerationCreativeBrief({
      dealershipName,
      scenarioBlock,
      vehicleBlock,
      oemBlock,
      designBlock: `Design DNA: ${styleInfo.aiHint}`,
      voiceBlock,
      supportingBlocks: supportingBriefParts,
      platformBlock: platformBrief,
    });

    if (captionSource === "custom" && customMessage.trim()) {
      const vehiclePhrase =
        decodedVehicle && !decodedVehicle.empty
          ? [
              decodedVehicle.year,
              decodedVehicle.make,
              decodedVehicle.model,
              decodedVehicle.trim,
            ]
              .filter(Boolean)
              .join(" ")
          : undefined;
      if (
        !captionUsesOnlyExpectedCustomer(customMessage, customerName, {
          allowedPhrases: [dealershipName, vehiclePhrase],
          rejectAnyCustomerIdentity: scenarioNeedsCustomerRelease && !customerName,
        })
      ) {
        setCaptionIdentityError(
          customerName
            ? `This caption appears to name someone other than ${customerName}. Correct the caption before generating.`
            : "This caption names a customer, but no approved customer name is attached to this post. Remove the name or add the approved customer first name.",
        );
        return;
      }
      setCaptionIdentityError("");
      preparedText = customMessage.trim();
    }

    setIsSubmitting(true);
    try {
      await onGenerate(
        style,
        tone,
        customerName,
        preparedText,
        creativeBrief,
        {
          vin: decodedVehicle?.vin,
          scenarioId,
          customerIdentityRequired: scenarioNeedsCustomerRelease,
          hasRelease: !!capturedRelease,
          capturedRelease: capturedRelease || undefined,
          websiteEnabled: websiteSelected,
          websiteVehicleDescription:
            decodedVehicle && !decodedVehicle.empty
              ? [
                  decodedVehicle.year,
                  decodedVehicle.make,
                  decodedVehicle.model,
                  decodedVehicle.trim,
                ]
                  .filter(Boolean)
                  .join(" ")
              : undefined,
        },
        selectedPlatforms,
        primaryImageProfile,
        mediaOutputMode,
      );
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
    capturedRelease,
    currentDealer,
    scenarioId,
    scenarioNeedsCustomerRelease,
    selectedPlatforms,
    primaryImageProfile,
    mediaOutputMode,
    websiteSelected,
    dealershipName,
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
    <div className="flex flex-1 items-start justify-center px-0 py-2 sm:px-2 sm:py-4">
      <m.div
        className={cn(
          "mx-auto w-full",
          isDesktopLayout
            ? "max-w-6xl grid grid-cols-[minmax(0,1.15fr)_minmax(420px,0.85fr)] gap-6 items-start"
            : "max-w-2xl",
        )}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        {isDesktopLayout && (
          <section className="sticky top-24 overflow-hidden rounded-[1.75rem] border border-hairline bg-surface-950 shadow-2xl shadow-black/30">
            <div className="flex items-center justify-between border-b border-hairline px-5 py-4 text-xs font-semibold tracking-[0.12em] text-surface-400">
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
            <div className="flex items-center justify-between border-t border-hairline px-5 py-4 text-xs text-surface-400">
              <span>Review the full frame before generating.</span>
              <button
                type="button"
                onClick={onBack}
                className="font-semibold text-content-secondary hover:text-content-primary"
              >
                Change photo
              </button>
            </div>
          </section>
        )}

        <Card
          elevation={2}
          className="relative overflow-hidden border-hairline bg-surface-900"
        >
          <CardHeader className="relative pb-3">
            <div className="flex items-center gap-3">
              {/* Compact image preview */}
              <m.div
                className={cn(
                  "h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-strong shadow-lg sm:h-20 sm:w-20",
                  isDesktopLayout && "hidden",
                )}
                whileHover={{ scale: 1.05 }}
              >
                <ProgressiveImage
                  src={imageSrc}
                  alt="Preview"
                  className="h-full w-full object-cover"
                />
              </m.div>
              <div className="min-w-0 flex-1">
                <CardTitle className="text-lg sm:text-xl">Create your post</CardTitle>
                <CardDescription className="text-xs sm:text-sm">
                  Pick a style — AI handles the rest
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent className="relative space-y-5 pt-0">
            {/* Post scenario — selects which kind of post this is (delivery,
                pre-owned spotlight, service promo, etc). Tunes prompt + defaults. */}
            <ScenarioPicker value={scenarioId} onChange={handleScenarioChange} />

            <div
              className="flex items-center gap-3 rounded-xl border border-primary-400/20 bg-primary-500/[0.07] px-3 py-2.5"
              aria-label={`Posting as ${currentPerson?.name || "signed-in team member"}`}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary-400/20 bg-primary-500/10 text-primary-300">
                <Users className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary-300">
                  Posting as
                </p>
                <p className="truncate text-sm font-semibold text-surface-100">
                  {currentPerson?.name || "Signed-in team member"}
                </p>
              </div>
              <Badge variant="success" size="sm" className="shrink-0">
                Verified
              </Badge>
            </div>

            {/* Customer Name - Compact */}
            <Input
              label={`Customer's name (${scenarioNeedsCustomerRelease ? "required" : "optional"})`}
              value={customerName}
              onChange={(e) => handleCustomerNameChange(e.target.value)}
              placeholder="First name"
              disabled={Boolean(capturedRelease)}
              helperText={
                capturedRelease
                  ? "Remove or replace the signed release to change this identity."
                  : undefined
              }
              fullWidth
              className="bg-fill-subtle border-hairline focus:border-primary-400 focus:bg-fill-hover transition-colors"
            />

            {/* VIN Scanner — show pill if vehicle decoded, otherwise show CTA */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-surface-300 uppercase tracking-wide">
                Vehicle
              </label>
              {decodedVehicle && !decodedVehicle.empty ? (
                <m.div
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
                    disabled={Boolean(capturedRelease)}
                    title={
                      capturedRelease
                        ? "Remove or replace the signed release before changing the vehicle."
                        : "Clear vehicle"
                    }
                    onClick={() => {
                      triggerHapticFeedback();
                      setDecodedVehicle(null);
                    }}
                    className="p-1 -mr-1 text-success-300/80 hover:text-success-100 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </m.div>
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
                  className="border-dashed border-strong bg-fill-subtle hover:bg-fill-hover"
                  disabled={Boolean(capturedRelease)}
                >
                  Scan VIN (optional — boosts accuracy)
                </Button>
              )}
            </div>

            {/* Photo release — capture customer's signed consent before posting their photo */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-surface-300 uppercase tracking-wide">
                Photo release · {scenarioNeedsCustomerRelease ? "required" : "optional"}
              </label>
              {capturedRelease ? (
                <m.div
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex items-start gap-3 rounded-xl border border-success-500/40 bg-success-500/10 px-3 py-2.5"
                >
                  <ShieldCheck className="h-4 w-4 text-success-300 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-success-100">
                      Release captured for
                      {toPublicCustomerLabel(capturedRelease.customerName)
                        ? ` ${toPublicCustomerLabel(capturedRelease.customerName)}`
                        : " this customer"}
                    </div>
                    <div className="text-[10px] text-success-300/80">
                      Identity and vehicle are locked to this signature.
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setCapturedRelease(null);
                        setReleaseModalOpen(true);
                      }}
                      className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-success-400/25 bg-success-500/10 px-2 text-[11px] font-semibold text-success-100 transition-colors hover:bg-success-500/20 [.theme-light_&]:text-success-900"
                    >
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                      Replace
                    </button>
                    <button
                      type="button"
                      aria-label="Remove captured release"
                      onClick={() => setCapturedRelease(null)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-error-400/25 bg-error-500/10 text-error-100 transition-colors hover:bg-error-500/20"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </m.div>
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
                  className="border-dashed border-strong bg-fill-subtle hover:bg-fill-hover"
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
                  This customer-focused post needs a signed photo release before the
                  photo can be sent for AI processing.
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
                    <m.button
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
                          ? "border-primary-400 bg-primary-500/20"
                          : "border-hairline bg-fill-subtle hover:border-primary-400/30 hover:bg-fill-hover",
                      )}
                      whileTap={{ scale: 0.98 }}
                    >
                      {isActive && (
                        <m.div
                          className="absolute inset-0 bg-primary-400/10"
                          initial={{ opacity: 0, scale: 0.98 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ duration: 0.2 }}
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
                            <m.div initial={{ scale: 0 }} animate={{ scale: 1 }}>
                              <Check className="h-3.5 w-3.5 text-primary-400 flex-shrink-0" />
                            </m.div>
                          )}
                        </div>
                        <span
                          className={cn(
                            "text-[11px] block leading-snug transition-colors",
                            isActive ? "text-primary-200/80" : "text-surface-400",
                          )}
                        >
                          {info.desc}
                        </span>
                        <span
                          className={cn(
                            "mt-0.5 text-[10px] block leading-snug transition-colors",
                            isActive ? "text-primary-200/60" : "text-surface-400",
                          )}
                        >
                          {info.detail}
                        </span>
                      </div>
                    </m.button>
                  );
                })}
              </div>
            </div>

            {/* Where they'll post — drives caption length + export bias */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-medium text-surface-300 uppercase tracking-wide">
                  Share to
                </label>
                <span className="text-[10px] text-surface-400">
                  Pick all that apply
                </span>
              </div>
              <div className="mobile-h-scroll -mx-1 px-1 pb-1 sm:flex-wrap sm:overflow-visible">
                {primaryPlatformOptions.map((p) => {
                  const on = selectedPlatforms.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => togglePlatform(p.id)}
                      className={cn(
                        "min-h-11 shrink-0 snap-start rounded-full border px-3.5 py-2 text-left transition-colors",
                        on
                          ? "border-primary-400 bg-primary-500/25 text-primary-50 [.theme-light_&]:text-primary-950"
                          : "border-hairline bg-fill-subtle text-surface-300 hover:border-primary-400/40",
                      )}
                    >
                      <span className="flex items-center gap-1.5 text-sm font-semibold">
                        {on ? (
                          <span
                            className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-primary-300 text-primary-950"
                            aria-hidden="true"
                          >
                            <Check className="h-3 w-3" strokeWidth={3} />
                          </span>
                        ) : null}
                        {p.shortLabel}
                      </span>
                      <span className="block text-[10px] leading-tight opacity-80">
                        {p.verticalPreferred ? "9:16 story-ready" : "Feed"}
                      </span>
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                aria-pressed={websiteSelected}
                aria-describedby="website-destination-description"
                disabled={websiteAvailability !== "ready"}
                onClick={() => {
                  triggerHapticFeedback();
                  setWebsiteSelected((selected) => {
                    const next = !selected;
                    // The social chips begin with convenient defaults. If the
                    // salesperson has not touched them, choosing Website means
                    // Website only—not an implicit TikTok/Facebook/Instagram
                    // selection. Social destinations can still be added after.
                    if (next && !platformSelectionTouched) {
                      setSelectedPlatforms([]);
                    }
                    return next;
                  });
                }}
                className={cn(
                  "flex min-h-16 w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                  websiteSelected
                    ? "border-primary-300 bg-primary-500/25 text-primary-50 [.theme-light_&]:text-primary-950"
                    : "border-hairline bg-fill-subtle text-surface-300 hover:border-primary-400/35 hover:bg-fill-subtle",
                  websiteAvailability !== "ready" &&
                    "cursor-not-allowed opacity-60 hover:border-hairline hover:bg-fill-subtle",
                )}
              >
                <span
                  className={cn(
                    "grid h-10 w-10 shrink-0 place-items-center rounded-xl border",
                    websiteSelected
                      ? "border-primary-300/40 bg-primary-400/20 text-primary-100"
                      : "border-hairline bg-surface-950/50 text-surface-400",
                  )}
                  aria-hidden="true"
                >
                  <Globe2 className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">Website</span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-primary-400/25 bg-primary-500/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary-200 [.theme-light_&]:text-primary-900">
                      <LockKeyhole className="h-2.5 w-2.5" />
                      Draft only
                    </span>
                  </span>
                  <span
                    id="website-destination-description"
                    className="mt-0.5 block text-[10px] leading-relaxed text-surface-400"
                  >
                    {websiteAvailability === "loading"
                      ? "Checking the private website connection…"
                      : websiteAvailability === "ready"
                        ? `Private draft for ${(() => {
                            try {
                              return new URL(
                                websiteDestination?.siteUrl || "https://joegallant.me",
                              ).hostname;
                            } catch {
                              return "joegallant.me";
                            }
                          })()}. AI prepares it; you publish later in Customer Hub.`
                        : websiteDestination?.reason ||
                          "Website drafts are not configured for this dealership yet."}
                  </span>
                </span>
                {websiteSelected ? (
                  <span
                    className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary-300 text-primary-950"
                    aria-hidden="true"
                  >
                    <Check className="h-3.5 w-3.5" strokeWidth={3} />
                  </span>
                ) : null}
              </button>
              <div className="overflow-hidden rounded-xl border border-hairline bg-surface-950/25">
                <button
                  type="button"
                  aria-expanded={showMorePlatforms}
                  aria-controls="secondary-platform-options"
                  aria-label={`More platforms, ${selectedSecondaryCount} selected`}
                  onClick={() => {
                    triggerHapticFeedback();
                    setShowMorePlatforms((current) => !current);
                  }}
                  className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-fill-subtle"
                >
                  <span>
                    <span className="block text-xs font-semibold text-surface-200">
                      More platforms
                    </span>
                    <span className="block text-[10px] text-surface-400">
                      Reels, Marketplace, LinkedIn, X, and device share
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {selectedSecondaryCount > 0 ? (
                      <span className="rounded-full border border-primary-400/25 bg-primary-500/15 px-2 py-0.5 text-[10px] font-semibold text-primary-200 [.theme-light_&]:text-primary-900">
                        {selectedSecondaryCount} selected
                      </span>
                    ) : null}
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 text-surface-400 transition-transform",
                        showMorePlatforms && "rotate-180",
                      )}
                      aria-hidden="true"
                    />
                  </span>
                </button>
                <AnimatePresence initial={false}>
                  {showMorePlatforms ? (
                    <m.div
                      id="secondary-platform-options"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.18 }}
                      className="overflow-hidden border-t border-hairline"
                    >
                      <div className="grid grid-cols-2 gap-2 p-2.5 sm:grid-cols-3 xl:grid-cols-5">
                        {secondaryPlatformOptions.map((platform) => {
                          const selected = selectedPlatforms.includes(platform.id);
                          return (
                            <button
                              key={platform.id}
                              type="button"
                              aria-pressed={selected}
                              onClick={() => togglePlatform(platform.id)}
                              className={cn(
                                "min-h-16 rounded-xl border px-2.5 py-2 text-left transition-colors",
                                selected
                                  ? "border-primary-400 bg-primary-500/20 text-primary-50 [.theme-light_&]:text-primary-950"
                                  : "border-hairline bg-fill-subtle text-surface-300 hover:border-primary-400/35 hover:bg-fill-subtle",
                              )}
                            >
                              <span className="flex items-center gap-1.5 text-xs font-semibold">
                                {selected ? (
                                  <span
                                    className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-primary-300 text-primary-950"
                                    aria-hidden="true"
                                  >
                                    <Check className="h-3 w-3" strokeWidth={3} />
                                  </span>
                                ) : null}
                                {platform.shortLabel}
                              </span>
                              <span className="mt-1 line-clamp-2 block text-[9px] leading-snug opacity-75">
                                {platform.hint}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </m.div>
                  ) : null}
                </AnimatePresence>
              </div>
              <fieldset className="rounded-xl border border-hairline bg-surface-950/30 p-1.5">
                <legend className="sr-only">
                  Media to create for each destination
                </legend>
                <div className="grid grid-cols-3 gap-1.5">
                  {(
                    [
                      {
                        value: "photo",
                        label: "Photo",
                        Icon: ImageIcon,
                        hint: "Exact images",
                      },
                      {
                        value: "video",
                        label: "Video",
                        Icon: Film,
                        hint: "Motion posts",
                      },
                      {
                        value: "both",
                        label: "Both",
                        Icon: Sparkles,
                        hint: "Full campaign",
                      },
                    ] as const
                  ).map(({ value, label, Icon, hint }) => {
                    const selected = mediaOutputMode === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => {
                          triggerHapticFeedback();
                          setMediaOutputMode(value);
                        }}
                        className={cn(
                          "min-h-12 rounded-lg border px-2 py-2 text-left transition-colors",
                          selected
                            ? "border-primary-300 bg-primary-500/30 text-primary-50 [.theme-light_&]:text-primary-950"
                            : "border-transparent bg-fill-subtle text-surface-300 hover:border-primary-400/35",
                        )}
                      >
                        <span className="flex items-center gap-1.5 text-xs font-semibold">
                          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                          {label}
                        </span>
                        <span className="mt-0.5 block text-[9px] leading-tight opacity-70">
                          {hint}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="px-1 pt-1.5 text-[10px] leading-relaxed text-surface-400">
                  {mediaOutputMode === "photo"
                    ? "Creates one exact, unstretched image file for every selected destination."
                    : mediaOutputMode === "video"
                      ? "Creates the protected photo master first, then guides you through the supported video ratios."
                      : "Creates the exact photo set and a video-ready delivery plan without hiding extra paid renders."}
                </p>
              </fieldset>
              <fieldset className="space-y-2 rounded-xl border border-primary-400/20 bg-primary-500/10 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <legend className="text-[10px] font-semibold uppercase tracking-[0.12em] text-primary-300">
                      Main image size
                    </legend>
                    <p className="mt-0.5 text-xs text-surface-300">
                      This is the first composition. Every destination still gets its
                      own exact file in the delivery board.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      triggerHapticFeedback();
                      setPrimaryFormatOverride(null);
                    }}
                    aria-pressed={primaryFormatOverride === null}
                    className={cn(
                      "min-h-9 shrink-0 rounded-lg border px-2.5 text-[10px] font-semibold uppercase tracking-wide transition-colors",
                      primaryFormatOverride === null
                        ? "border-primary-300 bg-primary-500/30 text-primary-50 [.theme-light_&]:text-primary-950"
                        : "border-hairline bg-fill-subtle text-surface-300 hover:border-primary-400/40",
                    )}
                  >
                    Auto
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {OUTPUT_FORMAT_CHOICES.map((format) => {
                    const selected = primaryImageProfile.primaryFormatId === format.id;
                    return (
                      <button
                        key={format.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => {
                          triggerHapticFeedback();
                          setPrimaryFormatOverride(format.id);
                        }}
                        className={cn(
                          "min-h-12 rounded-lg border px-2 py-1.5 text-left transition-colors",
                          selected
                            ? "border-primary-300 bg-primary-500/30 text-primary-50 shadow-sm [.theme-light_&]:text-primary-950"
                            : "border-hairline bg-surface-950/25 text-surface-300 hover:border-primary-400/40",
                        )}
                      >
                        <span className="block text-[11px] font-semibold leading-tight">
                          {format.label}
                        </span>
                        <span className="mt-0.5 block text-[10px] tabular-nums opacity-75">
                          {format.size}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p
                  className="text-[10px] leading-relaxed text-surface-400"
                  aria-live="polite"
                >
                  {primaryFormatOverride
                    ? `${primaryImageProfile.label} selected as the starting composition. Destination files remain independent.`
                    : `${suggestedImageProfile.label} recommended from your destinations. Choose a starting composition above only when needed.`}
                </p>
              </fieldset>
            </div>

            {/* Tone Selection - Horizontal Scroll on Mobile with Snap */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-surface-300 uppercase tracking-wide">
                Tone
              </label>
              <div className="mobile-h-scroll -mx-1 px-1 pb-2">
                {Object.values(ToneOption).map((option) => {
                  const info = TONE_INFO[option];
                  const isActive = option === tone;
                  return (
                    <m.button
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
                          ? "border-success-400 bg-success-500/20"
                          : "border-hairline bg-fill-subtle hover:border-success-400/30 hover:bg-fill-hover",
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
                    </m.button>
                  );
                })}
              </div>
            </div>

            {/* Caption Mode Toggle */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-surface-300 uppercase tracking-wide">
                Caption
              </label>
              <div className="flex gap-2 bg-surface-950/30 p-1 rounded-xl border border-hairline">
                <Button
                  variant={captionSource === "ai" ? "filled" : "ghost"}
                  aria-pressed={captionSource === "ai"}
                  size="sm"
                  leftIcon={<Sparkles className="h-3.5 w-3.5" />}
                  onClick={() => {
                    triggerHapticFeedback();
                    setCaptionSource("ai");
                    setCaptionIdentityError("");
                  }}
                  className={cn(
                    "flex-1 rounded-lg",
                    captionSource !== "ai" && "text-surface-400 hover:text-surface-200",
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
                <m.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <Textarea
                    label="Your caption"
                    value={customMessage}
                    onChange={(e) => {
                      // A manual edit intentionally detaches this copy from the
                      // template selector. Subsequent name changes still replace
                      // the exact prior identity through handleCustomerNameChange.
                      setSelectedTemplateId("");
                      setCustomMessage(e.target.value);
                      setCaptionIdentityError("");
                    }}
                    rows={3}
                    placeholder="Write your caption here..."
                    fullWidth
                    className="bg-fill-subtle border-hairline focus:border-primary-400"
                  />
                  {captionIdentityError ? (
                    <p className="mt-2 text-xs font-medium text-error-200" role="alert">
                      {captionIdentityError}
                    </p>
                  ) : null}
                </m.div>
              )}
            </AnimatePresence>
            {captionSource !== "custom" && captionIdentityError ? (
              <p className="text-xs font-medium text-error-200" role="alert">
                {captionIdentityError}
              </p>
            ) : null}

            {/* Advanced Options - Collapsible */}
            <div className="border-t border-hairline pt-3">
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
                  <m.div
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
                          const nextTemplateId = e.target.value;
                          setSelectedTemplateId(nextTemplateId);
                          const template = templateOptions.find(
                            (t) => t.id === nextTemplateId,
                          );
                          if (template) {
                            setCustomMessage(
                              renderPostTemplate(template.content, {
                                customerName,
                                dealershipName,
                              }),
                            );
                            setCaptionSource("custom");
                            setCaptionIdentityError("");
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
                  </m.div>
                )}
              </AnimatePresence>
            </div>

            {/* Generate Button - Full Width & Prominent */}
            <div className="flex flex-col gap-3 pt-2">
              <Button
                variant="filled"
                size="lg"
                leftIcon={<Sparkles className={cn(isBusy && "animate-pulse")} />}
                rightIcon={!isBusy && <ChevronRight />}
                onClick={handleGenerate}
                disabled={
                  isBusy || (selectedPlatforms.length === 0 && !websiteSelected)
                }
                aria-label={`Generate Post — ${
                  mediaOutputMode === "photo"
                    ? "create photo outputs"
                    : mediaOutputMode === "video"
                      ? "create video plan"
                      : "create photo and video set"
                }`}
                fullWidth
                className="relative overflow-hidden h-14 text-base"
              >
                {isBusy && (
                  <m.div
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
                  {isBusy
                    ? "Creating platform outputs..."
                    : mediaOutputMode === "photo"
                      ? "Create photo outputs"
                      : mediaOutputMode === "video"
                        ? "Create video plan"
                        : "Create photo + video set"}
                  {!isBusy && (
                    <kbd className="hidden sm:inline-flex items-center gap-1 px-1.5 py-1 rounded bg-fill-hover border border-strong text-content-secondary">
                      <Command className="w-3 h-3" />
                      <CornerDownLeft className="w-3 h-3" />
                    </kbd>
                  )}
                </span>
              </Button>
              {selectedPlatforms.length === 0 && !websiteSelected ? (
                <p
                  className="text-center text-xs font-medium text-warning-200"
                  role="status"
                >
                  Choose Website or at least one social destination.
                </p>
              ) : null}
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
      </m.div>

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
            // The full legal name remains only on the protected release. Social
            // copy receives the least-identifying public first-name label.
            handleCustomerNameChange(toPublicCustomerLabel(release.customerName));
            setReleaseValidationError(false);
          }}
        />
      )}
    </div>
  );
};
