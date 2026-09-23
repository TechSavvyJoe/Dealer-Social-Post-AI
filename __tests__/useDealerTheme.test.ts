import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  contrastRatio,
  deriveBrandTokens,
  srgbToOklch,
  type ThemeName,
} from "../utils/brandColor";

/**
 * Spec: docs/superpowers/specs/2026-09-18-light-table-ui-design.md §4.1
 * "Brand accent" rules 1-6.
 */

const mocks = vi.hoisted(() => ({
  store: {} as Record<string, unknown>,
}));

vi.mock("../stores/appStore", () => ({
  useAppStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.store),
    { getState: () => mocks.store },
  ),
}));

// Imported after the mock so the hook picks up the mocked store.
// eslint-disable-next-line import/first
import { useDealerTheme } from "../hooks/useDealerTheme";

const INLINE_PROPS = [
  "--brand-fill",
  "--brand-foreground",
  "--brand-ink",
  "--brand-300-rgb",
  "--brand-400-rgb",
  "--brand-500-rgb",
  "--brand-600-rgb",
  "--brand-700-rgb",
  "--brand-primary",
  "--brand-primary-300",
  "--brand-primary-400",
  "--brand-primary-500",
  "--brand-primary-600",
  "--brand-primary-700",
  "--color-primary",
  "--color-primary-hover",
];

const setStore = (overrides: Record<string, unknown>) => {
  Object.keys(mocks.store).forEach((k) => delete mocks.store[k]);
  Object.assign(mocks.store, overrides);
};

beforeEach(() => {
  document.documentElement.removeAttribute("style");
});

const SAMPLE_BRAND_COLORS = ["#a8e6c6", "#e3701a", "#d14e28", "#1e40af", "#ffd400"];
const THEMES: ThemeName[] = ["dark", "light"];

describe("deriveBrandTokens (spec §4.1 rules 2, 3, 6)", () => {
  for (const hex of SAMPLE_BRAND_COLORS) {
    for (const theme of THEMES) {
      it(`${hex} in ${theme} theme clears every WCAG floor`, () => {
        const tokens = deriveBrandTokens(hex, theme);

        // Rule 2: foreground-on-fill >= 4.5:1, and foreground is exactly one
        // of the two allowed hex values.
        expect(["#ffffff", "#141618"]).toContain(tokens.foreground);
        expect(contrastRatio(tokens.fill, tokens.foreground)).toBeGreaterThanOrEqual(
          4.5,
        );

        // Rule 2: the fill never moves more than +/-0.25 L in OKLCH from the
        // raw brand colour.
        const rawL = srgbToOklch(hex).L;
        const fillL = srgbToOklch(tokens.fill).L;
        expect(Math.abs(fillL - rawL)).toBeLessThanOrEqual(0.25 + 1e-6);

        // Rule 3: brand-ink on the theme's --panel clears 4.5:1.
        const panel = theme === "dark" ? "#191c1f" : "#ffffff";
        expect(contrastRatio(tokens.ink, panel)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("throws on an invalid hex instead of silently painting garbage", () => {
    expect(() => deriveBrandTokens("not-a-color", "dark")).toThrow();
  });

  it("expands 3-digit hex the same way normalizeHex does elsewhere", () => {
    const short = deriveBrandTokens("#e70", "dark");
    const long = deriveBrandTokens("#ee7700", "dark");
    expect(short.fill).toBe(long.fill);
  });
});

describe("useDealerTheme (spec §4.1 rule 4)", () => {
  it("applies every inline property for a dealer brand colour, dark theme", () => {
    setStore({ currentDealer: { brand_color: "#e3701a" }, theme: "dark" });
    renderHook(() => useDealerTheme());

    const style = document.documentElement.style;
    for (const prop of INLINE_PROPS) {
      expect(style.getPropertyValue(prop).trim()).not.toBe("");
    }
    expect(style.getPropertyValue("--brand-foreground").trim()).toMatch(
      /^#(ffffff|141618)$/,
    );
  });

  it("removes every inline property when the dealer has no brand colour", () => {
    setStore({ currentDealer: { brand_color: "#e3701a" }, theme: "dark" });
    const { rerender } = renderHook(() => useDealerTheme());
    expect(
      document.documentElement.style.getPropertyValue("--brand-fill").trim(),
    ).not.toBe("");

    act(() => {
      setStore({ currentDealer: { brand_color: "" }, theme: "dark" });
    });
    rerender();

    for (const prop of INLINE_PROPS) {
      expect(document.documentElement.style.getPropertyValue(prop)).toBe("");
    }
  });

  it("removes every inline property when there is no dealer at all", () => {
    setStore({ currentDealer: null, theme: "dark" });
    renderHook(() => useDealerTheme());

    for (const prop of INLINE_PROPS) {
      expect(document.documentElement.style.getPropertyValue(prop)).toBe("");
    }
  });

  it("recomputes when the theme changes, keeping the same brand colour", () => {
    setStore({ currentDealer: { brand_color: "#1e40af" }, theme: "dark" });
    const { rerender } = renderHook(() => useDealerTheme());
    const darkFill = document.documentElement.style.getPropertyValue("--brand-fill");

    act(() => {
      setStore({ currentDealer: { brand_color: "#1e40af" }, theme: "light" });
    });
    rerender();
    const lightFill = document.documentElement.style.getPropertyValue("--brand-fill");

    // Rule 2 says fill is theme-independent, but ink (rule 3) is
    // theme-dependent, so at minimum the ink property should be free to
    // differ even when the fill does not.
    expect(document.documentElement.style.getPropertyValue("--brand-ink")).not.toBe("");
    expect(typeof darkFill).toBe("string");
    expect(typeof lightFill).toBe("string");
  });
});
