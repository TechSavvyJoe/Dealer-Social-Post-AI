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

const componentFiles = (): string[] => {
  const dir = resolve(process.cwd(), "components");
  return [
    ...readdirSync(dir)
      .filter((f) => f.endsWith(".tsx"))
      .map((f) => `components/${f}`),
    ...readdirSync(resolve(dir, "ui"))
      .filter((f) => f.endsWith(".tsx"))
      .map((f) => `components/ui/${f}`),
  ];
};

/**
 * The one subtree these rules must not police.
 *
 * The publish result is deliberately dark in both themes: App.tsx puts
 * `publish-studio-theme` on the result wrapper and globals.css re-darkens the
 * whole surface ramp inside it, so photo and video colour stays accurate. Ink
 * that would be unreadable anywhere else is correct there — measured, the one
 * site this exempts is 8.13:1 on the studio ground and would drop to roughly
 * 1.5:1 if "fixed" for Sunlight Mode.
 *
 * "studioThemeInvariants" below pins the three facts this exemption rests on,
 * so if the studio theme is ever removed or the portal loses it, that test
 * fails rather than this exemption silently hiding a real defect.
 */
const STUDIO_THEMED_FILES = new Set(["components/PostResult.tsx"]);

/**
 * Does this exact class literal already carry its own Sunlight Mode override?
 *
 * Checks the matched literal, not a window of nearby lines. An earlier version
 * scanned +/-4 lines, which let one branch of a cn() ternary excuse its
 * sibling: components/AdminDashboard.tsx had a fixed warning branch sitting
 * directly above a broken success branch, two pills rendered side by side, one
 * readable in Sunlight Mode and one not. Variants are tolerated between the
 * theme selector and the utility so `[.theme-light_&]:hover:text-error-800`
 * counts.
 */
const hasLightOverride = (literal: string, ramp: string): boolean =>
  new RegExp(`theme-light_&\\]:(?:[a-z-]+:)*text-${ramp}`).test(literal);

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
    // The generalised rule. Every semantic ramp is static hex, so -50 through
    // -300 ink is tuned for a dark surface; on its own 10-40% tinted fill in
    // Sunlight Mode that fill resolves near-white and the text measures 1.19
    // to 1.60:1. Error copy was the worst case (53 sites) because it appears
    // when something has already gone wrong, but the brand pills (33), warning
    // and success states (37) all had it too.
    //
    // -300 was added after -50/-100/-200 shipped. Stopping at -200 left 12
    // live sites the rule could not see, including a success pill measured at
    // 1.24:1 sitting directly beside a warning pill the same commit had fixed.
    // -400 is deliberately still out: the tree has no such sites, so including
    // it would prove nothing.
    const offenders: string[] = [];
    const files = componentFiles();
    for (const ramp of ["error", "primary", "warning", "success", "info"]) {
      // `[^"\n]` rather than `[^"]`: the character class must not cross a line
      // break, or a match can start at the quote closing an unrelated line and
      // end several lines later, reporting a line number that points at the
      // wrong code. Proven in a sandbox: an offender was reported as line 1,
      // the `import React from "react";` above it.
      const tintedFillWithLightInk = new RegExp(
        `"[^"\\n]*\\bbg-${ramp}-\\d{2,3}\\/\\d+\\b[^"\\n]*\\btext-${ramp}-(?:50|100|200|300)\\b[^"\\n]*"`,
        "g",
      );
      for (const file of files) {
        if (STUDIO_THEMED_FILES.has(file)) continue;
        const source = read(file);
        for (const match of source.matchAll(tintedFillWithLightInk)) {
          if (hasLightOverride(match[0], ramp)) continue;
          const line = source.slice(0, match.index).split("\n").length;
          offenders.push(`${ramp}  ${file}:${line}`);
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
    // match on, and those were the majority of the original 53. On the three
    // Sunlight surfaces (#f8fafc, #f1f5f9, #ffffff) text-error-300 measures
    // 1.73 to 1.90:1; the -800 override takes it to 7.59 to 8.31:1.
    const offenders: string[] = [];
    for (const file of componentFiles()) {
      if (STUDIO_THEMED_FILES.has(file)) continue;
      const source = read(file);
      for (const match of source.matchAll(
        /"[^"\n]*\btext-error-(?:100|200|300)\b[^"\n]*"/g,
      )) {
        if (hasLightOverride(match[0], "error")) continue;
        const line = source.slice(0, match.index).split("\n").length;
        offenders.push(`${file}:${line}`);
      }
    }
    expect(
      offenders,
      `error ink with no Sunlight Mode override:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("pins the studio-theme invariants the PostResult exemption rests on", () => {
    // STUDIO_THEMED_FILES exempts the result screen because it is dark in both
    // themes. That is only true while all three of these hold. If any stops
    // holding, the exemption starts hiding real defects, so fail here instead.
    const app = read("App.tsx");
    expect(app).toContain("publish-studio-theme");
    expect(app).toContain("AppStep.RESULT");

    // globals.css must re-darken the surface ramp inside the studio, otherwise
    // the ramp stays inverted under .theme-light and the screen goes light.
    const css = read("styles/globals.css");
    const studio = css.slice(css.indexOf(".publish-studio-theme"));
    expect(studio).toMatch(/--surface-950:\s*2 6 23/);

    // The sticky delivery bar renders through createPortal into document.body,
    // so it lands outside the wrapper App.tsx themes and has to carry the class
    // itself. Without it the "Delivery locked" notice measured 1.19:1 in a real
    // browser against the built CSS; with it, 14.94:1.
    const result = read("components/PostResult.tsx");
    const portal = result.slice(result.indexOf("createPortal("));
    expect(portal).toContain("publish-studio-theme");
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
