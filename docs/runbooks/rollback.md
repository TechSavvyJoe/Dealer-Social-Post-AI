# Runbook: rolling back production

Backend (Fly) and frontend (Vercel) rollback for Dealer Social Post AI.

Written for an operator who did not build this system. Every command, path, secret
name, schedule and threshold below was read out of this repository; the "Verified
against" index at the end names the file and line for each. Anything that is **not**
in the repository is in the [Decide and fill in](#decide-and-fill-in) section — it is
marked, not guessed.

**Read [Step 0](#0-before-you-change-anything) and [Section 4](#4-the-trap-a-naive-image-rollback-takes-health-to-503) before you type a flyctl command.** A backend
image rollback that does not also realign three Fly secrets will take
`/api/app/health` to HTTP 503 and break the nightly backup job, while the app itself
looks fine.

---

## Contents

1. [The three moving parts](#1-the-three-moving-parts)
2. [Before you change anything](#0-before-you-change-anything)
3. [Decide: roll back or roll forward](#2-decide-roll-back-or-roll-forward)
   - [The post-revision contract (stages A, B, C)](#2a-the-post-revision-contract-stages-a-b-c)
4. [Frontend rollback (Vercel) — do this first](#3-frontend-rollback-vercel--do-this-first)
5. [The trap: a naive image rollback takes health to 503](#4-the-trap-a-naive-image-rollback-takes-health-to-503)
6. [Backend rollback (Fly)](#5-backend-rollback-fly)
7. [Realigning the backup evidence afterwards](#6-realigning-the-backup-evidence-afterwards)
8. [What a rollback cannot undo: migrations](#7-what-a-rollback-cannot-undo-migrations)
9. [Post-rollback verification checklist](#8-post-rollback-verification-checklist)
10. [Decide and fill in](#decide-and-fill-in)
11. [Verified against](#verified-against)

---

## 1. The three moving parts

| Part                   | What it is                                                                                                            | How a release moves it                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Backend image          | `registry.fly.io/dealer-social-post-ai-production@sha256:…` running on the Fly app `dealer-social-post-ai-production` | `flyctl deploy --image <digest>` (`fly-deploy.yml:335-337`)                           |
| Backend runtime config | Fly secrets, including `RELEASE_SHA`, `POCKETBASE_BACKUP_VERIFIED_RELEASE_SHA`, `POCKETBASE_BACKUP_LAST_VERIFIED_AT`  | `flyctl secrets set --stage` immediately before the deploy (`fly-deploy.yml:326-334`) |
| Frontend               | The Vercel deployment that `dealer-social-post-ai.vercel.app` points at                                               | `vercel alias set` (`fly-deploy.yml:578-579`)                                         |

The database is **not** one of the moving parts. It lives on the Fly volume `pb_data`
mounted at `/pb/pb_data` (`fly.toml:7-9`) and survives every deploy and every
rollback. See [Section 7](#7-what-a-rollback-cannot-undo-migrations).

Two facts that shape everything below:

- **`RELEASE_SHA` is a Fly secret, not a property of the image.** The backend health
  endpoint reports `releaseSha` from the fallback chain
  `$os.getenv("RELEASE_SHA") || $os.getenv("FLY_IMAGE_REF") || "unknown"`, trimmed to
  120 characters (`pb_hooks/main.pb.js:995-1001`). Rolling the image alone does not
  change it, so health will keep reporting the _newer_ release while the _older_ image
  serves traffic. Note the middle term: **unsetting `RELEASE_SHA` does not produce
  `"unknown"`** — health then reports the Fly image ref, which is not a 40-hex Git SHA,
  and `scripts/resolve-fly-backup-source.mjs:56-58` rejects it as
  `Production health returned a malformed releaseSha.` Always set `RELEASE_SHA`
  explicitly; never clear it.
- **You cannot roll back by re-running an old GitHub Actions run.** All three jobs in
  `Deploy production` refuse to run when `main` has moved past their commit
  (`fly-deploy.yml:44-52`, `234-242`, `443-451`). Rollback is a manual `flyctl` /
  `vercel` operation, or a revert commit on `main`.

---

## 0. Before you change anything

Capture the current state. You will need these values to verify the rollback, and to
put things back if the rollback is wrong.

**0.1 — Capture backend health.** Do **not** pass `--fail`: a degraded backend answers
`503` with a full JSON body, and `--fail` would discard it.

```bash
curl --silent --show-error --max-time 20 \
  https://dealer-social-post-ai-production.fly.dev/api/app/health \
  --output /tmp/health-before.json
cat /tmp/health-before.json
```

Expected on a healthy system: `"ok":true`, a 40-character `"releaseSha"`,
`"version":"2.0"`, and a `"backup"` object whose `"status"` is `"verified"`
(`pb_hooks/main.pb.js:1034-1049`). Record `releaseSha` — that is the release you are
rolling back **from**.

If curl returns nothing at all, the machine is down; that is a different problem
(`flyctl status --app dealer-social-post-ai-production`, `fly-deploy.yml:387`).

**0.2 — Capture the running image identity.** This repo ships a script that resolves
it and cross-checks it against health in one shot:

```bash
FLY_API_TOKEN="$FLY_API_TOKEN" \
FLY_BACKUP_APP=dealer-social-post-ai-production \
POCKETBASE_EXPECTED_ORIGIN=https://dealer-social-post-ai-production.fly.dev \
EXPECTED_GITHUB_REPOSITORY=TechSavvyJoe/Dealer-Social-Post-AI \
  node scripts/resolve-fly-backup-source.mjs | tee /tmp/source-before.json
```

Expected output — one JSON line:

```json
{
  "sourceOrigin": "https://dealer-social-post-ai-production.fly.dev",
  "releaseSha": "<40 hex>",
  "sourceIdentity": "health",
  "sourceImageDigest": "sha256:<64 hex>",
  "bootstrapIdentityVerified": false
}
```

Record `sourceImageDigest`. **That is the digest you are rolling back from, and the
digest you would use to undo this rollback.** Nothing else in the system stores it
where you can find it later at 2am — see [Section 5.1](#51-recover-the-digest-you-are-rolling-back-to).

If this command fails with `Production health and the running Fly image do not
identify the same release.` then health and the image already disagree — someone has
already done an image-only change. Read
[Section 4](#4-the-trap-a-naive-image-rollback-takes-health-to-503), which describes
exactly this state, then realign `RELEASE_SHA` with the running image using
[step 5.3](#53-roll-the-image-and-the-secrets-together). **Section 6 will not fix it:**
the nightly drill's first step is this same script
(`.github/workflows/pocketbase-backup.yml:34-45`), so it fails before it can rebind
anything.

**0.3 — Capture the live frontend deployment.**

```bash
curl --silent --show-error --fail --max-time 20 \
  https://dealer-social-post-ai.vercel.app/sw.js --output /tmp/sw-before.js
grep -o 'dsp-[0-9a-f]\{40\}' /tmp/sw-before.js | head -1
```

Every released service worker is stamped `dsp-<release sha>`; the release job refuses
to ship a bundle that is not (`fly-deploy.yml:514-518`). This tells you which release
the canonical origin is actually serving, without a Vercel token.

**0.4 — Capture the applied migration count.** You will compare this after the
rollback; it must never go down.

```bash
flyctl ssh console --app dealer-social-post-ai-production --command \
  'sqlite3 /pb/pb_data/data.db "SELECT COUNT(*) FROM _migrations;"'
```

**0.5 — Stop the pipeline from rolling you forward again.** `Deploy production` fires
on every successful CI run for `main` (`fly-deploy.yml:3-6`, `18-22`). If someone
merges while you are rolling back, the merge wins. Freeze merges to `main` before you
proceed. _(Who has authority to freeze `main`, and how — branch protection, a Slack
call — is not defined in this repository. See
[Decide and fill in](#decide-and-fill-in), item 1.)_

---

## 2. Decide: roll back or roll forward

Rolling back a deploy in this system is not symmetrical with deploying. It is a manual
operation that leaves the pipeline's own evidence inconsistent until you repair it,
and it cannot undo a schema change. Prefer roll-forward whenever roll-forward is fast.

**Roll forward (revert on `main`, let the pipeline ship it) when:**

- The bad change is in application code, prompts, or configuration, and a `git revert`
  produces a commit that CI will pass.
- The bad release added a migration. A rollback will not remove it
  ([Section 7](#7-what-a-rollback-cannot-undo-migrations)), so the only coherent fix is
  forward code that tolerates the new schema.
- The problem is bad but not urgent enough to beat a full CI + backup-gate + deploy
  cycle. Budget the full pipeline: `backup-gate` alone has a 60-minute timeout and
  performs a live backup, a download, an image build and a restore drill
  (`fly-deploy.yml:23-24`, `85-212`).

**Roll back (this runbook) when:**

- Production is materially broken _now_ and a forward fix is not already written and
  reviewed.
- The failure is in the frontend only. A frontend-only rollback is a single alias move
  ([Section 3](#3-frontend-rollback-vercel--do-this-first)), takes seconds, touches no
  database, and is the cheapest and safest action in this document. Do this one
  readily — **with one exception**: once the backend enforces post revisions
  (stage C below), an older frontend cannot save a draft, so check
  [Section 2a](#2a-the-post-revision-contract-stages-a-b-c) first.
- The bad release changed no migration file. Confirm with:

  ```bash
  git diff --name-only <previous-sha> <current-sha> -- pb_migrations/
  ```

  Empty output means the schema is unchanged between the two releases and a backend
  rollback is schema-neutral.

**Do not roll back to escape a `503` on `/api/app/health` caused by backup evidence.**
That is a configuration problem with a two-command fix
([Section 6](#6-realigning-the-backup-evidence-afterwards)), and rolling the image will
make it worse, not better.

_(Numeric thresholds — error rate, affected-user count, minutes-of-degradation — that
should trigger a rollback are not defined anywhere in this repository. See
[Decide and fill in](#decide-and-fill-in), item 2.)_

---

## 2a. The post-revision contract (stages A, B, C)

Draft saves and share receipts carry the revision of the saved post the editor last
saw, so a second tab or device cannot silently overwrite it. That contract shipped in
three stages, and a rollback must not put a frontend and a backend on the wrong sides
of it.

| Stage | What it is                                                                                        | How to recognise it                                                       |
| ----- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| A     | Backend returns revisions and still accepts a draft save without one                              | `pb_hooks/main.pb.js` contains `[revision-legacy-client]`                 |
| B     | Frontend sends `expected_post_revision` on every draft save and share receipt                     | `services/posts.ts` appends `expected_post_revision` in `updatePostDraft` |
| C     | Backend rejects a draft save or share receipt without a revision (`POST_DRAFT_REVISION_REQUIRED`) | `pb_hooks/main.pb.js` no longer contains `[revision-legacy-client]`       |

What must stay true at every moment:

- **A stage B frontend needs a backend at stage A or later.** It refuses to edit or
  share a post whose revision the backend did not return. Never roll the backend
  below stage A while a stage B frontend is live.
- **A stage C backend needs a frontend at stage B or later.** An older frontend sends
  no revision; every autosave and share receipt would return `409`.

So the usual order in [Section 3](#3-frontend-rollback-vercel--do-this-first)
("frontend first") holds for stages A and B, and reverses once stage C is live:

| Live now                | You want to undo       | Do this                                                                                                    |
| ----------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| backend A, frontend old | stage A                | Roll the backend back ([Section 5](#5-backend-rollback-fly)). No frontend action.                          |
| backend A, frontend B   | the redesign (stage B) | Frontend alias back first ([Section 3](#3-frontend-rollback-vercel--do-this-first)). The backend may stay. |
| backend A, frontend B   | both                   | Frontend first, then backend.                                                                              |
| backend C, frontend B   | stage C only           | Roll the backend image back to the stage A/B image, or revert the stage C commit on `main`.                |
| backend C, frontend B   | the redesign (stage B) | **Backend first**: back to a stage A/B image. Only then move the frontend alias.                           |

Revert stage C before, or in the same change as, any revert of stage B. Installed
apps that were never reopened behave like the older frontend: after stage C they
cannot save until they reload, which is why stage C has a release gate
([release runbook](../production-backups-and-release.md#the-post-revision-contract-stage-by-stage)).

---

## 3. Frontend rollback (Vercel) — do this first

**Order matters. If you are rolling back both halves, roll the frontend back before
the backend.**

Reason, from the pipeline's own design: `release-frontend` runs _after_ `deploy`,
never beside it, because the frontend rewrites `/api/*` to Fly and "the backend must
already serve this SHA before the client that calls it becomes reachable"
(`fly-deploy.yml:393-402`; the rewrite itself is `vercel.ts:61-62`). Every normal
release therefore passes through a window where an **older client talks to a newer
backend** — a state this system is built to tolerate. The reverse (newer client,
older backend) is never exercised. So unwind in the order that keeps you inside the
tolerated state: frontend first, backend second.

### 3.1 Find the deployment to roll back to

`vercel promote` is **not** the tool here. This project has `autoAssignCustomDomains`
disabled, so `promote` attaches only the `*-joes-projects-*.vercel.app` aliases and
leaves the canonical host on the previous deployment (`fly-deploy.yml:570-573`). The
canonical host moves only with `vercel alias set`.

The immutable URL of each released deployment is printed in that release's GitHub
Actions run summary, under **Frontend released → Immutable URL**
(`fly-deploy.yml:598-610`). That is the most reliable source.

To see what the canonical host resolves to right now, this repo pages the alias list
(`scripts/vercel-staged-release.sh:227-231`):

```bash
npx --yes vercel@58.4.4 alias list --json --limit 100
```

> **Verify before relying on it:** the repository calls `alias list` from a shell that
> is already logged in to Vercel, with no `--token` / `--scope` flags. On a fresh
> workstation you will likely need
> `--token "$VERCEL_TOKEN" --scope team_Tc8DG6XMPUCefkTa3u71mmlN`. Confirm with
> `npx vercel@58.4.4 alias list --help` rather than assuming.

### 3.2 Move the canonical alias

Use the exact form the release job uses (`fly-deploy.yml:578-579`). The constants are
pinned in the workflow and in `scripts/vercel-staged-release.sh:5-9`.

```bash
export VERCEL_TOKEN='<production Vercel token>'
ROLLBACK_SHA='<40-hex sha of the release you are rolling back to>'
ROLLBACK_DEPLOYMENT_URL='https://<immutable-deployment>.vercel.app'

npx --yes vercel@58.4.4 alias set \
  "$ROLLBACK_DEPLOYMENT_URL" dealer-social-post-ai.vercel.app \
  --scope team_Tc8DG6XMPUCefkTa3u71mmlN --token "$VERCEL_TOKEN"
```

**Expected:** the CLI reports the alias assigned. Propagation is normally under five
seconds; allow up to ~90 seconds before treating it as failed — the repo's own
assertion retries 10 times at 10-second intervals for exactly this reason
(`scripts/vercel-live-bundle-assert.mjs:28-31`).

**If it fails** with a project/scope error, re-check the org id
`team_Tc8DG6XMPUCefkTa3u71mmlN` and project `dealer-social-post-ai` against
`fly-deploy.yml:423-425`. A stale org id is a known failure mode in this project — it
made `vercel pull` report "Project not found" once before
(`fly-deploy.yml:416-422`). Do not "fix" it by inventing a different id.

### 3.3 Prove the alias actually moved

Deployment-side checks prove nothing here: `vercel inspect` omits the canonical host
from a deployment's own alias list even when that host resolves to it
(`fly-deploy.yml:585-587`). Check the alias side:

```bash
VERCEL_TOKEN="$VERCEL_TOKEN" VERCEL_ORG_ID=team_Tc8DG6XMPUCefkTa3u71mmlN \
  npm run release:vercel:assert-alias -- dpl_<deployment id>
```

**Expected:** `dealer-social-post-ai.vercel.app resolves to dpl_<id>.`

Then prove the bytes changed, which is the check that would have caught the
2026-08-07 stale-bundle incident (`fly-deploy.yml:589-593`). The cheap version needs
no local build:

```bash
curl --silent --show-error --fail --max-time 20 \
  https://dealer-social-post-ai.vercel.app/sw.js --output /tmp/sw-after.js
grep --quiet --fixed-strings "dsp-$ROLLBACK_SHA" /tmp/sw-after.js && echo "service worker is bound to $ROLLBACK_SHA"
```

The full byte-level version (`npm run release:vercel:assert-live -- <origin>
<staticDir> <sha>`, `docs/production-backups-and-release.md:120-122`) requires a local
`.vercel/output/static` built from the rollback SHA, so it is a follow-up, not a
2am step.

### 3.4 Installed PWAs

Users who installed the app get the rolled-back service worker only after their client
picks up the new `/sw.js`. The service worker is bound to the release
(`fly-deploy.yml:514-518`), so a stale installed shell is expected for a short window
and is not evidence that the alias move failed — verify with `/sw.js` on a fresh
browser context, not by asking a user what their installed app shows.

---

## 4. The trap: a naive image rollback takes health to 503

Read this before running any `flyctl deploy`.

Three Fly secrets, all set by the deploy job in one `flyctl secrets set --stage` call
(`fly-deploy.yml:326-334`), describe _which release is running and whether its data was
proven restorable_:

- `RELEASE_SHA` — reported by `/api/app/health` as `releaseSha`, ahead of the
  `FLY_IMAGE_REF` / `"unknown"` fallbacks (`pb_hooks/main.pb.js:995-1001`).
- `POCKETBASE_BACKUP_VERIFIED_RELEASE_SHA` — the release a restore drill actually
  passed for.
- `POCKETBASE_BACKUP_LAST_VERIFIED_AT` — when that drill ran
  (`fly-deploy.yml:205-212` produces the timestamp).

The health handler compares them (`pb_hooks/main.pb.js:1002-1033`):

| Condition                                                                         | `backup.status`         |
| --------------------------------------------------------------------------------- | ----------------------- |
| `POCKETBASE_R2_BACKUPS_ENABLED` not `true`                                        | `not_configured`        |
| timestamp or verified-SHA missing                                                 | `verification_required` |
| resolved release is empty or literally `"unknown"` (see the fallback chain above) | `release_unknown`       |
| `POCKETBASE_BACKUP_VERIFIED_RELEASE_SHA != RELEASE_SHA`                           | `release_mismatch`      |
| drill older than **7 days** (`7 * 24` hours) or more than 5 minutes in the future | `stale`                 |
| otherwise                                                                         | `verified`              |

`off_box_restore_ready` is true only for `verified` (`pb_hooks/main.pb.js:1033`,
`1284`). On Fly (`FLY_APP_NAME` is set, `pb_hooks/main.pb.js:1260`) a false
`off_box_restore_ready` forces `ok:false` and the endpoint answers **HTTP 503**
(`pb_hooks/main.pb.js:1295-1316`).

So there are two distinct wrong outcomes, and they fail in opposite directions:

- **Roll the image and change nothing else.** `RELEASE_SHA` and
  `POCKETBASE_BACKUP_VERIFIED_RELEASE_SHA` both still hold the _newer_ SHA, so they
  still match and `backup.status` stays `verified`. Health returns `200` and reports
  the **new** `releaseSha` while the **old** image serves every request. Nothing alerts.
  The system is lying, and the lie is self-consistent. The one thing that does catch it
  is the nightly backup job: `scripts/resolve-fly-backup-source.mjs:106-121` binds
  health's `releaseSha` to the Fly machine's `image_ref.labels.GH_SHA` and throws
  `Production health and the running Fly image do not identify the same release.`, so
  `PocketBase backup and restore drill` fails at its first step every night until
  someone fixes it (`.github/workflows/pocketbase-backup.yml:34-54`).
- **Roll the image and set `RELEASE_SHA` only.** Now `RELEASE_SHA` (old) and
  `POCKETBASE_BACKUP_VERIFIED_RELEASE_SHA` (new) disagree → `release_mismatch` →
  `off_box_restore_ready:false` → **`/api/app/health` returns 503**. Every uptime
  monitor pointed at that path goes red, on both origins, even though the app works.

Two more things worth knowing before you improvise:

- **Fly will not drop the machine.** The Fly health check deliberately targets
  PocketBase's own `/api/health`, not `/api/app/health`, precisely so a config gap
  cannot blackhole all traffic (`fly.toml:22-34`). A 503 on `/api/app/health` is an
  alerting event, not an outage.
- **Do not "fix" the 503 by disabling backups.** Setting the Fly secret
  `POCKETBASE_R2_BACKUPS_ENABLED=false` yields `not_configured`, which is still not
  `verified`, so health stays 503 anyway. It also does not survive: every deploy
  re-stages that secret as `true` (`fly-deploy.yml:332`), and the nightly drill
  re-sets it as well (`pocketbase-backup.yml:166`). Separately, a GitHub environment
  _variable_ of the same name gates the deploy workflow and must be `true` for any
  release to run at all (`fly-deploy.yml:54-61`) — do not touch that one either.

The correct rollback sets **all three** secrets and the image together, in one restart.
That is [Section 5](#5-backend-rollback-fly).

---

## 5. Backend rollback (Fly)

### 5.1 Recover the digest you are rolling back to

`flyctl deploy` must be given an immutable digest. The deploy job enforces the
`@sha256:` form and refuses anything else (`fly-deploy.yml:307-311`); hold yourself to
the same standard.

The digest of a past release is **not** conveniently recorded anywhere. It is written
to `$GITHUB_OUTPUT` inside the `backup-gate` job (`fly-deploy.yml:209-212`) and passed
to `deploy` as `needs.backup-gate.outputs.candidate_image_digest`. The `deploy` job
writes no step summary at all — the only `GITHUB_STEP_SUMMARY` block in this workflow
belongs to `release-frontend` and records the frontend deployment id and URL, not the
backend digest (`fly-deploy.yml:598-610`). So recovering it is a real step. Two routes:

**Route A — the workflow run's raw log.** Open the `Deploy production` run for the
target release, job **Verify pre-release off-box recovery**, step **Build, publish, and
restore-test one immutable candidate image**.

Look for the **`docker push` and `docker pull` output**, not for a line naming the
digest. The step's own `image_ref` / `image_digest` values are written **only** to
`$GITHUB_OUTPUT` (`fly-deploy.yml:210-211`), and a `>> "$GITHUB_OUTPUT"` redirect
prints nothing to the log. What is in the log is the pushed image's digest line: the
push is piped through `tee` (`fly-deploy.yml:196`) and the workflow itself parses the
digest out of that output with `sed -n 's/^.*digest: \(sha256:[0-9a-f]\{64\}\).*$/\1/p'`
(`fly-deploy.yml:197`). `docker pull "$image_ref"` runs immediately after
(`fly-deploy.yml:203`) and its output repeats the digest.

> **Verify before relying on it:** `gh run view --log` is a plausible way to grep this
> from a terminal, but no workflow or script in this repository invokes `gh run`. The
> repository does use the `gh` CLI for environment variables
> (`docs/production-backups-and-release.md:35-36`), so `gh` is an established tool
> here — confirm the exact subcommand with `gh run view --help` before trusting it in
> an incident. Whether a job's `env:` block (the `deploy` job receives
> `CANDIDATE_IMAGE_DIGEST` and `RESTORE_VERIFIED_AT` there, `fly-deploy.yml:283-285`)
> is rendered in the run log is a GitHub Actions behaviour, not something this
> repository defines — check the run, do not assume it.

**Route B — re-derive it from the registry tag.** Every candidate image is pushed to a
per-SHA tag before its digest is pinned (`fly-deploy.yml:187`):

```
registry.fly.io/dealer-social-post-ai-production:candidate-<release sha>
```

so the digest can be recovered from the registry:

```bash
ROLLBACK_SHA='<40-hex sha of the release you are rolling back to>'

flyctl auth docker
docker pull "registry.fly.io/dealer-social-post-ai-production:candidate-$ROLLBACK_SHA"
```

`flyctl auth docker` and `docker pull` are both used by the pipeline
(`fly-deploy.yml:188`, `203`). `docker pull` prints a `Digest: sha256:…` line — the
workflow parses exactly that shape out of the push output
(`fly-deploy.yml:197-201`). Record it, then cross-check:

```bash
docker image inspect --format '{{index .RepoDigests 0}}' \
  "registry.fly.io/dealer-social-post-ai-production:candidate-$ROLLBACK_SHA"
```

> **Verify before relying on it:** `docker image inspect` is used in this repo
> (`scripts/dirty-upgrade-smoke.sh:17`, `scripts/verify-pocketbase-restore.sh:28`) but
> never with `--format`. Treat the two values as a cross-check: if the digest from
> `docker pull` and the digest from `inspect` disagree, stop and resolve it — do not
> deploy either one.

A tag is mutable in principle; the digest is not. **Deploy the digest, never the
`candidate-…` tag.**

Set it once:

```bash
ROLLBACK_DIGEST='sha256:<64 hex>'
ROLLBACK_IMAGE="registry.fly.io/dealer-social-post-ai-production@$ROLLBACK_DIGEST"
```

### 5.2 Choose the backup-evidence timestamp

`POCKETBASE_BACKUP_LAST_VERIFIED_AT` must be an ISO-8601 UTC timestamp, in the format
the pipeline produces (`fly-deploy.yml:205`):

```bash
date -u +%Y-%m-%dT%H:%M:%SZ
```

It is a claim that a restore drill passed for `ROLLBACK_SHA`. **Do not invent it.**
Three honest options, in order of preference:

1. **Reuse the real timestamp — only if it was recorded at release time.** The release
   you are rolling back to did run its own restore drill, and if it is less than 7 days
   old (`pb_hooks/main.pb.js:1010-1017`) reusing that timestamp verbatim is true and
   keeps health green.

   **But it is probably not recoverable.** Unlike the digest, the drill timestamp
   appears nowhere in the run's output: `verified_at` is captured into a shell variable
   and written only to `$GITHUB_OUTPUT` (`fly-deploy.yml:205`, `209`). Health exposes
   `backup.lastVerifiedAt` (`pb_hooks/main.pb.js:1044`), but that is the evidence for
   the release you are rolling back **from**, not the one you are rolling back **to**.
   So this option is available only if your team already writes the drill timestamp
   into a release record — which nothing in this repository does. See
   [Decide and fill in](#decide-and-fill-in), item 5. If you cannot produce the real
   value, go to option 2 or 3; **do not synthesise one.**

2. **Accept the 503 and repair it properly.** Set the SHA but leave the timestamp
   alone; health reports `release_mismatch` or `stale` and returns 503 until the
   nightly drill repairs it ([Section 6](#6-realigning-the-backup-evidence-afterwards)).
   Honest, noisy, and safe.
3. **Run a real drill and use its timestamp.** Heaviest, most correct
   ([Section 6.2](#62-run-a-real-drill-if-you-need-evidence-sooner)).

_(Which of these your team wants during an incident — green-but-borrowed evidence
versus a red monitor — is a policy call this repository does not make. See
[Decide and fill in](#decide-and-fill-in), item 3.)_

### 5.3 Roll the image and the secrets together

This mirrors the deploy job exactly (`fly-deploy.yml:324-337`): stage every mutable
runtime value as a Fly secret first — staged secrets do not restart the machine — then
deploy the image, which applies the image and the staged secrets in one restart. The
comment on that block is the reason: staging "so an older secret can never override
lower-precedence app configuration".

```bash
ROLLBACK_SHA='<40-hex sha>'
ROLLBACK_IMAGE='registry.fly.io/dealer-social-post-ai-production@sha256:<64 hex>'
ROLLBACK_DRILL_VERIFIED_AT='<ISO-8601 UTC from step 5.2>'

flyctl secrets set --stage --app dealer-social-post-ai-production \
  RELEASE_SHA="$ROLLBACK_SHA" \
  POCKETBASE_BACKUP_VERIFIED_RELEASE_SHA="$ROLLBACK_SHA" \
  POCKETBASE_BACKUP_LAST_VERIFIED_AT="$ROLLBACK_DRILL_VERIFIED_AT"

flyctl deploy --app dealer-social-post-ai-production \
  --image "$ROLLBACK_IMAGE" \
  --wait-timeout 10m
```

If you chose option 2 in step 5.2, omit the `POCKETBASE_BACKUP_LAST_VERIFIED_AT` line
and expect a 503 until Section 6 is done.

**Expected:** `flyctl deploy` reports the release created and the machine started
within the 10-minute wait.

**Only these three secrets change.** `flyctl secrets set --stage` sets the names you
list and leaves every other secret alone, so `TURNSTILE_*`,
`LEGACY_CLIENT_COMPATIBILITY_ENABLED`, `POCKETBASE_R2_BACKUPS_ENABLED`,
`GEMINI_API_KEY`, `SALESPERSON_PIN_PEPPER`, `ADMIN_LOGIN_*`,
`VERCEL_TO_FLY_PROXY_SECRET` and the four `CUSTOMER_HUB_*` values keep their current
values. All ten of the required names are checked at deploy time
(`fly-deploy.yml:258-277`); a rollback must not remove any of them.

**Fly secret values are write-only.** `flyctl secrets list --app
dealer-social-post-ai-production --json` returns names, not values
(`fly-deploy.yml:248-249`). You cannot read the current `RELEASE_SHA` back off Fly —
read it from `/api/app/health` instead.

**If the deploy fails or times out,** collect what the pipeline collects on failure
(`fly-deploy.yml:384-391`):

```bash
flyctl status --app dealer-social-post-ai-production
flyctl machine list --app dealer-social-post-ai-production
flyctl logs --app dealer-social-post-ai-production --no-tail
```

One specific failure to recognise in those logs: the container refuses to start with
`ERROR: /pb/pb_data/data.db is not compatible with the PocketBase 0.22 line.` That
guard exists to stop a version mismatch from being turned into apparent data loss
(`entrypoint.sh:7-18`). It means the image you rolled to is not from the 0.22 line the
volume expects (`Dockerfile` pins `PB_VERSION=0.22.55`). Do not attempt to move the
database aside; pick a different rollback target.

---

## 6. Realigning the backup evidence afterwards

### 6.1 Let the nightly drill rebind it

`PocketBase backup and restore drill` runs at **`17 7 * * *`** (07:17 UTC daily,
`.github/workflows/pocketbase-backup.yml:3-6`). On a **scheduled** run, when health
supplies the release SHA (`sourceIdentity` = `health`), it pins its restore target to
the _running_ release rather than to `main`, checks that commit out into a worktree,
builds it, restores the production backup into it, and then refreshes the two runtime
evidence secrets (`pocketbase-backup.yml:56-75`, `143-168`):

```yaml
flyctl secrets set --app dealer-social-post-ai-production
POCKETBASE_R2_BACKUPS_ENABLED=true
POCKETBASE_BACKUP_LAST_VERIFIED_AT="$RESTORE_VERIFIED_AT"
POCKETBASE_BACKUP_VERIFIED_RELEASE_SHA="$RELEASE_SHA"
```

So a correctly executed rollback **self-heals within one nightly cycle** — provided
you set `RELEASE_SHA` to the rolled-back SHA in step 5.3, so that health and the Fly
image agree and `resolve-fly-backup-source.mjs` succeeds.

**A manual `workflow_dispatch` run will not rebind the evidence.** On any non-`schedule`
event the target is `git rev-parse HEAD` of the checked-out ref
(`pocketbase-backup.yml:62-69`), which after a rollback is _newer_ than the running
release; the refresh step is then skipped by its
`if: steps.source-release.outputs.sha == steps.target-release.outputs.sha` guard
(`pocketbase-backup.yml:158-159`) and the summary records "Bootstrap drill only"
(`pocketbase-backup.yml:180-182`). Dispatching the workflow after a rollback gives you
a fresh off-box backup, which is worth having — but it does not clear the 503.

Note also that `Deploy production` and `PocketBase backup and restore drill` share the
concurrency group `production-release-and-backup` (`fly-deploy.yml:11-13`,
`pocketbase-backup.yml:11-13`), so they queue rather than overlap.

### 6.2 Run a real drill if you need evidence sooner

The restore drill is a script, not only a workflow. It needs the archive and an image
to boot it in (`scripts/verify-pocketbase-restore.sh:1-31`, invoked by
`fly-deploy.yml:206-207`).

**`backup:create` and `backup:download` do not run bare.** Both fail immediately with
`Missing required environment variable: …` unless you supply the same environment the
workflow supplies (`fly-deploy.yml:91-138`). The names below are the ones the script
itself demands; the line numbers are in `scripts/pocketbase-r2-backup.mjs`:

| Variable                                                                  | Needed by        | Script line                 |
| ------------------------------------------------------------------------- | ---------------- | --------------------------- |
| `POCKETBASE_BACKUP_URL`                                                   | create           | 74                          |
| `POCKETBASE_EXPECTED_ORIGIN`                                              | create, download | 78, 483                     |
| `POCKETBASE_EXPECTED_RELEASE_SHA`                                         | create, download | 134, 487                    |
| `POCKETBASE_TARGET_RELEASE_SHA`                                           | create, download | 405, 491                    |
| `POCKETBASE_SOURCE_IDENTITY`                                              | create, download | 149, 495                    |
| `POCKETBASE_SOURCE_IMAGE_DIGEST`                                          | create, download | 153, 505                    |
| `GITHUB_SHA` (must be an exact 40-hex)                                    | create           | 408                         |
| `POCKETBASE_ADMIN_EMAIL` / `_PASSWORD`                                    | create           | 121-124                     |
| `R2_ENDPOINT` / `R2_BUCKET` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | create, download | via `createR2ClientFromEnv` |

`R2_BACKUP_PREFIX` may be omitted: it defaults to `dealer-social-post-ai/pocketbase`
(`scripts/pocketbase-r2-backup.mjs:17`), the same value the `production-backup`
environment sets (`docs/production-backups-and-release.md:15`). The three
`POCKETBASE_SOURCE_*` / `EXPECTED_RELEASE_SHA` values are exactly the fields step 0.2
printed, and `POCKETBASE_BACKUP_URL` must equal `POCKETBASE_EXPECTED_ORIGIN`
(`scripts/pocketbase-r2-backup.mjs:81-85`). The pipeline also runs
`scripts/prepare-fly-backup-volume.sh` **before** creating a backup
(`fly-deploy.yml:85-89`, `pocketbase-backup.yml:86-90`); skip it and the full backup
can fail on `pb_data/lost+found` permissions.

```bash
export POCKETBASE_BACKUP_URL=https://dealer-social-post-ai-production.fly.dev
export POCKETBASE_EXPECTED_ORIGIN=https://dealer-social-post-ai-production.fly.dev
export POCKETBASE_EXPECTED_RELEASE_SHA='<releaseSha from step 0.2>'
export POCKETBASE_SOURCE_IDENTITY='<sourceIdentity from step 0.2>'
export POCKETBASE_SOURCE_IMAGE_DIGEST='<sourceImageDigest from step 0.2>'
export POCKETBASE_TARGET_RELEASE_SHA="$ROLLBACK_SHA"
export GITHUB_SHA="$(git rev-parse HEAD)"
# plus POCKETBASE_ADMIN_EMAIL / POCKETBASE_ADMIN_PASSWORD and the four R2_* values

FLY_BACKUP_APP=dealer-social-post-ai-production bash scripts/prepare-fly-backup-volume.sh
npm run backup:create            # node scripts/pocketbase-r2-backup.mjs backup
npm run backup:download -- --key '<immutable key from the backup output>' \
  --output /tmp/pocketbase-production.zip

docker pull "$ROLLBACK_IMAGE"
RESTORE_RELEASE_SHA="$ROLLBACK_SHA" \
RESTORE_VERIFIED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  npm run backup:restore-drill -- /tmp/pocketbase-production.zip "$ROLLBACK_IMAGE"
```

> **Verify before relying on it:** the two placeholder `POCKETBASE_TARGET_RELEASE_SHA`
> / `GITHUB_SHA` values above are the only ones not copied verbatim from a workflow.
> In the pipeline, target is the release being restored into
> (`fly-deploy.yml:98`, `pocketbase-backup.yml:98`) and `GITHUB_SHA` is the commit of
> the tooling checkout. Whatever you pass to `backup:create` must be passed identically
> to `backup:download`, or the manifest comparison rejects the archive
> (`scripts/pocketbase-r2-backup.mjs:512-526`).

The credentials above normally live in the protected `production-backup` GitHub
environment (`docs/production-backups-and-release.md:11-19`); running this from a
workstation means handling those secrets by hand. The drill script also refuses to
start unless the image already exists locally — it runs `docker image inspect
"$image_tag"` first (`scripts/verify-pocketbase-restore.sh:28-31`) — hence the
`docker pull`, and it needs `docker`, `unzip` and `curl` on PATH
(`scripts/verify-pocketbase-restore.sh:21-26`). Then feed the timestamp you used into
step 5.3's secret set.

_(Whether a workstation is an acceptable place to run this, and where those
credentials come from during an incident, is not settled in this repository. See
[Decide and fill in](#decide-and-fill-in), item 4.)_

---

## 7. What a rollback cannot undo: migrations

**Assume every schema change is forward-only. A rollback does not revert the database.**

The container serves with `--migrationsDir=/pb/pb_migrations` (`entrypoint.sh:26`), and
migrations are copied into the image (`Dockerfile`, `COPY pb_migrations
/pb/pb_migrations`). A release therefore applies its new migrations to the live volume
at container start. Rolling the image back gives PocketBase an image containing a
_subset_ of `pb_migrations`; the migrations already recorded in `_migrations` are not
in that subset, and nothing reverses them. The volume keeps the newer schema.

**`migrate down` is not part of this procedure, and three migrations make it a one-way
door regardless.** Every down-migration that drops schema fields now uses the API that
actually works on this PocketBase line — which means **`migrate down` is now
destructive**. Until 2026-09-10 it was a harmless no-op on 21 of these files, and an
operator could run it against production and lose nothing. That is no longer true: a
reverted migration really drops its columns, and their data with them. Never run it
against a live volume; if you believe you need to, you want a restore
(`docs/production-backups-and-release.md`), not a revert.

The working API:

```js
const field = dealers.schema.getFieldByName(name);
if (field) dealers.schema.removeField(field.id);
```

That was not always true. Until 2026-09-10, 21 migration files used
`collection.schema = Array.from(collection.schema).filter(...)`, which on 0.22 reports
"Reverted" and leaves the column in place. All 21 were converted and each was proven
against the real 0.22.55 binary: 16 in isolation, the rest in a 31-migration reverse
cascade, plus the 8 migrations after the last forward-only guard cascaded on a copy of
production data. `__tests__/backendCompliancePolicy.test.ts` now rejects the broken idiom
repository-wide.

What still bounds any revert:

- Three migrations are deliberately forward-only and throw or do nothing on the way
  down, because reversing them would restore plaintext or duplicate credentials:
  `1750500000_auth_people_integrity.js`, `1751300000_person_pin_hash.js` and
  `1751300001_person_pin_backfill.js`. PocketBase runs `migrate down N` as one
  transaction, so nothing older than `1751300001` can ever be reverted in place.
- Two older down-migrations have unrelated defects, left as found because they sit behind
  those guards: `1750000000_add_dev_dealers.js` binds a JavaScript array into an `IN ()`
  query, which dbx rejects, and `1732490000_created_dealers.js` looks up
  `dealers_collection` instead of `dealers` and so never deletes it.
- `1750200000_harden_auth_events.js` used the broken idiom in its _up_ direction, so the
  `code_attempted` column it claimed to drop survived in production;
  `1752100000_purge_code_attempted_column.js` finishes that drop and is itself a no-op on
  the way down, by design.

Nothing in this repository tests booting an older image against a forward-migrated
volume. `scripts/dirty-upgrade-smoke.sh` exercises the _forward_ direction only — it
boots a base image on a volume, then boots the current image on the same volume, and
asserts the migration count never decreases
(`scripts/dirty-upgrade-smoke.sh:103-120`, `169-170`, `202-203`, `267`).

Consequences to act on:

- If the bad release added a migration, **roll forward**
  ([Section 2](#2-decide-roll-back-or-roll-forward)). A rollback leaves you on old code
  against a new schema — untested territory.
- If it added a _required_ field or a uniqueness constraint that older code does not
  populate, a rollback can produce write failures that look nothing like the original
  incident.
- Recovering the _data_ from before a release is a restore, not a rollback, and it has
  its own hardened procedure — never attach a raw pre-release archive to a public
  machine. Follow `docs/production-backups-and-release.md:250-268`.
- After any rollback, confirm the migration count did not fall (step 0.4 versus
  [checklist item 6](#8-post-rollback-verification-checklist)).

---

## 8. Post-rollback verification checklist

Run these in order. Each one has a definite expected result.

**1. Health reports the rolled-back release and is not 503.**

```bash
curl --silent --show-error --max-time 20 \
  https://dealer-social-post-ai-production.fly.dev/api/app/health \
  --output /tmp/health-after.json
cat /tmp/health-after.json
```

Expect `"ok":true`, `"releaseSha":"<ROLLBACK_SHA>"`, `"version":"2.0"`, and
`"backup":{…"status":"verified"…}`. A `"status":"release_mismatch"` with `503` means
step 5.3 set `RELEASE_SHA` but not `POCKETBASE_BACKUP_VERIFIED_RELEASE_SHA` — go back
to [Section 4](#4-the-trap-a-naive-image-rollback-takes-health-to-503).

**2. Health and the running image agree** — this is the check the nightly backup makes,
so run it now rather than discovering it at 07:17 UTC:

```bash
FLY_API_TOKEN="$FLY_API_TOKEN" \
FLY_BACKUP_APP=dealer-social-post-ai-production \
POCKETBASE_EXPECTED_ORIGIN=https://dealer-social-post-ai-production.fly.dev \
EXPECTED_GITHUB_REPOSITORY=TechSavvyJoe/Dealer-Social-Post-AI \
  node scripts/resolve-fly-backup-source.mjs
```

Expect `releaseSha` = `ROLLBACK_SHA`, `sourceImageDigest` = `ROLLBACK_DIGEST`,
`sourceIdentity` = `"health"`. Any thrown error means health and the image disagree.

**3. Every started machine runs the rolled-back digest and labels** (the assertion the
deploy job makes, `fly-deploy.yml:363-382`):

```bash
flyctl machine list --app dealer-social-post-ai-production --json > /tmp/machines-after.json
EXPECTED_IMAGE_DIGEST="$ROLLBACK_DIGEST" \
EXPECTED_RELEASE_SHA="$ROLLBACK_SHA" \
EXPECTED_GITHUB_REPOSITORY=TechSavvyJoe/Dealer-Social-Post-AI \
node -e '
const machines = require("/tmp/machines-after.json");
const started = machines.filter((m) => m?.state === "started");
if (!started.length) throw new Error("no started machines");
for (const m of started) {
  if (
    m.image_ref?.digest !== process.env.EXPECTED_IMAGE_DIGEST ||
    m.image_ref?.labels?.GH_SHA !== process.env.EXPECTED_RELEASE_SHA ||
    m.image_ref?.labels?.GH_REPO !== process.env.EXPECTED_GITHUB_REPOSITORY
  ) throw new Error("machine is not running the rollback image");
}
console.log(`${started.length} started machine(s) on ${process.env.EXPECTED_IMAGE_DIGEST}`);
'
```

**4. The trusted proxy path still works** (`fly-deploy.yml:564-566`):

```bash
curl --silent --show-error --fail --max-time 20 \
  https://dealer-social-post-ai.vercel.app/api/app/proxy-readiness
```

Expect `{"ok":true}`. A `503` here means the Vercel→Fly credential is not being
injected; it is not caused by an image rollback and points at Vercel env config
(`docs/production-backups-and-release.md:55-64`).

**5. The canonical origin serves the rolled-back frontend.**

```bash
npm run release:vercel:assert-alias -- dpl_<rollback deployment id>

curl --silent --show-error --fail --max-time 20 \
  https://dealer-social-post-ai.vercel.app/sw.js --output /tmp/sw-after.js
grep --quiet --fixed-strings "dsp-$ROLLBACK_SHA" /tmp/sw-after.js && echo ok

curl --silent --show-error --max-time 20 \
  https://dealer-social-post-ai.vercel.app/api/app/health --output /tmp/vercel-health.json
grep --fixed-strings "\"releaseSha\":\"$ROLLBACK_SHA\"" /tmp/vercel-health.json
```

The last one is the end-to-end proof: the origin users actually load, proxying through
to the backend, reporting the rolled-back SHA.

**6. Migrations did not go backwards.**

```bash
flyctl ssh console --app dealer-social-post-ai-production --command \
  'sqlite3 /pb/pb_data/data.db "SELECT COUNT(*) FROM _migrations;"'
```

Expect a count **greater than or equal to** the number recorded in step 0.4. A lower
number means something replaced the volume — stop and treat it as data loss, not a
rollback.

**7. Watch for at least 30 minutes.** Health, redacted client-error aggregates,
generation fallback rate, and Fly/Vercel logs
(`docs/production-backups-and-release.md:246`).

**8. Record the rollback.** At minimum: the SHA and digest you rolled _from_ (steps 0.1
and 0.2), the SHA/digest/deployment id you rolled _to_, which of the three secrets you
changed, the timestamp you used for `POCKETBASE_BACKUP_LAST_VERIFIED_AT` and where it
came from, and whether the nightly drill has since rebound the evidence. The existing
release doc already requires these to be recorded together
(`docs/production-backups-and-release.md:270`) but does not say where. See
[Decide and fill in](#decide-and-fill-in), item 5.

**9. Plan the exit.** A rollback is a holding position: `main` is still ahead of
production, merges are frozen, and the next merge will roll production forward
automatically. Land the forward fix (or an explicit revert) on `main` and let the
pipeline ship it.

---

## Decide and fill in

These values do not exist anywhere in this repository. They are **not** guessed above.
Fill each one in, then delete the surrounding note.

1. **Who may authorize a production rollback, and how `main` gets frozen.**
   Recommended default: the repository owner authorizes; freeze by enabling a branch
   protection rule or by announcing a merge freeze in the team channel before step 0.5.
   _Reasoning:_ `Deploy production` auto-fires on every successful CI run for `main`
   (`fly-deploy.yml:3-6`), so an unannounced merge silently undoes a rollback. There is
   no lock in the repo that prevents this.

2. **The threshold that turns "degraded" into "roll back".** Recommended default: roll
   back the frontend immediately for any error affecting sign-in or post creation for
   more than 5 minutes (it is a single alias move and touches no data); require an
   explicit owner decision for a backend image rollback, since it cannot revert
   migrations. _Reasoning:_ the two operations differ enormously in blast radius, and
   the repo's only stated observation window is the 30-minute post-release watch
   (`docs/production-backups-and-release.md:246`).

3. **Rollback policy for `POCKETBASE_BACKUP_LAST_VERIFIED_AT`.** Recommended default:
   reuse the target release's real drill timestamp when it is under 7 days old;
   otherwise leave the secret unchanged, accept the 503, and let the 07:17 UTC drill
   repair it. Never write `date -u` output that does not correspond to a drill that
   actually ran. _Reasoning:_ the field is restore _evidence_
   (`pb_hooks/main.pb.js:1007-1010`); a fabricated timestamp defeats the only mechanism
   that forces stale recovery evidence out of readiness.

4. **Whether a restore drill may be run from a workstation during an incident, and how
   the `production-backup` credentials are obtained.** Recommended default: no — use
   the scheduled workflow, and treat option 2 in step 5.2 (accept the 503) as the
   incident-time answer. _Reasoning:_ `npm run backup:create` needs the R2 and
   PocketBase admin credentials that are deliberately confined to a protected GitHub
   environment (`docs/production-backups-and-release.md:11-19`).

5. **Where the release record lives** — the log that holds, per release, the SHA, image
   digest, Vercel deployment id/URL, drill timestamp and backup object key.
   Recommended default: a pinned entry per release in the repository's release notes,
   or a single append-only document the on-call operator can reach without GitHub
   Actions. _Reasoning:_ `docs/production-backups-and-release.md:270` requires these to
   be recorded together but names no location, and the backend image digest is
   otherwise recoverable only from raw workflow logs
   ([Section 5.1](#51-recover-the-digest-you-are-rolling-back-to)).

6. **The minimum SHA that is a legal rollback target.**
   `docs/production-backups-and-release.md:248-249` requires rolling back only to "the
   authentication-hardening release or later" — never to code that accepts
   administrator secrets case-insensitively, persists them in dealer records, or lacks
   continuous session validation — but the actual SHA is not written down anywhere in
   this repository. Recommended default: record it once, next to the release record
   from item 5, and cite it here. _Reasoning:_ without a concrete SHA, this rule cannot
   be checked at 2am.

7. **Which uptime monitor watches `/api/app/health`, and who it pages.** Recommended
   default: name the monitor and its escalation target here, and note explicitly that
   Fly's own health check watches `/api/health` instead (`fly.toml:22-34`), so a 503 on
   `/api/app/health` will not remove the machine from rotation. _Reasoning:_ nothing in
   this repository configures or names an external monitor, yet several steps above
   depend on knowing whether a 503 pages someone.

---

## Verified against

Every command, path, secret name, schedule and threshold above was read from these
files at commit `7192eb1` on 2026-09-10.

| Claim                                                                                                                               | Source                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deploy triggers on CI completion for `main`; jobs refuse a superseded `main`                                                        | `.github/workflows/fly-deploy.yml:3-6, 18-22, 44-52, 234-242, 443-451`                                                                               |
| Concurrency group shared with the backup workflow                                                                                   | `.github/workflows/fly-deploy.yml:11-13`; `.github/workflows/pocketbase-backup.yml:11-13`                                                            |
| Deploy blocked unless `POCKETBASE_R2_BACKUPS_ENABLED=true`                                                                          | `.github/workflows/fly-deploy.yml:54-61`                                                                                                             |
| Candidate image tag `…:candidate-<sha>`; digest parsed from push output; digest form enforced                                       | `.github/workflows/fly-deploy.yml:187, 196-202, 307-311`                                                                                             |
| `flyctl auth docker`, `docker pull <image_ref>`                                                                                     | `.github/workflows/fly-deploy.yml:188, 203`                                                                                                          |
| Drill timestamp format and job outputs (`verified_at`, `image_ref`, `image_digest`)                                                 | `.github/workflows/fly-deploy.yml:205-212`; job outputs at `26-30`                                                                                   |
| Ten required Fly secret names; `flyctl secrets list --json` returns names only                                                      | `.github/workflows/fly-deploy.yml:248-277`                                                                                                           |
| Staged secrets (`RELEASE_SHA`, backup evidence, Turnstile, legacy flag) then `flyctl deploy --image … --wait-timeout 10m`           | `.github/workflows/fly-deploy.yml:324-337`                                                                                                           |
| Readiness greps `"ok":true`, `"status":"verified"`, `"releaseSha":"…"`                                                              | `.github/workflows/fly-deploy.yml:346-362`                                                                                                           |
| Machine digest + `GH_SHA` / `GH_REPO` label assertion                                                                               | `.github/workflows/fly-deploy.yml:363-382`                                                                                                           |
| Failure diagnostics: `flyctl status` / `machine list` / `logs --no-tail`                                                            | `.github/workflows/fly-deploy.yml:384-391`                                                                                                           |
| Frontend released after backend, because `/api/*` rewrites to Fly                                                                   | `.github/workflows/fly-deploy.yml:393-402`; `vercel.ts:61-62, 86`                                                                                    |
| Vercel CLI `58.4.4`, canonical host, org/project ids                                                                                | `.github/workflows/fly-deploy.yml:412-425`; `scripts/vercel-staged-release.sh:4-9`                                                                   |
| Bundle must carry its SHA; service worker bound as `dsp-<sha>`                                                                      | `.github/workflows/fly-deploy.yml:502-518`                                                                                                           |
| `/api/app/proxy-readiness` returns `{"ok":true}`                                                                                    | `.github/workflows/fly-deploy.yml:564-566`; `pb_hooks/main.pb.js:945-950`                                                                            |
| `vercel promote` insufficient; `vercel alias set` moves the canonical host; alias-side check required                               | `.github/workflows/fly-deploy.yml:570-593`                                                                                                           |
| Only `release-frontend` writes a step summary (frontend values, no backend digest)                                                  | `.github/workflows/fly-deploy.yml:598-610`                                                                                                           |
| Nightly drill cron `17 7 * * *`; scheduled runs target the running release; evidence refresh guard                                  | `.github/workflows/pocketbase-backup.yml:3-6, 56-75, 143-168, 178-182`                                                                               |
| Health `releaseSha` = `RELEASE_SHA` → `FLY_IMAGE_REF` → `"unknown"`, trimmed to 120 chars                                           | `pb_hooks/main.pb.js:995-1001`                                                                                                                       |
| Health rejects a non-40-hex `releaseSha` (`malformed releaseSha`)                                                                   | `scripts/resolve-fly-backup-source.mjs:52-59`                                                                                                        |
| `backup:create` / `backup:download` required environment; default R2 prefix; manifest comparison                                    | `scripts/pocketbase-r2-backup.mjs:17, 74-85, 121-124, 134, 149-157, 405-408, 483-526`                                                                |
| Volume prep runs before every pipeline backup                                                                                       | `.github/workflows/fly-deploy.yml:85-89`; `.github/workflows/pocketbase-backup.yml:86-90`; `scripts/prepare-fly-backup-volume.sh`                    |
| Candidate digest is echoed to `$GITHUB_OUTPUT` only; the log carries it via `docker push`/`docker pull`                             | `.github/workflows/fly-deploy.yml:196-203, 209-211`                                                                                                  |
| `backup.status` state machine; 7-day (`7 * 24` h) max age; `verified` ⇒ restore-ready                                               | `pb_hooks/main.pb.js:1002-1049`                                                                                                                      |
| Fly runtime detection; `off_box_restore_ready` false ⇒ `ok:false` ⇒ HTTP 503                                                        | `pb_hooks/main.pb.js:1260, 1284, 1295-1316`                                                                                                          |
| Health/image binding used by the backup job, and its exact error                                                                    | `scripts/resolve-fly-backup-source.mjs:44-60, 62-121, 142-153`                                                                                       |
| Volume mount `/pb/pb_data`; Fly check targets `/api/health`, not `/api/app/health`; 1 GB / 2 shared CPUs                            | `fly.toml:7-9, 22-34, 36-41`                                                                                                                         |
| PocketBase pinned `0.22.55`; migrations copied into the image                                                                       | `Dockerfile` (`ARG PB_VERSION=0.22.55`; `COPY pb_migrations /pb/pb_migrations`)                                                                      |
| 0.22-compatibility guard refuses to replace the database; serve flags                                                               | `entrypoint.sh:7-18, 26`                                                                                                                             |
| Every down-migration removes fields with `removeField(field.id)`; the older no-op idiom is rejected repository-wide                 | `pb_migrations/1751900000_employee_disclosure.js:56-64`; `__tests__/backendCompliancePolicy.test.ts` ("remove schema fields with an API that works") |
| A down-migration deliberately left inert for security                                                                               | `pb_migrations/1750300000_hash_session_tokens.js` (final block)                                                                                      |
| Forward-only upgrade smoke; `SELECT COUNT(*) FROM _migrations`                                                                      | `scripts/dirty-upgrade-smoke.sh:103-120, 169-170, 202-203, 267`                                                                                      |
| `vercel alias list --json --limit 100` paging                                                                                       | `scripts/vercel-staged-release.sh:224-231`                                                                                                           |
| Alias-propagation retry budget (10 × 10 s)                                                                                          | `scripts/vercel-live-bundle-assert.mjs:28-31`                                                                                                        |
| `--assert-alias` needs `VERCEL_TOKEN`, uses `VERCEL_ORG_ID`                                                                         | `scripts/vercel-live-bundle-assert.mjs:533-553`                                                                                                      |
| Restore drill script contract (`RESTORE_RELEASE_SHA`, `RESTORE_VERIFIED_AT`, `BACKUP_ZIP [IMAGE_TAG]`)                              | `scripts/verify-pocketbase-restore.sh:1-31`                                                                                                          |
| npm aliases `backup:create`, `backup:download`, `backup:restore-drill`, `release:vercel:assert-alias`, `release:vercel:assert-live` | `package.json` scripts                                                                                                                               |
| 30-minute post-release watch; rollback constraints; restore-not-rollback procedure; record-keeping requirement                      | `docs/production-backups-and-release.md:244-270`                                                                                                     |
| `production-backup` environment holds the R2 / PocketBase admin credentials                                                         | `docs/production-backups-and-release.md:11-19`                                                                                                       |
| `flyctl ssh console --command 'sqlite3 /pb/pb_data/data.db "…"'` form                                                               | `docs/production-backups-and-release.md:85-86`                                                                                                       |

**Two corrections to note if you have seen an earlier description of this system:**

- The backend image digest is **not** in any `GITHUB_STEP_SUMMARY`. The `deploy` job
  writes no summary; the only `GITHUB_STEP_SUMMARY` line in the whole workflow is
  `fly-deploy.yml:610`, in `release-frontend`, and it contains the release SHA,
  frontend deployment id, immutable URL and canonical origin (`fly-deploy.yml:598-610`).
  As a job output the digest is invisible in the log — recover it from the
  `docker push` / `docker pull` output instead
  ([Section 5.1](#51-recover-the-digest-you-are-rolling-back-to)).
- The **drill timestamp** is weaker still: it is written only to `$GITHUB_OUTPUT`
  (`fly-deploy.yml:209`) and appears in no log line, no summary and no readable Fly
  secret. Treat a past release's `POCKETBASE_BACKUP_LAST_VERIFIED_AT` as unrecoverable
  unless someone recorded it (step 5.2, option 1).
- PocketBase is pinned consistently to `0.22.55` in the release runbook,
  `Dockerfile`, and `start-pocketbase.sh` because the hooks still use the 0.22 JSVM API.
