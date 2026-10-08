# Production backups and coordinated release

This runbook keeps the single-writer PocketBase database recoverable and prevents a Vercel frontend from reaching the production domain before its matching Fly backend is ready.

Local version files, GitHub Actions, npm, and Docker pin Node `22.23.1` (npm `10.9.8`). Vercel exposes Node only at the major-version level, so `package.json` constrains builds to Node 22 and Vercel applies its current Node 22 patch automatically. PocketBase remains pinned to `0.22.55`.

## One-time private R2 setup

Create a private Cloudflare R2 bucket dedicated to PocketBase backups. Create S3-compatible credentials scoped to only that bucket with object list, read, write, and delete permissions. Do not reuse a broad Cloudflare API token and do not expose either credential to Vite. PocketBase full backups include `data.db` and locally stored uploads under `pb_data`; Fly volume snapshots remain defense in depth, not a substitute for the off-box copy.

Create a protected GitHub environment named `production-backup` with:

- Variable `POCKETBASE_R2_BACKUPS_ENABLED=true`.
- Variable `POCKETBASE_BACKUP_URL=https://dealer-social-post-ai-production.fly.dev`.
- Variable `R2_BACKUP_PREFIX=dealer-social-post-ai/pocketbase`.
- Variable `VITE_TURNSTILE_SITE_KEY` set to the same real public sitekey used by the protected `production` environment. The workflow compares hashes before deployment so the restore-tested image and runtime cannot drift.
- Secrets `POCKETBASE_ADMIN_EMAIL` and `POCKETBASE_ADMIN_PASSWORD` for the PocketBase backup API.
- Secrets `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` for the bucket-scoped R2 credentials.
- Secret `FLY_API_TOKEN`, scoped to the production app, for source attestation and restore-evidence refresh.

Each backup manifest is bound to the exact production origin, source release, restore-target release, source identity, running Fly image digest, tooling commit, archive checksum, and size. Health SHA and authenticated Fly image labels must agree. The workflow downloads the immutable object key returned by that backup operation; it never authorizes a release from a movable `latest.json` pointer. Thirty R2 archives are retained. Before creating a PocketBase archive, the tool removes only older files in its exact `dspai_tool_…` namespace; after a download or upload failure it preserves at most the current tool-owned archive for emergency recovery and never deletes manual, legacy, or otherwise unrecognized backup names.

Fly mounts an ext filesystem root at `/pb/pb_data`; a new volume can therefore contain a root-only `lost+found` directory that PocketBase's unprivileged backup walk cannot read. Both protected workflows run `scripts/prepare-fly-backup-volume.sh` before creating an archive. The preflight refuses links, changes only that filesystem metadata directory to `root:pbuser` mode `0750`, and proves `pbuser` can traverse it. It never recursively changes application-data ownership or permissions.

Nightly drills refresh the release-bound backup timestamp/SHA through Fly secrets. The deploy workflow stages the candidate release SHA, sitekey, allowed hostnames, timestamp/SHA evidence, and mutable Turnstile/legacy flags through that same secret mechanism before deploying; it does not rely on lower-precedence `--env` values that an older Fly secret could override.

### First v2 source-identity bootstrap

The currently deployed v1 health payload has no `releaseSha`. For the first v2 release only, the workflow may attest the running commit from the authenticated Fly machine response. It requires all started machines to agree on one `image_ref.labels.GH_SHA`, repository label, and sha256 image digest.

Open a window of no more than 24 hours immediately before the first release:

```bash
BOOTSTRAP_EXPIRES_AT="$(node -e 'process.stdout.write(new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString())')"
gh variable set ALLOW_FLY_IMAGE_IDENTITY_BOOTSTRAP --env production-backup --body true
gh variable set FLY_IMAGE_IDENTITY_BOOTSTRAP_EXPIRES_AT --env production-backup --body "$BOOTSTRAP_EXPIRES_AT"
unset BOOTSTRAP_EXPIRES_AT
```

The resolver refuses an expired window, a window longer than 24 hours, malformed/mixed image identities, or a different repository. As soon as v2 health reports the exact SHA, remove the exception:

```bash
gh variable set ALLOW_FLY_IMAGE_IDENTITY_BOOTSTRAP --env production-backup --body false
gh variable delete FLY_IMAGE_IDENTITY_BOOTSTRAP_EXPIRES_AT --env production-backup
```

The first candidate Fly gate uses the new tooling to back up the v1 production source and boot that data with the exact v2 candidate image. This is the bootstrap restore drill; do not require the nightly workflow to exist in the old release. After v2 is running, scheduled drills target the reported running SHA even when `main` is ahead. Manual drills target the checked-out commit and refresh runtime evidence only when source and target are identical.

The CI restore canary uploads the bundled synthetic `public/icon-192.png` as a dealer logo before taking the backup, then proves the database reference, storage-object hash, and PocketBase-served file all survive restoration. A production drill enumerates every non-empty known file reference (`dealers.logo`, `photo_releases.signature_png`, and `posts.creative_image`), including array-form values, and verifies the restored volume object. Public logos are also fetched through PocketBase. Customer uploads are never copied into release artifacts or logs.

## Turnstile and trusted Vercel proxy

Create a managed Cloudflare Turnstile widget for the production Vercel hostname and `dealer-social-post-ai-production.fly.dev`. Cloudflare can add `localhost` and `127.0.0.1` to the widget for local development, but the production backend allowlist must contain only `dealer-social-post-ai.vercel.app,dealer-social-post-ai-production.fly.dev`; Fly strips local hosts defensively. The widget action is `turnstile-spin-v2`. Store `TURNSTILE_SECRET` only as a Fly secret. Configure the public site key in both protected GitHub environments and Vercel production as `VITE_TURNSTILE_SITE_KEY`; configure the same public key on Fly as `TURNSTILE_SITE_KEY` through the deployment workflow. Every official Cloudflare test sitekey and secret—including always-pass, always-fail, invisible, and forced-interaction variants—is CI/local-only and rejected by Fly deployment and readiness.

Create a random 32+ character proxy credential without printing it, then install the identical value on Fly and Vercel. It is not a `VITE_` variable and is injected only into Vercel's server-side `/api` transform in `vercel.ts`.

```bash
set +x
PROXY_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
printf 'VERCEL_TO_FLY_PROXY_SECRET=%s\n' "$PROXY_SECRET" |
  flyctl secrets import --app dealer-social-post-ai-production
printf '%s' "$PROXY_SECRET" | npx vercel@58.4.4 env add VERCEL_TO_FLY_PROXY_SECRET production --sensitive --force --yes
unset PROXY_SECRET
```

Before the backend-first release, set these GitHub `production` environment variables:

- `VITE_TURNSTILE_SITE_KEY` to the real public site key.
- `TURNSTILE_ALLOWED_HOSTNAMES` to `dealer-social-post-ai.vercel.app,dealer-social-post-ai-production.fly.dev` (production hosts only).
- `TURNSTILE_ENFORCEMENT_ENABLED=false` for the compatibility phase.
- `LEGACY_CLIENT_COMPATIBILITY_ENABLED=true` for exactly one backend-first release.

Store `FLY_API_TOKEN` in that environment. Install `ADMIN_LOGIN_USERNAME`, `ADMIN_LOGIN_PASSWORD`, `SALESPERSON_PIN_PEPPER` (32+ random chars, e.g. `openssl rand -hex 24`; peppers the one-way salesperson access-code hashes — rotating it invalidates every stored code), `GEMINI_API_KEY`, `TURNSTILE_SECRET`, `VERCEL_TO_FLY_PROXY_SECRET`, `CUSTOMER_HUB_URL`, `CUSTOMER_HUB_SECRET`, `CUSTOMER_HUB_DESTINATION_ID`, and `CUSTOMER_HUB_DEALER_ID` as Fly secrets. The deploy workflow checks that all ten secret names exist; backend readiness proves the proxy credential has a safe length, verifies that the private Customer Hub destination is configured, and refuses every published Turnstile test credential even while enforcement is temporarily disabled.

## Administrator credential rotation

The system-administrator account is provisioned and rotated at boot from the `ADMIN_LOGIN_USERNAME` and `ADMIN_LOGIN_PASSWORD` Fly secrets. Keep the password only in a password manager or Keychain and Fly (8–128 characters). Never persist it in a dealer record, repository, command log, or release evidence. Rotating `ADMIN_LOGIN_PASSWORD` changes the account's token key, which invalidates outstanding admin sessions on its own; deleting existing super-admin and impersonation rows as well makes revocation immediate rather than lazy.

```bash
set +x
read -r -s -p "New admin password (8-128 chars): " NEW_ADMIN_PASSWORD
printf '\n'
printf '%s=%s\n' ADMIN_LOGIN_PASSWORD "$NEW_ADMIN_PASSWORD" |
  flyctl secrets import --app dealer-social-post-ai-production
flyctl ssh console --app dealer-social-post-ai-production --command \
  'sqlite3 /pb/pb_data/data.db "DELETE FROM sessions WHERE role = '\''super_admin'\'' OR is_impersonation = 1;"'
unset NEW_ADMIN_PASSWORD
```

## Automatic production release

A merge to `main` releases both origins without anyone running a command. CI
must pass, then the `Deploy production` workflow runs `backup-gate` → `deploy`
(Fly backend) → `release-frontend` (Vercel). Each job independently refuses a
superseded `main`.

`release-frontend` runs after `deploy`, never beside it, because the frontend
rewrites `/api/*` to Fly: the backend has to serve the release before the client
that calls it becomes reachable. The job pulls the production environment,
refuses a Cloudflare test sitekey, builds with `VITE_RELEASE_SHA`, and refuses a
bundle that is not stamped with its own SHA. It deploys with `--skip-domain`,
verifies the immutable deployment, and only then moves traffic.

The backend-first workflow cannot safely introduce a newly required client
request field in one release. Split a revision contract into three compatible
stages: (1) release an additive backend that returns every new revision token
but does not require it, (2) release and verify the frontend that preserves and
sends those tokens, and (3) release the strict backend enforcement. The
`expected_post_revision` contract also needs the additive photo-release link
receipt before the frontend stage, because attaching consent advances the post
revision. A pull request that combines the strict backend and first frontend
sender must remain blocked from `main` until it is split into those stages. Do
not leave the field optional in the final backend; doing so silently removes
the compare-and-set guarantee.

### The post-revision contract, stage by stage

| Stage | What ships                                                                                                                                            | Works with                   |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| A     | Backend returns a revision from every write and checks one when it is sent. A draft save without one still works and logs `[revision-legacy-client]`. | any frontend                 |
| B     | Frontend sends the revision it last saw with every draft save and share receipt.                                                                      | backend at stage A or later  |
| C     | Backend rejects a draft save or share receipt that carries no revision (`409`).                                                                       | frontend at stage B or later |

Stages A and B may ship in the same `main` commit: the backend deploys first and
still accepts the older client. Stage C must ship alone, later, and only through
this gate. All three conditions must hold:

1. Stage B's `release-frontend` job is green and the canonical alias serves that
   build.
2. Production health's `revisionCompatibility.ready` is true. Both legacy
   draft saves and share receipts persist an observation before being accepted.
   Seven full days must pass without either route receiving a missing revision.
   Every server restart resets this conservative window, including deployments,
   restores and rollbacks: time on an uninstrumented backend never counts.
3. The stage C change is the only change in its `main` commit and merges after
   stage B's whole pipeline has finished.

Until the gate is met, stage A's compatibility stays. It costs nothing for
current clients, which always send a revision; it only keeps an older installed
app able to save.

The **Observe revision compatibility** workflow runs daily at 14:17 UTC and
can be dispatched manually. Its 30-day artifact records the healthy release
SHA, continuous observation start, clear-since time and earliest stage C review.
It reads durable aggregate state through public health; it does not rely on
Fly's short-lived log buffer. No post, person, caption or raw log is exposed.
Missing or invalid observation state fails the check. `observing` is a healthy
monitor result, not permission to ship stage C. Review a
`ready-for-stage-c-review` artifact and the complete stage B deployment before
merging stage C separately. This workflow never merges or deploys the strict
stage automatically. Remove its schedule after stage C is verified live.

Rolling back across these stages has its own order. See
[the post-revision contract in the rollback runbook](runbooks/rollback.md#2a-the-post-revision-contract-stages-a-b-c).

Two things must be true before it reports success, and both are asserted:

- `dealer-social-post-ai.vercel.app` resolves to the deployment just created.
  `vercel promote` is not sufficient on its own — this project has
  `autoAssignCustomDomains` disabled, so promote attaches only the
  `*-joes-projects-*.vercel.app` aliases and leaves the canonical host on the
  previous deployment. The workflow calls `vercel alias set` explicitly. The
  check reads the alias → deployment mapping from the Vercel API, because
  `vercel inspect` omits the canonical host from a deployment's own alias list
  even when that host resolves to it.
- The origin users load actually serves this build. `scripts/vercel-live-bundle-assert.mjs`
  fetches the live shell, walks the module graph to the `geminiService-*.js`
  chunk, and byte-compares every chunk it reaches against the artifact built for
  the deployed SHA. This is what catches a deploy that reports success while the
  alias still serves an old bundle. Run it by hand at any time:

  ```bash
  npm run release:vercel:assert-live -- https://dealer-social-post-ai.vercel.app .vercel/output/static "$(git rev-parse HEAD)"
  ```

Why this is a lighter gate than the ceremony below: the staged path cannot run
unattended. Its provider canary needs `RELEASE_CANARY_PERSON_PIN` — a real
production salesperson PIN — plus paid caption, image, and video generation on
every merge, and its promotion step requires a human browser-QA receipt. Putting
that PIN in CI secrets and auto-issuing the QA receipt would keep the appearance
of those gates while removing their substance. The automated job instead asserts
the properties a machine can actually prove: correct release binding, a healthy
backend on the same SHA, security headers, a verified immutable deployment, and
a canonical alias that demonstrably serves the new bytes.

Use the staged ceremony below — not this job — for releases that change provider
prompts, media pipelines, pricing or compliance logic, or anything else that
needs a human to look at generated output before customers do.

## Required gates and staged promotion

1. Select one commit SHA. Require secret scan, model-policy and Vercel-config drift checks, scoped format check, three consecutive Vitest passes, typecheck, build, full dependency audit, Chromium/WebKit browser tests, dirty-upgrade smoke, deterministic provider-boundary canaries, the private website-handoff contract canary, and the local backup/restore canary.
2. Open the time-limited Fly image bootstrap only for the first v2 release. Let the successful current-`main` CI run trigger the coordinated Fly workflow. Stale `workflow_run` SHAs are rejected twice. The workflow builds and labels one candidate image, pushes it to Fly's private registry, pins its digest, restores the production backup into that exact digest, and deploys the same digest without rebuilding. Readiness confirms every started machine reports that digest, repository, and SHA.
3. Provision a dedicated active synthetic salesperson in a non-customer canary dealership and retain its PIN only in the release secret store. Confirm direct Fly health reports the candidate `releaseSha`, `backup.status: "verified"`, trusted proxy readiness, API/model-policy versions, and `ok: true`. Run the authenticated caption, standard-image, standard-video (vertical 720p, 6-second), and quality-video (landscape 1080p, 8-second) canaries below. They are pinned to the exact production Fly origin, use only `public/icon-512.png`, revoke the least-privilege session, and write redacted evidence without captions, provider payloads, media, operation names, file URIs, or credentials. The image check decodes the provider result and requires actual 4:5 pixels. The release workstation must have `ffprobe` from FFmpeg available (or set `RELEASE_CANARY_FFPROBE` to its executable); both video checks block promotion unless they verify the exact dimensions and duration, H.264 video, a present AAC audio stream, compatible pixel format, and readable video and audio packets.

   ```bash
   set +x
   read -r -s -p "Dedicated synthetic salesperson PIN: " RELEASE_CANARY_PERSON_PIN
   printf '\n'
   export RELEASE_CANARY_PERSON_PIN
   export RELEASE_CANARY_BASE_URL=https://dealer-social-post-ai-production.fly.dev
   export RELEASE_CANARY_EXPECTED_SHA="$(git rev-parse HEAD)"
   export RELEASE_CANARY_CONFIRM=caption-image-video-synthetic-only
   export RELEASE_CANARY_EVIDENCE_PATH="$PWD/.release-evidence/production-provider-canary.json"
   npm run release:provider-canary
   unset RELEASE_CANARY_PERSON_PIN RELEASE_CANARY_BASE_URL \
     RELEASE_CANARY_EXPECTED_SHA RELEASE_CANARY_CONFIRM \
     RELEASE_CANARY_EVIDENCE_PATH
   ```

   Review and archive the redacted JSON evidence with the release record. Starting a canary atomically replaces any older pass with a non-authorizing `running` receipt. Both staging and promotion refuse a missing, failed, mismatched, or more-than-six-hours-old receipt, and require every authentication, health, caption, standard-image, standard-video, quality-video, and session-revocation check to pass for the exact Fly SHA. A failed canary exits nonzero and records only a stable failure code, safe message, and HTTP status when applicable. Never run it with customer media or place the PIN on the command line. Rotate the dedicated PIN after any suspected exposure; never substitute the system-admin secret.

4. Run the authenticated private website-handoff canary against that exact Fly SHA. Use only the checked-in synthetic delivery image and the dedicated `Release Canary` salesperson in the approval-free Customer Hub-enabled canary dealership. The canary first saves a website-only post and proves it stays `not_requested` across a worker boundary. Only its explicit final Send may enqueue the edited draft. It then proves the missing/stale revision blocks, exact replay idempotency, changed-replay block, clean zero-attempt private delivery, public image `404`, absent public marker, and session revocation.

   ```bash
   set +x
   read -r -s -p "Dedicated Release Canary salesperson PIN: " RELEASE_CANARY_PERSON_PIN
   printf '\n'
   export RELEASE_CANARY_PERSON_PIN
   export RELEASE_CANARY_BASE_URL=https://dealer-social-post-ai-production.fly.dev
   export RELEASE_CANARY_EXPECTED_SHA="$(git rev-parse HEAD)"
   export WEBSITE_HANDOFF_CANARY_CONFIRM=website-private-draft-synthetic-only
   npm run release:website-handoff-canary
   unset WEBSITE_HANDOFF_CANARY_CONFIRM
   ```

   The command records a private `reviewUrl` and synthetic marker in `.release-evidence/production-website-handoff-canary.json`; it never publishes the draft. Open that exact `reviewUrl` while signed in to Customer Hub Studio, confirm the marker belongs to this release canary, archive it, and permanently purge that exact synthetic draft. Keep the Dealer Social synthetic post private as release audit evidence. After the Studio purge succeeds, explicitly complete the cleanup receipt:

   ```bash
   export WEBSITE_HANDOFF_CANARY_CLEANUP_CONFIRM=private-synthetic-draft-purged
   npm run release:website-handoff-canary:confirm-cleanup
   unset WEBSITE_HANDOFF_CANARY_CLEANUP_CONFIRM RELEASE_CANARY_PERSON_PIN \
     RELEASE_CANARY_BASE_URL RELEASE_CANARY_EXPECTED_SHA
   ```

   Starting the canary replaces any older pass with a non-authorizing receipt. Both Vercel staging and promotion require the canonical receipt for the exact Fly SHA, completed no more than six hours earlier, with every private-delivery check passed and owner cleanup recorded as `required: false` and `status: "complete"`. A passed canary awaiting Studio cleanup cannot authorize a release. Never use customer media, publish the synthetic draft, or substitute an administrator credential.

5. Build the same SHA for Vercel. Main-branch production-domain auto-assignment is disabled in `vercel.ts`; branch previews remain available. The staging command refuses a dirty worktree, a stale `main`, a local `HEAD` that differs from Fly health, or any frontend output that does not contain the exact release SHA used by client telemetry.
6. Stage the production-configured artifact without assigning the production domain. The script captures the canonical deployment URL and immutable Vercel deployment ID in a permission-restricted, gitignored `.release-evidence/vercel-staged-release.json` receipt. This directory is separate from Playwright's disposable `test-results` output. Staging invalidates any earlier browser-QA receipt and rechecks same-origin health, proxy readiness, security headers, PWA assets, service-worker release binding, and the frontend bundle's exact SHA:

   ```bash
   RELEASE_SHA="$(git rev-parse HEAD)"
   npm run release:vercel:stage -- "$RELEASE_SHA"
   unset RELEASE_SHA
   ```

   The provider canary, private website-handoff canary, owner cleanup confirmation, staging, hosted QA, and promotion share one atomic owner-bearing lock so they cannot overlap. An interrupted process deliberately leaves that lock in place instead of guessing that it is stale; remove `.release-evidence/vercel-release.lock` only after directly confirming that no release command is still running.

7. Run the hosted-artifact browser gate against the exact staged URL. The gate is deliberately non-mutating: it never submits an invalid code, creates production data, or depends on source-only TypeScript modules that are absent from a production Vite build. It verifies the exact frontend SHA, same-origin health and proxy readiness, security headers, PWA metadata/icons/service worker, case-preserving masked admin entry, serious accessibility issues, horizontal overflow, Dynamic Island safe areas, and the complete Chromium/WebKit viewport matrix. The full stubbed UI, sharing, login-recovery, and real-PocketBase workflows already ran in CI before Fly deployment.

   ```bash
   npm run release:vercel:qa
   ```

   A pass writes `.release-evidence/vercel-staged-qa.json`, bound to the exact SHA, deployment URL, immutable deployment ID, spec, and project matrix. Once browser QA is ready to start, a failed or interrupted run cannot leave an older pass receipt behind. Promote only that evidence-bound deployment, without rebuilding. The promotion command requires both the QA receipt and the explicit operator confirmation, then repeats clean/current-main, direct-Fly, staged-URL, frontend/PWA, release-SHA, proxy, and backup-readiness checks. It marks the receipt promoted only after the stable domain resolves to the same immutable deployment ID and passes those checks:

   ```bash
   export VERCEL_RELEASE_QA_CONFIRM=staged-browser-qa-passed
   npm run release:vercel:promote
   unset VERCEL_RELEASE_QA_CONFIRM
   ```

## Post-promotion security cutover

Keep a pre-rotation admin session cookie in a permission-restricted temporary cookie jar and retain the outgoing admin password only in a protected shell variable. Choose a new 8–128 character password, validate it without printing, then enable Turnstile and turn off the compatibility bridge in one Fly restart. Mirror the two flags in GitHub for later deploys.

```bash
set +x
read -r -s -p "Final admin password (8-128 chars): " FINAL_ADMIN_PASSWORD
printf '\n'
[[ "${#FINAL_ADMIN_PASSWORD}" -ge 8 && "${#FINAL_ADMIN_PASSWORD}" -le 128 ]]

gh variable set TURNSTILE_ENFORCEMENT_ENABLED --env production --body true
gh variable set LEGACY_CLIENT_COMPATIBILITY_ENABLED --env production --body false
{
  printf 'TURNSTILE_ENFORCEMENT_ENABLED=true\n'
  printf 'LEGACY_CLIENT_COMPATIBILITY_ENABLED=false\n'
  printf '%s=%s\n' ADMIN_LOGIN_PASSWORD "$FINAL_ADMIN_PASSWORD"
} | flyctl secrets import --app dealer-social-post-ai-production
flyctl ssh console --app dealer-social-post-ai-production --command \
  'sqlite3 /pb/pb_data/data.db "DELETE FROM sessions WHERE role = '\''super_admin'\'' OR is_impersonation = 1 OR admin_secret_fingerprint != '\'''\'';"'
unset FINAL_ADMIN_PASSWORD
```

Prove all of the following before declaring the release complete:

- The previous admin password returns HTTP 401 while the new password succeeds with exact case and fails with altered case.
- The saved pre-rotation admin cookie and every impersonation cookie return HTTP 401 and are cleared.
- Three known-invalid synthetic codes remain frictionless; the fourth returns `CHALLENGE_REQUIRED`, renders the managed widget, and succeeds only with hostname/action/token validation. Invalid token, wrong hostname/action, and verifier outage are not mislabeled as a bad PIN.
- An authenticated health response shows Turnstile enforcement enabled, the secret/site key set, trusted proxy configured, legacy compatibility disabled, current contract/policy versions, verified backup state, and no unexpected provider fallback spike.

Failed sign-ins share a 15-minute IP risk bucket. Do not combine the previous-secret/exact-case proof and the three-frictionless-attempt Turnstile proof from the same fresh IP window: use separate clean egress IPs or wait the full window between groups. Wrong-hostname, wrong-action, verifier-outage, and ten-failure lockout negative tests belong in the isolated PocketBase environment; never deliberately break the production verifier secret.

Clear the admin password from your shell after proof and securely delete the temporary cookie jar. Remove the first-release Fly image bootstrap variables as soon as v2 reports its SHA.

## Monitoring and rollback

Monitor health, recent redacted client-error aggregates, generation fallback rate, and Fly/Vercel logs for at least 30 minutes.

- Frontend: promote only a recorded Vercel deployment built from the authentication-hardening release or later. A pre-hardening client uppercases administrator input and is not a valid rollback target after mixed-case rotation.
- Backend: deploy only a recorded, restore-tested image digest from the authentication-hardening release or later, and only when its database contract is compatible with the migrated database. Never roll back to code that accepts administrator secrets case-insensitively, persists them in dealer records, or lacks continuous session validation. Disable Turnstile enforcement first only when its validated production challenge path is the incident source.
- Database: never attach a raw pre-release archive to a public Machine. Restore it under the recorded hardened image digest in an isolated disposable environment, allow all forward migrations to finish, stop PocketBase, and scrub legacy authority offline before any production cutover:

  ```bash
  set -euo pipefail
  : "${RECOVERY_DB:?path to the isolated restored data.db is required}"
  sqlite3 "$RECOVERY_DB" <<'SQL'
  BEGIN IMMEDIATE;
  UPDATE dealers SET code = '', admin_code = '';
  DELETE FROM sessions;
  COMMIT;
  SQL
  test "$(sqlite3 "$RECOVERY_DB" "SELECT COUNT(*) FROM sessions;")" = "0"
  test "$(sqlite3 "$RECOVERY_DB" "SELECT COUNT(*) FROM dealers WHERE code != '' OR admin_code != '';")" = "0"
  sqlite3 "$RECOVERY_DB" "PRAGMA table_info(sessions);" | grep --quiet admin_secret_fingerprint
  sqlite3 "$RECOVERY_DB" "PRAGMA quick_check;" | grep --quiet '^ok$'
  unset RECOVERY_DB
  ```

  Boot that scrubbed copy only with the current `ADMIN_LOGIN_USERNAME` / `ADMIN_LOGIN_PASSWORD` supplied from Fly secrets, rerun the exact-case and prior-session rejection proofs, then take and verify a new sanitized archive before switching the production volume. Never restore a rotated credential or a pre-hardening session row.

Record the authentication-hardening minimum SHA, Fly release/image digest, compatible Vercel deployment URL, immutable backup object manifest, restore-drill run, canary results, cutover evidence, and rollback targets together. A local backup canary proves tooling; only the source-bound off-box workflow proves production recovery.

## Temporary bridge flags — verify and retire

Two flags were introduced as one-release bridges and must not outlive their purpose. Their
production values live in GitHub environment variables / Fly secrets, so the repository cannot
prove they were retired — verify them directly:

```bash
gh variable list --env production | grep -E 'LEGACY_CLIENT_COMPATIBILITY_ENABLED|ALLOW_FLY_IMAGE_IDENTITY_BOOTSTRAP'
```

- `LEGACY_CLIENT_COMPATIBILITY_ENABLED` — set `true` only for the single backend-first
  compatibility release; production must be `false` now. If it still reads `true`, run
  `gh variable set LEGACY_CLIENT_COMPATIBILITY_ENABLED --env production --body false` and
  redeploy.
- `ALLOW_FLY_IMAGE_IDENTITY_BOOTSTRAP` (+ `FLY_IMAGE_IDENTITY_BOOTSTRAP_EXPIRES_AT`) — a
  first-release escape hatch that weakens backup provenance (attests against a Fly image digest
  instead of a release SHA). Remove both variables as soon as v2 reports its SHA in
  `/api/app/health`.

Once both are verified `false`/absent in production, delete the flags from `.env.example`, CI,
and the workflows in a follow-up release.
