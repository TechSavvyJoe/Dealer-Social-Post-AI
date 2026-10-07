import type { ImageQualityTier } from "../types";

export interface ResolvedImageQualityTier {
  tier: ImageQualityTier;
  /** True when the store's choice decided the tier, so this device's choice is not used. */
  setByStore: boolean;
}

/**
 * The image-quality tier every image generation and regeneration uses. A
 * store that chose Standard or Studio in Dealership settings
 * (`dealer.image_quality_tier`) sets it for the whole team; a store that has
 * not chosen ("" or missing) leaves it to this device's own setting.
 */
export const resolveImageQualityTier = (
  storeTier: unknown,
  devicePreference: ImageQualityTier,
): ResolvedImageQualityTier =>
  storeTier === "standard" || storeTier === "studio"
    ? { tier: storeTier, setByStore: true }
    : { tier: devicePreference, setByStore: false };
