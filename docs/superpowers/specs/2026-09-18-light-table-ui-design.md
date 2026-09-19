# Light Table — UI system, screens, and copy

Status: approved direction, spec v2 after adversarial review · Date: 2026-09-18 · Owner: Joe Gallant

## 1. Problem

The product works but does not look or read like a finished product. Every
screen is chopped into identical hairline cards, so nothing has hierarchy. The
chrome is template chrome: tracked ALL-CAPS eyebrows ("PHOTO SOURCE", "MEDIA
BAY 01", "SHOWROOM STUDIO", "PHOTO STAGE"), "02 DETAILS" step markers,
middle-dot spec strings, one orange word in the wordmark, a sparkles icon used
twice in one dialog. Motion is scattered: spring pops on every badge,
hover-scale on the dealer logo in the header, staggered entrances on empty
states, an infinite shimmer sweep across the Create button. Copy is theatrical
("Capture the handoff.", "Ready for the delivery moment", "Create photo
outputs ⌘↵"). The stepper counts "Sign in" as step 1 of 5. On a phone the
result screen truncates platform chips ("Facebo…") and a red approval banner
pushes the photo below the fold. The manager dashboard stacks a 9-step wizard,
tabs and panels on one page. Sunlight Mode is a mathematical inversion of the
dark palette, not a light design.

The user's brief: "full UI and UX and workflow and all the visual things and
animations and text font button logo icons and everything need to be more
production ready … coloring, everything has to be better."

## 2. Direction (approved 2026-09-18)

**Light table.** A photographer's light table: a matte graphite surface, lit
from beneath, whose only job is to make the print lying on it look right. The
photograph is the only thing on screen with colour and depth; every control is
quiet, flat and the same neutral grey. The dealership's brand colour is the
single accent — primary buttons, selected states, focus — and the product
itself is achromatic, so a Ford store looks like Ford and a Subaru store looks
like Subaru without the app fighting either.

Approved decisions:

1. Direction: Light table (graphite, photo-first, dealer colour is the only
   accent, a real Sunlight light theme rather than an inversion).
2. Logo: redesign the mark and wordmark; regenerate app icons, favicons and
   the link-preview image.
3. Phasing: three PRs, in order, each merged and deployed before the next.

## 3. Goals and non-goals

Goals

1. A salesperson gets from photo to shareable post with the fewest, clearest
   decisions, on a phone, in sunlight, one-handed.
2. One coherent system: tokens, type, primitives, motion and copy that every
   screen uses, so the next feature is built from parts instead of styled
   from scratch.
3. Production polish: WCAG 2.2 AA including 1.4.11 non-text contrast, 44 px
   targets, reduced motion, no layout shift, no horizontal overflow, a logo
   that survives at 16 px.
4. Nothing behind the UI changes: compliance guards, approval flow, model
   policy, session/store contracts and the PocketBase backend are untouched.

Non-goals

- No backend or infrastructure changes.
- No new features. Layout and copy can move; behaviour stays.
- Walkaround Studio stays dark behind its flags and gets tokens only.

## 4. Design system

### 4.1 Colour

All colours are CSS custom properties on `:root` (Graphite, default) and
`.theme-light` (Sunlight), in `styles/globals.css`. Tailwind utilities read
them as `rgb(var(--x) / <alpha-value>)`, so untouched screens keep compiling
and simply re-colour. R G B triplets unless noted. The token file is the
source of truth; this table documents it.

Graphite (dark, default)

| Token                            | Value                                         | Use                                             |
| -------------------------------- | --------------------------------------------- | ----------------------------------------------- |
| `--canvas`                       | 18 20 22 `#121416`                            | page background                                 |
| `--panel`                        | 25 28 31 `#191c1f`                            | sections, header, sheets, the photo well        |
| `--panel-raised`                 | 33 37 41 `#212529`                            | inputs, chips, list rows                        |
| `--overlay`                      | 42 47 52 `#2a2f34`                            | dialogs, popovers, toasts                       |
| `--hairline`                     | 47 52 57 `#2f3439`                            | 1 px dividers (decorative)                      |
| `--border-strong`                | 106 115 124 `#6a737c`                         | control edges — 3.2:1 on raised, 3.6:1 on panel |
| `--ink`                          | 240 242 244 `#f0f2f4`                         | primary text                                    |
| `--ink-2`                        | 178 186 194 `#b2bac2`                         | labels, secondary text                          |
| `--ink-3`                        | 136 145 154 `#88919a`                         | hints on canvas/panel/raised only               |
| `--ink-hint`                     | = `--ink-3`; = `--ink-2` inside `.on-overlay` | helper text anywhere                            |
| `--fill-subtle` / `--fill-hover` | rgba(255,255,255,.05) / .09                   | ghost hover / row hover                         |

Sunlight (`.theme-light`) — designed for a phone held outdoors, not an
inversion: warm off-white canvas, white panels separated by borders instead
of tone, near-black ink, borders strong enough to survive glare, and a raised
surface that is a real tone so an input still reads as a well.

| Token                            | Value                                                   |
| -------------------------------- | ------------------------------------------------------- |
| `--canvas`                       | 244 244 242 `#f4f4f2`                                   |
| `--panel`                        | 255 255 255                                             |
| `--panel-raised`                 | 248 248 246 `#f8f8f6`                                   |
| `--overlay`                      | 255 255 255                                             |
| `--hairline`                     | 217 219 221 `#d9dbdd`                                   |
| `--border-strong`                | 118 124 130 `#767c82` — 4.2:1 on white, 3.8:1 on canvas |
| `--ink`                          | 20 22 24 `#141618`                                      |
| `--ink-2`                        | 72 78 84 `#484e54`                                      |
| `--ink-3`                        | 104 111 118 `#686f76`                                   |
| `--fill-subtle` / `--fill-hover` | rgba(20,22,24,.05) / .09                                |

Contrast, computed from the tokens (WCAG relative luminance):

- Graphite `--ink-3`: 5.77 canvas, 5.35 panel, 4.82 raised, 4.22 overlay. So
  tertiary ink is never used on `--overlay`; helper text uses `--ink-hint`,
  which Modal re-points to `--ink-2` (6.88 on overlay) via `.on-overlay`.
- Sunlight `--ink-3`: 4.62 canvas, 5.09 panel/overlay, 4.79 raised.
- Both `--border-strong` values clear 3:1 on every surface they edge
  (Graphite 3.83/3.55/3.20; Sunlight 3.83/4.22/3.97).
- Every `--ink` / `--ink-2` pairing is ≥ 6.8:1 (≥ 7.6:1 outside dialogs).
- Under 10 % headroom, so treat as contrast-bearing if a surface is retuned:
  Graphite ink-3 on raised (4.82), Sunlight ink-3 on canvas (4.62).
- Text on translucent fills: `--ink` and `--ink-2` stay ≥ 6.7:1 on
  `--fill-hover` over any surface; `--ink-3` is 4.69 on `--fill-subtle` over
  panel and falls under 4.5 on `--fill-hover`, so tertiary ink is never set on
  a hover fill, a chip, a tag or a toggle — those use `--ink` or `--ink-2` at
  ≥ 12 px / 500.

Legacy aliases (kept, remapped, so PR2/PR3 screens keep compiling until they
are rewritten): `--color-surface-base → --canvas`, `--color-surface-elevated →
--panel`, `--color-surface-overlay → --panel-raised`, `--color-surface-raised →
--overlay`, `--color-text-{primary,secondary,tertiary} → --ink{,-2,-3}`,
`--color-border → --hairline`, `--color-border-strong → --border-strong`, and
`--surface-50…950` re-pointed onto the neutral graphite ramp (950 canvas, 900
panel, 800 raised, 700 overlay, 600 border-strong, 500/400 ink-3, 300 ink-2,
200–50 ink). `.theme-light` inverts the alias ramp as today.

`.publish-studio-theme` (the result screen, dark in both themes) keeps its
override block with the Graphite values, so PR2 inherits the neutrals. Its
blue top wash is gone.

Semantic colour. Photos are the only chroma, so status is carried by form
first and hue second. Success and info are achromatic — a filled tag with a
check icon versus a hollow tag — and only the two states that must stop
someone keep a hue, both desaturated so they read as printed ink on the
table rather than UI chrome:

| Token                              | Graphite                               | Sunlight                |
| ---------------------------------- | -------------------------------------- | ----------------------- |
| `--success-ink` / `--success-fill` | `--ink` / `--fill-hover`               | same                    |
| `--info-ink` / `--info-fill`       | `--ink-2` / `--fill-subtle`            | same                    |
| `--warning-ink` / `--warning-fill` | 224 170 96 (amber-brown) / rgba(…,.14) | 128 78 0 / rgba(…,.12)  |
| `--error-ink` / `--error-fill`     | 236 132 118 (oxide) / rgba(…,.10)      | 150 46 38 / rgba(…,.10) |

Computed: Graphite error ink 7.2 canvas, 5.2 overlay, 4.5 inside its own fill
on overlay; warning 8.9 / 6.5 / 5.0. Sunlight error 7.0–7.7 (6.0–6.6 in
fill); warning 6.3–7.0 (5.3–5.8 in fill). Tailwind exposes them as
`text-success-ink`, `bg-success-fill`, etc. The legacy hex ramps stay in the
config for untouched screens; PR1 removes them from every file it touches.

Brand accent. `useDealerTheme` derives the whole accent from
`dealer.brand_color` with these rules:

1. Achromatic default. With no dealer or no `brand_color`, the ramp is
   `--ink`: white buttons with graphite text in Graphite (16.2:1), graphite
   buttons with white text in Sunlight (18.1:1). Login, system admin and a
   store with no colour look like a pro tool, not a demo. The CSS defaults are
   theme-scoped; the hook clears its inline overrides when there is no brand.
2. `--brand-fill` and `--brand-foreground` are chosen per brand colour,
   independent of theme. Foreground is whichever of `#ffffff` and
   `rgb(20 22 24)` contrasts more with the fill (the crossover is at relative
   luminance 0.196; the best either can reach there is 4.26:1). If the winner
   is under 4.5:1 the fill itself moves: step its OKLCH lightness away from
   the foreground, hue and chroma held, until it clears 4.5:1, by at most
   ±0.25 L. The raw `dealer.brand_color` is never painted directly; the
   adjusted fill is what the ramp and buttons use.
3. `--brand-ink` (brand as text/icon on `--panel`) moves the brand colour
   toward the theme's ink until ≥ 4.5:1 on `--panel`, recomputed per theme.
4. The hook reads the app store's `theme` field ("dark" | "light" |
   "system"), resolves "system" through a `matchMedia("(prefers-color-scheme:
light)")` listener, and its effect depends on `[brand_color,
resolvedTheme]`.
5. Invariant: a selected state must remain identifiable when `--brand-ink`
   equals `--ink` (the achromatic default). Selection is therefore always a
   filled-versus-hollow swap (brand fill + brand foreground text, versus
   hairline + ink), never a colour change of the label alone. The focus ring
   is a 2 px outline with a 2 px offset, so it reads as a ring on any colour.
6. Unit test (`hooks/useDealerTheme.test.ts`): a pastel (#a8e6c6), a
   mid-orange (#e3701a), a brick (#d14e28) and a navy, in both themes: every
   `--brand-foreground` on `--brand-fill` ≥ 4.5:1, every `--brand-ink` on
   `--panel` ≥ 4.5:1, and the fill's lightness delta ≤ 0.25.

Photos are the only chroma. No gradients in the chrome: the body radial
gradient, the `body::before` hairline, the studio's blue wash and the desktop
bezel/glow are removed.

### 4.2 Typography

Two families, self-hosted from `@fontsource` 5.3.0, latin subset,
`font-display: swap`:

- **Barlow** 400 / 500 / 600 — every UI string. A slightly squared grotesque
  with a road-sign and race-livery lineage; it belongs on a lot in a way Inter
  does not, and sets wider at small sizes, which helps in sunlight.
- **Barlow Semi Condensed** 500 / 600 — screen titles, dialog titles, the
  keypad digits and large numbers.

Scale (px / line-height; mobile → desktop where they differ):

| Role                         | Face                        | Size                          |
| ---------------------------- | --------------------------- | ----------------------------- |
| display (h1)                 | Semi Condensed 600, −0.01em | 28/32 → 36/40                 |
| title-1 (h2)                 | Semi Condensed 600, −0.01em | 24/28                         |
| title-2 (h3, section titles) | Barlow 600                  | 18/24                         |
| body                         | Barlow 400                  | 16/24                         |
| body-strong                  | Barlow 600                  | 16/24                         |
| label                        | Barlow 500                  | 14/20                         |
| caption                      | Barlow 400                  | 13/18                         |
| micro                        | Barlow 500                  | 12/16                         |
| numeral                      | Semi Condensed 500, `tnum`  | 28/32 (keypad), 20/24 (stats) |

Rules: sentence case everywhere; no tracked uppercase labels (Badge's
`uppercase` default flips to false and the eyebrow pattern is deleted); no
single-word colour or italic accents in headings; paragraphs ≤ 64ch; numbers
that update use tabular figures; headings `text-wrap: balance`; no letter
spacing below display size (the Tailwind scale and the h1–h6 rules are reset
accordingly). Inputs stay ≥ 16 px on phones.

### 4.3 Space, radius, light

- 4 px base. Gutters 16 / 24 / 32 (phone / tablet / desktop). Section gap 24 / 32. Control gap 12. Panel padding 20 / 24. Content column max 1120 px (the
  result screen may use 1280).
- Radii: `--radius-sm` 8 (buttons, inputs, chips, prints), `--radius-md` 12
  (panels, rows), `--radius-lg` 16 (photo well, dialogs), `--radius-xl` 20
  (phone sheets), pill 999.
- Light, not elevation. Panels cast nothing; a hairline is the edge. A light
  table is lit from beneath, so the photo well is a panel with `--table-lift`
  — a soft radial lightening centred under the print (`.table-lit`) — and a
  print gets no shadow at all: a 1 px `--border-strong` edge at 60 %
  (`.print`) is how its edge catches the table's glow. This makes the photo
  the brightest object on screen, which is the whole point. Only dialogs
  float: `--shadow-md` `0 24px 48px rgba(0,0,0,.45)` (Sunlight
  `0 16px 40px rgba(20,22,24,.18)`).
- The desktop bezel is removed: the canvas is the page. The mobile viewport
  pin in `index.html` is kept byte-for-byte except for colours.

### 4.4 Motion

A budget, not a count: at most one 320 ms moment per screen, and a screen may
have none. Everything else answers a user action.

- Durations: 120 ms (state), 180 ms (open/close, content swaps), 320 ms (the
  one moment). Easing `cubic-bezier(0.2, 0.8, 0.2, 1)`. No springs, no
  bounce, no hover-scale, no hover-lift, no per-card entrance, no shimmer on
  fills or buttons, no glow. The only sequencing allowed is the single reveal,
  and it is one group, not a stagger.
- Screen change: opacity only, 180 ms (`PageTransition`, both layouts). A
  route that owns a reveal mounts with `initial={false}` so the two never
  overlap.
- Dialog/sheet: backdrop fade 180 ms; panel opacity + 2 % scale, 180 ms.
- Moments: login — the mark and the access panel fade up 8 px together as one
  group over 320 ms, once per mount. Capture — none (the chosen photo appears
  on the well with a 180 ms opacity swap, an action response). Post details —
  none. Result (PR2) — the prints fade in once.
- Button press: CSS `transform: scale(.98)` 120 ms.
- `prefers-reduced-motion`: the global rule stays; framer variants also pass
  `initial={false}` when `useReducedMotion()` is true.
- Removal criterion (PR1 files, then PR2/PR3): no `type: "spring"`, no
  `whileHover`, no `whileTap` with a scale, no `repeat: Infinity` in any
  touched component — not only the three `utils/animations.ts` exports
  (`SPRING_CONFIGS`, `hoverScale`, `hoverLift`). Named sites: the dealer-logo
  wrapper in `Header.tsx`, the Badge mount pop, EmptyState's stagger,
  ProgressSteps' springs, the Create-button shimmer in `PostCustomizer.tsx`.

### 4.5 Iconography

Lucide, 20 px in controls, 16 px inline, stroke 1.75. An icon appears only
when it carries meaning a word does not (camera, upload, share, copy, check,
warning). No decorative icon beside a heading, no icon repeated for two
different settings, no sparkles.

### 4.6 Primitives (components/ui)

Plain elements with Tailwind classes on tokens; framer only where a
mount/unmount animation exists (Modal, Toast, PageTransition). Existing prop
names stay; new variants are added and old ones alias onto them.

- **Button** — `variant`: `primary` (brand fill, brand foreground),
  `secondary` (raised fill, `--border-strong` edge, ink), `ghost` (no fill,
  ink-2, fill-subtle on hover), `danger` (error fill + error ink). Aliases:
  `filled→primary`, `tinted→secondary`, `outline→secondary`, `plain→ghost`,
  `gradient-sky/teal→primary`. Sizes: `sm` 36 px (label 14/20, 600), `md`
  44 px and `lg` 52 px (body-strong 16/24, 600), `icon` 44 × 44, `xl` 64 px
  (numeral 28/32 Semi Condensed 500, `tnum` — the keypad). Loading: spinner
  replaces the left icon, label stays visible so the width never jumps.
  `haptics` kept.
- **Card** — becomes a panel: `--panel` fill, 1 px hairline, `--radius-md`,
  no shadow; `interactive` swaps the hairline for `--border-strong` on hover.
  `elevation` accepted and ignored. No motion.
- **Input / Textarea / Select** — label above the control (label 14/20,
  `--ink-2`), never floating. Control 44 px, `--panel-raised` fill, 1 px
  `--border-strong`, `--radius-sm`; focus: `--brand-ink` border plus the
  outline. Error: `--error-ink` border and an inline message with the alert
  icon (`role="alert"` retained). Helper text caption 13/18 `--ink-hint`.
- **Badge** — a tag: micro 12/16 500 sentence case, pill, `*-fill` + `*-ink`;
  `uppercase` defaults to false; success tags render the check icon; no mount
  animation.
- **Modal** — behaviour and a11y unchanged; `--overlay` fill, hairline, sheet
  on phones (`--radius-xl` top corners) and centred on desktop; backdrop
  rgba(0,0,0,.6) with no blur; title 24/28 Semi Condensed; applies
  `.on-overlay` to its content so helper text inside dialogs uses `--ink-2`.
- **Toast** — `--overlay`, hairline, 180 ms; icon only for success/error.
- **EmptyState** — 48 px icon tile on `--panel-raised`, title-2, one line of
  body, one primary button; no glow, no stagger.
- **ProgressBar** — 4 px track (`--panel-raised`), brand fill, no shimmer, no
  gradient; percent in tabular numerals.
- **Tooltip / Skeleton / ErrorBanner** — tokens only.
- **PageTransition** — opacity only.

### 4.7 Logo

Achromatic like the product. The mark is a bold **D** whose counter is a
4:5 print — the app's primary output — cut cleanly out of the letter.

- Geometry (120 × 120): the D is a rounded rect x=31 y=25 w=63 h=70 with left
  radii 6 and right radii 35 (a full bowl), minus a counter rect x=47 y=40
  w=32 h=40 (exactly 4:5) with 4 px corners; stems are 16 / 15 / 15 / 15. The
  counter shows a subtle diagonal lightening (`#242930 → #363c44`) so it reads
  as a print lying on the table. On the tile version the tile is
  `#191c1f` with r=26 and a 1 px inner hairline; full-bleed launcher/apple
  variants have no tile (the OS masks them). Verified by render at 512, 180,
  64 and 16 px: the D and the print read at every size; the vector at 16 px
  beats a hand-pixelled micro, so the favicon is the vector too.
- Sources (`public/`, v4 naming because icon URLs are cached immutable and
  versioned by name): `dsp-brand-mark-v4.svg` (tile), `-app.svg`
  (full-bleed, opaque), `-maskable.svg` (full-bleed, glyph at 0.78 inside the
  safe zone), `-micro.svg` (16 × 16 viewBox), `-monochrome.svg`
  (`currentColor`). Exports via `scripts/export-dsp-logo-assets.sh`:
  `dealer-social-dsp-v4-{180,192,512,1024}.png`,
  `dealer-social-dsp-v4-maskable-{192,512,1024}.png`,
  `dealer-social-favicon-v4-{16,32,48}.png`, unversioned
  `favicon-{16,32,48}.png` and `apple-touch-icon.png`. Link preview:
  `scripts/render-og-image.mjs` screenshots an HTML card with the real webfont
  (sharp cannot load Barlow) to `dealer-social-og-v4.png` (1200 × 630).
- Wordmark: "Dealer Social Post AI" as live text, Barlow Semi Condensed 600,
  20 px beside a 40 px mark, single colour (`--ink`), tracking −0.01em; the
  two-line lockup ("Dealer Social" / "Post AI", equal weight) only under
  200 px. `components/Logo.tsx` renders the mark inline (tile `--panel`, D
  `--ink`, counter on `--panel-raised`) so it follows the theme, plus a
  `<span>` wordmark, under one `aria-label`. The header shows the mark alone
  on phones; `Header.tsx`'s mobile studio `<img>` uses the same inline mark.
- Reference surface (all migrated to v4, all pinned): `index.html`,
  `manifest.webmanifest`, `vercel.ts` immutable route regex,
  `scripts/check-vercel-config.mjs`, `scripts/vercel-live-bundle-assert.mjs`,
  `scripts/vercel-staged-release.sh`, `__tests__/PwaIdentity.test.ts`,
  `__tests__/vercelLiveBundleAssert.test.ts`, `e2e/pwa-install.spec.ts`,
  `e2e/staged-release.spec.ts`, `docs/brand/…/README.md`. `public/sw.js`
  is stamped at release and precaches nothing by name. `public/icon-192.png`
  and `icon-512.png` are synthetic canary assets and stay.
- `public/screenshots/login-{mobile,desktop}.webp` (manifest install
  screenshots, 390 × 844 / 1440 × 900) are regenerated at the end of PR1.

### 4.8 Copy

Words are design content. Rules for every string in the app:

- Say what happens, in the user's words: "Take photo", "Use photo", "Create
  post", "Copy caption", "Share". A button and its result use the same verb.
- Sentence case. No exclamation marks in chrome. No "AI" in a button.
- Headings name the step, not the mood: "Sign in", "Start with a photo",
  "Post details", "Review and share".
- Empty and error states say what to do next.
- Compliance language stays exact where the legal skill wrote it (release,
  disclosure, approval); only surrounding chrome copy changes.

Inventory — PR1 strings that change (old → new). ⚑ = pinned by a test or spec
named in the row; the implementer updates it in the same commit.

| Where                                                                   | Old                                                                                                                                                                                       | New                                                                                                                                                    |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stepper                                                                 | Sign in · Capture · Customize · Generating · Results                                                                                                                                      | Photo · Details · Post                                                                                                                                 |
| Header                                                                  | "Social post studio"                                                                                                                                                                      | removed; ≥ md shows "Posting as {name}" under the store name                                                                                           |
| Header dealer tile                                                      | hover-scale spring                                                                                                                                                                        | none                                                                                                                                                   |
| Capture eyebrows                                                        | "SHOWROOM STUDIO", "PHOTO SOURCE"                                                                                                                                                         | removed                                                                                                                                                |
| Capture h1 ⚑ `e2e/pwa-install.spec.ts`, `e2e/flow.spec.ts`, `shots.mjs` | "Capture the handoff."                                                                                                                                                                    | "Start with a photo"                                                                                                                                   |
| Capture intro                                                           | current paragraph                                                                                                                                                                         | "Take a new photo or choose one from your device. You'll review it before anything is created."                                                        |
| Capture well ⚑ `__tests__/DragDropReproduction.test.tsx`                | "MEDIA BAY 01", "JPG · PNG · WEBP · HEIC*", "Ready for the delivery moment", "Drop image here"                                                                                            | label and format string removed; "Add a photo to start"; "Drop a photo here"                                                                           |
| Capture tips                                                            | three lines                                                                                                                                                                               | "Keep the customer and the vehicle fully in frame." / "Avoid backlight and visible paperwork." / "You'll review the photo before anything is created." |
| Crop dialog ⚑ (title and "Use photo" in `e2e/flow.spec.ts`)             | "Review photo" / "Check the framing before creating the post. The original aspect ratio is preserved." / "Choose another" / "Save original to Photos" · "Download original" / "Use photo" | title, the three button labels and both save-label modes kept; description "Check the framing. The photo is kept at its original size."                |
| Customizer title                                                        | "Create your post" / "Pick a style — AI handles the rest"                                                                                                                                 | "Post details" / subtitle removed                                                                                                                      |
| Customizer photo strip                                                  | "PHOTO STAGE", "02 DETAILS", "Review the full frame before generating."                                                                                                                   | all removed; "Change photo"                                                                                                                            |
| Customizer sections                                                     | "POST TYPE", "POSTING AS", "VEHICLE", "PHOTO RELEASE · REQUIRED", "DESIGN STYLE", …                                                                                                       | "What kind of post", "Who and what", "Look", "Where it goes", "Caption" (title-2, sentence case)                                                       |
| Customizer name field                                                   | "Customer's name (required)" placeholder                                                                                                                                                  | label "Customer first name", no placeholder                                                                                                            |
| Customizer VIN                                                          | "Scan VIN (optional — boosts accuracy)"                                                                                                                                                   | "Scan VIN" with helper "Optional. Adds the exact model to the caption."                                                                                |
| Create button (all three media modes)                                   | "Create photo outputs" / "Create video plan" / "Create photo + video set" (+ ⌘↵); busy "Creating platform outputs..."; infinite shimmer                                                   | "Create post"; busy "Creating your post…"; shimmer removed; the existing `aria-label` pattern kept                                                     |
| Toggles                                                                 | "Add video", "Make it playful"                                                                                                                                                            | unchanged; they remain `aria-pressed` toggle buttons (no role change)                                                                                  |
| Settings                                                                | "Tune the workspace for your sales floor." / "Theme (Sunlight Mode)"                                                                                                                      | "Appearance and image quality on this device." / "Appearance" — Dark · Sunlight · Match device; "Image quality" kept                                   |
| My work dialog                                                          | "Reopen prior creatives, captions, and customer posts without regenerating."                                                                                                              | "Reopen a post to share it again or copy its caption."                                                                                                 |
| Log out dialog — in BOTH `Header.tsx` and `App.tsx`                     | "This generated result is not fully preserved yet." + body                                                                                                                                | "This post hasn't been saved yet." / "Save the image and copy the caption first if you want to keep them."                                             |
| Login ⚑                                                                 | keep "Sign in", "My code", "Manager username and password", "System admin", "Security check", keypad group/status/digit names, the error string                                           | helper under the keypad: "Enter your 4-digit code."                                                                                                    |

Everything not listed keeps its current words. `__tests__/__scratch__/shots.mjs`
waits on "Capture the handoff." and "Create your post"; update its selectors
with the strings (it is not in CI, so nothing else will).

## 5. Screens (PR1)

### 5.1 Login

Phone: single column. Mark (40 px) top-left, "Sign in" display heading, a
segmented control (My code · Manager · System) 44 px, then the mode's form.
The keypad is a 3 × 4 grid of `xl` (64 px) `secondary` buttons with Semi
Condensed digits; four 12 px dots above it show progress; the Turnstile
"Security check" slot sits under the keypad. No brand panel on phones.
Short-landscape phones keep the two-column arrangement in `globals.css`.

Desktop (≥ 1024):

```
┌──────────────────────────────┬───────────────────────────────────┐
│  [D] Dealer Social Post AI   │                                   │
│                              │   Sign in                         │
│  Dealership photos,          │   [ My code | Manager | System ]  │
│  ready to post.              │                                   │
│                              │   ● ● ○ ○                         │
│                              │   [1] [2] [3]                     │
│                              │   [4] [5] [6]                     │
│                              │   [7] [8] [9]                     │
│                              │       [0] [⌫]                     │
│  graphite, no image          │   Enter your 4-digit code.        │
└──────────────────────────────┴───────────────────────────────────┘
        5/12                                7/12
```

Left-aligned throughout. The only moment is the 320 ms group fade-up.

### 5.2 Capture

```
Start with a photo                                  (display)
Take a new photo or choose one from your device…    (body, ink-2, ≤64ch)

┌───────────────────────────────────────┐ ┌──────────────────────┐
│                                       │ │ [📷 Take photo]      │  primary
│           (photo well)                │ │ [⇧ Choose from device]  secondary
│      .table-lit, camera glyph,        │ │                      │
│      4:5 on phone, 3:2 on desktop,    │ │ Keep the customer…   │  tips,
│      --radius-lg, hairline            │ │ Avoid backlight…     │  caption
│                                       │ │ You'll review…       │
└───────────────────────────────────────┘ └──────────────────────┘
```

On phones the well is full-width and the two buttons sit under it, full
width, primary first. Class names `.capture-studio-grid`,
`.capture-studio-sidebar`, `.capture-studio-preview` stay on the same roles
(e2e and the landscape CSS depend on them); aria-labels "Upload photo from
your device", "Take photo using device camera", "Photo preview area" stay.

### 5.3 Review photo (ImageCropModal)

The photo fills the dialog body edge to edge as a `.print`; the
platform-safe framing rails are 1 px `--hairline` at 40 % opacity; footer
keeps all three actions: `ghost` "Choose another", `ghost` "Save original to
Photos" / "Download original" (same two-mode label and icon as today), and
`primary` "Use photo". Loading and error states use the tokens.

### 5.4 Post details (PostCustomizer + ScenarioPicker)

One column, max 720 px, sections separated by 32 px and a title-2, never by
nested cards:

```
[thumb 56px]  Customer delivery photo        Change photo
──────────────────────────────────────────────────────────
What kind of post
  (ScenarioPicker: list on phones, 2-col option grid on desktop;
   roles group/listbox/option unchanged)
Who and what
  Posting as  [Jamie Rivera ▾]
  Customer first name  [        ]
  Vehicle  [Scan VIN]  → decoded pill with "Clear vehicle"
  Photo release  [Capture release]  → status tag
Look
  (design-style tiles, 3-up; selected = brand fill + brand foreground,
   unselected = hairline; never a label colour change alone)
Where it goes
  (platform chips, pill, selected = brand fill; "More platforms" ghost)
  [ ] Add video   [ ] Make it playful   (aria-pressed toggle rows, 44 px)
Caption
  (tone chips) · "Add a personal line (optional)" textarea · or "Write my own"
──────────────────────────────────────────────────────────
                                         [ Create post ]  (primary, lg,
                                                            sticky on phones)
```

Advanced options (templates) stay in the collapsible; the collapsible is a
ghost button row with a chevron, not a card. No mount moment on this screen.

### 5.5 Header and stepper

Header 56 px on `--panel` with a hairline below; no blur, no scroll shadow
change. Left: the dealer's logo (or initial tile in brand fill) and store
name; on ≥ md, "Posting as {name}" beneath in caption. Right: My work,
Settings, Log out as `ghost` buttons (icon + label on ≥ sm, icon only below,
aria-labels kept). Studio mode (result screen) keeps the same header; its
"Publish studio" title moves into the page (PR2).

Stepper (`ProgressSteps.tsx`, a rewrite, not a reskin): three segments —
Photo · Details · Post — as a 2 px line under the header in the content
column, filled in brand fill up to the current segment, hairline after, with
the three labels beneath in label size (current = ink, others = ink-3;
current is also the only filled segment, so it survives the achromatic
default). Mapping: `CAPTURE → 1`, `CUSTOMIZE → 2`, `GENERATING` and `RESULT →
3`; the stepper is not rendered on `LOGIN`, and on `RESULT` the studio owns
the page (the stepper is hidden there as today's studio header is). Phones
show "Step 2 of 3 · Details" and the segments. `aria-current="step"` stays; no
check icons, no springs.

### 5.6 Settings

Dialog: "Settings" / "Appearance and image quality on this device." Two
groups with title-2 headings and radio rows (44 px, hairline between):
Appearance — Dark, Sunlight, Match device; Image quality — the existing two
options with their existing helper text. One icon per group at most, or none.

## 6. Result screen (PR2) — outline

- The prints are the page: each rendered format sits at true aspect on the
  lit table as a `.print`, in a horizontal filmstrip on phones and a grid on
  desktop; caption and delivery controls are a column beside them (desktop)
  or beneath (phone).
- One Save/Share pair, not three; the approval notice becomes a single-line
  status tag above the caption, never a red banner above the photo.
- Platform chips never truncate: icon + short name, wrapping allowed.
- The studio stays dark in both themes; anything portalled to `document.body`
  must carry `.publish-studio-theme` (known trap).
- Copy contract kept: "Media preview", "Platform delivery", "Post delivery
  actions", "Share post", "Copy caption", "Clear all", "Share all N", "Share
  now", "Share to Facebook", dialog "Share", "Share sequence", "Finish
  sequence", "Mobile platform outputs", website-draft strings, testid
  `creative-tools-panel`. "Publish studio" (h1) becomes "Review and share" ⚑
  (`__tests__/FrontendResiduals.test.tsx`, `e2e/flow.spec.ts`).
- Detailed layouts are written as an addendum at the start of PR2.

## 7. History, settings, manager, system admin (PR3) — outline

- History: a list of prints (thumb, first line of caption, status tag, date)
  with one primary action per row; empty state per §4.8.
- Manager dashboard: setup wizard becomes a checklist panel shown only until
  complete; Overview/Settings/Team as real tabs with the content column
  below, nothing else on the page; leaderboard and approvals are panels in
  Overview.
- System admin: same tab pattern (Dealers · Admins · Users · Settings —
  names pinned by `e2e/real-pocketbase.spec.ts`), tables on `--panel` with
  hairline rows.
- Every pinned admin string in `e2e/real-pocketbase.spec.ts` is kept.
  Layouts are written as an addendum at the start of PR3.

## 8. Engineering plan

### 8.1 Migration strategy

1. Tokens first, aliases preserved (§4.1): the whole app re-colours with no
   component edits; the screenshot matrix taken here is the baseline. Done
   2026-09-18: `vite build` clean, all screens re-colour.
2. Fonts: `@fontsource/barlow` (400/500/600) and
   `@fontsource/barlow-semi-condensed` (500/600) replace the Inter imports;
   `tailwind.config.js` families, the `fontSize` tracking and the h1–h6 rules
   reset per §4.2. Done with step 1.
3. Logo assets v3 → v4 across the whole reference surface (§4.7). Done, with
   an independent verifier.
4. Primitives (§4.6) rewritten in place with prop aliases.
5. Screens (§5), one agent per screen, disjoint files, same branch.
6. Tests updated in the same commit as the string or class they pin.
7. Guard rewrite: `__tests__/sunlightThemeContrast.test.ts` currently
   requires `[.theme-light_&]:text-*-800` literals. It is rewritten to assert
   the new invariants: no `[.theme-light_&]:text-{primary,success,warning,
error,info}-` literal anywhere in `components/` (the token system makes
   them unnecessary), no `text-{success,warning,error,info}-(50|100|200|300)`
   ink, no `text-white` on a theme-aware fill, no `text-ink-3` inside a Modal
   subtree, and the studio-invariants case updated to the Graphite values. A
   planted mutant on the `primary` ramp and one on `error` must fail the
   rewritten test before it is trusted (guard-test failure modes memory).
8. `__tests__/prePaintTheme.test.ts`: the inline script's light `theme-color`
   changes to `#f4f4f2`, so the sha256 in `vercel.ts` and
   `e2e/staged-release.spec.ts` are re-pinned in the same commit.
9. `index.html` critical CSS: colours only (`#121416`, `.theme-light`
   `#f4f4f2`, `theme-color` both), bezel removed; the viewport-pin rules are
   not touched. `manifest.webmanifest` `background_color`/`theme_color` to
   `#121416` together (PwaIdentity pins them consistent).
10. `hooks/useDealerTheme.ts` per §4.1 rules 1–6 with its unit test.
11. `Logo.tsx` inline mark + wordmark (§4.7); `Header.tsx` mobile studio mark
    uses it.

### 8.2 Files by PR

PR1 (`design/light-table`): `styles/globals.css`, `tailwind.config.js`,
`index.html`, `vercel.ts`, `package.json`/lock, `public/*v4*`,
`public/manifest.webmanifest`, `scripts/export-dsp-logo-assets.sh`,
`scripts/render-og-image.mjs`, `components/ui/*`, `components/Logo.tsx`,
`components/Header.tsx`, `components/ProgressSteps.tsx`,
`components/SettingsModal.tsx`, `components/LoginScreen.tsx`,
`components/CameraCapture.tsx`, `components/ImageCropModal.tsx`,
`components/PostCustomizer.tsx`, `components/ScenarioPicker.tsx`,
`components/VinScanner.tsx` and `components/PhotoReleaseModal.tsx` (tokens
and primitives only, no copy change), `components/MainContent.tsx`
(generating state: progress line + status, no shimmer), `App.tsx` (dialog
copy, boot status), `hooks/useDealerTheme.ts` (+ test),
`utils/animations.ts` untouched, tests and e2e listed in §9.

PR2: `components/PostResult.tsx`, `MobilePublishStudio.tsx`,
`PlatformDeliveryBoard.tsx`, `CaptionStudio.tsx`, `ShareDialog.tsx`,
`VideoDirectorModal.tsx`, `FunModeDirectorModal.tsx`, `ScheduleDialog.tsx`,
the loading overlay, `Header.tsx` studio mode.

PR3: `PostHistory.tsx`, `DealerAdminDashboard.tsx`, `DealerSetupWizard.tsx`,
`BrandSettings.tsx`, `ApprovalQueue.tsx`, `Leaderboard.tsx`,
`PersonEditModal.tsx`, `ManagerLoginManagement.tsx`,
`CustomScenarioManager.tsx`, `AdminDashboard.tsx`, `SystemHealthPanel.tsx`,
`AdminCredentialHandoff.tsx`, `WalkaroundStudio.tsx` (tokens only),
`SignaturePad.tsx`, `ErrorBoundary.tsx`; deletion of `SPRING_CONFIGS`,
`hoverScale`, `hoverLift`, the legacy `success/warning/error/info` hex ramps
and unused keyframes.

### 8.3 Work allocation

Fable 5.1: this spec, the token file, the logo, final screenshot critique,
PR bodies, merges. Opus 5: LoginScreen and PostCustomizer (PR1), PostResult
(PR2), DealerAdminDashboard and AdminDashboard (PR3), and the design-review
lens. Sonnet 5: primitives, CameraCapture / ImageCropModal / ScenarioPicker /
Header / Settings, the ProgressSteps rewrite, useDealerTheme, index.html +
CSP hash, guard rewrite, test and e2e updates, verification runs. Haiku 4.5:
read-only inventories and formatting runs.

## 9. Verification

Per PR, all green before merge:

- `npm run typecheck`, `npm run format:check`, `npm run model-policy:check`
  (version stays 5), `npm run vercel-config:check`,
  `npm run release:vercel:check`, `npm test` (full vitest, including the
  rewritten guard with both mutants proven).
- `npx playwright test` on chromium + webkit across the 8 configured
  viewports: axe serious/critical = 0, no horizontal overflow, 44 px targets,
  and every pinned string/role/class below.
- Screenshot matrix from `__tests__/__scratch__/shots.mjs` (never committed;
  selectors updated with the copy): phone 390 × 844 and desktop 1440 × 1000,
  Graphite and Sunlight, every step and dialog in the PR; reviewed by the
  design lens before merge.
- Lighthouse on the login route ≥ 95 accessibility; no layout shift on font
  swap (check the keypad).
- Real device: iOS Safari via simctl (PWA testing traps memory): the
  installed PWA shows the new icon and the new build after update.
- Deploy: merge → CI → Fly + Vercel → `/api/health` 200 and `/sw.js`
  VERSION = merge commit → production screenshot on the Vercel origin.

Pinned e2e strings and selectors PR1 keeps or updates together
(`e2e/flow.spec.ts`, `pwa-install.spec.ts`, `staged-release.spec.ts`,
`real-pocketbase.spec.ts`): heading /^sign in$/i; button /my code/i; group
"Four digit access code keypad"; status "N of 4 digits entered"; buttons
"Digit N"; text "Code not recognized. Check the code and try again."; heading
"Security check"; buttons "Manager username and password", "System admin",
"Continue to system admin"; textbox "Username", label "Password"; heading
"Capture the handoff." → "Start with a photo" (update); buttons /^(Take
photo|Choose from device)/, "Take photo"; input aria-label "Upload photo from
your device"; classes `.capture-studio-grid`, `.capture-studio-sidebar`; link
/skip to main content/i; `#main-content`, `#root`; dialog "Review photo" /
"Use photo"; the sha256 pin in `staged-release.spec.ts`; the v4 asset lists.
Unit tests that pin PR1 strings or classes: `sunlightThemeContrast.test.ts`
(rewritten), `prePaintTheme.test.ts` (re-hash), `PwaIdentity.test.ts` (v4,
done), `BrandSettings.test.tsx` (`[.theme-light_&]:text-success-900` /
`warning-900` class assertions → token classes), `DragDropReproduction.test.tsx`
("Drop image here"), `PostCustomizer.test.tsx`,
`MainContentCustomizerPersistence.test.tsx`, `LoginSecurityFlow.test.tsx`
(grep each for the changed strings).

## 10. Open questions

None blocking. Two choices can be revisited after PR1 screenshots: the
achromatic product accent (§4.1) and Barlow as the UI face (§4.2). Both are
single-token changes.
