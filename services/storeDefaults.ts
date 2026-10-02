import {
  StyleOption,
  type ApprovalPolicy,
  type BrandCategoryId,
  type Dealer,
  type SignatureLook,
} from "../types";
import type { PersonSummary } from "./salespeople";
import {
  CATEGORY_OUTPUTS,
  LOOK_DEFINITIONS,
  brandCategoryForScenario,
  isFeatureAllowed,
  isSignatureLook,
  resolveCreative,
} from "./creativeSystem";
import { POST_SCENARIOS, getScenariosForDealer } from "./postScenarios";
import {
  getPrimaryImageProfile,
  resolvePrimaryImageProfile,
  type PrimaryImageProfile,
} from "./platformCopy";
import { buildEmployeeDisclosure } from "../utils/complianceDisclosures";
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
  employeeDisclosure: string;
  requiresApproval: boolean;
  websiteChannel: boolean;
  style: StyleOption;
  tone: ReturnType<typeof resolveCreative>["tone"];
}

interface FutureDealerDefaults {
  default_channels?: string[];
  offered_looks?: string[];
  category_slate?: Partial<
    Record<BrandCategoryId, { playful?: boolean; video?: boolean }>
  >;
}

const CHANNEL_LABELS: Record<string, string> = {
  facebook_feed: "Facebook",
  instagram_feed: "Instagram",
  instagram_story: "Instagram",
  marketplace: "Marketplace",
  gbp: "Google",
  linkedin: "LinkedIn",
};

const CHANNEL_ORDER: Record<BrandCategoryId, readonly string[]> = {
  deliveries: ["facebook_feed", "instagram_feed"],
  inventory: ["facebook_feed", "instagram_feed", "marketplace"],
  service: ["facebook_feed", "gbp"],
  promotions: ["facebook_feed", "instagram_feed"],
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

const approvalRequired = (
  policy: ApprovalPolicy | null | undefined,
  categoryId: BrandCategoryId,
  legacy?: boolean,
) => {
  if (!policy) return legacy === true;
  if (policy.mode === "always") return true;
  if (policy.mode === "per_category")
    return policy.categories?.includes(categoryId) === true;
  return policy.mode === "first_n" && (policy.firstN || 0) > 0;
};

const legacyLooks = (dealer: Dealer | null | undefined): StoreLook[] => {
  const enabled = (dealer?.enabled_styles || "")
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is StyleOption =>
      Object.values(StyleOption).includes(value as StyleOption),
    );
  const styles = enabled.length
    ? enabled
    : [StyleOption.Luxury, StyleOption.Modern, StyleOption.Friendly];
  return styles.slice(0, 3).map((style) => ({ id: style, label: style, style }));
};

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
  const future = (dealer || {}) as Dealer & FutureDealerDefaults;
  const scenarios = getScenariosForDealer(dealer?.custom_scenarios);
  const scenario = scenarios.find((entry) => entry.id === scenarioId) || scenarios[0];
  const creative = resolveCreative({ dealer: dealer ?? null, categoryId, scenarioId });
  const output = CATEGORY_OUTPUTS[categoryId];
  const generationPlatformIds =
    future.default_channels?.filter((id) => output.platformIds.includes(id)) ||
    (creative.enabled ? creative.platformIds : [...output.platformIds]);
  const availableChannelIds = new Set(generationPlatformIds);
  const uniqueChannelIds = CHANNEL_ORDER[categoryId].filter((id) =>
    availableChannelIds.has(id),
  );
  const channels = uniqueChannelIds.map((id) => ({ id, label: CHANNEL_LABELS[id] }));

  const configuredLookIds = (future.offered_looks || []).filter(isSignatureLook);
  const v2LookIds = [dealer?.signature_look, dealer?.alternate_look]
    .filter(isSignatureLook)
    .filter((id, index, ids) => ids.indexOf(id) === index);
  const lookIds = configuredLookIds.length ? configuredLookIds : v2LookIds;
  const looks: StoreLook[] = creative.enabled
    ? (lookIds.length ? lookIds : [creative.look || "showroom"])
        .slice(0, 3)
        .map((id) => ({
          id,
          label: LOOK_DEFINITIONS[id].label,
          style: LOOK_DEFINITIONS[id].style,
        }))
    : legacyLooks(dealer);
  const slate = future.category_slate?.[categoryId];
  const categoryAllowsVideo = !["service", "community", "team"].includes(categoryId);

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
    defaultLookId: looks[0].id,
    videoAllowed:
      categoryAllowsVideo && creative.videoAllowed && slate?.video !== false,
    motion: creative.motion,
    playfulStyleId:
      creative.playfulAllowed && slate?.playful !== false && dealer?.playful_style
        ? dealer.playful_style
        : null,
    facebookTag: dealershipMentionFor("facebook_feed", dealer),
    employeeDisclosure: categoryId === "team" ? buildEmployeeDisclosure(dealer) : "",
    requiresApproval: approvalRequired(
      dealer?.approval_policy,
      categoryId,
      dealer?.requires_approval,
    ),
    websiteChannel: websiteReady,
    style: creative.style,
    tone: creative.tone,
  };
};
