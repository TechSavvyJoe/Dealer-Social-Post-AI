# Open issues — 2026-09-03

Findings from the browser review of the Phase 1 Brand section plus a
production failure reported from the field. Ordered by severity.

## P0 — Photo release lock strands a real delivery post — resolved

**Originally reported from production 2026-09-02 (iPhone, installed PWA).** A
signed delivery post rendered with "Photo release not saved · Delivery locked"
after `linkReleaseToPost` failed while the signature itself had already been
stored.

**Status (2026-10-15):** fixed in product code. Do not treat this document as
an open defect list for the lock path.

What landed:

- `linkReleaseToPostWithRetry` with backoff (`services/photoReleases.ts`)
- Generation path uses the retry helper (`hooks/useGeneration.ts`)
- Explicit repair flow via `hooks/useReleaseRepair.ts` ("Retry saving release")
- Hourly prune still expires unlinked `photo_releases` after `expires_at`
  (`pb_hooks/main.pb.js` `prune-unlinked-photo-releases`)

Coverage: `hooks/useGeneration.test.tsx`, `hooks/useReleaseRepair.test.tsx`.

The original failure analysis below is kept as historical context only.

<details>
<summary>Original 2026-09-03 analysis</summary>

`runWithPersistedPhotoRelease` (`services/photoReleases.ts`) stores the
signature **before** the paid provider call and rejects before `providerTask`
if that store fails. The reported post had a finished image and caption, so the
provider call ran, so the signature was stored successfully. The lock came from
the second step: `linkReleaseToPost` threw, its catch only logged
`photo_release.link_failed`, and `releaseStatus` stayed `"save_failed"` →
`releaseLocked` → `deliveryLocked`.

Consequences at the time:

1. The banner copy said consent was not stored when it was (unlinked row).
2. The offered remedy was redo photo + generation + signature.
3. There was no retry of the small first-party link POST.

</details>

## P1 — Brand section contradicts the legacy control directly below it

`components/DealerAdminDashboard.tsx`. The new Brand section reads "One house
style for every post. Salespeople never pick image style, tone, or video look
themselves." Immediately below, the legacy "Image overlay styles" section says
"Pick which design styles your team can use. Star one to preselect it when a
salesperson opens the customizer", with all five styles marked "available to
salespeople".

Both are live in the same card and say opposite things. Because Phase 1 ships
dark, the legacy section is the one that currently governs behavior, so the new
copy is describing a state that does not exist yet. Either scope the Brand copy
to "when the new creative system is switched on", or mark the legacy section as
superseded — but they cannot both stand as written.

## P2 — Brand section polish

- **Truncated placeholder.** The "Do" phrase input clips its own placeholder:
  "Mention the salesperson by first r…". The Don't column fits. Shorten the
  placeholder or widen the field.
- **Unbalanced help text.** "Up to 3 phrases the captions always follow." wraps
  to two lines while "Up to 3 phrases the captions never do." fits one, so the
  two columns end at different heights.
- **Capitalization drift.** "Signature Look" and "Alternate Look" title-case
  "Look" while "Playful style", "Motion style", and "Motion signature" use
  sentence case. Defensible if "Look" is a proper noun for the concept, but it
  should be applied consistently and stated in the style guide.
- **"Add scenario" button wraps** onto two lines at desktop width, making it
  noticeably taller than a normal control.
- **Sticky save bar overlaps content** mid-scroll (it covered the "Logo
  placement" heading and the "Default hashtags" field during review). Confirm
  the card reserves bottom padding equal to the bar height so the last control
  is never trapped underneath.

## Verified good

- The phantom dirty-state fix holds in a real browser: a dealership with no
  saved hours or overlay styles opens with Save disabled, status "Up to date",
  and `onDirtyChange(false)`.
- The three Signature Look cards, motion signature, logo placement, image
  quality, brand voice do/don't, and the hashtag lock all render with correct
  labels, help text, and no console errors.
