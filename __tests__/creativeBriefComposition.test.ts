import { describe, expect, it } from "vitest";
import { composeGenerationCreativeBrief } from "../services/generationRequest";
import { classifyCreativeBrief } from "../services/creativeSkills";
import { scenarioToCreativeBrief } from "../services/postScenarios";

/**
 * composeGenerationCreativeBrief builds the brief behind every post that
 * Details creates (services/generationRequest.ts's buildGenerationRequest).
 * These three cases lived in the retired PostCustomizer suite and are not
 * mirrored in services/generationRequest.test.ts, which carries the other two
 * (brand voice inside the caption window, and the forged marker in brand
 * voice). They moved here when that screen was deleted.
 */
describe("composeGenerationCreativeBrief budgets", () => {
  it("keeps dealer, scenario, vehicle, and OEM grounding ahead of verbose platform copy", () => {
    const brief = composeGenerationCreativeBrief({
      dealershipName: "Bob Maxey Ford of Howell",
      scenarioBlock: "Scenario: New arrival announcement.",
      vehicleBlock:
        "Vehicle facts (do not contradict): 2025 Ford Explorer ST, four-door SUV.",
      oemBlock: "OEM affiliation: Ford. Follow Ford advertising standards.",
      designBlock: "Design DNA: premium high-end campaign composition.",
      supportingBlocks: [
        `Brand voice: ${"warm, factual, polished ".repeat(30)}`,
        `Dealership facts: ${"Howell showroom; ".repeat(30)}`,
      ],
      platformBlock: `Platform guidance: ${"destination-specific detail ".repeat(100)}`,
    });

    expect(brief.length).toBeLessThanOrEqual(1400);
    expect(brief).toContain(
      'Dealership identity (use this exact name): "Bob Maxey Ford of Howell"',
    );
    expect(brief).toContain("Scenario: New arrival announcement");
    expect(brief).toContain("2025 Ford Explorer ST");
    expect(brief).toContain("OEM affiliation: Ford");
  });

  it("keeps every essential block inside the live 900-character caption window", () => {
    const brief = composeGenerationCreativeBrief({
      dealershipName: "D".repeat(140),
      scenarioBlock: `Post scenario: Pre-Owned Spotlight. ${"scenario ".repeat(80)}`,
      vehicleBlock: `Vehicle facts (do not contradict): Vehicle: 2025 Ford Explorer ST. ${"vehicle ".repeat(80)}`,
      oemBlock: `OEM affiliation: Ford. ${"oem guidance ".repeat(40)}`,
      designBlock: `Design DNA: premium environmental campaign. ${"design ".repeat(40)}`,
      supportingBlocks: [`Brand voice: ${"warm and polished ".repeat(80)}`],
      platformBlock: `Platform guidance: ${"destination detail ".repeat(80)}`,
    });
    const liveCaptionWindow = brief.slice(0, 900);

    expect(liveCaptionWindow).toContain("Dealership identity");
    expect(liveCaptionWindow).toContain("Post scenario: Pre-Owned Spotlight");
    expect(liveCaptionWindow).toContain("Vehicle: 2025 Ford Explorer ST");
    expect(liveCaptionWindow).toContain("OEM affiliation: Ford");
    expect(liveCaptionWindow).toContain("Design DNA: premium environmental campaign");
    expect(brief.length).toBeLessThanOrEqual(1400);
  });

  it("keeps the scenario marker intact even when an ordinary long custom label would push it past the 240-char scenario budget", () => {
    // scenarioBlock alone is truncated to 240 chars further down in this
    // function, by plain character count, with no awareness of where inside
    // it the trusted marker sits. A long (but not spoofed; the label already
    // goes through stripIdMarkerSpoof) custom scenario label could push the
    // marker past that cut, silently falling back to label-alias matching,
    // which a label like "Sold By Salesperson..." can legitimately collide
    // with. The marker must survive regardless of label length.
    const longLabelJson = JSON.stringify([
      {
        id: "custom_abcdef12",
        label: "Sold By Salesperson." + "z".repeat(230),
        promptAdditions: "Nothing suspicious here, just a very long ordinary label.",
        requiresCustomer: false,
      },
    ]);
    const scenarioBlock = scenarioToCreativeBrief("custom_abcdef12", longLabelJson);
    const brief = composeGenerationCreativeBrief({
      dealershipName: "Bob Maxey Ford",
      scenarioBlock,
      designBlock: "Design DNA: clean, modern.",
      supportingBlocks: [],
    });
    expect(classifyCreativeBrief(brief).scenario).toBe("custom");
  });
});
