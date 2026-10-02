import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Sunlight Mode exists so a salesperson can read the screen outdoors, which
 * makes a contrast failure there worse than in the dark theme, not better.
 *
 * Light Table (2026-09-18) replaces the old fix — a `[.theme-light_&]`
 * override at -800/-900/-950 on every tinted-fill site — with tokens that
 * already resolve per theme (`bg-brand-fill`, `text-{success,warning,error,
 * info}-ink`, etc). PR1 files are migrated onto that system, so for them the
 * override literal itself becomes the defect: if one is still there, either
 * the migration missed a site or someone reintroduced a hardcoded ramp. Files
 * not yet migrated (PR2/PR3) keep the old override-based rule below, so they
 * stay protected until they migrate too.
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
 * PR1: every file already migrated onto the Light Table token system. These
 * get the strict guard (no legacy literal at all, on any ramp or number),
 * because the token system makes the literal unnecessary rather than merely
 * overridable.
 */
const MIGRATED_FILES = [
  "components/ui/Badge.tsx",
  "components/ui/Button.tsx",
  "components/ui/Card.tsx",
  "components/ui/EmptyState.tsx",
  "components/ui/ErrorBanner.tsx",
  "components/ui/Input.tsx",
  "components/ui/Modal.tsx",
  "components/ui/PageTransition.tsx",
  "components/ui/ProgressBar.tsx",
  "components/ui/ProgressiveImage.tsx",
  "components/ui/Shimmer.tsx",
  "components/ui/Skeleton.tsx",
  "components/ui/Toast.tsx",
  "components/ui/Tooltip.tsx",
  "components/Logo.tsx",
  "components/Header.tsx",
  "components/ProgressSteps.tsx",
  "components/SettingsModal.tsx",
  "components/LoginScreen.tsx",
  "components/CameraCapture.tsx",
  "components/RecentCaptureShelf.tsx",
  "components/ImageCropModal.tsx",
  "components/PostCustomizer.tsx",
  "components/ScenarioPicker.tsx",
  "components/VinScanner.tsx",
  "components/PhotoReleaseModal.tsx",
  "components/MainContent.tsx",
  "App.tsx",
];
const MIGRATED_FILE_SET = new Set(MIGRATED_FILES);

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
 * "studioThemeInvariants" below pins the facts this exemption rests on, so if
 * the studio theme is ever removed or the portal loses it, that test fails
 * rather than this exemption silently hiding a real defect.
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

const lineOf = (source: string, index: number): number =>
  source.slice(0, index).split("\n").length;

describe("Sunlight Mode keeps selected controls readable", () => {
  it("keeps migrated (Light Table) files free of the legacy override system and the motion it replaced", () => {
    // The strict guard for PR1. A `[.theme-light_&]` override on any ramp or
    // number is now a defect on these files, not a fix: the token system
    // (bg-brand-fill, text-*-ink, on-overlay) already resolves per theme, so
    // the literal's only remaining job would be to hide a hardcoded ramp that
    // should not be there at all. The ink check and the motion check ride
    // along on the same file loop because both are Light Table migration
    // invariants for this same file set (spec 8.1 items 4 and 7).
    const offenders: string[] = [];

    const overridePattern = /\[\.theme-light_&/g;
    const rampInkPattern =
      /\btext-(?:success|warning|error|info|primary)-(?:50|100|200|300|400)\b/g;
    const plainNeedles = [
      "text-white",
      'type: "spring"',
      "whileHover",
      "whileTap",
      "repeat: Infinity",
    ];

    for (const file of MIGRATED_FILES) {
      const source = read(file);

      for (const match of source.matchAll(overridePattern)) {
        offenders.push(
          `${file}:${lineOf(source, match.index)} — leftover [.theme-light_&] override; the token system makes it unnecessary`,
        );
      }

      for (const match of source.matchAll(rampInkPattern)) {
        offenders.push(
          `${file}:${lineOf(source, match.index)} — leftover hardcoded ink "${match[0]}"`,
        );
      }

      for (const needle of plainNeedles) {
        let from = 0;
        for (;;) {
          const at = source.indexOf(needle, from);
          if (at === -1) break;
          offenders.push(
            `${file}:${lineOf(source, at)} — leftover ${JSON.stringify(needle)}`,
          );
          from = at + needle.length;
        }
      }
    }

    expect(
      offenders,
      `Light Table migration leftovers:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("gives Modal's dialog panel the on-overlay class so ink resolves correctly inside dialogs", () => {
    const modal = read("components/ui/Modal.tsx");
    expect(modal).toContain("on-overlay");
  });

  it("keeps the dealer settings selected pills legible", () => {
    // DealerAdminDashboard.tsx is PR3, not yet migrated: it still carries the
    // override literal, so this per-file pin stays until it migrates too.
    const dashboard = read("components/DealerAdminDashboard.tsx");
    expect(dashboard).toContain("[.theme-light_&]:text-success-900");
    expect(dashboard).toContain("[.theme-light_&]:text-warning-900");
  });

  it("uses no hardcoded text-white on a theme-aware fill in the schedule dialog", () => {
    // ScheduleDialog.tsx is PR2, not yet migrated: keep the regression guard.
    const dialog = read("components/ScheduleDialog.tsx");
    expect(dialog).not.toContain("text-white");
  });

  it("gives tinted-fill text a light-theme override on every ramp (PR2/PR3 files not yet migrated)", () => {
    // The generalised rule, scoped to files Light Table has not reached yet.
    // Migrated files are covered by the strict guard above instead — for
    // them the override itself is banned, so this rule would never trigger
    // there anyway, but excluding them keeps this test's failure messages
    // about the files it actually protects.
    const offenders: string[] = [];
    const files = componentFiles();
    for (const ramp of ["error", "primary", "warning", "success", "info"]) {
      // `[^"\n]` rather than `[^"]`: the character class must not cross a line
      // break, or a match can start at the quote closing an unrelated line and
      // end several lines later, reporting a line number that points at the
      // wrong code.
      const tintedFillWithLightInk = new RegExp(
        `"[^"\\n]*\\bbg-${ramp}-\\d{2,3}\\/\\d+\\b[^"\\n]*\\btext-${ramp}-(?:50|100|200|300)\\b[^"\\n]*"`,
        "g",
      );
      for (const file of files) {
        if (STUDIO_THEMED_FILES.has(file) || MIGRATED_FILE_SET.has(file)) continue;
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

  it("still flags plain error ink outside a tinted fill, which the ramp rule misses (PR2/PR3 files not yet migrated)", () => {
    // Kept separate: an error message on a plain surface has no bg-error-* to
    // match on. Scoped the same way as the rule above.
    const offenders: string[] = [];
    for (const file of componentFiles()) {
      if (STUDIO_THEMED_FILES.has(file) || MIGRATED_FILE_SET.has(file)) continue;
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

  it("keeps the new Post screen in the selected Sunlight theme", () => {
    const app = read("App.tsx");
    const main = read("components/MainContent.tsx");
    expect(app).not.toContain("publish-studio-theme");
    expect(main).not.toContain('import("./PostResult")');
    expect(main).toContain('import("./PostScreen")');
    const post = read("components/PostScreen.tsx");
    expect(post).not.toContain("publish-studio-theme");
    expect(post).toContain("text-ink");
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
    const files = componentFiles();

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

  it("keeps dialog helper text off text-ink-3, which under-contrasts on the dialog surface", () => {
    // --ink-3 measures 4.22:1 on the page surface but only on the page surface.
    // Inside a dialog, helper text must use text-ink-hint instead, which
    // .on-overlay re-points to --ink-2 for the dialog's surface. Modal.tsx and
    // the primitives dialogs compose (ProgressBar, Toast, Input, ErrorBanner)
    // are covered here alongside the dialog components themselves.
    const DIALOG_FILES = [
      "components/SettingsModal.tsx",
      "components/PhotoReleaseModal.tsx",
      "components/ImageCropModal.tsx",
      "components/VinScanner.tsx",
      "components/ui/Modal.tsx",
      "components/ui/ProgressBar.tsx",
      "components/ui/Toast.tsx",
      "components/ui/Input.tsx",
      "components/ui/ErrorBanner.tsx",
    ];

    const offenders: string[] = [];
    for (const file of DIALOG_FILES) {
      const source = read(file);
      for (const match of source.matchAll(/\btext-ink-3\b/g)) {
        const line = source.slice(0, match.index).split("\n").length;
        offenders.push(`${file}:${line}`);
      }
    }

    expect(
      offenders,
      `text-ink-3 under-contrasts on dialog surfaces; use text-ink-hint instead:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
