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

  it("gives tinted-fill text a light-theme override on every ramp", () => {
    // The generalised rule. Every semantic ramp is static hex, so -50/-100/-200
    // ink is tuned for a dark surface; on its own 10-40% tinted fill in
    // Sunlight Mode that fill resolves near-white and the text measures about
    // 1.5:1. Error copy was the worst case (53 sites) because it appears when
    // something has already gone wrong, but the brand pills (33), warning and
    // success states (37) all had it too.
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
    for (const ramp of ["error", "primary", "warning", "success", "info"]) {
      const tintedFillWithLightInk = new RegExp(
        `"[^"]*\\bbg-${ramp}-\\d{2,3}\\/\\d+\\b[^"]*\\btext-${ramp}-(?:50|100|200)\\b[^"]*"`,
        "g",
      );
      for (const file of files) {
        const source = read(file);
        const lines = source.split("\n");
        for (const match of source.matchAll(tintedFillWithLightInk)) {
          if (match[0].includes("theme-light")) continue;
          // A cn() call may spread one className over several lines, so the
          // override can legitimately sit on a neighbouring line.
          const line = source.slice(0, match.index).split("\n").length - 1;
          const window = lines.slice(Math.max(0, line - 4), line + 5).join("\n");
          if (window.includes(`theme-light_&]:text-${ramp}`)) continue;
          offenders.push(`${ramp}  ${file}:${line + 1}`);
        }
      }
    }

    expect(
      offenders,
      `tinted-fill text with no Sunlight Mode override:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("still flags plain error ink outside a tinted fill, which the ramp rule misses", () => {
    // Kept separate: an error message on a plain surface has no bg-error-* to
    // match on, and those were the majority of the original 53.
    const offenders: string[] = [];
    const dir = resolve(process.cwd(), "components");
    const files = [
      ...readdirSync(dir)
        .filter((f) => f.endsWith(".tsx"))
        .map((f) => `components/${f}`),
      ...readdirSync(resolve(dir, "ui"))
        .filter((f) => f.endsWith(".tsx"))
        .map((f) => `components/ui/${f}`),
    ];
    for (const file of files) {
      const source = read(file);
      const lines = source.split("\n");
      for (const match of source.matchAll(/"[^"]*\btext-error-(?:100|200)\b[^"]*"/g)) {
        if (match[0].includes("theme-light")) continue;
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

  it("never puts a light-theme override on a ramp that already inverts", () => {
    // The rule this branch got wrong twice. The semantic ramps (error, primary,
    // warning, success, info) are static hex in tailwind.config.js, so light
    // ink needs an explicit [.theme-light_&] override. `surface` is different:
    // it is CSS-variable driven and globals.css already swaps it under
    // .theme-light, so surface-300 becomes dark ink and surface-800 becomes a
    // light fill. Overriding it UNDOES that swap. On the Badge neutral variant
    // it produced text-surface-800 on bg-surface-800 — 1.00:1, a blank capsule,
    // where the untouched class was 8.40:1.
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
      for (const match of source.matchAll(
        /\[\.theme-light_&\]:text-surface-(\d{2,3})/g,
      )) {
        const line = source.slice(0, match.index).split("\n").length;
        // Toast's close button predates this rule and measures 8.40:1; it
        // darkens rather than inverting, so it is grandfathered by exact site.
        if (file === "components/ui/Toast.tsx") continue;
        offenders.push(`${file}:${line} (surface-${match[1]})`);
      }
    }

    expect(
      offenders,
      `surface already inverts; these overrides undo it:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
