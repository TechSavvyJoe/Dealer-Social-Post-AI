# Dark studio design QA

**Scope:** approved option 3 Home design, primary image/video gallery, and installed phone shell. This is implementation evidence, not a production deployment claim or 360 feature acceptance.

- Source visual truth: `/Users/joegallant/.codex/generated_images/01a116ab-229d-75c0-b5c0-aa4efa0174b1/exec-e8220e2f-3175-45cb-a682-53e416a62db7.png`.
- Implementation: local Vite app, synthetic Northline Motors salesperson, dark theme, empty My work. No production customer data or provider calls.
- Evidence directory: `/Users/joegallant/Documents/Codex/2026-10-07/dealer-social-post-ai-release/studio`.
- Source 853 × 1844 pixels normalized to 390 × 843. Phone implementation 390 × 844 CSS/pixels, density 1. Desktop 1440 × 1000. Source has populated My work; the implementation fixture intentionally exercises the empty state.
- Full comparisons: `home-comparison-first.png`, `home-comparison-refined.png`.
- Implementation captures: `home-390-refined.png`, `home-1440.png`.

**Findings and comparison history**

1. [P2, fixed] Initial implementation added excess spacing before the library and categories, pushing My work below the phone viewport. Compared the reference and initial capture in a single side-by-side image. Reduced mobile header from 64 to 56 px, introduction spacing, category gaps, Delivery height and My work gap. The second comparison shows all six categories plus My work at 390 × 844.
2. [P2, fixed] The gallery was not keyboard focusable with Image active. The actual generated-video browser scenario caught a serious accessibility finding. Made the scroll rail keyboard focusable; both Chromium and WebKit then passed the full scenario and axe checks.
3. [P1, fixed] A video share could mark the adjacent image version as already shared. Local receipts now retain the media choice; the integration test shares a real decoded 720 × 1280, 6-second MP4, switches to Image, and verifies an image/jpeg reaches the same destination.

**Fidelity surfaces**

- Typography: Inter for display and body, matching the selected direction; compact 28 px mobile heading, legible image labels and supporting text. Desktop expands the heading and preserves useful details.
- Spacing/layout: full-width Delivery and Team with two paired rows, prominent library action above categories, My work below/on the desktop side. The 52 px library control is intentionally larger than the concept at the user's request. Safe-area spacing remains device-controlled.
- Colors/tokens: near-black canvas, restrained blue library action, defined card borders, high-contrast photographic labels. Existing Sunlight Mode remains available.
- Image quality: reused the app's six existing full-resolution category photographs with the approved full-bleed treatment. Exact vehicles/people differ from the generated concept. Header uses the configured dealership logo or the new generated automotive app mark; no simulated photo drawings.
- Copy/content: matches the approved heading, helper and primary action. Dealer identity and category blurbs remain real app data. Empty My work uses the existing actionable empty state.

Focused inspection of the header, introduction, library button and category labels is readable directly in the equal-width full comparison; no extra crop was needed. Existing category photography and real empty-state content are accepted deviations from the concept, not missing assets.

**Interactions and responsive evidence**

- CUA: loaded phone and desktop views; My work navigation and Back; no console warnings/errors observed.
- Browser regression: 8 passed / 8 intentionally skipped across 280, 320 and 390 px Chromium/WebKit configurations. Checked top library reach, bottom content reach, no horizontal overflow, first caption line above mobile sharing actions, video generation returning to the preview, Image/Video controls, swipe settling, channel switching, and exact shared file types.
- Installed app: simulated iPhone standalone mode with 59 px top / 34 px bottom safe areas, rotation and return upright; root reaches visible height without document overflow. This is browser emulation, not physical iPhone certification.
- Icon contract: v5 opaque Apple/any/maskable PNGs, dimensions and maskable safe zone verified. Immutable v4 assets retained.
- Unit viewport checks: resize/keyboard-sized viewport changes, zoom preservation, browser/standalone mode changes and listener cleanup.

**Implementation checklist**

- [x] Compare approved source and rendered implementation together.
- [x] Fix layout, asset-selection and accessibility findings; repeat validation.
- [x] Preserve desktop and installed-phone usability.
- [ ] Complete full repository checks and sequential release verification before claiming live.

**Follow-up polish:** physical iPhone Home Screen icon refresh and keyboard behavior need device confirmation after deployment. The 360 capture/editor is a separate feature under development.

final result: passed
