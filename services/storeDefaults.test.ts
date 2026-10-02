import { describe, expect, it } from "vitest";
import { StyleOption, type Dealer } from "../types";
import { HOME_TILES, homeTilesForDealer, resolveStoreDefaults } from "./storeDefaults";

const dealer = (overrides: Partial<Dealer> = {}): Dealer => ({
  id: "dealer123456789",
  name: "Bob Maxey Ford of Howell",
  address: "2798 E Grand River Ave, Howell, MI 48843",
  ...overrides,
});

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
