import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlatformGlyph, resolvePlatformGlyphKey } from "../components/PlatformGlyph";

describe("resolvePlatformGlyphKey", () => {
  it.each([
    ["instagram_reel", undefined, "instagram"],
    ["facebook_feed", undefined, "facebook"],
    ["tiktok", undefined, "tiktok"],
    ["gbp", undefined, "google_business"],
    ["linkedin", undefined, "linkedin"],
    ["x_twitter", undefined, "x"],
    ["marketplace", undefined, "marketplace"],
    ["native_share", undefined, "native"],
  ] as const)("maps canonical id %s to %s", (platformId, label, expected) => {
    expect(resolvePlatformGlyphKey(platformId, label)).toBe(expected);
  });

  it.each([
    ["Instagram Feed", "instagram"],
    ["Facebook Feed", "facebook"],
    ["TikTok vertical video", "tiktok"],
    ["Google Business Profile", "google_business"],
    ["LinkedIn", "linkedin"],
    ["X / Twitter", "x"],
    ["Facebook Marketplace Video", "marketplace"],
    ["Device share", "native"],
  ] as const)("recognizes the destination label %s", (label, expected) => {
    expect(resolvePlatformGlyphKey(undefined, label)).toBe(expected);
  });

  it("uses a recognized label for an unknown future id", () => {
    expect(resolvePlatformGlyphKey("future_destination_v2", "Instagram Story")).toBe(
      "instagram",
    );
  });

  it("returns a neutral glyph for an unknown destination", () => {
    expect(resolvePlatformGlyphKey("future_destination_v2", "Future Network")).toBe(
      "generic",
    );
  });
});

describe("PlatformGlyph", () => {
  it("is decorative by default when it sits beside a visible destination name", () => {
    const { container } = render(
      <div>
        <PlatformGlyph platformId="instagram_feed" />
        <span>Instagram Feed</span>
      </div>,
    );

    const glyph = container.querySelector('[data-platform-glyph="instagram"]');
    expect(glyph).toHaveAttribute("aria-hidden", "true");
    expect(glyph).not.toHaveAttribute("role");
  });

  it("can expose an accessible name when used as a standalone control graphic", () => {
    render(
      <PlatformGlyph decorative={false} label="Google Business" platformId="gbp" />,
    );

    expect(screen.getByRole("img", { name: "Google Business" })).toHaveAttribute(
      "data-platform-glyph",
      "google_business",
    );
  });

  it("keeps a caller-provided accessible label on a neutral fallback", () => {
    render(
      <PlatformGlyph
        accessibleLabel="Future Network destination"
        decorative={false}
        platformId="future_network"
      />,
    );

    expect(
      screen.getByRole("img", { name: "Future Network destination" }),
    ).toHaveAttribute("data-platform-glyph", "generic");
  });
});
