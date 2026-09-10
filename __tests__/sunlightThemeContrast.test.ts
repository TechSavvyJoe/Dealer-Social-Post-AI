import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
});
