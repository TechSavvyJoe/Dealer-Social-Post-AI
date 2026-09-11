# Incident response

For the person who got woken up and did not build this system.

Read the first three sections in order: **Facts you need before you type anything**,
**Severity**, **First 15 minutes**. Everything else is reference.

Every command, path, threshold and schedule below was read out of this repository.
Where a value does not exist anywhere in the repo it is in a **Decide and fill in**
block, not guessed. See [Verified against](#verified-against) at the end.

---

## Facts you need before you type anything

| Thing                             | Value                                                                                                        | Source                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| Fly app (backend, PocketBase)     | `dealer-social-post-ai-production`                                                                           | `fly.toml:1`                                  |
| Fly region / sizing               | `iad`, 2 shared CPUs, 1024 MB, `min_machines_running = 1`                                                    | `fly.toml:2`, `fly.toml:19`, `fly.toml:36-41` |
| Fly origin                        | `https://dealer-social-post-ai-production.fly.dev`                                                           | `.github/workflows/fly-deploy.yml:68`         |
| Canonical origin users load       | `https://dealer-social-post-ai.vercel.app`                                                                   | `.github/workflows/fly-deploy.yml:413-414`    |
| Vercel project / org              | `prj_h5phWNMNtK4D9dqwbOHrrrRMqrRi` / `team_Tc8DG6XMPUCefkTa3u71mmlN`                                         | `.github/workflows/fly-deploy.yml:423-424`    |
| Vercel → Fly rewrite              | `/api/(.*)` → `https://dealer-social-post-ai-production.fly.dev/api/$1`, with header `x-dealer-proxy-secret` | `vercel.ts:60-70`                             |
| Liveness probe (Fly health check) | `GET /api/health`, every 30s, 5s timeout, 10s grace                                                          | `fly.toml:29-34`                              |
| Readiness probe (the real one)    | `GET /api/app/health`                                                                                        | `pb_hooks/main.pb.js:957`                     |
| PocketBase version                | pinned `0.22.55`                                                                                             | `Dockerfile:37`                               |
| flyctl version used by CI         | `0.4.71`                                                                                                     | `.github/workflows/fly-deploy.yml:42`, `:228` |
| Vercel CLI version used by CI     | `58.4.4`                                                                                                     | `.github/workflows/fly-deploy.yml:412`        |

**The single most important gotcha on this system:** Fly's health check is deliberately
liveness-only. `/api/health` returns 200 whenever PocketBase is running, even when the app
is completely unusable, because pointing the check at `/api/app/health` would make Fly pull
the machine out of rotation on a configuration gap and blackhole all traffic
(`fly.toml:22-28`). **A green Fly dashboard proves nothing about whether the product works.**
Always read `/api/app/health`.

---

## Severity

Severity is about _how many people cannot do their job right now_, not about how alarming
the error text is.

### SEV1 — the product is down for everyone

Declare SEV1 if any one of these is true:

- **Nobody can sign in.** `POST /api/app/session` (`pb_hooks/main.pb.js:1420`) is failing for
  all three login types — personal 4-digit code (`dealerCode`), manager password
  (`authType: manager_password`), system admin (`authType: admin_password`)
  (`pb_hooks/main.pb.js:1508-1536`). Includes the fail-closed configuration cases:
  `admin_login_configured = false` or `pin_pepper_configured = false`, both of which are
  readiness-critical (`pb_hooks/main.pb.js:1295-1313`).
- **Readiness is red on the Fly origin.** `GET /api/app/health` returns HTTP 503 with
  `"ok": false`. That is triggered by a failing PocketBase query, a missing `GEMINI_API_KEY`,
  a missing admin login, or — on Fly specifically — a missing trusted-proxy secret, missing
  PIN pepper, missing/invalid Turnstile secret, site key or hostname list, unverified off-box
  restore evidence, or unconfigured website integration (`pb_hooks/main.pb.js:1295-1313`).
- **The origin users load is broken while Fly is fine.** `https://dealer-social-post-ai.vercel.app`
  serves 5xx, or its `/api/*` rewrite is failing —
  `GET /api/app/proxy-readiness` returns 503 `{"ok":false}`, meaning Fly is not seeing the
  trusted proxy header (`pb_hooks/main.pb.js:945-951`, `vercel.ts:60-70`). Fly can be perfectly
  healthy while every real dealer gets nothing.
- **All generation is failing.** Every dealer's caption/image/video request through
  `/api/proxy/*` (`pb_hooks/main.pb.js:827-828`) is erroring — expired or revoked
  `GEMINI_API_KEY`, provider outage, quota exhaustion. Note `gemini_key_set` only proves a
  key _string exists_; it never proves the key works (`pb_hooks/main.pb.js:1238`). Use
  `generation.providerFailures24h` / `providerAttempts24h` in the authenticated health payload
  instead (`pb_hooks/main.pb.js:1183-1188`).
- **Data is at risk.** The machine refuses to boot because `/pb/pb_data/data.db` is not
  0.22-compatible (`entrypoint.sh:7-15`), the volume is full, or backup readiness reports
  anything other than `verified` at the same time as a data problem
  (`pb_hooks/main.pb.js:1018-1032`).
- **Security.** Suspected credential exposure, session/role escalation, or exposure of
  customer photo-release data (`photo_releases` holds customer signatures —
  `pb_hooks/main.pb.js:2039`). Treat as SEV1 regardless of how few users are affected.

### SEV2 — one flow is degraded, the rest of the product works

- **Video generation broken, photos fine.** Veo path only: `/api/proxy/*` requests matching
  `:predictLongRunning` / `:generateVideos`, plus
  `POST /api/app/posts/:id/video-generated` (`pb_hooks/main.pb.js:3186`). Video has its own
  cost bucket of 3 starts per dealer per minute (`pb_hooks/requestPolicies.js:1598-1603`).
- **Photo-release linking failing.** `POST /api/app/photo_releases/:id/link-post`
  (`pb_hooks/main.pb.js:2168`) erroring. This has a known, already-documented user-visible
  failure: the consent _is_ stored, only the link fails, and the salesperson is shown
  "Photo release not saved · Delivery locked" with Copy/Share/Save/Export locked
  (`docs/open-issues-2026-09-03.md`, P0 section). Unlinked releases are pruned hourly at
  minute 13 once `expires_at` passes (`pb_hooks/main.pb.js:2316`), so evidence is perishable —
  capture the `photo_releases` row id before it is swept.
- **Website drafts not delivering.** `POST /api/app/posts/:id/website-publication`
  (`pb_hooks/main.pb.js:3379`), its retry route (`pb_hooks/main.pb.js:3511`), or the
  every-minute delivery cron `deliver-private-website-drafts` (`pb_hooks/main.pb.js:3580`).
  A publication gives up and goes to `failed` after 8 attempts
  (`pb_hooks/websitePublications.js:33`, `:1839-1841`).
- **Image generation degraded to safe-template fallbacks.** `generation.basicFallbacks24h > 0`
  in the authenticated health payload (`pb_hooks/main.pb.js:1136-1140`); the panel flags it in
  amber (`components/SystemHealthPanel.tsx:712-717`).
- **Login friction after the Turnstile threshold.** The challenge path itself is broken:
  after 3 failed attempts from an IP the API returns 403 `CHALLENGE_REQUIRED`
  (`pb_hooks/main.pb.js:1426`, `:1453-1460`); if the widget cannot render or verify, those
  users are stuck even though first-attempt logins still work.
- **Admin-only flows broken.** Roster and dealership management
  (`/api/app/salespeople`, `/api/app/dealers` — `pb_hooks/main.pb.js:4236`, `:5042`).
  Salespeople keep working; managers cannot onboard or rotate PINs.
- **Rate limiting is biting normal use.** 429/503 from the proxy at normal volume:
  60 requests per dealer per minute (`pb_hooks/main.pb.js:40-41`), 10 image starts per minute
  (`pb_hooks/requestPolicies.js:1605-1610`), global provider concurrency 12 and per-dealer 4
  (`pb_hooks/main.pb.js:360-372`), image proxy 120 per dealer per minute
  (`pb_hooks/main.pb.js:838`).

### SEV3 — narrow or cosmetic

- One dealership, one salesperson, or one post affected.
- One stuck website publication that its retry route clears.
- Telemetry noise: `POST /api/telemetry` 429s. The per-IP limiter is 30 events per IP per
  minute and it is the only one that returns 429 (`pb_hooks/main.pb.js:1331-1337`). The
  global ingress limiter, 240 per minute, does **not** return 429 — it returns 202 with
  `{"success":true,"stored":false}`, so a global flood drops telemetry silently rather than
  showing up as client errors (`pb_hooks/main.pb.js:1338-1339`).
- A prune/GC cron missing a run: `prune-client-error-events` 07:17
  (`pb_hooks/main.pb.js:1376`), `prune-unlinked-photo-releases` hourly at :13
  (`pb_hooks/main.pb.js:2316`), `session_gc_and_auth_cleanup` 03:00
  (`pb_hooks/main.pb.js:5411`), `walkaround_abandoned_upload_cleanup` 03:30
  (`pb_hooks/main.pb.js:5420`). Cron expressions run on the container clock; nothing in
  `Dockerfile` or `fly.toml` sets `TZ`, so treat them as UTC.
- Anything behind the Walkaround Studio flags. That feature is dark by default on both
  sides — `VITE_WALKAROUND_STUDIO_ENABLED=false` and `WALKAROUND_STUDIO_ENABLED=false`
  (`.env.example:66`, `.env.example:71`). Confirm the flags are actually off in production
  before spending incident time on `/api/app/walkarounds/*`.

### Not an incident

A single user on a stale installed PWA. See
[Stale installed PWA vs. a real outage](#stale-installed-pwa-vs-a-real-outage). Do not open
an incident, and do not start reading application code, until you have ruled this out.

> ### Decide and fill in
>
> The repo defines no response-time expectations. Recommended defaults, to be confirmed by
> the owner:
>
> - **SEV1** — acknowledge within 15 minutes, 24/7; notify dealers within 30 minutes.
> - **SEV2** — acknowledge within 1 business hour; notify only affected dealers.
> - **SEV3** — next business day; no proactive dealer comms.
>
> Reasoning: a salesperson uses this at the moment of delivery with a customer standing
> there, so a SEV1 has a hard business deadline measured in minutes; a SEV2 has a workaround
> (post without video, retry the release link) and does not.

---

## First 15 minutes

Prerequisites: `flyctl` installed and authenticated for the production app, `curl`, `git`,
and a checkout of this repo. Run everything from the repo root. The path contains spaces —
quote it.

```bash
# From anywhere inside a checkout of this repository:
cd "$(git rev-parse --show-toplevel)"
export INCIDENT_DIR=".release-evidence/incident-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$INCIDENT_DIR"
echo "$INCIDENT_DIR"
```

`.release-evidence/` is gitignored (`.gitignore:16`), so nothing you capture there can be
committed by accident. Keep `$INCIDENT_DIR` exported in the same shell for every command
below.

Do the evidence capture as you go (step 6), not at the end. Fly logs do not wait for you.

### 1. Is the backend alive at all? (30 seconds)

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  https://dealer-social-post-ai-production.fly.dev/api/health
```

Expected: `200`. This is PocketBase's built-in liveness endpoint — the same one Fly polls
(`fly.toml:29-36`).

- `200` → the process is up. **This does not mean the product works.** Go to step 2.
- Connection refused / timeout / 502 → the machine is down or restarting. Go to step 3.

### 2. Is the backend actually _ready_? (1 minute)

```bash
curl -sS -i https://dealer-social-post-ai-production.fly.dev/api/app/health
```

Expected on a healthy system: HTTP `200` and a body containing
`"ok":true`, `"version":"2.0"`, a 40-character `"releaseSha"`, `"apiContractVersion"`,
`"modelPolicyVersion"`, and a `"backup"` object whose `"status"` is `"verified"`
(`pb_hooks/main.pb.js:1034-1049`; the `ok` computation that decides 200 vs 503 is
`:1296-1316`).

- HTTP `503` with `"ok":false` → **SEV1 configuration or dependency failure.** The public
  payload deliberately does _not_ say which check failed; `checks` is only attached for an
  authenticated super-admin (`pb_hooks/main.pb.js:1052-1053`). Get the reason from the
  SystemHealthPanel (step 5) or from `flyctl logs` (step 3). If a secret has gone missing,
  these ten names must all exist on the app — the deploy workflow refuses to ship without
  them (`.github/workflows/fly-deploy.yml:258-269`):
  `ADMIN_LOGIN_USERNAME`, `ADMIN_LOGIN_PASSWORD`, `SALESPERSON_PIN_PEPPER`,
  `GEMINI_API_KEY`, `TURNSTILE_SECRET`, `VERCEL_TO_FLY_PROXY_SECRET`, `CUSTOMER_HUB_URL`,
  `CUSTOMER_HUB_SECRET`, `CUSTOMER_HUB_DESTINATION_ID`, `CUSTOMER_HUB_DEALER_ID`.
  Compare against `flyctl secrets list --app dealer-social-post-ai-production` (names only —
  it never prints values).
- `"backup":{"status": ...}` anything other than `"verified"` → restore evidence is
  `not_configured`, `verification_required`, `release_unknown`, `release_mismatch`, or
  `stale` (`pb_hooks/main.pb.js:1018-1032`). On Fly this alone forces `ok:false`
  (`pb_hooks/main.pb.js:1310-1311`). It is a release/backup problem, not a runtime crash —
  do not restart the machine expecting it to clear.
- Body is HTML, not JSON → you are being answered by something other than PocketBase (proxy
  or CDN error page). Go to step 4.

Record the `releaseSha` you get here. You need it in step 5.

### 3. What does Fly say? (2 minutes)

```bash
flyctl status --app dealer-social-post-ai-production
flyctl machine list --app dealer-social-post-ai-production --json
```

What to look for, in the order the deploy workflow checks it
(`.github/workflows/fly-deploy.yml:361-383`):

- At least one machine in state `started`.
- Every started machine's `image_ref.digest` identical — a split fleet means a deploy is
  half-applied.
- `image_ref.labels.GH_SHA` equals the `releaseSha` from step 2 and equals the commit you
  believe is live.

`min_machines_running = 1` with `auto_stop_machines = true` (`fly.toml:14-19`) means there
should always be one warm machine. Zero started machines is a SEV1.

Then the logs — **do this before anything else that might rotate them out**:

```bash
flyctl logs --app dealer-social-post-ai-production --no-tail \
  | tee "$INCIDENT_DIR/fly-logs.txt"
```

`flyctl logs --app dealer-social-post-ai-production --no-tail` is the command CI runs for
post-failure diagnostics (`.github/workflows/fly-deploy.yml:389`, where it is suffixed
`|| true`) and the one the manual `Fetch Fly Logs` workflow runs
(`.github/workflows/fetch-fly-logs.yml:19`). The `| tee` above is this runbook's addition so
you keep a copy; CI only prints to its own run log. The same failure step also runs
`flyctl status` and `flyctl machine list` (`.github/workflows/fly-deploy.yml:387-388`).

Startup failures worth recognising immediately:

- `ERROR: /pb/pb_data/data.db is not compatible with the PocketBase 0.22 line.` — the
  container refused to boot rather than silently replace the database
  (`entrypoint.sh:7-15`, `:12-13`). **Do not** try to "fix" this by clearing the volume. Go to the
  rollback runbook; this is a wrong-image or wrong-volume problem.
- `Database schema is compatible with the PocketBase 0.22 line.` followed by
  `Starting PocketBase...` — a normal boot (`entrypoint.sh:16`, `:25`).

If you have no local `flyctl` (you are on a phone, or a laptop without credentials), run the
**Fetch Fly Logs** workflow from the GitHub Actions UI — it is `workflow_dispatch`-only and
prints the same output into the Actions run log, where you can read and copy it from a
browser (`.github/workflows/fetch-fly-logs.yml:1-21`).

### 4. Is it the frontend origin rather than the backend? (2 minutes)

Users do not load Fly. They load Vercel, which rewrites `/api/*` to Fly (`vercel.ts:60-70`).
Check the origin that actually matters:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://dealer-social-post-ai.vercel.app/
curl -sS https://dealer-social-post-ai.vercel.app/api/app/health
curl -sS https://dealer-social-post-ai.vercel.app/api/app/proxy-readiness
```

Expected: `200` for the shell; the same health JSON as step 2; and `{"ok":true}` from
proxy-readiness.

- Shell 200 but `/api/app/health` fails **only through Vercel** → the rewrite or the
  deployment secret is the problem, not PocketBase.
- `proxy-readiness` returns 503 `{"ok":false}` → Fly is not receiving a valid
  `x-dealer-proxy-secret` (`pb_hooks/main.pb.js:945-951`). Either the Vercel deployment was
  built without `VERCEL_TO_FLY_PROXY_SECRET`, or the values on Vercel and Fly no longer
  match. That is a **SEV1**: every real user is cut off while Fly looks perfect. Both
  environments' values are installed together — see the "Turnstile and trusted Vercel proxy"
  section of `docs/production-backups-and-release.md`.
- Assets load but the app misbehaves in the browser only on Vercel and not on Fly → suspect
  the Content-Security-Policy, which exists only on the Vercel origin (`vercel.ts:3-27`;
  the `connect-src blob:` comment documents exactly this class of bug). The Fly origin sends
  no CSP at all, so "it works on fly.dev" proves nothing.

### 5. Read the SystemHealthPanel (3 minutes)

This is the only place that tells you _which_ readiness check failed, and it is the fastest
route to the 24-hour generation picture.

**Where it is:** sign in on the login screen's **System admin** tab with
`ADMIN_LOGIN_USERNAME` / `ADMIN_LOGIN_PASSWORD` (`AGENTS.md`, "How to log in / test end to
end"). You land on the System admin hub (`AppStep.ADMIN` → `AdminDashboard`,
`components/MainContent.tsx:322-326`). The panel is the status strip directly under the
"System admin" heading (`components/AdminDashboard.tsx:434`).

**What it shows** (`components/SystemHealthPanel.tsx`):

- A one-line status strip with a coloured dot, and "Checked HH:MM · refreshes every minute"
  (`:495-545`). It calls `GET /api/app/health` with credentials (`:391`).
- Failing checks are listed inline; healthy ones stay hidden behind **Details** (`:555-578`).
- **Details** expands to: every `checks.*` boolean (`:580-619`); counts of dealers, posts in
  24h and photo releases in 24h (`:620-630`); a **Release contract** card showing the first
  16 characters of the server's `releaseSha`, the API contract version, health version and
  model policy version (`:633-655`); a **Recovery readiness** card translating
  `backup.status` into plain English plus the last verified timestamp and the 168-hour
  expiry (`:657-690`); **Generation · last 24 hours** (AI successes, basic fallbacks,
  fallback hops, standard/studio tier, provider attempts, provider failures) (`:692-733`);
  and a 7-day per-dealer usage ledger (`:736+`).

If the panel shows an error instead of data, it deliberately clears the old snapshot rather
than showing stale green (`components/SystemHealthPanel.tsx:394-400`). A 401 here means your
admin session is gone, not that the system is down.

### 6. Capture evidence (see [Evidence](#evidence-capture-it-before-it-rotates))

### 7. Decide: outage, or release-visibility failure?

Go to the next section. Do this before you touch any code.

---

## The 2026-08-07 class of failure: everything green, users on an old build

On **2026-08-07** a merged fix in `services/geminiService.ts` **sat unshipped in production
for three days while CI, Fly and the Vercel dashboard were all green**
(`.github/workflows/fly-deploy.yml:393-401`). Nothing was "down". Vercel git auto-deploy for
`main` is deliberately disabled (`vercel.ts:86`), so at the time the frontend only moved
when somebody ran `scripts/vercel-staged-release.sh` by hand — and nobody did. A second
contributing failure the same day: the bundle that did reach production was the unversioned
`dsp-development` build, so the service worker never invalidated the previous app shell
(`.github/workflows/fly-deploy.yml:505-511`).

The `release-frontend` job now exists to close that gap
(`.github/workflows/fly-deploy.yml:403-608`), but **the class of failure is not gone** — it
just moved. It now looks like: the `deploy` job succeeded, the `release-frontend` job failed
or never ran, and the backend is on the new SHA while the alias still serves the old client.

**This runbook's rule: for any report of "the fix isn't working", compare four SHAs before
reading any application code.**

```bash
# 1. What main says should be live
git ls-remote origin refs/heads/main | awk 'NR==1{print $1}'

# 2. What the backend is running
curl -sS https://dealer-social-post-ai-production.fly.dev/api/app/health \
  | grep -o '"releaseSha":"[^"]*"'

# 3. What the canonical origin's backend path reports (proves the rewrite target)
curl -sS https://dealer-social-post-ai.vercel.app/api/app/health \
  | grep -o '"releaseSha":"[^"]*"'

# 4. What the client bundle the browser downloads is bound to
curl -sS https://dealer-social-post-ai.vercel.app/sw.js | grep 'const VERSION'
```

`/sw.js` is served `no-cache, no-store, must-revalidate` (`vercel.ts:108-113`), so step 4 is
always the live value, never a cached one. Its expected form is
`const VERSION = "dsp-<40-hex-sha>";` — the build stamps `dsp-${releaseSha}`
(`vite.config.ts:17`, `:41-64`) over the checked-in placeholder `dsp-v2026.05.27`
(`public/sw.js:13`).

| What you see           | What it means                                                                         | What to do                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All four agree         | The release shipped. The bug is in the code, or the user is on a stale install.       | Go to [Stale installed PWA](#stale-installed-pwa-vs-a-real-outage).                                                                                                        |
| 1 ≠ 2                  | The backend never deployed.                                                           | Check the `Deploy production` workflow run: `backup-gate` → `deploy` (`.github/workflows/fly-deploy.yml:16`, `:214`). A `backup-gate` failure blocks everything by design. |
| 2 = 3 but ≠ 4          | **The 2026-08-07 shape.** Backend on the new SHA, alias still serving the old client. | Check whether `release-frontend` ran and passed. Then run the alias/bundle assertions below.                                                                               |
| 4 is `dsp-development` | An unversioned bundle reached production.                                             | Treat as a release incident. That build's service worker cannot invalidate the previous shell. Ship a properly stamped release; do not ask users to "just refresh".        |

Then prove it from the outside, with the same assertions the release job runs
(`.github/workflows/fly-deploy.yml:556-596`):

```bash
# Byte-compares the live chunks (including geminiService-*.js) against a local build
# of that SHA. Requires .vercel/output/static from `vercel build --prod` for the same SHA.
npm run release:vercel:assert-live -- \
  https://dealer-social-post-ai.vercel.app .vercel/output/static "$(git rev-parse HEAD)"
```

```bash
# Alias-side check: does the canonical host actually resolve to this deployment id?
# Requires VERCEL_TOKEN; VERCEL_ORG_ID scopes it to the team.
VERCEL_ORG_ID=team_Tc8DG6XMPUCefkTa3u71mmlN \
VERCEL_TOKEN="$YOUR_TOKEN" \
  npm run release:vercel:assert-alias -- dpl_XXXXXXXX
```

`--assert-alias` fails immediately with "VERCEL_TOKEN is required to resolve the canonical
alias." if the token is missing (`scripts/vercel-live-bundle-assert.mjs:537-538`). The
deployment-side view is not a substitute: `vercel inspect` omits the canonical host from a
deployment's own alias list even when that host resolves to it
(`.github/workflows/fly-deploy.yml:585-587`).

Why the alias is checked separately at all: this project has `autoAssignCustomDomains`
disabled, so `vercel promote` attaches only the `*-joes-projects-*.vercel.app` aliases and
leaves the canonical host on the previous deployment
(`.github/workflows/fly-deploy.yml:570-574`). `vercel promote` alone never moves what users
see.

**Standing detection, not just incident response:** the failure mode is silence. Nothing in
this repo watches for "backend SHA ≠ live bundle SHA" outside a release run — see the
Decide-and-fill-in block below.

> ### Decide and fill in
>
> No external uptime or release-drift monitor is configured anywhere in this repo. The only
> automated readiness checks run inside the deploy workflow
> (`.github/workflows/fly-deploy.yml:339-360`) and the nightly backup drill
> (`.github/workflows/pocketbase-backup.yml:3-5`). Owner decisions:
>
> - **Uptime monitor** — recommended: an external monitor on
>   `https://dealer-social-post-ai.vercel.app/api/app/health` (not the Fly origin, so the
>   rewrite and the CSP-bearing origin are covered), alerting on non-200 or on
>   `"ok":false`. This is what `fly.toml:26-28` already assumes exists.
> - **Release-drift monitor** — recommended: a daily job comparing `origin/main`, the health
>   `releaseSha`, and the `dsp-` value in `/sw.js`, alerting on any mismatch older than one
>   hour. This is the check that would have caught 2026-08-07 on day one instead of day three.
> - **Where alerts go** (email, SMS, chat) and **who they wake**.

---

## Stale installed PWA vs. a real outage

The single most common false alarm. A salesperson has the app installed on their iPhone home
screen, the service worker is still serving the previous app shell, and they report a bug
that was fixed a week ago. Nothing is down.

The app does not force-update. `PwaUpdatePrompt` registers the worker, deliberately does not
call `skipWaiting()` on its own, and instead offers the user a prompt; a user who taps
"Update later" keeps the old worker for the rest of the session (foreground re-checks
continue every 60 seconds but will not re-nag for the same waiting worker)
(`components/PwaUpdatePrompt.tsx:17-33`, `public/sw.js:18-33`).

**How to tell in under a minute:**

1. **Ask the user for their build number.** Settings (gear in the header,
   `components/Header.tsx:232-243`) shows `Build <7 chars>` in the modal footer
   (`components/SettingsModal.tsx:47-51`). That value is the _client bundle's_ SHA
   (`components/SettingsModal.tsx:12-15`) — deliberately distinct from the server SHA shown
   in the SystemHealthPanel.
2. **Compare it to the live bundle:**
   ```bash
   curl -sS https://dealer-social-post-ai.vercel.app/sw.js | grep 'const VERSION'
   ```
   If the user's 7 characters are not the first 7 of that SHA, they are on an old build.
3. **Confirm it is only them.** If `/api/app/health` on the Vercel origin is `200 ok:true`
   and other users are fine, this is a SEV3 support case, not an outage.

**Remedy, in order:** have them tap the in-app update prompt if it is showing; otherwise
fully close the installed app (swipe it away, not just background it) and reopen so the
waiting worker activates; if it still will not move, delete the home-screen icon and
re-install from the canonical origin.

**Two traps that make this look like a live bug:**

- A screenshot taken right after a deploy usually shows the _old_ cached build. Pin the
  version via `/sw.js` before believing a screenshot.
- "The photo comes back with no overlays" has previously been a stale installed build, not a
  live defect. Establish the build number before reading any code.

---

## Comms

Send from an account dealers already recognise. Keep it short, factual, and free of
speculation about cause. Never include SHAs, log excerpts, secret names, or customer data.

**Initial notice (SEV1, within the notification window):**

> Subject: Dealer Social Post AI — service issue, we're on it
>
> We're aware that [signing in / creating posts / generating video] is not working right
> now. It started at approximately [HH:MM local]. We are actively working on it and will
> send an update by [HH:MM local, no more than 60 minutes out], even if we don't have a fix
> by then.
>
> What still works: [e.g. posts already created can still be shared from the app].
> What to do meanwhile: [e.g. capture the photo and the customer signature as usual; the
> post can be created once service is restored].

**Update (send on the promised cadence even with no news):**

> Update [HH:MM]: [one sentence on status]. [Fixed / still investigating]. Next update by
> [HH:MM].

**Resolution:**

> Update [HH:MM]: This is resolved as of [HH:MM]. [One sentence on impact window and what,
> if anything, the dealer needs to redo.] If you are still seeing the problem, please fully
> close the app and reopen it, then let us know.

**Stale-build support reply (SEV3, one user — not a broadcast):**

> Please open Settings in the app and tell me the "Build" number at the bottom. If it
> doesn't match our current release, fully close the app (swipe it away) and reopen it —
> that picks up the latest version.

> ### Decide and fill in
>
> The repo contains no dealer contact list, distribution channel, or status page. Owner
> decisions:
>
> - **Channel** — recommended: direct email/SMS to each dealership's GM plus the store's
>   manager accounts, because the current install base is small enough that a broadcast
>   status page adds latency without adding reach.
> - **Who is authorised to send dealer comms.**
> - **Whether a public status page exists**, and its URL if so.

---

## When to roll back

Roll back rather than fix forward when **any** of these is true:

- The incident began within roughly one hour of a release, and the previous release is known
  good.
- You do not have a diagnosis after 30 minutes of a SEV1.
- The fix requires a code change you cannot get through CI, `backup-gate`, `deploy` and
  `release-frontend` before the impact window closes — that is the full pipeline
  (`.github/workflows/fly-deploy.yml:16`, `:214`, `:403`), and `backup-gate` includes a live
  backup and a restore drill (`.github/workflows/fly-deploy.yml:91-213`). It is not fast.

Do **not** roll back when:

- Readiness is red for a configuration reason (missing secret, expired backup evidence). The
  previous image will fail the same checks — fix the configuration.
- The database has already accepted writes under a schema change. A code rollback across a
  migration is a data decision, not a deploy decision.

**Procedure:** follow the rollback runbook — `docs/runbooks/rollback.md`, the sibling
runbook in this set. If your checkout does not have it yet, use the **Monitoring and
rollback** section of `docs/production-backups-and-release.md`, which is the authoritative
existing text and includes the three hard constraints: promote only a recorded Vercel
deployment from the authentication-hardening release or later; deploy only a recorded,
restore-tested image digest; and never attach a raw pre-release archive to a public machine.

One backend-specific note that matters at 2am: rolling the backend back does **not** roll
the frontend back. They are separate jobs with separate artifacts, and the frontend rewrites
`/api/*` to whatever the backend now is. If you roll the backend to an older SHA, check
whether the live client bundle is still compatible before you stop.

---

## Evidence: capture it before it rotates

Fly logs are ephemeral. `flyctl logs --no-tail` prints a recent buffer, not an archive, and
nothing in this repository configures log shipping, retention, or an external log sink. If
you do not capture it during the incident, it is gone.

Capture, in this order:

1. **Fly logs** — first, always:
   ```bash
   flyctl logs --app dealer-social-post-ai-production --no-tail > "$INCIDENT_DIR/fly-logs.txt"
   ```
2. **Fly state:**
   ```bash
   flyctl status --app dealer-social-post-ai-production > "$INCIDENT_DIR/fly-status.txt"
   flyctl machine list --app dealer-social-post-ai-production --json \
     > "$INCIDENT_DIR/fly-machines.json"
   ```
3. **Both health payloads**, Fly origin and Vercel origin, plus `/api/app/proxy-readiness`
   and `/sw.js` (the four SHAs from the section above). They change under you:
   ```bash
   curl -sS https://dealer-social-post-ai-production.fly.dev/api/app/health \
     > "$INCIDENT_DIR/health-fly.json"
   curl -sS https://dealer-social-post-ai.vercel.app/api/app/health \
     > "$INCIDENT_DIR/health-vercel.json"
   curl -sS https://dealer-social-post-ai.vercel.app/api/app/proxy-readiness \
     > "$INCIDENT_DIR/proxy-readiness.json"
   curl -sS https://dealer-social-post-ai.vercel.app/sw.js > "$INCIDENT_DIR/sw.js"
   ```
4. **Secret _names_ only** — the deploy workflow reads only the `Name` field from this
   output; secret values are never returned (`.github/workflows/fly-deploy.yml:248-262`):
   ```bash
   flyctl secrets list --app dealer-social-post-ai-production --json \
     > "$INCIDENT_DIR/fly-secret-names.json"
   ```
5. **The authenticated health payload** from the SystemHealthPanel (screenshot the expanded
   **Details**, or capture the JSON with a super-admin session). This is the only source for
   `checks.*`, the 24h generation numbers, and the 7-day usage ledger.
6. **Database-side diagnostics, on a clock.** Server-side error and auth records are pruned
   automatically:
   - `client_error_events` and `generation_events`: deleted at **14 days**
     (`pb_hooks/main.pb.js:1379-1394`).
   - `auth_events`: deleted at **30 days** by the daily 07:17 prune
     (`pb_hooks/main.pb.js:1395-1402`). A second sweep in
     `purgeExpiredSessionsAndOldEvents` uses 90 days (`pb_hooks/helpers.js:4257-4271`), so
     **30 days is the effective floor** — do not plan around 90.
   - Unlinked `photo_releases` rows: deleted hourly at minute 13 once `expires_at` has
     passed (`pb_hooks/main.pb.js:2316-2339`).
7. **Release receipts**, if a release is implicated: `.release-evidence/` holds the staged
   release, QA, provider-canary and website-handoff receipts
   (`docs/production-backups-and-release.md`, staged-promotion section). It is gitignored and
   permission-restricted — copy, do not move.

What must never be captured or pasted into an incident channel: secret values, salesperson
PINs, admin passwords, customer names, VINs, signatures, generated captions, or media. The
telemetry pipeline already strips all of this at the server boundary
(`pb_hooks/helpers.js:2297-2345`); do not reintroduce it by hand.

> ### Decide and fill in
>
> - **Fly log retention** — Fly's own buffer length is not recorded in this repo. Confirm it
>   against Fly's current documentation and write the number here, or (recommended) stop
>   depending on it: ship logs to an external sink so incident evidence outlives the machine.
> - **Where incident evidence is archived** — recommended: a dated folder outside the repo
>   (evidence contains operational detail and must not be committed), referenced by id from
>   the postmortem.

---

## Postmortem template

Blameless. Write it within [owner-defined window] of resolution, while the timeline is still
recoverable from the evidence you captured.

```markdown
# Incident YYYY-MM-DD — <one-line summary>

- **Severity:** SEV_
- **Detected:** <UTC> by <monitor | dealer report | internal>
- **Mitigated:** <UTC>
- **Resolved:** <UTC>
- **Duration of user impact:** <minutes>
- **Author:** <name>

## Impact

Who could not do what. Number of dealerships and salespeople affected if known.
Posts lost, deliveries stranded, customer signatures affected. Say "unknown" where unknown.

## What happened

Plain narrative. No blame, no names attached to mistakes.

## Timeline (UTC)

| Time | Event | Source                                        |
| ---- | ----- | --------------------------------------------- |
|      |       | fly-logs.txt / health payload / dealer report |

## The four SHAs at detection

| Source                            | Value |
| --------------------------------- | ----- |
| origin/main                       |       |
| Fly /api/app/health releaseSha    |       |
| Vercel /api/app/health releaseSha |       |
| /sw.js VERSION                    |       |

## Root cause

The technical cause. If the incident was invisible because everything was green
(the 2026-08-07 class), say so explicitly and treat the missing signal as a root cause
in its own right.

## Detection

How did we find out? Was it a monitor or a dealer? If a dealer, what would have detected it
first, and does that thing exist yet?

## What went well

## What went badly

## Action items

| #   | Action | Owner | Due | Type (prevent / detect / respond) |
| --- | ------ | ----- | --- | --------------------------------- |

At least one action item must be a _detection_ item unless a monitor already caught it.

## Evidence

Paths to captured logs, health payloads, machine list, and release receipts.
No secrets, no customer data.
```

---

## On-call and escalation

> ### Decide and fill in
>
> **Nothing in this repository defines an on-call rotation, escalation path, or contact of
> any kind.** There is no PagerDuty configuration, no alert routing, and no contact list.
> The owner must decide and record here:
>
> - **Primary responder** for SEV1, and the hours they cover. Recommended default while the
>   team is one person: the owner is primary at all times, and SEV1 dealer comms are sent
>   even when nobody can start work immediately — an acknowledged outage costs far less
>   trust than a silent one.
> - **Secondary / escalation contact**, if any, and after how long a SEV1 escalates.
> - **Vendor escalation paths and account identities** for the three external dependencies
>   this system cannot run without: Fly.io (app `dealer-social-post-ai-production`), Vercel
>   (org `team_Tc8DG6XMPUCefkTa3u71mmlN`, project `prj_h5phWNMNtK4D9dqwbOHrrrRMqrRi`), and
>   Google's Gemini API. Add Cloudflare (Turnstile and the R2 backup bucket) and the
>   Customer Hub website destination as second-tier dependencies.
> - **Who may authorise a rollback**, and whether that differs at 2am.
> - **Where incidents are logged** (ticket system, doc, or folder) and how they are numbered.
>
> Until these are filled in, an operator following this runbook can diagnose and communicate
> but cannot escalate.

---

## Verified against

Every value in this document was read from these files at the stated locations. If you
change one of them, re-check this runbook.

- `fly.toml` — app name, region, VM size, `min_machines_running`, and the liveness-only
  health-check comment (`:1-2`, `:14-19`, `:22-34`, `:36-41`). The file is 41 lines long.
- `Dockerfile` — PocketBase pinned to `0.22.55` and why (`:23-38`).
- `entrypoint.sh` — the 0.22 database-compatibility refusal and its exact log lines
  (`:7-15`, `:12-13`, `:16`, `:25`).
- `vercel.ts` — `/api/(.*)` rewrite to Fly with `x-dealer-proxy-secret`, `git.deploymentEnabled.main = false`,
  the CSP that exists only on the Vercel origin, and `/sw.js` served `no-store`
  (`:3-27`, `:60-70`, `:86`, `:108-113`).
- `vite.config.ts` — service-worker version stamping `dsp-${releaseSha}` / `dsp-development`
  (`:6-17`, `:41-64`).
- `public/sw.js` — the checked-in `VERSION` placeholder and the no-auto-skipWaiting behaviour
  (`:13`, `:18-33`).
- `pb_hooks/main.pb.js` — every route and threshold cited: proxy rate limits (`:40-41`,
  `:360-372`, `:838`), health (`:945-951`, `:957`, `:1018-1049`, `:1052-1053`, `:1136-1225`,
  `:1238`, `:1295-1316`), telemetry (`:1319-1339`), retention crons (`:1376-1405`), session
  (`:1420-1426`, `:1458-1465`, `:1508-1536`), photo releases (`:2039`, `:2168`, `:2316-2339`),
  website publication (`:3379`, `:3511`, `:3580`), video (`:3186`), admin routes (`:4236`,
  `:5047`), GC crons (`:5411`, `:5420`).
- `pb_hooks/helpers.js` — telemetry redaction (`:2297-2345`) and the 90-day auth-event sweep
  in `purgeExpiredSessionsAndOldEvents` (`:4257-4271`).
- `pb_hooks/requestPolicies.js` — video (3/min) and image (10/min) cost buckets (`:1595-1613`).
- `pb_hooks/websitePublications.js` — 8-attempt delivery ceiling (`:33`, `:1839-1841`).
- `.github/workflows/fly-deploy.yml` — job graph, origins, Vercel ids, CLI versions, the
  readiness loop, the failure-diagnostics commands, and the 2026-08-07 incident comments
  (`:16`, `:42`, `:68`, `:214`, `:248-249`, `:339-392`, `:393-401`, `:403-608`).
- `.github/workflows/fetch-fly-logs.yml` — the manual log-fetch workflow (`:1-21`).
- `.github/workflows/pocketbase-backup.yml` — nightly drill schedule (`:3-5`).
- `components/SystemHealthPanel.tsx` — where it fetches, what it renders, and how it handles
  errors (`:372-400`, `:495-760`).
- `components/AdminDashboard.tsx` — the panel's location in the System admin hub (`:434`).
- `components/MainContent.tsx` — `AppStep.ADMIN` → `AdminDashboard` (`:322-326`).
- `components/SettingsModal.tsx` — the client build number shown to salespeople (`:12-15`, `:47-51`).
- `components/Header.tsx` — the Settings entry point (`:232-243`).
- `components/PwaUpdatePrompt.tsx` — update-prompt behaviour and the 60s foreground re-check
  (`:17-33`).
- `.env.example` — Walkaround Studio flags default to `false` (`:66`, `:71`).
- `docs/production-backups-and-release.md` — release pipeline, rollback constraints, proxy
  secret installation, `.release-evidence/` receipts.
- `docs/open-issues-2026-09-03.md` — the photo-release link failure and its exact
  user-facing symptom.
- `AGENTS.md` — login personas and the PocketBase 0.22 pin.
