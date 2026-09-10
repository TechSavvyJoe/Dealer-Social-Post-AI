import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Sunlight Mode exists so a salesperson can read the screen outdoors, which
 * makes a contrast failure there worse than in the dark theme, not better.
 *
 * The token ramps are tuned for dark surfaces: -100/-200/-300 ink sits on a
 * dark fill. In light theme the same 10-30% tinted fills resolve to near-white,
 * so that ink drops to roughly 1.5:1 and the control renders as an empty
 * capsule. Verified in light-theme renders of the customizer and the dealer
 * settings card. The fix is a `[.theme-light_&]` override at -800/-900/-950.
 */
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("Sunlight Mode keeps selected controls readable", () => {
  it("gives every Badge variant light-theme ink", () => {
    const badge = read("components/ui/Badge.tsx");
    for (const variant of ["primary", "success", "warning", "error", "info"]) {
      expect(badge).toContain(`[.theme-light_&]:text-${variant}-800`);
    }
  });

  it("keeps the selected design-style card legible", () => {
    const customizer = read("components/PostCustomizer.tsx");
    // Title, description and detail lines of the active card.
    expect(customizer).toContain("[.theme-light_&]:text-primary-950");
    expect(customizer).toContain("[.theme-light_&]:text-primary-900");
    expect(customizer).toContain("[.theme-light_&]:text-primary-800");
  });

  it("keeps completed steps legible in the stepper", () => {
    const steps = read("components/ProgressSteps.tsx");
    expect(steps.match(/\[\.theme-light_&\]:text-success-800/g)?.length).toBe(2);
  });

  it("keeps the dealer settings selected pills legible", () => {
    const dashboard = read("components/DealerAdminDashboard.tsx");
    expect(dashboard).toContain("[.theme-light_&]:text-success-900");
    expect(dashboard).toContain("[.theme-light_&]:text-warning-900");
  });

  it("uses no hardcoded text-white on a theme-aware fill in the schedule dialog", () => {
    const dialog = read("components/ScheduleDialog.tsx");
    expect(dialog).not.toContain("text-white");
  });

  it("gives every error message light-theme ink, wherever it lives", () => {
    // Error copy is the worst thing to lose in Sunlight Mode: it appears when
    // something already went wrong. The tinted error fills resolve near-white
    // in light theme, so -100/-200 ink measures about 1.5:1 there. 53 sites
    // across 24 components were affected before this rule.
    const dir = resolve(process.cwd(), "components");
    const files = [
      ...readdirSync(dir)
        .filter((f) => f.endsWith(".tsx"))
        .map((f) => `components/${f}`),
      ...readdirSync(resolve(dir, "ui"))
        .filter((f) => f.endsWith(".tsx"))
        .map((f) => `components/ui/${f}`),
    ];

    const offenders: string[] = [];
    for (const file of files) {
      const source = read(file);
      const lines = source.split("\n");
      for (const match of source.matchAll(/"[^"]*\btext-error-(?:100|200)\b[^"]*"/g)) {
        if (match[0].includes("theme-light")) continue;
        // A cn() call may spread one className over several lines, so the
        // override can legitimately sit on a neighbouring line.
        const line = source.slice(0, match.index).split("\n").length - 1;
        const window = lines.slice(Math.max(0, line - 4), line + 5).join("\n");
        if (window.includes("theme-light_&]:text-error")) continue;
        offenders.push(`${file}:${line + 1}`);
      }
    }

    expect(
      offenders,
      `error ink with no Sunlight Mode override:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("gives every selected brand pill light-theme ink too", () => {
    // Same defect class as the error ink, on the brand ramp: a selected pill's
    // -50/-100/-200 text on a tinted primary fill vanishes in Sunlight Mode.
    // 33 sites across 16 components were affected.
    const dir = resolve(process.cwd(), "components");
    const files = [
      ...readdirSync(dir)
        .filter((f) => f.endsWith(".tsx"))
        .map((f) => `components/${f}`),
      ...readdirSync(resolve(dir, "ui"))
        .filter((f) => f.endsWith(".tsx"))
        .map((f) => `components/ui/${f}`),
    ];

    const offenders: string[] = [];
    for (const file of files) {
      const source = read(file);
      const lines = source.split("\n");
      const selectedPill =
        /"[^"]*\bbg-primary-\d{3}\/\d+\b[^"]*\btext-primary-(?:50|100|200)\b[^"]*"/g;
      for (const match of source.matchAll(selectedPill)) {
        if (match[0].includes("theme-light")) continue;
        const line = source.slice(0, match.index).split("\n").length - 1;
        const window = lines.slice(Math.max(0, line - 4), line + 5).join("\n");
        if (window.includes("theme-light_&]:text-primary")) continue;
        offenders.push(`${file}:${line + 1}`);
      }
    }

    expect(
      offenders,
      `selected brand pills with no Sunlight Mode override:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
