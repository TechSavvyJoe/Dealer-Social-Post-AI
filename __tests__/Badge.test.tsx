import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "../components/ui/Badge";

type Rgb = readonly [number, number, number];
type Token = { rgb: Rgb; alpha: number };

const css = readFileSync(resolve(process.cwd(), "styles/globals.css"), "utf8");

/** The custom properties declared directly in one theme block of globals.css. */
const themeTokens = (selector: string): Map<string, Token> => {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`${selector} block not found in globals.css`);
  const body = css.slice(start, css.indexOf("\n  }", start));
  const tokens = new Map<string, Token>();
  for (const [, name, value] of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    const triplet = value.match(/^(\d+) (\d+) (\d+)\b/);
    const rgba = value.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
    if (triplet) {
      tokens.set(name, { rgb: [+triplet[1], +triplet[2], +triplet[3]], alpha: 1 });
    } else if (rgba) {
      tokens.set(name, { rgb: [+rgba[1], +rgba[2], +rgba[3]], alpha: +rgba[4] });
    }
  }
  return tokens;
};

const THEMES = {
  Graphite: themeTokens(":root"),
  Sunlight: themeTokens(".theme-light"),
};

/** Tailwind class → the custom property it paints with (tailwind.config.js). */
const CLASS_TOKEN: Record<string, string> = {
  "bg-fill-subtle": "fill-subtle",
  "bg-fill-hover": "fill-hover",
  "bg-panel-raised": "panel-raised",
  "border-strong": "border-strong",
  "border-hairline": "hairline",
  "text-ink-2": "ink-2",
};

const GROUNDS = ["canvas", "panel", "panel-raised"] as const;

const channel = (value: number) => {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgb) =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const composite = ({ rgb, alpha }: Token, ground: Rgb): Rgb =>
  rgb.map((value, i) => value * alpha + ground[i] * (1 - alpha)) as unknown as Rgb;

const tokenFor = (classes: string[], prefix: "bg-" | "border-" | "text-") => {
  const match = classes.find((name) => name.startsWith(prefix) && CLASS_TOKEN[name]);
  if (!match) throw new Error(`no known ${prefix}* token in "${classes.join(" ")}"`);
  return CLASS_TOKEN[match];
};

describe("Badge", () => {
  it("draws the neutral badge with a translucent fill and the control edge", () => {
    render(<Badge variant="neutral">Optional</Badge>);
    const badge = screen.getByText("Optional");
    expect(badge).toHaveClass("bg-fill-subtle", "border-strong", "text-ink-2");
    expect(badge).not.toHaveClass("bg-panel-raised");
    expect(badge).not.toHaveClass("border-hairline");
  });

  it.each(Object.keys(THEMES) as (keyof typeof THEMES)[])(
    "keeps the neutral badge distinct and readable on every ground in %s",
    (theme) => {
      render(<Badge variant="neutral">Optional</Badge>);
      const classes = screen.getByText("Optional").className.split(/\s+/);
      const tokens = THEMES[theme];
      const read = (name: string) => {
        const token = tokens.get(name);
        if (!token) throw new Error(`--${name} not declared for ${theme}`);
        return token;
      };
      const fill = read(tokenFor(classes, "bg-"));
      const edge = read(tokenFor(classes, "border-"));
      const ink = read(tokenFor(classes, "text-"));

      for (const groundName of GROUNDS) {
        const ground = read(groundName).rgb;
        const face = composite(fill, ground);
        const measured = {
          ground: groundName,
          edge: Number(contrast(composite(edge, ground), ground).toFixed(2)),
          text: Number(contrast(ink.rgb, face).toFixed(2)),
        };
        // The pill's edge reads at the 3:1 non-text bar wherever it sits, and
        // 12 px label text keeps 4.5:1 on the badge's own face.
        expect(measured.edge, JSON.stringify(measured)).toBeGreaterThanOrEqual(3);
        expect(measured.text, JSON.stringify(measured)).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  // Every size, because `text-caption` (lg) is a custom font size that a
  // plain tailwind-merge mistakes for a text color and uses to drop the ink.
  it.each(["sm", "md", "lg"] as const)(
    "keeps every variant's colors and the %s type size",
    (size) => {
      const expected = {
        primary: ["bg-brand-fill", "text-brand-foreground", "border-brand-fill"],
        success: ["bg-success-fill", "text-success-ink", "border-success-ink/30"],
        warning: ["bg-warning-fill", "text-warning-ink", "border-warning-ink/30"],
        error: ["bg-error-fill", "text-error-ink", "border-error-ink/30"],
        info: ["bg-info-fill", "text-info-ink", "border-info-ink/30"],
        neutral: ["bg-fill-subtle", "text-ink-2", "border-strong"],
      } as const;
      const typeSize = { sm: "text-2xs", md: "text-2xs", lg: "text-caption" }[size];
      for (const variant of Object.keys(expected) as (keyof typeof expected)[]) {
        const { unmount } = render(
          <Badge variant={variant} size={size}>
            {variant}
          </Badge>,
        );
        expect(screen.getByText(variant)).toHaveClass(...expected[variant], typeSize);
        unmount();
      }
    },
  );
});
