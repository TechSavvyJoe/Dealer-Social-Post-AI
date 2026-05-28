import { useEffect } from "react";
import { useAppStore } from "../stores/appStore";

/**
 * Applies the current dealer's white-label theme to CSS custom properties on
 * <html>. Picks up:
 *   - dealer.brand_color  → --brand-primary  (and a few derived shades)
 *
 * Tailwind utility classes that read these vars will tint to match. If no
 * brand color is set, defaults pass through. Re-runs whenever the dealer or
 * their brand color changes.
 */

const DEFAULT_BRAND = "#1d4ed8"; // Tailwind primary-700 — current chrome

/**
 * Lighten a hex color toward white by `pct` (0..1). Used to generate
 * the 600/500/400 shades from a single brand hex.
 */
const lighten = (hex: string, pct: number): string => {
  const m = hex.replace("#", "");
  if (m.length !== 6) return hex;
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  const lr = Math.round(r + (255 - r) * pct);
  const lg = Math.round(g + (255 - g) * pct);
  const lb = Math.round(b + (255 - b) * pct);
  return `#${lr.toString(16).padStart(2, "0")}${lg
    .toString(16)
    .padStart(2, "0")}${lb.toString(16).padStart(2, "0")}`;
};

const isValidHex = (s: string | undefined): s is string =>
  !!s && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s.trim());

const expandShortHex = (hex: string): string => {
  const m = hex.replace("#", "");
  if (m.length !== 3) return hex;
  return `#${m[0]}${m[0]}${m[1]}${m[1]}${m[2]}${m[2]}`;
};

export const useDealerTheme = (): void => {
  const dealer = useAppStore((s) => s.currentDealer);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const raw = dealer?.brand_color?.trim();
    const base = isValidHex(raw) ? expandShortHex(raw) : DEFAULT_BRAND;

    root.style.setProperty("--brand-primary", base);
    root.style.setProperty("--brand-primary-600", lighten(base, 0.08));
    root.style.setProperty("--brand-primary-500", lighten(base, 0.2));
    root.style.setProperty("--brand-primary-400", lighten(base, 0.36));
    root.style.setProperty("--brand-primary-300", lighten(base, 0.55));

    return () => {
      // Don't reset to default on unmount — that would flash. Wait for the
      // next dealer change.
    };
  }, [dealer?.brand_color]);
};
