---
name: dealership-campaign-creative-director
description: Direct and validate polished dealership campaign images from real customer and vehicle photos, including premium real-photo overlays, explicitly requested Fun transformations, and Depth Pop environmental 3D treatments. Use when Codex must create, edit, critique, or QA automotive social imagery while preventing customer-name leaks, identity or vehicle swaps, fabricated logos, prompt text, malformed typography, bland retries, or social-app UI baked into the pixels.
---

# Dealership Campaign Creative Director

Turn a real dealership photo into an energetic campaign creative without weakening truth, consent, or brand fidelity.

## Direct the creative

1. Inspect the complete source image and any genuine brand assets before editing. Record only visible or supplied facts; do not infer consent, customer identity, vehicle details, pricing, or brand marks.
2. Lock the invariants: preserve the same people, faces, vehicle, and recognizable scene. Use the exact dealership spelling. Use a supplied genuine logo or dealership-name text, never a synthesized logo, seal, OEM badge, or dealer emblem.
3. Keep personal names out of image pixels. Put an explicitly approved public label in editable caption or metadata only. Never expose a release/signature name.
4. Select one mode:
   - `regular`: keep the real photo photographic and add an integrated premium overlay.
   - `fun`: use a clearly requested playful transformation while keeping people and vehicle recognizable.
   - `depth-pop`: keep the real photo and place 3D graphic elements within its scene planes, perspective, occlusion, light, and shadows. Reject floating clip art.
5. Author one exact headline of at most four words and 40 characters. Add no support sentence, hashtag, URL, phone number, price, APR, or prompt note. Treat the dealership lockup as brand identity, not a second marketing headline.
6. Specify placement, safe zones, contrast, typography, and one unmistakable style signature. Keep text and logos off faces, hands, plates, badges, and vehicle nameplates.
7. Generate or edit, then inspect the entire result at full frame and mobile size. Never approve the latest retry automatically; compare it with earlier candidates.

## Decide whether it ships

Reject a candidate for any wrong person or vehicle, personal name in pixels, incorrect dealer spelling, fabricated mark, prompt or instruction text, contact detail, hashtag, social UI chrome, or unrequested transformation. Also withhold bland, pasted-on, or malformed work until it reaches the campaign-quality bar.

Read [references/creative-contract.md](references/creative-contract.md) when writing a production brief, comparing candidates, or recording a review. After visually inspecting the pixels, encode observations in that review manifest and run:

```bash
python3 scripts/validate_creative_review.py path/to/creative-review.json
```

The script validates supplied observations; it does not inspect images or replace human visual review. To forward-test the bundled rubric, run:

```bash
python3 scripts/validate_creative_review.py --suite evals/fixtures
```

Return the strongest valid candidate plus a concise acceptance record. If every candidate fails, say what must be regenerated; never present an unsafe or bland fallback as finished.
