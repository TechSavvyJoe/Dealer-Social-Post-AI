/**
 * The manager's Dealership settings form as plain data: the constants and
 * limits the form applies, the approval-rule helpers, and the one place that
 * says which saved field belongs to which settings section.
 *
 * Pure: no React, no requests, no storage. The form state lives in
 * `useDealerSettingsForm`; this module only reads and compares values.
 */
import {
  StyleOption,
  ToneOption,
  VideoStyle,
  type ApprovalPolicy,
  type BrandCategoryId,
  type CategoryDestinations,
  type Dealer,
  type FeaturePermissions,
  type ImageQualityTier,
  type LogoCorner,
  type LogoPlacement,
  type MotionAspect,
  type MotionAudio,
  type MotionSignature,
  type SignatureLook,
} from "../../types";
import {
  defaultWeekHours,
  parseHoursString,
  serializeHours,
  type WeekHours,
} from "../../utils/hoursFormat";
import { normalizeDealerSocialProfileValue } from "../../utils/socialAttribution";
import {
  SETTINGS_SECTION_LABELS,
  joinWords,
  type SettingsSectionId,
} from "../../utils/dealerSetupStatus";
import {
  aspectRatios as motionAspectOptions,
  soundtracks as motionAudioOptions,
} from "../video-director/constants";
import type { SampleMark } from "./sampleProof";

export const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

// ---------------------------------------------------------------------------
// Brand-consistent creative system (spec 2026-09-02 §4.1–§4.3, §6). Limits
// mirror pb_hooks/helpers.js so the form reports problems inline instead of
// surfacing a 400 after the round trip.
// ---------------------------------------------------------------------------
export interface SignatureLookOption {
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
      "Polished photo, professional captions, clean type, logo in the corner.",
    tone: ToneOption.Professional,
    motionStyle: VideoStyle.GoldenRadiance,
  },
  {
    id: "hometown",
    label: "Hometown",
    description:
      "Friendly photo, family-friendly captions, a warm headline over the picture.",
    tone: ToneOption.Family,
    motionStyle: VideoStyle.Spotlight,
  },
  {
    id: "turbo",
    label: "Turbo",
    description: "Sporty photo, excited captions, bold type with depth.",
    tone: ToneOption.Excited,
    motionStyle: VideoStyle.LiquidChrome,
  },
];

export const LOGO_CORNER_OPTIONS: ReadonlyArray<{ id: LogoCorner; label: string }> = [
  { id: "top_left", label: "Top left" },
  { id: "top_right", label: "Top right" },
  { id: "bottom_left", label: "Bottom left" },
  { id: "bottom_right", label: "Bottom right" },
];

/** Logo width as a fraction of the canvas; mirrors LOGO_SCALE_MIN/MAX. */
export const LOGO_SCALE_MIN = 0.04;
export const LOGO_SCALE_MAX = 0.5;
export const LOGO_SCALE_DEFAULT = 0.18;
export const BRAND_VOICE_MAX_ITEMS = 3;
export const BRAND_VOICE_MAX_CHARS = 60;
export const MOTION_STYLE_MAX_CHARS = 40;
export const DEFAULT_MOTION_ASPECTS: MotionAspect[] = ["9:16"];
export const DEFAULT_MOTION_AUDIO: MotionAudio = "cinematic";

/** The server's logo limit (pb_hooks/helpers.js dealerLogoFile). */
export const LOGO_MAX_BYTES = 5 * 1024 * 1024;
export const LOGO_ACCEPT = "image/png,image/jpeg,image/webp";

export const CATEGORY_LABELS: Record<BrandCategoryId, string> = {
  deliveries: "Deliveries",
  inventory: "Inventory",
  service: "Service",
  promotions: "Promotions",
  community: "Community",
  team: "Team",
};
export const CATEGORY_IDS = Object.keys(CATEGORY_LABELS) as BrandCategoryId[];

export const DESTINATION_LABELS: Record<string, string> = {
  facebook_feed: "Facebook",
  instagram_feed: "Instagram",
  instagram_story: "Instagram Story",
  marketplace: "Marketplace",
  gbp: "Google Business",
  linkedin: "LinkedIn",
};

export const isBrandCategory = (value: unknown): value is BrandCategoryId =>
  typeof value === "string" && (CATEGORY_IDS as string[]).includes(value);

export const isSignatureLook = (value: unknown): value is SignatureLook =>
  SIGNATURE_LOOK_OPTIONS.some((option) => option.id === value);

export const isLogoCorner = (value: unknown): value is LogoCorner =>
  LOGO_CORNER_OPTIONS.some((option) => option.id === value);

export const isMotionAspect = (value: unknown): value is MotionAspect =>
  motionAspectOptions.some((option) => option.value === value);

export const isMotionAudio = (value: unknown): value is MotionAudio =>
  motionAudioOptions.some((option) => option.value === value);

// ---------------------------------------------------------------------------
// Manager approval. The server (pb_hooks/requestPolicies.js
// initialApprovalStatus) treats requires_approval as the switch and
// approval_policy as a narrowing that only applies while the switch is on.
// The form therefore never stores "none" or "always": off and "every post"
// both store null, and a narrowing is stored only while review is on.
// ---------------------------------------------------------------------------
export type ReviewScope = "every" | "first_n" | "per_category";
export const APPROVAL_FIRST_N_MIN = 1;
export const APPROVAL_FIRST_N_MAX = 100;
export const DEFAULT_APPROVAL_FIRST_N = 3;

export interface ReviewChoice {
  scope: ReviewScope;
  firstN: number;
  categories: BrandCategoryId[];
}

export const orderCategories = (ids: readonly BrandCategoryId[]): BrandCategoryId[] =>
  CATEGORY_IDS.filter((id) => ids.includes(id));

/** Read a saved policy the way the server applies it. */
export const readReviewChoice = (
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
export const toApprovalPolicy = (
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

export const clampFirstN = (value: number) =>
  Math.min(
    APPROVAL_FIRST_N_MAX,
    Math.max(APPROVAL_FIRST_N_MIN, Math.round(value) || APPROVAL_FIRST_N_MIN),
  );

// ---------------------------------------------------------------------------
// Derived defaults
// ---------------------------------------------------------------------------
/**
 * Hours and enabled styles both have a derived default when the dealer has
 * never saved them: a full default week, and every overlay style. The dirty
 * baseline has to run the SAME derivation as the initial state — comparing the
 * derived form value against a raw empty column made an untouched card report
 * itself dirty on mount, which enabled Save, raised "Discard unsaved
 * settings?" on tab switch, and armed the beforeunload prompt.
 */
export const deriveHoursWeek = (raw?: string): WeekHours =>
  parseHoursString(raw) || defaultWeekHours();

export const deriveEnabledStyles = (raw?: string): Set<string> => {
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

// ---------------------------------------------------------------------------
// The form's values, one per saved field, grouped by settings section
// ---------------------------------------------------------------------------
/**
 * Every value the form saves, in the shape the dirty check compares. Built
 * from the form state on each render (`useDealerSettingsForm`) and, for the
 * baseline, from the saved record (`savedFormValues`).
 */
export interface SettingsFormValues {
  // Store profile
  website: string;
  phone: string;
  address: string;
  /** Serialized hours, the string Save sends. */
  hours: string;
  tagline: string;
  oem: string;
  // Channels
  facebookUrl: string;
  facebookPageTag: string;
  instagramHandle: string;
  tiktokHandle: string;
  xHandle: string;
  linkedinCompanyTag: string;
  gbpUrl: string;
  // Voice
  voice: string;
  voiceDo: string[];
  voiceDont: string[];
  defaultHashtags: string;
  hashtagsLocked: boolean;
  defaultFooter: string;
  banned: string;
  // Creative
  signatureLook: SignatureLook | "";
  alternateLook: SignatureLook | "";
  playfulStyle: string;
  color: string;
  logoPlacement: LogoPlacement | null;
  motionSignature: MotionSignature | null;
  imageQualityTier: ImageQualityTier | "";
  /** Enabled styles joined with commas, the string Save sends. */
  enabledStyles: string;
  defaultStyle: string;
  // Workflow
  approval: boolean;
  /** Already normalised: null whenever review is off or covers every post. */
  approvalPolicy: ApprovalPolicy | null;
  disclosureOn: boolean;
  disclosureText: string;
  featurePermissions: FeaturePermissions | null;
  categoryDestinations: CategoryDestinations | null;
}

/** Which settings section each saved value belongs to. Every value is in exactly one. */
export const SECTION_FIELDS: Record<
  SettingsSectionId,
  ReadonlyArray<keyof SettingsFormValues>
> = {
  profile: ["website", "phone", "address", "hours", "tagline", "oem"],
  channels: [
    "facebookUrl",
    "facebookPageTag",
    "instagramHandle",
    "tiktokHandle",
    "xHandle",
    "linkedinCompanyTag",
    "gbpUrl",
  ],
  voice: [
    "voice",
    "voiceDo",
    "voiceDont",
    "defaultHashtags",
    "hashtagsLocked",
    "defaultFooter",
    "banned",
  ],
  creative: [
    "signatureLook",
    "alternateLook",
    "playfulStyle",
    "color",
    "logoPlacement",
    "motionSignature",
    "imageQualityTier",
    "enabledStyles",
    "defaultStyle",
  ],
  workflow: [
    "approval",
    "approvalPolicy",
    "disclosureOn",
    "disclosureText",
    "featurePermissions",
    "categoryDestinations",
  ],
};

export const SETTINGS_SECTION_ORDER: readonly SettingsSectionId[] = [
  "profile",
  "channels",
  "voice",
  "creative",
  "workflow",
];

/**
 * The baseline an untouched form compares against, read from the saved
 * record exactly as the form always has: derived hours and styles run the
 * same derivation as the initial state, and the approval policy goes through
 * the same normalisation as the form's, so a saved "always" / "none" /
 * empty-category policy (all of which review every post) never reads as an
 * unsaved edit.
 */
export const savedFormValues = (dealer: Dealer): SettingsFormValues => ({
  website: dealer.website || "",
  phone: dealer.phone || "",
  address: dealer.address || "",
  hours: serializeHours(deriveHoursWeek(dealer.hours)),
  tagline: dealer.tagline || "",
  oem: dealer.oem_affiliation || "",
  facebookUrl: dealer.facebook_url || "",
  facebookPageTag: dealer.facebook_page_tag || "",
  instagramHandle: dealer.instagram_handle || "",
  tiktokHandle: dealer.tiktok_handle || "",
  xHandle: dealer.x_handle || "",
  linkedinCompanyTag: dealer.linkedin_company_tag || "",
  gbpUrl: dealer.gbp_url || "",
  voice: dealer.brand_voice || "",
  voiceDo: dealer.brand_voice_do || [],
  voiceDont: dealer.brand_voice_dont || [],
  defaultHashtags: dealer.default_hashtags || "",
  hashtagsLocked: !!dealer.required_hashtags_locked,
  defaultFooter: dealer.default_footer || "",
  banned: dealer.banned_phrases || "",
  signatureLook: isSignatureLook(dealer.signature_look) ? dealer.signature_look : "",
  alternateLook: isSignatureLook(dealer.alternate_look) ? dealer.alternate_look : "",
  playfulStyle: dealer.playful_style || "",
  color: dealer.brand_color || "",
  logoPlacement: dealer.logo_placement ?? null,
  motionSignature: dealer.motion_signature ?? null,
  imageQualityTier: dealer.image_quality_tier || "",
  enabledStyles: Array.from(deriveEnabledStyles(dealer.enabled_styles)).join(","),
  defaultStyle: dealer.default_style || "",
  approval: !!dealer.requires_approval,
  approvalPolicy: toApprovalPolicy(
    !!dealer.requires_approval,
    readReviewChoice(!!dealer.requires_approval, dealer.approval_policy),
  ),
  disclosureOn: !dealer.employee_disclosure_disabled,
  disclosureText: dealer.employee_disclosure_text || "",
  featurePermissions: dealer.feature_permissions ?? null,
  categoryDestinations: dealer.category_destinations ?? null,
});

/**
 * Structured values compare by their canonical JSON; for a string or a
 * boolean that is the same test as `!==`.
 */
const differs = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);

/** Per section: does any of its values differ from the saved baseline? */
export const dirtySections = (
  current: SettingsFormValues,
  saved: SettingsFormValues,
): Record<SettingsSectionId, boolean> =>
  Object.fromEntries(
    SETTINGS_SECTION_ORDER.map((section) => [
      section,
      SECTION_FIELDS[section].some((field) => differs(current[field], saved[field])),
    ]),
  ) as Record<SettingsSectionId, boolean>;

/** "Store profile", "Channels and Voice", "Store profile, Voice and Workflow". */
export const dirtySectionLabels = (dirty: Record<SettingsSectionId, boolean>): string =>
  joinWords(
    SETTINGS_SECTION_ORDER.filter((section) => dirty[section]).map(
      (section) => SETTINGS_SECTION_LABELS[section],
    ),
  );

/**
 * The exact text values Save stores: trimmed, and the social handles through
 * the same normaliser the server applies. The sample post reads the same
 * values, so it never shows something Save would not send.
 */
export const storedTextValues = (values: SettingsFormValues) => ({
  voice: values.voice.trim(),
  banned: values.banned.trim(),
  color: values.color.trim(),
  oem: values.oem.trim(),
  disclosureText: values.disclosureText.trim(),
  website: values.website.trim(),
  phone: values.phone.trim(),
  address: values.address.trim(),
  tagline: values.tagline.trim(),
  facebookUrl: values.facebookUrl.trim(),
  facebookPageTag: normalizeDealerSocialProfileValue(
    "facebook_page_tag",
    values.facebookPageTag,
  ),
  instagramHandle: normalizeDealerSocialProfileValue(
    "instagram_handle",
    values.instagramHandle,
  ),
  tiktokHandle: normalizeDealerSocialProfileValue("tiktok_handle", values.tiktokHandle),
  xHandle: normalizeDealerSocialProfileValue("x_handle", values.xHandle),
  linkedinCompanyTag: normalizeDealerSocialProfileValue(
    "linkedin_company_tag",
    values.linkedinCompanyTag,
  ),
  gbpUrl: values.gbpUrl.trim(),
  defaultHashtags: values.defaultHashtags.trim(),
  defaultFooter: values.defaultFooter.trim(),
});

/**
 * The saved record overlaid with what Save would store for the current form
 * values. The sample post renders from this, so it is live and cannot drift
 * from the save.
 */
export const draftDealer = (dealer: Dealer, values: SettingsFormValues): Dealer => {
  const stored = storedTextValues(values);
  return {
    ...dealer,
    website: stored.website,
    phone: stored.phone,
    address: stored.address,
    hours: values.hours,
    tagline: stored.tagline,
    oem_affiliation: stored.oem,
    facebook_url: stored.facebookUrl,
    facebook_page_tag: stored.facebookPageTag,
    instagram_handle: stored.instagramHandle,
    tiktok_handle: stored.tiktokHandle,
    x_handle: stored.xHandle,
    linkedin_company_tag: stored.linkedinCompanyTag,
    gbp_url: stored.gbpUrl,
    brand_voice: stored.voice,
    brand_voice_do: values.voiceDo,
    brand_voice_dont: values.voiceDont,
    default_hashtags: stored.defaultHashtags,
    required_hashtags_locked: values.hashtagsLocked,
    default_footer: stored.defaultFooter,
    banned_phrases: stored.banned,
    signature_look: values.signatureLook,
    alternate_look: values.alternateLook,
    playful_style: values.playfulStyle,
    brand_color: stored.color,
    logo_placement: values.logoPlacement,
    motion_signature: values.motionSignature,
    image_quality_tier: values.imageQualityTier,
    enabled_styles: values.enabledStyles,
    default_style: values.defaultStyle,
    requires_approval: values.approval,
    approval_policy: values.approvalPolicy,
    employee_disclosure_disabled: !values.disclosureOn,
    employee_disclosure_text: stored.disclosureText,
    feature_permissions: values.featurePermissions,
    category_destinations: values.categoryDestinations,
  };
};

/** The part of the sample post each section marks (spec §2). */
export const SECTION_MARK: Record<SettingsSectionId, SampleMark> = {
  profile: "none",
  channels: "mention",
  voice: "closing",
  creative: "look",
  workflow: "disclosure",
};

/** The one sentence under each section title. */
export const SECTION_SENTENCES: Record<SettingsSectionId, string> = {
  profile: "The facts about your store that captions can use.",
  channels:
    "Add each page once. Every post your team shares then points back to the store.",
  voice: "How your captions sound, and what every caption carries.",
  creative: "One look for the whole store, so every post is recognizably yours.",
  workflow: "What happens between a salesperson's photo and a public post.",
};
