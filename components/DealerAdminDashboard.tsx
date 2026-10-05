import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  Pencil,
  Check,
  Copy,
  X,
  ChevronRight,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import { PersonEditModal } from "./PersonEditModal";
import type { CredentialResult, Person } from "../services/salespeople";
import { Badge } from "./ui/Badge";
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
import {
  DEFAULT_EMPLOYEE_DISCLOSURE_TEMPLATE,
  buildEmployeeDisclosure,
} from "../utils/complianceDisclosures";
import { toUiMessage } from "../utils/errorMessages";
import { triggerHapticFeedback } from "../utils/haptics";
import {
  StyleOption,
  ToneOption,
  VideoStyle,
  type ImageQualityTier,
  type ApprovalPolicy,
  type BrandCategoryId,
  type CategoryDestinations,
  type FeaturePermissionKey,
  type FeaturePermissions,
  type LogoCorner,
  type LogoPlacement,
  type MotionAspect,
  type MotionAudio,
  type MotionSignature,
  type SignatureLook,
} from "../types";
import { CATEGORY_OUTPUTS } from "../services/creativeSystem";
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
import {
  listWebsiteDestinations,
  type WebsiteDestination,
} from "../services/websitePublishing";

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

type SettingsSection = "profile" | "channels" | "voice" | "creative" | "workflow";

const SETTINGS_SECTIONS: ReadonlyArray<{
  id: SettingsSection;
  label: string;
  description: string;
}> = [
  { id: "profile", label: "Store profile", description: "Contact, hours and identity" },
  { id: "channels", label: "Channels", description: "Social pages and destinations" },
  { id: "voice", label: "Voice", description: "Instructions, defaults and guardrails" },
  { id: "creative", label: "Creative", description: "Looks, logo, image and video" },
  {
    id: "workflow",
    label: "Workflow",
    description: "Approvals, permissions and compliance",
  },
];

const CATEGORY_LABELS: Record<BrandCategoryId, string> = {
  deliveries: "Deliveries",
  inventory: "Inventory",
  service: "Service",
  promotions: "Promotions",
  community: "Community",
  team: "Team",
};
const CATEGORY_IDS = Object.keys(CATEGORY_LABELS) as BrandCategoryId[];

const isBrandCategory = (value: unknown): value is BrandCategoryId =>
  typeof value === "string" && (CATEGORY_IDS as string[]).includes(value);

/**
 * Store setup counts only the areas a manager has to fill in. Workflow is not
 * one of them: approval and the disclosure have safe defaults, so counting
 * them would report a store "ready" that nobody has touched.
 */
type SetupArea = Exclude<SettingsSection, "workflow">;
const SETUP_AREAS: readonly SetupArea[] = ["profile", "channels", "voice", "creative"];

const hasSavedText = (value?: string | null) => Boolean(value && value.trim());

/** Completion is read from the saved record, never from unsaved form state. */
const setupAreasReady = (
  saved: NonNullable<ReturnType<typeof useAppStore.getState>["currentDealer"]>,
): Record<SetupArea, boolean> => ({
  profile:
    hasSavedText(saved.website) &&
    hasSavedText(saved.phone) &&
    hasSavedText(saved.address),
  channels: [
    saved.facebook_url,
    saved.facebook_page_tag,
    saved.instagram_handle,
    saved.tiktok_handle,
    saved.x_handle,
    saved.linkedin_company_tag,
    saved.gbp_url,
  ].some(hasSavedText),
  voice: hasSavedText(saved.brand_voice),
  creative: isSignatureLook(saved.signature_look) || hasSavedText(saved.default_style),
});

// ---------------------------------------------------------------------------
// Manager approval. The server (pb_hooks/requestPolicies.js
// initialApprovalStatus) treats requires_approval as the switch and
// approval_policy as a narrowing that only applies while the switch is on.
// The form therefore never stores "none" or "always": off and "every post"
// both store null, and a narrowing is stored only while review is on.
// ---------------------------------------------------------------------------
type ReviewScope = "every" | "first_n" | "per_category";
const APPROVAL_FIRST_N_MIN = 1;
const APPROVAL_FIRST_N_MAX = 100;
const DEFAULT_APPROVAL_FIRST_N = 3;

interface ReviewChoice {
  scope: ReviewScope;
  firstN: number;
  categories: BrandCategoryId[];
}

const REVIEW_SCOPE_OPTIONS: ReadonlyArray<{ id: ReviewScope; label: string }> = [
  { id: "every", label: "Every post" },
  { id: "first_n", label: "Each person's first posts" },
  { id: "per_category", label: "Selected post types" },
];

const orderCategories = (ids: readonly BrandCategoryId[]): BrandCategoryId[] =>
  CATEGORY_IDS.filter((id) => ids.includes(id));

/** Read a saved policy the way the server applies it. */
const readReviewChoice = (
  requiresApproval: boolean,
  policy: ApprovalPolicy | null | undefined,
): ReviewChoice => {
  const fallback: ReviewChoice = {
    scope: "every",
    firstN: DEFAULT_APPROVAL_FIRST_N,
    categories: ["deliveries"],
  };
  if (!requiresApproval || !policy || typeof policy !== "object") return fallback;
  if (policy.mode === "first_n") {
    const firstN = Number(policy.firstN);
    return Number.isInteger(firstN) &&
      firstN >= APPROVAL_FIRST_N_MIN &&
      firstN <= APPROVAL_FIRST_N_MAX
      ? { ...fallback, scope: "first_n", firstN }
      : fallback;
  }
  if (policy.mode === "per_category") {
    const categories = orderCategories(
      (Array.isArray(policy.categories) ? policy.categories : []).filter(
        isBrandCategory,
      ),
    );
    // An empty list reviews every post on the server, so show it that way.
    return categories.length > 0
      ? { ...fallback, scope: "per_category", categories }
      : fallback;
  }
  return fallback;
};

/** The approval_policy value to store for a review switch and choice. */
const toApprovalPolicy = (
  requiresApproval: boolean,
  choice: ReviewChoice,
): ApprovalPolicy | null => {
  if (!requiresApproval) return null;
  if (choice.scope === "first_n") return { mode: "first_n", firstN: choice.firstN };
  if (choice.scope === "per_category" && choice.categories.length > 0) {
    return { mode: "per_category", categories: orderCategories(choice.categories) };
  }
  return null;
};

const clampFirstN = (value: number) =>
  Math.min(
    APPROVAL_FIRST_N_MAX,
    Math.max(APPROVAL_FIRST_N_MIN, Math.round(value) || APPROVAL_FIRST_N_MIN),
  );

/** Selected option tile: the one selection treatment used across settings. */
const optionTileClass = (selected: boolean) =>
  cn(
    "rounded-sm border text-left transition-colors duration-120 ease-out",
    selected
      ? "border-brand-ink bg-brand-tint text-ink"
      : "border-hairline bg-panel text-ink hover:border-strong",
  );

/** The visual half of a role="switch" button; the button carries the state. */
const SwitchTrack: React.FC<{ on: boolean }> = ({ on }) => (
  <span
    aria-hidden="true"
    className={cn(
      "flex h-6 w-11 shrink-0 items-center rounded-full border px-0.5 transition-colors duration-120 ease-out",
      on ? "border-brand-fill bg-brand-fill" : "border-strong bg-fill-hover",
    )}
  >
    <span
      className={cn(
        "block h-5 w-5 rounded-full transition-transform duration-120 ease-out motion-reduce:transition-none",
        on ? "translate-x-[18px] bg-brand-foreground" : "bg-ink-2",
      )}
    />
  </span>
);

const DESTINATION_LABELS: Record<string, string> = {
  facebook_feed: "Facebook",
  instagram_feed: "Instagram",
  instagram_story: "Instagram Story",
  marketplace: "Marketplace",
  gbp: "Google Business",
  linkedin: "LinkedIn",
};

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
      <div className="text-sm font-medium text-ink-2">{label}</div>
      <ul className="flex flex-wrap gap-1.5" aria-label={`${label} phrases`}>
        {phrases.length === 0 ? (
          <li className="text-caption text-ink-2">None yet</li>
        ) : (
          phrases.map((phrase) => (
            <li
              key={phrase}
              className="inline-flex items-center gap-1 rounded-full border border-hairline bg-panel-raised py-1 pl-3 pr-1 text-sm text-ink"
            >
              <span>{phrase}</span>
              <button
                type="button"
                aria-label={`Remove ${lowerLabel} phrase ${phrase}`}
                onClick={() => {
                  onChange(phrases.filter((existing) => existing !== phrase));
                  setError(null);
                }}
                className="inline-flex h-6 w-6 items-center justify-center rounded-full text-ink-2 transition-colors duration-120 hover:bg-fill-hover hover:text-ink"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
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
        />
        <Button
          type="button"
          variant="secondary"
          size="md"
          className="shrink-0"
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

const DealerWebsiteConnectionCard: React.FC = () => {
  const [destinations, setDestinations] = useState<WebsiteDestination[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestKey, setRequestKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void listWebsiteDestinations(controller.signal)
      .then(setDestinations)
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(toUiMessage(err, "Could not check the private website connection."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [requestKey]);

  const ready = destinations.find((destination) => destination.enabled);
  return (
    <section
      className="rounded-md border border-hairline bg-panel p-5 sm:p-6"
      aria-labelledby="website-connection-heading"
    >
      <h3 id="website-connection-heading" className="text-ink">
        Customer website connection
      </h3>
      {loading ? (
        <p className="mt-1 text-sm text-ink-2">Checking the private draft route…</p>
      ) : error ? (
        <div className="mt-1">
          <p role="alert" className="text-sm text-error-ink">
            {error}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="md"
            className="mt-3"
            leftIcon={<RefreshCw className="h-4 w-4" />}
            onClick={() => setRequestKey((key) => key + 1)}
          >
            Retry
          </Button>
        </div>
      ) : ready ? (
        <div className="mt-1 text-sm text-ink-2">
          <p>
            Connected to {ready.label}. Posts prepare private drafts; your team still
            reviews and publishes them in Customer Hub.
          </p>
          {ready.siteUrl ? (
            <a
              href={ready.siteUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex min-h-11 items-center gap-1 text-brand-ink"
            >
              Open website <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
          ) : null}
        </div>
      ) : (
        <p className="mt-1 text-sm text-ink-2">
          No private website draft destination is configured for this dealership.
          Contact your system administrator to connect one.
        </p>
      )}
    </section>
  );
};

export interface DealerAdminDashboardProps {
  onSettingsDirtyChange?: (dirty: boolean) => void;
}

export const DealerAdminDashboard: React.FC<DealerAdminDashboardProps> = ({
  onSettingsDirtyChange,
}) => {
  const dealer = useAppStore((s) => s.currentDealer);
  const [tab, setTab] = useState<Tab>("overview");
  const [settingsDirty, setSettingsDirty] = useState(false);

  useEffect(() => {
    onSettingsDirtyChange?.(settingsDirty);
  }, [onSettingsDirtyChange, settingsDirty]);

  useEffect(
    () => () => {
      onSettingsDirtyChange?.(false);
    },
    [onSettingsDirtyChange],
  );
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
  const needsSetup = Boolean(dealer && (!dealer.brand_voice || !dealer.brand_color));
  // The wizard's own Finish setup can fill in the voice and colour. While that
  // save is in flight and its success state shows, wizardFinishing keeps the
  // wizard on screen until it dismisses itself. Nothing else sets it: a
  // Settings-tab save that completes the store makes the wizard go away, so it
  // can never linger holding entries older than that save.
  const [wizardFinishing, setWizardFinishing] = useState(false);
  const showWizard = !wizardDismissed && dealer && (needsSetup || wizardFinishing);

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
      <div className="p-8 text-center text-ink-2">
        <Loader2 className="mx-auto h-6 w-6 animate-spin" aria-hidden="true" />
      </div>
    );
  }

  const handleWizardSave = async (fields: Record<string, string | boolean>) => {
    const fd = new FormData();
    Object.entries(fields).forEach(([k, v]) =>
      fd.append(k, typeof v === "boolean" ? (v ? "true" : "false") : v),
    );
    const updated = await db.updateDealerWithFile(dealer.id, fd);
    // The PATCH body carries structured brand fields as JSON text ("[]", "",
    // '{"mode":"first_n",…}'), and the route answers with only { id }. Merge
    // the decoded values so the session dealer keeps arrays, objects and null
    // — the settings form compares against these, and the creative and
    // approval resolvers read them. Plain text fields and booleans are
    // already in their stored form.
    const decodedBrand = db.pickDealerBrandFields(fields);
    const decoded: Record<string, unknown> = { ...fields };
    for (const key of db.DEALER_BRAND_FIELDS) {
      if (key in fields) decoded[key] = decodedBrand[key];
    }
    useAppStore.setState((s) => ({
      currentDealer: s.currentDealer
        ? {
            ...s.currentDealer,
            ...(decoded as Partial<typeof s.currentDealer>),
            ...updated,
          }
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
    <div className="mx-auto w-full max-w-5xl space-y-6 p-0 sm:p-2 lg:p-4">
      {/* Dealership identity. On phones the app header already shows the
          dealer, so this block is visually hidden there, but it stays in the
          accessibility tree: it holds the page's only h1. */}
      <div className="sr-only flex-wrap items-center justify-between gap-3 sm:not-sr-only sm:flex">
        <div className="flex min-w-0 items-center gap-3">
          {dealer.logo ? (
            <img
              src={dealer.logo}
              alt={`${dealer.name} logo`}
              className="h-12 w-12 shrink-0 rounded-sm border border-hairline bg-panel-raised object-contain p-1"
            />
          ) : (
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-sm bg-brand-fill font-display text-xl font-semibold text-brand-foreground"
              aria-hidden="true"
            >
              {dealer.name.charAt(0)}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-2xl leading-7 text-ink">{dealer.name}</h1>
            <p className="text-sm text-ink-2">Manager dashboard</p>
          </div>
        </div>
      </div>

      {showWizard && (
        <DealerSetupWizard
          dealer={dealer}
          onSave={async (fields) => {
            // Set before the store update, so the record that completes the
            // store never unmounts the wizard ahead of its success state.
            setWizardFinishing(true);
            try {
              return await handleWizardSave(fields);
            } catch (err) {
              setWizardFinishing(false);
              throw err;
            }
          }}
          onDismiss={() => {
            setWizardFinishing(false);
            setWizardDismissed(true);
            try {
              localStorage.setItem(`dsp.dealerSetupDismissed.v1.${dealer.id}`, "1");
            } catch {
              /* ignore */
            }
          }}
        />
      )}

      {/* Tabs — text tabs with a brand underline on the selected one, the same
          pattern as the system-admin hub. Sticky on phones so managers can
          switch without scrolling up. */}
      <div className="sticky top-0 z-20 border-b border-hairline bg-canvas sm:static">
        <div
          role="tablist"
          aria-label="Manager dashboard"
          className="flex w-full gap-6 sm:w-auto"
        >
          {(
            [
              { key: "overview", label: "Overview" },
              { key: "settings", label: "Settings" },
              { key: "team", label: "Team" },
            ] as Array<{ key: Tab; label: string }>
          ).map((t) => {
            const selected = tab === t.key;
            return (
              <button
                ref={(element) => {
                  tabRefs.current[t.key] = element;
                }}
                key={t.key}
                id={`manager-tab-${t.key}`}
                role="tab"
                type="button"
                aria-selected={selected}
                aria-controls={`manager-panel-${t.key}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => {
                  triggerHapticFeedback();
                  requestTab(t.key);
                }}
                onKeyDown={(event) => handleTabKeyDown(event, t.key)}
                className={cn(
                  "relative -mb-px flex min-h-11 flex-1 items-center justify-center border-b-2 px-1 text-sm font-semibold transition-colors duration-120 ease-out sm:flex-none",
                  selected
                    ? "border-brand-fill text-ink"
                    : "border-transparent text-ink-2 hover:text-ink",
                )}
              >
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
          className="space-y-6"
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
          className="space-y-6"
        >
          <DealerSettingsCard
            dealer={dealer}
            onSaved={handleWizardSave}
            onDirtyChange={setSettingsDirty}
          />
          <DealerWebsiteConnectionCard />
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
            <Button variant="secondary" fullWidth onClick={() => setPendingTab(null)}>
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
        <p className="text-sm text-ink-2">
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
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("profile");
  const [advancedOpen, setAdvancedOpen] = useState(false);
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
  const [reviewChoice, setReviewChoice] = useState<ReviewChoice>(() =>
    readReviewChoice(!!dealer.requires_approval, dealer.approval_policy),
  );
  // What is typed in "Approved posts per person" while the field is being
  // edited. It may be empty or out of range; the saved choice keeps the last
  // valid, clamped number, and the field shows that again on blur.
  const [firstNDraft, setFirstNDraft] = useState<string | null>(null);
  const reviewGroupId = React.useId();
  const firstNHelpId = React.useId();
  const categoryHelpId = React.useId();
  const setupHeadingId = React.useId();
  const [categoryDestinations, setCategoryDestinations] =
    useState<CategoryDestinations | null>(dealer.category_destinations ?? null);
  const [featurePermissions, setFeaturePermissions] =
    useState<FeaturePermissions | null>(dealer.feature_permissions ?? null);
  // Opt-OUT semantics: the stored field is `disabled`, so unset keeps the
  // disclosure on. The control is phrased positively for the manager.
  const [disclosureOn, setDisclosureOn] = useState(
    !dealer.employee_disclosure_disabled,
  );
  const [disclosureText, setDisclosureText] = useState(
    dealer.employee_disclosure_text || "",
  );

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
  // Both sides go through the same normalisation, so a saved "always" / "none"
  // / empty-category policy (all of which review every post) never reads as an
  // unsaved edit.
  const approvalPolicy = toApprovalPolicy(approval, reviewChoice);
  const savedApprovalPolicy = toApprovalPolicy(
    !!dealer.requires_approval,
    readReviewChoice(!!dealer.requires_approval, dealer.approval_policy),
  );
  const workflowDirty =
    JSON.stringify(approvalPolicy) !== JSON.stringify(savedApprovalPolicy) ||
    JSON.stringify(categoryDestinations) !==
      JSON.stringify(dealer.category_destinations ?? null) ||
    JSON.stringify(featurePermissions) !==
      JSON.stringify(dealer.feature_permissions ?? null);

  const dirty =
    brandDirty ||
    workflowDirty ||
    voice !== (dealer.brand_voice || "") ||
    banned !== (dealer.banned_phrases || "") ||
    color !== (dealer.brand_color || "") ||
    oem !== (dealer.oem_affiliation || "") ||
    approval !== !!dealer.requires_approval ||
    disclosureOn === !!dealer.employee_disclosure_disabled ||
    disclosureText !== (dealer.employee_disclosure_text || "") ||
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
      // The approval policy is always sent, already normalised: null whenever
      // review is off or covers every post, so the stored value can never
      // disagree with what this form shows. Category destinations and feature
      // permissions are sent only when they changed, so a save that does not
      // touch them leaves the stored value (including any per-person entries)
      // exactly as it is.
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
        approval_policy: approvalPolicy,
        ...(JSON.stringify(categoryDestinations) !==
        JSON.stringify(dealer.category_destinations ?? null)
          ? { category_destinations: categoryDestinations }
          : {}),
        ...(JSON.stringify(featurePermissions) !==
        JSON.stringify(dealer.feature_permissions ?? null)
          ? { feature_permissions: featurePermissions }
          : {}),
      });
      // The exact text values that will be stored. After the save the form is
      // re-based onto these, so trimmed or normalised input never leaves the
      // card reporting a phantom unsaved change.
      const stored = {
        voice: voice.trim(),
        banned: banned.trim(),
        color: color.trim(),
        oem: oem.trim(),
        disclosureText: disclosureText.trim(),
        website: website.trim(),
        phone: phone.trim(),
        address: address.trim(),
        tagline: tagline.trim(),
        facebookUrl: facebookUrl.trim(),
        facebookPageTag: normalizeDealerSocialProfileValue(
          "facebook_page_tag",
          facebookPageTag,
        ),
        instagramHandle: normalizeDealerSocialProfileValue(
          "instagram_handle",
          instagramHandle,
        ),
        tiktokHandle: normalizeDealerSocialProfileValue("tiktok_handle", tiktokHandle),
        xHandle: normalizeDealerSocialProfileValue("x_handle", xHandle),
        linkedinCompanyTag: normalizeDealerSocialProfileValue(
          "linkedin_company_tag",
          linkedinCompanyTag,
        ),
        gbpUrl: gbpUrl.trim(),
        defaultHashtags: defaultHashtags.trim(),
        defaultFooter: defaultFooter.trim(),
      };
      const fields: Record<string, string | boolean> = {
        ...brandFields,
        brand_voice: stored.voice,
        banned_phrases: stored.banned,
        brand_color: stored.color,
        oem_affiliation: stored.oem,
        requires_approval: approval,
        employee_disclosure_disabled: !disclosureOn,
        employee_disclosure_text: stored.disclosureText,
        website: stored.website,
        phone: stored.phone,
        address: stored.address,
        hours: hoursSerialized,
        tagline: stored.tagline,
        facebook_url: stored.facebookUrl,
        facebook_page_tag: stored.facebookPageTag,
        instagram_handle: stored.instagramHandle,
        tiktok_handle: stored.tiktokHandle,
        x_handle: stored.xHandle,
        linkedin_company_tag: stored.linkedinCompanyTag,
        gbp_url: stored.gbpUrl,
        default_hashtags: stored.defaultHashtags,
        default_footer: stored.defaultFooter,
        enabled_styles: enabledStylesStr,
        default_style: defaultStyle,
      };
      await onSaved(fields);
      // Re-base only a field that still holds the value that was submitted:
      // anything typed while the save was in flight stays as typed (and the
      // form stays dirty), rather than being replaced by the saved snapshot.
      const rebase = (
        set: React.Dispatch<React.SetStateAction<string>>,
        submitted: string,
        saved: string,
      ) => set((current) => (current === submitted ? saved : current));
      rebase(setVoice, voice, stored.voice);
      rebase(setBanned, banned, stored.banned);
      rebase(setColor, color, stored.color);
      rebase(setOem, oem, stored.oem);
      rebase(setDisclosureText, disclosureText, stored.disclosureText);
      rebase(setWebsite, website, stored.website);
      rebase(setPhone, phone, stored.phone);
      rebase(setAddress, address, stored.address);
      rebase(setTagline, tagline, stored.tagline);
      rebase(setFacebookUrl, facebookUrl, stored.facebookUrl);
      rebase(setFacebookPageTag, facebookPageTag, stored.facebookPageTag);
      rebase(setInstagramHandle, instagramHandle, stored.instagramHandle);
      rebase(setTiktokHandle, tiktokHandle, stored.tiktokHandle);
      rebase(setXHandle, xHandle, stored.xHandle);
      rebase(setLinkedinCompanyTag, linkedinCompanyTag, stored.linkedinCompanyTag);
      rebase(setGbpUrl, gbpUrl, stored.gbpUrl);
      rebase(setDefaultHashtags, defaultHashtags, stored.defaultHashtags);
      rebase(setDefaultFooter, defaultFooter, stored.defaultFooter);
      setSavedAt(new Date());
    } catch (err) {
      setError(toUiMessage(err, "Could not save these settings."));
    } finally {
      setSaving(false);
    }
  };

  const areaReady = setupAreasReady(dealer);
  const completeCount = SETUP_AREAS.filter((area) => areaReady[area]).length;
  const sectionReady = (section: SettingsSection) =>
    section !== "workflow" && areaReady[section];

  const toggleReviewCategory = (category: BrandCategoryId) => {
    setReviewChoice((current) => {
      const checked = current.categories.includes(category);
      // At least one post type stays checked; an empty list would review
      // every post, which is what "Every post" is for.
      if (checked && current.categories.length === 1) return current;
      return {
        ...current,
        categories: orderCategories(
          checked
            ? current.categories.filter((id) => id !== category)
            : [...current.categories, category],
        ),
      };
    });
  };

  // The settings sit directly on the canvas: no outer card, sections separated
  // by 32 px and a title-2. pb-20 (80px) reserves at least the sticky save
  // bar's own footprint — min-h-14 (56px) plus its bottom-2 (8px) offset — so
  // the last control is never trapped underneath the bar.
  return (
    <div className="relative space-y-8 pb-20">
      <header>
        <div>
          <h2 className="text-3xl leading-8 text-ink sm:text-4xl sm:leading-10">
            Dealership settings
          </h2>
          <p className="mt-1 text-sm text-ink-2">
            Your brand, your voice, your team's way of working.
          </p>
        </div>
      </header>

      <section aria-labelledby={setupHeadingId} className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h3 id={setupHeadingId} className="text-ink">
              Store setup
            </h3>
            <p className="text-sm text-ink-2">
              {completeCount} of {SETUP_AREAS.length} areas ready
            </p>
          </div>
          <div
            className="mb-1.5 h-1 w-24 overflow-hidden rounded-full bg-panel-raised"
            role="progressbar"
            aria-label="Store setup progress"
            aria-valuemin={0}
            aria-valuemax={SETUP_AREAS.length}
            aria-valuenow={completeCount}
          >
            <div
              className="h-full bg-brand-fill transition-[width] duration-180 ease-out"
              style={{ width: `${(completeCount / SETUP_AREAS.length) * 100}%` }}
            />
          </div>
        </div>
        <nav
          className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:grid sm:grid-cols-5 sm:overflow-visible sm:px-0 sm:pb-0"
          aria-label="Dealership settings sections"
        >
          {SETTINGS_SECTIONS.map((section) => {
            const selected = settingsSection === section.id;
            const ready = sectionReady(section.id);
            return (
              <button
                key={section.id}
                type="button"
                aria-current={selected ? "page" : undefined}
                onClick={() => setSettingsSection(section.id)}
                className={cn(
                  "flex min-h-11 shrink-0 flex-col justify-center gap-1 px-3 py-2 sm:py-3",
                  optionTileClass(selected),
                )}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{section.label}</span>
                  {ready ? (
                    <>
                      <Check
                        className="h-4 w-4 shrink-0 text-success-ink"
                        aria-hidden="true"
                      />
                      <span className="sr-only">, ready</span>
                    </>
                  ) : null}
                </span>
                <span className="hidden text-caption text-ink-2 lg:block">
                  {section.description}
                </span>
              </button>
            );
          })}
        </nav>
      </section>

      {/* ---- Contact + identity ---- */}
      <section className={cn("space-y-4", settingsSection !== "profile" && "hidden")}>
        <h3 className="text-ink">Contact & identity</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Website"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://yourdealership.com"
            fullWidth
          />
          <Input
            label="Phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(313) 555-0100"
            fullWidth
          />
        </div>
        <Input
          label="Address (one line)"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="123 Main St, Detroit MI 48201"
          fullWidth
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
        />
      </section>

      {/* ---- Social handles ---- */}
      <section className={cn("space-y-4", settingsSection !== "channels" && "hidden")}>
        <h3 className="text-ink">Social presence</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Facebook page URL"
            value={facebookUrl}
            onChange={(e) => setFacebookUrl(e.target.value)}
            placeholder="https://www.facebook.com/yourdealership"
            fullWidth
          />
          <Input
            label="Facebook Page tag"
            value={facebookPageTag}
            onChange={(e) => setFacebookPageTag(e.target.value)}
            placeholder="@Your Dealership"
            helperText="Added to Facebook/Marketplace captions. Facebook may ask the salesperson to tap the Page suggestion once."
            fullWidth
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            label="Instagram"
            value={instagramHandle}
            onChange={(e) => setInstagramHandle(e.target.value)}
            placeholder="@yourdealership"
            fullWidth
          />
          <Input
            label="TikTok"
            value={tiktokHandle}
            onChange={(e) => setTiktokHandle(e.target.value)}
            placeholder="@yourdealership"
            fullWidth
          />
          <Input
            label="X / Twitter"
            value={xHandle}
            onChange={(e) => setXHandle(e.target.value)}
            placeholder="@yourdealership"
            fullWidth
          />
          <Input
            label="LinkedIn company tag"
            value={linkedinCompanyTag}
            onChange={(e) => setLinkedinCompanyTag(e.target.value)}
            placeholder="@your-company"
            helperText="LinkedIn may ask the salesperson to choose the company suggestion."
            fullWidth
          />
        </div>
        <Input
          label="Google Business Profile URL"
          value={gbpUrl}
          onChange={(e) => setGbpUrl(e.target.value)}
          placeholder="https://g.page/yourdealership"
          fullWidth
        />
      </section>

      {/* ---- Brand kit (spec §4.1–§4.3) ---- */}
      <section
        className={cn("space-y-4", settingsSection !== "creative" && "hidden")}
        aria-label="Brand"
      >
        <div>
          <h3 className="text-ink">Brand</h3>
          <p className="mt-1 text-sm text-ink-2">
            One house style for every post: salespeople never pick image style, tone, or
            video look themselves.
          </p>
          <p className="mt-3 rounded-sm border border-hairline bg-panel px-3 py-2 text-sm text-ink-2">
            {dealer.creative_system_v2
              ? "Active for your store. The signature look, destinations and feature permissions control new posts."
              : "Your store is using the classic style choices below. Configure a signature look now, then ask your system administrator to enable the streamlined creative system when your team is ready."}
          </p>
        </div>

        {/* Signature look */}
        <div className="space-y-2">
          <div id={lookGroupId} className="text-sm font-medium text-ink-2">
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
                  className={cn("min-h-11 px-3 py-2.5", optionTileClass(selected))}
                >
                  <div className="text-sm font-semibold text-ink">{option.label}</div>
                  <div
                    id={`${lookGroupId}-${option.id}`}
                    className="mt-0.5 text-caption text-ink-2"
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
        <fieldset className="space-y-3">
          <legend className="mb-2 text-sm font-medium text-ink-2">
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="text-sm font-medium text-ink-2">Aspects</div>
              {motionAspectOptions.map((option) => (
                <label
                  key={option.value}
                  className={cn(
                    "flex min-h-11 items-center gap-3 rounded-sm border border-hairline bg-panel px-3 text-sm text-ink",
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
                    className="h-4 w-4 accent-brand-fill"
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
        <fieldset className="space-y-3">
          <legend className="mb-2 text-sm font-medium text-ink-2">
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
                    "min-h-11 px-3 py-2 text-sm",
                    optionTileClass(selected),
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
              className="shrink-0 text-sm font-medium text-ink-2"
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
              className="min-h-11 w-full accent-brand-fill disabled:opacity-50"
            />
            <output
              htmlFor={logoScaleId}
              className="w-12 shrink-0 text-right text-sm tabular-nums text-ink"
            >
              {Math.round(logoScale * 100)}%
            </output>
            {logoCorner ? (
              <Button
                type="button"
                variant="ghost"
                size="md"
                className="shrink-0"
                onClick={() => {
                  setLogoCorner("");
                  setLogoScale(LOGO_SCALE_DEFAULT);
                }}
              >
                Clear
              </Button>
            ) : null}
          </div>
          <p className="text-caption text-ink-2">
            Percent of the image width. The look decides the rest of the layout.
          </p>
        </fieldset>

        {/* Image quality */}
        <div className="space-y-2">
          <div className="text-sm font-medium text-ink-2">Image quality</div>
          <div
            role="radiogroup"
            aria-label="Image quality"
            className="grid grid-cols-2 gap-2 sm:flex sm:items-center"
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
                    "min-h-11 px-4 py-2 text-sm sm:min-w-32",
                    optionTileClass(selected),
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <p className="text-caption text-ink-2">
            Your choice is saved for the store. For now, each device still uses its own
            image quality setting.
          </p>
        </div>
      </section>

      {/* ---- Voice ---- */}
      <section className={cn("space-y-4", settingsSection !== "voice" && "hidden")}>
        <h3 className="text-ink">Brand voice</h3>
        <Textarea
          label=""
          aria-label="Brand voice"
          value={voice}
          onChange={(e) => setVoice(e.target.value)}
          rows={4}
          fullWidth
          placeholder={`e.g. "Confident, no exclamation points, never 'family-owned'. Local Detroit references are good."`}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
      <section className={cn("space-y-4", settingsSection !== "voice" && "hidden")}>
        <h3 className="text-ink">Defaults applied to every post</h3>
        <Textarea
          label="Default hashtags (one per line)"
          value={defaultHashtags}
          onChange={(e) => setDefaultHashtags(e.target.value)}
          rows={3}
          fullWidth
          placeholder={"#YourDealership\n#DetroitFord\n#NewRide"}
        />
        <button
          type="button"
          role="switch"
          aria-checked={hashtagsLocked}
          aria-labelledby={hashtagLockLabelId}
          aria-describedby={hashtagLockHelpId}
          onClick={() => setHashtagsLocked((value) => !value)}
          className={cn(
            "flex min-h-11 w-full items-center justify-between gap-3 px-3 py-3",
            optionTileClass(hashtagsLocked),
          )}
        >
          <span className="min-w-0">
            <span
              id={hashtagLockLabelId}
              className="block text-sm font-medium text-ink"
            >
              Always include every hashtag above
            </span>
            <span
              id={hashtagLockHelpId}
              className="mt-0.5 block text-caption text-ink-2"
            >
              Keeps these tags on every post no matter the platform cap. Discovery
              hashtags only fill the remaining slots.
            </span>
          </span>
          <SwitchTrack on={hashtagsLocked} />
        </button>
        <Textarea
          label="Default footer / CTA"
          value={defaultFooter}
          onChange={(e) => setDefaultFooter(e.target.value)}
          rows={2}
          fullWidth
          placeholder="Stop by 123 Main St — open until 9pm. Call us at (313) 555-0100."
        />
      </section>

      {/* ---- Image overlay management ---- */}
      <section className={cn("space-y-4", settingsSection !== "creative" && "hidden")}>
        <h3 className="text-ink">Image overlay styles</h3>
        <p className="text-sm text-ink-2">
          {dealer.creative_system_v2
            ? "Classic style choices are kept for older saved work. New posts use the signature look above."
            : "Pick which design styles your team can use today. Set one as the default to preselect it when a salesperson opens the customizer."}
        </p>
        <ul className="divide-y divide-hairline rounded-md border border-hairline bg-panel">
          {Object.values(StyleOption).map((s) => {
            const enabled = enabledStyles.has(s);
            const isDefault = defaultStyle === s;
            return (
              <li
                key={s}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3"
              >
                <div className={cn("min-w-0", !enabled && "opacity-60")}>
                  <div className="text-sm font-semibold text-ink">{s}</div>
                  <div className="text-caption text-ink-2">
                    {enabled ? "available to salespeople" : "hidden"}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    type="button"
                    variant={isDefault ? "secondary" : "ghost"}
                    size="md"
                    aria-pressed={isDefault}
                    disabled={!enabled}
                    onClick={() => setDefaultStyle(isDefault ? "" : s)}
                  >
                    {isDefault ? "Default" : "Set default"}
                  </Button>
                  <Button
                    type="button"
                    variant={enabled ? "ghost" : "secondary"}
                    size="md"
                    onClick={() => toggleStyle(s)}
                  >
                    {enabled ? "Disable" : "Enable"}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {settingsSection === "creative" ? (
        <CustomScenarioManager
          customScenariosJson={dealer.custom_scenarios}
          onSave={async (json) => {
            await onSaved({ custom_scenarios: json });
          }}
        />
      ) : null}

      <section className={cn("space-y-4", settingsSection !== "voice" && "hidden")}>
        <h3 className="text-ink">Banned phrases</h3>
        <Textarea
          label=""
          aria-label="Banned phrases (one per line)"
          value={banned}
          onChange={(e) => setBanned(e.target.value)}
          rows={4}
          fullWidth
          placeholder={`guaranteed approval\nno credit check\nlowest price guaranteed`}
        />
      </section>

      <section
        className={cn(
          "grid grid-cols-1 gap-8 sm:grid-cols-2 sm:gap-6",
          settingsSection !== "profile" && "hidden",
        )}
      >
        <div className="space-y-4">
          <h3 className="text-ink">Brand color</h3>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={HEX_RE.test(color) ? color : "#1d4ed8"}
              onChange={(e) => setColor(e.target.value)}
              className="h-11 w-14 shrink-0 cursor-pointer rounded-sm border border-strong bg-transparent"
              aria-label="Pick brand color"
            />
            <Input
              label=""
              aria-label="Brand color hex value"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              placeholder="#1d4ed8"
              fullWidth
            />
          </div>
        </div>
        <div className="space-y-4">
          <h3 className="text-ink">OEM affiliation</h3>
          <Input
            label=""
            aria-label="OEM affiliation"
            value={oem}
            onChange={(e) => setOem(e.target.value)}
            placeholder="Ford, GM, Stellantis, Independent…"
            fullWidth
          />
        </div>
      </section>

      {/* ---- Manager approval ---- */}
      <section className={cn("space-y-4", settingsSection !== "workflow" && "hidden")}>
        <h3 className="text-ink">Manager approval</h3>
        <div
          role="radiogroup"
          aria-label="Manager approval requirement"
          className="grid grid-cols-1 gap-2 sm:grid-cols-2"
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
              "min-h-11 px-4 py-3 text-sm font-semibold",
              optionTileClass(!approval),
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
              "min-h-11 px-4 py-3 text-sm font-semibold",
              optionTileClass(approval),
            )}
          >
            Require manager approval
          </button>
        </div>

        {approval ? (
          <div className="space-y-4 rounded-md border border-hairline bg-panel p-4 sm:p-5">
            <div>
              <div id={reviewGroupId} className="text-sm font-medium text-ink-2">
                Posts that are reviewed
              </div>
              <div
                role="radiogroup"
                aria-labelledby={reviewGroupId}
                className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3"
              >
                {REVIEW_SCOPE_OPTIONS.map((option) => {
                  const selected = reviewChoice.scope === option.id;
                  return (
                    <label
                      key={option.id}
                      className={cn(
                        "flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2.5 text-sm font-medium",
                        optionTileClass(selected),
                      )}
                    >
                      <input
                        type="radio"
                        name={reviewGroupId}
                        value={option.id}
                        checked={selected}
                        onChange={() => {
                          setFirstNDraft(null);
                          setReviewChoice((current) => ({
                            ...current,
                            scope: option.id,
                          }));
                        }}
                        className="h-4 w-4 shrink-0 accent-brand-fill"
                      />
                      {option.label}
                    </label>
                  );
                })}
              </div>
            </div>

            {reviewChoice.scope === "first_n" ? (
              <div className="max-w-xs">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={APPROVAL_FIRST_N_MIN}
                  max={APPROVAL_FIRST_N_MAX}
                  step={1}
                  label="Approved posts per person"
                  value={firstNDraft ?? String(reviewChoice.firstN)}
                  onChange={(event) => {
                    const raw = event.target.value;
                    setFirstNDraft(raw);
                    const next = Number(raw);
                    if (raw.trim() === "" || !Number.isFinite(next)) return;
                    setReviewChoice((current) => ({
                      ...current,
                      firstN: clampFirstN(next),
                    }));
                  }}
                  onBlur={() => setFirstNDraft(null)}
                  aria-describedby={firstNHelpId}
                  fullWidth
                />
                <p id={firstNHelpId} className="mt-1.5 px-1 text-caption text-ink-2">
                  Each person's posts are reviewed until you have approved this many.
                </p>
              </div>
            ) : null}

            {reviewChoice.scope === "per_category" ? (
              <div>
                <div
                  id={`${reviewGroupId}-types`}
                  className="text-sm font-medium text-ink-2"
                >
                  Post types to review
                </div>
                <div
                  role="group"
                  aria-labelledby={`${reviewGroupId}-types`}
                  aria-describedby={categoryHelpId}
                  className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3"
                >
                  {CATEGORY_IDS.map((category) => {
                    const checked = reviewChoice.categories.includes(category);
                    const onlyOne = checked && reviewChoice.categories.length === 1;
                    return (
                      <label
                        key={category}
                        className={cn(
                          "flex min-h-11 items-center gap-3 px-3 text-sm",
                          optionTileClass(checked),
                          onlyOne ? "cursor-not-allowed" : "cursor-pointer",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={onlyOne}
                          onChange={() => toggleReviewCategory(category)}
                          className="h-4 w-4 shrink-0 accent-brand-fill"
                        />
                        {CATEGORY_LABELS[category]}
                      </label>
                    );
                  })}
                </div>
                <p id={categoryHelpId} className="mt-2 px-1 text-caption text-ink-2">
                  Posts that involve a customer are always reviewed when Deliveries is
                  checked. Review follows the post type the salesperson picks.
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* ---- Team-member disclosure ---- */}
      <section className={cn("space-y-4", settingsSection !== "workflow" && "hidden")}>
        <div>
          <h3 className="text-ink">Team-member disclosure</h3>
          <p className="mt-1 text-sm text-ink-2">
            The FTC requires a salesperson posting about your inventory to say they work
            here. This line is added to the top of every post, where it stays visible
            above the &ldquo;see more&rdquo; fold.
          </p>
        </div>
        <div
          role="radiogroup"
          aria-label="Team-member disclosure"
          className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        >
          <button
            type="button"
            role="radio"
            aria-checked={disclosureOn}
            tabIndex={disclosureOn ? 0 : -1}
            onClick={() => setDisclosureOn(true)}
            className={cn(
              "min-h-11 px-4 py-3 text-sm font-semibold",
              optionTileClass(disclosureOn),
            )}
          >
            Add the disclosure
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!disclosureOn}
            tabIndex={!disclosureOn ? 0 : -1}
            onClick={() => setDisclosureOn(false)}
            className={cn(
              "min-h-11 px-4 py-3 text-sm font-semibold",
              optionTileClass(!disclosureOn),
            )}
          >
            Turn it off
          </button>
        </div>
        {!disclosureOn && (
          <p
            role="alert"
            className="rounded-sm border border-warning-ink/30 bg-warning-fill px-3 py-2 text-sm text-warning-ink"
          >
            Your team&rsquo;s posts will carry no material-connection disclosure.
            Confirm this with your compliance officer before saving.
          </p>
        )}
        <div>
          <label
            htmlFor="employee-disclosure-text"
            className="mb-1.5 block text-sm font-medium text-ink-2"
          >
            Wording (optional). Use <code>{"{dealer}"}</code> for your dealership name.
          </label>
          <textarea
            id="employee-disclosure-text"
            value={disclosureText}
            onChange={(e) => setDisclosureText(e.target.value.slice(0, 280))}
            maxLength={280}
            rows={2}
            disabled={!disclosureOn}
            placeholder={DEFAULT_EMPLOYEE_DISCLOSURE_TEMPLATE}
            className="w-full rounded-sm border border-strong bg-panel-raised px-3 py-2 text-base text-ink placeholder:text-ink-hint transition-colors duration-120 ease-out focus:border-brand-ink disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
        <p className="text-sm text-ink-2">
          Preview:{" "}
          {buildEmployeeDisclosure({
            name: dealer.name,
            employee_disclosure_text: disclosureText,
            employee_disclosure_disabled: !disclosureOn,
          }) || "No disclosure will be added."}
        </p>
      </section>

      {/* ---- Advanced: team feature access and channels by post type ---- */}
      <section
        className={cn("space-y-4", settingsSection !== "workflow" && "hidden")}
        aria-label="Advanced workflow controls"
      >
        <button
          type="button"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((open) => !open)}
          className="flex min-h-11 w-full items-center justify-between rounded-sm border border-hairline bg-panel px-4 text-left text-sm font-semibold text-ink transition-colors duration-120 ease-out hover:border-strong"
        >
          Advanced workflow controls
          <ChevronRight
            className={cn(
              "h-4 w-4 text-ink-2 transition-transform duration-180 ease-out motion-reduce:transition-none",
              advancedOpen && "rotate-90",
            )}
            aria-hidden="true"
          />
        </button>
        {advancedOpen ? (
          <div className="space-y-8">
            <div className="space-y-3">
              <h4 className="text-ink">Team feature access</h4>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {(
                  [
                    ["playful", "Playful"],
                    ["video", "Video"],
                  ] as Array<[FeaturePermissionKey, string]>
                ).map(([key, label]) => {
                  const enabled = featurePermissions?.[key]?.team !== false;
                  return (
                    <button
                      key={key}
                      type="button"
                      role="switch"
                      aria-checked={enabled}
                      onClick={() =>
                        setFeaturePermissions((current) => ({
                          ...(current || {}),
                          [key]: {
                            team: !enabled,
                            people: current?.[key]?.people || {},
                          },
                        }))
                      }
                      className={cn(
                        "flex min-h-11 items-center justify-between gap-3 px-3 py-2.5 text-sm font-medium",
                        optionTileClass(enabled),
                      )}
                    >
                      {label}
                      <SwitchTrack on={enabled} />
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <h4 className="text-ink">Channels by post type</h4>
                <p className="mt-1 text-sm text-ink-2">
                  Salespeople only see the channels you leave checked. Each post type
                  keeps at least one.
                </p>
              </div>
              <ul className="divide-y divide-hairline rounded-md border border-hairline bg-panel">
                {(Object.keys(CATEGORY_OUTPUTS) as BrandCategoryId[]).map(
                  (category) => {
                    const output = CATEGORY_OUTPUTS[category];
                    const configured = categoryDestinations?.[category];
                    const selected = configured?.platformIds || [...output.platformIds];
                    return (
                      <li key={category} className="px-4 py-3">
                        <div className="text-sm font-semibold text-ink">
                          {CATEGORY_LABELS[category]}
                        </div>
                        <div
                          role="group"
                          aria-label={`${CATEGORY_LABELS[category]} channels`}
                          className="mt-2 flex flex-wrap gap-2"
                        >
                          {output.platformIds.map((platformId) => {
                            const checked = selected.includes(platformId);
                            return (
                              <label
                                key={platformId}
                                className={cn(
                                  "flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm",
                                  optionTileClass(checked),
                                )}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    const nextIds = checked
                                      ? selected.filter((id) => id !== platformId)
                                      : [...selected, platformId];
                                    if (nextIds.length === 0) return;
                                    setCategoryDestinations((current) => ({
                                      ...(current || {}),
                                      [category]: {
                                        platformIds: nextIds,
                                        formatIds: configured?.formatIds || [
                                          ...output.formatIds,
                                        ],
                                        video: configured?.video ?? output.videoAllowed,
                                      },
                                    }));
                                  }}
                                  className="h-4 w-4 shrink-0 accent-brand-fill"
                                />
                                {DESTINATION_LABELS[platformId] || platformId}
                              </label>
                            );
                          })}
                        </div>
                      </li>
                    );
                  },
                )}
              </ul>
            </div>
          </div>
        ) : null}
      </section>

      {error && (
        <div
          role="alert"
          className="rounded-sm border border-error-ink/30 bg-error-fill px-3 py-2 text-sm text-error-ink"
        >
          {error}
        </div>
      )}

      <div
        data-testid="dealer-settings-save-bar"
        className="sticky bottom-2 z-10 flex min-h-14 items-center justify-between gap-3 rounded-md border border-hairline bg-overlay px-3 py-2 sm:px-4"
      >
        <div className="text-sm text-ink-2" aria-live="polite">
          {dirty
            ? "Unsaved changes"
            : savedAt
              ? `Saved ${savedAt.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
              : "Up to date"}
        </div>
        <Button
          variant="primary"
          size="md"
          disabled={!dirty || saving}
          loading={saving}
          onClick={handleSave}
        >
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
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
      setError(toUiMessage(err, "Could not mark the code as shared."));
    } finally {
      setCodeBusy(false);
    }
  };

  return (
    <div className="space-y-6 rounded-md border border-hairline bg-panel p-5 sm:p-6">
      <div>
        <h3 className="text-ink">Your team</h3>
        <p className="mt-1 text-sm text-ink-2">
          Each salesperson gets a personal 4-digit code for sign-in and is tied to their
          posts automatically. Deactivate anyone who leaves — historical posts stay
          intact.
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <Input
            id="manager-add-salesperson"
            label="Add salesperson"
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value.slice(0, 120))}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || !newName.trim() || saving) return;
              event.preventDefault();
              void handleAdd();
            }}
            placeholder="e.g. Sarah Chen"
            fullWidth
          />
        </div>
        <Button
          variant="primary"
          size="md"
          className="w-full sm:w-auto"
          disabled={!newName.trim() || saving}
          loading={saving}
          onClick={handleAdd}
        >
          Add
        </Button>
      </div>

      {oneTimeCode && (
        <div
          className="rounded-md border border-warning-ink/30 bg-warning-fill p-4 text-sm text-ink"
          role="status"
          aria-label="Access code ready to share"
        >
          <div className="font-semibold text-ink">
            {oneTimeCode.name}&apos;s access code is ready
          </div>
          <p className="mt-1 text-ink-2">
            Copy this one-time access code and share it privately. This handoff stays
            here until you mark it as shared.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <span className="flex min-h-11 flex-1 items-center justify-center rounded-sm border border-hairline bg-panel-raised px-3 font-display text-2xl tabular-nums tracking-[0.3em] text-ink">
              {oneTimeCode.pin}
            </span>
            <Button
              variant="secondary"
              size="md"
              disabled={codeBusy}
              leftIcon={
                codeCopied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )
              }
              onClick={() => void handleCopyOneTimeCode()}
            >
              {codeCopied ? "Copied" : "Copy"}
            </Button>
            <Button
              variant="primary"
              size="md"
              disabled={codeBusy}
              loading={codeBusy}
              onClick={() => void handleAcknowledgeOneTimeCode()}
            >
              {codeBusy ? "Updating…" : "Mark as shared"}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-sm border border-error-ink/30 bg-error-fill px-3 py-2 text-sm text-error-ink"
        >
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-ink-2">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" /> Loading
          roster…
        </div>
      ) : roster.length === 0 ? (
        <div className="py-12 text-center text-sm text-ink-2">
          No one on the roster yet — add your first teammate above.
        </div>
      ) : (
        <ul className="divide-y divide-hairline border-t border-hairline">
          {roster.map((p) => (
            <li
              key={p.id || `loose:${p.name}`}
              className="flex items-center justify-between gap-3 py-3"
            >
              <div className={cn("min-w-0", !p.active && "opacity-60")}>
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                  {p.name}
                  {!p.id && <Badge variant="neutral">Not on roster</Badge>}
                  {!p.active && p.id && <Badge variant="neutral">Inactive</Badge>}
                  {p.id &&
                    (p.pinNeedsDistribution ? (
                      <Badge variant="warning">Code to share</Badge>
                    ) : p.hasPin ? (
                      <Badge variant="success">Code set</Badge>
                    ) : (
                      <Badge variant="neutral">No code</Badge>
                    ))}
                </div>
                <div className="mt-0.5 text-caption text-ink-2">
                  {p.count > 0
                    ? `${p.count} post${p.count === 1 ? "" : "s"}${
                        p.lastAt
                          ? `, last on ${new Date(p.lastAt).toLocaleDateString()}`
                          : ""
                      }`
                    : "No posts yet"}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
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
                      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm text-ink-2 transition-colors duration-120 ease-out hover:bg-fill-subtle hover:text-ink"
                      title="Edit profile"
                      aria-label={`Edit ${p.name}`}
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <Button
                      type="button"
                      variant={p.active ? "ghost" : "secondary"}
                      size="md"
                      onClick={() => p.id && handleToggleActive(p.id, p.active)}
                      title={p.active ? "Deactivate" : "Reactivate"}
                    >
                      {p.active ? "Deactivate" : "Reactivate"}
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    size="md"
                    onClick={() => handlePromoteLoose(p.name)}
                    disabled={saving}
                    title="Add this person to the formal roster"
                  >
                    Add to roster
                  </Button>
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
    </div>
  );
};
