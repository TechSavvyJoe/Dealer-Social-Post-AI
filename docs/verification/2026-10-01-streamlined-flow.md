# Streamlined posting and dealership setup

## Scope and recovered baseline

Resumed the approved Light Table work from main `c6e6a50`. The login/theme work and extraction were already merged. The parked privacy-guard worktrees were left untouched. The checked-in design kit is commit `746806e` on `codex/streamlined-posting-flow`.

The application now uses Home → Details → Creating → Post, plus a full My Work page. A category starts photo intake directly. Details carries the exact in-memory release object through cancellation/retry; signatures and the optional personal line are excluded from browser persistence. Existing approval, identity, image-review and release gates remain in the creation/delivery path.

## Management boundaries

- System admin: Dealers, Admins, Users and Connections. The new backend endpoint reports safe configuration flags for Gemini, optional text fallbacks, Customer Hub and walkaround services. Setup instructions expose environment variable names, never secret values. Configured does not claim a live provider transaction passed.
- Dealership manager: Store profile, Channels, Voice, Creative and Workflow, backed by the existing dealer fields and save endpoint. Advanced workflow controls cover approval policy, team features and destinations by post category. Website status and retry are dealership scoped. The setup wizard has navigable steps and actual completion state.
- Personal Settings: appearance and image-quality preferences, with a guarded route to dealership setup for managers.

## Reliability changes

Backend startup verifies the pinned PocketBase 0.22.55 download before replacing the binary. Development startup waits for the backend route with bounded requests and propagates child-process failure. New connection diagnostics are super-admin only and no-store.

Draft saves and share receipts use the observed post revision. Stale editors receive a conflict instead of overwriting another tab. Consent-link writes return the new revision. Draft autosave persists successful revisions for reload, and delivery waits for a successful save. Share receipts remain distinct from the post record so sharing cannot invalidate website revision checks. A completed native share sheet is described as a handoff, not proof of social publication.

## Visual review ledger

Compared the attached artboards 09–14 with actual Chromium screenshots at 390 and 1440 CSS pixels:

| Anchor                                              | Implementation                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Graphite canvas, Barlow hierarchy and dealer accent | Shared Light Table tokens; Sunlight remains usable on Post                                  |
| Home category grid                                  | Six photographic category tiles, direct camera/library intake and guarded My Work shortcuts |
| Details photo and compact controls                  | Large original photo, one customer signature sheet, optional VIN/personal line              |
| Post preview and direct action                      | Author/context card, protected disclosure, editable caption, destination and Look controls  |
| Progressive disclosure                              | Manager sections and advanced controls keep the common setup path focused                   |

The premium automotive studio treatment uses local category photography, dealership accents, layered surfaces, aligned destination controls, one style selector and natural photo proportions. Mobile management uses compact section navigation so its first setting remains visible. The six generated category illustrations total about 284 KB and are never used as customer records. Screenshots use synthetic marketing imagery and a fictional QA dealership.

- [Home at 1440 pixels](streamlined-flow/home-desktop.png)
- [Dealer instructions at 1440 pixels](streamlined-flow/dealer-instructions-desktop.png)
- [Sunlight Post with sharing ready at 320 pixels](streamlined-flow/post-sunlight-phone.png)
- [Post studio in Sunlight](streamlined-flow/post-sunlight-desktop.png)
- [Post studio in dark mode](streamlined-flow/post-dark-desktop.png)
- [Compact dealership settings at 320 pixels](streamlined-flow/dealer-settings-phone.png)

## Validation

Validated with Node 22.23.1:

- Full Vitest regression: 133 files, 3,355 tests passed. Later caption idempotence and UI refinements received targeted checks; release-stage results are recorded in the pull requests.
- Final browser journeys: 40 cases passed across Chromium and WebKit at 320, 390, 768, 844 landscape and 1440 pixels. These include dark/Sunlight Post previews, overflow and serious/critical accessibility checks.
- Existing flow/PWA coverage: 12 cases passed, 6 expected platform-specific skips.
- TypeScript, production build, formatting, model policy, Vercel configuration and secret scanning passed.
- A disposable PocketBase 0.22.55 database applied migrations and passed real post creation, consent linking, matching draft updates and share receipts. Stale draft updates and stale share receipts returned their expected 409 conflicts. No paid provider calls were made; health correctly reported 503 without a Gemini key.
- The compatible API stage independently passed 474 focused tests and real PocketBase probes for legacy absent-token requests, matching tokens, stale tokens and malformed supplied tokens.

Local UI browser checks stub backend traffic; they do not prove paid-provider generation, third-party account connection, production migration or live deployment. The disposable PocketBase probe did not alter existing local or production data.

Release as three separately verified main SHAs: (A) compatible backend revision responses and checks, (B) frontend revision senders and redesign, (C) strict rejection of missing revisions. A accepts an absent field from the previous client while still rejecting supplied invalid/stale tokens and comparing the captured revision inside the transaction. Before C, verify the canonical frontend and the update/reload path for existing tabs. Merging all stages together would defeat this compatibility step because production deploys the backend first. Production release remains subject to the repository's restore, provider, website-handoff and staged-browser gates, including canonical-alias verification. No production deployment was performed during this implementation.
