# PR2 blueprint amendments (orchestrator, 2026-09-22) — binding on every unit

Source: the coverage critic's 21 gaps, 5 sequencing issues and 5 wrong-reuse items
against pr2-blueprint.json. Where a unit's text in the blueprint conflicts with
this file, THIS FILE WINS.

## High (must be honoured; a reviewer blocks on any of these)

A1. **A signed release is single-use.** `POST …/link-post` binds a release to its first
post permanently (409 on relink). `pendingRelease` may be reused ONLY while it has
never been linked (cancel before `logPost`, generation error before link). After a
successful link, remix/retry/"Try another" that creates a NEW post requires a new
signature; the request builder returns `release_required` (with reason
`release_already_used`) in that case. Never keep a linked releaseId as reusable.
IMPLEMENTED in PR2-0 (U01): `buildGenerationRequest` takes `releaseAlreadyLinked?: boolean`
and returns `{ ok: false, reason: "release_required", detail: "release_already_used" }`;
U08/U09/U12 must track "linked" on the pending release and pass it.
A2. **Consent text is legally operative — copy it verbatim.** The paragraph in
components/PhotoReleaseModal.tsx (advertising scope, right to withdraw, the
"Attached VIN" row, storage/expiry sentence) moves into the new sheet unchanged.
Restyle only. Any wording change needs Joe's explicit legal sign-off, which has not
been given.
A3. **The release gate fails closed.** An undefined/unknown/deleted scenario resolves to
a scenario that REQUIRES a release (today: POST_SCENARIOS[0]); `buildGenerationRequest`
and `resolveStoreDefaults` implement this; the URL/step guard never opens DETAILS
without a valid `postDraft` (redirect to HOME).
A4. **Leave guard keeps its busy checks.** Extract `hasWorkAtRisk` / `requestLeaveResult`
semantics from PostResult.tsx:3071-3096 (imageBusy, textBusy, websiteSending,
in-flight or failed autosave, video jobs at risk) into a hook
(`hooks/usePostLeaveGuard.ts`) in PR2-0 (unit U03), with PostResult consuming it;
PR2b's `canLeavePost` is that hook's `atRisk === false`, never `Boolean(postId)`.
A5. **A new photo clears the old post.** `handlePhotoPicked` clears `generatedPost`,
`error` and `generationParams` exactly as `handleCropConfirm` does today
(hooks/useAppController.ts:198-211) before setting the new draft.

## Medium / low / sequencing / wrong-reuse (honour in the named units)

B1. (U06/U07) Share events live in a NEW collection `post_share_events` {post (relation,
owner-scoped), channel, via ("share_sheet"|"download"|"copy"), created} — never a field
on `posts`, so `posts.updated` (the website compare-and-set `post_revision`) is not
bumped. The GET /api/app/posts list projection (pb_hooks/main.pb.js ~3960-4010) MUST
include a derived `share_summary` per post in the same unit (U07). Client projection
in services/posts.ts. An event is recorded when `navigator.share` RESOLVES (the user
completed the sheet); the UI label is "Shared · Facebook" with the honest subline
"sent to the share sheet" — never claim which app received it.
B2. (U02) Extract the identity-guard WRAPPER (PostResult.tsx:970-992: allowedPhrases =
dealer name/OEM/vehicle description, maskedPhrases = salesperson name + first name,
rejectAnyCustomerIdentity) as `checkCaptionIdentity(...)`; the bare
`captionUsesOnlyExpectedCustomer` is never called directly by a screen.
B3. (U02) Extract `buildShareCaptions` + the `packOverrides` rules (an edit to the body
replaces/invalidates the AI per-channel variants) so PR2b's single caption editor has
defined semantics: body edit → per-channel packs are regenerated from the edited body
(disclosure re-appended by the sanitizer), never the stale AI variants.
B4. (U05) `usePhotoIntake` performs the JPEG re-encode, white flatten and 2048 px cap that
ImageCropModal.tsx:145-162 does today (PNG/screenshots must not reach the provider,
IndexedDB or the session as PNG with alpha) as an OPT-IN (`flattenToJpeg`) so the old
CameraCapture → ImageCropModal path stays byte-identical in PR2-0; the new HOME flow
(U09/U11) passes `flattenToJpeg: true`. AMENDED 2026-09-23: the `media.capture.backup`
telemetry stays where `archiveDealerMedia` runs — `useAppController.handlePhotoPicked`
(U09) emits it with the same payload (outcome saved/unavailable); the hook does not.
B5. (U08) Cancel semantics: before `logPost` starts → abort cleanly, nothing created,
release untouched, `ai.generate.cancelled` telemetry; after `logPost` started → let it
finish; for `requires_approval` stores the result is "Saved to My work · waiting for
approval", otherwise "Saved to My work as a draft" (copy for the UI units). A
synchronous in-flight guard (`inFlightRef`) in the hook makes a double tap or
Cmd/Ctrl+Enter a no-op until `onMutate`. Real stages (design → caption → checks) come
from the hook; the legacy progress fields stay populated for the old overlay in PR2-0.
B6. (U01) `customizer.decisions` telemetry is emitted by the request builder's caller with
the same payload; `photo_release.captured` stays in the release code path.
B7. (U03) `useDraftAutosave` exposes `{status: 'idle'|'saving'|'saved'|'failed', retry}`;
PR2b shows it on every device.
B8. (U04) `useVideoJobs` exposes `atRisk` (a running/unsaved paid job) for A4.
B9. (U18, later) Look switching does NOT reuse `regenerateImageMutation` with the old
brief; it rebuilds the brief via `buildGenerationRequest` with the new Look; Look
renders are cached in memory only (never in the persisted session — localStorage quota)
and do not write device-archive records on every switch (archive once per new render).
B10. (U19, later) Remix from POST keeps the "work at risk" confirm and brand mode's one-shot
budget; "Try another" is bounded per post (one full regeneration unless the manager
allows more).
B11. (U11/U14, PR2a) PR2a must not ship a blank WORK step: "See all"/My work opens the
EXISTING My work modal in PR2a; the WORK step arrives with U20. PR2a's e2e unit (U15)
must retarget every `Start with a photo` pin (flow.spec.ts:747-749, 1098-1100,
pwa-install.spec.ts) and the capture test in the same PR so the matrix stays green.
B12. (U14/U21) Every test that imports a retired component is retargeted or retired in the
SAME unit as the deletion (e.g. **tests**/MediaArchiveObjectUrls.test.tsx,
**tests**/FrontendProductionPass.test.tsx).
B13. (U20, later) Back from a reopened POST returns to the surface it was opened from
(managers → DEALER_ADMIN); My work from DETAILS/POST never wipes a captured signature
or bypasses the leave guard (open it as an overlay, or guard the transition).
B14. (U11, later) Header keeps the "Approval required"/"Review" badge for approval stores.
B15. (U16, later) Phones keep the fallback controls when `navigator.share` cannot share
files (Save / Open app / web intent), and Share is disabled while a re-prepare after an
edit is in flight (no debounce window where a stale caption can be shared).

## Proof standard for PR2-0

The existing **tests**/PostResult.test.tsx (58) and **tests**/PostCustomizer.test.tsx (35)
and every other test that exercises the old screens pass UNCHANGED, except source-guard
tests that pin a moved string, which are retargeted in the same unit and named in the
unit's return. `npm run typecheck`, `npx prettier --check` on changed files, and the
unit's own new tests are green. No user-visible change.

## Added 2026-09-23 (from the PR #37 Codex round)

C1. (U09/U12/U20, PR2a/PR2b) A run still in flight must be detached with reason
"superseded" not only by a newer Create post (done in PR #37) but also when the
salesperson reopens a post from My work or picks a new photo — otherwise the stale
run's onSuccess still reaches setGeneratedPost + setStep(POST) and replaces that
workspace (pre-existing at HEAD, found by the PR #37 unit-A reviewer).
C2. PR notes: after a run whose logPost returned no post, the release stays unlinked, so a
Remix now reuses it (same photo, same customer) instead of asking for a new
signature — correct under A1, mention it in the PR2a notes.
