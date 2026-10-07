import { describe, expect, it } from "vitest";
import { resolveImageQualityTier } from "./imageQualityTier";

describe("resolveImageQualityTier", () => {
  it.each([
    { store: "studio", device: "standard", tier: "studio" },
    { store: "standard", device: "studio", tier: "standard" },
    { store: "studio", device: "studio", tier: "studio" },
    { store: "standard", device: "standard", tier: "standard" },
  ] as const)(
    "uses the store's $store over the device's $device",
    ({ store, device, tier }) => {
      expect(resolveImageQualityTier(store, device)).toEqual({
        tier,
        setByStore: true,
      });
    },
  );

  it.each([
    { label: "an empty store choice", store: "" },
    { label: "a missing store choice", store: undefined },
    { label: "a null store choice", store: null },
    { label: "an unknown store value", store: "ultra" },
  ])("falls back to the device preference for $label", ({ store }) => {
    expect(resolveImageQualityTier(store, "studio")).toEqual({
      tier: "studio",
      setByStore: false,
    });
    expect(resolveImageQualityTier(store, "standard")).toEqual({
      tier: "standard",
      setByStore: false,
    });
  });
});
