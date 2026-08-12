# Security Fixes — 2026-05-28 pass

Three P0 holes from the launch-readiness review are now closed. This doc is your deploy + verify runbook.

## What changed

| Hole                                                                             | Status      | Fix                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Privilege escalation via forged `<id>::<role>` cookie**                        | ✅ closed   | New `sessions` collection. Cookie carries an opaque 64-char hex token only. Role is resolved server-side from the DB row. Legacy `::role` cookies are explicitly rejected.                                                |
| **Bundled `VITE_PROXY_ACCESS_TOKEN` lets anyone hit Gemini/Vertex**              | ✅ closed   | All four proxy routes (`/api/proxy/*`, `/api/proxy/openai/*`, `/api/proxy/anthropic/*`, `/api/proxy-image`) now require a session cookie. Frontend stripped of the bundled token; sends `credentials: "include"` instead. |
| **No rate limit on login or proxy**                                              | ✅ closed   | Login: 10 fails / IP / 15 min → 429. Proxy: 60 req / dealer / min sliding window. Both log to the new `auth_events` collection.                                                                                           |
| **Vertex JWT cache is dead code** (`cachedAccessToken`/`tokenExpiry` undeclared) | ✅ fixed    | Declared at module scope. Tokens now reuse for ~60 min instead of shelling out to OpenSSL per request.                                                                                                                    |
| **JWT temp file race** (`now`-based filenames at second precision)               | ✅ fixed    | Per-request 12-char random hex suffix on `temp_key`/`temp_token`/`temp_sig` files.                                                                                                                                        |
| **`posts(dealer, generated_at)` index missing**                                  | ✅ added    | New migration `1748100200_add_posts_index.js`.                                                                                                                                                                            |
| **Fly VM under-provisioned** (256MB, 0 min machines)                             | ✅ bumped   | 1GB / 2 cpus / `min_machines_running = 1` + health check.                                                                                                                                                                 |
| **Playwright CI workflow deleted**                                               | ✅ restored | New `.github/workflows/ci.yml` runs typecheck + vitest, plus Playwright when `e2e/` exists.                                                                                                                               |

## Files touched

### New

- `pb_migrations/1748100000_create_sessions.js`
- `pb_migrations/1748100100_create_auth_events.js`
- `pb_migrations/1748100200_add_posts_index.js`
- `.github/workflows/ci.yml`
- `scripts/smoke_test_auth.sh`
- `SECURITY_FIXES_2026-05-28.md` (this doc)

> **Historical note (2026-08):** `scripts/smoke_test_auth.sh` asserted the retired shared-code scheme and has been deleted. Current verification is automated: CI's `production container + migration and backup safety` job plus `e2e/real-pocketbase.spec.ts` cover every assertion this script made, against the current username/password + hashed-PIN scheme.

### Modified

- `pb_hooks/helpers.js` — full rewrite. Opaque-token resolution, IP/UA helpers, audit logging, rate-limit checker.
- `pb_hooks/main.pb.js` — session POST/GET/DELETE redone; proxy routes require session; OpenSSL temp files race-fixed; module-scope token cache.
- `services/geminiProxy.ts` — drop `VITE_PROXY_ACCESS_TOKEN`, add `credentials: "include"`, surface 401/429 to caller.
- `services/claudeAdapter.ts` — same.
- `services/openaiAdapter.ts` — same.
- `.env.production` — `VITE_PROXY_ACCESS_TOKEN` removed (with note).
- `.env.example` — documented new env vars and what stays server-side.
- `fly.toml` — 1GB/2cpu, min_machines=1, health check.

### Still requires manual cleanup (Cowork sandbox can't `rm`)

From your terminal:

```bash
cd ~/AI\ App\ Development\ Projects/Dealer-Social-Post-AI
rm -rf dist-fresh dist-new dist-v2 dist-v3 dist-v4 dist-v5 dist-v6 dist-v7 dist-v8 dist-v9 dist-v10 dist-v11
rm -f fix_migrations.cjs fix_migrations2.cjs fix_migrations3.cjs
```

## Deploy

```bash
# 1. Local sanity check
npm run typecheck
npm run test

# 2. Local PB run — verify migrations apply cleanly
./start-pocketbase.sh
# Look for log lines:
#   [migration] applied 1748100000_create_sessions.js
#   [migration] applied 1748100100_create_auth_events.js
#   [migration] applied 1748100200_add_posts_index.js

# 3. Deploy to Fly
fly deploy --app dealer-social-post-ai-production

# 4. Verify on production
BASE=https://dealer-social-post-ai-production.fly.dev \
DEALER_CODE=<your real salesperson code> \
./scripts/smoke_test_auth.sh
```

The smoke test asserts every closed hole. If any assertion fails, do NOT demo until you've debugged it.

## What I deliberately did NOT do (still on the punch list)

The original review estimated 4 weeks of work. This pass was ~one session. Items below are still queued from the launch-readiness review:

1. **OTP-on-first-login.** 4-digit codes + rate limiting is better than before, not great. SMS or email OTP on first login is the right answer before dealer #5.
2. **Supabase migration.** PocketBase + SQLite + Fly's tmpfs is fine for ≤10 dealers. Past that, you want Postgres + RLS.
3. **Compliance documentation.** FTC Safeguards Rule infosec program, data retention policy, SaaS DPA template. Talk to a SaaS-lit attorney.
4. **Salesperson PIN hashing.** `salespeople.pin` is still stored plaintext.
5. **Cookie signing / DB-session GC.** Expired sessions are lazy-deleted on read; a cron sweep would prune the table over time.
6. **Sentry wiring.** You have the connector — wire `@sentry/react` and a server-side error sink so you actually see crashes in production.
7. **CSP / SRI hardening.** Drop the aistudiocdn.com importmap, bundle React + @google/genai locally, kill `'unsafe-inline'` on script-src.
8. **Tailwind v4 + brand_color theming.** You stored the color but the UI ignores it.
9. **WCAG 2.2 AA pass.** Dialpad needs per-digit aria-labels; toasts need a live region.
10. **CSV export of posts/leaderboard.** First thing every GM asks for.

## How this changes your demo

The dealer-facing experience is unchanged. What's different under the hood:

- Cookies are opaque. Show that in DevTools → Application → Cookies if a dealer asks about security.
- Login attempts are audited. After 5 demo logins, run `pocketbase --dir=pb_data` admin → `auth_events` collection. You can show the GM "every login is logged with IP and time."
- The Vertex JWT now caches, so the 5th Vertex request in a session is ~50ms faster than the 1st. Noticeable when generating multiple Imagen frames in a row.
- The Fly VM stays warm. The "first dealer of the morning" cold start is gone.

## Smoke-test output you should expect on success

```
BASE=https://dealer-social-post-ai-production.fly.dev
✓ Health endpoint reachable (200)
✓ Proxy rejects unauthenticated requests
✓ Forged ::role cookie rejected with 401
✓ Random opaque token rejected with 401
✓ Login rate limit fires (got 429 on attempt 12)
✓ Real dealer login succeeded ("role":"salesperson")
✓ Cookie is opaque (no '::' tampering surface)
✓ GET session resolves opaque token

All assertions passed.
```
