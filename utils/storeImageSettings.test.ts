import { describe, expect, it } from "vitest";
import type { Dealer } from "../types";
import { adoptStoreImageSettings } from "./storeImageSettings";

const signedIn: Dealer = {
  id: "dealer-1",
  name: "Northside Motors",
  brand_voice: "Warm and direct.",
  logo: "/api/files/dealers/dealer-1/logo_old.png",
  logo_placement: null,
  image_quality_tier: "studio",
};

describe("adoptStoreImageSettings", () => {
  it("takes the store's new image quality, logo corner and size, and logo", () => {
    const next = adoptStoreImageSettings(signedIn, {
      ...signedIn,
      name: "Renamed on the server",
      brand_voice: "Changed on the server.",
      logo: "/api/files/dealers/dealer-1/logo_new.png",
      logo_placement: { corner: "top_left", scale: 0.25 },
      image_quality_tier: "standard",
    });
    expect(next).toEqual({
      ...signedIn,
      logo: "/api/files/dealers/dealer-1/logo_new.png",
      logo_placement: { corner: "top_left", scale: 0.25 },
      image_quality_tier: "standard",
    });
    // Only the image settings move; the rest of the dealer is left alone.
    expect(next.name).toBe("Northside Motors");
    expect(next.brand_voice).toBe("Warm and direct.");
  });

  it("takes a cleared choice as cleared", () => {
    const withChoices: Dealer = {
      ...signedIn,
      logo_placement: { corner: "bottom_right", scale: 0.2 },
    };
    expect(
      adoptStoreImageSettings(withChoices, {
        ...withChoices,
        logo_placement: null,
        image_quality_tier: "",
      }),
    ).toEqual({ ...withChoices, logo_placement: null, image_quality_tier: "" });
  });

  it("returns the same dealer when nothing changed, so nothing re-renders", () => {
    expect(
      adoptStoreImageSettings(signedIn, {
        ...signedIn,
        name: "Renamed on the server",
      }),
    ).toBe(signedIn);
    const placed: Dealer = {
      ...signedIn,
      logo: undefined,
      logo_placement: { corner: "top_right", scale: 0.3 },
    };
    expect(
      adoptStoreImageSettings(placed, {
        id: "dealer-1",
        logo: "",
        logo_placement: { scale: 0.3, corner: "top_right" },
        image_quality_tier: "studio",
      }),
    ).toBe(placed);
  });

  it("ignores another store, an unreadable answer, and fields it does not carry", () => {
    const otherStore = {
      ...signedIn,
      id: "dealer-2",
      image_quality_tier: "standard",
    };
    for (const fresh of [otherStore, null, undefined, "dealer-1", 7]) {
      expect(adoptStoreImageSettings(signedIn, fresh)).toBe(signedIn);
    }
    // An older backend that never sends the fields keeps what this app has.
    expect(adoptStoreImageSettings(signedIn, { id: "dealer-1", name: "x" })).toBe(
      signedIn,
    );
  });
});
