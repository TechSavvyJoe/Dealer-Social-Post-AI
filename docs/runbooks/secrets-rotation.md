# Secrets rotation runbook

Every production secret in Dealer Social Post AI: what it protects, where it lives, how to
rotate it, and what breaks while you do.

Read the **Blast radius** column before you touch anything. Two secrets in this
inventory (`SALESPERSON_PIN_PEPPER` and `TURNSTILE_SECRET`) can take the product down for
real users in ways that are not obvious from the command you typed, and one of them
(`SALESPERSON_PIN_PEPPER`) is **not reversible**.

**Verified against** (every command, name, path, and number below was read out of these
files in this repository — nothing here is recalled or assumed):

| Source                                    | Used for                                                                                                                                                    |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/fly-deploy.yml`        | required Fly secret names (L258-L268), GitHub `production` / `production-backup` environments, `flyctl secrets set --stage` form (L326), Vercel release job |
| `.github/workflows/pocketbase-backup.yml` | backup environment secrets, schedule `17 7 * * *` (L5), `flyctl secrets set` form (L165)                                                                    |
| `pb_hooks/helpers.js`                     | `SALESPERSON_PIN_PEPPER` (L353, L371, L440), admin provisioning (L243-L326), proxy trust (L1620), Turnstile verify (L2787)                                  |
| `pb_hooks/main.pb.js`                     | provider keys (L57, L590, L708), readiness checks (L1238-L1316), `rotate-pin` route (L4850)                                                                 |
| `pb_hooks/websitePublications.js`         | Customer Hub config + HMAC (L279-L341, L1717-L1990)                                                                                                         |
| `pb_hooks/walkarounds.js`                 | Walkaround Studio broker/worker credentials (L89, L384-L419, L1782-L1990)                                                                                   |
| `scripts/check-secrets.mjs`               | the sensitive key names CI refuses to see committed                                                                                                         |
| `scripts/pocketbase-r2-backup.mjs`        | `POCKETBASE_ADMIN_*` auth path (L117-L124), `BACKUP_RETENTION = 30` (L16)                                                                                   |
| `scripts/vercel-staged-release.sh`        | pinned Vercel CLI `58.4.4` (L4), org/project ids (L7-L8), `vercel env list production --json` (L806)                                                        |
| `scripts/check-vercel-config.mjs`         | the compiled Vercel proxy-secret transform contract                                                                                                         |
| `vercel.ts`                               | `deploymentEnv("VERCEL_TO_FLY_PROXY_SECRET")` header injection (L67)                                                                                        |
| `.env.example`                            | documented meaning and length rules for each variable                                                                                                       |
| `fly.toml`                                | app name, single-machine `min_machines_running = 1`                                                                                                         |
| `docs/production-backups-and-release.md`  | the two already-documented rotations (L51-L88)                                                                                                              |

Two commands below come from CLI help on the operator machine rather than from a repo file,
and are marked inline where they appear: `gh secret set … --env` (verified with
`gh secret set --help`, gh 2.92.0) and the `flyctl tokens …` family (verified with
`flyctl tokens create deploy --help`, `flyctl tokens list --help`,
`flyctl tokens revoke --help`, flyctl v0.4.83). The repo contains no invocation of either.
Note the version skew: CI pins flyctl `0.4.71` (`fly-deploy.yml` L228,
`pocketbase-backup.yml` L32) while these flags were read from the newer local binary. The
flags used here also exist in the repo's own `flyctl secrets` calls, but re-check
`--help` if a `tokens` subcommand behaves unexpectedly.

---

## 0. Before you rotate anything

1. Know which surface you are touching. There are four independent stores:

   - **Fly secrets** on app `dealer-social-post-ai-production` (`fly.toml` L1) — the
     PocketBase backend runtime. Read by `$os.getenv(...)` in `pb_hooks/*.js`.
   - **GitHub Actions environment secrets** in the protected environments `production`
     (`fly-deploy.yml` L220, L409) and `production-backup` (`fly-deploy.yml` L25,
     `pocketbase-backup.yml` L20) — CI/CD only, never seen by the running app.
   - **Vercel project environment variables** on project `dealer-social-post-ai`
     (`scripts/vercel-staged-release.sh` L7-L8: org `team_Tc8DG6XMPUCefkTa3u71mmlN`,
     project `prj_h5phWNMNtK4D9dqwbOHrrrRMqrRi`).
   - **The provider's own console** (Google AI Studio, Cloudflare, Cloudflare R2, Fly,
     Vercel) — where the credential is actually minted and revoked.

2. Never echo a secret. `entrypoint.sh` deliberately refuses `set -x` for this reason.
   Use `set +x` in your shell, feed values on stdin, and `unset` afterwards — the pattern
   already used in `docs/production-backups-and-release.md` L57-L64.

3. Understand the restart. `flyctl secrets set` and `flyctl secrets import` **redeploy the
   machine** unless you pass `--stage` (verified: `flyctl secrets import --help` →
   `--stage  Set secrets but skip deployment for machine apps`). `fly.toml` runs
   `min_machines_running = 1` on a single machine with a mounted volume, so that restart is
   a short full outage and **kills every in-flight generation**. `fly.toml` notes Veo video
   generation takes ~90s, so a restart mid-morning can discard a salesperson's video.

   Rotate provider keys and anything else non-urgent **outside dealership selling hours**.

4. Confirm the result. Public aggregate readiness:

   ```bash
   curl --silent --show-error --fail --max-time 20 \
     https://dealer-social-post-ai-production.fly.dev/api/app/health
   ```

   `pb_hooks/main.pb.js` L1296-L1316 makes `ok:false` (HTTP 503) whenever
   `gemini_key_set`, `admin_login_configured`, `trusted_proxy_configured`,
   `pin_pepper_configured`, `turnstile_secret_set`, `turnstile_site_key_set`,
   `turnstile_hostnames_configured`, `off_box_restore_ready`, or
   `website_integration_configured` fails on Fly. The named per-check booleans require a
   super-admin session cookie (`main.pb.js` L964-L965); the public body is aggregate only.

   Fly's own liveness check points at PocketBase's `/api/health`, **not** `/api/app/health`
   (`fly.toml` comment), so a broken secret shows up as `ok:false` on the app health route
   while Fly happily keeps serving. Do not assume "the machine is up" means "the rotation
   worked."

---

## 1. Inventory

### 1a. Fly runtime secrets — required, deploy-gated

`fly-deploy.yml` L258-L268 lists exactly ten names. If any is missing from
`flyctl secrets list`, **the production deploy job fails before it deploys**.

| Secret                        | Protects                                                                                              | Set in                            | Owner                            | Blast radius on rotation                                                                                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SALESPERSON_PIN_PEPPER`      | HMAC key for every stored salesperson access code (`helpers.js` L371-L380)                            | Fly                               | Super admin (Joe)                | **IRREVERSIBLE.** Every stored access code stops working. Existing sessions survive. See §3.                                                                    |
| `ADMIN_LOGIN_PASSWORD`        | System-administrator sign-in                                                                          | Fly                               | Super admin                      | Invalidates outstanding admin sessions (token key changes). Already documented — see §4.                                                                        |
| `ADMIN_LOGIN_USERNAME`        | System-administrator identity                                                                         | Fly                               | Super admin                      | Renames the single admin account at boot (`helpers.js` L292-L301). **Assume admin sessions are invalidated too** — that branch re-applies the password. See §4. |
| `GEMINI_API_KEY`              | All primary caption/image/video generation (`main.pb.js` L57)                                         | Fly                               | Super admin                      | Restart kills in-flight generations. Zero-downtime is impossible on one machine; do it off-hours.                                                               |
| `TURNSTILE_SECRET`            | Cloudflare Turnstile siteverify (`helpers.js` L2787)                                                  | Fly                               | Super admin                      | **Coordinated frontend+backend.** Paired with the public site key. Rotating one alone breaks challenged logins. See §5.                                         |
| `VERCEL_TO_FLY_PROXY_SECRET`  | Authenticates Vercel's `/api` rewrite to Fly (`vercel.ts` L67, `helpers.js` L1620-L1631)              | Fly **and** Vercel                | Super admin                      | **Coordinated, and Vercel needs a redeploy.** See §6. Already documented — link below.                                                                          |
| `CUSTOMER_HUB_SECRET`         | HMAC signing of Customer Hub draft handoffs (`websitePublications.js` L312, L1717-L1721, L1973-L1985) | Fly **and** the Customer Hub site | Super admin + Customer Hub owner | **Coordinated with an external system.** Mismatch = every publish attempt fails signature. Must be 32-512 chars, trimmed (`websitePublications.js` L318-L319).  |
| `CUSTOMER_HUB_URL`            | Destination origin (must be `https`, or loopback)                                                     | Fly                               | Super admin                      | Not a credential, but a wrong value silently disables the destination (`websitePublications.js` L287-L307).                                                     |
| `CUSTOMER_HUB_DESTINATION_ID` | Destination identifier, `^[a-z0-9][a-z0-9_-]{0,79}$`                                                  | Fly                               | Super admin                      | Not a credential. Invalid value falls back to `joe_customer_hub`.                                                                                               |
| `CUSTOMER_HUB_DEALER_ID`      | Single-tenant guard: only this dealer may publish (`websitePublications.js` L314, L320-L330)          | Fly                               | Super admin                      | Not a credential. Wrong value disables the integration and fails `website_integration_configured` readiness.                                                    |

### 1b. Fly runtime secrets — optional / feature-gated

None of these appear in the deploy-gate list, so removing one does not block a deploy — it
just turns the feature off.

| Secret                             | Protects                                                                                         | Set in             | Owner       | Blast radius on rotation                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`                | Claude fallback proxy (`main.pb.js` L708)                                                        | Fly                | Super admin | Only matters when `ENABLE_CLAUDE_FALLBACK=true`. Restart still kills in-flight work.                                   |
| `OPENAI_API_KEY`                   | OpenAI image fallback (`main.pb.js` L590)                                                        | Fly                | Super admin | Only matters when `ENABLE_OPENAI_FALLBACK=true`.                                                                       |
| `WALKAROUND_WORKER_TOKEN`          | Bearer token for worker callbacks (`walkarounds.js` L1785)                                       | Fly + worker fleet | Super admin | Feature is dark unless `WALKAROUND_STUDIO_ENABLED=true` (`walkarounds.js` L89-L99). Coordinated with the worker fleet. |
| `WALKAROUND_WORKER_SIGNING_SECRET` | HMAC of worker requests and dispatcher lease tokens (`walkarounds.js` L1786, L1873, L1983-L1988) | Fly + worker fleet | Super admin | Coordinated. Also invalidates outstanding dispatcher leases, since the lease token is derived from this secret.        |
| `WALKAROUND_UPLOAD_BROKER_TOKEN`   | Private upload broker auth (`walkarounds.js` L387)                                               | Fly + broker       | Super admin | Must be ≥32 chars and trimmed or the broker config is discarded entirely (`walkarounds.js` L391-L397).                 |
| `WALKAROUND_YOUTUBE_BROKER_TOKEN`  | Private YouTube broker auth (`walkarounds.js` L408)                                              | Fly + broker       | Super admin | Same ≥32-char rule (`walkarounds.js` L412-L418).                                                                       |

### 1c. GitHub Actions environment secrets

| Secret                      | Protects                                                                                                                     | Set in                                                                       | Owner       | Blast radius on rotation                                                                                                                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FLY_API_TOKEN`             | All CI access to Fly: source attestation, volume prep, deploy, diagnostics, restore-evidence refresh                         | GitHub env `production` **and** `production-backup` (used in both workflows) | Super admin | Nothing breaks for users. A stale token fails both the nightly drill and every deploy. **Must be updated in both environments** — the workflows read it separately.                                    |
| `POCKETBASE_ADMIN_EMAIL`    | PocketBase superuser identity for the backup API (`pocketbase-r2-backup.mjs` L121)                                           | GitHub env `production-backup`                                               | Super admin | Nightly backup + the pre-release `backup-gate` job fail. `backup-gate` failing blocks every production deploy.                                                                                         |
| `POCKETBASE_ADMIN_PASSWORD` | PocketBase superuser password (`pocketbase-r2-backup.mjs` L123)                                                              | GitHub env `production-backup` **and** the PocketBase admin UI               | Super admin | Same as above, plus: **there is no env-driven provisioning for this account.** `entrypoint.sh` does not create it. You must change it in the PocketBase admin UI first, then update the GitHub secret. |
| `R2_ENDPOINT`               | Cloudflare R2 S3 endpoint                                                                                                    | GitHub env `production-backup`                                               | Super admin | Backups and the restore drill fail; deploys blocked.                                                                                                                                                   |
| `R2_BUCKET`                 | R2 bucket name                                                                                                               | GitHub env `production-backup`                                               | Super admin | As above.                                                                                                                                                                                              |
| `R2_ACCESS_KEY_ID`          | R2 S3 access key                                                                                                             | GitHub env `production-backup`                                               | Super admin | As above. Old backup objects remain readable only via a credential that can still reach the bucket — do not revoke the old key until the new one has completed one successful drill.                   |
| `R2_SECRET_ACCESS_KEY`      | R2 S3 secret                                                                                                                 | GitHub env `production-backup`                                               | Super admin | As above.                                                                                                                                                                                              |
| `VERCEL_TOKEN`              | Vercel CLI auth for the `release-frontend` job (`fly-deploy.yml` L415, and the job refuses to start without it at L436-L441) | GitHub env `production`                                                      | Super admin | Frontend releases stop. Backend deploys still succeed, so the two origins silently drift — exactly the failure mode `release-frontend` exists to prevent.                                              |

### 1d. Vercel project environment variables

| Variable                     | Protects                                                                                 | Set in                                                                              | Owner       | Blast radius on rotation                                                                                                                                                                                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VERCEL_TO_FLY_PROXY_SECRET` | Injected as the `x-dealer-proxy-secret` request header on `/api/*` (`vercel.ts` L60-L69) | Vercel production, marked **sensitive**                                             | Super admin | Must be identical to the Fly value **and requires a new Vercel deployment to take effect** — the value is baked into the compiled route transform at deploy time. `scripts/vercel-staged-release.sh` L275-L286 fails the release if this variable is not sensitive. |
| `VITE_TURNSTILE_SITE_KEY`    | Public Turnstile site key compiled into the browser bundle                               | Vercel production, must **not** be sensitive (`vercel-staged-release.sh` L288-L297) | Super admin | Public value, not a secret, but paired with `TURNSTILE_SECRET`. See §5.                                                                                                                                                                                             |

### 1e. Values that look like secrets and are not

Do not treat these as credentials; they are configuration, and several are intentionally
public.

- `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` — hard-pinned as plain constants in
  `fly-deploy.yml` L423-L424 and `vercel-staged-release.sh` L7-L8, with a comment
  explaining that reading them from a secret previously caused a silent failure.
- GitHub environment **variables** (not secrets): `POCKETBASE_R2_BACKUPS_ENABLED`,
  `POCKETBASE_BACKUP_URL`, `R2_BACKUP_PREFIX`, `VITE_TURNSTILE_SITE_KEY`,
  `TURNSTILE_ALLOWED_HOSTNAMES`, `TURNSTILE_ENFORCEMENT_ENABLED`,
  `LEGACY_CLIENT_COMPATIBILITY_ENABLED`, `ALLOW_FLY_IMAGE_IDENTITY_BOOTSTRAP`,
  `FLY_IMAGE_IDENTITY_BOOTSTRAP_EXPIRES_AT`. Managed with `gh variable set --env`
  (`docs/production-backups-and-release.md` L35-L44).
- Fly values staged by the deploy job itself, which you should never set by hand because
  the next deploy overwrites them (`fly-deploy.yml` L326-L335): `RELEASE_SHA`,
  `TURNSTILE_SITE_KEY`, `TURNSTILE_ALLOWED_HOSTNAMES`, `TURNSTILE_ENFORCEMENT_ENABLED`,
  `LEGACY_CLIENT_COMPATIBILITY_ENABLED`, `POCKETBASE_R2_BACKUPS_ENABLED`,
  `POCKETBASE_BACKUP_LAST_VERIFIED_AT`, `POCKETBASE_BACKUP_VERIFIED_RELEASE_SHA`.
- `IMAGE_PROXY_ALLOWED_HOSTS`, `GEMINI_API_URL_BASE`, `ALLOW_TEST_PROVIDER_ORIGIN` —
  runtime policy knobs, not credentials.

`scripts/check-secrets.mjs` L38-L41 is CI's tripwire for these names appearing as literals
in tracked files: `GEMINI_API_KEY`, `VERTEX_API_KEY`, `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, `PROXY_ACCESS_TOKEN`, `VITE_PROXY_ACCESS_TOKEN`, `PB_ADMIN_EMAIL`,
`PB_ADMIN_PASSWORD`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_PASS`, `ADMIN_DEALER_CODE`,
`ADMIN_LOGIN_PASSWORD`. If a rotation ever makes you want to paste a value into a file,
CI will reject the commit — that is working as intended.

---

## 2. The generic Fly-secret rotation

Use this for `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and the
`CUSTOMER_HUB_*` / `WALKAROUND_*` values. Do **not** use it for
`SALESPERSON_PIN_PEPPER` (§3) or `TURNSTILE_SECRET` (§5) without reading those sections.

1. Mint the new credential in the provider console. Do not revoke the old one yet.

2. Install it on Fly without printing it. `flyctl secrets import` reads `NAME=VALUE` pairs
   from stdin (verified: `flyctl secrets import --help`), which is the form
   `docs/production-backups-and-release.md` L57-L64 already uses:

   ```bash
   set +x
   read -r -s -p "New GEMINI_API_KEY: " NEW_VALUE
   printf '\n'
   printf 'GEMINI_API_KEY=%s\n' "$NEW_VALUE" |
     flyctl secrets import --app dealer-social-post-ai-production
   unset NEW_VALUE
   ```

   Expected output: `flyctl` reports the secret set and then monitors a machine update to
   completion. This is the restart described in §0.3.

3. Confirm the name exists (values are never returned):

   ```bash
   flyctl secrets list --app dealer-social-post-ai-production --json
   ```

   This is the same call `fly-deploy.yml` L248 makes to gate the deploy. Expect a JSON
   array of objects with `Name` and a digest — never a value.

4. Confirm readiness recovered:

   ```bash
   curl --silent --show-error --fail --max-time 20 \
     https://dealer-social-post-ai-production.fly.dev/api/app/health
   ```

   Expect HTTP 200 with `"ok":true`. A 503 means one of the readiness-critical checks in
   `main.pb.js` L1296-L1316 is failing.

5. Generate one real post end to end in the app before revoking the old credential.

6. Revoke the old credential in the provider console.

**If step 2 fails** (`flyctl` reports an auth error): your local `flyctl` session is
expired. Re-authenticate interactively; do not paste `FLY_API_TOKEN` into a shell you are
also using to type secrets.

**If step 4 returns 503** after a provider-key rotation, the key is wrong or truncated.
Re-run step 2 with the value pasted from the provider console rather than retyped. If
readiness stays red, restore the old value the same way — you did not revoke it in step 1.

**If the machine will not come back**, capture diagnostics the way the workflow does
(`fly-deploy.yml` L384-L391):

```bash
flyctl status --app dealer-social-post-ai-production
flyctl machine list --app dealer-social-post-ai-production
flyctl logs --app dealer-social-post-ai-production --no-tail
```

Because `entrypoint.sh` refuses `set -x`, secrets will not appear in that log output.

---

## 3. `SALESPERSON_PIN_PEPPER` — read this before you type anything

### What it actually does

`pb_hooks/helpers.js` L364-L381:

```js
const pepper = salespersonPinPepper();
if (pepper.length < 32) {
  throw new Error("SALESPERSON_PIN_PEPPER is not configured");
}
const digest = $security.hs256(
  "dealer-social-post-ai:person-pin-hash:v1:" + normalized,
  pepper,
);
```

Each salesperson's 4-digit access code is stored **only** as
`HMAC-SHA256(pepper, "…:v1:" + code)` in `salespeople.pin_hash`. The plaintext column is
blanked in the same save that writes the hash (`main.pb.js` L4568-L4569, L4881-L4883).
Login looks the code up by recomputing that hash (`helpers.js` L1235, L1249-L1259).

`POST /api/app/salespeople/:id/reveal-pin` returns **HTTP 410 `PIN_REVEAL_RETIRED`**
(`main.pb.js` L4915-L4926) — "Access codes are stored hashed and can no longer be
revealed." There is no path back to the original digits.

### What rotating it does — honestly

- **Every existing access code stops working immediately at login.** The stored hashes were
  computed under the old pepper; the new pepper produces different digests, so
  `findActivePersonByPin` matches nothing (`helpers.js` L1249-L1265).
- **You cannot recover the codes.** They were never stored. Rotation is one-way.
- **Already-signed-in users are _not_ logged out**, which is the counter-intuitive part.
  Session validity is bound to `personPinFingerprint`, which hashes the _stored_
  `pin_hash` value (`helpers.js` L388-L392), and that stored value does not change when the
  pepper changes. `helpers.js` L697-L703 compares the session's fingerprint against a
  freshly computed one and they still agree. So the failure is invisible until a
  salesperson signs out, clears data, gets a new phone, or their session expires — and then
  they are locked out with no self-service recovery.
- **Nobody can be created or re-activated either**, because `personPinHash` is on the write
  path for create (`main.pb.js` L4433) and update (L4561).
- There _is_ a legacy plaintext fallback at `helpers.js` L1267-L1284, but it only matches
  rows a bootstrap sweep has not yet converted. On a healthy production database it matches
  nothing, so do not count on it.

### When rotation is actually the right call

Only when the pepper itself is believed compromised — someone read Fly secrets, or the
value leaked into a log or a screen share. A leaked _database_ does not require a pepper
rotation; the pepper is exactly what makes a copied `salespeople` table useless against a
10⁴ keyspace (`helpers.js` L358-L362).

If you only need to revoke one person's code, use per-person rotation instead — that is the
whole reason the endpoint exists, and `.env.example` L26-L27 says so directly: _"Rotating it
invalidates every stored code — never rotate casually; rotate-pin each person instead."_

### Preferred alternative: rotate one person

`POST /api/app/salespeople/:id/rotate-pin` (`main.pb.js` L4850-L4893) mints a new unique
code, revokes that person's sessions, sets `pin_needs_distribution`, and **returns the new
code once in the response body**. It requires a dealer-admin or super-admin session cookie.
Do this from the app's manager UI. Managers can only rotate salespeople in their own dealer;
super admin can rotate anyone (`main.pb.js` L4872-L4878).

### If you must rotate the pepper: the full procedure

Do this **outside selling hours**, with the dealer admins on a call, because you are about
to hand out new codes to every person on the roster.

1. Take a fresh off-box backup first. Run the drill workflow manually
   (`pocketbase-backup.yml` supports `workflow_dispatch`, L6) and wait for it to go green.
   Do not proceed on last night's copy.

2. Enumerate everyone who will be locked out, before you break them. As a super admin,
   list the roster via `GET /api/app/salespeople` (`main.pb.js` L4212) and save the ids and
   names. Do this **first** — after the rotation you will still be able to list people, but
   you will have no way to tell who had a working code.

3. Set the new pepper. Must be ≥32 characters (`helpers.js` L370); `.env.example` L24
   suggests `openssl rand -hex 24` (48 hex chars):

   ```bash
   set +x
   NEW_PEPPER="$(openssl rand -hex 24)"
   printf 'SALESPERSON_PIN_PEPPER=%s\n' "$NEW_PEPPER" |
     flyctl secrets import --app dealer-social-post-ai-production
   unset NEW_PEPPER
   ```

4. Confirm readiness is green again (the `pin_pepper_configured` check, `main.pb.js`
   L1277, requires ≥32 chars):

   ```bash
   curl --silent --show-error --fail --max-time 20 \
     https://dealer-social-post-ai-production.fly.dev/api/app/health
   ```

   Expect `"ok":true`.

5. Re-issue a code for **every** person on the list from step 2, one at a time, via the
   manager UI's rotate action (`POST /api/app/salespeople/:id/rotate-pin`). Each call
   returns that person's new code exactly once — write it down for distribution before you
   move to the next person. There is no bulk endpoint; the only route is per-person
   (`main.pb.js` L4850).

6. Distribute the new codes through whatever channel the dealership already uses for
   credentials. Never put them in the repo, a ticket, or a group chat.

**If you rotate and then realise it was a mistake:** put the old pepper value back with the
same `flyctl secrets import` command and every existing `pin_hash` becomes valid again —
_provided you still have the old value_. This is the only reason to copy the outgoing pepper
into a password manager before step 3. Once it is gone, it is gone.

**If step 5 fails partway through**, people whose code you already rotated have a working
new code and people you have not reached yet are locked out. Finish the list. `main.pb.js`
L4883 sets `pin_needs_distribution = true` on each rotated person (L4880 is the
session revocation), so the manager UI can
show you who still needs their code handed over.

---

## 4. `ADMIN_LOGIN_PASSWORD` / `ADMIN_LOGIN_USERNAME` — already documented

**Do not duplicate this procedure here.** The password rotation, including the SQLite
statement that makes admin-session revocation immediate instead of lazy, is in
[`docs/production-backups-and-release.md` → "Administrator credential rotation"](../production-backups-and-release.md#administrator-credential-rotation)
(L75-L88).

Facts worth knowing before you follow it:

- The account is provisioned and rotated **at boot** from these two Fly secrets
  (`helpers.js` L243-L326). You change the secret; the next start applies it.
- Changing the password changes the PocketBase account token key, which invalidates
  outstanding admin sessions on its own (`helpers.js` L317-L322). The `DELETE FROM sessions`
  step in the linked procedure just makes it immediate.
- Changing **only** the username renames the single existing account
  (`helpers.js` L292-L301). Plan for it to log administrators out as well: that branch
  calls `setUsername(username)` **and** `setPassword(password)` (L296-L297), and admin
  sessions are bound to the account's token key (`helpers.js` L187-L198 and L518-L531
  derive the session fingerprint from `tokenKey`; L697-L732 rejects a session whose
  fingerprint no longer matches). The repo's own comment at L318-L322 states the token key
  changes with the password. Whether PocketBase 0.22 refreshes the token key when
  `setPassword` is handed the _unchanged_ password is a PocketBase-internals question this
  repository does not answer — so treat a username rename as session-invalidating until
  someone verifies otherwise on a staging instance. Have the new username and the current
  password to hand before you do it.
- Constraints are enforced and a bad value is silently ignored with an error log
  (`helpers.js` L266-L273): username 3-32 chars starting with a letter, password 8-128
  characters.
- If more than one admin account exists and none matches the new username, provisioning
  **refuses to change anything** (`helpers.js` L284-L291). Check the logs after a rotation.

A related, sharper procedure — rotating the admin password _and_ flipping Turnstile
enforcement in one restart — is at
[`docs/production-backups-and-release.md` → "Post-promotion security cutover"](../production-backups-and-release.md#post-promotion-security-cutover)
(L211-L232).

---

## 5. `TURNSTILE_SECRET` + `VITE_TURNSTILE_SITE_KEY` — coordinated, four places

Cloudflare mints these as a **pair** per widget. Rotating the widget invalidates both. The
public site key is compiled into the browser bundle, so this is a genuine
frontend-and-backend change.

The four places the pair lives, all read out of the workflows:

1. **Cloudflare** — the widget itself. Action is `turnstile-spin-v2`
   (`docs/production-backups-and-release.md` L53).
2. **Fly secret `TURNSTILE_SECRET`** — server-only, used by `verifyTurnstileToken`
   (`helpers.js` L2787).
3. **GitHub environment variable `VITE_TURNSTILE_SITE_KEY`, in _both_ `production` and
   `production-backup`.** The deploy job hashes both and **refuses to deploy if they
   differ** (`fly-deploy.yml` L302-L306). It also stages the same value onto Fly as
   `TURNSTILE_SITE_KEY` (L328).
4. **Vercel production env `VITE_TURNSTILE_SITE_KEY`** — must exist and must **not** be
   marked sensitive (`vercel-staged-release.sh` L288-L297), and the built bundle must
   actually contain it (L339-L341).

Every official Cloudflare test key is rejected on Fly and in both release paths
(`fly-deploy.yml` L176-L181, L296-L301; `vercel-staged-release.sh` L317-L328).

### Order of operations

Rotate the **secret** first and the **site key** last, so no user is ever presented with a
site key the backend cannot verify.

1. Create the new widget in Cloudflare. Set its allowed hostnames to match
   `TURNSTILE_ALLOWED_HOSTNAMES`, which
   `docs/production-backups-and-release.md` L53 pins to
   `dealer-social-post-ai.vercel.app,dealer-social-post-ai-production.fly.dev`.

2. **If enforcement is currently on**, consider turning it off for the window. The GitHub
   variable form is in the repo (`docs/production-backups-and-release.md` L221):

   ```bash
   gh variable set TURNSTILE_ENFORCEMENT_ENABLED --env production --body false
   ```

   Note this only affects the _next_ deploy, since the value reaches Fly through
   `fly-deploy.yml` L330. To change it now, stage it directly on Fly with the same
   `flyctl secrets import` pattern.

3. Install the new secret on Fly:

   ```bash
   set +x
   read -r -s -p "New TURNSTILE_SECRET: " NEW_SECRET
   printf '\n'
   printf 'TURNSTILE_SECRET=%s\n' "$NEW_SECRET" |
     flyctl secrets import --app dealer-social-post-ai-production
   unset NEW_SECRET
   ```

   Readiness requires ≥20 characters and rejects test secrets on Fly
   (`main.pb.js` L1265-L1267).

4. Set the public site key in **both** GitHub environments — mismatched values block the
   deploy:

   ```bash
   gh variable set VITE_TURNSTILE_SITE_KEY --env production --body "<new site key>"
   gh variable set VITE_TURNSTILE_SITE_KEY --env production-backup --body "<new site key>"
   ```

5. Set it in Vercel production. `--force` overwrites the existing value; the form is from
   `docs/production-backups-and-release.md` L62 (adapted to the non-sensitive variable —
   note the deliberate absence of `--sensitive`: `vercel-staged-release.sh`
   L288-L297 fails the release if this variable is marked sensitive):

   ```bash
   printf '%s' "<new site key>" |
     npx vercel@58.4.4 env add VITE_TURNSTILE_SITE_KEY production --force --yes
   ```

6. **Ship a release.** The site key is a build-time `VITE_` value baked into the bundle
   (`Dockerfile` L10, L15; `fly-deploy.yml` L190). Until a new frontend deploys, browsers
   still render the old widget. Merge to `main` and let `Deploy production` run, or use the
   staged ceremony in `docs/production-backups-and-release.md`.

7. Verify. `docs/production-backups-and-release.md` L237 describes the proof: three
   known-invalid synthetic codes stay frictionless, the fourth returns
   `CHALLENGE_REQUIRED`, the managed widget renders, and it succeeds only with
   hostname/action/token validation. Heed the warning at L240 — failed sign-ins share a
   15-minute IP risk bucket, so use separate clean egress IPs or wait out the window.

8. Delete the old widget in Cloudflare.

**If challenged logins break mid-rotation:** `verifyTurnstileToken` returns
`{ ok:false, unavailable:true }` for a missing secret, a test secret on Fly, or an empty
hostname allowlist (`helpers.js` L2789-L2804), and the app is built to report that as a
verifier outage rather than a bad PIN
(`docs/production-backups-and-release.md` L237). The fastest recovery is to set
`TURNSTILE_ENFORCEMENT_ENABLED=false` on Fly, which removes the challenge without touching
the credential pair. `docs/production-backups-and-release.md` L240 is explicit: never
deliberately break the production verifier secret to test negative paths.

---

## 6. `VERCEL_TO_FLY_PROXY_SECRET` — already documented, plus what the doc does not say

The creation/installation procedure is at
[`docs/production-backups-and-release.md` → "Turnstile and trusted Vercel proxy"](../production-backups-and-release.md#turnstile-and-trusted-vercel-proxy)
(L51-L64). The same commands rotate it — `flyctl secrets import` overwrites, and
`vercel env add … --force` overwrites.

Four things to know that the linked section does not spell out:

- **The Vercel side needs a redeploy.** `vercel.ts` L67 injects the value through
  `deploymentEnv(...)`, compiled into the route transform at build time
  (`check-vercel-config.mjs` L49-L58 asserts exactly that shape). Changing the env var does
  not change any already-deployed frontend.
- **Therefore rotation is a brief mismatch window by construction.** Set Fly and Vercel,
  then deploy the frontend. Between those, the live frontend sends the old header.
- **A mismatch does not take the site down.** `trustedVercelProxyRequest`
  (`helpers.js` L1616-L1631) only gates whether Vercel's forwarded client IP is trusted;
  `clientIP` falls back to `Fly-Client-IP` and then `remoteAddr`
  (`helpers.js` L1633-L1652). The visible effect is that rate limiting, audit records, and
  the 15-minute IP risk bucket start attributing every request to Vercel's edge rather than
  the real user — which can lock a whole dealership out of login together.
- **It does block releases.** `/api/app/proxy-readiness` returns 503 when the header does
  not match (`main.pb.js` L945-L950), and the `release-frontend` job asserts `"ok":true` on
  the staged deployment (`fly-deploy.yml` L564-L566). Readiness also requires ≥32 characters
  (`main.pb.js` L1273-L1274), and `helpers.js` L1625 compares lengths before hashing, so a
  trailing newline is a mismatch.

Verify after a rotation, from the Vercel origin (the Fly origin will always fail this
because it has no injected header):

```bash
curl --silent --show-error --max-time 20 \
  https://dealer-social-post-ai.vercel.app/api/app/proxy-readiness
```

Expect HTTP 200 and `{"ok":true}`. HTTP 503 means the deployed frontend and Fly disagree.

Confirm the Vercel side is still stored as sensitive — the release script fails otherwise:

```bash
npx vercel@58.4.4 env list production --json
```

---

## 7. CI/CD credentials

### `FLY_API_TOKEN`

Used by both workflows and in two GitHub environments. Rotating it breaks nothing for users
and everything for automation.

1. Mint a scoped replacement. `flyctl tokens create deploy` produces a token limited to a
   single app (verified: `flyctl tokens create deploy --help`; note the default expiry is
   `175200h`, i.e. 20 years, and the help text recommends shorter):

   ```bash
   flyctl tokens create deploy --app dealer-social-post-ai-production \
     --name "gha-deploy-$(date -u +%Y%m%d)" --expiry 8760h
   ```

   > `flyctl tokens …` does not appear in this repository. The flags above were confirmed
   > from `flyctl tokens create deploy --help` on the operator machine. `--expiry 8760h`
   > (one year) is a **recommended default, not a repo value** — see "Decide and fill in".

2. Install it in **both** GitHub environments. Piping avoids `--body` landing in shell
   history:

   > `gh secret set` does not appear in this repository either. `--env` was confirmed from
   > `gh secret set --help`; the environment names `production` and `production-backup`
   > come from `fly-deploy.yml` L220/L409 and L25, and `pocketbase-backup.yml` L20. The
   > sibling `gh variable set --env` form _is_ in the repo at
   > `docs/production-backups-and-release.md` L35.

   ```bash
   set +x
   read -r -s -p "New FLY_API_TOKEN: " NEW_TOKEN
   printf '\n'
   printf '%s' "$NEW_TOKEN" | gh secret set FLY_API_TOKEN --env production
   printf '%s' "$NEW_TOKEN" | gh secret set FLY_API_TOKEN --env production-backup
   unset NEW_TOKEN
   ```

3. Prove it works **before** revoking the old one. Run the backup workflow manually
   (`pocketbase-backup.yml` L6 allows `workflow_dispatch`) — its "Identify the exact running
   production source" step is the first thing that authenticates to Fly
   (`pocketbase-backup.yml` L34-L45). Wait for green.

4. Revoke the old token (verified: `flyctl tokens list --help`, `flyctl tokens revoke --help`):

   ```bash
   flyctl tokens list --app dealer-social-post-ai-production
   flyctl tokens revoke <ID>
   ```

**If the workflow fails at "Identify the exact running production source"**, the new token
lacks scope for `flyctl machine list` on that app. Re-mint with `flyctl tokens create deploy`
scoped to the app rather than a read-only org token.

### `VERCEL_TOKEN`

Mint a new token in the Vercel account settings, then:

```bash
set +x
read -r -s -p "New VERCEL_TOKEN: " NEW_TOKEN
printf '\n'
printf '%s' "$NEW_TOKEN" | gh secret set VERCEL_TOKEN --env production
unset NEW_TOKEN
```

Only the `production` environment uses it (`fly-deploy.yml` L409, L415). The
`release-frontend` job fails immediately and explicitly if it is empty
(`fly-deploy.yml` L436-L441), so a bad rotation shows up as a clear error rather than a
silent skip. Revoke the old token in Vercel afterwards.

The token must reach the org and project pinned at `fly-deploy.yml` L423-L424; the job
verifies the link after `vercel pull` and blocks on mismatch (L465-L473).

### `POCKETBASE_ADMIN_EMAIL` / `POCKETBASE_ADMIN_PASSWORD`

This is the PocketBase **superuser**, authenticated at `/api/admins/auth-with-password`
(`pocketbase-r2-backup.mjs` L117-L124). It is a different account from the app's
system-administrator login in §4, and **nothing in this repo provisions it** — `entrypoint.sh`
only starts PocketBase.

1. Change the password in the PocketBase admin UI, on the production instance.
2. Update the GitHub secret:

   ```bash
   set +x
   read -r -s -p "New POCKETBASE_ADMIN_PASSWORD: " NEW_PASSWORD
   printf '\n'
   printf '%s' "$NEW_PASSWORD" | gh secret set POCKETBASE_ADMIN_PASSWORD --env production-backup
   unset NEW_PASSWORD
   ```

3. Run the backup workflow manually and wait for green.

**Do this in that order, and verify the same day.** Between step 1 and a green step 3, the
nightly drill fails — and `backup-gate` failing blocks **every production deploy**
(`fly-deploy.yml` L217: `deploy` runs only `if: needs.backup-gate.result == 'success'`).

### R2 credentials (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET`)

Same shape as above, all in `production-backup`.

1. In Cloudflare R2, create a **new** S3 credential scoped to only the backup bucket, with
   object list, read, write, and delete — the scope
   `docs/production-backups-and-release.md` L9 specifies. Do not reuse a broad Cloudflare
   API token.
2. Update the two secrets:

   ```bash
   set +x
   read -r -s -p "New R2_ACCESS_KEY_ID: " NEW_ID
   printf '\n'
   read -r -s -p "New R2_SECRET_ACCESS_KEY: " NEW_KEY
   printf '\n'
   printf '%s' "$NEW_ID"  | gh secret set R2_ACCESS_KEY_ID     --env production-backup
   printf '%s' "$NEW_KEY" | gh secret set R2_SECRET_ACCESS_KEY --env production-backup
   unset NEW_ID NEW_KEY
   ```

3. Run the backup workflow manually. It creates a backup, downloads that exact object key,
   verifies the manifest, and restores it into a disposable container — so one green run
   proves **list, read, and write**.

   It does **not** reliably prove delete. `pruneOldBackups`
   (`pocketbase-r2-backup.mjs` L384-L394) issues deletes only for keys past
   `BACKUP_RETENTION = 30` (L16), so on a bucket holding 30 or fewer tool-owned archives a
   green run never calls delete. Confirm the delete permission in the Cloudflare R2 token's
   own scope screen instead of inferring it from a green run; a credential missing delete
   will pass every drill and then start failing once the 31st archive exists.

4. Only then delete the old R2 credential. The bucket retains 30 archives
   (`pocketbase-r2-backup.mjs` L16); the new credential must be able to read the older ones
   for a recovery, so confirm it is scoped to the whole bucket, not to a prefix narrower
   than `R2_BACKUP_PREFIX`.

**If a rotation leaves backups broken overnight**, deploys are blocked, not just backups.
Fix it before merging anything to `main`.

---

## 8. Post-rotation verification checklist

Run all of these after any rotation touching Fly or Vercel.

```bash
# 1. Backend readiness — expect HTTP 200 and "ok":true
curl --silent --show-error --fail --max-time 20 \
  https://dealer-social-post-ai-production.fly.dev/api/app/health

# 2. Trusted proxy path — expect HTTP 200 and {"ok":true}
curl --silent --show-error --max-time 20 \
  https://dealer-social-post-ai.vercel.app/api/app/proxy-readiness

# 3. All ten required Fly secret names still present.
#    The flyctl call only dumps names; this reproduces the deploy gate's own
#    comparison so you get a verdict instead of a wall of JSON.
flyctl secrets list --app dealer-social-post-ai-production --json > /tmp/fly-secret-names.json
node <<'NODE'
const fs = require("node:fs");
const secrets = JSON.parse(fs.readFileSync("/tmp/fly-secret-names.json", "utf8"));
const names = new Set(
  (Array.isArray(secrets) ? secrets : []).map((entry) =>
    String(entry.Name || entry.name || ""),
  ),
);
const required = [
  "ADMIN_LOGIN_USERNAME",
  "ADMIN_LOGIN_PASSWORD",
  "SALESPERSON_PIN_PEPPER",
  "GEMINI_API_KEY",
  "TURNSTILE_SECRET",
  "VERCEL_TO_FLY_PROXY_SECRET",
  "CUSTOMER_HUB_URL",
  "CUSTOMER_HUB_SECRET",
  "CUSTOMER_HUB_DESTINATION_ID",
  "CUSTOMER_HUB_DEALER_ID",
];
const missing = required.filter((name) => !names.has(name));
console.log(missing.length ? `MISSING: ${missing.join(", ")}` : "All ten present.");
NODE

# 4. Live origin serves the release it claims to
npm run release:vercel:assert-live -- \
  https://dealer-social-post-ai.vercel.app .vercel/output/static "$(git rev-parse HEAD)"
```

Command 3 is the gate at `fly-deploy.yml` L244-L277 — the `flyctl` call is L248, the ten
required names are L258-L268, and the comparison above is L270-L276 with its `process.exit(1)`
replaced by a printed verdict. Command 4 runs the `release:vercel:assert-live` script in
`package.json` (`node scripts/vercel-live-bundle-assert.mjs --assert-live-bundle`), is
documented at `docs/production-backups-and-release.md` L114-L121, and requires a local
`.vercel/output/static` built for that SHA.

Then, by hand:

- Sign in as a salesperson with a known-good access code.
- Sign in as the system administrator.
- Generate one caption and one image.
- If you touched `CUSTOMER_HUB_SECRET`, publish one draft to the Customer Hub.
- Watch `flyctl logs --app dealer-social-post-ai-production --no-tail` and the redacted
  client-error aggregates for at least 30 minutes
  (`docs/production-backups-and-release.md` L246).

---

## Decide and fill in

Nothing below exists anywhere in this repository. Each is the owner's call. The
recommendation is a starting point with its reasoning, **not** a value read from a file —
do not treat any of it as current practice.

### A. Rotation cadence per secret

The repo defines no schedule for any secret. The only recurring schedule that exists is the
backup/restore drill at `17 7 * * *` (`pocketbase-backup.yml` L5).

| Secret                                 | Recommended default                                            | Reasoning                                                                                                                                                               |
| -------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SALESPERSON_PIN_PEPPER`               | **Never on a schedule.** On suspected compromise only.         | Rotation is irreversible and re-issues every code by hand (§3). Scheduled rotation would guarantee a periodic lockout of the entire sales floor for no security gain.   |
| `ADMIN_LOGIN_PASSWORD`                 | 90 days, and immediately on any staff change                   | Single human credential to the highest-privilege surface; rotation is cheap and self-revoking (`helpers.js` L317-L322).                                                 |
| `ADMIN_LOGIN_USERNAME`                 | Only on staff change                                           | Rotating it buys nothing; the password is the secret.                                                                                                                   |
| `GEMINI_API_KEY`                       | 180 days, immediately on suspected leak                        | Rotation costs a machine restart that kills in-flight generations (§0.3). Frequent rotation trades real user pain for little benefit on a key that is server-side only. |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | Same as Gemini, or delete outright while the fallbacks are off | Both are inert unless `ENABLE_*_FALLBACK=true` (`main.pb.js` L591-L592, L709-L710).                                                                                     |
| `TURNSTILE_SECRET` + site key          | Only on suspected compromise, or when Cloudflare requires it   | Rotation is a four-place coordinated change that requires a frontend release (§5).                                                                                      |
| `VERCEL_TO_FLY_PROXY_SECRET`           | 180 days                                                       | Rotation is low-risk (no user-facing outage) but has a real mismatch window and blocks releases if botched (§6).                                                        |
| `CUSTOMER_HUB_SECRET`                  | 180 days, coordinated with the Customer Hub owner              | Two-party HMAC; cadence must be agreed with the other side or it will break mid-flight.                                                                                 |
| `FLY_API_TOKEN`                        | 12 months, or per `--expiry` on the token                      | `flyctl tokens create deploy` defaults to a 20-year expiry, which its own help text advises against.                                                                    |
| `VERCEL_TOKEN`                         | 12 months                                                      | Same reasoning; account-scoped CI credential.                                                                                                                           |
| `POCKETBASE_ADMIN_PASSWORD`            | 90 days                                                        | Full read/write to the production database via the backup API.                                                                                                          |
| R2 credentials                         | 12 months                                                      | Bucket-scoped; rotation is verifiable in one workflow run.                                                                                                              |
| `WALKAROUND_*`                         | Deferred while the feature is dark                             | `WALKAROUND_STUDIO_ENABLED` gates the whole surface (`walkarounds.js` L89-L99). Set a cadence when the feature ships.                                                   |

### B. Who owns each secret

The "Owner" column in §1 says "Super admin" throughout because the repo names no individual
owners, approvers, or an on-call rotation. Assign real names, and decide whether any secret
requires two-person approval.

### C. Where the outgoing `SALESPERSON_PIN_PEPPER` is escrowed

§3 depends on being able to restore the previous pepper if a rotation turns out to be a
mistake. The repo specifies no escrow location. Recommended: the same password manager that
holds `ADMIN_LOGIN_PASSWORD` (`docs/production-backups-and-release.md` L77 says "password
manager or Keychain and Fly"), retained for a defined window after the rotation, then
destroyed. **Decide the location and the retention window.**

### D. `flyctl tokens create deploy --expiry`

`8760h` (one year) is used in §7 as an illustrative value only. The flag's real default is
`175200h`. Pick a policy expiry.

### E. Emergency contacts and the "who do I wake up" threshold

Not defined anywhere in the repo. A pepper rotation gone wrong locks out an entire sales
floor with no self-service recovery; a broken R2 credential blocks every deploy. Decide who
gets called, and at what hour.

### F. Whether `TURNSTILE_ENFORCEMENT_ENABLED=false` is an acceptable emergency lever

§5 recommends it as the fastest recovery from a Turnstile outage. It removes a real abuse
control. Decide in advance whether an operator may pull it alone at 2am, or whether it needs
sign-off.
