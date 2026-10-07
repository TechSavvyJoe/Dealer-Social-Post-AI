# Streamlined posting, dealership settings and admin hub: what is true now

Restated on 2026-10-06 for branch `codex/streamlined-posting-ui` (stage B of the post-revision rollout), at
local head `4837814` plus the retirement and guard changes that follow it. Every statement below was checked
against this tree on that date. Earlier claims that could not be checked (artboard comparisons, browser
journey counts, a disposable PocketBase probe and a focused API-stage count) were removed rather than
repeated. The original 2026-10-01 record is in git history.

## Posting flow

- A salesperson goes Home → Details → Creating → Post, and has a full My work page. `MainContent.tsx`
  lazy-loads `Home`, `PostDetails`, `PostScreen` and `MyWork`; `CreatingScreen` renders while a post is
  made.
- Home shows six built-in category tiles (deliveries, inventory, service, promotions, community, team),
  plus one tile for each custom post type the store adds (`homeTilesForDealer` in
  `services/storeDefaults.ts`). Picking one starts photo intake. The six tile photos in `public/category/` total about 284 KiB.
- Details asks for the customer's signature through one release sheet (`components/details/ReleaseSheet.tsx`
  in a dialog) when the post type needs one, plus optional VIN and personal line.
- The signed release travels in memory only. A Cancel or a failed attempt brings Details back with the same
  signature and line. The signature is never written to browser storage. The personal-line field is
  dropped from the stored draft (`utils/persistence.ts`), but once a post is attempted the line's text is
  part of the creative brief stored with the generation request, so it is in browser storage then. A
  restored session asks for a fresh signature. `__tests__/PostCustomizerCarriedDraft.test.tsx` checks the
  signature on both paths, and checks the line is absent only on the restored-session path.
- For a caption within the chosen channel's character limit, the Post screen previews exactly what ships:
  the team-member disclosure first, the caption, then the compliance disclosure block, joined the way
  `fitPublishCaptionToBudget` joins them. A longer caption is shortened at share time (Google Business
  allows 1,500 characters, Instagram 2,200, LinkedIn 3,000), and the preview does not show that yet; the
  team-member disclosure and the disclosure block are kept and only the caption body is cut. Every channel
  ships from the one caption on screen. `__tests__/complianceDisclosures.test.ts` pins that wiring in
  `PostScreen.tsx` and `post/PostPreviewCard.tsx`, checks it against the delivered string, and records the
  over-budget gap at the Google Business budget.
- Approval, identity, image-review and release locks are derived in `utils/postLocks.ts` and block sharing
  on the Post screen while they hold.
- My work labels a share as "Shared · {channel}" with "sent to the share sheet" under it: the share sheet
  does not tell the app which app received the post, so the app never claims it was published. Share
  events are stored in `post_share_events`, never on the post record.
- Nothing in the posting flow offers a share time. The backend still stores `scheduled_for`, but no cron
  publishes it (`__tests__/scheduleHonesty.test.ts`).

### Retired screens

The pre-streamlined screens had no live importer and were deleted with their test suites: `PostResult`,
`PostCustomizer`, `CameraCapture`, `ImageCropModal`, `MobilePublishStudio`, `ShareDialog`, `ScheduleDialog`,
`PhotoReleaseModal`, `ScenarioPicker`, `RecentCaptureShelf`, `ProgressSteps`, `LoadingOverlay`,
`VideoDirectorModal`, `FunModeDirectorModal` and `CaptionStudio`. The invariants that still matter moved to
the live code: the delivered-caption guard to the Post screen, the schedule-honesty check to the posting
screens, the narrow-phone label check to the Post screen's action buttons, the rejection-reason check to
My work, the release telemetry check to the release sheet, the object-URL check to the My work recovery
grid, and the creative-brief budget and video-slate cases to their own files.

## Dealership settings (manager)

- Five sections: Store profile, Channels, Voice, Creative and Workflow (`utils/dealerSetupStatus.ts`).
  A sample post beside each section is built by the functions that build real posts and marks the part
  that section controls (Store profile has no marked part; `SECTION_MARK` in
  `components/dealer-settings/settingsModel.ts`).
- Workflow holds the manager approval rule at the top level: no approval, or approval for every post, for
  each person's first posts, or for selected post types. It also holds the team-member disclosure switch
  and wording.
- "Advanced workflow controls" holds two things only: team feature access (Playful style, Video) and
  channels by post type. It does not hold the approval rule.

## System admin hub

- Tabs: Dealers, Admins, Users and Connections. Dealers is a setup board with one row per store and the
  setup state of each, admin-only setup notes, and the per-store creative-system switch.
- `GET /api/app/dealers` builds each row with the same serializer as the store's own session, so the board
  shows the store's real Look, approval rule, disclosure and creative-system state; it never returns access
  codes. Setup notes are added only on this system-admin route.
- `GET /api/app/connections` answers only the system administrator, is sent `private, no-store`, and
  reports configuration flags with `verification: "not_tested"` and the website destination's dealer
  record id. It reports no secret values and does not claim any provider call succeeded.
- Personal Settings holds appearance (including Sunlight) and image quality for this device, with a link
  to dealership setup for managers.

## Post revisions (stage B)

The frontend sends `expected_post_revision` on draft saves, share records and website hand-offs
(`services/posts.ts`, `services/websitePublishing.ts`). Draft saves and share records still accept a
request with no revision from an older frontend; only draft saves log `[revision-legacy-client]` for it
(`pb_hooks/main.pb.js`). Website hand-offs already require a revision and refuse a missing one with a 409
(`WEBSITE_POST_REVISION_REQUIRED`). A supplied revision that is stale or malformed is refused with a 409 on
all three. Stage C, which refuses a missing revision on draft saves and share records too, is a separate
branch. Its release
gate and the rollback order for each stage combination are in `docs/production-backups-and-release.md` and
`docs/runbooks/rollback.md`.

## Sunlight and Light Table guard

`__tests__/sunlightThemeContrast.test.ts` scans every file under `components/` at any depth, plus `App.tsx`,
and holds each one to the Light Table rules by default. What it checks in those files:

- no `[.theme-light_&]` override;
- no legacy semantic ramp (`success`, `warning`, `error`, `info`, `primary` at a numbered step) or `surface`
  ramp on any colour utility;
- no raw Tailwind hue (`red` through `stone` at a numbered step);
- no `text-white`, and no `black` or `white` utility at any opacity;
- no fixed colour value: a 3, 6 or 8 digit hex (in code or in an arbitrary class such as `text-[#ffffff]`)
  or an `rgb()`/`hsl()` call with literal numbers, in code or anywhere inside an arbitrary class,
  including after an underscore as in `shadow-[0_0_4px_rgba(0,0,0,.5)]` (a self-check test in the guard
  pins each of these forms);
- no spring, hover, tap or endless motion.

It does not read named colours in JS values (such as `"white"`) or 4-digit hex. The one sanctioned fixed
palette is `PRINT_PALETTE` in `components/dealer-settings/SamplePhoto.tsx`, allowed by name and exact
content (four keys). Older fixed-colour sites in strict files are listed by exact literal and count, each
with its reason, pending sign-off: the on-brand Logo lockup, the login brand column's watermark scrims, the
`#1d4ed8` colour-input fallbacks and hex examples in the setup wizard and Creative settings, and the
black camera viewport, dialog scrim and lightbox ground (`VinScanner`, `ui/Modal`, `ImagePreviewModal`).
A new site, a changed value or an extra copy fails, and a listed literal that is gone fails a ratchet.

Eighteen files are listed as not yet migrated, each with its reason, and a ratchet fails as soon as one of
them no longer needs the exemption. Eight of the eighteen have no importer: six lost their last one when
the old screens were deleted, `Dialpad` had none before, and `WalkaroundStudio` has had none since
`5b6418c` and is kept by decision. `WalkaroundReleaseModal` is reachable only through `WalkaroundStudio`.
`ImagePreviewModal` passes the strict rules but is no longer opened anywhere. `OfflineBanner` was moved
onto the warning tokens in this pass and is strict.

## Validation in this pass

Run locally on 2026-10-06 with Node v24.20.0 (the repository pins 22.23.1 in `.node-version`):

- `npx tsc --noEmit -p .` passed.
- `npx vitest run --reporter=dot --maxWorkers=4`: 162 files, 3,987 tests passed, none failed or skipped
  (after the second round of review fixes; earlier runs in this pass saw 3,983 and 3,986).
- Each guard changed in this pass was shown to fail on a planted defect, and each source file was
  restored exactly afterward.

Not run in this pass: the Playwright suites, a production build, the repository-wide format check, and any
real PocketBase, provider or deployment check. Local unit and browser tests stub the backend and prove
nothing about paid-provider generation, third-party accounts, production migrations or a live deployment.

## CI status

GitHub Actions CI has not run on this branch. `.github/workflows/ci.yml` runs on pull requests into `main`,
pushes to `main` and manual dispatch, and PR #40 for this branch targets the stacked base
`codex/post-revision-api`. On 2026-10-06 the pushed head of PR #40 (`0bde845`) showed only the Socket
Security and Vercel preview checks, both passing. The 29 local commits after it, and this pass's
uncommitted changes, are not pushed. No production deployment was made.

## Screenshots

These were captured on 2026-10-01 (commit `5b6418c`), before the Post screen rebuild and the settings and
admin redesign, so they do not show the current screens:

- [Home at 1440 pixels](streamlined-flow/home-desktop.png)
- [Dealer instructions at 1440 pixels](streamlined-flow/dealer-instructions-desktop.png)
- [Sunlight Post at 320 pixels](streamlined-flow/post-sunlight-phone.png)
- [Post in Sunlight](streamlined-flow/post-sunlight-desktop.png)
- [Post in dark mode](streamlined-flow/post-dark-desktop.png)
- [Compact dealership settings at 320 pixels](streamlined-flow/dealer-settings-phone.png)
