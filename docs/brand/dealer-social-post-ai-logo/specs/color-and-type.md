# Color and type — v3

## Core palette

| Token           | Hex       | RGB           | Role                           |
| --------------- | --------- | ------------- | ------------------------------ |
| Campaign Ink    | `#07182B` | 7, 24, 43     | Primary field and dark neutral |
| Deep Channel    | `#0C2B50` | 12, 43, 80    | Midpoint of app-field gradient |
| Horizon Blue    | `#123A67` | 18, 58, 103   | App-field lift                 |
| Aperture Lift   | `#2F6DA5` | 47, 109, 165  | Restrained radial illumination |
| Editorial Ivory | `#F5F6F0` | 245, 246, 240 | Flat D/P and reverse artwork   |
| Highlight White | `#FFFFFF` | 255, 255, 255 | Upper D/P highlight            |
| Soft Ivory      | `#E8EADF` | 232, 234, 223 | Lower D/P highlight            |
| Social Coral    | `#FF6A4D` | 255, 106, 77  | Flat S accent                  |
| Coral Light     | `#FF8A62` | 255, 138, 98  | Upper S highlight              |
| Coral Deep      | `#FF5A44` | 255, 90, 68   | Lower S highlight              |

The app treatment may use the documented gradients and restrained shadow from
the canonical SVG. The micro and monochrome variants intentionally remove those
effects. Meaning must not depend on color: D, S, and P remain distinguishable in
the single-color master.

Do not invent CMYK or spot values from the screen palette. A print vendor or
brand-production specialist must proof conversions on the actual substrate.

## Wordmark typography

- Canonical text: `Dealer Social Post AI`
- Family: Inter
- Weight: 800 / ExtraBold
- Style: normal
- Tracking in active lockups: approximately `-0.03em`
- Package: `@fontsource/inter` 5.2.8
- License: SIL Open Font License 1.1

The application already bundles the reviewed family and weight. The active SVG
lockups intentionally retain live text while the design remains a
production-candidate. Do not substitute a synthetic weight or a visually
similar system sans.

After approval, derive an outlined master from this exact source in a
trustworthy vector workflow. Retain
`source/dealer-social-post-ai-editable-wordmark.svg` permanently for literal
spelling and future editing.
