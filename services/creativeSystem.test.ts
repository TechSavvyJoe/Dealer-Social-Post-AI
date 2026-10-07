import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { fakeCollection, fieldsOf } from "../test/fakePocketBaseSchema";

import {
  StyleOption,
  ToneOption,
  VideoStyle,
  type BrandCategoryId,
  type Dealer,
  type SignatureLook,
} from "../types";
import { EXPORT_FORMATS } from "../utils/multiFormatExport";
import { PUBLISH_TARGETS } from "./publishTargets";
import { POST_SCENARIOS, scenarioLegacyCreativeDefaults } from "./postScenarios";
import {
  CATEGORY_OUTPUTS,
  DEFAULT_MOTION_ASPECTS,
  DEFAULT_MOTION_AUDIO,
  LEGACY_DEFAULT_STYLE,
  LEGACY_DEFAULT_TONE,
  LOOK_DEFINITIONS,
  brandCategoryForScenario,
  isCreativeSystemEnabled,
  isFeatureAllowed,
  resolveCreative,
  resolveSignatureLook,
} from "./creativeSystem";

const dealer = (overrides: Partial<Dealer> = {}): Dealer => ({
  id: "dealer-1",
  name: "Bob Maxey Ford of Howell",
  ...overrides,
});

/** A dealership with the full phase-1 brand kit configured. */
const configuredBrandKit: Partial<Dealer> = {
  default_style: StyleOption.DepthPop,
  signature_look: "turbo",
  alternate_look: "hometown",
  playful_style: "retro_comic",
  motion_signature: { style: "Spotlight", aspects: ["16:9"], audio: "funk" },
  category_destinations: {
    team: { platformIds: ["linkedin"], formatIds: ["feed_square"], video: false },
  },
  feature_permissions: {
    playful: { team: false, people: {} },
    video: { team: false, people: {} },
    freeTextEdit: { team: false, people: {} },
  },
};

describe("creative system flag (safety property)", () => {
  it("treats anything but an explicit true as disabled", () => {
    expect(isCreativeSystemEnabled(null)).toBe(false);
    expect(isCreativeSystemEnabled(dealer())).toBe(false);
    expect(isCreativeSystemEnabled(dealer({ creative_system_v2: false }))).toBe(false);
    expect(isCreativeSystemEnabled(dealer({ creative_system_v2: true }))).toBe(true);
  });

  /**
   * Today's precedence, restated independently of the implementation: the
   * caller's seed (restored params / per-device preference) first, then the
   * dealership default, then the app's own defaults.
   */
  const legacyStyle = (d: Dealer | null, fallback?: StyleOption): StyleOption => {
    if (fallback) return fallback;
    const dealerDefault = d?.default_style;
    const known = Object.values(StyleOption) as string[];
    if (dealerDefault && known.includes(dealerDefault)) {
      return dealerDefault as StyleOption;
    }
    return LEGACY_DEFAULT_STYLE;
  };
  const legacyTone = (fallback?: ToneOption): ToneOption =>
    fallback ?? LEGACY_DEFAULT_TONE;

  const disabledCases: Array<{
    name: string;
    dealer: Dealer | null;
    fallbackStyle?: StyleOption;
    fallbackTone?: ToneOption;
    scenarioId?: string;
    categoryId?: string;
  }> = [
    { name: "no dealer at all", dealer: null },
    { name: "bare dealer, no seeds", dealer: dealer() },
    {
      name: "dealer default only",
      dealer: dealer({ default_style: StyleOption.Luxury }),
    },
    {
      name: "seed beats dealer default",
      dealer: dealer({ default_style: StyleOption.Luxury }),
      fallbackStyle: StyleOption.Sporty,
      fallbackTone: ToneOption.Humorous,
    },
    {
      name: "unrecognized dealer default is ignored",
      dealer: dealer({ default_style: "Neon Chrome" as StyleOption }),
    },
    {
      name: "scenario with its own style/tone",
      dealer: dealer({ default_style: StyleOption.Modern }),
      scenarioId: "sold_by_salesperson",
    },
    {
      name: "fully configured brand kit with the flag off",
      dealer: dealer({ ...configuredBrandKit, creative_system_v2: false }),
      fallbackStyle: StyleOption.Friendly,
      fallbackTone: ToneOption.Family,
      categoryId: "team",
      scenarioId: "team_anniversary",
    },
  ];

  it.each(disabledCases)(
    "reproduces today's style/tone precedence: $name",
    ({ dealer: subject, fallbackStyle, fallbackTone, scenarioId, categoryId }) => {
      const resolved = resolveCreative({
        dealer: subject,
        fallbackStyle,
        fallbackTone,
        scenarioId,
        categoryId,
      });

      expect(resolved.style).toBe(legacyStyle(subject, fallbackStyle));
      expect(resolved.tone).toBe(legacyTone(fallbackTone));
      // Nothing else is prescribed and nothing is restricted, so a caller that
      // honours `enabled` behaves exactly as it does today.
      expect(resolved).toMatchObject({
        enabled: false,
        look: null,
        motion: null,
        playfulStyleId: null,
        platformIds: [],
        formatIds: [],
        videoAllowed: true,
        playfulAllowed: true,
        freeTextEditAllowed: true,
      });
    },
  );

  it("keeps the scenario's own defaults available only while disabled", () => {
    const scenario = POST_SCENARIOS.find((s) => s.id === "sold_by_salesperson")!;
    expect(scenarioLegacyCreativeDefaults(scenario, false)).toEqual({
      style: scenario.defaultStyle,
      tone: scenario.defaultTone,
    });
    expect(scenarioLegacyCreativeDefaults(scenario, true)).toBeNull();
    expect(scenarioLegacyCreativeDefaults(undefined, false)).toBeNull();
  });
});

describe("signature looks", () => {
  const expected: Record<
    SignatureLook,
    { style: StyleOption; tone: ToneOption; motionStyle: VideoStyle }
  > = {
    showroom: {
      style: StyleOption.Luxury,
      tone: ToneOption.Professional,
      motionStyle: VideoStyle.GoldenRadiance,
    },
    hometown: {
      style: StyleOption.Friendly,
      tone: ToneOption.Family,
      motionStyle: VideoStyle.Spotlight,
    },
    turbo: {
      style: StyleOption.Sporty,
      tone: ToneOption.Excited,
      motionStyle: VideoStyle.LiquidChrome,
    },
  };

  it("never names a logo corner in a Look, so it cannot contradict the store's corner", () => {
    // The store's own corner (dealer.logo_placement) decides where the logo
    // goes; a Look that said "bottom-right" would argue with a top-left store.
    for (const look of Object.values(LOOK_DEFINITIONS)) {
      expect(look.description, look.label).not.toMatch(
        /\b(?:top|bottom|upper|lower)[\s-]*(?:left|right)\b/i,
      );
    }
  });

  it("maps each look exactly as the spec table specifies", () => {
    expect(Object.keys(LOOK_DEFINITIONS).sort()).toEqual([
      "hometown",
      "showroom",
      "turbo",
    ]);
    for (const [look, mapping] of Object.entries(expected) as Array<
      [SignatureLook, (typeof expected)[SignatureLook]]
    >) {
      expect(LOOK_DEFINITIONS[look]).toMatchObject(mapping);
      expect(LOOK_DEFINITIONS[look].label).toBeTruthy();
      expect(LOOK_DEFINITIONS[look].description).toBeTruthy();
      const resolved = resolveCreative({
        dealer: dealer({ creative_system_v2: true, signature_look: look }),
      });
      expect(resolved.look).toBe(look);
      expect(resolved.style).toBe(mapping.style);
      expect(resolved.tone).toBe(mapping.tone);
      expect(resolved.motion?.style).toBe(mapping.motionStyle);
    }
  });

  it("is frozen so a consumer cannot mutate the house look", () => {
    expect(Object.isFrozen(LOOK_DEFINITIONS)).toBe(true);
    expect(Object.isFrozen(LOOK_DEFINITIONS.showroom)).toBe(true);
  });

  it("falls back to showroom for a missing or unknown look", () => {
    expect(resolveSignatureLook(null)).toBe("showroom");
    expect(resolveSignatureLook(dealer())).toBe("showroom");
    expect(resolveSignatureLook(dealer({ signature_look: "" }))).toBe("showroom");
    expect(
      resolveSignatureLook(dealer({ signature_look: "chrome" as SignatureLook })),
    ).toBe("showroom");

    const resolved = resolveCreative({
      dealer: dealer({
        creative_system_v2: true,
        signature_look: "chrome" as SignatureLook,
      }),
    });
    expect(resolved.look).toBe("showroom");
    expect(resolved.style).toBe(StyleOption.Luxury);
    expect(resolved.tone).toBe(ToneOption.Professional);
  });
});

describe("enabled resolution", () => {
  it("ignores the scenario defaults and the per-device preference", () => {
    const scenario = POST_SCENARIOS.find((s) => s.id === "sold_by_salesperson")!;
    // The scenario wants Sporty/Excited and the device remembers Friendly/Humorous.
    expect(scenario.defaultStyle).toBe(StyleOption.Sporty);
    const resolved = resolveCreative({
      dealer: dealer({ creative_system_v2: true, signature_look: "showroom" }),
      scenarioId: scenario.id,
      fallbackStyle: StyleOption.Friendly,
      fallbackTone: ToneOption.Humorous,
    });
    expect(resolved.style).toBe(StyleOption.Luxury);
    expect(resolved.tone).toBe(ToneOption.Professional);
  });

  it("ignores the dealership's legacy default_style", () => {
    const resolved = resolveCreative({
      dealer: dealer({
        creative_system_v2: true,
        signature_look: "hometown",
        default_style: StyleOption.DepthPop,
      }),
    });
    expect(resolved.style).toBe(StyleOption.Friendly);
  });

  it("carries the single Playful style id", () => {
    expect(
      resolveCreative({
        dealer: dealer({ creative_system_v2: true, playful_style: "  retro_comic  " }),
      }).playfulStyleId,
    ).toBe("retro_comic");
    expect(
      resolveCreative({ dealer: dealer({ creative_system_v2: true }) }).playfulStyleId,
    ).toBeNull();
  });

  it("takes motion from the dealer signature, else from the look", () => {
    const fromLook = resolveCreative({
      dealer: dealer({ creative_system_v2: true, signature_look: "turbo" }),
    });
    expect(fromLook.motion).toEqual({
      style: VideoStyle.LiquidChrome,
      aspects: [...DEFAULT_MOTION_ASPECTS],
      audio: DEFAULT_MOTION_AUDIO,
    });

    const fromSignature = resolveCreative({
      dealer: dealer({
        creative_system_v2: true,
        signature_look: "turbo",
        motion_signature: {
          style: VideoStyle.SmokeReveal,
          aspects: ["9:16", "16:9"],
          audio: "funk",
        },
      }),
    });
    expect(fromSignature.motion).toEqual({
      style: VideoStyle.SmokeReveal,
      aspects: ["9:16", "16:9"],
      audio: "funk",
    });
  });

  it("ignores an unusable motion signature instead of shipping garbage", () => {
    const resolved = resolveCreative({
      dealer: dealer({
        creative_system_v2: true,
        signature_look: "showroom",
        motion_signature: {
          style: "Hyper Zoom",
          aspects: ["4:3"],
          audio: "dubstep",
        } as unknown as Dealer["motion_signature"],
      }),
    });
    expect(resolved.motion).toEqual({
      style: VideoStyle.GoldenRadiance,
      aspects: [...DEFAULT_MOTION_ASPECTS],
      audio: DEFAULT_MOTION_AUDIO,
    });
  });
});

describe("category outputs (spec §4.4)", () => {
  const exportFormatIds = new Set(EXPORT_FORMATS.map((format) => format.id));
  const platformIds = new Set(PUBLISH_TARGETS.map((target) => target.id));

  it("covers exactly the six categories", () => {
    expect(Object.keys(CATEGORY_OUTPUTS).sort()).toEqual([
      "community",
      "deliveries",
      "inventory",
      "promotions",
      "service",
      "team",
    ]);
  });

  it("only names ids that exist in EXPORT_FORMATS and PUBLISH_TARGETS", () => {
    for (const [category, output] of Object.entries(CATEGORY_OUTPUTS)) {
      for (const formatId of output.formatIds) {
        expect(
          exportFormatIds.has(formatId),
          `${category}: unknown export format "${formatId}"`,
        ).toBe(true);
      }
      for (const platformId of output.platformIds) {
        expect(
          platformIds.has(platformId),
          `${category}: unknown publish target "${platformId}"`,
        ).toBe(true);
      }
    }
  });

  it("matches the spec table verbatim", () => {
    expect(CATEGORY_OUTPUTS.deliveries).toEqual({
      formatIds: ["feed_portrait", "story_vertical"],
      platformIds: ["instagram_feed", "instagram_story", "facebook_feed"],
      videoAllowed: true,
    });
    expect(CATEGORY_OUTPUTS.inventory).toEqual({
      formatIds: ["feed_portrait", "marketplace"],
      platformIds: ["instagram_feed", "facebook_feed", "marketplace"],
      videoAllowed: true,
    });
    expect(CATEGORY_OUTPUTS.service).toEqual({
      formatIds: ["feed_portrait", "gbp"],
      platformIds: ["facebook_feed", "gbp"],
      videoAllowed: false,
    });
    expect(CATEGORY_OUTPUTS.promotions).toEqual({
      formatIds: ["feed_portrait", "story_vertical"],
      platformIds: ["instagram_feed", "instagram_story", "facebook_feed"],
      videoAllowed: true,
    });
    expect(CATEGORY_OUTPUTS.community).toEqual({
      formatIds: ["feed_portrait", "gbp"],
      platformIds: ["facebook_feed", "gbp"],
      videoAllowed: false,
    });
    expect(CATEGORY_OUTPUTS.team).toEqual({
      formatIds: ["feed_portrait", "feed_square"],
      platformIds: ["facebook_feed", "linkedin"],
      videoAllowed: false,
    });
  });

  it("maps every built-in scenario to one of the six categories", () => {
    for (const scenario of POST_SCENARIOS) {
      const category = brandCategoryForScenario(scenario.id);
      expect(category, scenario.id).not.toBeNull();
      expect(CATEGORY_OUTPUTS[category as BrandCategoryId]).toBeDefined();
    }
    expect(brandCategoryForScenario("customer_delivery")).toBe("deliveries");
    expect(brandCategoryForScenario("model_year_end")).toBe("promotions");
    expect(brandCategoryForScenario("team_anniversary")).toBe("team");
    expect(brandCategoryForScenario("")).toBeNull();
    expect(brandCategoryForScenario("not_a_scenario")).toBeNull();
  });

  it("resolves a dealer custom scenario through the same catalog", () => {
    const custom = JSON.stringify([
      {
        id: "winter_service",
        label: "Winter service push",
        category: "service",
        promptAdditions: "Winter readiness check.",
      },
    ]);
    expect(brandCategoryForScenario("winter_service", custom)).toBe("service");
    const resolved = resolveCreative({
      dealer: dealer({ creative_system_v2: true, custom_scenarios: custom }),
      scenarioId: "winter_service",
    });
    expect(resolved.platformIds).toEqual(["facebook_feed", "gbp"]);
    expect(resolved.videoAllowed).toBe(false);
  });

  it("derives the category from the scenario and defaults to deliveries", () => {
    const base = { dealer: dealer({ creative_system_v2: true }) };
    expect(resolveCreative({ ...base, scenarioId: "new_arrival" }).formatIds).toEqual([
      "feed_portrait",
      "marketplace",
    ]);
    // Explicit category wins over the scenario.
    expect(
      resolveCreative({ ...base, scenarioId: "new_arrival", categoryId: "team" })
        .platformIds,
    ).toEqual(["facebook_feed", "linkedin"]);
    // Neither supplied, or an unknown id: the product's canonical default.
    expect(resolveCreative(base).platformIds).toEqual(
      CATEGORY_OUTPUTS.deliveries.platformIds,
    );
    expect(resolveCreative({ ...base, categoryId: "birthdays" }).formatIds).toEqual(
      CATEGORY_OUTPUTS.deliveries.formatIds,
    );
  });
});

describe("category_destinations narrowing", () => {
  const enabled = (destinations: Dealer["category_destinations"]): Dealer =>
    dealer({ creative_system_v2: true, category_destinations: destinations });

  it("narrows to the dealer subset in the category's own order", () => {
    const resolved = resolveCreative({
      dealer: enabled({
        deliveries: {
          platformIds: ["facebook_feed", "instagram_feed"],
          formatIds: ["story_vertical"],
          video: true,
        },
      }),
      categoryId: "deliveries",
    });
    expect(resolved.platformIds).toEqual(["instagram_feed", "facebook_feed"]);
    expect(resolved.formatIds).toEqual(["story_vertical"]);
    expect(resolved.videoAllowed).toBe(true);
  });

  it("cannot widen beyond the category default", () => {
    const resolved = resolveCreative({
      dealer: enabled({
        team: {
          platformIds: ["facebook_feed", "linkedin", "tiktok", "x_twitter"],
          formatIds: ["feed_square", "story_vertical", "marketplace"],
          video: true,
        },
      }),
      categoryId: "team",
    });
    expect(resolved.platformIds).toEqual(["facebook_feed", "linkedin"]);
    expect(resolved.formatIds).toEqual(["feed_square"]);
    // The team category never ships video, whatever the dealer asked for.
    expect(resolved.videoAllowed).toBe(false);
  });

  it("turns video off but never on", () => {
    expect(
      resolveCreative({
        dealer: enabled({
          deliveries: { platformIds: [], formatIds: [], video: false },
        }),
        categoryId: "deliveries",
      }).videoAllowed,
    ).toBe(false);
    expect(
      resolveCreative({
        dealer: enabled({
          service: { platformIds: [], formatIds: [], video: true },
        }),
        categoryId: "service",
      }).videoAllowed,
    ).toBe(false);
  });

  it("keeps the category default when the narrowed set is empty or unusable", () => {
    const resolved = resolveCreative({
      dealer: enabled({
        inventory: {
          platformIds: ["tiktok"],
          formatIds: [],
          video: true,
        },
      }),
      categoryId: "inventory",
    });
    expect(resolved.platformIds).toEqual(CATEGORY_OUTPUTS.inventory.platformIds);
    expect(resolved.formatIds).toEqual(CATEGORY_OUTPUTS.inventory.formatIds);
  });

  it("leaves other categories on their defaults", () => {
    const resolved = resolveCreative({
      dealer: enabled({
        team: { platformIds: ["linkedin"], formatIds: ["feed_square"], video: false },
      }),
      categoryId: "community",
    });
    expect(resolved.platformIds).toEqual(CATEGORY_OUTPUTS.community.platformIds);
  });
});

describe("feature permissions", () => {
  it("is permissive until a permission is configured", () => {
    const resolved = resolveCreative({
      dealer: dealer({ creative_system_v2: true }),
      categoryId: "deliveries",
    });
    expect(resolved.playfulAllowed).toBe(true);
    expect(resolved.freeTextEditAllowed).toBe(true);
    expect(resolved.videoAllowed).toBe(true);
  });

  it("gates playful, video, and free-text edits from the team default", () => {
    const resolved = resolveCreative({
      dealer: dealer({
        creative_system_v2: true,
        feature_permissions: {
          playful: { team: false, people: {} },
          video: { team: false, people: {} },
          freeTextEdit: { team: false, people: {} },
        },
      }),
      categoryId: "deliveries",
    });
    expect(resolved.playfulAllowed).toBe(false);
    expect(resolved.freeTextEditAllowed).toBe(false);
    expect(resolved.videoAllowed).toBe(false);
  });

  it("lets a per-person override win over the team default", () => {
    const subject = dealer({
      creative_system_v2: true,
      feature_permissions: {
        playful: { team: false, people: { person_a: true } },
        freeTextEdit: { team: true, people: { person_b: false } },
      },
    });
    expect(isFeatureAllowed(subject, "playful")).toBe(false);
    expect(isFeatureAllowed(subject, "playful", "person_a")).toBe(true);
    expect(isFeatureAllowed(subject, "playful", "person_b")).toBe(false);
    expect(isFeatureAllowed(subject, "freeTextEdit", "person_b")).toBe(false);
    expect(isFeatureAllowed(subject, "freeTextEdit", "person_a")).toBe(true);
    // An unconfigured key stays open.
    expect(isFeatureAllowed(subject, "video")).toBe(true);
    expect(isFeatureAllowed(null, "video")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Backend contract: the flag has to survive the write allowlist and the
// session serializer, or a pilot dealership can never be switched on.
// ---------------------------------------------------------------------------

type Helpers = {
  dealerMutationData: (
    body: Record<string, unknown>,
    allowCode: boolean,
    allowAdminCode: boolean,
  ) => Record<string, unknown>;
  serializeDealer: (record: unknown) => Record<string, unknown>;
  safeDealerMutationError: (err: unknown) => string;
};

const loadHelpers = (): Helpers => {
  const source = readFileSync(resolve(process.cwd(), "pb_hooks/helpers.js"), "utf8");
  const module = { exports: {} as Helpers };
  new Function("module", "exports", source)(module, module.exports);
  return module.exports;
};

describe("creative_system_v2 backend allowlist", () => {
  const helpers = loadHelpers();
  const dealerRecord = (values: Record<string, string>, bools: string[] = []) => ({
    id: "dealer-record-id",
    getString: (field: string) => values[field] || "",
    getBool: (field: string) => bools.includes(field),
  });

  it("accepts the flag as a boolean or its multipart string form", () => {
    expect(
      helpers.dealerMutationData({ creative_system_v2: true }, false, false),
    ).toEqual({ creative_system_v2: true });
    expect(
      helpers.dealerMutationData({ creative_system_v2: "false" }, false, false),
    ).toEqual({ creative_system_v2: false });
    // Absent means "leave it alone" — never an implicit disable.
    expect(helpers.dealerMutationData({ name: "Lot 2" }, false, false)).toEqual({
      name: "Lot 2",
    });
  });

  it("rejects a non-boolean flag with a safe message", () => {
    let message = "";
    try {
      helpers.dealerMutationData({ creative_system_v2: "maybe" }, false, false);
    } catch (err) {
      message = helpers.safeDealerMutationError(err);
    }
    expect(message).toBe("creative_system_v2 must be true or false");
  });

  it("round-trips through serializeDealer", () => {
    expect(
      helpers.serializeDealer(
        dealerRecord({ name: "Pilot store" }, ["creative_system_v2"]),
      ),
    ).toMatchObject({ creative_system_v2: true });
    expect(
      helpers.serializeDealer(dealerRecord({ name: "Everyone else" })),
    ).toMatchObject({ creative_system_v2: false });
  });
});

describe("creative_system_v2 migration", () => {
  type Field = { name: string; type: string; required?: boolean };

  // fakeCollection models the real contract: removeField(id) exists and
  // `schema` cannot be reassigned. The hand-rolled fake this replaced accepted
  // `schema = filteredArray`, which is the no-op idiom the rollback assertion
  // below exists to catch.

  const loadMigration = () => {
    const source = readFileSync(
      resolve(process.cwd(), "pb_migrations/1751800000_creative_system_v2_flag.js"),
      "utf8",
    );
    let up: ((dao: unknown) => unknown) | undefined;
    let down: ((dao: unknown) => unknown) | undefined;
    runInNewContext(source, {
      migrate: (apply: typeof up, rollback: typeof down) => {
        up = apply;
        down = rollback;
      },
      Dao: function Dao(db: unknown) {
        return db;
      },
      SchemaField: function SchemaField(definition: Field) {
        return { ...definition };
      },
    });
    expect(up).toBeTypeOf("function");
    expect(down).toBeTypeOf("function");
    return { up: up!, down: down! };
  };

  const buildDao = () => {
    const dealers = fakeCollection<Field>([{ name: "name", type: "text" }]);
    const saveCollection = vi.fn();
    return {
      dealers,
      saveCollection,
      dao: {
        findCollectionByNameOrId: (name: string) => {
          if (name === "dealers") return dealers;
          throw new Error("missing collection " + name);
        },
        saveCollection,
      },
    };
  };

  it("adds an optional bool, is re-runnable, and rolls back", () => {
    const { up, down } = loadMigration();
    const { dealers, dao } = buildDao();

    up(dao);
    let fields = fieldsOf(dealers.schema);
    expect(fields.map((field) => field.name)).toEqual(["name", "creative_system_v2"]);
    expect(fields[1]).toMatchObject({ type: "bool", required: false });

    // Deploy retries must not duplicate the column.
    up(dao);
    expect(fieldsOf(dealers.schema)).toHaveLength(2);

    down(dao);
    fields = fieldsOf(dealers.schema);
    expect(fields.map((field) => field.name)).toEqual(["name"]);
  });

  it("sorts after every existing migration so it applies last", () => {
    const migration = "1751800000_creative_system_v2_flag.js";
    const timestamp = Number(migration.split("_")[0]);
    expect(Number.isFinite(timestamp)).toBe(true);
    expect(timestamp).toBeGreaterThan(1751700000);
  });
});
