# Dealer Social Post AI identity package

## v4 — 2026-09-18

The identity was redesigned as original work: a bold `D` whose open counter is
a photo print, set on a graphite (`#191c1f`) tile. It replaces the v3
Campaign Aperture `DSP` monogram below as the active mark.

Five canonical SVG sources live at the public root:

- `public/dsp-brand-mark-v4.svg` — rounded tile, transparent corners, 120x120
- `public/dsp-brand-mark-v4-app.svg` — full-bleed square, opaque `#191c1f`;
  the source for launcher and Apple touch icons
- `public/dsp-brand-mark-v4-maskable.svg` — full-bleed, glyph inside the 80%
  maskable safe zone
- `public/dsp-brand-mark-v4-micro.svg` — `viewBox="0 0 16 16"`, for the 16px
  favicon
- `public/dsp-brand-mark-v4-monochrome.svg` — `currentColor` glyph

`scripts/export-dsp-logo-assets.sh` renders every raster size (app, maskable,
and favicon PNGs, plus the unversioned `favicon-*.png` and
`apple-touch-icon.png`) from those five sources with `sharp-cli`, flattening
to `#191c1f`. `scripts/render-og-image.mjs` renders the separate 1200x630
`public/dealer-social-og-v4.png` link-preview card from the same mark and the
app's own webfont.

## Retired v3 package

Identity version: **v3**
Artwork status: **production-candidate**

The active identity is the **Campaign Aperture DSP** combination-mark system.
Its custom `DSP` monogram is the compact recognition device; the exact
`Dealer Social Post AI` wordmark supplies immediate product identification on
desktop, sign-in, administrative, and formal brand surfaces.

The geometry in `master/symbol.svg`, `master/app-icon.svg`,
`master/maskable.svg`, `master/micro.svg`, and `monochrome/black.svg` is copied
from the current canonical `public/dsp-brand-mark-v3*.svg` sources. The package
does not redefine or reinterpret those paths.

## Active package

- `source/`: editable live-text wordmark source containing the exact canonical
  name.
- `master/`: horizontal, reverse-horizontal, stacked, symbol, app-icon,
  maskable, and micro SVG variants.
- `monochrome/`: one-color black and white symbol variants.
- `exports/`: mechanically rendered PNGs for app, favicon, symbol, and lockup
  use.
- `validation/`: actual rendered light, dark, small-size, and mask-safe proofs
  plus the human visual-review record.
- `specs/`: color, typography, spacing, minimum-size, licensing, and misuse
  guidance.

## Retired v2 archive

`archive/v2/` preserves the superseded people-and-car identity, its concept
studies, exports, proofs, and documentation for provenance only. Nothing under
that directory is approved for new use. The rejected generic arrow direction
is recorded in `rationale.md`; it was not promoted to a production master.

## Approval boundary

This is a **production-candidate**, not a production-ready or legally cleared
identity. Before changing that status:

1. Obtain client approval of the v3 symbol and wordmark relationship.
2. Complete professional trademark and naming clearance, including the common
   advertising meaning of `DSP` as “demand-side platform.”
3. Convert the approved Inter wordmark to outlines in a trustworthy vector
   workflow while retaining the editable source.
4. Render-compare the outlined result against the approved live-text proofs.
5. Confirm print/fabrication conversions if the identity leaves digital use.
