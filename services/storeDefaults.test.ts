import { describe, expect, it } from "vitest";
import {
  StyleOption,
  VideoStyle,
  type ApprovalPolicy,
  type BrandCategoryId,
  type Dealer,
} from "../types";
import { buildEmployeeDisclosure } from "../utils/complianceDisclosures";
import { UNKNOWN_CHANNEL_LABEL, channelLabel } from "../utils/postLabels";
import { resolveCreative } from "./creativeSystem";
import type { PersonSummary } from "./salespeople";
import {
  HOME_TILES,
  homeTilesForDealer,
  resolveStoreDefaults,
  type StoreDefaults,
} from "./storeDefaults";

const dealer = (overrides: Partial<Dealer> = {}): Dealer => ({
  id: "dealer123456789",
  name: "Bob Maxey Ford of Howell",
  address: "2798 E Grand River Ave, Howell, MI 48843",
  ...overrides,
});

const person = (id: string): PersonSummary => ({
  id,
  dealer: "dealer123456789",
  name: "Sam Seller",
  role: "salesperson",
  active: true,
});

const CATEGORIES: { categoryId: BrandCategoryId; scenarioId: string }[] = [
  { categoryId: "deliveries", scenarioId: "customer_delivery" },
  { categoryId: "inventory", scenarioId: "new_arrival" },
  { categoryId: "service", scenarioId: "service_promotion" },
  { categoryId: "promotions", scenarioId: "model_year_end" },
  { categoryId: "community", scenarioId: "community_event" },
  { categoryId: "team", scenarioId: "team_anniversary" },
];

const resolve = (
  store: Dealer,
  categoryId: BrandCategoryId = "deliveries",
  who: PersonSummary | null = null,
): StoreDefaults =>
  resolveStoreDefaults({
    dealer: store,
    person: who,
    categoryId,
    scenarioId:
      CATEGORIES.find((entry) => entry.categoryId === categoryId)?.scenarioId ||
      "customer_delivery",
    websiteReady: false,
  });

/** The Look the selector opens on must be the Look Details rendered with. */
const expectSelectedLookMatchesRender = (result: StoreDefaults) => {
  const selected = result.looks.find((look) => look.id === result.defaultLookId);
  expect(selected).toBeDefined();
  expect(selected?.style).toBe(result.style);
  expect(result.looks.length).toBeLessThanOrEqual(3);
};

describe("store defaults", () => {
  it("defines the six approved home tiles and derives the community town", () => {
    expect(HOME_TILES.map((tile) => tile.label)).toEqual([
      "Delivery",
      "New arrival",
      "Service",
      "Promotion",
      "Community",
      "Team",
    ]);
    expect(homeTilesForDealer(dealer())[4].blurb).toBe("Around Howell");
  });

  it("adds dealer custom scenarios without exposing the rest of the built-in catalog", () => {
    const tiles = homeTilesForDealer(
      dealer({
        custom_scenarios: JSON.stringify([
          {
            id: "custom_parts_counter",
            label: "Parts counter",
            category: "service",
            blurb: "Parts and accessories",
            promptAdditions: "Feature the parts counter.",
          },
        ]),
      }),
    );
    expect(tiles).toHaveLength(7);
    expect(tiles.at(-1)).toMatchObject({
      categoryId: "service",
      label: "Parts counter",
      blurb: "Parts and accessories",
    });
  });

  it("keeps service on Facebook and Google with video disabled", () => {
    const result = resolveStoreDefaults({
      dealer: dealer(),
      person: null,
      categoryId: "service",
      scenarioId: "service_promotion",
      websiteReady: false,
    });
    expect(result.channels.map((channel) => channel.label)).toEqual([
      "Facebook",
      "Google",
    ]);
    expect(result.videoAllowed).toBe(false);
    expect(result.releaseRequired).toBe(false);
  });

  it("limits a legacy store to its one enabled Look", () => {
    const result = resolveStoreDefaults({
      dealer: dealer({ enabled_styles: StyleOption.Sporty }),
      person: null,
      categoryId: "inventory",
      scenarioId: "new_arrival",
      websiteReady: true,
    });
    expect(result.looks).toEqual([
      { id: StyleOption.Sporty, label: StyleOption.Sporty, style: StyleOption.Sporty },
    ]);
    expect(result.websiteChannel).toBe(true);
  });

  it("fails closed for an unknown delivery scenario", () => {
    const result = resolveStoreDefaults({
      dealer: dealer(),
      person: null,
      categoryId: "deliveries",
      scenarioId: "removed-scenario",
      websiteReady: false,
    });
    expect(result.releaseRequired).toBe(true);
  });
});

describe("store defaults: the Look slate", () => {
  it("opens a legacy store with no style settings on Modern, the style it renders", () => {
    const result = resolve(dealer());
    expect(result.style).toBe(StyleOption.Modern);
    expect(result.defaultLookId).toBe(StyleOption.Modern);
    expect(result.looks.map((look) => look.id)).toEqual([
      StyleOption.Luxury,
      StyleOption.Modern,
      StyleOption.Friendly,
    ]);
    expectSelectedLookMatchesRender(result);
  });

  it("opens on the store's default style", () => {
    const result = resolve(dealer({ default_style: StyleOption.Friendly }));
    expect(result.style).toBe(StyleOption.Friendly);
    expect(result.defaultLookId).toBe(StyleOption.Friendly);
    expectSelectedLookMatchesRender(result);
  });

  it("offers a default style outside the first three and keeps the slate at three", () => {
    const result = resolve(dealer({ default_style: StyleOption.Sporty }));
    expect(result.style).toBe(StyleOption.Sporty);
    expect(result.looks.map((look) => look.id)).toEqual([
      StyleOption.Luxury,
      StyleOption.Modern,
      StyleOption.Sporty,
    ]);
    expectSelectedLookMatchesRender(result);

    const allEnabled = resolve(
      dealer({
        enabled_styles: Object.values(StyleOption).join(","),
        default_style: StyleOption.DepthPop,
      }),
    );
    expect(allEnabled.looks.map((look) => look.id)).toEqual([
      StyleOption.Luxury,
      StyleOption.Modern,
      StyleOption.DepthPop,
    ]);
    expectSelectedLookMatchesRender(allEnabled);
  });

  it("never renders a style the manager hid when the default is not enabled", () => {
    // The old customizer's rule, so the store keeps the style it renders
    // today: the first kept style in the settings list order (not the saved
    // string's order, which is only the order the manager clicked).
    const enabled = `${StyleOption.Sporty}, ${StyleOption.Luxury}`;
    for (const store of [
      dealer({ enabled_styles: enabled }),
      dealer({ enabled_styles: enabled, default_style: StyleOption.Friendly }),
    ]) {
      const result = resolve(store);
      expect(result.style).toBe(StyleOption.Luxury);
      expect(result.defaultLookId).toBe(StyleOption.Luxury);
      expect(result.looks.map((look) => look.id)).toEqual([
        StyleOption.Sporty,
        StyleOption.Luxury,
      ]);
      expectSelectedLookMatchesRender(result);
    }
  });

  it("falls back to the app default style when the store's default is hidden", () => {
    const result = resolve(
      dealer({
        enabled_styles: `${StyleOption.Sporty},${StyleOption.Modern},${StyleOption.Luxury}`,
        default_style: StyleOption.Friendly,
      }),
    );
    expect(result.style).toBe(StyleOption.Modern);
    expect(result.defaultLookId).toBe(StyleOption.Modern);
    expect(result.looks.map((look) => look.id)).toEqual([
      StyleOption.Sporty,
      StyleOption.Modern,
      StyleOption.Luxury,
    ]);
    expectSelectedLookMatchesRender(result);
  });

  it("keeps the manager's order and selects an enabled default", () => {
    const result = resolve(
      dealer({
        enabled_styles: `${StyleOption.Sporty},${StyleOption.Friendly},${StyleOption.Luxury}`,
        default_style: StyleOption.Luxury,
      }),
    );
    expect(result.looks.map((look) => look.id)).toEqual([
      StyleOption.Sporty,
      StyleOption.Friendly,
      StyleOption.Luxury,
    ]);
    expect(result.defaultLookId).toBe(StyleOption.Luxury);
    expectSelectedLookMatchesRender(result);
  });

  it("includes and selects the house Look on a v2 store with only an alternate", () => {
    const result = resolve(
      dealer({ creative_system_v2: true, alternate_look: "turbo" }),
    );
    expect(result.looks.map((look) => look.id)).toEqual(["showroom", "turbo"]);
    expect(result.defaultLookId).toBe("showroom");
    expect(result.style).toBe(StyleOption.Luxury);
    expectSelectedLookMatchesRender(result);
  });

  it("selects a v2 store's signature Look ahead of its alternate", () => {
    const result = resolve(
      dealer({
        creative_system_v2: true,
        signature_look: "hometown",
        alternate_look: "turbo",
      }),
    );
    expect(result.looks.map((look) => look.id)).toEqual(["hometown", "turbo"]);
    expect(result.defaultLookId).toBe("hometown");
    expectSelectedLookMatchesRender(result);
  });
});

describe("store defaults: manager settings on a store without the creative system", () => {
  const restricted = dealer({
    playful_style: "comic-book",
    feature_permissions: {
      video: { team: false, people: {} },
      playful: { team: false, people: {} },
    },
    category_destinations: {
      deliveries: {
        platformIds: ["facebook_feed"],
        formatIds: ["feed_portrait"],
        video: true,
      },
      inventory: {
        platformIds: ["instagram_feed", "facebook_feed", "marketplace"],
        formatIds: ["feed_portrait"],
        video: false,
      },
    },
  });

  it("honours team feature access and channels by post type", () => {
    expect(resolveCreative({ dealer: restricted }).enabled).toBe(false);
    const result = resolve(restricted, "deliveries");
    expect(result.generationPlatformIds).toEqual(["facebook_feed"]);
    expect(result.channels.map((channel) => channel.label)).toEqual(["Facebook"]);
    expect(result.videoAllowed).toBe(false);
    expect(result.playfulStyleId).toBeNull();
  });

  it("turns video off for a post type the manager switched off", () => {
    const store = dealer({
      category_destinations: restricted.category_destinations,
    });
    expect(resolve(store, "inventory").videoAllowed).toBe(false);
    expect(resolve(store, "deliveries").videoAllowed).toBe(true);
  });

  it("never leaves a post type with no channels", () => {
    const store = dealer({
      category_destinations: {
        deliveries: { platformIds: ["not_a_channel"], formatIds: [], video: true },
      },
    });
    expect(resolve(store, "deliveries").generationPlatformIds).toEqual([
      "instagram_feed",
      "instagram_story",
      "facebook_feed",
    ]);
  });

  it("shows one Instagram chip and lets the story stand in when the feed is unchecked", () => {
    expect(resolve(dealer(), "deliveries").channels).toEqual([
      { id: "facebook_feed", label: "Facebook" },
      { id: "instagram_feed", label: "Instagram" },
    ]);
    const storyOnly = resolve(
      dealer({
        category_destinations: {
          deliveries: {
            platformIds: ["instagram_story"],
            formatIds: ["story_vertical"],
            video: true,
          },
        },
      }),
      "deliveries",
    );
    expect(storyOnly.channels).toEqual([{ id: "instagram_story", label: "Instagram" }]);
    expect(storyOnly.defaultChannelId).toBe("instagram_story");
  });

  it("names every channel chip exactly as My work names the share", () => {
    // Every chip the Post screen can show: each post type's defaults, plus the
    // story standing in for an unchecked Instagram feed.
    const storyOnly = dealer({
      category_destinations: {
        deliveries: {
          platformIds: ["instagram_story"],
          formatIds: ["story_vertical"],
          video: true,
        },
      },
    });
    const chips = [
      ...CATEGORIES.flatMap(({ categoryId }) => resolve(dealer(), categoryId).channels),
      ...resolve(storyOnly, "deliveries").channels,
    ];
    expect([...new Set(chips.map((chip) => chip.id))]).toEqual(
      expect.arrayContaining([
        "facebook_feed",
        "instagram_feed",
        "instagram_story",
        "marketplace",
        "gbp",
        "linkedin",
      ]),
    );
    for (const chip of chips) {
      expect(chip.label).not.toBe(UNKNOWN_CHANNEL_LABEL);
      expect({ id: chip.id, label: chip.label }).toEqual({
        id: chip.id,
        label: channelLabel(chip.id),
      });
    }
  });

  it("lets a per-person override win over the team setting", () => {
    const store = dealer({
      playful_style: "comic-book",
      feature_permissions: {
        video: { team: false, people: { "person-allowed": true } },
        playful: { team: true, people: { "person-blocked": false } },
      },
    });
    expect(resolve(store, "deliveries", person("person-allowed")).videoAllowed).toBe(
      true,
    );
    expect(resolve(store, "deliveries", person("someone-else")).videoAllowed).toBe(
      false,
    );
    expect(resolve(store, "deliveries", person("person-blocked")).playfulStyleId).toBe(
      null,
    );
    expect(resolve(store, "deliveries", person("someone-else")).playfulStyleId).toBe(
      "comic-book",
    );
  });

  it("gives a default store the house motion so Add video works", () => {
    const result = resolve(dealer(), "deliveries");
    expect(result.motion).toEqual({
      style: VideoStyle.GoldenRadiance,
      aspects: ["9:16"],
      audio: "cinematic",
    });
    expect(result.videoAllowed).toBe(true);
  });

  it("uses the store's motion signature where it is valid", () => {
    const result = resolve(
      dealer({
        motion_signature: {
          style: VideoStyle.LiquidChrome,
          aspects: ["16:9"],
          audio: "not-a-soundtrack" as never,
        },
      }),
    );
    expect(result.motion).toEqual({
      style: VideoStyle.LiquidChrome,
      aspects: ["16:9"],
      audio: "cinematic",
    });
  });
});

describe("store defaults: approval and disclosure", () => {
  const policies: (ApprovalPolicy | null)[] = [
    null,
    { mode: "none" },
    { mode: "always" },
    { mode: "first_n", firstN: 3 },
    { mode: "per_category", categories: ["deliveries"] },
    { mode: "per_category", categories: ["service"] },
  ];

  it("follows the store's approval switch for every policy mode and category", () => {
    for (const requires_approval of [true, false, undefined]) {
      for (const approval_policy of policies) {
        for (const { categoryId } of CATEGORIES) {
          const result = resolve(
            dealer({ requires_approval, approval_policy }),
            categoryId,
          );
          expect(result.requiresApproval).toBe(requires_approval === true);
        }
      }
    }
  });

  it("carries the team-member disclosure on every post type", () => {
    const store = dealer();
    const disclosure = buildEmployeeDisclosure(store);
    expect(disclosure).not.toBe("");
    for (const { categoryId } of CATEGORIES) {
      expect(resolve(store, categoryId).employeeDisclosure).toBe(disclosure);
    }
  });
});
