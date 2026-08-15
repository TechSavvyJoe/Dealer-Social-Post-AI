# Visual and production review — v3

Reviewed: 2026-08-15
Reviewer: Codex visual, source-integrity, and production-package pass
Status: **production-candidate**

## Selected identity

Campaign Aperture DSP: the custom ivory D/P and coral S ligature paired with the
exact `Dealer Social Post AI` wordmark.

Primary review board:
`validation/presentation-board-v3.png` (1600×1000, inspected uncropped).

## Exact-name proof

Canonical literal: `Dealer Social Post AI`

Inspected proofs:

- `wordmark-light-100.png` — pass; read literally left to right as
  `Dealer Social Post AI`.
- `wordmark-dark-100.png` — pass; reverse wordmark is complete and readable.
- `wordmark-small-mobile.png` — pass at the documented 220 px lockup width.
- `stacked-light.png` — pass; exact name remains intact and centered.

Character review: D, S, P, A, and I are upright and neither mirrored nor
substituted. All spaces are present. No punctuation or diacritic is required.
The editable source contains one matching live-text node with the declared
Inter family and left-to-right direction.

## Symbol and small-size proof

Inspected files:

- `avatar-192.png` — pass; DSP order is immediate and the coral S remains the
  visual signature.
- `symbol-32.png` — pass; the standard v3 geometry remains distinguishable.
- `symbol-24.png` — pass; standard v3 counters remain open.
- `symbol-16.png` — pass using the canonical responsive micro; isolated flat
  glyphs make DSP readable without the dimensional overlap.
- `maskable-safe-zone.png` — pass; the scaled maskable monogram stays within the
  documented central safe boundaries while the field remains full bleed.

Observed small-size legibility:

|   Size |  Score | Result                                      |
| -----: | -----: | ------------------------------------------- |
| 180 px | 9.5/10 | Home Screen recognition is immediate        |
|  48 px |   9/10 | Clear launcher/desktop use                  |
|  32 px | 8.5/10 | D, S, and P remain separate                 |
|  24 px |   8/10 | Suitable for compact UI use                 |
|  16 px | 8.5/10 | Responsive flat DSP micro; favicon use only |

## One-color and form review

- `monochrome/black.svg` and `monochrome/white.svg` preserve the canonical
  geometry without relying on color.
- D/P counters remain open and the S retains its reading order in one color.
- No arrowhead, car, person, road, shutter, play control, or platform trademark
  appears in the active v3 system.
- The v2 people/car identity is visibly segregated under `archive/v2/` and is
  not presented as an alternate.

## Light, dark, and contrast review

Measured palette pairs:

- Editorial Ivory `#F5F6F0` on Campaign Ink `#07182B`: **16.45:1**.
- Social Coral `#FF6A4D` on Campaign Ink `#07182B`: **6.32:1**.
- Campaign Ink `#07182B` on proof light `#F8FAFC`: **17.09:1**.
- Editorial Ivory `#F5F6F0` on reverse field `#07121F`: **17.32:1**.

These values pass the 3:1 meaningful-icon target. Logo artwork itself does not
replace testing when the mark is used as an interactive control.

## Revision caught during QA

The first reverse-lockup render exposed an SVG resource-ID collision that hid
the symbol artwork. The local gradient/filter IDs were renamed, and both the
dark proof and presentation board were regenerated and reinspected. The current
`wordmark-dark-100.png` is the corrected proof.

Mobile QA also rejected shrinking the overlapping dimensional launcher to
16 px. `master/micro.svg` now matches the canonical flat, isolated-glyph micro
source byte-for-byte; `symbol-16.png` and `favicon-16.png` were regenerated from
that responsive variant. The active `exports/app-icon-16.png` compatibility
alias uses the same micro raster rather than the dimensional launcher. All
three 16 px files share SHA-256
`56607527a8e8f884f1b0a819ce8ec9df82649806a40f10296ab75ddff2672ddf`.
The standard v3 geometry resumes at 24 px.

## Quality checklist result

- Strategy and selected architecture: pass.
- Canonical name and editable source: pass.
- Original symbol geometry and one-color behavior: pass.
- Light/dark, responsive, and maskable proofs: pass.
- Predictable asset roles and archived superseded work: pass.
- Outlined wordmark master: pending.
- Client approval: pending.
- Professional trademark/name clearance: pending.
- Print/fabrication proof: not performed; required only before those uses.

The package therefore remains **production-candidate**, not production-ready.
