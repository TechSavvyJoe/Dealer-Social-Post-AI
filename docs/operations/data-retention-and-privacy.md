# Data retention and privacy

This app captures the full name and a handwritten signature of real customers on a photo release, and stores photographs of those customers. This document says exactly what is stored, where, what is deleted automatically, what is kept forever, and what a deletion request costs today.

**This is not legal advice.** Retention periods and the legal basis for keeping consent records are decisions for the dealership owner and their counsel. Everything marked "Decide and fill in" is undecided in the code and must not be guessed at. The same caveat that governs the disclosure engine applies here — see the header of `utils/complianceDisclosures.ts`: the templates in this repo "should be reviewed by the dealer's compliance officer / counsel."

Every command, field name, cron schedule and number below was read out of a file in this repository. Source file and line are cited inline. If you change the code, change this document in the same commit.

---

## 1. Collections that hold personal data

Read from `pb_migrations/*.js`. "Personal data" here means data about an identifiable living person — customers first, then employees (salespeople and managers are people too).

### 1.1 Customer data

| Collection            | Field                                                                                                                                                                     | Type                                                    | Why it is collected                                                                                                                                                                       | What happens to it today                                                                                                                                                                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `photo_releases`      | `customer_name`                                                                                                                                                           | text, required, max 120                                 | Identifies who gave consent. Must match the post's `customer_name` or the link is refused (`pb_hooks/main.pb.js:2214-2222`)                                                               | Kept indefinitely once linked to a post. Deleted after 24h only if never linked                                                                                                                                                                                                                                     |
| `photo_releases`      | `signature_png`                                                                                                                                                           | file, required, PNG only, max 500 KB, `protected: true` | The consent artifact itself — the customer's handwritten mark                                                                                                                             | Same. `protected` set by `pb_migrations/1750300100_protect_photo_release_signatures.js`                                                                                                                                                                                                                             |
| `photo_releases`      | `signed_at`                                                                                                                                                               | date, required                                          | When consent was given                                                                                                                                                                    | Same                                                                                                                                                                                                                                                                                                                |
| `photo_releases`      | `vin`                                                                                                                                                                     | text, max 17                                            | Ties consent to the specific vehicle in the photo                                                                                                                                         | Same                                                                                                                                                                                                                                                                                                                |
| `photo_releases`      | `notes`                                                                                                                                                                   | text, max 1000                                          | Free-text context. The client writes a fixed string: `Released for social media use by ${dealershipName}.` (`services/photoReleases.ts:106`)                                              | Same                                                                                                                                                                                                                                                                                                                |
| `photo_releases`      | `post_id`                                                                                                                                                                 | text, max 64                                            | The post this consent covers. Empty = unlinked = eligible for the 24h prune                                                                                                               | Same                                                                                                                                                                                                                                                                                                                |
| `photo_releases`      | `owner_session_hash`                                                                                                                                                      | text, max 128                                           | Binds an unlinked signature to the exact browser session that captured it                                                                                                                 | Same                                                                                                                                                                                                                                                                                                                |
| `photo_releases`      | `expires_at`                                                                                                                                                              | date                                                    | 24h expiry for unlinked captures only                                                                                                                                                     | Same                                                                                                                                                                                                                                                                                                                |
| `photo_releases`      | `ip_hash`, `user_agent`                                                                                                                                                   | text                                                    | Originally an audit trail                                                                                                                                                                 | **Already zeroed.** `pb_migrations/1750800500_minimize_photo_release_metadata.js` blanked every historical row and `pb_hooks/main.pb.js:2143-2144` writes `""` on every new row. The columns remain for schema compatibility only                                                                                   |
| `posts`               | `customer_name`                                                                                                                                                           | text, max 120                                           | Drives the consent-required check and the public first-name label                                                                                                                         | Kept indefinitely. No prune, no delete endpoint                                                                                                                                                                                                                                                                     |
| `posts`               | `vin`                                                                                                                                                                     | text, max 17                                            | Vehicle identity for the post and for release matching                                                                                                                                    | Kept indefinitely                                                                                                                                                                                                                                                                                                   |
| `posts`               | `creative_image`                                                                                                                                                          | file, JPEG/PNG/WebP, max 8 MB, `protected: true`        | The finished social image. **May contain the customer's face** — this is stated in `pb_migrations/1750300200_add_approval_creative.js`: "generated delivery photos can contain customers" | Kept indefinitely. Max size tightened from 20 MB to 8 MB by `pb_migrations/1750800400_bound_post_creative_size.js`                                                                                                                                                                                                  |
| `posts`               | `caption`, `platform_captions`, `website_draft`                                                                                                                           | text                                                    | Marketing copy, which can contain the customer's first name                                                                                                                               | Kept indefinitely                                                                                                                                                                                                                                                                                                   |
| `posts`               | `salesperson_name`, `salesperson_id`, `owner_person_id`                                                                                                                   | text / relation                                         | Attribution and leaderboard                                                                                                                                                               | Kept indefinitely                                                                                                                                                                                                                                                                                                   |
| `walkaround_releases` | `signed_name`, `signature_png` (protected), `video_consent`, `voice_consent`, `cloud_processing_consent`, `youtube_consent`, `signed_at`, `revoked_at`, `consent_version` | mixed                                                   | Consent for the Vehicle Walkaround Studio (video + voice + cloud processing + YouTube)                                                                                                    | Kept indefinitely. **Currently unreachable**: the whole feature is gated on `WALKAROUND_STUDIO_ENABLED` (`featureEnabled()`, `pb_hooks/walkarounds.js:89-100` — the value is trimmed and lowercased before the `=== "true"` compare, so `TRUE` and `True` also enable it) and `.env.example:71` ships it as `false` |

Collection definitions: `pb_migrations/1748000000_create_photo_releases.js`, `1748000100_create_posts.js`, `1748000500_release_post_link.js`, `1750300200_add_approval_creative.js`, `1750800100_persist_post_release_state.js`, `1750800200_harden_photo_release_ownership.js`, `1751100000_vehicle_walkaround_studio.js` (releases block at lines 339-386).

### 1.2 Employee and operator data

| Collection             | Field                                                                                                           | Why                                                                | What happens to it today                                                                                                                                                                                                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `salespeople`          | `name`, `pin`, `pin_hash`, `person_pin_fingerprint`, `role`, `active`, `signature_line`                         | Roster and personal-code login                                     | Kept indefinitely. `DELETE /api/app/salespeople/:id` is a **deactivation, not a deletion** — it sets `active = false` and revokes sessions (`pb_hooks/main.pb.js:4977-5019`). PINs are peppered hashes since `pb_migrations/1751300000_person_pin_hash.js`                          |
| `manager_accounts`     | `person` relation + PocketBase auth record (username, password verifier)                                        | Manager password login, min password length 15                     | Kept until the person is deleted; cascades on `person` delete (`pb_migrations/1750900000_manager_password_login.js:28-36`)                                                                                                                                                          |
| `admin_accounts`       | PocketBase auth record                                                                                          | Super-admin login                                                  | Kept indefinitely                                                                                                                                                                                                                                                                   |
| `sessions`             | `token_hash`, `dealer`, `role`, `person`, `ip`, `user_agent`, `expires_at`, `is_impersonation`                  | Server-side session state; the cookie carries only an opaque token | **Pruned**: expired rows deleted daily at 03:00 UTC (`pb_hooks/helpers.js:4137-4152`). Tokens are SHA-256 verifiers, never plaintext (`pb_migrations/1750300000_hash_session_tokens.js`)                                                                                            |
| `auth_events`          | `kind`, `dealer`, `credential_present`, `ip`, `user_agent`, `detail`                                            | Login audit, rate limiting, incident response                      | **Pruned** — see §3. Attempted credentials were purged and the column dropped by `pb_migrations/1750200000_harden_auth_events.js`; only a boolean `credential_present` survives                                                                                                     |
| `client_error_events`  | `name`, `payload`, `release_sha`, `api_contract_version`, `occurred_at`                                         | Production diagnostics                                             | **Pruned at 14 days.** The payload is allowlisted to nine scalar keys and VIN-redacted before storage (`pb_hooks/helpers.js:2297-2337`)                                                                                                                                             |
| `generation_events`    | `dealer`, `owner_session_hash`, `attempt_id`, `task`, `tier`, `provider`, `model`, token counters, `latency_ms` | AI usage/cost ledger                                               | **Pruned at 14 days.** By design holds no prompts, captions, customer details or image bytes — stated in `pb_migrations/1751600000_generation_usage.js`                                                                                                                             |
| `dealers`              | `name`, `phone`, `address`, `website`, `hours`, social handles, `logo`                                          | Dealership business profile                                        | Kept indefinitely. Business contact data, not customer data                                                                                                                                                                                                                         |
| `website_publications` | delivery state, `event_id`, `payload_hash`, `review_url`                                                        | Customer Hub outbox                                                | Kept indefinitely; cascades when the post or dealer is deleted (`pb_migrations/1751000000_website_publication_outbox.js`). "The protected customer release remains in PocketBase and is never copied to this collection"                                                            |
| `provider_resources`   | `dealer`, `provider`, `resource_type`, `resource_id`, `expires_at`                                              | Short-lived provider handles                                       | **Pruned** on `expires_at` (`pb_hooks/helpers.js:3859`). Not one of the cron jobs in §3 — it is an opportunistic `DELETE` run on every provider-resource write ("Opportunistic cleanup keeps the locked ledger bounded without a scheduler"), so a fully idle system prunes nothing |

Every one of these collections has `listRule`/`viewRule`/`createRule`/`updateRule`/`deleteRule` set to `null`. Nothing is readable through the public PocketBase REST API; all access goes through session-gated `/api/app/*` routes in `pb_hooks/main.pb.js`. `dealers`, `posts` and `photo_releases` were locked down by `pb_migrations/1748000400_lock_collection_rules.js` — before that migration, any browser could enumerate customer signatures.

---

## 2. What the photo release actually is, and why it is retained

The customer signs the text rendered in `components/PhotoReleaseModal.tsx:150-157`:

> By signing below, the customer grants **{dealership}** permission to use the photo taken today on social media, websites, advertising, and other marketing materials. The customer may withdraw consent in writing at any time by contacting the dealership.

That record — name, signature image, timestamp, VIN, and the id of the post it authorizes — is the dealership's evidence that it had permission to publish a photograph of an identifiable person. **It must outlive the post it authorizes.** A post can stay live on Facebook for years; deleting the consent record while the post is still public leaves the dealership publishing a customer's likeness with no proof of permission. That is the reason linked releases are excluded from every automatic cleanup in this codebase.

The capture flow is deliberately two-phase (`pb_hooks/main.pb.js:2034-2158` and `2163-2306`):

1. The customer signs. The release is saved immediately, **unlinked** (`post_id: ""`), with `expires_at` set to now + 24 hours (`pb_hooks/main.pb.js:2140`). It must be durable before any AI call so a provider failure cannot lose the signature.
2. Generation succeeds, a post is created, and `POST /api/app/photo_releases/:id/link-post` sets `post_id`. This is one-way and idempotent — an existing link cannot be redirected to a different post (`pb_hooks/main.pb.js:2255-2259`).

The link is refused unless the same browser session owns both the release and the post, the customer names normalize to the same value, and the VINs match. Once `post_id` is set, `expires_at` no longer matters: the prune query only selects rows where `post_id = ''`.

Write limits on the release endpoint: 120 attempts/hour and 300 attempts/day per person, but only 20 successful saves/hour and 50/day (`pb_hooks/main.pb.js:2045-2054`, `2097-2107`).

---

## 3. What is deleted automatically today — the complete list

There are exactly **four** scheduled jobs in this codebase that delete personal data. All schedules are UTC cron expressions registered with `cronAdd()`.

| Job                                   | Schedule                      | What it deletes                                                                                                                                                                                                                                                                                 | Source                                                                |
| ------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `prune-unlinked-photo-releases`       | `13 * * * *` (hourly, at :13) | `photo_releases` where `post_id = ''` **and** `expires_at != ''` **and** `expires_at <= now` — a row with a blank `expires_at` is never selected. Up to 500 rows per run. Deleted record-by-record via `deleteRecord()` so PocketBase also removes the protected signature file from the volume | `pb_hooks/main.pb.js:2311-2334` (filter 2318, `deleteRecord` 2326)    |
| `prune-client-error-events`           | `17 7 * * *` (daily 07:17)    | `client_error_events` older than **14 days**; `generation_events` older than **14 days**; `auth_events` older than **30 days**                                                                                                                                                                  | `pb_hooks/main.pb.js:1371-1400`                                       |
| `session_gc_and_auth_cleanup`         | `0 3 * * *` (daily 03:00)     | Expired `sessions` rows; `auth_events` older than **90 days**. 500 rows per run each                                                                                                                                                                                                            | `pb_hooks/main.pb.js:5387-5394` → `pb_hooks/helpers.js:4137-4172`     |
| `walkaround_abandoned_upload_cleanup` | `30 3 * * *` (daily 03:30)    | Abandoned `walkaround_assets` source uploads older than 24h. **No-ops entirely** unless `WALKAROUND_STUDIO_ENABLED=true`                                                                                                                                                                        | `pb_hooks/main.pb.js:5396-5402` → `pb_hooks/walkarounds.js:3245-3246` |

**Note the auth_events discrepancy.** Two jobs prune the same collection with different cutoffs — 30 days at 07:17 and 90 days at 03:00. The tighter one wins in practice, so effective `auth_events` retention is **30 days**, not the 90 days the session-GC helper implies. If you intended 90, `pb_hooks/main.pb.js:1390` is the line to change; if you intended 30, `pb_hooks/helpers.js:4155` is dead code. Do not describe this as "90-day audit retention" to anyone until it is reconciled.

### What is never deleted automatically

- **Linked photo releases** (`post_id != ''`) — customer name, signature PNG, VIN, timestamp. Forever.
- **Posts** — customer name, VIN, caption, and the `creative_image` that may show the customer's face. Forever. There is no `DELETE /api/app/posts/:id` route; the only DELETE routes in `pb_hooks/main.pb.js` are for sessions, salespeople (deactivate), dealers, and walkarounds.
- **Walkaround releases**, if that feature is ever enabled.
- **Salespeople** — deactivated, never removed.
- **Off-box backups.** 30 R2 archives are retained (`BACKUP_RETENTION = 30` in `scripts/pocketbase-r2-backup.mjs:16`, applied in `pruneOldBackups` at line 387), taken daily by `.github/workflows/pocketbase-backup.yml` (`cron: "17 7 * * *"`, line 5). These are whole-`pb_data` PocketBase archives pulled from `/api/backups` (`scripts/pocketbase-r2-backup.mjs:226`), so they contain the stored files, not just the database rows; `docs/production-backups-and-release.md:49` states that the production restore drill enumerates and verifies `dealers.logo`, `photo_releases.signature_png` and `posts.creative_image` inside a restored archive. **Any deletion you perform in the live database persists in backups for roughly 30 more days.**
  - Pruning is deliberately narrow: only keys matching `dspai_tool_<timestamp>_<suffix>.zip` are eligible (`TOOL_OWNED_POCKETBASE_BACKUP_PATTERN`, `scripts/pocketbase-r2-backup.mjs:23-24`). **A backup taken by hand from the PocketBase dashboard is never pruned and will hold the deleted data indefinitely.** Check the bucket for non-tool-owned archives before you promise a customer an expiry date.

---

## 4. Where signatures live and how they are served

`photo_releases.signature_png` is a PocketBase file field with `protected: true` (`pb_migrations/1750300100_protect_photo_release_signatures.js`). The migration's own comment explains why: PocketBase serves unprotected files **without applying collection view rules**, so locking the collection would not have been enough on its own. The down-migration is deliberately a no-op — "Security invariant: never make stored customer signatures public again."

Bytes live on the Fly volume mounted at `/pb/pb_data` (`fly.toml` `[mounts]`), under the `photo_releases` collection's files path.

**There is no application route that serves the signature bytes back.** `grep -rn signature_png pb_hooks/` returns six hits, and none of them reads or streams the file's contents:

| Hit                                   | What it does                                                                                       |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `pb_hooks/main.pb.js:2090`            | `c.formFile("signature_png")` — the multipart read on write                                        |
| `pb_hooks/main.pb.js:2145`            | `form.addFiles("signature_png", …)` — the write itself                                             |
| `pb_hooks/main.pb.js:2178`            | presence check before linking a release to a post                                                  |
| `pb_hooks/websitePublications.js:489` | filter clause `signature_png != ''` when validating that a post has a linked release               |
| `pb_hooks/websitePublications.js:511` | reads the **filename**, then `fsys.exists(...)` — proves the file is on the volume, never opens it |
| `pb_hooks/helpers.js:3771`            | matches the substring in a PocketBase error message to produce a safe user-facing error            |

No handler serves the file and no file token is minted anywhere in the repo (the only `/api/files/...` URLs constructed are for the public `dealers.logo`, at `pb_hooks/helpers.js:3943` and `pb_hooks/main.pb.js:5208`).

Contrast this with `posts.creative_image`, which is also `protected` but _is_ served — through a session-gated route at `pb_hooks/main.pb.js:3585-3628` that requires the requester to be the owning session, an authoritative same-person, or a manager, and responds with `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`.

**Consequence:** the only way to look at a stored customer signature today is the PocketBase superuser dashboard on the Fly origin (`/_/`), authenticated with the PocketBase admin credentials. No hook in this repo blocks that path. That is also the only way to produce one for a subpoena, a customer request, or a dispute — there is no export tooling.

---

## 5. Handling a customer deletion request today

Nothing in the product supports this. Everything below is manual work in the PocketBase superuser dashboard, and every step is irreversible.

**Before you start:** deleting a consent record while the corresponding post is still live on social media removes the dealership's proof of permission. Take down the published post _first_. Whether the release itself should then be deleted or retained is a counsel question — see §7.

### Step 1 — Confirm the request and identify the person

Get the request in writing (the signed release text promises withdrawal "in writing"). You need the customer's name as it was typed at signing, and ideally the VIN or the approximate date.

### Step 2 — Open the PocketBase superuser dashboard

Open this URL in a browser:

```
https://dealer-social-post-ai-production.fly.dev/_/
```

(On macOS, `open "https://dealer-social-post-ai-production.fly.dev/_/"` does it from a shell. `open` is macOS-only — on Linux use `xdg-open`, or just paste the URL.)

The hostname is the Fly app name from `fly.toml` line 1 (`app = "dealer-social-post-ai-production"`); the same origin is hardcoded as the API target in `vercel.ts:62` and allowlisted in `pb_hooks/requestPolicies.js:1621`.

Log in with the PocketBase admin credentials (`POCKETBASE_ADMIN_EMAIL` / `POCKETBASE_ADMIN_PASSWORD`). This is the same superuser account the backup job authenticates as — it posts those two values to `/api/admins/auth-with-password` (`scripts/pocketbase-r2-backup.mjs:117-124`), and both are stored as secrets in the protected `production-backup` GitHub environment (`docs/production-backups-and-release.md:11,17`; `.github/workflows/pocketbase-backup.yml:20,102-103`).

Note this is **not** the app's own super-admin login. That one uses `ADMIN_LOGIN_USERNAME` / `ADMIN_LOGIN_PASSWORD` (`pb_hooks/helpers.js:236-261`, `.env.example:20-21`) to sign in to the app's own `/api/app/*` routes, and it does not authenticate the PocketBase dashboard.

Expected: the collections list, including `photo_releases` and `posts`. If you get a login page you cannot pass, stop — do not attempt a credential reset against production without a fresh backup in hand.

### Step 3 — Find every record

In the dashboard, open `photo_releases` and filter:

```
customer_name ~ "Jane Smith"
```

Then open `posts` and filter the same way:

```
customer_name ~ "Jane Smith"
```

Name matching is your only handle. `pb_hooks/main.pb.js:2216-2221` compares names through `helpers.normalizeReleaseIdentity`, so stored values may differ in case, spacing or honorific from what the customer writes in their request. If a VIN is known, filter on `vin` instead — it is exact.

Expected: zero or more rows in each. Record the ids. **If `posts` returns rows whose `customer_name` is empty but which are clearly the same event, you cannot find them by name** — fall back to VIN, or to `generated_at` plus the salesperson.

### Step 4 — Take down anything still published

Check each post's `website_publication` state and whether the salesperson posted it to Facebook or Instagram. The app does not publish to personal social accounts, so removing a Facebook post is a manual action by the salesperson who posted it. A Customer Hub draft that reached `draft_ready` or `published` must be removed on the Customer Hub side; this system has no withdraw-and-confirm call.

### Step 5 — Delete the records

In the dashboard, delete the `photo_releases` rows first, then the `posts` rows. Use the per-record delete button, one record at a time.

Expected: deleting a `photo_releases` record also removes its `signature_png` from the volume (PocketBase deletes attached files on record delete — this is exactly why the hourly prune at `pb_hooks/main.pb.js:2326` uses `deleteRecord()` rather than a bulk SQL `DELETE`). The same applies to `posts.creative_image`.

**Do not** delete these with raw SQL through a shell on the machine. A `DELETE FROM photo_releases ...` removes the row and orphans the signature PNG on the volume forever.

Deleting a `posts` row cascades to its `website_publications` rows (`cascadeDelete: true`, `pb_migrations/1751000000_website_publication_outbox.js`).

### Step 6 — Account for backups

The 30 retained R2 archives still contain everything you just deleted. They age out over roughly 30 days on the daily schedule. There is no selective-redaction tooling for backup archives, and building one is not advisable. Tell the requester what is true: live data removed on date X, automated backup copies expire by approximately date X+30.

Before you state that date, list the bucket prefix and confirm there is no archive whose key does not match `dspai_tool_<timestamp>_<suffix>.zip`. The prune step skips anything else on purpose (`scripts/pocketbase-r2-backup.mjs:20-24`), so a hand-taken dashboard backup sitting in the bucket makes the X+30 answer wrong.

### Step 7 — Record what you did

There is no audit trail for manual dashboard deletions. `helpers.runAuditedTransaction` writes `auth_events` only for actions taken through the app's own routes. Keep a written record outside the system: date, requester, records deleted, backup expiry date.

### If a step fails

- **Filter returns nothing but you know a record exists** — the stored name differs. Try a VIN filter, or widen to a date range on `signed_at` / `generated_at`.
- **Delete errors on a `posts` row** — check for a `website_publications` row mid-delivery (`status = delivering`). Let the minute worker settle, then retry.
- **You deleted the wrong record** — stop. Do not delete anything else. Restore is a whole-database operation (`scripts/verify-pocketbase-restore.sh`, procedure in `docs/production-backups-and-release.md`) and will roll back every other write since the backup.

---

## 6. What is missing to make deletion a supported operation

Each of these is a gap, not a proposal already agreed to.

1. **A customer identity index.** Deletion currently depends on fuzzy matching `customer_name` text across two collections. There is no stable customer id and no index on `posts.customer_name` or `photo_releases.customer_name`. Everything else follows from this.
2. **A deletion endpoint.** There is no `DELETE` route for `posts` or `photo_releases` anywhere in `pb_hooks/main.pb.js`. Deletion today requires PocketBase superuser credentials, which is the most privileged access in the system, handed out for a routine task.
3. **An audit record for deletions.** `auth_events` has no `kind` value for customer erasure. The enum was created with seven values (`pb_migrations/1748100100_create_auth_events.js:28-36`), rewritten to seventeen by `1750500000_auth_people_integrity.js:247-264`, and extended with `dealer_created` / `dealer_updated` / `dealer_deleted` by `1750700000_backend_operational_hardening.js:20`. None of the twenty covers a customer record being erased. A dashboard deletion leaves no trace in the system at all.
4. **Consent withdrawal as a state, distinct from deletion.** `walkaround_releases` already has a `revoked_at` field (`pb_migrations/1751100000_vehicle_walkaround_studio.js`). `photo_releases` has no equivalent. Withdrawal and erasure are different things: withdrawal should stop future use while preserving the record of what was authorized and when it stopped; erasure destroys the evidence. Today only erasure is possible.
5. **A takedown path for published content.** Nothing propagates a deletion to a live Customer Hub draft or a Facebook post.
6. **A retention clock on posts.** `posts` has `generated_at` but no retention policy and no prune. The dataset grows without bound, and so does the exposure.
7. **An export path for a single customer's records.** Needed for access requests and for producing a signature in a dispute. Does not exist.
8. **Orphan handling on dealer deletion.** `photo_releases.dealer` and `posts.dealer` are both `cascadeDelete: false` (`pb_migrations/1748000000_create_photo_releases.js`, `1748000100_create_posts.js`), while `sessions.dealer` and `website_publications.dealer` are `true`. `DELETE /api/app/dealers/:id` (`pb_hooks/main.pb.js:5119-5154`) therefore leaves every customer signature and every post behind, pointing at a dealer record that no longer exists — unreachable through the app, invisible to any dealer-scoped query, and still on disk and in backups. This is the sharpest gap in the list.

---

## 7. What leaves the system

### Gemini / AI providers

Generation requests go out through the PocketBase proxy to `https://generativelanguage.googleapis.com/` (`pb_hooks/main.pb.js:43`). Requests are rebuilt server-side from an allowlisted schema — the raw client body is never forwarded (`pb_hooks/requestPolicies.js:1441-1458`, and `pb_hooks/main.pb.js:232-242` uses only `buildGeminiProxyRequest`'s output).

What crosses that boundary:

- **The customer's photograph**, as image bytes. This is the core of the product and it is unavoidable — the image is what gets edited.
- **A first-name-only customer label**, never the full release name. `toPublicCustomerLabel` (`utils/customerIdentity.ts:10-37`) strips honorifics, collapses a couple ("Jane & John") to `our customers`, and keeps only the first token. The prompt then pins the model to that exact label (`services/geminiService.ts:2045-2050`).
- Vehicle, style, tone and brand-voice text.

What does not: the signature PNG, the full release name, VIN-in-prompt (VIN is redacted from telemetry by `redactTelemetryVinStrings`), and the release record itself. Two other proxied providers exist — OpenAI images (`pb_hooks/main.pb.js:587`) and Anthropic messages (`705`) — under the same rebuild-from-allowlist discipline.

Usage is logged to `generation_events`, which by construction holds counters and enum-like tokens only, never prompts or customer details (`pb_migrations/1751600000_generation_usage.js`).

### Customer Hub publications

Approved posts can be pushed as private drafts to the Customer Hub site configured by `CUSTOMER_HUB_URL`, `CUSTOMER_HUB_SECRET`, `CUSTOMER_HUB_DESTINATION_ID` and `CUSTOMER_HUB_DEALER_ID` (`pb_hooks/websitePublications.js:310-341`). The destination is disabled unless all four are valid _and_ the requesting dealer id equals `CUSTOMER_HUB_DEALER_ID` — a single-tenant guard.

The outbound body is built by `buildOutboundContent` (`pb_hooks/websitePublications.js:1512-1531`): `kind`, `postTypeId`, `category`, `title`, `body`, `altText`, server-owned `disclosures`, optional `customerDisplayName`, optional `vehicleDescription`, advisory `privacyFlags`, and `media`.

`customerDisplayName` is passed through the same first-name reduction as the AI path (`publicCustomerLabel`, `pb_hooks/websitePublications.js:945-971`). It is kept only when the draft's `kind` is `customer_story` **and** the stored release authorizes exactly that label; in every other case the field is deleted from the draft, and a label the release does not authorize forces human identity review instead of a send (`pb_hooks/websitePublications.js:1339-1353`). Before any send, the copy is scanned and the delivery is refused if it contains a VIN-like string (`private_identifier_in_website_copy`) or contact details (`private_contact_in_website_copy`) — `pb_hooks/websitePublications.js:1490-1510`. **The signature and the full release name are never sent** — the migration header for the outbox states it plainly: "The protected customer release remains in PocketBase and is never copied to this collection."

### Walkaround Studio (currently off)

If `WALKAROUND_STUDIO_ENABLED=true`, media flows to external brokers and to YouTube via `WALKAROUND_GCS_BUCKET`, `WALKAROUND_UPLOAD_BROKER_URL`, `WALKAROUND_YOUTUBE_BROKER_URL` (`.env.example:71-78`). It ships `false` and the server-side gate (`featureEnabled()`, `pb_hooks/walkarounds.js:89-100`) trims and lowercases the value before comparing it to `"true"`. Do not enable it without revisiting this section — it introduces voice, video, cloud-processing and YouTube consent, all with indefinite retention and no prune.

### Backups

Daily PocketBase archives to a private Cloudflare R2 bucket, including customer signatures and creative images. Details, credentials and restore procedure: `docs/production-backups-and-release.md`.

### What does not leave

Salesperson personal Facebook/Instagram accounts are never automated. The app produces a caption and an image; a human posts it. No social API credential for a personal account exists anywhere in this repo.

---

## 8. Decide and fill in — owner and counsel

The code does not encode any of these. Do not invent values; write the decision into this table and then into the code.

| #   | Decision                                                                      | Recommended default                                                                                                                                  | Reasoning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Retention period for a linked photo release**                               | Life of the published post **plus** the state's civil statute of limitations for a right-of-publicity or misappropriation claim, whichever is longer | The release only has value while a claim can still be brought. Deleting on a fixed short clock destroys the defense while the post is still live. **The operating jurisdiction is not recorded anywhere in this repo** — "Bob Maxey Ford of Howell" appears only as an illustrative dealership name in code comments (`pb_hooks/helpers.js:3195-3196`, `utils/socialAttribution.ts:142-144`), which is not evidence of where the tenant operates. Write the actual state here, then have counsel supply that state's limitation period |
| 2   | **Retention period for `posts`**                                              | Match #1, so a post and its consent record expire together                                                                                           | A post outliving its release is the failure mode this whole document is about. Today neither expires                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 3   | **What happens when a customer withdraws consent**                            | Take down published content; set a `revoked_at` on the release; keep the release itself for the period in #1                                         | Withdrawal is not erasure. You still need to show what was authorized and when it stopped                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 4   | **Whether erasure requests are honored, and on what basis**                   | **Undecided — counsel must answer.** Do not assume a statutory duty either way until counsel names the governing statute(s) for the state in #1      | This document deliberately states no jurisdiction-specific legal conclusion; an earlier draft asserted one about Michigan that nothing in this repo supports. A dealership serving out-of-state customers may owe duties under another state's law regardless of where it sits. Counsel decides                                                                                                                                                                                                                                        |
| 5   | **Legal basis for capturing the signature**                                   | Written consent                                                                                                                                      | Already the design. Name it explicitly in the dealership's privacy notice                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 6   | **Backup retention vs. deletion promises**                                    | Keep the 30-archive window; disclose in the deletion response that backups age out over ~30 days                                                     | 30 is what the code does today (`scripts/pocketbase-r2-backup.mjs:16`). Do not promise a shorter window you cannot deliver — and note the prune only touches `dspai_tool_*.zip` keys (lines 20-24), so any hand-taken dashboard backup left in the bucket has no expiry at all                                                                                                                                                                                                                                                         |
| 7   | **`auth_events` retention: 30 or 90 days**                                    | Pick one and make both jobs agree                                                                                                                    | Two jobs currently disagree (§3). Whichever you pick, the other line is a bug                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 8   | **Who may access stored signatures**                                          | Named individuals only; PocketBase superuser credentials are not a role to hand around                                                               | Today, signature access = full database access. Until gap 2 in §6 (a deletion endpoint) exists, access control is credential control                                                                                                                                                                                                                                                                                                                                                                                                   |
| 9   | **Retention for the walkaround consent set**, if that feature is ever enabled | Do not enable until #1-#3 are settled                                                                                                                | Video, voice and YouTube consent are a materially larger exposure than a still photo                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 10  | **Who owns this document**                                                    | A named person at the dealership, reviewed on a fixed cadence                                                                                        | An unowned retention policy is not a policy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

---

## 9. Verified against

Read on 2026-09-10, branch `hardening/production-review-2026-09`.

Migrations: `pb_migrations/1732490000_created_dealers.js`, `1748000000_create_photo_releases.js`, `1748000100_create_posts.js`, `1748000400_lock_collection_rules.js`, `1748000500_release_post_link.js`, `1748000700_create_salespeople.js`, `1748000800_dealer_profile_fields.js`, `1748100000_create_sessions.js`, `1748100100_create_auth_events.js`, `1750200000_harden_auth_events.js`, `1750300000_hash_session_tokens.js`, `1750300100_protect_photo_release_signatures.js`, `1750300200_add_approval_creative.js`, `1750300300_create_provider_resources.js`, `1750400000_people_roles_impersonation.js`, `1750600000_diagnostics_telemetry.js`, `1750800100_persist_post_release_state.js`, `1750800200_harden_photo_release_ownership.js`, `1750800300_authoritative_post_ownership.js`, `1750800400_bound_post_creative_size.js`, `1750800500_minimize_photo_release_metadata.js`, `1750900000_manager_password_login.js`, `1751000000_website_publication_outbox.js`, `1751100000_vehicle_walkaround_studio.js`, `1751200000_admin_password_login.js`, `1751300000_person_pin_hash.js`, `1751600000_generation_usage.js`, `1751900000_employee_disclosure.js`.

Hooks: `pb_hooks/main.pb.js` (proxy target 43; telemetry envelope + prune cron 1319-1400; photo release create 2034-2158; link-post 2163-2306; prune-unlinked cron 2311-2334; creative-image route 3585-3628; posts list 3980-3992; salespeople deactivate 4977-5019; dealer delete 5119-5154; session GC + walkaround cleanup crons 5387-5402). `pb_hooks/helpers.js` (telemetry allowlist 2297-2337; person field limits 1395-1398; provider_resources prune 3859; dealer logo URL 3943; `purgeExpiredSessionsAndOldEvents` 4137-4172). `pb_hooks/requestPolicies.js` (`buildGeminiProxyRequest` 1441-1458). `pb_hooks/websitePublications.js` (`publicCustomerLabel` 945-971; destination config 310-341; label authorization 1340-1353; contact/VIN scan 1496-1510; outbound content 1512-1531). `pb_hooks/walkarounds.js` (`featureEnabled` gate 89-100; `cleanupAbandonedUploads` 3245-3246).

Client: `utils/customerIdentity.ts` (10-37), `utils/complianceDisclosures.ts` (header), `services/photoReleases.ts` (58-129), `services/geminiService.ts` (2045-2050), `components/PhotoReleaseModal.tsx` (146-158).

Infrastructure: `fly.toml` (app name line 1, `[mounts]` `/pb/pb_data`), `entrypoint.sh`, `Dockerfile` (PocketBase pinned `PB_VERSION=0.22.55`, line 37), `.env.example` (20-21, 66-82), `.github/workflows/pocketbase-backup.yml` (cron line 5; `environment: production-backup` line 20; admin secrets 102-103), `scripts/pocketbase-r2-backup.mjs` (`BACKUP_RETENTION = 30` line 16; tool-owned name pattern 20-24; admin auth 117-124; `/api/backups` 226; `pruneOldBackups` 384-396), `scripts/verify-pocketbase-restore.sh`, `docs/production-backups-and-release.md` (lines 11, 17, 49).

Re-verified claim by claim on 2026-09-10 against the working tree. Corrections applied in that pass: the `signature_png` grep inventory in §4 (six hits, not three — `pb_hooks/websitePublications.js:489,511` and `pb_hooks/helpers.js:3771` were missing, though none of them serves the bytes); the `auth_events` `kind` enum in §6.3 (twenty values today, not the original seven); the `WALKAROUND_STUDIO_ENABLED` gate (trimmed and lowercased, not a literal-`true` compare; lines 89-100, not 88-96); the unlinked-release prune filter (also requires `expires_at != ''`); the `deleteRecord()` line (2326, not 2325); `provider_resources` pruning (opportunistic on write, not scheduled); the backup-archive description in §3 and the manual-backup pruning exception; and the macOS-only `open` command in §5 step 2.

Not verified and deliberately not stated: any retention period, any legal basis, any jurisdiction-specific obligation. Those are §8.
