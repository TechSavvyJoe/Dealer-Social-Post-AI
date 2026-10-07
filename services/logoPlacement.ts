/**
 * The store's logo corner and size (`dealer.logo_placement`, set in
 * Dealership settings → Creative) as image-prompt wording.
 *
 * A store that never chose a corner keeps exactly the wording each prompt
 * used before placement reached generation: every helper here takes or
 * returns that legacy wording unchanged when no valid placement is set.
 */
import type { LogoCorner, LogoCornerCheck, LogoPlacement } from "../types";

const LOGO_CORNERS: readonly LogoCorner[] = [
  "top_left",
  "top_right",
  "bottom_left",
  "bottom_right",
];

/**
 * Same bounds and default as the settings form and the sample photo
 * (components/dealer-settings/settingsModel.ts and sampleProof.ts) and the
 * server's logo_placement validation (pb_hooks/helpers.js).
 */
const LOGO_SCALE_MIN = 0.04;
const LOGO_SCALE_MAX = 0.5;
const LOGO_SCALE_DEFAULT = 0.18;

const CORNER_WORDS: Readonly<Record<LogoCorner, string>> = {
  top_left: "top-left",
  top_right: "top-right",
  bottom_left: "bottom-left",
  bottom_right: "bottom-right",
};

const isLogoCorner = (value: unknown): value is LogoCorner =>
  typeof value === "string" && LOGO_CORNERS.includes(value as LogoCorner);

/**
 * The placement generation uses, or null when the store has no valid corner.
 * The size is clamped to the settings' bounds (the default when unreadable),
 * exactly as the settings sample draws it.
 */
export const storeLogoPlacement = (
  placement: LogoPlacement | null | undefined,
): LogoPlacement | null => {
  if (!placement || !isLogoCorner(placement.corner)) return null;
  const scale = Number(placement.scale);
  return {
    corner: placement.corner,
    scale: Number.isFinite(scale)
      ? Math.min(LOGO_SCALE_MAX, Math.max(LOGO_SCALE_MIN, scale))
      : LOGO_SCALE_DEFAULT,
  };
};

/**
 * Where an image prompt asks for the supplied logo. With a store placement:
 * "in the bottom-right corner, about 18% of the image width, inside a safe
 * zone away from people". Without one: `legacyWording`, byte for byte, so the
 * prompt is exactly what it was before.
 */
export const logoPlacementWording = (
  placement: LogoPlacement | null | undefined,
  legacyWording: string,
): string => {
  const store = storeLogoPlacement(placement);
  if (!store) return legacyWording;
  return `in the ${CORNER_WORDS[store.corner]} corner, about ${Math.round(
    store.scale * 100,
  )}% of the image width, inside a safe zone away from people`;
};

/**
 * Appended after the placement wording when a store placement is set, so a
 * Look, style recipe or generic "small logo" line elsewhere in a prompt never
 * outranks the store's corner and size. Empty without a placement. Kept
 * short: the 3D Depth Pop retry prompts sit close to the proxy's
 * 20,000-character limit per text part (requestLimits.maxPromptChars).
 */
export const logoPlacementPriority = (
  placement: LogoPlacement | null | undefined,
): string =>
  storeLogoPlacement(placement)
    ? " This corner and size override any other logo position or size."
    : "";

type ObservedLogoCorner = NonNullable<LogoCornerCheck["observed"]>;

/**
 * The image review's `logoCorner` answer as a known corner, "not_in_corner",
 * or undefined (unknown) for anything missing or unreadable. Never throws: a
 * malformed answer must not fail the review.
 */
export const readObservedLogoCorner = (
  value: unknown,
): ObservedLogoCorner | undefined => {
  if (typeof value !== "string") return undefined;
  const key = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/^lower_/, "bottom_")
    .replace(/^upper_/, "top_");
  if (key === "not_in_corner") return key;
  return isLogoCorner(key) ? key : undefined;
};

/**
 * What a shipped image records about the store's corner: the corner asked
 * for, the corner the review saw, and whether they match. Undefined when the
 * store set no corner (nothing was asked for). A mismatch is diagnostic only.
 */
export const logoCornerCheck = (
  placement: LogoPlacement | null | undefined,
  observedValue: unknown,
): LogoCornerCheck | undefined => {
  const store = storeLogoPlacement(placement);
  if (!store) return undefined;
  const observed = readObservedLogoCorner(observedValue);
  return observed
    ? { requested: store.corner, observed, matched: observed === store.corner }
    : { requested: store.corner };
};
