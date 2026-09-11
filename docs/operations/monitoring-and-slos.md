# Monitoring and SLOs

Operational reference for Dealer Social Post AI production. Written for someone paged at 2am
who did not build this.

Every command, path, secret name, schedule and threshold below was read out of this repository
and is cited inline. Values that do **not** exist anywhere in the repo are collected in
"Decide and fill in" blocks — those are owner decisions, not facts. Do not treat a recommended
default as configuration until someone actually sets it.

Written 2026-09-10 against branch `hardening/production-review-2026-09`. See
[Verified against](#verified-against) for the exact files read.

---

## 0. Read this first: there is no external monitor today

`fly.toml` states that deep readiness is "verified at deploy time by the CI workflow and by
external uptime monitors hitting `/api/app/health`" (`fly.toml:27-28`).

**No such monitor is named, configured, or referenced anywhere in this repository.** There is
no monitor config file, no vendor account name, no alert routing, no webhook, and no
notification secret. A grep for the obvious vendors returns exactly one hit, and it is a
historical to-do, not a configuration:

> `LAUNCH_READINESS_REVIEW_2026-05-28.md:182` — "Health endpoint already exists
> (`/api/app/health`) — wire it into Fly's `[http.checks]` and an external uptime monitor
> (Better Stack / Healthchecks.io)."

The Fly half of that line was done (`fly.toml:29-34`). The external-monitor half was not, or if
it was, it was done in a vendor console and left no trace in the repo. Section 3 specifies
exactly what to configure so someone can finish it today.

Consequence to say out loud: **right now, if production returns `ok:false` at 3am, nothing and
nobody is told.** Fly keeps routing traffic to the machine (by design — see section 1), CI is
not running, and the super-admin panel only polls while a browser tab is open
(`components/SystemHealthPanel.tsx:449-451`).

---

## 1. What Fly checks, and what it deliberately does not

`fly.toml:29-34`:

| Setting      | Value                                        |
| ------------ | -------------------------------------------- |
| Path         | `/api/health` (PocketBase built-in liveness) |
| Method       | `GET`                                        |
| Interval     | `30s`                                        |
| Timeout      | `5s`                                         |
| Grace period | `10s`                                        |

Related runtime facts from the same file:

- App name `dealer-social-post-ai-production`, region `iad` (`fly.toml:1-2`).
- `internal_port = 8090`, `force_https = true` (`fly.toml:12-13`).
- `min_machines_running = 1` with `auto_stop_machines`/`auto_start_machines` true
  (`fly.toml:14-19`). One machine stays warm, so a monitor should not see cold-start latency.
- VM: `shared`, `cpus = 2`, `memory_mb = 1024` (`fly.toml:36-41`).

**The check points at liveness on purpose.** The comment at `fly.toml:22-28` explains why:
`/api/app/health` returns 503 when readiness-critical config is missing, so pointing the Fly
check there would make Fly drop the only machine from rotation and blackhole _all_ traffic on a
configuration gap. Do not "fix" this by repointing the Fly check.

The direct consequence: **Fly's check cannot detect a bad-config outage.** `/api/health` returns
200 whenever the PocketBase process is up, including when the Gemini key is missing, the admin
account is unprovisioned, the PIN pepper is absent, or backup restore evidence has gone stale.
That entire class of failure is only visible on `/api/app/health`, which is what the external
monitor is for.

---

## 2. What `/api/app/health` actually returns

Handler: `pb_hooks/main.pb.js:957-1316`. Registered public — no session required — so uptime
monitors can hit it (`pb_hooks/main.pb.js:952-956`).

Response headers set by the handler (`pb_hooks/main.pb.js:962-963`):

```
Cache-Control: private, no-store
Vary: Cookie
```

The payload shape depends on the caller's cookie, which is why it must never be cached or
merged by an intermediary.

### 2.1 Public fields (no session — this is what a monitor sees)

Built at `pb_hooks/main.pb.js:1034-1049`:

| Field                       | Source                                                                                     | Notes                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `ok`                        | computed, `main.pb.js:1295-1314`                                                           | The single aggregate verdict. Drives HTTP 200 vs 503 (`main.pb.js:1316`).                                     |
| `ts`                        | `new Date().toISOString()`                                                                 | Server time of the probe.                                                                                     |
| `version`                   | literal `"2.0"`                                                                            | Health-payload shape version, not the app release.                                                            |
| `releaseSha`                | `RELEASE_SHA` or `FLY_IMAGE_REF`, else `"unknown"` (`main.pb.js:995-1001`)                 | Truncated to 120 chars. This is what the deploy workflow greps for.                                           |
| `apiContractVersion`        | `helpers.API_CONTRACT_VERSION` = `"2026-07-31.v4"` (`pb_hooks/helpers.js:17`)              | Frontend sends the same constant in telemetry (`utils/telemetry.ts:19`).                                      |
| `capabilities`              | `helpers.PROXY_CAPABILITIES` = `{ veoNegativePrompt: true }` (`pb_hooks/helpers.js:30-33`) | Feature negotiation for installed PWAs.                                                                       |
| `modelPolicyVersion`        | `policies.geminiModelPolicySnapshot().version` (`main.pb.js:985,1041`)                     | Currently `"5"`, pinned (`pb_hooks/requestPolicies.js:298-301`).                                              |
| `backup.configured`         | `POCKETBASE_R2_BACKUPS_ENABLED == "true"` (`main.pb.js:986-987`)                           |                                                                                                               |
| `backup.lastVerifiedAt`     | `POCKETBASE_BACKUP_LAST_VERIFIED_AT`, normalized to ISO (`main.pb.js:988-994`)             | `null` if unparseable.                                                                                        |
| `backup.verifiedReleaseSha` | `POCKETBASE_BACKUP_VERIFIED_RELEASE_SHA` (`main.pb.js:1002-1006`)                          | `null` if unset.                                                                                              |
| `backup.maxAgeHours`        | `7 * 24` = 168 (`main.pb.js:1010`)                                                         | Hard-coded; see the comment at `main.pb.js:1007-1009`.                                                        |
| `backup.status`             | computed, `main.pb.js:1021-1032`                                                           | One of `verified`, `not_configured`, `verification_required`, `release_unknown`, `release_mismatch`, `stale`. |

That is the entire public payload. No tenant data, no counts, no secret values.

### 2.2 Admin-gated fields (super-admin session cookie only)

Gated by `isAuthedAdmin` — a validated session whose role is `super_admin`
(`main.pb.js:964-965`). The admin sub-objects are attached at `main.pb.js:1052-1080` and
populated at `1086-1234`; the `checks` booleans themselves are computed at `1238-1293` (declared
at `967-984`) for every caller and only _attached_ for admins:

| Field          | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `checks`       | 18 booleans for config presence: `pocketbase`, `gemini_key_set`, `proxy_token_set`, `anthropic_key_set`, `openai_key_set`, `claude_fallback_enabled`, `openai_fallback_enabled`, `admin_login_configured`, `turnstile_enforcement_enabled`, `turnstile_secret_set`, `turnstile_site_key_set`, `turnstile_hostnames_configured`, `trusted_proxy_configured`, `pin_pepper_configured`, `legacy_client_compatibility_enabled`, `off_box_backup_configured`, `off_box_restore_ready`, `website_integration_configured`. Booleans only — values are never echoed (`main.pb.js:1237`). Note `proxy_token_set` is hard-coded `false` and retained only for contract compatibility (`main.pb.js:1239-1242`); a `false` there is not a fault. |
| `counts`       | `dealers`, `posts_24h`, `photo_releases_24h`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `generation`   | `aiSuccesses24h`, `basicFallbacks24h`, `fallbackAttempts24h`, `standardTier24h`, `studioTier24h`, `lastSuccessfulAt`, `providerAttempts24h`, `providerFailures24h`, `lastProviderAttemptAt`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `recentErrors` | `total24h` plus `topActions` (top 5 client error names, 24h).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `usage`        | 7-day per-dealer rollup from `helpers.generationUsageSummary(7)` (`pb_hooks/helpers.js:1924-2048`): events, succeeded, token totals, image sizes, `videoSeconds`, and `latencyMs.{p50,p95,samples}` (`helpers.js:1987`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

Every one of these blocks is individually wrapped in try/catch so that a missing collection or a
slow accounting query can never turn a healthy deployment into a failed probe
(`main.pb.js:1144-1146`, `1189-1190`, `1231-1234`).

### 2.3 How `ok` is decided

`main.pb.js:1295-1314`. `ok` becomes false if **any** of these hold:

1. `checks.pocketbase` is false — the `dealers` collection lookup threw (`main.pb.js:1082-1104`).
2. `checks.gemini_key_set` is false.
3. `checks.admin_login_configured` is false.
4. Running on Fly (`FLY_APP_NAME` set, `main.pb.js:1260`) **and** any of
   `trusted_proxy_configured`, `pin_pepper_configured`, `turnstile_secret_set`,
   `turnstile_site_key_set`, `turnstile_hostnames_configured` is false.
5. `turnstile_enforcement_enabled` is true **and** any of the three Turnstile checks is false.
6. Running on Fly **and** `off_box_restore_ready` or `website_integration_configured` is false.

Two things follow that matter operationally:

- **The public caller gets the full verdict even though it cannot see `checks`.** The `checks`
  object is computed for everyone; it is only _attached to the response_ for admins. So a
  monitor asserting `"ok":true` is asserting all six clauses above.
- **Backup evidence is load-bearing for production readiness.** `off_box_restore_ready` is
  `backupStatus === "verified"` (`main.pb.js:1033`), which requires backups enabled, a
  `lastVerifiedAt` **and** a `verifiedReleaseSha`, a known `releaseSha`, an exact release match,
  and a timestamp inside 168 hours. A backup drill that silently stops running will take
  production to `ok:false` within 7 days.

---

## 3. Configure the external uptime monitor (do this today)

Nothing in the repo picks a vendor. Any HTTP monitor that supports a body-content assertion
works (Better Stack and Healthchecks.io are the two named in the historical review at
`LAUNCH_READINESS_REVIEW_2026-05-28.md:182`).

Configure **two** monitors. They fail for different reasons and you need to tell them apart at
2am.

### Monitor A — user path (Vercel origin)

| Setting          | Value                                                     | Why                                                                                                                                                                                                                    |
| ---------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| URL              | `https://dealer-social-post-ai.vercel.app/api/app/health` | The canonical production origin (`.github/workflows/fly-deploy.yml:413-414`). `/api/(.*)` is rewritten to Fly with the proxy secret injected (`vercel.ts:60-70`), so this exercises the whole path a salesperson uses. |
| Method           | `GET`                                                     | The route is registered `GET` only (`pb_hooks/main.pb.js:957`).                                                                                                                                                        |
| Headers          | none                                                      | Send **no** `Cookie` and **no** `x-dealer-proxy-secret`. A cookie would change the payload shape (§2.2); the proxy secret is Vercel's to inject.                                                                       |
| Expected status  | `200`                                                     | `503` is a real readiness failure, not a transport error (`main.pb.js:1316`).                                                                                                                                          |
| Body assertion 1 | contains `"ok":true`                                      | Same assertion CI makes (`.github/workflows/ci.yml:168`, `fly-deploy.yml:351`).                                                                                                                                        |
| Body assertion 2 | contains `"status":"verified"`                            | Backup/restore evidence. Same assertion CI makes (`ci.yml:169`, `fly-deploy.yml:352`).                                                                                                                                 |
| Follow redirects | yes                                                       | `force_https = true` (`fly.toml:13`).                                                                                                                                                                                  |

### Monitor B — backend only (Fly origin)

Identical, except URL `https://dealer-social-post-ai-production.fly.dev/api/app/health` — the
origin the deploy workflow probes directly (`fly-deploy.yml:349`).

**Why both:** if A is red and B is green, the fault is Vercel — the edge, the `/api` rewrite, or
the alias. If both are red, the fault is Fly or config. This distinction has burned this project
before: the Fly origin sends no CSP at all, so browser-visible faults can exist only on the
Vercel origin (`vercel.ts:19-22`).

### Do NOT monitor `/api/app/proxy-readiness` from outside Vercel

`GET /api/app/proxy-readiness` returns `{ok:true}` / 200 only when the request carries a valid
`X-Dealer-Proxy-Secret` matching `VERCEL_TO_FLY_PROXY_SECRET`
(`pb_hooks/main.pb.js:945-950`, `pb_hooks/helpers.js:1616-1631`). Hit directly on the Fly host it
returns 503 forever, and a monitor pointed there is a permanent false alarm. It is a
release-time probe, used by the staged-deployment step (`fly-deploy.yml:565-566`).

### Verify the monitor's assertions by hand before you trust it

```bash
curl --silent --show-error --fail --max-time 10 \
  https://dealer-social-post-ai.vercel.app/api/app/health
```

Expected (single line, field order as built at `main.pb.js:1034-1049`):

```json
{
  "ok": true,
  "ts": "2026-09-10T04:12:07.114Z",
  "version": "2.0",
  "releaseSha": "<40-hex>",
  "apiContractVersion": "2026-07-31.v4",
  "capabilities": { "veoNegativePrompt": true },
  "modelPolicyVersion": "5",
  "backup": {
    "configured": true,
    "lastVerifiedAt": "2026-09-09T07:20:11Z",
    "verifiedReleaseSha": "<40-hex>",
    "maxAgeHours": 168,
    "status": "verified"
  }
}
```

If it fails:

- **`curl` exits 22 with HTTP 503** — the service is up and telling you it is not ready. Get the
  body (`--fail` suppresses it): rerun without `--fail`, read `backup.status`, then log in as
  super admin and read `checks` (§4.2) to find which boolean is false.
- **HTTP 200 but `"status"` is not `"verified"`** — readiness is fine but backup evidence is
  degrading. See §5. You have until 168 hours after `backup.lastVerifiedAt` before this flips
  `ok` to false (`main.pb.js:1010`, `1030-1033`).
- **Connection timeout on A but not B** — Vercel edge or alias problem. Compare
  `releaseSha` from both origins; at release time the workflow asserts the Vercel origin's
  health payload carries the release SHA (`fly-deploy.yml:594-596`), and separately asserts the
  same for the Fly origin (`fly-deploy.yml:353`).
- **Both time out** — Fly. Check machines: `flyctl machine list --app dealer-social-post-ai-production`,
  and logs via the manual workflow in §6.3.

> ### Decide and fill in — monitor timing
>
> These four numbers do not exist in this repository. Pick them, write them here, and set them
> in the monitor.
>
> | Setting                              | Recommended default | Reasoning from the repo                                                                                                                                                                                       |
> | ------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | Check interval                       | **60s**             | Fly already probes liveness every 30s (`fly.toml:31`), so the external monitor's job is config/readiness drift, not sub-minute liveness. 60s bounds detection at ~2 minutes with the failure threshold below. |
> | Request timeout                      | **10s**             | Matches the deploy workflow's own readiness probe, `--max-time 10` (`fly-deploy.yml:348`). The public payload does no per-dealer SQL (§2.2), so a slower response is a real problem.                          |
> | Consecutive failures before alerting | **2**               | The deploy workflow tolerates transient failure by retrying 30 times at 5s (`fly-deploy.yml:346-358`); a single sample is not evidence. Two at 60s ≈ 2-minute detection.                                      |
> | Alert on recovery                    | **yes**             | So the 2am page closes itself when a redeploy fixes it.                                                                                                                                                       |
>
> Also undecided and repo-silent: **who is paged**, **through what channel**, and **at what hour**.
> There is no on-call rotation, no alert routing and no notification secret anywhere in this
> repository. Recommended default: one destination that reaches a phone (SMS or push), for the
> `ok:false` condition only; everything else in §4.3 goes to email or a daily digest.

---

## 4. What is worth alerting on

### 4.1 Page immediately

| Condition                                                       | Where it is visible | Why it pages                                                                                                   |
| --------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `/api/app/health` returns non-200 or `"ok":false`               | Public payload      | Any of the six clauses at `main.pb.js:1295-1314`. Generation, login, or both are broken for every dealer.      |
| Both monitors down / connection refused                         | Transport           | The machine is gone. `min_machines_running = 1` (`fly.toml:19`) means there is no second machine to absorb it. |
| `backup.status` becomes `release_mismatch` right after a deploy | Public payload      | Production is running a release whose restore has never been drilled (`main.pb.js:1019-1029`).                 |

### 4.2 Alert, but it can wait for morning

| Condition                                            | Field  | Why it is not a page                                                                                                                                                                                                                                                         |
| ---------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backup.status` = `stale` or `verification_required` | Public | You have up to 168 hours of runway before `ok` flips (`main.pb.js:1010`, `1030-1033`). Fix the drill, not the flag.                                                                                                                                                          |
| `modelPolicyVersion` changes unexpectedly            | Public | Version is pinned at 5 and a bump strands archived creative behind a forced re-review (`requestPolicies.js:298-301`, `scripts/check-model-policy.mjs:58-62`). A change in production means something shipped that CI should have blocked — investigate, but nothing is down. |
| `apiContractVersion` or `capabilities` changes       | Public | Contract negotiation drift with installed PWAs. Worth knowing, not urgent.                                                                                                                                                                                                   |
| `releaseSha` = `"unknown"`                           | Public | Release identity is unbound (`main.pb.js:995-1001`), which will also break the backup gate's release match.                                                                                                                                                                  |

### 4.3 Worth a dashboard, not an alert (super-admin session required)

These require a super-admin cookie, so they cannot be scraped by an anonymous monitor. Read them
from the System Health panel (§6.1) or a manual authenticated `curl`:

- `generation.providerFailures24h` vs `providerAttempts24h` — the numerator and denominator for
  the generation SLO in §5.2.
- `generation.basicFallbacks24h` and `fallbackAttempts24h` — silent quality degradation; posts
  still ship, but with template captions instead of AI ones.
- `recentErrors.total24h` and `topActions` — browser-side error volume from telemetry (§6.2).
- `usage.dealers[].latencyMs.p50/p95` — the only latency numbers this system records at all
  (`helpers.js:1987`).

### 4.4 A trap worth writing down

For video, `succeeded` means the long-running operation was **accepted**, not that a video
came back: `proxyGenerationResponseSucceeded` returns true for `kind === "video"` as soon as the
upstream payload carries a non-empty `name` (`pb_hooks/helpers.js:2070-2072`). The browser then
polls for up to its default 300000 ms and throws "Video generation timed out" on its own
(`services/geminiService.ts:2862-2864`, `2993`). So a video that times out for the salesperson can
still count as a success in `generation.providerAttempts24h`. Any video SLO built on
`generation_events` alone will read optimistic.

---

## 5. Proposed SLOs

Nothing in this repository states a single numeric service-level target. Everything numeric
below is a **recommendation**, not a fact. The reasoning is grounded in how the product is
actually used and in measured timeouts that do exist in the code.

### How the product is used (this drives the shape of every target)

Salespeople use this on a lot, on phones, on dealership or cellular networks. Usage is bursty
and event-shaped: a delivery happens, the customer is standing there, and the post has to go up
while they are still smiling next to the car. That has three consequences:

1. **A five-minute outage during a delivery burst is worse than an hour at 3am.** Time-based
   availability under-counts this. Prefer a request-based or burst-weighted objective if the
   monitor supports it.
2. **A failed generation is not a retry, it is a lost moment.** Success rate matters more than
   raw uptime — the service can be "up" and still fail the salesperson if Gemini 500s.
3. **Latency has a hard human ceiling.** The person is standing in a parking lot holding a
   phone. Beyond roughly a minute they walk away and post from their own camera roll.

### 5.1 Availability

Measured as: the fraction of external monitor probes to `/api/app/health` (Monitor A, §3) that
return HTTP 200 with `"ok":true`, over a rolling 30 days.

> ### Decide and fill in — availability target
>
> | Value              | Recommended default                        | Reasoning                                                                                                                                                                                                                                                                                                                                                         |
> | ------------------ | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | Objective          | **99.5% / 30 days** (≈3h 39m error budget) | This is a single Fly machine with `min_machines_running = 1` and a mounted volume (`fly.toml:14-19`, `fly.toml:7-9`). There is no second machine and no failover. Promising 99.9% on a single-machine, single-volume deployment is a promise the architecture cannot keep — deploys alone consume budget. 99.5% is honest and still tight enough to force action. |
> | Measurement window | **rolling 30 days**                        | Matches the backup retention horizon of 30 archives (`scripts/pocketbase-r2-backup.mjs:16`), so incident and recovery evidence cover the same period.                                                                                                                                                                                                             |
> | Excluded           | **nothing**                                | Do not exclude deploy windows. `fly-deploy.yml` deploys the backend with `--wait-timeout 10m` (`fly-deploy.yml:335-337`); if a deploy takes the site down for a salesperson, that counts.                                                                                                                                                                         |
>
> If the owner wants a higher number, the honest path is a second Fly machine, not a smaller
> denominator.

### 5.2 Generation success rate

Measured as: `1 - (generation.providerFailures24h / generation.providerAttempts24h)` from the
admin health payload (`main.pb.js:1164-1189`), which reads the `generation_events` table.

Caveats that must be stated with any number:

- Video acceptance is counted as success (§4.4).
- `generation_events` rows are pruned after 14 days by the `prune-client-error-events` cron
  (`main.pb.js:1376-1406`), so a window longer than 14 days cannot be computed from this table.
- The upstream call itself is bounded at 300s for the Gemini/Veo proxy (`main.pb.js:383`), 120s
  for the Anthropic caption fallback (`main.pb.js:764`) and the OpenAI image fallback
  (`main.pb.js:646`), and 30s for the image fetch proxy (`main.pb.js:874`). A timeout lands as a
  failure.

> ### Decide and fill in — generation success target
>
> | Value               | Recommended default                                         | Reasoning                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
> | ------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | Objective           | **97% of provider attempts succeed, over a rolling 7 days** | The system already treats provider failure as expected, not exceptional: it counts `fallbackAttempts` and `basicFallbacks` as first-class fields (`main.pb.js:1059-1069`) and ships Claude and OpenAI fallback paths behind the `ENABLE_CLAUDE_FALLBACK` / `ENABLE_OPENAI_FALLBACK` flags (`main.pb.js:1245-1250`, `.env.example:11-12`). A target near 100% would be a target on Google's uptime, not on ours. 97% leaves room for upstream flakiness while catching a systemic break. |
> | Window              | **7 days**                                                  | Long enough to smooth a bursty weekend, comfortably inside the 14-day `generation_events` retention (`main.pb.js:1379-1393`).                                                                                                                                                                                                                                                                                                                                                           |
> | Secondary objective | **basic-fallback rate under 5% of posts_24h**               | `basicFallbacks24h` counts posts that shipped with a template caption instead of an AI one (`main.pb.js:1126`, `1137`). Users see this as "the AI stopped working" even while every probe is green.                                                                                                                                                                                                                                                                                     |

### 5.3 Latency

Measured as: `usage.dealers[].latencyMs.p50` / `.p95` from the admin health payload
(`helpers.js:1987`, computed nearest-rank at `helpers.js:2014-2044` via
`nearestRankPercentile`, `helpers.js:1909-1913`), which measures **upstream provider time inside
the proxy** — the interval around `$http.send` at `main.pb.js:375-388`. It does not include
browser render, upload, or client-side video polling.

**Read the `usage.truncated` flag before quoting a percentile.** The latency query returns at
most `GENERATION_USAGE_SUMMARY_MAX_LATENCY_ROWS` = 5000 rows for the whole window
(`helpers.js:1907`, `2014-2028`), ordered `dealer ASC, latency_ms ASC`. Once that bound is hit,
`usage.truncated` is set to `true` (`helpers.js:2026-2028`, rendered by the panel at
`components/SystemHealthPanel.tsx:749`) and the retained sample is the **fastest** requests of
the lowest-sorted dealer ids — dealers past the cut-off report `p50`/`p95` of `0` with
`samples: 0`. A truncated window therefore reads optimistically low. Treat any percentile from a
window with `truncated: true` as unusable, not as a passing number.

> ### Decide and fill in — latency targets
>
> Three separate targets, because three different things happen and the salesperson's patience
> differs for each.
>
> | Path                         | Recommended default                                                                                          | Reasoning                                                                                                                                                                                                                                                                    |
> | ---------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | Health probe                 | **p95 under 1s**                                                                                             | The public payload runs no per-dealer SQL (§2.2) and the machine is kept warm (`fly.toml:14-19`). Anything slower is a signal, and 10s is already the monitor timeout (§3).                                                                                                  |
> | Caption / image generation   | **p95 under 30s**                                                                                            | The hard ceilings are 300s on the primary Gemini proxy (`main.pb.js:383`) and 120s on the Anthropic/OpenAI fallbacks (`main.pb.js:764`, `646`) — both far past human patience. 30s is the practical ceiling for a person standing beside a car; past that they stop waiting. |
> | Video generation, end to end | **p95 under 120s**, hard failure at the existing 300s client timeout (`services/geminiService.ts:2862-2864`) | `fly.toml:16-18` already prices this: "cold start + Veo 90s = a salesperson watching a spinner for ~100s." 90s is the observed Veo figure the infrastructure was sized around, so 120s at p95 is the honest bound including overhead.                                        |
>
> Also undecided: **whether latency is an SLO at all today.** There is no way to collect these
> percentiles automatically — they exist only in an admin-gated JSON payload behind a session
> cookie. Recommended default: treat latency as a tracked indicator reviewed weekly, and promote
> it to an alerting SLO only once something scrapes it on a schedule.

---

## 6. Telemetry that already exists

### 6.1 Super-admin System Health panel

`components/SystemHealthPanel.tsx`. Fetches `/api/app/health` with `credentials: "include"`
(`:391`) and auto-refreshes every 60s while mounted (`:449-451`). It renders a one-line status
strip and puts full diagnostics behind a "Details" disclosure (`:371-376`).

Behaviour worth knowing at 2am:

- It renders the payload on **503 as well as 200** — the structured body _is_ the diagnostic UI
  (`:436-439`).
- On a transport failure or a 401 it clears the snapshot rather than showing stale green
  (`:392-400`, `:402-409`).
- Each check row is labelled critical or advisory with a one-line hint (`:250-369`) — that table
  is the fastest translation from "a boolean is false" to "here is the secret to set".

This is a pull surface. It monitors nothing when no browser tab is open.

### 6.2 Client telemetry: `utils/telemetry.ts` and `POST /api/telemetry`

Browser side (`utils/telemetry.ts`):

- Three levels: `info`, `warn`, `error` (`:1`), exported as `logEvent` / `logWarning` /
  `logError` (`:268-273`).
- Every event is written to a `localStorage` ring buffer under
  `dealer-social-post-ai.telemetry` (`:11`), capped at 200 events (`:189`, `:204`) and 14 days
  (`:18`).
- Payloads are sanitized before they are stored, logged, or sent: sensitive keys are replaced
  with `[REDACTED]` (`:34-70`) and VIN-like strings with `[REDACTED_VIN]` (`:23-32`).
- Every event carries `releaseSha` and `apiContractVersion` (`:247-252`).
- **Only `error`-level events leave the browser**, via `navigator.sendBeacon("/api/telemetry")`
  (`:217-227`). `info` and `warn` never reach the server.

Server side (`pb_hooks/main.pb.js:1319-1371`):

- Intentionally unauthenticated, because it captures pre-login errors (`:1324-1326`).
- Rate-limited to **30 events per IP per minute** (`:1327-1332`) and **240 per minute globally**
  (`:1333-1334`); over the global limit it returns 202 and stores nothing.
- A body whose re-serialized JSON is longer than **8000 characters** gets 413 (`:1338-1341`) —
  the bound is on `JSON.stringify(body).length`, not on the raw request byte count.
- Anything not `level === "error"` gets 202 and is discarded (`:1348-1350`).
- Only an allowlisted envelope is persisted — messages, VINs, names, codes, prompts and
  credentials are dropped server-side even if a tampered client sends them (`:1352-1355`).
- Persisted rows land in `client_error_events` and surface as `recentErrors.total24h` /
  `topActions` in the admin health payload (`:1216-1223`).
- Retention: the `prune-client-error-events` cron runs daily at `17 7 * * *` and deletes
  `client_error_events` and `generation_events` older than **14 days**, and `auth_events` older
  than **30 days** (`:1371-1401`).

There is no browser error-reporting service. `@sentry/react` was recommended in
`SECURITY_FIXES_2026-05-28.md:86` and `LAUNCH_READINESS_REVIEW_2026-05-28.md:180` and was never
wired; `package.json` has no Sentry dependency. This ring buffer plus `client_error_events` is
the whole of client observability.

### 6.3 Fly logs

There is no log drain. Logs are pulled on demand by a manual workflow,
`.github/workflows/fetch-fly-logs.yml`, which is `workflow_dispatch` only and runs:

```bash
flyctl logs --app dealer-social-post-ai-production --no-tail
```

Locally, with `FLY_API_TOKEN` set and flyctl installed (CI pins `0.4.71`,
`.github/workflows/pocketbase-backup.yml:32`):

```bash
flyctl logs --app dealer-social-post-ai-production --no-tail
```

Useful strings to grep for, all emitted by the proxy paths:

- `Too many concurrent provider requests` — HTTP 429, global provider concurrency exhausted
  (`main.pb.js:372`).
- `Too many concurrent image requests` / `Too many concurrent caption requests` — per-dealer
  concurrency caps (`main.pb.js:633`, `750`, `865`).
- `[proxy-image] fetch failed` — image proxy transport failure (`main.pb.js:931-934`).
- `Telemetry persistence error at stage` — telemetry ingestion fault (`main.pb.js:1367`).

Logs are not retained by this project, not searchable, and not alertable.

---

## 7. The daily backup drill as a monitoring signal

`.github/workflows/pocketbase-backup.yml` is the most informative recurring signal this system
produces, and it is easy to miss because its output is a GitHub Actions run, not an alert.

Schedule and shape:

- Cron `17 7 * * *` — daily, plus `workflow_dispatch` (`:3-6`).
- `timeout-minutes: 45`, environment `production-backup` (`:19-20`).
- Concurrency group `production-release-and-backup`, `cancel-in-progress: false` (`:11-13`) —
  it will never race a release.
- Gated on the GitHub Actions **environment variable** (`vars.`, not a secret)
  `POCKETBASE_R2_BACKUPS_ENABLED=true` on the `production-backup` environment; the job fails
  loudly if it is not `true` (`:77-84`). The R2 credentials themselves are separate secrets on
  the same environment — `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
  plus the `R2_BACKUP_PREFIX` variable (`:104-108`).

What each run proves, in order: it identifies the exact running production source
(`scripts/resolve-fly-backup-source.mjs`), takes a full backup to private R2 retaining **30**
archives (`scripts/pocketbase-r2-backup.mjs:16`), downloads and verifies that exact archive,
builds a disposable restore target, and restores it while verifying SQLite, collections,
migrations and startup (`scripts/verify-pocketbase-restore.sh`).

**The link to production readiness:** on success, and only when the source and target release
SHAs match, the workflow writes the evidence back to Fly as secrets
(`pocketbase-backup.yml:164-168`):

```
POCKETBASE_R2_BACKUPS_ENABLED=true
POCKETBASE_BACKUP_LAST_VERIFIED_AT=<ISO timestamp>
POCKETBASE_BACKUP_VERIFIED_RELEASE_SHA=<release sha>
```

Those three values are exactly what `/api/app/health` reads to compute `backup.status` and
`off_box_restore_ready` (`main.pb.js:986-1033`), which is a hard clause in `ok`
(`main.pb.js:1310-1311`).

So: **a silently failing backup workflow becomes a production readiness failure 168 hours later**
(`main.pb.js:1010`). That is the single most likely cause of a surprise `ok:false` on a system
nobody touched.

How to check it by hand:

```bash
gh run list --workflow pocketbase-backup.yml --limit 5
```

Expected: the most recent run is under ~24 hours old and `completed / success`.

If a run failed:

1. Read the failure — `gh run view <run-id> --log-failed`.
2. Confirm how much runway is left: read `backup.lastVerifiedAt` from `/api/app/health` and add
   168 hours (`main.pb.js:1010`).
3. Re-run it: `gh workflow run pocketbase-backup.yml`, then re-check `backup.status` is
   `verified`.
4. If the failure is `POCKETBASE_R2_BACKUPS_ENABLED != true`, the gate step found the
   `production-backup` environment **variable** unset or not `true`
   (`pocketbase-backup.yml:77-84`) — that step checks only the flag, so this failure says
   nothing either way about whether the R2 secrets are still present. The step's own message
   ("Set the production-backup environment variable `POCKETBASE_R2_BACKUPS_ENABLED=true` after
   R2 credentials are configured") is the one to follow.

Recovery procedure itself lives in `docs/production-backups-and-release.md` — this document only
covers the drill as a _signal_.

> ### Decide and fill in — backup-drill alerting
>
> The repository configures **no** notification for a failed workflow run. GitHub's default
> failure email is a per-account notification setting, not something this repo controls, and it
> is not a monitoring plan.
>
> Recommended default: a scheduled check that the newest `pocketbase-backup.yml` run is younger
> than **36 hours** (one daily cadence plus one missed run) and succeeded, routed to the same
> place as §4.2 alerts. Owner decides the mechanism — a second scheduled workflow, a
> Healthchecks.io-style dead-man's-switch ping at the end of the backup job, or the monitor
> vendor's cron-monitoring feature.

---

## 8. Two scheduled, known future failures

Neither is a bug. Both will turn CI red on a specific date and block deploys, and both look like
an outage if you have not been told.

**1. Gemini model-policy expiry — 2026-10-17.**
`scripts/check-model-policy.mjs:20-25` asserts `policyAgeDays <= 45` against
`config/gemini-model-policy.json`, whose `verifiedAt` is `2026-09-02`
(`config/gemini-model-policy.json:4`, mirrored at `pb_hooks/requestPolicies.js:302`). The age is
measured from `2026-09-02T00:00:00Z` (`check-model-policy.mjs:10-11`), and 45 days after that is
`2026-10-17T00:00:00Z`. The assertion is `<= 45`, so the check fails on **any run after
2026-10-17T00:00:00Z** — in practice, every CI run on or after 2026-10-17. CI runs it as
`npm run model-policy:check` (`package.json:31`, `.github/workflows/ci.yml:30`), and because
`fly-deploy.yml` triggers only on a successful CI run on `main`
(`.github/workflows/fly-deploy.yml:3-6`, `18-22`), **all deploys stop.** The fix is to
re-verify Google's live model catalog and refresh `verifiedAt` — not to bump `version`, which is
pinned at 5 and asserted by `scripts/check-model-policy.mjs:58-62`.

**2. Backup evidence staleness — 168 hours after the last successful drill.**
See §7. Detectable in advance from the public payload; there is no advance warning otherwise.

---

## 9. Deliberately not monitored today

State this plainly to anyone who asks what coverage exists.

| Not monitored                                       | Evidence                                                                                                                                                          | Consequence                                                                                                                                                                 |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anything at all, externally                         | No monitor named in the repo (§0)                                                                                                                                 | `ok:false` produces no notification.                                                                                                                                        |
| Deep readiness from Fly's own check                 | `fly.toml:22-28` — intentional                                                                                                                                    | A config-gap outage keeps returning 200 to Fly.                                                                                                                             |
| Application logs                                    | `fetch-fly-logs.yml` is `workflow_dispatch` only, no drain, no retention                                                                                          | Post-incident forensics are limited to whatever Fly still holds.                                                                                                            |
| Browser errors, as a product                        | No Sentry or equivalent; `package.json` has no such dependency; only `error`-level events reach `client_error_events`, pruned at 14 days (`main.pb.js:1379-1393`) | No stack traces, no release-over-release regression view.                                                                                                                   |
| `info` / `warn` telemetry                           | `utils/telemetry.ts:217-227` sends only `error` via `sendBeacon`                                                                                                  | Usage funnels and near-misses stay on the device.                                                                                                                           |
| Generation success rate, continuously               | Only in the admin-gated payload behind a super-admin cookie (`main.pb.js:1052-1080`)                                                                              | Nobody sees §5.2 unless a human opens the panel.                                                                                                                            |
| Latency, continuously                               | `usage.dealers[].latencyMs` is admin-gated and 7-day-windowed (`helpers.js:1924-2048`)                                                                            | No trend, no alert, no history past the 14-day prune.                                                                                                                       |
| Fly machine resource use (CPU, memory, disk)        | Nothing in the repo reads it; the 1GB sizing note at `fly.toml:36-38` records a past OOM                                                                          | A repeat OOM shows up as an outage, not as a warning.                                                                                                                       |
| Volume free space                                   | Not read anywhere; `pb_data` is a mounted volume (`fly.toml:7-9`)                                                                                                 | A full volume takes SQLite down with no warning.                                                                                                                            |
| Vercel frontend availability, independent of `/api` | Monitor A proxies through to Fly                                                                                                                                  | A frontend-only failure (bad alias, broken bundle) does not move the health probe. The release workflow checks this once at deploy (`fly-deploy.yml:590-596`), never after. |
| Cost / provider quota                               | Token and video-second totals exist in `usage` (`helpers.js:1973-1988`) but are admin-gated and never aggregated across dealers                                   | A quota exhaustion arrives as generation failures.                                                                                                                          |
| Backup workflow liveness                            | No notification configured (§7)                                                                                                                                   | A stopped drill is invisible for up to 7 days.                                                                                                                              |

---

## Verified against

Every claim above was read from these files on 2026-09-10, branch
`hardening/production-review-2026-09`:

- `fly.toml`
- `vercel.ts`
- `pb_hooks/main.pb.js` (health handler 957-1316; proxy-readiness 945-950; telemetry 1319-1366;
  prune cron 1371-1401; proxy timeouts 383, 646, 764, 874)
- `pb_hooks/helpers.js` (17, 30-33, 1616-1631, 1906-1913, 1924-2048, 2050-2072)
- `pb_hooks/requestPolicies.js` (298-313, 478-480)
- `config/gemini-model-policy.json`
- `scripts/check-model-policy.mjs`
- `scripts/pocketbase-r2-backup.mjs` (retention constant)
- `utils/telemetry.ts`
- `components/SystemHealthPanel.tsx`
- `services/geminiService.ts` (2862-2864, 2993)
- `package.json` (scripts block — `model-policy:check` at 31)
- `.github/workflows/ci.yml` (model-policy gate 30; health assertions 168-169)
- `.github/workflows/fly-deploy.yml` (trigger 3-6 and 18-22; readiness 335-362; origins 413-414;
  staged/live checks 560-596)
- `.github/workflows/pocketbase-backup.yml`
- `.github/workflows/fetch-fly-logs.yml`
- `.env.example` (secret names only)
- `LAUNCH_READINESS_REVIEW_2026-05-28.md`, `SECURITY_FIXES_2026-05-28.md` (historical, for the
  monitor and Sentry to-dos)
- `docs/production-backups-and-release.md` (cross-reference only)

Line numbers are from that snapshot. If a citation does not match, re-read the file before
trusting the surrounding sentence.
