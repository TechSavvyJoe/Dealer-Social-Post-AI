import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Sunlight Mode exists so a salesperson can read the screen outdoors, which
 * makes a contrast failure there worse than in the dark theme, not better.
 *
 * Light Table (2026-09-18) replaces the old fix — a `[.theme-light_&]`
 * override at -800/-900/-950 on every tinted-fill site — with tokens that
 * already resolve per theme (`bg-brand-fill`, `text-{success,warning,error,
 * info}-ink`, `text-ink-2`, etc). On a file that is on those tokens, a legacy
 * literal is the defect itself: either a migration missed a site or someone
 * reintroduced a hardcoded ramp.
 *
 * Every source file under components/ (any depth) and App.tsx gets the strict
 * guard by default. The scan recurses, so a new folder is checked from its
 * first file. The only files outside the strict guard are LEGACY_FILES below,
 * each with its reason; they keep the older override-based rules instead, and
 * the ratchet test fails as soon as one of them no longer needs its exemption.
 */
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/** Every product source file under `dir`, at any depth. Tests are not product code. */
const componentFiles = (dir = "components"): string[] =>
  readdirSync(resolve(process.cwd(), dir), { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? componentFiles(`${dir}/${entry.name}`)
        : /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
          ? [`${dir}/${entry.name}`]
          : [],
    )
    .sort();

const sourceFiles = (): string[] => [...componentFiles(), "App.tsx"];

/**
 * The files the strict guard does not cover yet, and why. Nothing else may be
 * added here to make the guard pass: a new or rewritten screen is fixed, not
 * exempted.
 *
 * "Orphaned" files lost their last importer when the retired result and
 * camera screens were deleted (2026-10-06); they are listed for a follow-up
 * deletion, not for migration. "Unmounted" files have had no importer since
 * 5b6418c and are kept by decision.
 *
 * ImpersonationBanner and PlatformGlyph use no override system at all; their
 * fixed palettes look deliberate, and their exemption awaits the
 * orchestrator's sign-off.
 */
const LEGACY_FILES: Readonly<Record<string, string>> = {
  "components/CaptionAlternativesModal.tsx":
    "orphaned (only the retired result screen opened it); legacy overrides and spring motion",
  "components/Dialpad.tsx": "orphaned (no importer); legacy surface and primary ramps",
  "components/EditTextModal.tsx":
    "orphaned (only the retired result screen opened it); legacy overrides",
  "components/ErrorBoundary.tsx":
    "live crash screen, PR3 list, not yet migrated; legacy overrides and text-white",
  "components/ImpersonationBanner.tsx":
    "live, not yet migrated; a fixed violet/rose palette instead of tokens",
  "components/LocalMediaArchive.tsx":
    "live in the manager's post history, not yet migrated; legacy overrides",
  "components/MultiFormatExportModal.tsx":
    "orphaned (only the retired result screen opened it); legacy overrides",
  "components/PersonEditModal.tsx":
    "live in both dashboards, PR3 list, not yet migrated; legacy overrides",
  "components/PlatformDeliveryBoard.tsx":
    "orphaned (only the retired result screens rendered it); legacy overrides",
  "components/PlatformGlyph.tsx":
    "live; draws each network's own mark, so white glyphs on fixed brand fills are deliberate",
  "components/PlatformLimitMeter.tsx":
    "orphaned (only the retired result screen rendered it); legacy overrides",
  "components/PostHistory.tsx":
    "live in the manager's dashboard, PR3 list, not yet migrated; legacy overrides",
  "components/PwaUpdatePrompt.tsx":
    "live, not yet migrated; legacy overrides and text-white",
  "components/SystemHealthPanel.tsx":
    "live in the admin Connections panel, PR3 list, not yet migrated; legacy overrides",
  "components/TurnstileChallenge.tsx":
    "live on the login screen, not yet migrated; legacy overrides",
  "components/WalkaroundReleaseModal.tsx":
    "unmounted: imported only by WalkaroundStudio, which nothing renders; legacy overrides",
  "components/WalkaroundStudio.tsx":
    "unmounted: kept by decision, no importer since 5b6418c; legacy overrides",
  "components/WebcamCapture.tsx":
    "orphaned (only the retired camera screen opened it); legacy overrides",
};

const strictFiles = (): string[] =>
  sourceFiles().filter((file) => !Object.hasOwn(LEGACY_FILES, file));

const legacyFiles = (): string[] =>
  sourceFiles().filter((file) => Object.hasOwn(LEGACY_FILES, file));

/**
 * Code, not comments: a comment that names a legacy class to explain history
 * (components/ui/ErrorBanner.tsx does) is not a leftover. Comments are blanked
 * to spaces of the same length, so indices (and line numbers) still point at
 * the real source. `://` survives so a URL is not cut short. Used by the
 * colour-vocabulary rules added on 2026-10-06; the original four rules read
 * the raw source as they always did.
 */
const blankComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "))
    .replace(
      /(^|[^:])(\/\/[^\n]*)/g,
      (_m, lead: string, c: string) => lead + c.replace(/[^\n]/g, " "),
    );

const COLOUR_UTILITY =
  "(?:bg|border|text|ring|ring-offset|outline|divide|from|via|to|fill|stroke|shadow|placeholder|accent|caret|decoration)";
const STEP = "(?:50|[1-9]00|950)";

/** The legacy hex ramps the `-ink`/`-fill` tokens replace, on any utility. */
const LEGACY_SEMANTIC_RAMP = new RegExp(
  `\\b${COLOUR_UTILITY}-(?:success|warning|error|info|primary)-${STEP}\\b`,
  "g",
);
/** The surface alias ramp, kept only so unmigrated screens compile. */
const LEGACY_SURFACE_RAMP = new RegExp(`\\b${COLOUR_UTILITY}-surface-${STEP}\\b`, "g");
/** A raw Tailwind hue: Light Table carries colour by token and dealer brand only. */
const RAW_HUE = new RegExp(
  `\\b${COLOUR_UTILITY}-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-${STEP}\\b`,
  "g",
);

const lineOf = (source: string, index: number): number =>
  source.slice(0, index).split("\n").length;

/**
 * Every Light Table leftover in one file's source. The override, the light
 * ramp ink, text-white and the motion needles are spec 8.1 items 4 and 7; the
 * three colour-vocabulary rules make "on the tokens" mean the tokens only.
 */
const lightTableLeftovers = (file: string, source: string): string[] => {
  const offenders: string[] = [];
  const at = (index: number) => `${file}:${lineOf(source, index)}`;

  for (const match of source.matchAll(/\[\.theme-light_&/g)) {
    offenders.push(
      `${at(match.index)} — leftover [.theme-light_&] override; the token system makes it unnecessary`,
    );
  }
  for (const match of source.matchAll(
    /\btext-(?:success|warning|error|info|primary)-(?:50|100|200|300|400)\b/g,
  )) {
    offenders.push(`${at(match.index)} — leftover hardcoded ink "${match[0]}"`);
  }
  for (const needle of [
    "text-white",
    'type: "spring"',
    "whileHover",
    "whileTap",
    "repeat: Infinity",
  ]) {
    for (let from = source.indexOf(needle); from >= 0;) {
      offenders.push(`${at(from)} — leftover ${JSON.stringify(needle)}`);
      from = source.indexOf(needle, from + needle.length);
    }
  }

  const code = blankComments(source);
  for (const [rule, pattern] of [
    ["legacy hex ramp", LEGACY_SEMANTIC_RAMP],
    ["legacy surface ramp", LEGACY_SURFACE_RAMP],
    ["raw Tailwind hue", RAW_HUE],
  ] as const) {
    for (const match of code.matchAll(pattern)) {
      offenders.push(`${at(match.index)} — ${rule} "${match[0]}"`);
    }
  }
  return offenders;
};

/**
 * A fixed colour that no theme can move: a 3, 6 or 8 digit hex value (in a JS
 * value or an arbitrary class such as `text-[#ffffff]`), an rgb()/hsl() call
 * with literal numbers (`rgb(var(--ink))` is a token and passes), or a black
 * or white utility with any opacity. Named colours in JS values (`"white"`)
 * and 4-digit hex are not read; a 4-digit rule would flag hashtags such as
 * "#F150".
 *
 * The rgb()/hsl() rule must not use `\b`: `_` is a word character, and in an
 * arbitrary value the call usually follows one (`shadow-[0_0_4px_rgba(…)]`),
 * which `\b` would skip. It refuses only a letter, digit or hyphen before the
 * name, so `_`, `[`, `,`, `(`, `:`, quotes and spaces all still match.
 */
const FIXED_COLOUR_PATTERNS: readonly RegExp[] = [
  /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/g,
  /(?<![A-Za-z0-9-])(?:rgba?|hsla?)\(\s*[\d.][^)]*\)/g,
  new RegExp(`\\b${COLOUR_UTILITY}-(?:white|black)(?:\\/\\d+)?(?![\\w-])`, "g"),
];

/**
 * The one sanctioned fixed palette (orchestrator decision): SamplePhoto draws
 * a picture of a designed post, which looks the same in either theme, so its
 * four print colours live in ONE object. That object, by name and exact
 * content, is the allowance; the rest of the file is scanned like any other.
 */
const PRINT_PALETTE_FILE = "components/dealer-settings/SamplePhoto.tsx";
const PRINT_PALETTE_DECLARATION = /const PRINT_PALETTE = \{([^{}]*)\} as const;/g;
const PRINT_PALETTE: Readonly<Record<string, string>> = {
  type: "#ffffff",
  shade: "#000000",
  band: "#f6f3ee",
  bandType: "#1b1d1f",
};

/**
 * Removes PRINT_PALETTE from SamplePhoto's code (comments already blanked),
 * keeping line numbers, after proving it is exactly the sanctioned object.
 * Any other file is returned unchanged.
 */
const withoutPrintPalette = (file: string, code: string): string => {
  if (file !== PRINT_PALETTE_FILE) return code;
  const declarations = [...code.matchAll(PRINT_PALETTE_DECLARATION)];
  expect(
    declarations,
    "SamplePhoto must declare PRINT_PALETTE exactly once",
  ).toHaveLength(1);
  const body = declarations[0][1];
  const entries = Object.fromEntries(
    [...body.matchAll(/(\w+):\s*"([^"]*)"/g)].map((m) => [m[1], m[2]]),
  );
  expect(entries, "PRINT_PALETTE holds only its four sanctioned colours").toEqual(
    PRINT_PALETTE,
  );
  expect(
    body.replace(/(\w+):\s*"([^"]*)"/g, "").replace(/[\s,]/g, ""),
    "PRINT_PALETTE holds nothing but its four keys",
  ).toBe("");
  return code.replace(PRINT_PALETTE_DECLARATION, (m) => m.replace(/[^\n]/g, " "));
};

/**
 * Fixed colours that predate this rule in strict files, each by exact literal
 * and count, with its reason. These are NOT the sanctioned exception above:
 * they are listed so the rule can land green, and they await the
 * orchestrator's sign-off. A new site, a changed value or one more copy fails;
 * an entry whose literal is gone fails the ratchet.
 */
const FIXED_COLOUR_SITES: Readonly<
  Record<string, { literals: readonly string[]; reason: string }>
> = {
  "components/Logo.tsx": {
    literals: [
      "rgba(255,255,255,0.14)",
      "rgba(255,255,255,0.22)",
      "rgba(255,255,255,0.28)",
      "#ffffff",
    ],
    reason: "the onBrand lockup is white on the brand fill in either theme",
  },
  "components/LoginScreen.tsx": {
    literals: ["rgba(255,255,255,.10)", "rgba(0,0,0,.20)"],
    reason: "aria-hidden watermark scrims on the login brand column (bg-brand-fill)",
  },
  "components/DealerSetupWizard.tsx": {
    literals: ["#1d4ed8", "#1d4ed8", "#1d4ed8"],
    reason:
      "a hex example in error copy and a placeholder, and the colour input's fallback value",
  },
  "components/dealer-settings/CreativeSection.tsx": {
    literals: ["#1d4ed8", "#1d4ed8"],
    reason: "the colour input's fallback value and a hex placeholder",
  },
  "components/dealer-settings/useDealerSettingsForm.ts": {
    literals: ["#1d4ed8"],
    reason: "a hex example in error copy",
  },
  "components/VinScanner.tsx": {
    literals: ["bg-black"],
    reason: "the camera viewport behind the live video",
  },
  "components/ui/Modal.tsx": {
    literals: ["bg-black/60"],
    reason: "the dialog scrim",
  },
  "components/ImagePreviewModal.tsx": {
    literals: ["bg-black/90"],
    reason: "the photo lightbox ground (no importer; a deletion candidate)",
  },
};

/** Every fixed colour in one strict file's code, with its line. */
const fixedColourHits = (
  file: string,
  source: string,
): { line: number; literal: string }[] => {
  const code = withoutPrintPalette(file, blankComments(source));
  return FIXED_COLOUR_PATTERNS.flatMap((pattern) =>
    [...code.matchAll(pattern)].map((match) => ({
      line: lineOf(code, match.index),
      literal: match[0],
    })),
  );
};

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
  it("scans every folder under components/, so a new one is never skipped", () => {
    const files = sourceFiles();
    for (const folder of [
      "components/admin/",
      "components/dealer-settings/",
      "components/details/",
      "components/home/",
      "components/post/",
      "components/ui/",
      "components/work/",
    ]) {
      expect(
        files.some((file) => file.startsWith(folder)),
        `${folder} has no scanned files`,
      ).toBe(true);
    }
    // The main path and the redesigned settings and admin screens are strict.
    const strict = new Set(strictFiles());
    for (const file of [
      "App.tsx",
      "components/Home.tsx",
      "components/PostDetails.tsx",
      "components/CreatingScreen.tsx",
      "components/PostScreen.tsx",
      "components/MyWork.tsx",
      "components/MainContent.tsx",
      "components/Header.tsx",
      "components/LoginScreen.tsx",
      "components/SettingsModal.tsx",
      "components/VinScanner.tsx",
      "components/SignaturePad.tsx",
      "components/ConfirmationModal.tsx",
      "components/OfflineBanner.tsx",
      "components/AdminDashboard.tsx",
      "components/DealerAdminDashboard.tsx",
      "components/DealerSetupWizard.tsx",
      "components/Leaderboard.tsx",
      "components/ApprovalQueue.tsx",
      "components/HoursPicker.tsx",
      "components/details/ReleaseSheet.tsx",
      "components/post/PostPreviewCard.tsx",
      "components/admin/SetupBoard.tsx",
      "components/dealer-settings/SamplePhoto.tsx",
    ]) {
      expect(strict.has(file), `${file} is not under the strict guard`).toBe(true);
    }
  });

  it("keeps every file on the Light Table tokens, free of the legacy override system and the motion it replaced", () => {
    // A `[.theme-light_&]` override on any ramp or number is a defect here,
    // not a fix: the token system (bg-brand-fill, text-*-ink, on-overlay)
    // already resolves per theme, so the literal's only remaining job would
    // be to hide a hardcoded ramp that should not be there at all. The ink,
    // motion and colour checks ride along on the same file loop because they
    // are Light Table migration invariants for the same files (spec 8.1).
    const offenders = strictFiles().flatMap((file) =>
      lightTableLeftovers(file, read(file)),
    );
    expect(
      offenders,
      `Light Table migration leftovers:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("keeps fixed colours (hex, numeric rgb/hsl, black and white) out of every strict file", () => {
    // SamplePhoto's PRINT_PALETTE is the one sanctioned exception, allowed by
    // name and exact content. FIXED_COLOUR_SITES lists the older sites by
    // exact literal and count; anything else is a colour no theme can move.
    const offenders: string[] = [];
    const unused: string[] = [];
    for (const file of strictFiles()) {
      const allowed = [...(FIXED_COLOUR_SITES[file]?.literals ?? [])];
      for (const hit of fixedColourHits(file, read(file))) {
        const at = allowed.indexOf(hit.literal);
        if (at >= 0) allowed.splice(at, 1);
        else offenders.push(`${file}:${hit.line} — fixed colour "${hit.literal}"`);
      }
      unused.push(
        ...allowed.map((literal) => `${file} — "${literal}" is no longer there`),
      );
    }
    for (const file of Object.keys(FIXED_COLOUR_SITES)) {
      if (!strictFiles().includes(file)) unused.push(`${file} is not a strict file`);
    }
    expect(
      offenders,
      `fixed colours in strict files:\n${offenders.join("\n")}`,
    ).toEqual([]);
    expect(
      unused,
      `remove these from FIXED_COLOUR_SITES (ratchet):\n${unused.join("\n")}`,
    ).toEqual([]);
  });

  it("reads a fixed colour wherever a class or value can hold one", () => {
    // Pins the patterns themselves, so the claim in the verification record
    // stays true. The underscore-led arbitrary value is the form a `\b`
    // boundary missed; components/PlatformGlyph.tsx uses it today.
    const literalsIn = (source: string) =>
      fixedColourHits("components/zz-pattern-probe.tsx", source).map(
        (hit) => hit.literal,
      );
    for (const [source, literal] of [
      ['className="shadow-[0_0_4px_rgba(0,0,0,.5)]"', "rgba(0,0,0,.5)"],
      [
        'className="shadow-[inset_0_1px_0_hsla(0,0%,100%,0.04)]"',
        "hsla(0,0%,100%,0.04)",
      ],
      ['className="bg-[rgb(0_0_0_/_50%)]"', "rgb(0_0_0_/_50%)"],
      ['className="shadow-[0_1px_rgba(1,2,3,.1),0_2px_rgb(4,5,6)]"', "rgb(4,5,6)"],
      ['const tile = "rgba(255,255,255,0.14)";', "rgba(255,255,255,0.14)"],
      ["fill={`hsl(210 40% 50%)`}", "hsl(210 40% 50%)"],
      ['className="text-[#ffffff]"', "#ffffff"],
      ['className="shadow-[0_0_4px_#000]"', "#000"],
      ['const shade = "#1b1d1fcc";', "#1b1d1fcc"],
      ['className="bg-black/60"', "bg-black/60"],
      ['className="hover:border-white"', "border-white"],
    ] as const) {
      expect(literalsIn(source), source).toContain(literal);
    }
    // Tokens and computed values are not fixed colours.
    for (const source of [
      'const ink = "rgb(var(--ink))";',
      'className="shadow-[0_0_4px_rgb(var(--ink)/0.4)]"',
      'return `rgb(${channels.join(", ")})`;',
      'const label = "#F150 Lariat";',
      'className="bg-brand-fill text-brand-foreground"',
    ]) {
      expect(literalsIn(source), source).toEqual([]);
    }
  });

  it("keeps an exemption only while the file still needs it (ratchet)", () => {
    // A legacy file that has been migrated must leave LEGACY_FILES, so it
    // gets the strict guard; a listed file that no longer exists is stale.
    const sources = new Set(sourceFiles());
    const stale = Object.keys(LEGACY_FILES).filter(
      (file) =>
        !sources.has(file) || lightTableLeftovers(file, read(file)).length === 0,
    );
    expect(
      stale,
      `remove these from LEGACY_FILES; they are gone or already clean:\n${stale.join("\n")}`,
    ).toEqual([]);
  });

  it("gives Modal's dialog panel the on-overlay class so ink resolves correctly inside dialogs", () => {
    const modal = read("components/ui/Modal.tsx");
    expect(modal).toContain("on-overlay");
  });

  it("keeps the delete confirmation to its question and two actions, with no icon tile", () => {
    // Light Table has no decorative icon tiles; the danger button carries the
    // weight. The old red AlertTriangle disc is what this replaced.
    const confirm = read("components/ConfirmationModal.tsx");
    expect(confirm).not.toContain('from "lucide-react"');
    expect(confirm).toContain('variant="danger"');
    expect(confirm).toContain(
      "Are you sure? This action cannot be undone and will permanently remove this",
    );
  });

  it("keeps the dealer settings free of per-theme override literals", () => {
    // DealerAdminDashboard.tsx sits on the Light Table tokens, so a
    // `[.theme-light_&]` override there would only hide a hardcoded ramp.
    const dashboard = read("components/DealerAdminDashboard.tsx");
    expect(dashboard).not.toContain("[.theme-light_&");
  });

  it("gives tinted-fill text a light-theme override on every ramp (legacy files)", () => {
    // The generalised rule, for the files the strict guard does not cover
    // yet. Strict files are held to the stricter rule above instead — for
    // them the override itself is banned — so this test's failure messages
    // stay about the files it actually protects.
    const offenders: string[] = [];
    for (const ramp of ["error", "primary", "warning", "success", "info"]) {
      // `[^"\n]` rather than `[^"]`: the character class must not cross a line
      // break, or a match can start at the quote closing an unrelated line and
      // end several lines later, reporting a line number that points at the
      // wrong code.
      const tintedFillWithLightInk = new RegExp(
        `"[^"\\n]*\\bbg-${ramp}-\\d{2,3}\\/\\d+\\b[^"\\n]*\\btext-${ramp}-(?:50|100|200|300)\\b[^"\\n]*"`,
        "g",
      );
      for (const file of legacyFiles()) {
        const source = read(file);
        for (const match of source.matchAll(tintedFillWithLightInk)) {
          if (hasLightOverride(match[0], ramp)) continue;
          offenders.push(`${ramp}  ${file}:${lineOf(source, match.index)}`);
        }
      }
    }

    expect(
      offenders,
      `tinted-fill text with no Sunlight Mode override:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("still flags plain error ink outside a tinted fill, which the ramp rule misses (legacy files)", () => {
    // Kept separate: an error message on a plain surface has no bg-error-* to
    // match on. Scoped the same way as the rule above.
    const offenders: string[] = [];
    for (const file of legacyFiles()) {
      const source = read(file);
      for (const match of source.matchAll(
        /"[^"\n]*\btext-error-(?:100|200|300)\b[^"\n]*"/g,
      )) {
        if (hasLightOverride(match[0], "error")) continue;
        offenders.push(`${file}:${lineOf(source, match.index)}`);
      }
    }
    expect(
      offenders,
      `error ink with no Sunlight Mode override:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("keeps the Post screen in the selected Sunlight theme", () => {
    const app = read("App.tsx");
    const main = read("components/MainContent.tsx");
    expect(app).not.toContain("publish-studio-theme");
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
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const source = read(file);
      for (const match of source.matchAll(
        /\[\.theme-light_&\]:text-surface-(\d{2,3})/g,
      )) {
        // Toast's close button predates this rule and measures 8.40:1; it
        // darkens rather than inverting, so it is grandfathered by exact site.
        if (file === "components/ui/Toast.tsx") continue;
        offenders.push(`${file}:${lineOf(source, match.index)} (surface-${match[1]})`);
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
    // .on-overlay re-points to --ink-2 for the dialog's surface. These are the
    // files that render only inside a dialog (the release sheet and its
    // signature pad open in Details' Modal), plus the primitives dialogs
    // compose.
    const DIALOG_FILES = [
      "components/SettingsModal.tsx",
      "components/VinScanner.tsx",
      "components/ConfirmationModal.tsx",
      "components/ImagePreviewModal.tsx",
      "components/details/ReleaseSheet.tsx",
      "components/SignaturePad.tsx",
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
        offenders.push(`${file}:${lineOf(source, match.index)}`);
      }
    }

    expect(
      offenders,
      `text-ink-3 under-contrasts on dialog surfaces; use text-ink-hint instead:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
