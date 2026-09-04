import React, { useEffect, useMemo, useRef, useState } from "react";
import { m } from "framer-motion";
import {
  Settings,
  Users,
  Palette,
  Ban,
  Wand2,
  Trophy,
  LogOut,
  Loader2,
  Save,
  ShieldCheck,
  Pencil,
  Check,
  Copy,
  X,
} from "lucide-react";
import { PersonEditModal } from "./PersonEditModal";
import type { CredentialResult, Person } from "../services/salespeople";
import { Button } from "./ui/Button";
import { Input, Select, Textarea } from "./ui/Input";
import { Modal } from "./ui/Modal";
import { Leaderboard } from "./Leaderboard";
import { ApprovalQueue } from "./ApprovalQueue";
import { PostHistory } from "./PostHistory";
import { DealerSetupWizard } from "./DealerSetupWizard";
import { useAppStore } from "../stores/appStore";
import * as db from "../services/database";
import { cn } from "../utils/classNames";
import { toUiMessage } from "../utils/errorMessages";
import { triggerHapticFeedback } from "../utils/haptics";
import {
  StyleOption,
  ToneOption,
  VideoStyle,
  type ImageQualityTier,
  type LogoCorner,
  type LogoPlacement,
  type MotionAspect,
  type MotionAudio,
  type MotionSignature,
  type SignatureLook,
} from "../types";
import { featuredFunStyleCatalog } from "../services/promptConfig";
import {
  aspectRatios as motionAspectOptions,
  soundtracks as motionAudioOptions,
  styles as motionStyleOptions,
} from "./video-director/constants";
import { CustomScenarioManager } from "./CustomScenarioManager";
import { HoursPicker } from "./HoursPicker";
import {
  defaultWeekHours,
  parseHoursString,
  serializeHours,
  type WeekHours,
} from "../utils/hoursFormat";
import { getLeaderboard } from "../services/posts";
import { normalizeDealerSocialProfileValue } from "../utils/socialAttribution";
import { YouTubeConnectionCard } from "./YouTubeConnectionCard";

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

// ---------------------------------------------------------------------------
// Brand-consistent creative system (spec 2026-09-02 §4.1–§4.3, §6). Limits
// mirror pb_hooks/helpers.js so the form reports problems inline instead of
// surfacing a 400 after the round trip.
// ---------------------------------------------------------------------------
interface SignatureLookOption {
  id: SignatureLook;
  label: string;
  description: string;
  tone: ToneOption;
  motionStyle: VideoStyle;
}

export const SIGNATURE_LOOK_OPTIONS: readonly SignatureLookOption[] = [
  {
    id: "showroom",
    label: "Showroom",
    description:
      "Luxury image treatment, professional captions, clean type with the logo bottom-right.",
    tone: ToneOption.Professional,
    motionStyle: VideoStyle.GoldenRadiance,
  },
  {
    id: "hometown",
    label: "Hometown",
    description:
      "Friendly image treatment, family-friendly captions, warm headline over the photo.",
    tone: ToneOption.Family,
    motionStyle: VideoStyle.Spotlight,
  },
  {
    id: "turbo",
    label: "Turbo",
    description:
      "Sporty image treatment, excited captions, bold type with 3D Depth Pop allowed.",
    tone: ToneOption.Excited,
    motionStyle: VideoStyle.LiquidChrome,
  },
];

const LOGO_CORNER_OPTIONS: ReadonlyArray<{ id: LogoCorner; label: string }> = [
  { id: "top_left", label: "Top left" },
  { id: "top_right", label: "Top right" },
  { id: "bottom_left", label: "Bottom left" },
  { id: "bottom_right", label: "Bottom right" },
];
/** Logo width as a fraction of the canvas; mirrors LOGO_SCALE_MIN/MAX. */
const LOGO_SCALE_MIN = 0.04;
const LOGO_SCALE_MAX = 0.5;
const LOGO_SCALE_DEFAULT = 0.18;
const BRAND_VOICE_MAX_ITEMS = 3;
const BRAND_VOICE_MAX_CHARS = 60;
const MOTION_STYLE_MAX_CHARS = 40;
const DEFAULT_MOTION_ASPECTS: MotionAspect[] = ["9:16"];
const DEFAULT_MOTION_AUDIO: MotionAudio = "cinematic";

const isSignatureLook = (value: unknown): value is SignatureLook =>
  SIGNATURE_LOOK_OPTIONS.some((option) => option.id === value);

const isLogoCorner = (value: unknown): value is LogoCorner =>
  LOGO_CORNER_OPTIONS.some((option) => option.id === value);

const isMotionAspect = (value: unknown): value is MotionAspect =>
  motionAspectOptions.some((option) => option.value === value);

const isMotionAudio = (value: unknown): value is MotionAudio =>
  motionAudioOptions.some((option) => option.value === value);

const collapsePhrase = (value: string) => value.replace(/\s+/g, " ").trim();

interface PhraseChipEditorProps {
  /** Short noun used in every accessible name ("Do" → "Add do phrase"). */
  label: string;
  helperText: string;
  placeholder: string;
  phrases: string[];
  onChange: (next: string[]) => void;
}

/** Bounded chip list for the structured brand-voice do / don't phrases. */
const PhraseChipEditor: React.FC<PhraseChipEditorProps> = ({
  label,
  helperText,
  placeholder,
  phrases,
  onChange,
}) => {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const lowerLabel = label.toLowerCase();
  const full = phrases.length >= BRAND_VOICE_MAX_ITEMS;

  const add = () => {
    const phrase = collapsePhrase(draft);
    if (!phrase) return;
    if (phrase.length > BRAND_VOICE_MAX_CHARS) {
      setError(`Keep each phrase to ${BRAND_VOICE_MAX_CHARS} characters.`);
      return;
    }
    if (full) {
      setError(`Up to ${BRAND_VOICE_MAX_ITEMS} phrases.`);
      return;
    }
    if (phrases.some((existing) => existing.toLowerCase() === phrase.toLowerCase())) {
      setError("That phrase is already listed.");
      return;
    }
    onChange([...phrases, phrase]);
    setDraft("");
    setError(null);
  };

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-surface-200">{label}</div>
      <ul className="flex flex-wrap gap-1.5" aria-label={`${label} phrases`}>
        {phrases.length === 0 ? (
          <li className="text-[11px] text-surface-500">None yet</li>
        ) : (
          phrases.map((phrase) => (
            <li
              key={phrase}
              className="inline-flex items-center gap-1 rounded-full border border-hairline bg-fill-subtle px-2.5 py-1 text-xs text-surface-100"
            >
              <span>{phrase}</span>
              <button
                type="button"
                aria-label={`Remove ${lowerLabel} phrase ${phrase}`}
                onClick={() => {
                  onChange(phrases.filter((existing) => existing !== phrase));
                  setError(null);
                }}
                className="inline-flex h-5 w-5 items-center justify-center rounded-full text-surface-400 hover:bg-fill-hover hover:text-surface-100"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </li>
          ))
        )}
      </ul>
      <div className="flex items-start gap-2">
        <Input
          label=""
          aria-label={`${label} phrase`}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            add();
          }}
          maxLength={BRAND_VOICE_MAX_CHARS}
          placeholder={placeholder}
          disabled={full}
          error={error || undefined}
          helperText={full ? `All ${BRAND_VOICE_MAX_ITEMS} slots used` : helperText}
          fullWidth
          className="bg-fill-subtle border-hairline focus:border-primary-400"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11 shrink-0"
          disabled={full || !collapsePhrase(draft)}
          aria-label={`Add ${lowerLabel} phrase`}
          onClick={add}
        >
          Add
        </Button>
      </div>
    </div>
  );
};

/**
 * Per-dealership admin dashboard. The GSM/GM lands here when they log in
 * with their personal four-digit manager code.
 *
 * Scoped to their own dealership only — all the data on this screen
 * (leaderboard, approvals, history) is already filtered to the session
 * dealer by the /api/app/posts endpoint, so nothing leaks across tenants.
 *
 * Distinct from the super-admin AdminDashboard which manages MANY dealers
 * across the platform.
 */
type Tab = "overview" | "settings" | "team";

export const DealerAdminDashboard: React.FC = () => {
  const dealer = useAppStore((s) => s.currentDealer);
  const [tab, setTab] = useState<Tab>("overview");
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [pendingTab, setPendingTab] = useState<Tab | null>(null);
  const tabRefs = React.useRef<Record<Tab, HTMLButtonElement | null>>({
    overview: null,
    settings: null,
    team: null,
  });

  // First-time setup wizard surfaces if brand voice + color aren't set yet.
  const [wizardDismissed, setWizardDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return dealer
        ? localStorage.getItem(`dsp.dealerSetupDismissed.v1.${dealer.id}`) === "1"
        : false;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (!dealer || typeof window === "undefined") return;
    try {
      setWizardDismissed(
        localStorage.getItem(`dsp.dealerSetupDismissed.v1.${dealer.id}`) === "1",
      );
    } catch {
      setWizardDismissed(false);
    }
  }, [dealer?.id]);
  const showWizard =
    !wizardDismissed && dealer && (!dealer.brand_voice || !dealer.brand_color);

  useEffect(() => {
    if (!settingsDirty) return;
    const preventAccidentalUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventAccidentalUnload);
    return () => window.removeEventListener("beforeunload", preventAccidentalUnload);
  }, [settingsDirty]);

  if (!dealer) {
    return (
      <div className="p-8 text-center text-surface-300">
        <Loader2 className="w-6 h-6 animate-spin mx-auto" />
      </div>
    );
  }

  const handleWizardSave = async (fields: Record<string, string | boolean>) => {
    const fd = new FormData();
    Object.entries(fields).forEach(([k, v]) =>
      fd.append(k, typeof v === "boolean" ? (v ? "true" : "false") : v),
    );
    const updated = await db.updateDealerWithFile(dealer.id, fd);
    useAppStore.setState((s) => ({
      currentDealer: s.currentDealer
        ? { ...s.currentDealer, ...fields, ...updated }
        : s.currentDealer,
    }));
    return updated;
  };

  const requestTab = (nextTab: Tab) => {
    if (nextTab === tab) return;
    if (tab === "settings" && settingsDirty) {
      setPendingTab(nextTab);
      return;
    }
    setTab(nextTab);
  };

  const tabOrder: Tab[] = ["overview", "settings", "team"];
  const handleTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    currentTab: Tab,
  ) => {
    let nextIndex: number | null = null;
    const currentIndex = tabOrder.indexOf(currentTab);
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabOrder.length;
    if (event.key === "ArrowLeft")
      nextIndex = (currentIndex - 1 + tabOrder.length) % tabOrder.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabOrder.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = tabOrder[nextIndex];
    requestTab(nextTab);
    if (!(tab === "settings" && settingsDirty)) {
      requestAnimationFrame(() => tabRefs.current[nextTab]?.focus());
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-0 sm:space-y-6 sm:p-2 lg:p-4">
      {/* Header with dealership identity + role chip */}
      <m.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-wrap items-center justify-between gap-2 sm:gap-3"
      >
        <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
          {dealer.logo ? (
            <img
              src={dealer.logo}
              alt={`${dealer.name} logo`}
              className="h-10 w-10 shrink-0 rounded-xl object-contain bg-fill-hover p-1 ring-1 ring-hairline sm:h-12 sm:w-12"
            />
          ) : (
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg font-bold text-white shadow-lg sm:h-12 sm:w-12 sm:text-xl"
              style={{ background: "var(--brand-primary)" }}
            >
              {dealer.name.charAt(0)}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold text-surface-50 sm:text-xl">
              {dealer.name}
            </h1>
            <div className="flex items-center gap-2 text-[11px] text-surface-400">
              <ShieldCheck className="h-3 w-3 text-success-300" />
              Manager dashboard
            </div>
          </div>
        </div>
      </m.div>

      {showWizard && (
        <DealerSetupWizard
          dealer={dealer}
          onSave={handleWizardSave}
          onDismiss={() => {
            setWizardDismissed(true);
            try {
              localStorage.setItem(`dsp.dealerSetupDismissed.v1.${dealer.id}`, "1");
            } catch {
              /* ignore */
            }
          }}
        />
      )}

      {/* Tabs — sticky on mobile so managers can switch without scrolling up */}
      <div className="sticky top-0 z-20 -mx-0 bg-surface-950/90 py-1 backdrop-blur-md sm:static sm:bg-transparent sm:py-0 sm:backdrop-blur-none">
        <div
          role="tablist"
          aria-label="Manager dashboard"
          className="flex w-full gap-1 rounded-xl border border-surface-800 bg-surface-950/60 p-1 sm:inline-flex sm:w-auto"
        >
          {(
            [
              { key: "overview", label: "Overview", icon: Trophy },
              { key: "settings", label: "Settings", icon: Settings },
              { key: "team", label: "Team", icon: Users },
            ] as Array<{ key: Tab; label: string; icon: typeof Trophy }>
          ).map((t) => {
            const Icon = t.icon;
            return (
              <button
                ref={(element) => {
                  tabRefs.current[t.key] = element;
                }}
                key={t.key}
                id={`manager-tab-${t.key}`}
                role="tab"
                type="button"
                aria-selected={tab === t.key}
                aria-controls={`manager-panel-${t.key}`}
                tabIndex={tab === t.key ? 0 : -1}
                onClick={() => {
                  triggerHapticFeedback();
                  requestTab(t.key);
                }}
                onKeyDown={(event) => handleTabKeyDown(event, t.key)}
                className={cn(
                  "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors sm:min-h-0 sm:flex-none sm:gap-2 sm:px-4",
                  tab === t.key
                    ? "bg-primary-500/30 text-primary-100"
                    : "text-surface-400 hover:text-surface-200",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {tab === "overview" && (
        <div
          id="manager-panel-overview"
          role="tabpanel"
          aria-labelledby="manager-tab-overview"
          className="space-y-4 sm:space-y-6"
        >
          <Leaderboard />
          <ApprovalQueue />
          <PostHistory />
        </div>
      )}

      {tab === "settings" && (
        <div
          id="manager-panel-settings"
          role="tabpanel"
          aria-labelledby="manager-tab-settings"
          className="space-y-4 sm:space-y-6"
        >
          <DealerSettingsCard
            dealer={dealer}
            onSaved={handleWizardSave}
            onDirtyChange={setSettingsDirty}
          />
          <YouTubeConnectionCard />
        </div>
      )}

      {tab === "team" && (
        <div id="manager-panel-team" role="tabpanel" aria-labelledby="manager-tab-team">
          <DealerTeamCard />
        </div>
      )}

      <Modal
        isOpen={pendingTab !== null}
        onClose={() => setPendingTab(null)}
        size="sm"
        title="Discard unsaved settings?"
        footer={
          <>
            <Button variant="outline" fullWidth onClick={() => setPendingTab(null)}>
              Keep editing
            </Button>
            <Button
              variant="danger"
              fullWidth
              onClick={() => {
                if (!pendingTab) return;
                const nextTab = pendingTab;
                setPendingTab(null);
                setSettingsDirty(false);
                setTab(nextTab);
                requestAnimationFrame(() => tabRefs.current[nextTab]?.focus());
              }}
            >
              Discard changes
            </Button>
          </>
        }
      >
        <p className="text-sm text-surface-300">
          You have dealership settings that have not been saved. Leaving this tab will
          discard them.
        </p>
      </Modal>
    </div>
  );
};

// ----------------------------------------------------------------------------
// Settings card — inline editing of voice / color / banned / approval gate
// ----------------------------------------------------------------------------
/**
 * Hours and enabled styles both have a derived default when the dealer has
 * never saved them: a full default week, and every overlay style. The dirty
 * baseline has to run the SAME derivation as the initial state — comparing the
 * derived form value against a raw empty column made an untouched card report
 * itself dirty on mount, which enabled Save, raised "Discard unsaved
 * settings?" on tab switch, and armed the beforeunload prompt.
 */
const deriveHoursWeek = (raw?: string): WeekHours =>
  parseHoursString(raw) || defaultWeekHours();

const deriveEnabledStyles = (raw?: string): Set<string> => {
  const trimmed = (raw || "").trim();
  return trimmed
    ? new Set(
        trimmed
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      )
    : new Set<string>(Object.values(StyleOption));
};

interface DealerSettingsProps {
  dealer: NonNullable<ReturnType<typeof useAppStore.getState>["currentDealer"]>;
  onSaved: (fields: Record<string, string | boolean>) => Promise<unknown>;
  onDirtyChange: (dirty: boolean) => void;
}

export const DealerSettingsCard: React.FC<DealerSettingsProps> = ({
  dealer,
  onSaved,
  onDirtyChange,
}) => {
  // Voice / brand
  const [voice, setVoice] = useState(dealer.brand_voice || "");
  const [voiceDo, setVoiceDo] = useState<string[]>(() =>
    (dealer.brand_voice_do || []).slice(0, BRAND_VOICE_MAX_ITEMS),
  );
  const [voiceDont, setVoiceDont] = useState<string[]>(() =>
    (dealer.brand_voice_dont || []).slice(0, BRAND_VOICE_MAX_ITEMS),
  );

  // Brand kit (spec §4.1–§4.3)
  const [signatureLook, setSignatureLook] = useState<SignatureLook | "">(() =>
    isSignatureLook(dealer.signature_look) ? dealer.signature_look : "",
  );
  const [alternateLook, setAlternateLook] = useState<SignatureLook | "">(() =>
    isSignatureLook(dealer.alternate_look) ? dealer.alternate_look : "",
  );
  const [hashtagsLocked, setHashtagsLocked] = useState(
    !!dealer.required_hashtags_locked,
  );
  const [playfulStyle, setPlayfulStyle] = useState(dealer.playful_style || "");
  const [motionStyle, setMotionStyle] = useState(dealer.motion_signature?.style || "");
  const [motionAspects, setMotionAspects] = useState<MotionAspect[]>(() => {
    const saved = (dealer.motion_signature?.aspects || []).filter(isMotionAspect);
    return saved.length > 0 ? saved : DEFAULT_MOTION_ASPECTS;
  });
  const [motionAudio, setMotionAudio] = useState<MotionAudio>(() =>
    isMotionAudio(dealer.motion_signature?.audio)
      ? dealer.motion_signature.audio
      : DEFAULT_MOTION_AUDIO,
  );
  const [logoCorner, setLogoCorner] = useState<LogoCorner | "">(() =>
    isLogoCorner(dealer.logo_placement?.corner) ? dealer.logo_placement.corner : "",
  );
  const [logoScale, setLogoScale] = useState<number>(() => {
    const saved = dealer.logo_placement?.scale;
    return typeof saved === "number" && Number.isFinite(saved)
      ? Math.min(LOGO_SCALE_MAX, Math.max(LOGO_SCALE_MIN, saved))
      : LOGO_SCALE_DEFAULT;
  });
  const [imageQualityTier, setImageQualityTier] = useState<ImageQualityTier | "">(
    dealer.image_quality_tier === "standard" || dealer.image_quality_tier === "studio"
      ? dealer.image_quality_tier
      : "",
  );
  const lookGroupId = React.useId();
  const hashtagLockLabelId = React.useId();
  const hashtagLockHelpId = React.useId();
  const logoScaleId = React.useId();
  const lookRefs = useRef<Record<SignatureLook, HTMLButtonElement | null>>({
    showroom: null,
    hometown: null,
    turbo: null,
  });
  const [banned, setBanned] = useState(dealer.banned_phrases || "");
  const [color, setColor] = useState(dealer.brand_color || "");
  const [oem, setOem] = useState(dealer.oem_affiliation || "");
  const [approval, setApproval] = useState(!!dealer.requires_approval);

  // Contact + identity
  const [website, setWebsite] = useState(dealer.website || "");
  const [phone, setPhone] = useState(dealer.phone || "");
  const [address, setAddress] = useState(dealer.address || "");
  const [hoursWeek, setHoursWeek] = useState<WeekHours>(() =>
    deriveHoursWeek(dealer.hours),
  );
  const hoursSerialized = serializeHours(hoursWeek);
  const savedHoursSerialized = useMemo(
    () => serializeHours(deriveHoursWeek(dealer.hours)),
    [dealer.hours],
  );
  const [tagline, setTagline] = useState(dealer.tagline || "");

  // Social
  const [facebookUrl, setFacebookUrl] = useState(dealer.facebook_url || "");
  const [facebookPageTag, setFacebookPageTag] = useState(
    dealer.facebook_page_tag || "",
  );
  const [instagramHandle, setInstagramHandle] = useState(dealer.instagram_handle || "");
  const [tiktokHandle, setTiktokHandle] = useState(dealer.tiktok_handle || "");
  const [xHandle, setXHandle] = useState(dealer.x_handle || "");
  const [linkedinCompanyTag, setLinkedinCompanyTag] = useState(
    dealer.linkedin_company_tag || "",
  );
  const [gbpUrl, setGbpUrl] = useState(dealer.gbp_url || "");

  // Generation defaults
  const [defaultHashtags, setDefaultHashtags] = useState(dealer.default_hashtags || "");
  const [defaultFooter, setDefaultFooter] = useState(dealer.default_footer || "");

  // Overlay preferences
  const [enabledStyles, setEnabledStyles] = useState<Set<string>>(() =>
    deriveEnabledStyles(dealer.enabled_styles),
  );
  const [defaultStyle, setDefaultStyle] = useState(dealer.default_style || "");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const noApprovalRef = useRef<HTMLButtonElement>(null);
  const approvalRequiredRef = useRef<HTMLButtonElement>(null);

  const enabledStylesStr = Array.from(enabledStyles).join(",");
  const savedEnabledStylesStr = useMemo(
    () => Array.from(deriveEnabledStyles(dealer.enabled_styles)).join(","),
    [dealer.enabled_styles],
  );

  // Structured brand fields compare by their canonical JSON so an untouched
  // form (including "not set" → null) never reads as dirty.
  const currentMotionSignature: MotionSignature | null = motionStyle
    ? { style: motionStyle, aspects: motionAspects, audio: motionAudio }
    : null;
  const currentLogoPlacement: LogoPlacement | null = logoCorner
    ? { corner: logoCorner, scale: Math.round(logoScale * 1000) / 1000 }
    : null;
  const savedMotionSignature = dealer.motion_signature ?? null;
  const savedLogoPlacement = dealer.logo_placement ?? null;
  const savedLook: SignatureLook | "" = isSignatureLook(dealer.signature_look)
    ? dealer.signature_look
    : "";
  const savedAlternateLook: SignatureLook | "" = isSignatureLook(dealer.alternate_look)
    ? dealer.alternate_look
    : "";
  const brandDirty =
    signatureLook !== savedLook ||
    alternateLook !== savedAlternateLook ||
    JSON.stringify(voiceDo) !== JSON.stringify(dealer.brand_voice_do || []) ||
    JSON.stringify(voiceDont) !== JSON.stringify(dealer.brand_voice_dont || []) ||
    hashtagsLocked !== !!dealer.required_hashtags_locked ||
    playfulStyle !== (dealer.playful_style || "") ||
    JSON.stringify(currentMotionSignature) !== JSON.stringify(savedMotionSignature) ||
    JSON.stringify(currentLogoPlacement) !== JSON.stringify(savedLogoPlacement) ||
    imageQualityTier !== (dealer.image_quality_tier || "");

  const dirty =
    brandDirty ||
    voice !== (dealer.brand_voice || "") ||
    banned !== (dealer.banned_phrases || "") ||
    color !== (dealer.brand_color || "") ||
    oem !== (dealer.oem_affiliation || "") ||
    approval !== !!dealer.requires_approval ||
    website !== (dealer.website || "") ||
    phone !== (dealer.phone || "") ||
    address !== (dealer.address || "") ||
    hoursSerialized !== savedHoursSerialized ||
    tagline !== (dealer.tagline || "") ||
    facebookUrl !== (dealer.facebook_url || "") ||
    facebookPageTag !== (dealer.facebook_page_tag || "") ||
    instagramHandle !== (dealer.instagram_handle || "") ||
    tiktokHandle !== (dealer.tiktok_handle || "") ||
    xHandle !== (dealer.x_handle || "") ||
    linkedinCompanyTag !== (dealer.linkedin_company_tag || "") ||
    gbpUrl !== (dealer.gbp_url || "") ||
    defaultHashtags !== (dealer.default_hashtags || "") ||
    defaultFooter !== (dealer.default_footer || "") ||
    enabledStylesStr !== savedEnabledStylesStr ||
    defaultStyle !== (dealer.default_style || "");

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  const toggleStyle = (id: string) => {
    setEnabledStyles((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        if (defaultStyle === id) setDefaultStyle("");
      } else {
        next.add(id);
      }
      if (next.size === 0) next.add(id);
      return next;
    });
  };

  const selectLook = (next: SignatureLook) => {
    setSignatureLook(next);
    // The alternate is "a second look", so it can never equal the house look.
    if (alternateLook === next) setAlternateLook("");
  };

  const toggleMotionAspect = (aspect: MotionAspect) => {
    setMotionAspects((prev) =>
      prev.includes(aspect)
        ? prev.filter((item) => item !== aspect)
        : [...prev, aspect],
    );
  };

  const selectedLookOption = SIGNATURE_LOOK_OPTIONS.find(
    (option) => option.id === signatureLook,
  );
  const suggestedMotionStyle = selectedLookOption
    ? motionStyleOptions.find(
        (option) => option.style === selectedLookOption.motionStyle,
      )
    : undefined;

  const validateBrandFields = (): string | null => {
    if (signatureLook && alternateLook && alternateLook === signatureLook) {
      return "The alternate look must differ from the signature look.";
    }
    for (const list of [voiceDo, voiceDont]) {
      if (list.length > BRAND_VOICE_MAX_ITEMS) {
        return `Brand voice lists may hold up to ${BRAND_VOICE_MAX_ITEMS} phrases.`;
      }
      if (list.some((phrase) => phrase.length > BRAND_VOICE_MAX_CHARS)) {
        return `Brand voice phrases must be ${BRAND_VOICE_MAX_CHARS} characters or fewer.`;
      }
    }
    if (motionStyle) {
      if (motionStyle.length > MOTION_STYLE_MAX_CHARS) {
        return "Choose a motion style from the list.";
      }
      if (motionAspects.length === 0) {
        return "Pick at least one video aspect for the motion signature.";
      }
    }
    if (
      logoCorner &&
      (!Number.isFinite(logoScale) ||
        logoScale < LOGO_SCALE_MIN ||
        logoScale > LOGO_SCALE_MAX)
    ) {
      return `Logo size must be between ${Math.round(LOGO_SCALE_MIN * 100)}% and ${Math.round(
        LOGO_SCALE_MAX * 100,
      )}% of the image width.`;
    }
    return null;
  };

  const handleSave = async () => {
    setError(null);
    if (color && !HEX_RE.test(color.trim())) {
      setError("Brand color should be a hex value like #1d4ed8.");
      return;
    }
    const brandProblem = validateBrandFields();
    if (brandProblem) {
      setError(brandProblem);
      return;
    }
    setSaving(true);
    try {
      // Approval policy, category destinations, and feature permissions are
      // deliberately absent: the server leaves any field it does not receive
      // untouched, and their UI arrives in phase 2.
      const brandFields = db.encodeDealerBrandFields({
        signature_look: signatureLook,
        alternate_look: alternateLook,
        ...(signatureLook !== savedLook
          ? { default_tone: selectedLookOption?.tone || "" }
          : {}),
        brand_voice_do: voiceDo,
        brand_voice_dont: voiceDont,
        required_hashtags_locked: hashtagsLocked,
        playful_style: playfulStyle,
        motion_signature: currentMotionSignature,
        logo_placement: currentLogoPlacement,
        image_quality_tier: imageQualityTier,
      });
      const fields: Record<string, string | boolean> = {
        ...brandFields,
        brand_voice: voice.trim(),
        banned_phrases: banned.trim(),
        brand_color: color.trim(),
        oem_affiliation: oem.trim(),
        requires_approval: approval,
        website: website.trim(),
        phone: phone.trim(),
        address: address.trim(),
        hours: hoursSerialized,
        tagline: tagline.trim(),
        facebook_url: facebookUrl.trim(),
        facebook_page_tag: normalizeDealerSocialProfileValue(
          "facebook_page_tag",
          facebookPageTag,
        ),
        instagram_handle: normalizeDealerSocialProfileValue(
          "instagram_handle",
          instagramHandle,
        ),
        tiktok_handle: normalizeDealerSocialProfileValue("tiktok_handle", tiktokHandle),
        x_handle: normalizeDealerSocialProfileValue("x_handle", xHandle),
        linkedin_company_tag: normalizeDealerSocialProfileValue(
          "linkedin_company_tag",
          linkedinCompanyTag,
        ),
        gbp_url: gbpUrl.trim(),
        default_hashtags: defaultHashtags.trim(),
        default_footer: defaultFooter.trim(),
        enabled_styles: enabledStylesStr,
        default_style: defaultStyle,
      };
      await onSaved(fields);
      setSavedAt(new Date());
    } catch (err) {
      setError(toUiMessage(err, "Could not save these settings."));
    } finally {
      setSaving(false);
    }
  };

  // pb-20 (80px) reserves at least the sticky save bar's own footprint —
  // min-h-14 (56px) plus its bottom-2 (8px) offset — so the last control is
  // never trapped underneath the bar. sm:pb-20 re-asserts it past sm:p-6.
  return (
    <m.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg border border-hairline bg-surface-overlay p-4 pb-20 sm:p-6 sm:pb-20 space-y-6"
    >
      <div className="flex items-center gap-3">
        <div
          className="h-8 w-1.5 rounded-full"
          style={{ background: "var(--brand-primary)" }}
          aria-hidden="true"
        />
        <div>
          <h3 className="text-xl font-bold text-surface-50 flex items-center gap-2">
            <Settings className="w-5 h-5 text-primary-300" />
            Dealership settings
          </h3>
          <p className="text-xs text-surface-400">
            Everything here applies to every post your team generates.
          </p>
        </div>
      </div>

      {/* ---- Contact + identity ---- */}
      <section className="space-y-2">
        <div className="text-sm font-semibold text-surface-50">Contact & identity</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Input
            label="Website"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://yourdealership.com"
            fullWidth
            className="bg-fill-subtle border-hairline focus:border-primary-400"
          />
          <Input
            label="Phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(313) 555-0100"
            fullWidth
            className="bg-fill-subtle border-hairline focus:border-primary-400"
          />
        </div>
        <Input
          label="Address (one line)"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="123 Main St, Detroit MI 48201"
          fullWidth
          className="bg-fill-subtle border-hairline focus:border-primary-400"
        />
        <HoursPicker
          value={hoursWeek}
          onChange={setHoursWeek}
          preview={hoursSerialized}
        />
        <Input
          label="Tagline"
          value={tagline}
          onChange={(e) => setTagline(e.target.value)}
          placeholder="Family-owned since 1985 · No-haggle pricing"
          fullWidth
          className="bg-fill-subtle border-hairline focus:border-primary-400"
        />
      </section>

      {/* ---- Social handles ---- */}
      <section className="space-y-2">
        <div className="text-sm font-semibold text-surface-50">Social presence</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Input
            label="Facebook page URL"
            value={facebookUrl}
            onChange={(e) => setFacebookUrl(e.target.value)}
            placeholder="https://www.facebook.com/yourdealership"
            fullWidth
            className="bg-fill-subtle border-hairline focus:border-primary-400"
          />
          <Input
            label="Facebook Page tag"
            value={facebookPageTag}
            onChange={(e) => setFacebookPageTag(e.target.value)}
            placeholder="@Your Dealership"
            helperText="Added to Facebook/Marketplace captions. Facebook may ask the salesperson to tap the Page suggestion once."
            fullWidth
            className="bg-fill-subtle border-hairline focus:border-primary-400"
          />
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            label="Instagram"
            value={instagramHandle}
            onChange={(e) => setInstagramHandle(e.target.value)}
            placeholder="@yourdealership"
            fullWidth
            className="bg-fill-subtle border-hairline focus:border-primary-400"
          />
          <Input
            label="TikTok"
            value={tiktokHandle}
            onChange={(e) => setTiktokHandle(e.target.value)}
            placeholder="@yourdealership"
            fullWidth
            className="bg-fill-subtle border-hairline focus:border-primary-400"
          />
          <Input
            label="X / Twitter"
            value={xHandle}
            onChange={(e) => setXHandle(e.target.value)}
            placeholder="@yourdealership"
            fullWidth
            className="bg-fill-subtle border-hairline focus:border-primary-400"
          />
          <Input
            label="LinkedIn company tag"
            value={linkedinCompanyTag}
            onChange={(e) => setLinkedinCompanyTag(e.target.value)}
            placeholder="@your-company"
            helperText="LinkedIn may ask the salesperson to choose the company suggestion."
            fullWidth
            className="bg-fill-subtle border-hairline focus:border-primary-400"
          />
        </div>
        <Input
          label="Google Business Profile URL"
          value={gbpUrl}
          onChange={(e) => setGbpUrl(e.target.value)}
          placeholder="https://g.page/yourdealership"
          fullWidth
          className="bg-fill-subtle border-hairline focus:border-primary-400"
        />
      </section>

      {/* ---- Brand kit (spec §4.1–§4.3) ---- */}
      <section className="space-y-4" aria-label="Brand">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-surface-50">
            <Palette className="w-4 h-4 text-primary-300" />
            Brand
          </div>
          <p className="text-[11px] text-surface-400">
            One house style for every post: salespeople never pick image style, tone, or
            video look themselves.
          </p>
          {/*
            Phase 1 ships dark, so nothing in this section governs behavior yet —
            "Image overlay styles" further down still does. Say so plainly rather
            than leaving two live sections that contradict each other.
          */}
          <p className="mt-2 rounded-lg border border-hairline bg-fill-subtle px-3 py-2 text-[11px] text-surface-300">
            Not turned on yet. Save your choices here now — they take over once the new
            creative system is switched on for your store. Until then, the image overlay
            styles further down are what your team actually sees.
          </p>
        </div>

        {/* Signature look */}
        <div className="space-y-2">
          <div id={lookGroupId} className="text-xs font-semibold text-surface-200">
            Signature look
          </div>
          <div
            role="radiogroup"
            aria-labelledby={lookGroupId}
            className="grid grid-cols-1 gap-2 sm:grid-cols-3"
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
              )
                return;
              event.preventDefault();
              const ids = SIGNATURE_LOOK_OPTIONS.map((option) => option.id);
              const current = Math.max(0, ids.indexOf(signatureLook as SignatureLook));
              const delta =
                event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
              const next = ids[(current + delta + ids.length) % ids.length];
              selectLook(next);
              requestAnimationFrame(() => lookRefs.current[next]?.focus());
            }}
          >
            {SIGNATURE_LOOK_OPTIONS.map((option, index) => {
              const selected = signatureLook === option.id;
              const focusable = selected || (!signatureLook && index === 0);
              return (
                <button
                  key={option.id}
                  ref={(element) => {
                    lookRefs.current[option.id] = element;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={option.label}
                  aria-describedby={`${lookGroupId}-${option.id}`}
                  tabIndex={focusable ? 0 : -1}
                  onClick={() => selectLook(option.id)}
                  className={cn(
                    "rounded-xl border px-3 py-2.5 text-left transition-colors",
                    selected
                      ? "border-primary-500/40 bg-primary-500/5"
                      : "border-hairline bg-fill-subtle hover:bg-fill-hover",
                  )}
                >
                  <div className="text-sm font-semibold text-surface-50">
                    {option.label}
                  </div>
                  <div
                    id={`${lookGroupId}-${option.id}`}
                    className="text-[11px] text-surface-400"
                  >
                    {option.description}
                  </div>
                </button>
              );
            })}
          </div>
          <Select
            label="Alternate look"
            value={alternateLook}
            onChange={(event) =>
              setAlternateLook(
                isSignatureLook(event.target.value) ? event.target.value : "",
              )
            }
            helperText="Optional second look a manager may enable for the team."
            fullWidth
          >
            <option value="">None</option>
            {SIGNATURE_LOOK_OPTIONS.filter((option) => option.id !== signatureLook).map(
              (option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ),
            )}
          </Select>
        </div>

        {/* Playful style */}
        <Select
          label="Playful style"
          value={playfulStyle}
          onChange={(event) => setPlayfulStyle(event.target.value)}
          helperText="Shown to salespeople as a single Playful option"
          fullWidth
        >
          <option value="">Not set</option>
          {featuredFunStyleCatalog.map((style) => (
            <option key={style.id} value={style.id}>
              {style.name}
            </option>
          ))}
        </Select>

        {/* Motion signature */}
        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold text-surface-200">
            Motion signature
          </legend>
          <Select
            label="Motion style"
            value={motionStyle}
            onChange={(event) => setMotionStyle(event.target.value)}
            helperText={
              suggestedMotionStyle
                ? `Suggested for ${selectedLookOption?.label}: ${suggestedMotionStyle.label}`
                : "Bound to every video the team adds."
            }
            fullWidth
          >
            <option value="">Not set</option>
            {motionStyleOptions.map((option) => (
              <option key={option.style} value={option.style}>
                {option.label}
              </option>
            ))}
          </Select>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="space-y-1.5">
              <div className="text-[11px] font-medium text-surface-300">Aspects</div>
              {motionAspectOptions.map((option) => (
                <label
                  key={option.value}
                  className={cn(
                    "flex min-h-11 items-center gap-2 rounded-lg border border-hairline bg-fill-subtle px-3 text-sm text-surface-100",
                    !motionStyle && "opacity-60",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={
                      isMotionAspect(option.value) &&
                      motionAspects.includes(option.value)
                    }
                    disabled={!motionStyle}
                    onChange={() => {
                      if (isMotionAspect(option.value))
                        toggleMotionAspect(option.value);
                    }}
                    className="h-4 w-4 rounded border-surface-600 bg-surface-900 text-primary-500 focus:ring-primary-500"
                  />
                  {option.label}
                </label>
              ))}
            </div>
            <Select
              label="Audio"
              value={motionAudio}
              disabled={!motionStyle}
              onChange={(event) => {
                if (isMotionAudio(event.target.value))
                  setMotionAudio(event.target.value);
              }}
              fullWidth
            >
              {motionAudioOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        </fieldset>

        {/* Logo placement */}
        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold text-surface-200">
            Logo placement
          </legend>
          <div
            role="radiogroup"
            aria-label="Logo corner"
            className="grid grid-cols-2 gap-2 sm:grid-cols-4"
          >
            {LOGO_CORNER_OPTIONS.map((option) => {
              const selected = logoCorner === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setLogoCorner(option.id)}
                  className={cn(
                    "min-h-11 rounded-lg border px-3 py-2 text-sm transition-colors",
                    selected
                      ? "border-primary-500/40 bg-primary-500/5 text-primary-100"
                      : "border-hairline bg-fill-subtle text-surface-300 hover:bg-fill-hover",
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-3">
            <label
              htmlFor={logoScaleId}
              className="shrink-0 text-[11px] font-medium text-surface-300"
            >
              Logo size
            </label>
            <input
              id={logoScaleId}
              type="range"
              min={Math.round(LOGO_SCALE_MIN * 100)}
              max={Math.round(LOGO_SCALE_MAX * 100)}
              step={1}
              value={Math.round(logoScale * 100)}
              disabled={!logoCorner}
              onChange={(event) => setLogoScale(Number(event.target.value) / 100)}
              className="w-full accent-primary-500 disabled:opacity-50"
            />
            <output
              htmlFor={logoScaleId}
              className="w-12 shrink-0 text-right font-mono text-xs text-surface-200"
            >
              {Math.round(logoScale * 100)}%
            </output>
            {logoCorner ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-9 shrink-0"
                onClick={() => {
                  setLogoCorner("");
                  setLogoScale(LOGO_SCALE_DEFAULT);
                }}
              >
                Clear
              </Button>
            ) : null}
          </div>
          <p className="text-[11px] text-surface-400">
            Percent of the image width. The look decides the rest of the layout.
          </p>
        </fieldset>

        {/* Image quality */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-surface-200">Image quality</div>
          <div
            role="radiogroup"
            aria-label="Image quality"
            className="flex flex-col gap-2 sm:flex-row sm:items-center"
          >
            {(
              [
                { id: "standard", label: "Standard" },
                { id: "studio", label: "Studio" },
              ] as Array<{ id: ImageQualityTier; label: string }>
            ).map((option) => {
              const selected = imageQualityTier === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setImageQualityTier(option.id)}
                  className={cn(
                    "min-h-11 rounded-lg border px-3 py-2 text-sm transition-colors",
                    selected
                      ? "border-primary-500/40 bg-primary-500/5 text-primary-100"
                      : "border-hairline bg-fill-subtle text-surface-300 hover:bg-fill-hover",
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-surface-400">
            Studio renders at the higher-cost tier for every post.
          </p>
        </div>
      </section>

      {/* ---- Voice ---- */}
      <section className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-surface-50">
          <Wand2 className="w-4 h-4 text-primary-300" />
          Brand voice
        </div>
        <Textarea
          label=""
          aria-label="Brand voice"
          value={voice}
          onChange={(e) => setVoice(e.target.value)}
          rows={4}
          fullWidth
          placeholder={`e.g. "Confident, no exclamation points, never 'family-owned'. Local Detroit references are good."`}
          className="bg-fill-subtle border-hairline focus:border-primary-400"
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/*
            Both columns sit side by side at desktop width, so the placeholder has
            to fit its own field and the two helper lines have to wrap the same
            way — otherwise the columns end at different heights.
          */}
          <PhraseChipEditor
            label="Do"
            helperText="Up to 3 phrases captions always use."
            placeholder="Use first names"
            phrases={voiceDo}
            onChange={setVoiceDo}
          />
          <PhraseChipEditor
            label="Don't"
            helperText="Up to 3 phrases captions never use."
            placeholder="No exclamation points"
            phrases={voiceDont}
            onChange={setVoiceDont}
          />
        </div>
      </section>

      {/* ---- Default hashtags + footer ---- */}
      <section className="space-y-2">
        <div className="text-sm font-semibold text-surface-50">
          Defaults applied to every post
        </div>
        <Textarea
          label="Default hashtags (one per line)"
          value={defaultHashtags}
          onChange={(e) => setDefaultHashtags(e.target.value)}
          rows={3}
          fullWidth
          placeholder={"#YourDealership\n#DetroitFord\n#NewRide"}
          className="bg-fill-subtle border-hairline focus:border-primary-400 font-mono text-sm"
        />
        <button
          type="button"
          role="switch"
          aria-checked={hashtagsLocked}
          aria-labelledby={hashtagLockLabelId}
          aria-describedby={hashtagLockHelpId}
          onClick={() => setHashtagsLocked((value) => !value)}
          className={cn(
            "flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
            hashtagsLocked
              ? "border-primary-500/40 bg-primary-500/5"
              : "border-hairline bg-fill-subtle hover:bg-fill-hover",
          )}
        >
          <span className="min-w-0">
            <span
              id={hashtagLockLabelId}
              className="block text-sm font-medium text-surface-100"
            >
              Always include every hashtag above
            </span>
            <span id={hashtagLockHelpId} className="block text-[11px] text-surface-400">
              Keeps these tags on every post no matter the platform cap. Discovery
              hashtags only fill the remaining slots.
            </span>
          </span>
          <span
            aria-hidden="true"
            className={cn(
              "flex h-6 w-11 shrink-0 items-center rounded-full border px-0.5 transition-colors",
              hashtagsLocked
                ? "border-primary-400 bg-primary-500"
                : "border-hairline bg-fill-hover",
            )}
          >
            <span
              className={cn(
                "block h-5 w-5 rounded-full bg-white transition-transform",
                hashtagsLocked && "translate-x-5",
              )}
            />
          </span>
        </button>
        <Textarea
          label="Default footer / CTA"
          value={defaultFooter}
          onChange={(e) => setDefaultFooter(e.target.value)}
          rows={2}
          fullWidth
          placeholder="Stop by 123 Main St — open until 9pm. Call us at (313) 555-0100."
          className="bg-fill-subtle border-hairline focus:border-primary-400"
        />
      </section>

      {/* ---- Image overlay management ---- */}
      <section className="space-y-2">
        <div className="text-sm font-semibold text-surface-50">
          Image overlay styles
        </div>
        <p className="text-[11px] text-surface-400">
          Pick which design styles your team can use today. Star one to preselect it
          when a salesperson opens the customizer. These stay in charge until the Brand
          section above is switched on.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {Object.values(StyleOption).map((s) => {
            const enabled = enabledStyles.has(s);
            const isDefault = defaultStyle === s;
            return (
              <div
                key={s}
                className={cn(
                  "rounded-xl border px-3 py-2.5 flex items-center justify-between gap-2",
                  enabled
                    ? "border-primary-500/40 bg-primary-500/5"
                    : "border-hairline bg-fill-subtle opacity-60",
                )}
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-surface-50">{s}</div>
                  <div className="text-[10px] text-surface-400">
                    {enabled ? "available to salespeople" : "hidden"}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    type="button"
                    disabled={!enabled}
                    onClick={() => setDefaultStyle(isDefault ? "" : s)}
                    className={cn(
                      "text-[10px] px-2 py-1 rounded-md transition-colors",
                      isDefault
                        ? "bg-amber-500/30 text-amber-100"
                        : "bg-fill-subtle hover:bg-fill-hover text-surface-300",
                      !enabled && "opacity-30 cursor-not-allowed",
                    )}
                  >
                    {isDefault ? "★ default" : "Set default"}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleStyle(s)}
                    className={cn(
                      "text-[10px] px-2 py-1 rounded-md transition-colors",
                      enabled
                        ? "bg-fill-subtle hover:bg-fill-hover text-surface-300"
                        : "bg-success-500/20 hover:bg-success-500/30 text-success-100",
                    )}
                  >
                    {enabled ? "Disable" : "Enable"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <CustomScenarioManager
        customScenariosJson={dealer.custom_scenarios}
        onSave={async (json) => {
          await onSaved({ custom_scenarios: json });
        }}
      />

      <section className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-surface-50">
          <Ban className="w-4 h-4 text-error-300" />
          Banned phrases
        </div>
        <Textarea
          label=""
          aria-label="Banned phrases (one per line)"
          value={banned}
          onChange={(e) => setBanned(e.target.value)}
          rows={4}
          fullWidth
          placeholder={`guaranteed approval\nno credit check\nlowest price guaranteed`}
          className="bg-fill-subtle border-hairline focus:border-primary-400 font-mono text-sm"
        />
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-surface-50">
            <Palette className="w-4 h-4 text-primary-300" />
            Brand color
          </div>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={HEX_RE.test(color) ? color : "#1d4ed8"}
              onChange={(e) => setColor(e.target.value)}
              className="h-10 w-14 rounded-lg border border-hairline bg-transparent cursor-pointer"
              aria-label="Pick brand color"
            />
            <Input
              label=""
              aria-label="Brand color hex value"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              placeholder="#1d4ed8"
              fullWidth
              className="bg-fill-subtle border-hairline focus:border-primary-400 font-mono"
            />
          </div>
        </div>
        <div className="space-y-2">
          <div className="text-sm font-semibold text-surface-50">OEM affiliation</div>
          <Input
            label=""
            aria-label="OEM affiliation"
            value={oem}
            onChange={(e) => setOem(e.target.value)}
            placeholder="Ford, GM, Stellantis, Independent…"
            fullWidth
            className="bg-fill-subtle border-hairline focus:border-primary-400"
          />
        </div>
      </section>

      <section className="space-y-2">
        <div className="text-sm font-semibold text-surface-50">Manager approval</div>
        <div
          role="radiogroup"
          aria-label="Manager approval requirement"
          className="flex flex-col gap-2 sm:flex-row sm:items-center"
          onKeyDown={(event) => {
            if (
              !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
            )
              return;
            event.preventDefault();
            const nextApproval = !approval;
            setApproval(nextApproval);
            requestAnimationFrame(() =>
              (nextApproval ? approvalRequiredRef : noApprovalRef).current?.focus(),
            );
          }}
        >
          <button
            ref={noApprovalRef}
            type="button"
            role="radio"
            aria-checked={!approval}
            tabIndex={!approval ? 0 : -1}
            onClick={() => setApproval(false)}
            className={cn(
              "px-3 py-2 rounded-lg text-sm transition-colors border",
              !approval
                ? "border-success-500/40 bg-success-500/10 text-success-100"
                : "border-hairline bg-fill-subtle text-surface-300",
            )}
          >
            No approval required
          </button>
          <button
            ref={approvalRequiredRef}
            type="button"
            role="radio"
            aria-checked={approval}
            tabIndex={approval ? 0 : -1}
            onClick={() => setApproval(true)}
            className={cn(
              "px-3 py-2 rounded-lg text-sm transition-colors border",
              approval
                ? "border-warning-500/40 bg-warning-500/10 text-warning-100"
                : "border-hairline bg-fill-subtle text-surface-300",
            )}
          >
            Require manager approval
          </button>
        </div>
      </section>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-error-700/50 bg-error-900/40 px-3 py-2 text-error-100 text-xs"
        >
          {error}
        </div>
      )}

      <div
        data-testid="dealer-settings-save-bar"
        className="sticky bottom-2 z-10 flex min-h-14 items-center justify-between rounded-xl border border-hairline bg-surface-950/95 px-3 py-3 shadow-elevation-3 backdrop-blur-xl"
      >
        <div className="text-[11px] text-surface-400">
          {savedAt
            ? `Saved ${savedAt.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}`
            : dirty
              ? "Unsaved changes"
              : "Up to date"}
        </div>
        <Button
          variant="filled"
          size="sm"
          disabled={!dirty || saving}
          leftIcon={
            saving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )
          }
          onClick={handleSave}
        >
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </m.div>
  );
};

// ----------------------------------------------------------------------------
// Team card — proper salespeople CRUD against the new salespeople collection.
// Listed members are deduped against the post log so the GSM can see who has
// generated posts even if they haven't been added to the formal roster yet.
// ----------------------------------------------------------------------------
export const DealerTeamCard: React.FC = () => {
  const [roster, setRoster] = useState<
    Array<{
      id?: string;
      name: string;
      hasPin?: boolean;
      pinNeedsDistribution?: boolean;
      active: boolean;
      count: number;
      lastAt?: string;
    }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [editingPerson, setEditingPerson] = useState<Person | null>(null);
  const [oneTimeCode, setOneTimeCode] = useState<{
    id: string;
    name: string;
    pin: string;
  } | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [codeBusy, setCodeBusy] = useState(false);
  const dealer = useAppStore((s) => s.currentDealer);
  const role = useAppStore((s) => s.role);

  const load = React.useCallback(async () => {
    if (!dealer) return;
    setLoading(true);
    setError(null);
    try {
      const [sp, postsRes] = await Promise.all([
        import("../services/salespeople").then((m) => m.listSalespeople(true)),
        getLeaderboard(dealer.id, new Date(Date.UTC(2000, 0, 1))),
      ]);
      const counts = new Map<string, { count: number; lastAt: string }>();
      const looseNames = new Map<string, { count: number; lastAt: string }>();
      for (const p of postsRes) {
        const stamp = p.lastPostedAt;
        if (p.salespersonId) {
          const cur = counts.get(p.salespersonId) || { count: 0, lastAt: stamp };
          cur.count += p.count;
          if (stamp > cur.lastAt) cur.lastAt = stamp;
          counts.set(p.salespersonId, cur);
        } else if (p.salesperson) {
          const key = p.salesperson.trim();
          if (!key) continue;
          const cur = looseNames.get(key) || { count: 0, lastAt: stamp };
          cur.count += p.count;
          if (stamp > cur.lastAt) cur.lastAt = stamp;
          looseNames.set(key, cur);
        }
      }

      const rosterRows = sp.map((p) => ({
        id: p.id,
        name: p.name,
        hasPin: p.hasPin,
        pinNeedsDistribution: p.pinNeedsDistribution,
        active: p.active,
        count: counts.get(p.id)?.count || 0,
        lastAt: counts.get(p.id)?.lastAt,
      }));
      // Show "unrostered" names that have post activity but no salesperson record
      const rosteredNames = new Set(rosterRows.map((r) => r.name.toLowerCase()));
      const looseRows = Array.from(looseNames.entries())
        .filter(([n]) => !rosteredNames.has(n.toLowerCase()))
        .map(([name, v]) => ({
          name,
          active: true,
          count: v.count,
          lastAt: v.lastAt,
        }));

      const combined = [...rosterRows, ...looseRows].sort((a, b) => b.count - a.count);
      setRoster(combined);
    } catch (err) {
      setError(toUiMessage(err, "Could not load the team roster."));
    } finally {
      setLoading(false);
    }
  }, [dealer]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const handleAdd = async () => {
    setError(null);
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const m = await import("../services/salespeople");
      const created = await m.addSalesperson({
        name: newName.trim(),
        role: "salesperson",
      });
      setNewName("");
      if (created.pin) {
        setError(null);
        setCodeCopied(false);
        setOneTimeCode({
          id: created.person.id,
          name: created.person.name,
          pin: created.pin,
        });
      }
      await load();
    } catch (err) {
      setError(toUiMessage(err, "Could not add this teammate."));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (id: string, active: boolean) => {
    try {
      const m = await import("../services/salespeople");
      await m.updateSalesperson(id, { active: !active });
      await load();
    } catch (err) {
      setError(toUiMessage(err, "Could not update this teammate."));
    }
  };

  const handlePromoteLoose = async (name: string) => {
    setSaving(true);
    try {
      const m = await import("../services/salespeople");
      const created = await m.addSalesperson({ name, role: "salesperson" });
      setCodeCopied(false);
      setOneTimeCode({
        id: created.person.id,
        name: created.person.name,
        pin: created.pin,
      });
      await load();
    } catch (err) {
      setError(toUiMessage(err, "Could not add this teammate."));
    } finally {
      setSaving(false);
    }
  };

  const handlePersonCommitted = React.useCallback((updated: Person) => {
    setRoster((current) =>
      current.map((person) =>
        person.id === updated.id
          ? {
              ...person,
              name: updated.name,
              active: updated.active,
              hasPin: updated.hasPin,
              pinNeedsDistribution: updated.pinNeedsDistribution,
            }
          : person,
      ),
    );
    setEditingPerson((current) =>
      current?.id === updated.id ? { ...current, ...updated } : current,
    );
    if (!updated.pinNeedsDistribution) {
      setOneTimeCode((current) => (current?.id === updated.id ? null : current));
    }
  }, []);

  const handleCredentialIssued = React.useCallback((credential: CredentialResult) => {
    setCodeCopied(false);
    setOneTimeCode({
      id: credential.person.id,
      name: credential.person.name,
      pin: credential.pin,
    });
  }, []);

  const handleCopyOneTimeCode = async () => {
    if (!oneTimeCode) return;
    try {
      await navigator.clipboard.writeText(oneTimeCode.pin);
      setCodeCopied(true);
    } catch {
      setError("Could not copy the code. Write it down before marking it shared.");
    }
  };

  const handleAcknowledgeOneTimeCode = async () => {
    if (!oneTimeCode || codeBusy) return;
    setCodeBusy(true);
    setError(null);
    try {
      const m = await import("../services/salespeople");
      const updated = await m.acknowledgePinDistribution(oneTimeCode.id);
      handlePersonCommitted(updated);
      setOneTimeCode(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not mark the code as shared.",
      );
    } finally {
      setCodeBusy(false);
    }
  };

  return (
    <m.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg border border-hairline bg-surface-overlay p-4 sm:p-6 space-y-4"
    >
      <div className="flex items-center gap-3">
        <div
          className="h-8 w-1.5 rounded-full"
          style={{ background: "var(--brand-primary)" }}
          aria-hidden="true"
        />
        <div>
          <h3 className="text-xl font-bold text-surface-50 flex items-center gap-2">
            <Users className="w-5 h-5 text-primary-300" />
            Your team
          </h3>
          <p className="text-xs text-surface-400">
            Each salesperson gets a personal 4-digit code for sign-in and is tied to
            their posts automatically. Deactivate anyone who leaves — historical posts
            stay intact.
          </p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-end">
        <div className="flex-1">
          <label
            htmlFor="manager-add-salesperson"
            className="text-xs font-medium text-surface-300 uppercase tracking-wide"
          >
            Add salesperson
          </label>
          <input
            id="manager-add-salesperson"
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value.slice(0, 120))}
            placeholder="e.g. Sarah Chen"
            className="mt-1 w-full bg-fill-subtle border border-hairline rounded-lg px-3 py-2 text-sm text-surface-100 focus:border-primary-400 focus:outline-none"
          />
        </div>
        <Button
          variant="filled"
          size="md"
          disabled={!newName.trim() || saving}
          leftIcon={
            saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Users className="w-4 h-4" />
            )
          }
          onClick={handleAdd}
        >
          Add
        </Button>
      </div>

      {oneTimeCode && (
        <div
          className="rounded-xl border border-warning-400/30 bg-warning-500/10 px-3 py-3 text-sm text-warning-50"
          role="status"
          aria-label="Access code ready to share"
        >
          <div className="font-semibold">
            {oneTimeCode.name}&apos;s access code is ready
          </div>
          <p className="mt-1 text-xs text-warning-100/80">
            Copy this one-time access code and share it privately. This handoff stays
            here until you mark it as shared.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <span className="flex-1 rounded-lg border border-hairline bg-surface-950/70 px-3 py-2.5 text-center font-mono text-lg tracking-[0.3em] text-surface-50">
              {oneTimeCode.pin}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="min-h-11"
              disabled={codeBusy}
              leftIcon={
                codeCopied ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )
              }
              onClick={() => void handleCopyOneTimeCode()}
            >
              {codeCopied ? "Copied" : "Copy"}
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="min-h-11"
              disabled={codeBusy}
              leftIcon={
                codeBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )
              }
              onClick={() => void handleAcknowledgeOneTimeCode()}
            >
              {codeBusy ? "Updating…" : "Mark as shared"}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-error-700/50 bg-error-900/40 px-3 py-2 text-error-100 text-xs">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-12 flex items-center justify-center text-surface-400 text-sm">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading roster…
        </div>
      ) : roster.length === 0 ? (
        <div className="py-12 text-center text-sm text-surface-400">
          No one on the roster yet — add your first teammate above.
        </div>
      ) : (
        <ul className="space-y-2">
          {roster.map((p) => (
            <li
              key={p.id || `loose:${p.name}`}
              className={cn(
                "flex items-center justify-between rounded-xl border px-3 py-2.5 transition-colors",
                p.active
                  ? p.pinNeedsDistribution
                    ? "border-warning-400/25 bg-warning-500/[0.06]"
                    : "border-hairline bg-surface-900/40"
                  : "border-hairline bg-surface-900/20 opacity-60",
              )}
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold text-surface-50 flex items-center gap-2 flex-wrap">
                  {p.name}
                  {!p.id && (
                    <span className="text-[10px] uppercase tracking-wide text-warning-300 font-semibold">
                      unrostered
                    </span>
                  )}
                  {!p.active && p.id && (
                    <span className="text-[10px] uppercase tracking-wide text-surface-400 font-semibold">
                      inactive
                    </span>
                  )}
                  {p.id && (
                    <span
                      className={cn(
                        "text-[10px] uppercase tracking-wide font-semibold rounded-full px-2 py-0.5",
                        p.pinNeedsDistribution
                          ? "bg-warning-500/15 text-warning-200"
                          : p.hasPin
                            ? "bg-success-500/10 text-success-300"
                            : "bg-surface-800 text-surface-400",
                      )}
                    >
                      {p.pinNeedsDistribution
                        ? "Code to share"
                        : p.hasPin
                          ? "Code set"
                          : "No code"}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-surface-400">
                  {p.count > 0
                    ? `${p.count} post${p.count === 1 ? "" : "s"}${
                        p.lastAt
                          ? ` · last ${new Date(p.lastAt).toLocaleDateString()}`
                          : ""
                      }`
                    : "No posts yet"}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-lg font-bold text-surface-50 tabular-nums">
                  {p.count}
                </span>
                {p.id ? (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setEditingPerson({
                          id: p.id!,
                          dealer: dealer?.id || "",
                          name: p.name,
                          active: p.active,
                          role: "salesperson",
                          hasPin: Boolean(p.hasPin),
                          pinNeedsDistribution: Boolean(p.pinNeedsDistribution),
                          hasManagerLogin: false,
                        })
                      }
                      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md bg-fill-subtle text-surface-300 hover:bg-fill-hover"
                      title="Edit profile"
                      aria-label={`Edit ${p.name}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => p.id && handleToggleActive(p.id, p.active)}
                      className={cn(
                        "min-h-11 text-[11px] px-3 py-2 rounded-md transition-colors",
                        p.active
                          ? "bg-fill-subtle hover:bg-fill-hover text-surface-300"
                          : "bg-success-500/20 hover:bg-success-500/30 text-success-100",
                      )}
                      title={p.active ? "Deactivate" : "Reactivate"}
                    >
                      {p.active ? "Deactivate" : "Reactivate"}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => handlePromoteLoose(p.name)}
                    disabled={saving}
                    className="min-h-11 text-[11px] px-3 py-2 rounded-md bg-primary-500/20 hover:bg-primary-500/30 text-primary-100 transition-colors disabled:opacity-50"
                    title="Add this person to the formal roster"
                  >
                    Add to roster
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <PersonEditModal
        isOpen={!!editingPerson}
        person={editingPerson}
        storeName={dealer?.name}
        allowRoleEdit={false}
        allowManagerScopeEdit={role === "dealer_admin" || role === "super_admin"}
        onClose={() => setEditingPerson(null)}
        onCommitted={handlePersonCommitted}
        onCredentialIssued={handleCredentialIssued}
        onSaved={(updated) => {
          handlePersonCommitted(updated);
          setEditingPerson(null);
          void load();
        }}
      />
    </m.div>
  );
};
