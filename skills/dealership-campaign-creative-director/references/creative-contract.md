# Creative contract

Use this reference to turn visual observations into a comparable acceptance record. Do not infer a field from model intent; record what is actually visible in the candidate.

## Mode bar

| Mode        | Required visual result                                                                                 | Reject                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `regular`   | Real photo remains primary; overlay feels composed into the frame; one distinct campaign motif         | Stock-photo replacement, generic title card, flat default banner                |
| `fun`       | Explicitly requested playful treatment; same people and vehicle remain recognizable; controlled energy | Accidental character/vehicle replacement, chaotic effects, generic filter       |
| `depth-pop` | 3D elements share scene perspective, light, shadows, occlusion, and foreground/background planes       | Floating badge, pasted render, object that ignores the photographed environment |

## Acceptance order

Evaluate candidates in this order:

1. **Hard safety and truth:** source is a real photo; people, vehicle, and scene identity are preserved; no personal name, wrong dealer name, fake mark, contact detail, hashtag, prompt leak, social UI, or unrequested transformation appears.
2. **Text correctness:** exactly one approved headline is visible, at most four words and 40 characters; dealership identity is exact; typography is clean.
3. **Craft:** overlay is integrated, the requested mode has a distinct signature, and visual quality is at least 4/5.
4. **Candidate comparison:** prefer the candidate with fewer hard failures, then clean typography, integrated overlay, distinct mode signature, higher quality score, and closer headline match. Never assume the newest candidate is best.

## Review manifest

Use schema version 1:

```json
{
  "schema_version": 1,
  "mode": "regular",
  "source_is_real_photo": true,
  "people_identity_preserved": true,
  "vehicle_identity_preserved": true,
  "scene_identity_preserved": true,
  "expected_headline": "WELCOME HOME",
  "detected_headlines": ["WELCOME HOME"],
  "expected_dealer_name": "Northstar Ford",
  "detected_dealer_name": "Northstar Ford",
  "dealer_identity_mode": "text",
  "logo_supplied": false,
  "logo_status": "none",
  "personal_names_detected": [],
  "prompt_leak_detected": false,
  "social_ui_chrome_detected": false,
  "contact_details_detected": false,
  "hashtag_detected": false,
  "typography_clean": true,
  "style_signature_present": true,
  "overlay_integrated": true,
  "visual_quality_score": 4,
  "artistic_transformation_requested": false,
  "unrequested_transformation_detected": false,
  "environmental_depth_integrated": false
}
```

`dealer_identity_mode` is `text` or `supplied_logo`. `logo_status` is `none`, `supplied_asset`, or `fabricated`. In supplied-logo mode, require `logo_supplied: true` and `logo_status: supplied_asset`. In text mode, require an exact detected dealership name and never accept a logo-like invention.

For `fun`, require `artistic_transformation_requested: true`. For `depth-pop`, require `environmental_depth_integrated: true`. Other modes may leave environmental depth false.
