/**
 * Creative resolver — the one place that answers "what creative parameters
 * apply to this post?".
 *
 * Spec: docs/superpowers/specs/2026-09-02-brand-consistent-creative-system.md
 * (§4.1 Signature Looks, §4.2 Playful, §4.3 Motion, §4.4 fixed export and
 * destination sets, §9 phase 2).
 *
 * Today three authorities fight over the same two values: the dealership's
 * `default_style`, each scenario's `defaultStyle`/`defaultTone`, and the
 * salesperson's per-device preferred style/tone. This module replaces all
 * three — but only for a dealership that has opted in via the
 * `creative_system_v2` flag.
 *
 * SAFETY PROPERTY: when the flag is off (the default for every existing
 * dealership) `resolveCreative` returns `enabled: false` with the style/tone
 * the app already computes, empty destination lists, and every permission
 * boolean `true`. A caller that honours "enabled" therefore behaves exactly as
 * it does today. `creativeSystem.test.ts` pins that property.
 *
 * This module is pure: no React, no network, no persistence. It reads only the
 * dealer record plus the post's category/scenario.
 */
import {
  StyleOption,
  ToneOption,
  VideoStyle,
  type BrandCategoryId,
  type Dealer,
  type FeaturePermissionKey,
  type MotionAspect,
  type MotionAudio,
  type SignatureLook,
} from "../types";
import type { ExportFormatId } from "../utils/multiFormatExport";
import type { PlatformId } from "./platformCopy";
import { getScenariosForDealer, type ScenarioCategory } from "./postScenarios";

// ---------------------------------------------------------------------------
// Signature Looks (spec §4.1)
// ---------------------------------------------------------------------------

export interface LookDefinition {
  /** Salesperson/admin-facing name. */
  readonly label: string;
  /** One-line art direction shown next to the picker. */
  readonly description: string;
  /** Image treatment applied to every post for this dealership. */
  readonly style: StyleOption;
  /** Caption voice; also passed to the image model as brief context. */
  readonly tone: ToneOption;
  /** Motion style bound to the Look when the dealer sets no override. */
  readonly motionStyle: VideoStyle;
}

/**
 * The three curated Looks. A dealership picks exactly one; a manager may
 * enable one alternate. Nothing else may set style or tone once the creative
 * system is enabled — that is the whole point of the Look.
 */
export const LOOK_DEFINITIONS: Readonly<Record<SignatureLook, LookDefinition>> =
  Object.freeze({
    showroom: Object.freeze({
      label: "Showroom",
      // No Look names a logo corner: the store's own corner
      // (dealer.logo_placement, services/logoPlacement.ts) decides it.
      description:
        "Premium and composed. Clean type, logo in the corner, warm key light.",
      style: StyleOption.Luxury,
      tone: ToneOption.Professional,
      motionStyle: VideoStyle.GoldenRadiance,
    }),
    hometown: Object.freeze({
      label: "Hometown",
      description: "Warm and neighborly. Headline over the photo, people first.",
      style: StyleOption.Friendly,
      tone: ToneOption.Family,
      motionStyle: VideoStyle.Spotlight,
    }),
    turbo: Object.freeze({
      label: "Turbo",
      description: "Bold and high-energy. Heavy type, strong contrast, motion cues.",
      style: StyleOption.Sporty,
      tone: ToneOption.Excited,
      motionStyle: VideoStyle.LiquidChrome,
    }),
  });

/** Used whenever a dealership has enabled the system but not yet picked a Look. */
export const DEFAULT_SIGNATURE_LOOK: SignatureLook = "showroom";

const SIGNATURE_LOOK_IDS = Object.keys(LOOK_DEFINITIONS) as SignatureLook[];

export const isSignatureLook = (value: unknown): value is SignatureLook =>
  typeof value === "string" && SIGNATURE_LOOK_IDS.includes(value as SignatureLook);

// ---------------------------------------------------------------------------
// Fixed export + destination sets per category (spec §4.4)
// ---------------------------------------------------------------------------

export interface CategoryOutput {
  /** EXPORT_FORMATS ids, in delivery order (primary canvas first). */
  readonly formatIds: readonly ExportFormatId[];
  /** publishTargets ids pre-wired for the category. */
  readonly platformIds: readonly PlatformId[];
  /** Whether the category may produce a motion asset at all. */
  readonly videoAllowed: boolean;
}

/**
 * Spec §4.4, verbatim. Every id is asserted against the real
 * `EXPORT_FORMATS` / `PUBLISH_TARGETS` catalogs in creativeSystem.test.ts, so a
 * renamed format or platform fails the suite instead of silently dropping a
 * destination.
 */
export const CATEGORY_OUTPUTS: Readonly<Record<BrandCategoryId, CategoryOutput>> =
  Object.freeze({
    deliveries: Object.freeze({
      formatIds: Object.freeze(["feed_portrait", "story_vertical"]),
      platformIds: Object.freeze([
        "instagram_feed",
        "instagram_story",
        "facebook_feed",
      ]),
      videoAllowed: true,
    }),
    inventory: Object.freeze({
      formatIds: Object.freeze(["feed_portrait", "marketplace"]),
      platformIds: Object.freeze(["instagram_feed", "facebook_feed", "marketplace"]),
      videoAllowed: true,
    }),
    service: Object.freeze({
      formatIds: Object.freeze(["feed_portrait", "gbp"]),
      platformIds: Object.freeze(["facebook_feed", "gbp"]),
      videoAllowed: false,
    }),
    promotions: Object.freeze({
      formatIds: Object.freeze(["feed_portrait", "story_vertical"]),
      platformIds: Object.freeze([
        "instagram_feed",
        "instagram_story",
        "facebook_feed",
      ]),
      videoAllowed: true,
    }),
    community: Object.freeze({
      formatIds: Object.freeze(["feed_portrait", "gbp"]),
      platformIds: Object.freeze(["facebook_feed", "gbp"]),
      videoAllowed: false,
    }),
    team: Object.freeze({
      formatIds: Object.freeze(["feed_portrait", "feed_square"]),
      platformIds: Object.freeze(["facebook_feed", "linkedin"]),
      videoAllowed: false,
    }),
  }) as Readonly<Record<BrandCategoryId, CategoryOutput>>;

const BRAND_CATEGORY_IDS = Object.keys(CATEGORY_OUTPUTS) as BrandCategoryId[];

export const isBrandCategoryId = (value: unknown): value is BrandCategoryId =>
  typeof value === "string" && BRAND_CATEGORY_IDS.includes(value as BrandCategoryId);

/**
 * Scenario categories (services/postScenarios.ts) use the shorter legacy ids.
 * The six Customer Hub / destination categories are the canonical ones.
 */
const SCENARIO_CATEGORY_TO_BRAND_CATEGORY: Readonly<
  Record<ScenarioCategory, BrandCategoryId>
> = Object.freeze({
  delivery: "deliveries",
  inventory: "inventory",
  service: "service",
  promo: "promotions",
  community: "community",
  team: "team",
});

/** Canonical default when a post carries neither a category nor a scenario. */
export const DEFAULT_BRAND_CATEGORY: BrandCategoryId = "deliveries";

/**
 * Map a scenario id (built-in or a dealer's custom scenario) to its category.
 * Reuses the scenario catalog rather than restating scenario → category here.
 * Returns null for an unknown id so callers can fall back deliberately.
 */
export const brandCategoryForScenario = (
  scenarioId?: string,
  customScenariosJson?: string,
): BrandCategoryId | null => {
  const id = (scenarioId || "").trim();
  if (!id) return null;
  const scenario = getScenariosForDealer(customScenariosJson).find((s) => s.id === id);
  if (!scenario) return null;
  return SCENARIO_CATEGORY_TO_BRAND_CATEGORY[scenario.category] ?? null;
};

// ---------------------------------------------------------------------------
// Motion (spec §4.3)
// ---------------------------------------------------------------------------

/** 9:16 is the house format; a manager may add the 16:9 variant. */
export const DEFAULT_MOTION_ASPECTS: readonly MotionAspect[] = Object.freeze(["9:16"]);
/** Matches the Video Director's existing default soundtrack ("music on"). */
export const DEFAULT_MOTION_AUDIO: MotionAudio = "cinematic";

export interface ResolvedMotion {
  style: VideoStyle;
  aspects: string[];
  audio: string;
}

const VIDEO_STYLE_VALUES = Object.values(VideoStyle) as string[];
const MOTION_ASPECT_VALUES: readonly string[] = ["9:16", "16:9"];
const MOTION_AUDIO_VALUES: readonly string[] = [
  "none",
  "celebration",
  "cinematic",
  "anthemic",
  "funk",
];

const asVideoStyle = (value: unknown): VideoStyle | null =>
  typeof value === "string" && VIDEO_STYLE_VALUES.includes(value)
    ? (value as VideoStyle)
    : null;

const asMotionAspects = (value: unknown): MotionAspect[] | null => {
  if (!Array.isArray(value)) return null;
  const kept: MotionAspect[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    if (!MOTION_ASPECT_VALUES.includes(entry)) continue;
    if (!kept.includes(entry as MotionAspect)) kept.push(entry as MotionAspect);
  }
  return kept.length > 0 ? kept : null;
};

const asMotionAudio = (value: unknown): MotionAudio | null =>
  typeof value === "string" && MOTION_AUDIO_VALUES.includes(value)
    ? (value as MotionAudio)
    : null;

// ---------------------------------------------------------------------------
// Feature permissions (spec §5, "Enable Playful / video for team or person")
// ---------------------------------------------------------------------------

/**
 * Read one feature gate. An unset permission is permissive, which keeps a
 * dealership that enables the creative system before configuring permissions
 * exactly as capable as it was the day before.
 *
 * `personId` is a salespeople record id; a per-person override wins over the
 * team default.
 */
export const isFeatureAllowed = (
  dealer: Dealer | null | undefined,
  key: FeaturePermissionKey,
  personId?: string,
): boolean => {
  const permission = dealer?.feature_permissions?.[key];
  if (!permission || typeof permission !== "object") return true;
  const id = (personId || "").trim();
  if (id) {
    const override = permission.people?.[id];
    if (typeof override === "boolean") return override;
  }
  return permission.team !== false;
};

// ---------------------------------------------------------------------------
// The resolver
// ---------------------------------------------------------------------------

/**
 * Legacy terminal defaults. These mirror the per-device preference defaults in
 * stores/appStore.ts, so the disabled branch lands on today's values when the
 * caller passes no fallback and the dealer set no `default_style`.
 */
export const LEGACY_DEFAULT_STYLE: StyleOption = StyleOption.Modern;
export const LEGACY_DEFAULT_TONE: ToneOption = ToneOption.Excited;

const STYLE_VALUES = Object.values(StyleOption) as string[];
const TONE_VALUES = Object.values(ToneOption) as string[];

export const isStyleOption = (value: unknown): value is StyleOption =>
  typeof value === "string" && STYLE_VALUES.includes(value);

export const isToneOption = (value: unknown): value is ToneOption =>
  typeof value === "string" && TONE_VALUES.includes(value);

/** True only for a dealership that has explicitly opted into phase 2. */
export const isCreativeSystemEnabled = (dealer: Dealer | null | undefined): boolean =>
  dealer?.creative_system_v2 === true;

/** The Look in force; unset or unrecognized falls back to the house default. */
export const resolveSignatureLook = (
  dealer: Dealer | null | undefined,
): SignatureLook =>
  isSignatureLook(dealer?.signature_look)
    ? dealer.signature_look
    : DEFAULT_SIGNATURE_LOOK;

export interface ResolvedCreative {
  /** False = legacy behavior; every list is empty and every gate is open. */
  enabled: boolean;
  /** The Look that produced `style`/`tone`; null while disabled. */
  look: SignatureLook | null;
  style: StyleOption;
  tone: ToneOption;
  /** Fixed motion format, or null while disabled. */
  motion: ResolvedMotion | null;
  /** The single dealership Fun Mode style id, or null when unset/disabled. */
  playfulStyleId: string | null;
  platformIds: PlatformId[];
  formatIds: string[];
  videoAllowed: boolean;
  playfulAllowed: boolean;
  freeTextEditAllowed: boolean;
}

export interface ResolveCreativeInput {
  dealer: Dealer | null;
  /** One of the six brand categories. Wins over `scenarioId` when supplied. */
  categoryId?: string;
  /** Built-in or dealer-custom scenario id; used to derive the category. */
  scenarioId?: string;
  /** Legacy style seed (restored params / per-device preference). */
  fallbackStyle?: StyleOption;
  /** Legacy tone seed (restored params / per-device preference). */
  fallbackTone?: ToneOption;
}

/**
 * Intersect a dealer's narrowed list with the category default. The default
 * order is preserved and nothing outside it can be added, so a dealership can
 * only ever remove destinations. An empty (or fully invalid) intersection
 * falls back to the category default — a post with zero destinations is not a
 * configuration anyone wants.
 */
const narrowToDefaults = <T extends string>(
  defaults: readonly T[],
  requested: unknown,
): T[] => {
  if (!Array.isArray(requested)) return [...defaults];
  const wanted = new Set(
    requested.filter((entry): entry is string => typeof entry === "string"),
  );
  const kept = defaults.filter((id) => wanted.has(id));
  return kept.length > 0 ? kept : [...defaults];
};

/**
 * Resolve every creative parameter for one post.
 *
 * Disabled (`creative_system_v2` !== true): `style`/`tone` follow today's
 * precedence — the caller's fallback first, then `dealer.default_style`, then
 * the legacy app defaults — and nothing else is prescribed or restricted.
 *
 * Enabled: `style` and `tone` come ONLY from the resolved Look. The scenario's
 * `defaultStyle`/`defaultTone` and any per-device preference are ignored by
 * design; motion, the Playful style, destinations, formats, and the feature
 * gates come from the dealer record.
 */
export const resolveCreative = (input: ResolveCreativeInput): ResolvedCreative => {
  const dealer = input.dealer;

  if (!isCreativeSystemEnabled(dealer)) {
    const dealerDefaultStyle = dealer?.default_style;
    const style = isStyleOption(input.fallbackStyle)
      ? input.fallbackStyle
      : isStyleOption(dealerDefaultStyle)
        ? dealerDefaultStyle
        : LEGACY_DEFAULT_STYLE;
    const tone = isToneOption(input.fallbackTone)
      ? input.fallbackTone
      : LEGACY_DEFAULT_TONE;
    return {
      enabled: false,
      look: null,
      style,
      tone,
      motion: null,
      playfulStyleId: null,
      platformIds: [],
      formatIds: [],
      videoAllowed: true,
      playfulAllowed: true,
      freeTextEditAllowed: true,
    };
  }

  const look = resolveSignatureLook(dealer);
  const definition = LOOK_DEFINITIONS[look];

  const category = isBrandCategoryId(input.categoryId)
    ? input.categoryId
    : (brandCategoryForScenario(input.scenarioId, dealer?.custom_scenarios) ??
      DEFAULT_BRAND_CATEGORY);
  const output = CATEGORY_OUTPUTS[category];
  const destination = dealer?.category_destinations?.[category];

  const platformIds = narrowToDefaults(output.platformIds, destination?.platformIds);
  const formatIds = narrowToDefaults(output.formatIds, destination?.formatIds);
  const categoryVideo =
    output.videoAllowed &&
    (destination?.video === undefined || destination.video === true);

  const signature = dealer?.motion_signature ?? null;
  const motion: ResolvedMotion = {
    style: asVideoStyle(signature?.style) ?? definition.motionStyle,
    aspects: [...(asMotionAspects(signature?.aspects) ?? DEFAULT_MOTION_ASPECTS)],
    audio: asMotionAudio(signature?.audio) ?? DEFAULT_MOTION_AUDIO,
  };

  const playfulStyle = (dealer?.playful_style || "").trim();

  return {
    enabled: true,
    look,
    style: definition.style,
    tone: definition.tone,
    motion,
    playfulStyleId: playfulStyle || null,
    platformIds,
    formatIds,
    videoAllowed: categoryVideo && isFeatureAllowed(dealer, "video"),
    playfulAllowed: isFeatureAllowed(dealer, "playful"),
    freeTextEditAllowed: isFeatureAllowed(dealer, "freeTextEdit"),
  };
};
