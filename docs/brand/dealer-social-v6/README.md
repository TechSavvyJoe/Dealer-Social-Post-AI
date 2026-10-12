# Dealer Social — identity 06

Dealer Social is premium creative-studio software for dealership social content.
The official product name remains **Dealer Social Post AI** in metadata.

The DS monogram uses one idea: a continuous diagonal shoulder, separated by an
open seam, brings the D and S into a single compact silhouette. Its curves,
counter, lower join, and terminals are fresh vector geometry, informed by the
project's generated concept 02. No stock icon, vehicle outline, photo, gradient,
or generated raster lettering is in a production logo asset.

## Recommended application assets

| Use                         | New immutable public path                                                  |
| --------------------------- | -------------------------------------------------------------------------- |
| Dark login/header wordmark  | `/dealer-social-v6-horizontal-reverse.svg`                                 |
| Light login/header wordmark | `/dealer-social-v6-horizontal.svg`                                         |
| Dark compact brand symbol   | `/dealer-social-v6-symbol-reverse.svg`                                     |
| Light compact brand symbol  | `/dealer-social-v6-symbol.svg`                                             |
| White single-color symbol   | `/dealer-social-v6-symbol-white.svg`                                       |
| Black single-color symbol   | `/dealer-social-v6-symbol-black.svg`                                       |
| Stacked alternate           | `/dealer-social-v6-stacked.svg` or `-stacked-reverse.svg`                  |
| Apple touch                 | `/dealer-social-v6-180.png`                                                |
| Installable app             | `/dealer-social-v6-192.png`, `/dealer-social-v6-512.png`                   |
| Maskable app                | `/dealer-social-v6-maskable-192.png`, `/dealer-social-v6-maskable-512.png` |
| Favicon                     | `/dealer-social-v6-16.png`, `/dealer-social-v6-32.png`                     |
| Social preview              | `/dealer-social-og-v6.png` — opaque 1200 × 630                             |

All production SVGs contain native filled paths. Wordmarks are outlined and have
no network or font-loading dependency. Accessible titles and descriptions are
included; an application image element still needs its own appropriate alt text.
Opaque app exports use full square backgrounds so the operating system supplies
the outer corner treatment. Every maskable foreground corner is inside the
80% diameter safe circle. The largest corner radius from the center is below
346 units on a 1024-unit canvas; the allowed radius is 409.6.

## Color, spacing, and scale

- Graphite: `#111517`
- Warm white: `#F4F5F5`
- Cobalt: `#315CE6`
- Clear space: at least half a D stem width outside the visible mark. The stem
  is 46 units in the 351 × 214 symbol geometry, so clear space is 23 units.
  Transparent canvases contain some padding; add surrounding layout space as needed.
- Symbol minimum: 24 px wide preferred; 16 px allowed for a favicon.
- Horizontal minimum: 180 px wide. Stacked minimum: 160 px wide.
- Preserve aspect ratio; use `object-fit: contain`. Avoid a new enclosing badge,
  shadow, gradient, stroked outline, or squeezed letter spacing.
- On a busy image, use a solid graphite plate and the reversed lockup. The sample
  in `validation/photo-contrast.png` demonstrates this with an existing repository photo.

The 16 px favicon retains the DS silhouette, but its seam and counters soften
under rasterization. The 24 and 32 px checks retain clear letter separation.
The app version has extra safe padding, so it is less readable at tiny sizes than
the standalone symbol. It is intended for recognizable repeated brand exposure.

## Typography and source record

The wordmark is **Inter 700**, created by the Inter Project Authors, led by Rasmus
Andersson. Source: the project's installed `@fontsource/inter` 5.2.8,
`files/inter-latin-700-normal.woff2`. License: SIL Open Font License 1.1; the exact
installed license is preserved in `source/Inter-OFL.txt`.

`source/wordmark-glyphs.json` stores native glyph contours and advance widths from
that font. The export script adjusts overall tracking and the De, ea, al, le, er,
So, oc, ci, and ia pairs. No font binary or third-party CDN is needed at runtime.
Presentation labels use the local Arial/Helvetica sans-serif fallback; this does
not affect the outlined wordmark.

The project-generated concept board reviewed during development is:
`/Users/joegallant/.codex/generated_images/01a116ab-229d-75c0-b5c0-aa4efa0174b1/exec-ba799e65-90f1-4bb4-af68-3707b9b37243.png`.
An unchanged copy and brief provenance are archived in `exploration/`.
The native paths in `scripts/export-dealer-social-v6.mjs` are the editable master.
The social preview source is `master/og.svg`, reproduced by the same exporter.

## Reproduce exports

The script needs Node and `sharp`. It does not change package manifests or old
brand URLs. With the Codex bundled runtime available:

```sh
BRAND_RENDER_NODE_MODULES=/Users/joegallant/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules node scripts/export-dealer-social-v6.mjs
```

On another machine, install `sharp` into a separate tools directory and point
`BRAND_RENDER_NODE_MODULES` at that directory's `node_modules`, or use an existing
project installation. Font outlining is already recorded, so reproduction needs
no font parser. Export output comprises `master/`, transparent `exports/`,
versioned public SVG/PNG files, the one-page presentation, and `validation/`.

## Checked locally

The final native SVGs were rasterized and visually inspected on light and dark
surfaces, in one color, at 16/24/32 px, and on the repository inventory image with
a contrast plate. Transparent export alpha and opaque app output are checked
with Sharp metadata; dimensions and maskable safe bounds are recorded in
`validation/export-checks.json`. This package contains brand assets only; actual
application placement, installed-device rendering, and release verification are
handled by the application integration.
