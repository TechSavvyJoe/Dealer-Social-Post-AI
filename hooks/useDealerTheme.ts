import { useEffect, useState } from "react";
import { useAppStore } from "../stores/appStore";
import { deriveBrandTokens, type ThemeName } from "../utils/brandColor";

/**
 * Applies the current dealer's white-label theme to CSS custom properties on
 * <html>. Picks up dealer.brand_color and derives every --brand-* token from
 * it via utils/brandColor.ts (spec §4.1 "Brand accent" rules 1-6). Tailwind
 * utility classes that read these vars tint to match. If no brand color is
 * set, the inline overrides are cleared so the theme-scoped CSS defaults
 * (achromatic) apply. Re-runs whenever the dealer's brand color or the
 * resolved theme changes.
 */

const isValidHex = (s: string | undefined): s is string =>
  !!s && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s.trim());

/** Every inline property this hook ever sets — cleared as a group whenever
 * there is no brand color, so the theme-scoped CSS defaults take over. */
const INLINE_PROPS = [
  "--brand-fill",
  "--brand-foreground",
  "--brand-ink",
  "--brand-300-rgb",
  "--brand-400-rgb",
  "--brand-500-rgb",
  "--brand-600-rgb",
  "--brand-700-rgb",
  // Dark-theme twin consumed inside .publish-studio-theme (always dark).
  "--brand-fill-studio",
  "--brand-foreground-studio",
  "--brand-ink-studio",
  "--brand-300-rgb-studio",
  "--brand-400-rgb-studio",
  "--brand-500-rgb-studio",
  "--brand-600-rgb-studio",
  "--brand-700-rgb-studio",
  // Legacy hex aliases some untouched screens still read directly.
  "--brand-primary",
  "--brand-primary-300",
  "--brand-primary-400",
  "--brand-primary-500",
  "--brand-primary-600",
  "--brand-primary-700",
  "--color-primary",
  "--color-primary-hover",
] as const;

const getSystemTheme = (): ThemeName => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "dark";
  }
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
};

/**
 * Resolves the store's "dark" | "light" | "system" preference to an actual
 * "dark" | "light", tracking the OS setting live while "system" is active
 * (spec §4.1 rule 4).
 */
const useResolvedTheme = (theme: "dark" | "light" | "system"): ThemeName => {
  const [resolved, setResolved] = useState<ThemeName>(() =>
    theme === "system" ? getSystemTheme() : theme,
  );

  useEffect(() => {
    if (theme !== "system") {
      setResolved(theme);
      return;
    }
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      setResolved("dark");
      return;
    }
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const update = () => setResolved(media.matches ? "light" : "dark");
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [theme]);

  return resolved;
};

export const useDealerTheme = (): void => {
  const dealer = useAppStore((s) => s.currentDealer);
  const theme = useAppStore((s) => s.theme);
  const resolvedTheme = useResolvedTheme(theme);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const raw = dealer?.brand_color?.trim();

    if (!isValidHex(raw)) {
      // No dealer brand: clear inline overrides so the theme-scoped CSS
      // defaults (achromatic — see styles/globals.css :root / .theme-light)
      // apply.
      for (const prop of INLINE_PROPS) {
        root.style.removeProperty(prop);
      }
      return;
    }

    const tokens = deriveBrandTokens(raw, resolvedTheme);

    root.style.setProperty("--brand-fill", tokens.fillRgb);
    root.style.setProperty("--brand-foreground", tokens.foreground);
    root.style.setProperty("--brand-ink", tokens.inkRgb);
    root.style.setProperty("--brand-300-rgb", tokens.ramp300Rgb);
    root.style.setProperty("--brand-400-rgb", tokens.ramp400Rgb);
    root.style.setProperty("--brand-500-rgb", tokens.ramp500Rgb);
    root.style.setProperty("--brand-600-rgb", tokens.ramp600Rgb);
    root.style.setProperty("--brand-700-rgb", tokens.ramp700Rgb);

    // The publish studio stays Graphite in both themes, so it reads a
    // dark-derived twin of the accent (globals.css re-points --brand-* to
    // these inside .publish-studio-theme).
    const studio = resolvedTheme === "dark" ? tokens : deriveBrandTokens(raw, "dark");
    root.style.setProperty("--brand-fill-studio", studio.fillRgb);
    root.style.setProperty("--brand-foreground-studio", studio.foreground);
    root.style.setProperty("--brand-ink-studio", studio.inkRgb);
    root.style.setProperty("--brand-300-rgb-studio", studio.ramp300Rgb);
    root.style.setProperty("--brand-400-rgb-studio", studio.ramp400Rgb);
    root.style.setProperty("--brand-500-rgb-studio", studio.ramp500Rgb);
    root.style.setProperty("--brand-600-rgb-studio", studio.ramp600Rgb);
    root.style.setProperty("--brand-700-rgb-studio", studio.ramp700Rgb);

    // Legacy hex aliases some untouched screens still read directly.
    root.style.setProperty("--brand-primary", tokens.fill);
    root.style.setProperty("--brand-primary-300", tokens.ramp300);
    root.style.setProperty("--brand-primary-400", tokens.ramp400);
    root.style.setProperty("--brand-primary-500", tokens.ramp500);
    root.style.setProperty("--brand-primary-600", tokens.ramp600);
    root.style.setProperty("--brand-primary-700", tokens.ramp700);

    root.style.setProperty("--color-primary", tokens.fillRgb);
    root.style.setProperty("--color-primary-hover", tokens.ramp700Rgb);

    return () => {
      // Don't reset to default on unmount — that would flash. Wait for the
      // next dealer/theme change.
    };
  }, [dealer?.brand_color, resolvedTheme]);
};
