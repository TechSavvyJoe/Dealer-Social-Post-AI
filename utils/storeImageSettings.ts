import type { Dealer, ImageQualityTier, LogoPlacement } from "../types";

/**
 * The store settings image generation reads from the session dealer
 * (hooks/useGeneration.ts): the image-quality tier (utils/imageQualityTier.ts),
 * the logo corner and size (services/logoPlacement.ts) and the logo itself.
 * A manager can change them in Dealership settings while a teammate's app is
 * open, and that app only learns of it from a fresh session read.
 */
const STORE_IMAGE_SETTINGS = ["image_quality_tier", "logo_placement", "logo"] as const;

const readTier = (value: unknown): ImageQualityTier | "" =>
  value === "standard" || value === "studio" ? value : "";

const readPlacement = (value: unknown): LogoPlacement | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as LogoPlacement)
    : null;

const readLogo = (value: unknown): string => (typeof value === "string" ? value : "");

const samePlacement = (
  a: LogoPlacement | null | undefined,
  b: LogoPlacement | null | undefined,
): boolean =>
  (a?.corner ?? null) === (b?.corner ?? null) &&
  (a?.scale ?? null) === (b?.scale ?? null);

/**
 * `current` with the store image settings from `fresh` (the dealer a session
 * read returned). Returns `current` itself, so nothing re-renders, when
 * `fresh` is another store or nothing changed. A field `fresh` does not carry
 * (an older backend) keeps its current value; every other dealer field is left
 * as it is.
 */
export const adoptStoreImageSettings = (current: Dealer, fresh: unknown): Dealer => {
  if (!fresh || typeof fresh !== "object") return current;
  const record = fresh as Record<string, unknown>;
  if (record.id !== current.id) return current;
  const carries = (field: (typeof STORE_IMAGE_SETTINGS)[number]) =>
    Object.prototype.hasOwnProperty.call(record, field);

  const changes: Partial<Pick<Dealer, (typeof STORE_IMAGE_SETTINGS)[number]>> = {};
  if (carries("image_quality_tier")) {
    const tier = readTier(record.image_quality_tier);
    if (tier !== readTier(current.image_quality_tier))
      changes.image_quality_tier = tier;
  }
  if (carries("logo_placement")) {
    const placement = readPlacement(record.logo_placement);
    if (!samePlacement(placement, current.logo_placement)) {
      changes.logo_placement = placement;
    }
  }
  if (carries("logo")) {
    const logo = readLogo(record.logo);
    if (logo !== (current.logo || "")) changes.logo = logo;
  }
  return Object.keys(changes).length > 0 ? { ...current, ...changes } : current;
};
