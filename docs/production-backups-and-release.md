# Production backups and coordinated release

This runbook keeps the single-writer PocketBase database recoverable and prevents a Vercel frontend from reaching the production domain before its matching Fly backend is ready.

Local version files, GitHub Actions, npm, and Docker pin Node `22.23.1` (npm `10.9.8`). Vercel exposes Node only at the major-version level, so `package.json` constrains builds to Node 22 and Vercel applies its current Node 22 patch automatically. PocketBase remains pinned to `0.22.37`.

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

Create a managed Cloudflare Turnstile widget for `localhost`, `127.0.0.1`, the production Vercel hostname, and `dealer-social-post-ai-production.fly.dev`. The widget action is `turnstile-spin-v2`. Store `TURNSTILE_SECRET` only as a Fly secret. Configure the public site key in both protected GitHub environments and Vercel production as `VITE_TURNSTILE_SITE_KEY`; configure the same public key on Fly as `TURNSTILE_SITE_KEY` through the deployment workflow. Every official Cloudflare test sitekey and secret—including always-pass, always-fail, invisible, and forced-interaction variants—is CI/local-only and rejected by Fly deployment and readiness.

Create a random 32+ character proxy credential without printing it, then install the identical value on Fly and Vercel. It is not a `VITE_` variable and is injected only into Vercel's server-side `/api` transform in `vercel.ts`.

```bash
set +x
PROXY_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
flyctl secrets set --app dealer-social-post-ai-production "VERCEL_TO_FLY_PROXY_SECRET=$PROXY_SECRET"
printf '%s' "$PROXY_SECRET" | npx vercel@58.1.0 env add VERCEL_TO_FLY_PROXY_SECRET production --sensitive --force --yes
unset PROXY_SECRET
```

Before the backend-first release, set these GitHub `production` environment variables:

- `VITE_TURNSTILE_SITE_KEY` to the real public site key.
- `TURNSTILE_ALLOWED_HOSTNAMES` to the exact comma-separated widget hosts.
- `TURNSTILE_ENFORCEMENT_ENABLED=false` for the compatibility phase.
- `LEGACY_CLIENT_COMPATIBILITY_ENABLED=true` for exactly one backend-first release.

Store `FLY_API_TOKEN` in that environment. Install `TURNSTILE_SECRET`, `ADMIN_DEALER_CODE`, `GEMINI_API_KEY`, and `VERCEL_TO_FLY_PROXY_SECRET` as Fly secrets. The deploy workflow checks that all four secret names exist; backend readiness proves the proxy credential has a safe length and refuses every published Turnstile test credential even while enforcement is temporarily disabled.

## Two-phase administrator credential

The old frontend uppercases its admin input, so the backend-first phase needs a temporary 12-character uppercase/digit secret. Keep it only in a password manager or Keychain and Fly. Never persist it in a dealer record, repository, command log, or release evidence. Rotating `ADMIN_DEALER_CODE` invalidates its one-way session fingerprints; also delete existing super-admin and impersonation rows so revocation is immediate rather than lazy.

```bash
set +x
TEMP_ADMIN_CODE="$(openssl rand -hex 6 | tr 'a-f' 'A-F')"
flyctl secrets set --app dealer-social-post-ai-production "ADMIN_DEALER_CODE=$TEMP_ADMIN_CODE"
flyctl ssh console --app dealer-social-post-ai-production --command \
  'sqlite3 /pb/pb_data/data.db "DELETE FROM sessions WHERE role = '\''super_admin'\'' OR is_impersonation = 1;"'
# Store TEMP_ADMIN_CODE securely for the cutover proof; do not echo it.
```

## Required gates and staged promotion

1. Select one commit SHA. Require secret scan, model-policy and Vercel-config drift checks, scoped format check, three consecutive Vitest passes, typecheck, build, full dependency audit, Chromium/WebKit browser tests, dirty-upgrade smoke, deterministic provider-boundary canaries, and the local backup/restore canary.
2. Open the time-limited Fly image bootstrap only for the first v2 release. Let the successful current-`main` CI run trigger the coordinated Fly workflow. Stale `workflow_run` SHAs are rejected twice. The workflow builds and labels one candidate image, pushes it to Fly's private registry, pins its digest, restores the production backup into that exact digest, and deploys the same digest without rebuilding. Readiness confirms every started machine reports that digest, repository, and SHA.
3. Provision a dedicated active synthetic salesperson in a non-customer canary dealership and retain its PIN only in the release secret store. Confirm direct Fly health reports the candidate `releaseSha`, `backup.status: "verified"`, trusted proxy readiness, API/model-policy versions, and `ok: true`. Run the authenticated caption, standard-image, and standard-video canary below. It is pinned to the exact production Fly origin, uses only `public/icon-512.png`, revokes its least-privilege session, and writes redacted evidence without captions, provider payloads, media, operation names, file URIs, or credentials.

   ```bash
   set +x
   read -r -s -p "Dedicated synthetic salesperson PIN: " RELEASE_CANARY_PERSON_PIN
   printf '\n'
   export RELEASE_CANARY_PERSON_PIN
   export RELEASE_CANARY_BASE_URL=https://dealer-social-post-ai-production.fly.dev
   export RELEASE_CANARY_EXPECTED_SHA="$(git rev-parse HEAD)"
   export RELEASE_CANARY_CONFIRM=caption-image-video-synthetic-only
   export RELEASE_CANARY_EVIDENCE_PATH="$PWD/test-results/production-provider-canary.json"
   npm run release:provider-canary
   unset RELEASE_CANARY_PERSON_PIN RELEASE_CANARY_BASE_URL \
     RELEASE_CANARY_EXPECTED_SHA RELEASE_CANARY_CONFIRM \
     RELEASE_CANARY_EVIDENCE_PATH
   ```

   Review and archive the redacted JSON evidence with the release record. A failed canary exits nonzero and records only a stable failure code, safe message, and HTTP status when applicable. Never run it with customer media or place the PIN on the command line. Rotate the dedicated PIN after any suspected exposure; never substitute the system-admin secret.

4. Build the same SHA for Vercel. Main-branch production-domain auto-assignment is disabled in `vercel.ts`; branch previews remain available. The staging command refuses a dirty worktree, a stale `main`, a local `HEAD` that differs from Fly health, or any frontend output that does not contain the exact release SHA used by client telemetry.
5. Stage the production-configured artifact without assigning the production domain. The script captures the canonical deployment URL in a permission-restricted, gitignored evidence file and rechecks same-origin health through that URL:

   ```bash
   RELEASE_SHA="$(git rev-parse HEAD)"
   npm run release:vercel:stage -- "$RELEASE_SHA"
   unset RELEASE_SHA
   ```

6. Run the complete browser, responsive, accessibility, service-worker, sharing, login-recovery, and same-origin API checks against the exact staged URL recorded in `test-results/vercel-staged-release.json`. Promote only that evidence-bound deployment, without rebuilding. The promotion command repeats the clean/current-main, direct-Fly, staged-URL, release-SHA, and backup-readiness checks:

   ```bash
   export VERCEL_RELEASE_QA_CONFIRM=staged-browser-qa-passed
   npm run release:vercel:promote
   unset VERCEL_RELEASE_QA_CONFIRM
   ```

## Post-promotion security cutover

Keep a pre-rotation admin session cookie in a permission-restricted temporary cookie jar and retain the temporary admin code only in a protected shell variable. Generate or retrieve a new mixed-case, 12-character alphanumeric secret, validate it without printing, then enable Turnstile and turn off the compatibility bridge in one Fly restart. Mirror the two flags in GitHub for later deploys.

```bash
set +x
read -r -s -p "Final mixed-case 12-character admin code: " FINAL_ADMIN_CODE
printf '\n'
[[ "$FINAL_ADMIN_CODE" =~ ^[A-Za-z0-9]{12}$ ]]
[[ "$FINAL_ADMIN_CODE" =~ [A-Z] && "$FINAL_ADMIN_CODE" =~ [a-z] && "$FINAL_ADMIN_CODE" =~ [0-9] ]]

gh variable set TURNSTILE_ENFORCEMENT_ENABLED --env production --body true
gh variable set LEGACY_CLIENT_COMPATIBILITY_ENABLED --env production --body false
flyctl secrets set --app dealer-social-post-ai-production \
  TURNSTILE_ENFORCEMENT_ENABLED=true \
  LEGACY_CLIENT_COMPATIBILITY_ENABLED=false \
  "ADMIN_DEALER_CODE=$FINAL_ADMIN_CODE"
flyctl ssh console --app dealer-social-post-ai-production --command \
  'sqlite3 /pb/pb_data/data.db "DELETE FROM sessions WHERE role = '\''super_admin'\'' OR is_impersonation = 1 OR admin_secret_fingerprint != '\'''\'';"'
```

Prove all of the following before declaring the release complete:

- The previous admin code returns HTTP 401 while the new code succeeds with exact case and fails with altered case.
- The saved pre-rotation admin cookie and every impersonation cookie return HTTP 401 and are cleared.
- Three known-invalid synthetic codes remain frictionless; the fourth returns `CHALLENGE_REQUIRED`, renders the managed widget, and succeeds only with hostname/action/token validation. Invalid token, wrong hostname/action, and verifier outage are not mislabeled as a bad PIN.
- An authenticated health response shows Turnstile enforcement enabled, the secret/site key set, trusted proxy configured, legacy compatibility disabled, current contract/policy versions, verified backup state, and no unexpected provider fallback spike.

Unset both admin variables after proof and securely delete the temporary cookie jar. Remove the first-release Fly image bootstrap variables as soon as v2 reports its SHA.

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

  Boot that scrubbed copy only with the current mixed-case `ADMIN_DEALER_CODE` supplied from Fly secrets, rerun the exact-case and prior-session rejection proofs, then take and verify a new sanitized archive before switching the production volume. Never restore a rotated credential or a pre-hardening session row.

Record the authentication-hardening minimum SHA, Fly release/image digest, compatible Vercel deployment URL, immutable backup object manifest, restore-drill run, canary results, cutover evidence, and rollback targets together. A local backup canary proves tooling; only the source-bound off-box workflow proves production recovery.
