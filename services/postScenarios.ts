/**
 * Post scenario catalog.
 *
 * Today every post is implicitly a "customer delivery" post. Real
 * dealerships post for many more reasons — service promotions, pre-owned
 * highlights, recalls, community events, staff anniversaries. Each scenario
 * has different prompting needs, default style + tone, hashtag suggestions,
 * and even a different default subject (no customer required for an
 * inventory post).
 *
 * A scenario contributes to the creative brief by stamping a structured
 * "scenario" XML block. The model treats it as binding context that
 * dominates the default delivery-post framing.
 *
 * Future expansion: dealers can store CUSTOM scenarios as JSON on their
 * dealer record. This catalog is the built-in starter set.
 */
import { StyleOption, ToneOption, VideoStyle } from "../types";
import {
  KeyRound,
  Car,
  Wrench,
  Tag,
  HeartHandshake,
  Trophy,
  type LucideIcon,
} from "lucide-react";

export type ScenarioCategory =
  | "delivery"
  | "inventory"
  | "service"
  | "promo"
  | "community"
  | "team";

export interface PostScenario {
  id: string;
  label: string;
  category: ScenarioCategory;
  /** Short pitch shown on the picker tile. */
  blurb: string;
  /** Emoji or short visual marker for the tile (kept as text — no asset). */
  emoji: string;
  /** Suggested default StyleOption when this scenario is picked. */
  defaultStyle: StyleOption;
  /** Suggested default ToneOption when this scenario is picked. */
  defaultTone: ToneOption;
  /** Whether this scenario typically features a customer (vs. inventory-only). */
  requiresCustomer: boolean;
  /** Whether this scenario implies a vehicle in the photo (vs. people / store). */
  requiresVehicle: boolean;
  /** Prompt-addition block injected into the creative brief. */
  promptAdditions: string;
  /** Suggested extra hashtags appended to the dealer's default set. */
  suggestedHashtags: string[];
  /** Optional caption opener the salesperson can drop in. */
  starterCaption?: string;
  /**
   * Optional default video style (Veo) the Video Director will preselect
   * when this scenario is active. Salesperson can still override.
   */
  defaultVideoStyle?: VideoStyle;
  /**
   * Optional default Fun Mode style id (matches funStyles catalog in
   * services/promptConfig.ts). Pre-selects the artistic transform when the
   * salesperson opens Fun Mode while this scenario is active.
   */
  defaultFunStyle?: string;
}

export const POST_SCENARIOS: PostScenario[] = [
  {
    id: "customer_delivery",
    label: "Customer Delivery",
    category: "delivery",
    blurb: "Customer + their new car. The classic.",
    emoji: "🔑",
    defaultStyle: StyleOption.Friendly,
    defaultTone: ToneOption.Excited,
    requiresCustomer: true,
    requiresVehicle: true,
    promptAdditions: `Scenario: Customer delivery photo. Real customer just took ownership.
Lead with the customer (by first name when provided), not the vehicle spec sheet.
Tone: celebratory, brief, warm. Imply community ("welcome to the family / the {Dealer} crew").`,
    suggestedHashtags: ["#NewRide", "#HappyCustomer", "#DeliveryDay"],
    defaultVideoStyle: VideoStyle.GoldenRadiance,
    defaultFunStyle: "pixar",
  },
  {
    id: "preowned_spotlight",
    label: "Pre-Owned Spotlight",
    category: "inventory",
    blurb: "Quality used car on the lot — drive shoppers in.",
    emoji: "✨",
    defaultStyle: StyleOption.Modern,
    defaultTone: ToneOption.Promotional,
    requiresCustomer: false,
    requiresVehicle: true,
    promptAdditions: `Scenario: Pre-owned vehicle spotlight. Goal is to drive interested buyers to the lot.
Highlight the specific value: low mileage, clean Carfax, recent service, single owner — pick whichever the VIN data supports. Never invent equipment.
Soft call-to-action toward visiting or messaging. No prices unless explicitly provided.`,
    suggestedHashtags: ["#PreOwned", "#UsedCars", "#CertifiedPreOwned"],
    starterCaption: "Hand-picked. Inspected. Ready for its next chapter.",
    defaultVideoStyle: VideoStyle.Spotlight,
  },
  {
    id: "new_arrival",
    label: "New Arrival",
    category: "inventory",
    blurb: "Fresh unit just landed — first look.",
    emoji: "🚗",
    defaultStyle: StyleOption.Modern,
    defaultTone: ToneOption.Excited,
    requiresCustomer: false,
    requiresVehicle: true,
    promptAdditions: `Scenario: New arrival announcement. Vehicle just hit the lot.
Frame as a "first look" / "fresh on the floor" reveal. Emphasize availability — encourage the audience to be the first to test-drive.
Mention specific year/make/model/trim when the VIN data confirms it.`,
    suggestedHashtags: ["#NewArrival", "#JustIn", "#FirstLook"],
    starterCaption: "Just rolled onto the lot.",
    defaultVideoStyle: VideoStyle.GoldenRadiance,
  },
  {
    id: "trade_in_spotlight",
    label: "Trade-In Spotlight",
    category: "inventory",
    blurb: "Highlight a unit just taken in trade.",
    emoji: "🔄",
    defaultStyle: StyleOption.Friendly,
    defaultTone: ToneOption.Promotional,
    requiresCustomer: false,
    requiresVehicle: true,
    promptAdditions: `Scenario: Trade-in spotlight. A previous owner just traded this vehicle in — the dealership is announcing availability.
Emphasize "loved by its last owner" + "ready for the next" framing. Soft CTA to call before it hits the broader market.`,
    suggestedHashtags: ["#TradeIn", "#JustInTrade", "#PreOwned"],
    defaultVideoStyle: VideoStyle.Spotlight,
  },
  {
    id: "service_promotion",
    label: "Service Promotion",
    category: "service",
    blurb: "Oil change deal, tire rotation, service-due reminder.",
    emoji: "🔧",
    defaultStyle: StyleOption.Friendly,
    defaultTone: ToneOption.Promotional,
    requiresCustomer: false,
    requiresVehicle: false,
    promptAdditions: `Scenario: Service department promotion. May be an oil change special, tire deal, recall completion, or seasonal maintenance push.
Lead with the customer benefit (peace of mind, money saved) NOT the technical detail.
Avoid specific dollar amounts unless the salesperson typed them in.
End with a clear booking CTA — "schedule online" or "call the service desk."`,
    suggestedHashtags: ["#ServiceDept", "#AutoService", "#OilChange"],
  },
  {
    id: "recall_complete",
    label: "Recall Completion",
    category: "service",
    blurb: "Showed up, got it handled. Trust-builder post.",
    emoji: "✅",
    defaultStyle: StyleOption.Friendly,
    defaultTone: ToneOption.Professional,
    requiresCustomer: true,
    requiresVehicle: true,
    promptAdditions: `Scenario: Recall completion — a customer brought their vehicle in for a manufacturer recall and we resolved it the same day.
Frame as "another customer back on the road safely." Implicit trust-building, no boasting.
NEVER specify the recall details unless explicitly provided — most recall info is OEM-confidential.`,
    suggestedHashtags: ["#ServiceDept", "#PeaceOfMind"],
  },
  {
    id: "customer_testimonial",
    label: "Customer Testimonial",
    category: "delivery",
    blurb: "Quote-style post — customer's own words.",
    emoji: "💬",
    defaultStyle: StyleOption.Luxury,
    defaultTone: ToneOption.Inspirational,
    requiresCustomer: true,
    requiresVehicle: false,
    promptAdditions: `Scenario: Customer testimonial. The salesperson captured a quote from a real customer about their experience.
Frame as a pull-quote in the image overlay. Caption should attribute simply ("— {CustomerName}") and add a one-line gratitude sign-off from the dealership.
Do not embellish or invent — use the quote verbatim. If no quote is provided, decline gracefully and ask for one in the custom message.`,
    suggestedHashtags: ["#HappyCustomer", "#CustomerLove", "#5Stars"],
  },
  {
    id: "sold_by_salesperson",
    label: "Sold by {Salesperson}",
    category: "team",
    blurb: "Pride post — salesperson + customer + car.",
    emoji: "🏆",
    defaultStyle: StyleOption.Sporty,
    defaultTone: ToneOption.Excited,
    requiresCustomer: true,
    requiresVehicle: true,
    promptAdditions: `Scenario: Sold-by post. Goal is to celebrate the salesperson alongside the customer.
Lead with the salesperson's first name and a quick credit ("{Salesperson} just put another family in their dream ride…"). Customer first-name appears next.
Tone: proud + warm. Avoid making it sound like a brag — focus on the customer's win.`,
    suggestedHashtags: ["#TeamWin", "#SoldBy"],
    defaultVideoStyle: VideoStyle.PartyTime,
    defaultFunStyle: "superhero",
  },
  {
    id: "model_year_end",
    label: "Model-Year-End Push",
    category: "promo",
    blurb: "Clearance / end-of-year inventory push.",
    emoji: "🏁",
    defaultStyle: StyleOption.Sporty,
    defaultTone: ToneOption.Promotional,
    requiresCustomer: false,
    requiresVehicle: true,
    promptAdditions: `Scenario: Model-year-end / clearance event. The dealership is moving outgoing-year inventory.
Convey urgency without making compliance-risky claims ("limited supply" / "selection won't last" — fine; "guaranteed lowest price" — never).
End with CTA to visit or message for availability. Avoid specific prices unless provided.`,
    suggestedHashtags: ["#YearEnd", "#ModelYearEnd", "#ClearanceEvent"],
    defaultVideoStyle: VideoStyle.VintageFilm,
  },
  {
    id: "community_event",
    label: "Community Event",
    category: "community",
    blurb: "Charity, sponsorship, parade, school visit.",
    emoji: "🤝",
    defaultStyle: StyleOption.Friendly,
    defaultTone: ToneOption.Family,
    requiresCustomer: false,
    requiresVehicle: false,
    promptAdditions: `Scenario: Community involvement. The dealership sponsored an event, donated, or showed up for a local cause.
Lead with the community / cause — the dealership is a participant, not the hero. End with gratitude rather than a sales CTA.
Tone: humble, warm. No promotional language.`,
    suggestedHashtags: ["#Community", "#GivesBack", "#Local"],
  },
  {
    id: "team_anniversary",
    label: "Team Anniversary",
    category: "team",
    blurb: "Years-of-service, new hire, employee win.",
    emoji: "🎉",
    defaultStyle: StyleOption.Friendly,
    defaultTone: ToneOption.Family,
    requiresCustomer: false,
    requiresVehicle: false,
    promptAdditions: `Scenario: Team / staff celebration. A team member hit an anniversary, got promoted, or was recognized for an award.
Lead with the team member's first name and what they bring to the dealership. Customers love seeing the people behind the brand — this is a relationship post, not a product post.
No sales CTA unless explicitly added.`,
    suggestedHashtags: ["#TeamSpotlight", "#OurCrew"],
  },
  {
    id: "test_drive_invite",
    label: "Test-Drive Invite",
    category: "promo",
    blurb: "Inventory available — come try it.",
    emoji: "🛣️",
    defaultStyle: StyleOption.Sporty,
    defaultTone: ToneOption.Excited,
    requiresCustomer: false,
    requiresVehicle: true,
    promptAdditions: `Scenario: Test-drive invitation. The dealership is inviting prospects to come drive a specific unit (or a category like "any of our new SUVs").
Lead with the feel of the drive — quick, sensory ("feel the torque", "smooth ride", "the cabin is quieter than your living room"). Soft CTA to schedule.
Don't invent equipment not present on the actual vehicle.`,
    suggestedHashtags: ["#TestDrive", "#ComeDriveIt"],
    defaultVideoStyle: VideoStyle.Spotlight,
  },
];

export const findScenario = (id: string): PostScenario | undefined =>
  POST_SCENARIOS.find((s) => s.id === id);

/**
 * Parse the JSON blob stored on `dealer.custom_scenarios`. Returns an
 * empty array if missing, malformed, or any entry fails type-checks.
 * Logs on malformed input but never throws — the picker should keep working
 * with built-in scenarios even if a dealer's custom blob is corrupted.
 */
export const parseCustomScenarios = (raw?: string): PostScenario[] => {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid: PostScenario[] = [];
    for (const entry of parsed) {
      if (
        entry &&
        typeof entry.id === "string" &&
        typeof entry.label === "string" &&
        typeof entry.promptAdditions === "string"
      ) {
        valid.push({
          id: entry.id,
          label: entry.label,
          category: (entry.category as ScenarioCategory) || "promo",
          blurb: typeof entry.blurb === "string" ? entry.blurb : "",
          emoji: typeof entry.emoji === "string" ? entry.emoji : "✨",
          // Validate against the enum members — `|| Default` only catches
          // empty/undefined, letting an arbitrary string ("neon") through as a
          // bogus enum that later breaks style switches downstream.
          defaultStyle: Object.values(StyleOption).includes(
            entry.defaultStyle as StyleOption
          )
            ? (entry.defaultStyle as StyleOption)
            : StyleOption.Modern,
          defaultTone: Object.values(ToneOption).includes(
            entry.defaultTone as ToneOption
          )
            ? (entry.defaultTone as ToneOption)
            : ToneOption.Promotional,
          requiresCustomer: !!entry.requiresCustomer,
          requiresVehicle: entry.requiresVehicle !== false,
          promptAdditions: entry.promptAdditions,
          suggestedHashtags: Array.isArray(entry.suggestedHashtags)
            ? entry.suggestedHashtags.filter(
                (h: unknown): h is string => typeof h === "string"
              )
            : [],
          starterCaption:
            typeof entry.starterCaption === "string"
              ? entry.starterCaption
              : undefined,
        });
      }
    }
    return valid;
  } catch (err) {
    console.warn("[postScenarios] custom_scenarios JSON parse failed", err);
    return [];
  }
};

/**
 * Returns the combined catalog (built-in + custom) for a given dealer.
 * Custom scenarios are appended after built-ins in their category so the GSM
 * can see their templates alongside the defaults.
 */
export const getScenariosForDealer = (
  customScenariosJson?: string
): PostScenario[] => {
  const custom = parseCustomScenarios(customScenariosJson);
  return [...POST_SCENARIOS, ...custom];
};

/** Helper to encode a custom-scenarios array back to JSON for persistence. */
export const serializeCustomScenarios = (
  scenarios: PostScenario[]
): string => {
  return JSON.stringify(scenarios);
};

export const SCENARIO_CATEGORY_LABELS: Record<ScenarioCategory, string> = {
  delivery: "Delivery",
  inventory: "Inventory",
  service: "Service",
  promo: "Promotions",
  community: "Community",
  team: "Team",
};

/**
 * Category → lucide icon. The scenario marker is derived from the category
 * (not a per-scenario hand-picked emoji) so built-in AND dealer-created custom
 * scenarios render a single, consistent, on-brand icon set. The `emoji` field
 * on PostScenario is retained for backward compatibility but is no longer the
 * primary visual marker.
 */
export const SCENARIO_CATEGORY_ICON: Record<ScenarioCategory, LucideIcon> = {
  delivery: KeyRound,
  inventory: Car,
  service: Wrench,
  promo: Tag,
  community: HeartHandshake,
  team: Trophy,
};

/**
 * Build the scenario block that goes into the creative brief. Returns "" when
 * no scenario id is provided so the customizer keeps its current behaviour.
 *
 * `customScenariosJson` is the dealer's serialized custom scenarios — when
 * present, the lookup falls through to those if the id isn't in the built-in
 * catalog.
 */
export const scenarioToCreativeBrief = (
  id?: string,
  customScenariosJson?: string
): string => {
  if (!id) return "";
  const scenario =
    findScenario(id) ||
    parseCustomScenarios(customScenariosJson).find((s) => s.id === id);
  if (!scenario) return "";
  const hashtagLine = scenario.suggestedHashtags.length
    ? `Scenario hashtags (in addition to dealer defaults; each is one #PascalCase token, space-separated): ${scenario.suggestedHashtags.join(
        " ",
      )}.`
    : "";
  return [
    `Post scenario: ${scenario.label}.`,
    scenario.promptAdditions,
    hashtagLine,
  ]
    .filter(Boolean)
    .join("\n");
};
