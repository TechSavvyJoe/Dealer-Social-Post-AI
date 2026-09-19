/**
 * Colour math for the Light Table brand accent.
 *
 * Pure functions only — no DOM, no store reads, safe to unit test in
 * isolation. hooks/useDealerTheme.ts calls deriveBrandTokens() and writes
 * the results onto document.documentElement's inline style.
 *
 * Spec: docs/superpowers/specs/2026-09-18-light-table-ui-design.md §4.1
 * "Brand accent" rules 1-6.
 */

export type ThemeName = "dark" | "light";

export interface BrandTokens {
  /** The accent as painted. Never the raw dealer.brand_color — see rule 2. */
  fill: string;
  fillRgb: string;
  /** Text/icon colour on --brand-fill. Always one of these two hex values. */
  foreground: "#ffffff" | "#141618";
  foregroundRgb: string;
  /** Brand as text/icon on the theme's --panel, ≥ 4.5:1. */
  ink: string;
  inkRgb: string;
  ramp300: string;
  ramp300Rgb: string;
  ramp400: string;
  ramp400Rgb: string;
  ramp500: string;
  ramp500Rgb: string;
  ramp600: string;
  ramp600Rgb: string;
  ramp700: string;
  ramp700Rgb: string;
}

const WHITE = "#ffffff";
const NEAR_BLACK = "#141618";
const PANEL_DARK = "#191c1f";
const PANEL_LIGHT = "#ffffff";
const MIN_CONTRAST = 4.5;
const MAX_FILL_DELTA_L = 0.25;

// ---------------------------------------------------------------------------
// Hex <-> RGB helpers
// ---------------------------------------------------------------------------

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const clampByte = (v: number): number => Math.min(255, Math.max(0, Math.round(v)));

/** "#abc" -> "#aabbcc"; already-6-digit hex passes through lowercased. */
export const normalizeHex = (hex: string): string => {
  const m = hex.trim().replace(/^#/, "").toLowerCase();
  const expanded =
    m.length === 3
      ? m
          .split("")
          .map((c) => c + c)
          .join("")
      : m;
  return `#${expanded}`;
};

const isValidHexString = (hex: string): boolean =>
  /^#[0-9a-f]{6}$/.test(normalizeHex(hex));

export const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  const h = normalizeHex(hex).slice(1);
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
};

export const rgbToHex = (r: number, g: number, b: number): string => {
  const c = (v: number) => clampByte(v).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
};

/** sRGB blend of `over` onto `base` at `alpha` (what a translucent fill shows). */
const mixHex = (base: string, over: string, alpha: number): string => {
  const b = hexToRgb(base);
  const o = hexToRgb(over);
  const mix = (x: number, y: number) => clampByte(x * (1 - alpha) + y * alpha);
  return rgbToHex(mix(b.r, o.r), mix(b.g, o.g), mix(b.b, o.b));
};

/** "r g b" triplet, the form every --brand-* custom property is stored in
 * (consumed as `rgb(var(--x) / <alpha-value>)` by tailwind.config.js). */
export const rgbTriplet = (hex: string): string => {
  const { r, g, b } = hexToRgb(hex);
  return `${r} ${g} ${b}`;
};

// ---------------------------------------------------------------------------
// sRGB <-> linear light, relative luminance, WCAG contrast
// ---------------------------------------------------------------------------

/** One sRGB channel (0-255) to linear light (0-1). */
export const srgbToLinear = (channel255: number): number => {
  const c = channel255 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

/** Linear light (0-1, out-of-range clamped) back to one sRGB channel (0-255). */
export const linearToSrgb = (linear: number): number => {
  const c = clamp01(linear);
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return clampByte(v * 255);
};

/** WCAG relative luminance (0-1) of a hex colour. */
export const relativeLuminance = (hex: string): number => {
  const { r, g, b } = hexToRgb(hex);
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
};

/** WCAG 2.x contrast ratio (1-21) between two hex colours. */
export const contrastRatio = (hexA: string, hexB: string): number => {
  const La = relativeLuminance(hexA);
  const Lb = relativeLuminance(hexB);
  const lighter = Math.max(La, Lb);
  const darker = Math.min(La, Lb);
  return (lighter + 0.05) / (darker + 0.05);
};

// ---------------------------------------------------------------------------
// sRGB <-> OKLCH (Björn Ottosson's OKLab matrices — the standard ones used
// by CSS Color 4 and every mainstream OKLab/OKLCH implementation)
// ---------------------------------------------------------------------------

export interface Oklch {
  /** Lightness, 0-1. */
  L: number;
  /** Chroma, unbounded (in-gamut sRGB is roughly 0-0.4). */
  C: number;
  /** Hue, degrees, 0-360. */
  H: number;
}

export const srgbToOklch = (hex: string): Oklch => {
  const { r, g, b } = hexToRgb(hex);
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bLab = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  const C = Math.sqrt(a * a + bLab * bLab);
  let H = (Math.atan2(bLab, a) * 180) / Math.PI;
  if (H < 0) H += 360;

  return { L, C, H };
};

/** Inverse of srgbToOklch. Out-of-gamut results clamp per-channel in linearToSrgb. */
export const oklchToSrgb = (L: number, C: number, H: number): string => {
  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const bLab = C * Math.sin(hRad);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * bLab;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * bLab;
  const s_ = L - 0.0894841775 * a - 1.291485548 * bLab;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  return rgbToHex(linearToSrgb(lr), linearToSrgb(lg), linearToSrgb(lb));
};

// ---------------------------------------------------------------------------
// Brand derivation (spec §4.1 "Brand accent" rules 1-6)
// ---------------------------------------------------------------------------

/**
 * Step a colour's OKLCH lightness by `direction` (hue and chroma held) until
 * `passes(candidate)` is true or `maxDelta` of lightness is spent. Returns
 * the last candidate tried either way, so a colour that cannot reach the
 * target within the budget still comes back as the closest attempt made.
 */
const stepLightnessUntil = (
  hex: string,
  direction: 1 | -1,
  maxDelta: number,
  passes: (candidate: string) => boolean,
): string => {
  if (passes(hex)) return hex;

  const { L, C, H } = srgbToOklch(hex);
  const STEP = 0.005;
  let best = hex;
  for (let delta = STEP; delta <= maxDelta + 1e-9; delta += STEP) {
    const candidateL = clamp01(L + direction * delta);
    const candidate = oklchToSrgb(candidateL, C, H);
    best = candidate;
    if (passes(candidate)) return candidate;
    if (candidateL <= 0 || candidateL >= 1) break;
  }
  return best;
};

/**
 * Rule 2. Foreground is whichever of white/near-black contrasts more with
 * the raw brand colour. If that best contrast is under 4.5:1, the fill
 * itself moves — OKLCH lightness only, hue and chroma held, capped at
 * ±0.25 L — away from the foreground until it clears 4.5:1.
 */
const deriveFillAndForeground = (
  rawHex: string,
): { fill: string; foreground: "#ffffff" | "#141618" } => {
  const contrastWhite = contrastRatio(rawHex, WHITE);
  const contrastBlack = contrastRatio(rawHex, NEAR_BLACK);
  const foreground: "#ffffff" | "#141618" =
    contrastWhite >= contrastBlack ? WHITE : NEAR_BLACK;

  if (Math.max(contrastWhite, contrastBlack) >= MIN_CONTRAST) {
    return { fill: rawHex, foreground };
  }

  // Move away from the foreground: darker fill if foreground is white,
  // lighter fill if foreground is near-black.
  const direction: 1 | -1 = foreground === WHITE ? -1 : 1;
  const fill = stepLightnessUntil(
    rawHex,
    direction,
    MAX_FILL_DELTA_L,
    (candidate) => contrastRatio(candidate, foreground) >= MIN_CONTRAST,
  );
  return { fill, foreground };
};

/**
 * Rule 3. --brand-ink moves the raw brand colour toward the theme's ink
 * (near-white in Graphite, near-black in Sunlight) until it clears 4.5:1 on
 * that theme's --panel. Unlike the fill, there is no ±0.25 cap here — brand-
 * as-text keeps its hue but goes all the way to legible if it must.
 */
const deriveInk = (rawHex: string, theme: ThemeName): string => {
  const panel = theme === "dark" ? PANEL_DARK : PANEL_LIGHT;
  // Brand ink also sits on brand-tinted fills (selected rows, chips at
  // bg-primary-500/15), which pull the surface toward the brand and eat the
  // margin a plain-panel check leaves. Require the floor on both the panel
  // and the panel under a 15% brand tint, whichever is harder.
  const tinted = mixHex(panel, rawHex, 0.15);
  const legible = (candidate: string): boolean =>
    contrastRatio(candidate, panel) >= MIN_CONTRAST &&
    contrastRatio(candidate, tinted) >= MIN_CONTRAST;
  if (legible(rawHex)) return rawHex;

  const direction: 1 | -1 = theme === "dark" ? 1 : -1; // toward white / toward black
  return stepLightnessUntil(rawHex, direction, 1, legible);
};

/**
 * A 5-step ramp around the fill for hover/active/tint utilities
 * (--brand-{300..700}-rgb and the legacy --brand-primary-{300..700} hex
 * aliases). Magnitude grows from 300 (closest to the fill) to 700 (furthest);
 * direction is lighter in the dark theme and darker in the light theme, so
 * hover/active states pop off a dark surface and recede on a light one.
 */
const RAMP_STEP_MAGNITUDE = {
  300: 0.05,
  400: 0.1,
  500: 0.15,
  600: 0.2,
  700: 0.25,
} as const;

type RampStep = keyof typeof RAMP_STEP_MAGNITUDE;

const deriveRamp = (fillHex: string, theme: ThemeName): Record<RampStep, string> => {
  const { L, C, H } = srgbToOklch(fillHex);
  const direction: 1 | -1 = theme === "dark" ? 1 : -1;
  const ramp = {} as Record<RampStep, string>;
  (Object.keys(RAMP_STEP_MAGNITUDE) as unknown as RampStep[]).forEach((step) => {
    const l = clamp01(L + direction * RAMP_STEP_MAGNITUDE[step]);
    ramp[step] = oklchToSrgb(l, C, H);
  });
  return ramp;
};

/**
 * Derives every --brand-* token from a dealer's raw brand_color hex, for one
 * theme. Call once per theme; the result never depends on the other theme.
 */
export const deriveBrandTokens = (rawHex: string, theme: ThemeName): BrandTokens => {
  if (!isValidHexString(rawHex)) {
    throw new Error(`deriveBrandTokens: "${rawHex}" is not a valid hex colour`);
  }
  const base = normalizeHex(rawHex);

  const { fill, foreground } = deriveFillAndForeground(base);
  const ink = deriveInk(base, theme);
  const ramp = deriveRamp(fill, theme);

  return {
    fill,
    fillRgb: rgbTriplet(fill),
    foreground,
    foregroundRgb: rgbTriplet(foreground),
    ink,
    inkRgb: rgbTriplet(ink),
    ramp300: ramp[300],
    ramp300Rgb: rgbTriplet(ramp[300]),
    ramp400: ramp[400],
    ramp400Rgb: rgbTriplet(ramp[400]),
    ramp500: ramp[500],
    ramp500Rgb: rgbTriplet(ramp[500]),
    ramp600: ramp[600],
    ramp600Rgb: rgbTriplet(ramp[600]),
    ramp700: ramp[700],
    ramp700Rgb: rgbTriplet(ramp[700]),
  };
};
