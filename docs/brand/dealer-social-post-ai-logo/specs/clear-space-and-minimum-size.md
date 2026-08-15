# Clear space and minimum size — v3

## Construction unit

Let `x` equal the 9-unit stroke of the S in the 120-unit symbol grid.

- Uncontained monochrome symbol: keep at least `2x` clear on every side.
- App/symbol tile: keep at least `1x` outside the tile.
- Horizontal lockup: keep `1x` above and below, `2x` left and right.
- Stacked lockup: keep `1.5x` on every side.
- Do not place a dealer or OEM logo inside this product-mark clear space.

## Minimum digital sizes

| Variant           |     Minimum |        Preferred |
| ----------------- | ----------: | ---------------: |
| Responsive micro  |       16 px |       16 px only |
| Standard symbol   |       24 px |  32 px or larger |
| App icon          |       48 px | 180 px or larger |
| Horizontal lockup | 220 px wide | 280 px or larger |
| Stacked lockup    | 180 px wide | 220 px or larger |

At exactly 16 px, use `master/micro.svg`. It replaces the dimensional overlap
with isolated, flat DSP glyphs so the letter order survives rasterization. At
24 px and above, return to the standard v3 symbol/app geometry. Do not use the
dimensional overlapping launcher at 16 px. Below 16 px, use a one-color glyph
only after validating it in the actual interface.

## Maskable and Home Screen behavior

`master/app-icon.svg` is full bleed and must not receive baked rounded corners.
`master/maskable.svg` scales the essential monogram into the guaranteed central
safe area while keeping the background full bleed. Do not replace the maskable
asset with the standard symbol tile.

For Apple Home Screen use, provide the opaque high-resolution export selected
by the application. For desktop/Finder/Dock use, retain the 1024 px source and
multiple smaller exports so the system does not enlarge a low-resolution icon.
