import React, { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  Sparkles,
  Check,
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
import { Badge } from "./ui/Badge";
import { Input, Textarea, Select } from "./ui/Input";
import {
  POST_TEMPLATES,
  renderPostTemplate,
  replaceCustomerIdentity,
} from "./templates";
import { cn } from "../utils/classNames";
import { VinScanner } from "./VinScanner";
import { DecodedVehicle } from "../services/vinDecoder";
import { PhotoReleaseModal } from "./PhotoReleaseModal";
import { useAppStore } from "../stores/appStore";
import { CapturedRelease } from "../services/photoReleases";
import { isReleaseAlreadyLinked } from "../hooks/useGeneration";
import { ScenarioPicker } from "./ScenarioPicker";
import {
  PostScenario,
  POST_SCENARIOS,
  scenarioLegacyCreativeDefaults,
  getScenariosForDealer,
} from "../services/postScenarios";
import { resolveCreative } from "../services/creativeSystem";
import { logEvent } from "../utils/telemetry";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { ProgressiveImage } from "./ui/ProgressiveImage";
import {
  DEFAULT_PLATFORM_IDS,
  getPrimaryImageProfile,
  getPlatformOptions,
  getSecondaryPlatformOptions,
  resolvePrimaryImageProfile,
  type PrimaryImageProfile,
  type PlatformId,
} from "../services/platformCopy";
import { toPublicCustomerLabel } from "../utils/customerIdentity";
import { captionUsesOnlyExpectedCustomer } from "../utils/captionQuality";
import {
  listWebsiteDestinations,
  type WebsiteDestination,
} from "../services/websitePublishing";
import {
  buildGenerationRequest,
  composeGenerationCreativeBrief,
  STYLE_AI_HINTS,
  PERSONAL_LINE_MAX,
} from "../services/generationRequest";

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
      decodedVehicle?: DecodedVehicle;
      /** Dealership Playful style requested for a second image (spec §4.2). */
      playfulStyleId?: string;
      /** The personal line as typed, carried back (in memory) by a Cancel or failed attempt. */
      personalLine?: string;
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

// Style descriptions. Icons are lucide components (not emoji) so they render
// identically across OS/browser, sit on the baseline, and share one stroke weight.
// aiHint values live in services/generationRequest.ts as STYLE_AI_HINTS (moved
// there in PR2-0 unit U01, since buildGenerationRequest needs them and the
// picker copy here must stay byte-identical to what it sends).
const STYLE_INFO: Record<
  StyleOption,
  { icon: LucideIcon; desc: string; detail: string; aiHint: string }
> = {
  [StyleOption.Luxury]: {
    icon: Gem,
    desc: "Elegant & refined",
    detail: "Premium grade · real photo stays · clean type",
    aiHint: STYLE_AI_HINTS[StyleOption.Luxury],
  },
  [StyleOption.Modern]: {
    icon: Zap,
    desc: "Bold & futuristic",
    detail: "High contrast · sharp sans · subtle overlays",
    aiHint: STYLE_AI_HINTS[StyleOption.Modern],
  },
  [StyleOption.Friendly]: {
    icon: PartyPopper,
    desc: "Warm & playful",
    detail: "Bright · welcoming · community energy",
    aiHint: STYLE_AI_HINTS[StyleOption.Friendly],
  },
  [StyleOption.Sporty]: {
    icon: Gauge,
    desc: "Dynamic & energetic",
    detail: "Bold type · athletic energy · same car",
    aiHint: STYLE_AI_HINTS[StyleOption.Sporty],
  },
  [StyleOption.DepthPop]: {
    icon: Layers,
    desc: "3D depth pop",
    detail: "Headline behind the car · subject glow · thumbnail energy",
    aiHint: STYLE_AI_HINTS[StyleOption.DepthPop],
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

/**
 * One optional yes/no capability (Add video, Playful). The creative system
 * replaces multi-choice option grids with these, so the salesperson screen
 * never grows a fourth mandatory decision.
 */
const CapabilityToggle: React.FC<{
  label: string;
  hint: string;
  icon: LucideIcon;
  pressed: boolean;
  onToggle: () => void;
}> = ({ label, hint, icon: Icon, pressed, onToggle }) => (
  <button
    type="button"
    aria-pressed={pressed}
    onClick={() => {
      triggerHapticFeedback();
      onToggle();
    }}
    className={cn(
      "flex min-h-11 w-full items-center gap-3 rounded-sm border px-3 py-2.5 text-left transition-colors duration-120 ease-out",
      pressed
        ? "border-brand-fill bg-brand-fill text-brand-foreground"
        : "border-hairline bg-panel text-ink hover:bg-fill-subtle",
    )}
  >
    <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
    <span className="min-w-0 flex-1">
      <span className="block text-sm font-semibold">{label}</span>
      <span
        className={cn(
          "mt-0.5 block text-2xs font-medium leading-relaxed",
          pressed ? "text-brand-foreground/80" : "text-ink-2",
        )}
      >
        {hint}
      </span>
    </span>
    {pressed ? (
      <Check className="h-4 w-4 shrink-0" strokeWidth={3} aria-hidden="true" />
    ) : null}
  </button>
);

// composeGenerationCreativeBrief moved to services/generationRequest.ts in
// PR2-0 unit U01. Re-exported here (import above) so existing imports of it
// from this module — __tests__/PostCustomizer.test.tsx among them — keep
// working unchanged.
export { composeGenerationCreativeBrief };

export const PostCustomizer: React.FC<PostCustomizerProps> = ({
  imageSrc,
  onGenerate,
  onBack,
  dealershipName,
  defaultStyle,
  defaultTone,
  onStyleToneChange,
  isGenerating = false,
  initialGenerationParams,
}) => {
  const currentDealer = useAppStore((s) => s.currentDealer);
  const currentPerson = useAppStore((s) => s.currentPerson);
  // The in-memory half of the Details draft. When Create post starts,
  // useGeneration puts the signed release and the personal line as typed on the
  // store's generationParams; the seed the parent passes carries only the
  // storable choices. A Cancel or a failed attempt remounts this screen, and the
  // initializers below take both back from here, once. utils/persistence.ts
  // stores neither, so a restored session never carries them.
  const carriedRelease = useAppStore((s) => s.generationParams?.capturedRelease);
  const carriedPersonalLine = useAppStore((s) => s.generationParams?.personalLine);
  // Each customizer section is a labelled group of controls, not a form field.
  // A bare <label> with no `for` announces nothing, so the section headings are
  // plain text nodes wired to a role="group" wrapper by id.
  const groupId = useId();
  const typeGroupId = `${groupId}-post-type`;
  const whoGroupId = `${groupId}-who`;
  const vehicleGroupId = `${groupId}-vehicle`;
  const releaseGroupId = `${groupId}-release`;
  const styleGroupId = `${groupId}-style`;
  const destinationGroupId = `${groupId}-destinations`;
  const toneGroupId = `${groupId}-tone`;
  const captionGroupId = `${groupId}-caption`;
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
      allowedPhrases: [
        dealershipName,
        currentDealer?.oem_affiliation,
        [
          initialGenerationParams?.decodedVehicle?.year,
          initialGenerationParams?.decodedVehicle?.make,
          initialGenerationParams?.decodedVehicle?.model,
          initialGenerationParams?.decodedVehicle?.trim,
        ]
          .filter(Boolean)
          .join(" "),
      ],
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
  // Restored so a scanned VIN survives the remount a failed generation
  // attempt sends this screen through (every AppStep transition is a keyed
  // remount — see PageTransition) — without this, a successfully decoded
  // vehicle silently vanished on retry while every other field restored.
  // Guarded against the restored scenario itself not expecting a vehicle
  // (mirrors handleScenarioChange's live-switch clear below): otherwise a
  // stale vehicle from before a scenario switch could restore alongside a
  // now-hidden Vehicle section with no way to notice or remove it.
  const [decodedVehicle, setDecodedVehicle] = useState<DecodedVehicle | null>(() => {
    const restored = initialGenerationParams?.decodedVehicle;
    if (!restored) return null;
    const restoredScenario = getScenariosForDealer(
      currentDealer?.custom_scenarios,
    ).find((scenario) => scenario.id === initialGenerationParams?.scenarioId);
    return restoredScenario?.requiresVehicle === false ? null : restored;
  });
  const [releaseModalOpen, setReleaseModalOpen] = useState(false);
  const [releaseValidationError, setReleaseValidationError] = useState(false);
  const [captionIdentityError, setCaptionIdentityError] = useState(
    restoredCustomText && !restoredCustomTextIsSafe
      ? "A saved caption contained a different customer name, so it was quarantined. Generate a fresh caption or write a corrected one."
      : "",
  );
  // Captured signature stays local until Generate. useGeneration durably saves
  // it before the customer photo is sent to an AI provider, then links that
  // same protected record to the created post. A Cancel or a failed attempt
  // hands it back (in memory only; a restored session never carries one) so
  // the retry needs no new signature, but only while it has never been linked
  // to a post: a signed release is single-use (amendments A1). Only alongside
  // a seed: a new post (no seed) never inherits a signature.
  const [capturedRelease, setCapturedRelease] = useState<CapturedRelease | null>(() => {
    if (!initialGenerationParams) return null;
    const carried = initialGenerationParams.capturedRelease ?? carriedRelease;
    return carried && !isReleaseAlreadyLinked(carried) ? carried : null;
  });
  // Creative-system-only controls. They render nothing while the dealership has
  // not opted in, so a legacy dealer sees exactly today's screen.
  const [addVideo, setAddVideo] = useState(() => {
    const restoredMode = initialGenerationParams?.mediaOutputMode;
    return restoredMode === "video" || restoredMode === "both";
  });
  const [playfulRequested, setPlayfulRequested] = useState(false);
  // Handed back verbatim, in memory only, on the same remount as the release.
  const [personalLine, setPersonalLine] = useState(() => {
    if (!initialGenerationParams) return "";
    const carried = initialGenerationParams.personalLine ?? carriedPersonalLine;
    return typeof carried === "string" ? carried : "";
  });

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

  // RESOLVE ONCE. Every creative-system branch below keys off `resolved`.
  //
  // Safety property (services/creativeSystem.ts): for a dealership that has not
  // set `creative_system_v2`, this returns `enabled: false`, the style/tone the
  // screen already computed, empty `platformIds`/`formatIds` (prescribes
  // nothing) and every permission `true` (restricts nothing). So each
  // `resolved.enabled` guard below collapses to today's exact behavior.
  const resolved = useMemo(
    () =>
      resolveCreative({
        dealer: currentDealer ?? null,
        scenarioId,
        fallbackStyle: style,
        fallbackTone: tone,
      }),
    [currentDealer, scenarioId, style, tone],
  );
  const creativeEnabled = resolved.enabled;
  // Joined keys keep the derived memos below stable across renders: the
  // resolver returns fresh arrays every call.
  const prescribedPlatformKey = resolved.platformIds.join("|");
  const prescribedFormatKey = resolved.formatIds.join("|");

  // Destinations and canvases come from the category once the system is on
  // (spec §4.4). While it is off both fall through to the existing pickers.
  const effectivePlatformIds = useMemo<PlatformId[]>(
    () =>
      creativeEnabled
        ? prescribedPlatformKey
          ? prescribedPlatformKey.split("|")
          : []
        : selectedPlatforms,
    [creativeEnabled, prescribedPlatformKey, selectedPlatforms],
  );
  const effectiveImageProfile = useMemo(() => {
    if (!creativeEnabled) return primaryImageProfile;
    const prescribed = (prescribedFormatKey ? prescribedFormatKey.split("|") : []).find(
      isPrimaryImageFormatId,
    );
    return prescribed
      ? getPrimaryImageProfile(prescribed)
      : resolvePrimaryImageProfile(effectivePlatformIds);
  }, [creativeEnabled, prescribedFormatKey, effectivePlatformIds, primaryImageProfile]);
  const destinationSummary = useMemo(() => {
    const labels = effectivePlatformIds.map(
      (id) => platformOptions.find((option) => option.id === id)?.label || id,
    );
    return labels.join(" · ");
  }, [effectivePlatformIds, platformOptions]);
  const videoOffered = creativeEnabled && resolved.videoAllowed;
  const playfulOffered =
    creativeEnabled && resolved.playfulAllowed && Boolean(resolved.playfulStyleId);
  // "Add video" collapses the old Photo/Video/Both matrix to one yes/no.
  const effectiveMediaMode: MediaOutputMode = creativeEnabled
    ? videoOffered && addVideo
      ? "both"
      : "photo"
    : mediaOutputMode;

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
  //
  // Under the creative system a scenario is a content template only:
  // `scenarioLegacyCreativeDefaults` returns null, so the Look keeps style and
  // tone and the three-authority conflict cannot reappear (spec §4.1).
  const handleScenarioChange = useCallback(
    (s: PostScenario | undefined) => {
      if (!s) return;
      setScenarioId(s.id);
      // A scenario that doesn't expect a vehicle also hides the Vehicle
      // section entirely (below) — clear any already-decoded vehicle from a
      // prior scenario selection along with it, or it would keep silently
      // grounding the creative brief with no on-screen control left to
      // notice or remove it.
      if (!s.requiresVehicle) {
        setDecodedVehicle(null);
      }
      const legacyDefaults = scenarioLegacyCreativeDefaults(s, creativeEnabled);
      if (!legacyDefaults) return;
      if (allowedStyles.includes(legacyDefaults.style)) {
        setStyle(legacyDefaults.style);
      }
      setTone(legacyDefaults.tone);
    },
    [allowedStyles, creativeEnabled],
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

    // Guard + brief assembly moved to services/generationRequest.ts
    // (PR2-0 unit U01) — buildGenerationRequest is the same body, byte-for-
    // byte, as this used to be. This callback keeps ownership of every side
    // effect (release/caption error state, the customizer.decisions
    // telemetry call per amendments B6, and calling onGenerate).
    const result = buildGenerationRequest({
      dealershipName,
      currentDealer,
      scenarioId,
      decodedVehicle,
      capturedRelease,
      releaseAlreadyLinked: isReleaseAlreadyLinked(capturedRelease),
      customerName,
      personalLine,
      creativeEnabled,
      resolvedStyle: resolved.style,
      resolvedTone: resolved.tone,
      playfulOffered,
      playfulRequested,
      playfulStyleId: resolved.playfulStyleId,
      captionSource,
      customMessage,
      effectivePlatformIds,
      websiteSelected,
      effectiveImageProfile,
      effectiveMediaMode,
    });

    if (!result.ok) {
      if (result.reason === "no_destination") return;
      if (result.reason === "release_required") {
        // A1: a release already linked to another post backs nothing; drop it
        // so the screen never claims a spent signature is captured.
        if (result.detail === "release_already_used") setCapturedRelease(null);
        setReleaseValidationError(true);
        setReleaseModalOpen(true);
        return;
      }
      if (result.reason === "release_mismatch") {
        // A signature is authority for one exact customer/vehicle pair. If
        // restored or stale UI state ever diverges, discard it before any
        // provider request and require a fresh acknowledgement.
        setCapturedRelease(null);
        setReleaseValidationError(true);
        setReleaseModalOpen(true);
        return;
      }
      // identity: the release checks already passed to reach this branch.
      setReleaseValidationError(false);
      setCaptionIdentityError(result.message || "");
      return;
    }

    setReleaseValidationError(false);

    // Spec §10: instrument the mandatory decision count so the ≤ 5-decision
    // goal is measurable rather than asserted.
    const trimmedPersonalLine = creativeEnabled
      ? personalLine.trim().slice(0, PERSONAL_LINE_MAX)
      : "";

    // Review finding: only clear a previously-shown identity error when an
    // identity check actually ran and passed on this Generate tap — the same
    // two paths buildGenerationRequest itself identity-checks (a non-empty
    // creative-mode personal line, or the legacy
    // !creativeEnabled && captionSource==='custom' && customMessage.trim()
    // path). The old handleGenerate left a stale error alone when neither ran
    // (e.g. a restored session whose saved caption was quarantined, mounted
    // with captionIdentityError set, captionSource 'ai' and an empty
    // customMessage) — clearing it unconditionally here would make that alert
    // vanish on a Generate tap that never re-validated identity.
    if (
      trimmedPersonalLine ||
      (!creativeEnabled && captionSource === "custom" && customMessage.trim())
    ) {
      setCaptionIdentityError("");
    }

    logEvent("customizer.decisions", {
      creativeSystem: creativeEnabled,
      look: resolved.look,
      addVideo: creativeEnabled ? videoOffered && addVideo : undefined,
      playful: creativeEnabled ? playfulOffered && playfulRequested : undefined,
      personalLine: creativeEnabled ? Boolean(trimmedPersonalLine) : undefined,
    });

    setIsSubmitting(true);
    try {
      await onGenerate(
        result.args.style,
        result.args.tone,
        result.args.customerName,
        result.args.customText,
        result.args.creativeBrief,
        // The typed line already rides in the brief. This copy only lets a
        // Cancel or a failed attempt hand it back to Details (in memory).
        trimmedPersonalLine ? { ...result.args.meta, personalLine } : result.args.meta,
        result.args.platformIds,
        result.args.outputProfile,
        result.args.mediaOutputMode,
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [
    addVideo,
    captionSource,
    creativeEnabled,
    resolved,
    customerName,
    customMessage,
    decodedVehicle,
    capturedRelease,
    currentDealer,
    personalLine,
    playfulOffered,
    playfulRequested,
    scenarioId,
    scenarioNeedsCustomerRelease,
    effectivePlatformIds,
    effectiveImageProfile,
    effectiveMediaMode,
    videoOffered,
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
    <div className="w-full pb-28 sm:pb-2">
      <div className="mx-auto w-full max-w-[45rem] px-4 pt-2 sm:px-0">
        {/* Photo strip: the print, what it is, and the way back to Capture.
            This replaces the desktop photo-stage panel; the change-photo
            action it carried lives here for every layout. */}
        <div className="space-y-4">
          <h2 className="font-display text-2xl font-semibold text-ink">Post details</h2>
          <div className="flex items-center gap-3 border-b border-hairline pb-5">
            <div className="print h-14 w-14 shrink-0 overflow-hidden rounded-sm">
              <ProgressiveImage
                src={imageSrc}
                alt="Selected post photo"
                className="h-full w-full object-cover"
              />
            </div>
            <p className="min-w-0 flex-1 truncate text-sm text-ink-2">
              {activeScenario.label}
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                triggerHapticFeedback();
                onBack();
              }}
              className="shrink-0"
            >
              Change photo
            </Button>
          </div>
        </div>

        <div className="space-y-8 pt-8">
          {/* What kind of post — scenario drives prompt context + defaults. */}
          <div className="space-y-3" role="group" aria-labelledby={typeGroupId}>
            <h3 id={typeGroupId} className="text-lg font-semibold text-ink">
              What kind of post
            </h3>
            <ScenarioPicker
              value={scenarioId}
              onChange={handleScenarioChange}
              categoryFirst={creativeEnabled}
            />
          </div>

          {/* Who and what — the person posting, the customer, the vehicle and
              the signed release that governs all three. */}
          <div className="space-y-4" role="group" aria-labelledby={whoGroupId}>
            <h3 id={whoGroupId} className="text-lg font-semibold text-ink">
              Who and what
            </h3>

            <div
              className="flex items-center gap-3 rounded-md border border-hairline bg-panel px-3 py-2.5"
              aria-label={`Posting as ${currentPerson?.name || "signed-in team member"}`}
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-sm border border-hairline bg-panel-raised text-ink-2">
                <Users className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-caption text-ink-2">Posting as</p>
                <p className="truncate text-sm font-semibold text-ink">
                  {currentPerson?.name || "Signed-in team member"}
                </p>
              </div>
              <Badge variant="success" size="sm" className="shrink-0">
                Verified
              </Badge>
            </div>

            {/* The customer's first name is the only identity social copy ever
                sees; the release holds the legal name. */}
            <Input
              label="Customer first name"
              value={customerName}
              onChange={(e) => handleCustomerNameChange(e.target.value)}
              aria-required={scenarioNeedsCustomerRelease || undefined}
              disabled={Boolean(capturedRelease)}
              helperText={
                capturedRelease
                  ? "Remove or replace the signed release to change this identity."
                  : undefined
              }
              fullWidth
            />

            {/* VIN Scanner — show pill if vehicle decoded, otherwise show CTA.
                Hidden entirely for scenarios that don't expect a vehicle in
                the photo (Service Promotion, Community Event, Team
                Anniversary) — offering it there was pure clutter, not a
                functional gap: an already-decoded vehicle still grounds the
                brief if the salesperson scanned one before switching post
                types. */}
            {activeScenario.requiresVehicle && (
              <div className="space-y-2" role="group" aria-labelledby={vehicleGroupId}>
                <span
                  id={vehicleGroupId}
                  className="block text-sm font-medium text-ink-2"
                >
                  Vehicle
                </span>
                {decodedVehicle && !decodedVehicle.empty ? (
                  <div className="flex items-start gap-3 rounded-md border border-hairline bg-panel-raised px-3 py-2.5">
                    <Car
                      className="mt-0.5 h-4 w-4 flex-shrink-0 text-ink-2"
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-ink">
                        {decodedVehicle.summary}
                      </div>
                      <div className="truncate font-mono text-2xs text-ink-hint">
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
                      className="-mr-2 -my-1 grid h-11 w-11 shrink-0 place-items-center rounded-sm text-ink-2 transition-colors duration-120 ease-out hover:bg-fill-subtle hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                ) : (
                  <>
                    <Button
                      variant="secondary"
                      size="md"
                      leftIcon={<ScanLine className="h-4 w-4" />}
                      onClick={() => {
                        triggerHapticFeedback();
                        setVinScannerOpen(true);
                      }}
                      fullWidth
                      disabled={Boolean(capturedRelease)}
                    >
                      Scan VIN
                    </Button>
                    <p className="text-caption text-ink-hint">
                      Optional. Adds the exact model to the caption.
                    </p>
                  </>
                )}
              </div>
            )}

            {/* Photo release — capture customer's signed consent before posting their photo */}
            <div className="space-y-2" role="group" aria-labelledby={releaseGroupId}>
              <span className="flex items-center gap-2 text-sm font-medium text-ink-2">
                <span id={releaseGroupId}>Photo release</span>
                <Badge
                  variant={scenarioNeedsCustomerRelease ? "warning" : "neutral"}
                  uppercase={false}
                >
                  {scenarioNeedsCustomerRelease ? "Required" : "Optional"}
                </Badge>
              </span>
              {capturedRelease ? (
                <div className="flex items-start gap-3 rounded-md border border-hairline bg-panel-raised px-3 py-2.5">
                  <ShieldCheck
                    className="mt-0.5 h-4 w-4 flex-shrink-0 text-ink-2"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-ink">
                      Release captured for
                      {toPublicCustomerLabel(capturedRelease.customerName)
                        ? ` ${toPublicCustomerLabel(capturedRelease.customerName)}`
                        : " this customer"}
                    </div>
                    <div className="text-2xs text-ink-hint">
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
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-sm border border-strong px-3 text-2xs font-semibold text-ink transition-colors duration-120 ease-out hover:bg-fill-subtle"
                    >
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                      Replace
                    </button>
                    <button
                      type="button"
                      aria-label="Remove captured release"
                      onClick={() => setCapturedRelease(null)}
                      className="grid h-11 w-11 place-items-center rounded-sm border border-strong text-ink transition-colors duration-120 ease-out hover:bg-fill-subtle"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="secondary"
                  size="md"
                  leftIcon={<ShieldCheck className="h-4 w-4" />}
                  onClick={() => {
                    triggerHapticFeedback();
                    setReleaseModalOpen(true);
                  }}
                  fullWidth
                  disabled={!currentDealer}
                >
                  Capture customer release
                </Button>
              )}
              {releaseValidationError && !capturedRelease ? (
                <p
                  className="rounded-sm border border-error-ink/40 bg-error-fill px-3 py-2 text-caption font-medium text-error-ink"
                  role="alert"
                >
                  This customer-focused post needs a signed photo release before the
                  photo can be sent for AI processing.
                </p>
              ) : null}
            </div>
          </div>

          {/* Look — the design style. Hidden (never deleted) once the Look
              owns the image treatment (spec §4.1). */}
          <div
            className="space-y-3"
            role="group"
            aria-labelledby={styleGroupId}
            hidden={creativeEnabled}
          >
            <h3 id={styleGroupId} className="text-lg font-semibold text-ink">
              Look
            </h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {allowedStyles.map((option) => {
                const info = STYLE_INFO[option];
                const isActive = option === style;
                return (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => {
                      triggerHapticFeedback();
                      setStyle(option);
                    }}
                    className={cn(
                      "flex min-h-11 items-start gap-2 rounded-sm border px-3 py-3 text-left transition-colors duration-120 ease-out",
                      isActive
                        ? "border-brand-fill bg-brand-fill text-brand-foreground"
                        : "border-hairline bg-panel text-ink hover:bg-fill-subtle",
                    )}
                  >
                    <info.icon
                      className="mt-0.5 h-5 w-5 flex-shrink-0"
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {option.split(" ")[0]}
                      </span>
                      <span
                        className={cn(
                          "mt-0.5 block text-2xs font-medium leading-snug",
                          isActive ? "text-brand-foreground/80" : "text-ink-2",
                        )}
                      >
                        {info.desc}
                      </span>
                      <span
                        className={cn(
                          "mt-0.5 block text-2xs font-medium leading-snug",
                          isActive ? "text-brand-foreground/80" : "text-ink-2",
                        )}
                      >
                        {info.detail}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Where it goes — drives caption length + export bias */}
          <div className="space-y-3" role="group" aria-labelledby={destinationGroupId}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 id={destinationGroupId} className="text-lg font-semibold text-ink">
                Where it goes
              </h3>
              <span className="text-caption text-ink-hint">
                {creativeEnabled ? "Set by your category" : "Pick all that apply"}
              </span>
            </div>
            {/* Prescribed destinations + canvases replace the chips, the
                "More platforms" accordion, and the size grid (spec §4.4). */}
            {creativeEnabled ? (
              <p className="rounded-md border border-hairline bg-panel px-3 py-2.5 text-sm leading-relaxed text-ink-2">
                {destinationSummary || "No social destinations for this category."}
                <span className="mt-0.5 block text-caption text-ink-hint">
                  {effectiveImageProfile.label} master · every destination still gets
                  its own exact file.
                </span>
              </p>
            ) : null}
            {/* Conditionally rendered rather than [hidden]: .mobile-h-scroll
                declares `display: flex` later in the base layer than
                Preflight's `[hidden]` rule at equal specificity, so the
                attribute alone would leave these chips on screen. */}
            {creativeEnabled ? null : (
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
                        "min-h-11 shrink-0 snap-start rounded-full border px-4 py-2 text-left transition-colors duration-120 ease-out",
                        on
                          ? "border-brand-fill bg-brand-fill text-brand-foreground"
                          : "border-hairline bg-panel text-ink hover:bg-fill-subtle",
                      )}
                    >
                      <span className="flex items-center gap-1.5 text-sm font-semibold">
                        {on ? (
                          <Check
                            className="h-3.5 w-3.5 shrink-0"
                            strokeWidth={3}
                            aria-hidden="true"
                          />
                        ) : null}
                        {p.shortLabel}
                      </span>
                      <span
                        className={cn(
                          "block text-2xs font-medium leading-tight",
                          on ? "text-brand-foreground/80" : "text-ink-2",
                        )}
                      >
                        {p.verticalPreferred ? "9:16 story-ready" : "Feed"}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
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
                "flex min-h-11 w-full items-center gap-3 rounded-sm border px-3 py-2.5 text-left transition-colors duration-120 ease-out",
                websiteSelected
                  ? "border-brand-fill bg-brand-fill text-brand-foreground"
                  : "border-hairline bg-panel text-ink hover:bg-fill-subtle",
                websiteAvailability !== "ready" &&
                  "cursor-not-allowed opacity-60 hover:bg-panel",
              )}
            >
              <Globe2 className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">Website</span>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-medium",
                      websiteSelected ? "border-current" : "border-hairline text-ink-2",
                    )}
                  >
                    <LockKeyhole className="h-2.5 w-2.5" aria-hidden="true" />
                    Draft only
                  </span>
                </span>
                <span
                  id="website-destination-description"
                  className={cn(
                    "mt-0.5 block text-2xs font-medium leading-relaxed",
                    websiteSelected ? "text-brand-foreground/80" : "text-ink-2",
                  )}
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
                <Check
                  className="h-4 w-4 shrink-0"
                  strokeWidth={3}
                  aria-hidden="true"
                />
              ) : null}
            </button>
            {/* Spec §4.3: the Photo/Video/Both matrix becomes one yes/no,
                and only for a category and a person allowed to use it. */}
            {videoOffered ? (
              <CapabilityToggle
                label="Add video"
                hint="9:16 · 6s · music on, in your dealership's motion style."
                icon={Film}
                pressed={addVideo}
                onToggle={() => setAddVideo((current) => !current)}
              />
            ) : null}
            {playfulOffered ? (
              <CapabilityToggle
                label="Make it playful"
                hint="Adds your dealership's Playful image beside the house-style master."
                icon={PartyPopper}
                pressed={playfulRequested}
                onToggle={() => setPlayfulRequested((current) => !current)}
              />
            ) : null}
            <div hidden={creativeEnabled}>
              <button
                type="button"
                aria-expanded={showMorePlatforms}
                aria-controls="secondary-platform-options"
                aria-label={`More platforms, ${selectedSecondaryCount} selected`}
                onClick={() => {
                  triggerHapticFeedback();
                  setShowMorePlatforms((current) => !current);
                }}
                className="flex min-h-11 w-full items-center justify-between gap-3 rounded-sm px-2 text-left text-ink-2 transition-colors duration-120 ease-out hover:bg-fill-subtle hover:text-ink"
              >
                <span>
                  <span className="block text-sm font-medium">More platforms</span>
                  <span className="block text-2xs font-medium text-ink-2">
                    Reels, Marketplace, LinkedIn, X, and device share
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {selectedSecondaryCount > 0 ? (
                    <span className="rounded-full border border-hairline px-2 py-0.5 text-2xs font-medium text-ink-2">
                      {selectedSecondaryCount} selected
                    </span>
                  ) : null}
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 transition-transform duration-120 ease-out",
                      showMorePlatforms && "rotate-180",
                    )}
                    aria-hidden="true"
                  />
                </span>
              </button>
              {showMorePlatforms ? (
                <div
                  id="secondary-platform-options"
                  className="grid grid-cols-2 gap-2 pt-2 sm:grid-cols-3 xl:grid-cols-5"
                >
                  {secondaryPlatformOptions.map((platform) => {
                    const selected = selectedPlatforms.includes(platform.id);
                    return (
                      <button
                        key={platform.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => togglePlatform(platform.id)}
                        className={cn(
                          "min-h-11 rounded-sm border px-2.5 py-2 text-left transition-colors duration-120 ease-out",
                          selected
                            ? "border-brand-fill bg-brand-fill text-brand-foreground"
                            : "border-hairline bg-panel text-ink hover:bg-fill-subtle",
                        )}
                      >
                        <span className="flex items-center gap-1.5 text-2xs font-semibold">
                          {selected ? (
                            <Check
                              className="h-3 w-3 shrink-0"
                              strokeWidth={3}
                              aria-hidden="true"
                            />
                          ) : null}
                          {platform.shortLabel}
                        </span>
                        <span
                          className={cn(
                            "mt-1 line-clamp-2 block text-2xs font-medium leading-snug",
                            selected ? "text-brand-foreground/80" : "text-ink-2",
                          )}
                        >
                          {platform.hint}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
            <fieldset className="space-y-2" hidden={creativeEnabled}>
              <legend className="sr-only">Media to create for each destination</legend>
              <div className="grid grid-cols-3 gap-2">
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
                        "min-h-11 rounded-sm border px-2 py-2 text-left transition-colors duration-120 ease-out",
                        selected
                          ? "border-brand-fill bg-brand-fill text-brand-foreground"
                          : "border-hairline bg-panel text-ink hover:bg-fill-subtle",
                      )}
                    >
                      <span className="flex items-center gap-1.5 text-2xs font-semibold">
                        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                        {label}
                      </span>
                      <span
                        className={cn(
                          "mt-0.5 block text-2xs font-medium leading-tight",
                          selected ? "text-brand-foreground/80" : "text-ink-2",
                        )}
                      >
                        {hint}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-caption leading-relaxed text-ink-hint">
                {mediaOutputMode === "photo"
                  ? "Creates one exact, unstretched image file for every selected destination."
                  : mediaOutputMode === "video"
                    ? "Creates the protected photo master first, then guides you through the supported video ratios."
                    : "Creates the exact photo set and a video-ready delivery plan without hiding extra paid renders."}
              </p>
            </fieldset>
            <fieldset className="space-y-2" hidden={creativeEnabled}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <legend className="text-sm font-medium text-ink-2">
                    Main image size
                  </legend>
                  <p className="mt-0.5 text-caption text-ink-hint">
                    This is the first composition. Every destination still gets its own
                    exact file in the delivery board.
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
                    "min-h-11 shrink-0 rounded-sm border px-3 text-sm font-semibold transition-colors duration-120 ease-out",
                    primaryFormatOverride === null
                      ? "border-brand-fill bg-brand-fill text-brand-foreground"
                      : "border-hairline bg-panel text-ink hover:bg-fill-subtle",
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
                        "min-h-11 rounded-sm border px-2 py-1.5 text-left transition-colors duration-120 ease-out",
                        selected
                          ? "border-brand-fill bg-brand-fill text-brand-foreground"
                          : "border-hairline bg-panel text-ink hover:bg-fill-subtle",
                      )}
                    >
                      <span className="block text-2xs font-semibold leading-tight">
                        {format.label}
                      </span>
                      <span
                        className={cn(
                          "mt-0.5 block text-2xs font-medium tabular-nums",
                          selected ? "text-brand-foreground/80" : "text-ink-2",
                        )}
                      >
                        {format.size}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p
                className="text-caption leading-relaxed text-ink-hint"
                aria-live="polite"
              >
                {primaryFormatOverride
                  ? `${primaryImageProfile.label} selected as the starting composition. Destination files remain independent.`
                  : `${suggestedImageProfile.label} recommended from your destinations. Choose a starting composition above only when needed.`}
              </p>
            </fieldset>
          </div>

          {/* Spec §4.5: one optional appended line replaces "Write my own"
              and the 10 templates for a creative-system dealership. */}
          {creativeEnabled ? (
            <div className="space-y-2">
              <Textarea
                label="Add a personal line (optional)"
                value={personalLine}
                onChange={(e) => {
                  setPersonalLine(e.target.value.slice(0, PERSONAL_LINE_MAX));
                  setCaptionIdentityError("");
                }}
                rows={2}
                maxLength={PERSONAL_LINE_MAX}
                helperText={`Appended after the caption — never replaces it. ${
                  PERSONAL_LINE_MAX - personalLine.length
                } characters left.`}
                fullWidth
              />
              {captionIdentityError ? (
                <p className="text-caption font-medium text-error-ink" role="alert">
                  {captionIdentityError}
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Caption — tone, who writes it, and the copy itself. */}
          <div
            className="space-y-4"
            role="group"
            aria-labelledby={captionGroupId}
            hidden={creativeEnabled}
          >
            <h3 id={captionGroupId} className="text-lg font-semibold text-ink">
              Caption
            </h3>

            <div className="space-y-2" role="group" aria-labelledby={toneGroupId}>
              <span id={toneGroupId} className="block text-sm font-medium text-ink-2">
                Tone
              </span>
              <div className="mobile-h-scroll -mx-1 px-1 pb-2">
                {Object.values(ToneOption).map((option) => {
                  const info = TONE_INFO[option];
                  const isActive = option === tone;
                  return (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => {
                        triggerHapticFeedback();
                        setTone(option);
                      }}
                      className={cn(
                        "flex min-h-11 flex-shrink-0 snap-center items-center gap-1.5 whitespace-nowrap rounded-full border px-4 py-2 transition-colors duration-120 ease-out",
                        isActive
                          ? "border-brand-fill bg-brand-fill text-brand-foreground"
                          : "border-hairline bg-panel text-ink hover:bg-fill-subtle",
                      )}
                    >
                      <info.icon className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                      <span className="text-sm font-semibold">{option}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant={captionSource === "ai" ? "primary" : "secondary"}
                aria-pressed={captionSource === "ai"}
                size="md"
                onClick={() => {
                  triggerHapticFeedback();
                  setCaptionSource("ai");
                  setCaptionIdentityError("");
                }}
                className="flex-1"
              >
                Suggested caption
              </Button>
              <Button
                variant={captionSource === "custom" ? "primary" : "secondary"}
                aria-pressed={captionSource === "custom"}
                size="md"
                onClick={() => {
                  triggerHapticFeedback();
                  setCaptionSource("custom");
                }}
                className="flex-1"
              >
                Write my own
              </Button>
            </div>

            {captionSource === "custom" ? (
              <div>
                <Textarea
                  label="Your caption"
                  placeholder="Write your caption here..."
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
                  fullWidth
                />
                {captionIdentityError ? (
                  <p
                    className="mt-2 text-caption font-medium text-error-ink"
                    role="alert"
                  >
                    {captionIdentityError}
                  </p>
                ) : null}
              </div>
            ) : captionIdentityError ? (
              <p className="text-caption font-medium text-error-ink" role="alert">
                {captionIdentityError}
              </p>
            ) : null}

            {/* Advanced Options — the 10 templates and the instruction
                preview are salesperson-facing option sprawl, so they stay
                behind a disclosure. */}
            <div className="border-t border-hairline pt-3">
              <button
                type="button"
                aria-expanded={showAdvanced}
                aria-controls="advanced-post-options"
                onClick={() => {
                  triggerHapticFeedback();
                  setShowAdvanced(!showAdvanced);
                }}
                className="flex min-h-11 w-full items-center gap-2 rounded-sm px-2 text-sm font-medium text-ink-2 transition-colors duration-120 ease-out hover:bg-fill-subtle hover:text-ink"
              >
                <ChevronDown
                  className={cn(
                    "h-4 w-4 transition-transform duration-120 ease-out",
                    showAdvanced && "rotate-180",
                  )}
                  aria-hidden="true"
                />
                <span>Advanced options</span>
              </button>

              {showAdvanced ? (
                <div id="advanced-post-options" className="space-y-3 pt-3">
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

                  <div className="rounded-md border border-hairline bg-panel px-4 py-3">
                    <div className="mb-1.5 text-caption font-medium text-ink-2">
                      AI instruction
                    </div>
                    <p className="font-mono text-caption leading-relaxed text-ink-2">
                      <TypewriterText text={STYLE_INFO[style].aiHint} />
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Create — sticky above the home indicator on phones, inline on
          tablet and desktop. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-hairline bg-panel px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:static sm:mx-auto sm:mt-8 sm:max-w-[45rem] sm:border-0 sm:bg-transparent sm:p-0">
        <Button
          variant="primary"
          size="lg"
          loading={isBusy}
          onClick={handleGenerate}
          disabled={isBusy || (effectivePlatformIds.length === 0 && !websiteSelected)}
          aria-label={`Generate Post — ${
            effectiveMediaMode === "photo"
              ? "create photo outputs"
              : effectiveMediaMode === "video"
                ? "create video plan"
                : "create photo and video set"
          }`}
          fullWidth
        >
          {isBusy ? "Creating your post…" : "Create post"}
        </Button>
        {effectivePlatformIds.length === 0 && !websiteSelected ? (
          <p
            className="pt-2 text-center text-caption font-medium text-warning-ink"
            role="status"
          >
            Choose Website or at least one social destination.
          </p>
        ) : null}
      </div>

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
