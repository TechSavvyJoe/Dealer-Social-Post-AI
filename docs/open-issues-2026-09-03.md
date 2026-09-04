# Open issues — 2026-09-03

Findings from the browser review of the Phase 1 Brand section plus a
production failure reported from the field. Ordered by severity.

## P0 — Photo release lock strands a real delivery post

**Reported from production 2026-09-02 (iPhone, installed PWA).** A signed
delivery post rendered with "Photo release not saved · Delivery locked", and
Copy, Share, Save, and Export were all locked. The only remedy offered is
"create another post to retry", which means re-signing with a customer who has
already driven away.

**What the code actually does.** `runWithPersistedPhotoRelease`
(`services/photoReleases.ts:86`) stores the signature **before** the paid
provider call and rejects before `providerTask` if that store fails. The
reported post has a finished image and caption, so the provider call ran, so
**the signature was stored successfully**. The lock therefore comes from the
_second_ step: `linkReleaseToPost` (`hooks/useGeneration.ts:665`) threw, its
catch only calls `logError("photo_release.link_failed")`
(`hooks/useGeneration.ts:668-674`), and `releaseStatus` stays `"save_failed"`
→ `releaseLocked` (`components/PostResult.tsx:860`) → `deliveryLocked`.

Consequences:

1. **The message is factually wrong.** "The signed photo release was not
   stored, so consent cannot be verified" (`components/PostResult.tsx:1022`,
   `hooks/useGeneration.ts:713`). In this path it _was_ stored — it is sitting
   on the server as an unlinked `photo_releases` record. Consent exists; only
   the association is missing.
2. **The remedy is wrong and expensive.** Both ids are already in hand
   (`releaseId`, `post.id`). A single retry of the link call fixes it. Instead
   the salesperson is told to redo the photo, the generation (paid), and the
   customer signature.
3. **There is no retry at all.** The link failure is caught and logged, never
   retried — not even once, and not queued. It is a small first-party POST to
   `/api/app/photo_releases/:id/link-post`.

Fix:

- Retry `linkReleaseToPost` with backoff, and queue it for retry on reconnect
  (the app already has an offline queue and an authEpoch guard to scope it).
- Add an explicit "Retry saving release" action on the locked banner that
  re-runs the link using the ids already on the post.
- Correct the copy for the link-failure path: consent was captured, the post
  is not yet linked to it, and it can be retried. Reserve "was not stored" for
  the genuine pre-generation failure, which today cannot reach this screen
  because it aborts generation.
- Second entry point to the same state: a post whose `release_required` is
  true while the server's `release_status !== "saved"`
  (`hooks/useGeneration.ts:657-662`). Distinguish it, since there the consent
  really may be missing.
- Server-side sweep: unlinked `photo_releases` rows are orphaned consent
  records. Either reconcile them to their post or expire them on a schedule.

**Presentation of the same failure** (visible in the report):

- The identical error is shown three times — the top banner, a toast overlay,
  and a disabled "Release not saved" button in the action bar.
- The toast overlay is positioned over the photo, covering the customers'
  faces.
- The website-draft banner truncates mid-word: "Website draft was not s…" and
  "The original post did not finish saving, so nothing can…".
- "Release not saved" reads as a button but is a status; it should not look
  pressable.

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
