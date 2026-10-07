import {
  StyleOption,
  type BrandCategoryId,
  type Dealer,
  type SignatureLook,
} from "../types";
import type { PersonSummary } from "./salespeople";
import {
  CATEGORY_OUTPUTS,
  DEFAULT_SIGNATURE_LOOK,
  LEGACY_DEFAULT_STYLE,
  LOOK_DEFINITIONS,
  brandCategoryForScenario,
  isFeatureAllowed,
  isSignatureLook,
  isStyleOption,
  resolveCreative,
  type ResolvedMotion,
} from "./creativeSystem";
import { POST_SCENARIOS, getScenariosForDealer } from "./postScenarios";
import {
  getPrimaryImageProfile,
  resolvePrimaryImageProfile,
  type PrimaryImageProfile,
} from "./platformCopy";
import { buildEmployeeDisclosure } from "../utils/complianceDisclosures";
// utils/postLabels imports homeTilesForDealer from this module, so the two form
// an import cycle. That is safe only while each side reads the other's exports
// inside functions, never while its module body is evaluating: use
// CHANNEL_LABELS at call time only.
import { CHANNEL_LABELS } from "../utils/postLabels";
import { dealershipMentionFor } from "../utils/socialAttribution";

export interface HomeTile {
  categoryId: BrandCategoryId;
  label: string;
  blurb: string;
  scenarioId: string;
}

export const HOME_TILES: readonly HomeTile[] = Object.freeze([
  {
    categoryId: "deliveries",
    label: "Delivery",
    blurb: "Customer + their new car",
    scenarioId: "customer_delivery",
  },
  {
    categoryId: "inventory",
    label: "New arrival",
    blurb: "Fresh on the lot",
    scenarioId: "new_arrival",
  },
  {
    categoryId: "service",
    label: "Service",
    blurb: "Service specials",
    scenarioId: "service_promotion",
  },
  {
    categoryId: "promotions",
    label: "Promotion",
    blurb: "Sales & events",
    scenarioId: "model_year_end",
  },
  {
    categoryId: "community",
    label: "Community",
    blurb: "Around town",
    scenarioId: "community_event",
  },
  {
    categoryId: "team",
    label: "Team",
    blurb: "People of the store",
    scenarioId: "team_anniversary",
  },
]);

export interface StoreChannel {
  id: string;
  label: string;
}

export interface StoreLook {
  id: SignatureLook | StyleOption;
  label: string;
  style: StyleOption;
}

export interface StoreDefaults {
  releaseRequired: boolean;
  vehicleRelevant: boolean;
  channels: StoreChannel[];
  defaultChannelId: string;
  generationPlatformIds: string[];
  primaryProfile: PrimaryImageProfile;
  looks: StoreLook[];
  defaultLookId: StoreLook["id"];
  videoAllowed: boolean;
  motion: ReturnType<typeof resolveCreative>["motion"];
  playfulStyleId: string | null;
  facebookTag: string;
  /** The FTC team-member disclosure; it belongs on every post, whatever the category. */
  employeeDisclosure: string;
  /** The store's approval switch (`requires_approval`); the server decides per post. */
  requiresApproval: boolean;
  websiteChannel: boolean;
  /** The style Details generates with; `defaultLookId` is always the Look for it. */
  style: StyleOption;
  tone: ReturnType<typeof resolveCreative>["tone"];
}

/**
 * Chip order per post type. One chip per label: the first kept id wins, so the
 * Instagram story stands in for Instagram only when the manager unchecked the
 * Instagram feed. The names come from `CHANNEL_LABELS` in utils/postLabels, the
 * list My work uses, so a share keeps its name from the chip to the history.
 */
const CHANNEL_ORDER: Record<BrandCategoryId, readonly string[]> = {
  deliveries: ["facebook_feed", "instagram_feed", "instagram_story"],
  inventory: ["facebook_feed", "instagram_feed", "marketplace"],
  service: ["facebook_feed", "gbp"],
  promotions: ["facebook_feed", "instagram_feed", "instagram_story"],
  community: ["facebook_feed", "gbp"],
  team: ["facebook_feed", "linkedin"],
};

const parseTown = (address?: string) => {
  const parts = (address || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2].replace(/^\d+\s+/, "") : "town";
};

export const homeTilesForDealer = (dealer: Dealer | null | undefined): HomeTile[] => {
  const town = parseTown(dealer?.address);
  const base = HOME_TILES.map((tile) =>
    tile.categoryId === "community"
      ? { ...tile, blurb: `Around ${town}` }
      : { ...tile },
  );
  const builtInIds = new Set(POST_SCENARIOS.map((scenario) => scenario.id));
  const custom = getScenariosForDealer(dealer?.custom_scenarios)
    .filter((scenario) => !builtInIds.has(scenario.id))
    .map((scenario) => ({
      categoryId:
        brandCategoryForScenario(scenario.id, dealer?.custom_scenarios) ?? "deliveries",
      label: scenario.label,
      blurb: scenario.blurb,
      scenarioId: scenario.id,
    }));
  return [...base, ...custom];
};

/** The Look slate a salesperson sees is small on purpose (flow spec, decision 3). */
const MAX_OFFERED_LOOKS = 3;

/** A legacy store that never chose its styles is offered these three. */
const LEGACY_DEFAULT_LOOK_STYLES: readonly StyleOption[] = Object.freeze([
  StyleOption.Luxury,
  StyleOption.Modern,
  StyleOption.Friendly,
]);

/** The manager's enabled styles, in the manager's order; empty means "all". */
const enabledLegacyStyles = (dealer: Dealer | null | undefined): StyleOption[] => {
  const styles: StyleOption[] = [];
  for (const entry of (dealer?.enabled_styles || "").split(",")) {
    const value = entry.trim();
    if (isStyleOption(value) && !styles.includes(value)) styles.push(value);
  }
  return styles;
};

/**
 * The style a store without the creative system renders, by the rule the old
 * customizer used, so a store keeps the style it renders today: the store's
 * default style if the manager kept it, else the app default if kept, else the
 * first kept style in the order the manager's settings list shows them.
 * `preferred` is the resolver's style (the default style, else the app default).
 */
const legacyRenderedStyle = (
  preferred: StyleOption,
  enabled: readonly StyleOption[],
): StyleOption => {
  if (enabled.length === 0) return preferred;
  for (const candidate of [preferred, LEGACY_DEFAULT_STYLE]) {
    if (enabled.includes(candidate)) return candidate;
  }
  return (
    Object.values(StyleOption).find((style) => enabled.includes(style)) ?? enabled[0]
  );
};

/**
 * Keep `offered` in order and capped, but always keep a place for the Look
 * that was rendered: the selector must be able to show what is on screen.
 */
const offerIncluding = <T>(offered: readonly T[], rendered: T): T[] => {
  const withRendered = offered.includes(rendered)
    ? [...offered]
    : [...offered, rendered];
  const capped = withRendered.slice(0, MAX_OFFERED_LOOKS);
  return capped.includes(rendered)
    ? capped
    : [...capped.slice(0, MAX_OFFERED_LOOKS - 1), rendered];
};

/**
 * Same rule the creative resolver uses for v2 destinations: a store can only
 * remove channels from the category default, and an empty or invalid list
 * falls back to the default (a post with nowhere to go helps nobody).
 */
const narrowToCategory = (
  defaults: readonly string[],
  requested: unknown,
): string[] => {
  if (!Array.isArray(requested)) return [...defaults];
  const wanted = new Set(
    requested.filter((entry): entry is string => typeof entry === "string"),
  );
  const kept = defaults.filter((id) => wanted.has(id));
  return kept.length > 0 ? kept : [...defaults];
};

/**
 * The house motion for a store that has not switched on the creative system:
 * the store's `motion_signature` where valid, otherwise the house Look's motion
 * with the default aspect and soundtrack. It runs the resolver's own motion
 * rule against the house Look, so the validation cannot drift from v2's.
 */
const houseMotion = (dealer: Dealer | null | undefined): ResolvedMotion | null =>
  resolveCreative({
    dealer: {
      id: dealer?.id || "",
      name: dealer?.name || "",
      motion_signature: dealer?.motion_signature ?? null,
      creative_system_v2: true,
      signature_look: DEFAULT_SIGNATURE_LOOK,
    },
  }).motion;

const toLegacyLook = (style: StyleOption): StoreLook => ({
  id: style,
  label: style,
  style,
});

const toSignatureLook = (id: SignatureLook): StoreLook => ({
  id,
  label: LOOK_DEFINITIONS[id].label,
  style: LOOK_DEFINITIONS[id].style,
});

export const resolveStoreDefaults = ({
  dealer,
  person,
  categoryId,
  scenarioId,
  websiteReady,
}: {
  dealer: Dealer | null | undefined;
  person: PersonSummary | null | undefined;
  categoryId: BrandCategoryId;
  scenarioId: string;
  websiteReady: boolean;
}): StoreDefaults => {
  const scenarios = getScenariosForDealer(dealer?.custom_scenarios);
  const scenario = scenarios.find((entry) => entry.id === scenarioId) || scenarios[0];
  const creative = resolveCreative({ dealer: dealer ?? null, categoryId, scenarioId });
  const output = CATEGORY_OUTPUTS[categoryId];
  const destination = dealer?.category_destinations?.[categoryId];
  const personId = person?.id;

  // Channels by post type apply to every store on the new flow, not only to
  // stores that switched on the creative system.
  const generationPlatformIds = creative.enabled
    ? creative.platformIds
    : narrowToCategory(output.platformIds, destination?.platformIds);
  const availableChannelIds = new Set(generationPlatformIds);
  const channels: StoreChannel[] = [];
  for (const id of CHANNEL_ORDER[categoryId]) {
    const label = CHANNEL_LABELS[id];
    if (!availableChannelIds.has(id) || channels.some((chip) => chip.label === label))
      continue;
    channels.push({ id, label });
  }

  // The Look slate always contains the Look Details rendered with, and that
  // Look is the one selected, so the selector never labels a render wrongly.
  let looks: StoreLook[];
  let style: StyleOption;
  let defaultLookId: StoreLook["id"];
  if (creative.enabled) {
    const rendered = creative.look ?? DEFAULT_SIGNATURE_LOOK;
    const lookIds = [rendered, dealer?.alternate_look]
      .filter(isSignatureLook)
      .filter((id, index, ids) => ids.indexOf(id) === index);
    looks = lookIds.slice(0, MAX_OFFERED_LOOKS).map(toSignatureLook);
    style = creative.style;
    defaultLookId = rendered;
  } else {
    // A legacy store never renders a style the manager hid.
    const enabled = enabledLegacyStyles(dealer);
    const rendered = legacyRenderedStyle(creative.style, enabled);
    looks = offerIncluding(
      enabled.length ? enabled : LEGACY_DEFAULT_LOOK_STYLES,
      rendered,
    ).map(toLegacyLook);
    style = rendered;
    defaultLookId = rendered;
  }

  // Team feature access (with any per-person override) and the per-category
  // video switch apply to every store. "Add video" needs a motion to render.
  const motion = creative.motion ?? houseMotion(dealer);
  const categoryVideo =
    output.videoAllowed &&
    (destination?.video === undefined || destination.video === true);
  const playfulStyle = (dealer?.playful_style || "").trim();

  return {
    releaseRequired: Boolean(scenario?.requiresCustomer || categoryId === "deliveries"),
    vehicleRelevant: ["deliveries", "inventory", "service", "promotions"].includes(
      categoryId,
    ),
    channels,
    defaultChannelId: channels[0]?.id || "facebook_feed",
    generationPlatformIds,
    primaryProfile:
      creative.enabled && creative.formatIds[0]
        ? getPrimaryImageProfile(
            creative.formatIds[0] as PrimaryImageProfile["primaryFormatId"],
          )
        : resolvePrimaryImageProfile(generationPlatformIds),
    looks,
    defaultLookId,
    videoAllowed:
      motion !== null && categoryVideo && isFeatureAllowed(dealer, "video", personId),
    motion,
    playfulStyleId:
      playfulStyle && isFeatureAllowed(dealer, "playful", personId)
        ? playfulStyle
        : null,
    facebookTag: dealershipMentionFor("facebook_feed", dealer),
    employeeDisclosure: buildEmployeeDisclosure(dealer),
    // The server stamps approval from this switch alone; an approval policy can
    // only narrow it there. The client never guesses "no review" from a policy.
    requiresApproval: dealer?.requires_approval === true,
    websiteChannel: websiteReady,
    style,
    tone: creative.tone,
  };
};
