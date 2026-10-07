/**
 * The store's approval policy can review "selected post types". The server
 * decides a post's type from its own scenario table; the manager picks types
 * from the client's. They must agree for every built-in scenario, or a
 * manager would select a category that never matches what the server sees.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { brandCategoryForScenario } from "../services/creativeSystem";
import { POST_SCENARIOS } from "../services/postScenarios";

type Mapping = { scenarioId: string; kind: string; category: string } | null;

const website = (() => {
  const source = readFileSync(
    resolve(process.cwd(), "pb_hooks/websitePublications.js"),
    "utf8",
  );
  const module = {
    exports: {} as { resolveWebsiteMapping: (id: string, custom: string) => Mapping },
  };
  new Function("module", "exports", source)(module, module.exports);
  return module.exports;
})();

describe("scenario category parity (server approval policy vs client settings)", () => {
  it("covers every built-in scenario", () => {
    expect(POST_SCENARIOS.length).toBeGreaterThanOrEqual(12);
  });

  it.each(POST_SCENARIOS.map((scenario) => [scenario.id]))(
    "%s resolves to the same category on both sides",
    (id) => {
      const server = website.resolveWebsiteMapping(id, "");
      expect(server, `server has no mapping for ${id}`).not.toBeNull();
      expect(server?.category).toBe(brandCategoryForScenario(id));
    },
  );

  it("agrees for a dealer's custom scenario, and fails closed when it is malformed", () => {
    const custom = JSON.stringify([
      { id: "tent_sale", label: "Tent sale", promptAdditions: "", category: "promo" },
      { id: "plain_custom", label: "Plain", promptAdditions: "" },
    ]);
    expect(website.resolveWebsiteMapping("tent_sale", custom)?.category).toBe(
      "promotions",
    );
    expect(brandCategoryForScenario("tent_sale", custom)).toBe("promotions");
    expect(website.resolveWebsiteMapping("plain_custom", custom)?.category).toBe(
      brandCategoryForScenario("plain_custom", custom),
    );
    // Unknown to the server means "cannot classify", which the policy reviews.
    expect(website.resolveWebsiteMapping("never_configured", custom)).toBeNull();
  });
});
