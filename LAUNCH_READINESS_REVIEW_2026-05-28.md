# Dealer-Social-Post-AI — Launch Readiness Review

**Reviewer:** Senior engineer (Claude, Opus 4.7)
**Date:** 2026-05-28
**Working tree:** `/Users/joegallant/AI App Development Projects/Dealer-Social-Post-AI`
**Commit reviewed:** `7c6af2a` (with substantial uncommitted work in the tree)

> **Scope note:** You asked me to review `LTV-Desking-PRO`. That folder isn't connected to Cowork; only `Dealer-Social-Post-AI` is. We agreed to pivot. Run a second pass against LTV-Desking-PRO after you switch folders.

---

## Verdict

**Don't sell this to dealers yet.** It is a real, working product with thoughtful auth ambitions (tenant isolation server-side, HttpOnly cookies, lock-down migrations, photo-release + approval gate, role split into salesperson / dealer_admin / super_admin). But there's one **critical privilege-escalation bug** in the cookie handler that lets any logged-in salesperson promote themselves to dealer-admin, plus a **proxy-token bypass** that lets anyone with the page source blow through your Gemini bill, plus **no login rate limiting** on a 4-digit code (10,000 combinations). Those three alone are blocking.

The good news: the bones are right. The data model, the route shape, the per-dealer settings, the disclosure handling, the salesperson FK on posts — all the right ideas. You're not far. **Realistic path to a paid pilot: ~3 focused weeks of P0 work + 2 weeks of P1.**

---

## Memory-tool review (the side question)

You asked me to review your memory stack. Quick read on the tri-sync:

| System | Status | Finding |
|---|---|---|
| **Pieces LTM** | ✅ Healthy | Returned full workstream history (65KB on a single query). Captures are flowing. |
| **memory-cloud KG** (Nowledge Mem) | ❌ **Empty** for these projects | Zero entities for `LTV-Desking`, `desking`, `Dealer-Social-Post`. The labeled KG you claim is synced nightly has nothing about either project. |
| **memory MCP / Knowledge Graph** | Same store as memory-cloud | Same result. |

**What's broken:** your nightly `memory-tri-sync-nightly` task either isn't running or isn't writing project-level entities to the KG. Pieces ≠ Nowledge Mem ≠ KG MCP. Right now you have one source of truth (Pieces) and two empty stores you *think* are backed up.

**Action:** run `mcp__scheduled-tasks__list_scheduled_tasks` and confirm the sync job exists and last-fire succeeded. If it does — the job logic isn't actually upserting entities. If it doesn't — you've been operating on memory you never persisted. Either way, **do not depend on Nowledge Mem for project context until this is fixed.** I'll happily build a real sync script when you're ready.

---

## P0 — Block launch. Fix this week.

### 1. Session cookie is unsigned → privilege escalation 🔴
**Where:** `pb_hooks/helpers.js:1-20`, `pb_hooks/main.pb.js:870` (Set-Cookie) and every `sessionRoleFromCookie(c)` call site.

**What's wrong:** the cookie value is `<dealerId>::<role>` in plaintext. `sessionRoleFromCookie` reads the role from whatever the client sends back. Yes, the cookie is HttpOnly+Secure+SameSite=Strict so JS can't write it in the browser — but **a normal HTTP client (curl, Postman, a script) can send any Cookie header it wants**. A salesperson logged into dealership `abc123` can fire:

```
curl -H "Cookie: dealer_session=abc123::dealer_admin" \
     -X PATCH https://your-app/api/app/posts/<theirOwnPostId> \
     -d '{"approval_status":"approved"}'
```

…and **approve their own post, bypassing the entire approval gate.** Same trick on `/api/app/salespeople`, `/api/app/dealers/:id` (PATCH) — they can edit their dealer's brand voice, custom scenarios, hashtags, color, etc. The only thing that holds is super_admin, because `isAdminDealer` re-checks against `ADMIN_DEALER_CODE` env. Everything else is broken.

**Fix:** sign the cookie. Two options:
- **Fast (do this now):** HMAC-SHA256 the `<dealerId>::<role>` payload with a server secret, append `::<sig>`, verify in helpers.js. ~30 lines of JS.
- **Right (do this next):** store sessions in a `sessions` PocketBase collection (token → dealerId, role, expires_at). Cookie carries only the opaque token. Forces server-side role resolution every request, supports revocation.

I recommend the right way — you'll want revocation when you fire a dealer-admin.

### 2. Proxy access token is bundled into the browser → infinite Gemini bill 🔴
**Where:** `.env.production:2` ships `VITE_PROXY_ACCESS_TOKEN` to the frontend build; commits `8007143`, `9cf98a2` confirm it.

**What's wrong:** `proxyHandler` (pb_hooks/main.pb.js:112) **only** checks the proxy token, **never** the session cookie. Anyone who opens devtools, finds the token in the JS bundle, and POSTs to `/api/proxy/v1beta/models/imagen-4:generateImages` is calling Vertex/Gemini on your dime. No per-dealer attribution, no rate limit (see #3), nothing.

**Fix:** require the session cookie on `/api/proxy/*` too. Drop the bundled token entirely — the cookie is sufficient. Update `proxyHandler` to call `dealerFromSession(c)` and `return c.json(401)` on miss. Rotate the production token after the fix ships in case it's been scraped.

### 3. Rate limiting is disabled in code 🔴
**Where:** `pb_hooks/main.pb.js:118-128` — literal `if (false)` dead branch and the comment `// Rate limiting disabled to prevent ReferenceError in JSVM`.

**What's wrong:** no per-dealer, per-IP, per-token cap on:
- The Gemini/Vertex proxy (cost exposure — Veo 3.1 video generation runs $0.40+ per second of output).
- The **login endpoint** (`/api/app/session`), which is a 4-digit code → 10,000 combinations, brute-forceable in <30 seconds with no lockout.

**Fix:**
- Move rate limiting out of the JSVM. PocketBase 0.38 has built-in rate limit middleware — use `app.OnServe()` or `app.OnRecordsListRequest()` in Go-side or the new `app.rateLimits` config (PB 0.22+). Failing that, put a Cloudflare Worker or Fly's `[http.checks]` rate limit in front of `/api/proxy/*` and `/api/app/session`. **Login: max 5 attempts per IP per 15 min; lockout the dealer code for 30 min after 10 fails.**
- Log every failed login to the `posts`-adjacent or new `auth_events` collection so dealers can see attempts. CSI talking point too.

### 4. 4-digit dealer codes are not an auth system 🔴
**Where:** `pb_migrations/1732490001_initial_dealers.js`, every login flow.

**What's wrong:** 4 digits, no rate limit, no rotation, code visible in admin dashboard, doubles as session identifier. Acceptable for a personal demo, not for production where each code maps to a customer's social media posting authority + their salespeople's customer names + VINs.

**Fix (minimum viable):**
- Move to 6-digit codes (1M combinations) and require alphanumeric for `admin_code` (still tap-friendly on iPad).
- Add the rate-limit + lockout in #3.
- Force a code rotation when a dealer reports it leaked.
- Audit log every login (who, when, IP, success/fail).

**Fix (right):** OTP via SMS/email for first login, then session cookie with refresh. Twilio + your existing `phone` field on the dealer record. ~2 days of work. **Do this before sale #5.**

### 5. PocketBase 0.38 on shared-CPU 256MB Fly VM won't scale past ~10 dealers 🔴
**Where:** `fly.toml:13` (`memory_mb = 256`), `fly.toml:8` (`min_machines_running = 0` — cold starts).

**What's wrong:**
- PocketBase is single-binary SQLite. Fine for low concurrency, but Veo video gen takes 60-300s per request and ties up an SQLite write connection while the proxy is forwarding. Two simultaneous video generations = lock contention.
- `min_machines_running = 0` means cold starts for the first dealer to hit the app every morning. A 10-second cold start + a 90-second image-gen = a salesperson watching a spinner for 100 seconds. That's the kind of experience that ends pilots.
- 256MB is below the working-set of a Node 22 + PB binary + concurrent Veo requests. You'll OOM under load.

**Fix:**
- **Bump:** `memory_mb = 1024`, `min_machines_running = 1`, `cpu_kind = "performance"`, `cpus = 2`. ~$15/mo Fly cost.
- **Right answer (before dealer #10):** PocketBase → Supabase (Postgres + Storage + Edge Functions). The DB layer here is trivial — six tables, no joins more complex than dealer→posts. A weekend migration. You get pg_stat for cost attribution, real backups, real concurrency, and a path to per-tenant RLS that doesn't rely on hand-rolled `/api/app/*` gates.

### 6. Service-account JSON is in git history 🟠 (still — Joe knows about this)
**Where:** `SECURITY_ACTIONS.md` documents it, but per `git log --all -- gen-lang-client-*.json`, the file's still in history at commit `f6f2df2`.

**Fix:** the checklist in your own `SECURITY_ACTIONS.md` is correct. Do it. Until you do, treat that GCP project as compromised. **This is P0 if the repo is public.** Check `git remote -v` and verify the GitHub repo visibility before assuming P1.

### 7. CSP allows external CDN with no SRI → supply chain risk 🟠
**Where:** `index.html:11` — `script-src 'self' 'unsafe-inline' https://aistudiocdn.com` and the importmap loads React + @google/genai from `aistudiocdn.com`.

**What's wrong:** you're pulling React 19.2 and Google's genai SDK from a Google CDN (`aistudiocdn.com`), unpinned by hash. If that CDN is ever compromised — see what happened to `polyfill.io` in 2024 — every dealer's browser executes whatever the attacker uploads. No SRI, no fallback. Bonus: `'unsafe-inline'` on script-src defeats most XSS protections.

**Fix:**
- Bundle React and @google/genai with Vite — you already have `@google/genai: ^2.2.0` in package.json so the CDN import is duplicative.
- Drop `'unsafe-inline'` from script-src once everything is bundled. Move inline scripts to nonce-based.
- Replace `'unsafe-inline'` on style-src with a hash list, or accept the residual risk (low — most XSS via style is cosmetic).

---

## P1 — Before paid pilot. Next ~2 weeks.

### 8. Repo hygiene is masking real bugs
- **13 `dist*/` folders** in the working tree (~30MB). Already gitignored but pollute every `git status`. `rm -rf dist-v* dist-fresh dist-new` once and add a CI rule.
- **3 `fix_migrations*.cjs` files** at root. Either consolidate them into a single migration runbook or delete them once you've cleaned production state.
- **39 scripts** in `/scripts/` — many are one-off probes (`debug_models_proxy.js`, `verify_*`, `repro_production_error.js`). Move to `scripts/archive/` or delete. **Keep:** `sync_prod_to_local.js`, `init-database.js`, `test_api_keys.js`. Everything else is noise.
- The working tree right now has **40+ modified/untracked files**. Commit or revert before you ship anything else. Long-lived dirty trees hide regressions.

### 9. Test coverage is a launch blocker
**Where:** `__tests__/` — 4 files, 565 lines total.

You have tests for `DragDropReproduction`, `PostCustomizer`, `errorHandler`, `persistence`. **Zero tests for:**
- The session/role logic in pb_hooks (the thing that just broke per P0 #1)
- `findDealer` / `addDealer` / `deleteDealer` round-trip
- The disclosure detection logic (compliance — this is the kind of thing that gets a dealer fined)
- The Gemini proxy SSRF + path allowlist
- The geminiService 1000-line file (the core feature)

**Action:**
- Add Vitest tests for `services/geminiService.ts` happy path + fallback chain.
- Add Playwright e2e tests for the dealer code login + post generation flow. You have `@playwright/test` installed but the workflow file was deleted (`D .github/workflows/playwright.yml`). Restore it.
- Add a security-focused test that fires the forged cookie at `/api/app/posts/:id` PATCH and asserts 403.
- Aim for ~50% line coverage on `services/` and `pb_hooks/` before launch. Won't be perfect — will catch the obvious regressions.

### 10. Compliance is half-built
You've thought about disclosures (`GeneratedPost.disclosures`, `disclosureCategories`). Good. But:
- **No FTC Safeguards Rule documentation.** If you store customer names, VINs, and signatures (you do — `photo_releases` collection), you're a "financial institution service provider" under the FTC Safeguards rule (16 CFR 314). You need a written infosec program, an incident response plan, and breach notification within 30 days. **Cannot sell to a dealer without these — their compliance officer will ask.**
- **No data retention policy.** How long do you keep generated images, customer names, VINs, signatures? Default to 90 days unless contractually required.
- **No DPA / SaaS agreement template** for dealers to sign. Get one ($500-$2000 from a SaaS-lit attorney; Michigan auto attorney can mirror your Hertz template if you have one).
- **Photo release signatures** are stored — are they timestamped server-side, immutable, and exportable for litigation? Check the `photo_releases` collection schema (`pb_migrations/1748000000_create_photo_releases.js`) and verify `signed_at` is server-set and the collection has no `update`/`delete` rules.
- **EU residents** (if any dealer has them as customers): you're storing a "likeness." GDPR Article 9 territory. Either geo-fence to US/Canada or add explicit consent + right-to-erasure flow.

### 11. The pb_hooks JWT signing is fragile
**Where:** `pb_hooks/main.pb.js:280-405`.

You're shelling out to `openssl` per request: write private key to disk (`temp_key_<now>.pem`), write payload, run `openssl dgst -sha256 -sign`, base64-encode, clean up. Issues:
- `cachedAccessToken` and `tokenExpiry` are referenced (line 160, 391) but never declared. Either dead code path or it's relying on JSVM globals — which is exactly why rate limiting got broken (commit `d2ddd56`).
- Race condition: `now = Date.now() / 1000` is **seconds precision**. Two simultaneous Vertex requests in the same second write to the same temp file. One wins, one corrupts.
- Private key hits disk every request. On Fly's tmpfs that's fine for security; not fine for I/O. ~5-50ms per token.

**Fix:** the JWT signing has no business being in JSVM. Options:
- Write a tiny Go pb_hook (PB supports it) that does JWT signing in-process. ~50 lines.
- Pull JWT signing entirely out — use `gcloud auth application-default print-access-token` via a sidecar, or use Google's metadata server if you run on Cloud Run (not Fly).
- Cache the access token properly — Vertex tokens are valid for 60 minutes, you should be making ~one token request per hour, not per call. **Define `cachedAccessToken` and `tokenExpiry` at module scope** (they're referenced but never declared, which is why caching doesn't work).

### 12. Body validation is hand-rolled and inconsistent
**Where:** every `/api/app/*` POST/PATCH does `(body.field || "").toString().slice(0, 120)`.

You have Zod 4 in the frontend. Server-side, you're hand-validating with truncation. That's actually OK *if exhaustive*, but you've already got cases where it isn't — e.g. `salesperson_id` is taken at face value (line 1031), then re-fetched and checked for dealer match. Good defense in depth, but inconsistent across endpoints.

**Fix:** PocketBase JSVM doesn't have Zod natively. Either:
- Bundle Zod into the hooks via esbuild (you already have it).
- Or define a tiny in-house validator (3 lines per endpoint): `assertString(body.x, 120)`, `assertEnum(body.y, ALLOWED)`.

### 13. The `<dealerSession>::role` cookie also has a TTL problem
Set-Cookie says `Max-Age=604800` (7 days). After 7 days, the dealer is silently logged out — no refresh, no warning. For a tool a salesperson lives in 8 hours a day, that's annoying; for a tool a dealer-admin checks once a month for the leaderboard, that's worse.

**Fix:** refresh the cookie on every request (sliding window). Or add a refresh endpoint. Or move to JWT with refresh tokens. The DB-session approach in P0 #1 handles this naturally.

### 14. No observability past `console.log`
Your `/api/telemetry` endpoint logs to stdout. Fly retains stdout for 24h.

**Fix:**
- Wire Sentry (you can use Sentry's MCP — `mcp__2d610712-50d3-4474-a3f6-dffb7afd8f03__*` tools confirm you have it connected) for both frontend (`@sentry/react`) and PB hooks (Sentry Node SDK works in JSVM with shim, or post events via HTTP).
- Add an `auth_events` collection: failed/successful logins, role-elevation attempts, post-approval actions. Auditable for compliance.
- Health endpoint already exists (`/api/app/health`) — wire it into Fly's `[http.checks]` and an external uptime monitor (Better Stack / Healthchecks.io).

### 15. The leaderboard / posts query has no index
`findRecordsByFilter("posts", "dealer = {:d} && generated_at >= {:s}", ...)`. With one dealer + low volume, fine. At 50 dealers × 30 posts/day × 365 days = 547K rows, this will get slow on SQLite without an index on `(dealer, generated_at)`.

**Fix:** when you migrate to Supabase (recommended in #5), add the index. On PocketBase, drop it in via a migration `dao.db().newQuery("CREATE INDEX IF NOT EXISTS idx_posts_dealer_time ON posts(dealer, generated_at DESC)").execute()`.

---

## P2 — Polish before scale. ~1 month.

- **CI/CD:** the Playwright workflow was deleted. Restore it. Add `npm run typecheck` + `npm run test` as required checks before merge. Bonus: a build-and-deploy preview per PR using Fly's preview apps.
- **Frontend perf:** index.html ships 200+ lines of critical CSS inline. That's fine. But the importmap CDN pull (P0 #7) costs ~400ms TTFB on a cold Vercel cache. Bundle and you're at ~150ms.
- **Mobile a11y:** WCAG 2.2 AA — the 4-digit dialpad has no aria-label per-digit, no live region announcing failures, and the success "Welcome!" toast doesn't get focus. EU EAA in force since June 2025; if any dealer sells to EU customers via their public-facing posts, you're partially on the hook. ADA Title II deadlines hit April 2027 in the US. Fix it now while the codebase is small.
- **Brand customization is half-done:** `Dealer.brand_color` exists in types but the actual themed login screen still hardcodes `bg-slate-950` and `text-primary-400`. Either wire the theme through Tailwind CSS variables (Tailwind v4 supports this natively — bump from v3.4 to v4) or admit you don't theme yet.
- **Salesperson PINs are stored plaintext** (`salespeople.pin` field). Argon2id hash them. PB hooks can call Go's crypto via `$security.randomString()` and you can ship a tiny wasm bcrypt if no native.
- **No CSV export** of posts / leaderboard. Every dealer GM will ask for this in week 1.
- **No multi-image generation** in a single session. Salespeople will want to grind 5-10 posts a day. The current flow makes them go all the way through reset/recapture every time. Add a "generate another from this same vehicle" affordance on the result screen.
- **The 20-style video catalog is great content but `VideoStyle` enum has 20 members and no UI is sorting them by what actually performs on Reels/TikTok.** Add a "Top performers this week" pill that tracks reaction counts per style. Lets you A/B and gives sales a story.
- **No "fleet" view** for multi-rooftop dealer groups (LaFontaine has 30+ rooftops). One admin login that switches between rooftops is a top-3 enterprise sales objection. Add a `dealer_groups` collection later.

---

## Memory-tool fix — concrete next step

Replace your current "tri-sync" assumption with one real path:

1. **Today (5 min):** verify the scheduled task. If broken, disable it so you stop believing memory is being saved.
2. **This week (1 hr):** write a single nightly job that scrapes Pieces summaries → upserts entities into memory-cloud KG with `joe-gallant` label. Don't trust three systems to stay in sync; trust Pieces as truth, sync downward.
3. **Verify weekly:** `mcp__mcp-manager__memory-cloud__search_nodes` with `query: "LTV-Desking"` should return non-zero next Sunday.

I can build this when you ask.

---

## Sequencing — what to do in what order

| Week | Focus | Concrete deliverable |
|---|---|---|
| **Week 1 (P0 burn-down)** | Sign cookies, drop bundled proxy token, rate-limit login + proxy, rotate GCP key + scrub git history, bump Fly VM to 1GB/2cpu. | A demo that doesn't fail a 1-hour pen test. |
| **Week 2 (P0 finish)** | Replace 4-digit codes with OTP-on-first-login + signed session token from DB. Restore Playwright CI. Add 8 e2e + 12 unit tests covering auth + tenant isolation. | Green CI, no known auth holes. |
| **Week 3 (P1: compliance + obs)** | Wire Sentry. Add `auth_events` collection. Draft Safeguards-Rule infosec doc. Get a SaaS DPA template. Lock photo_release immutability. Index posts. | Compliance one-pager you can hand a dealer's GM. |
| **Week 4 (P1: stability)** | Repo hygiene cleanup. Fix JWT signing (proper caching, module-scope variables, no shell race). Replace hand-rolled body validators with bundled Zod. Refresh cookie TTL. | Stable enough for a 30-day paid pilot. |
| **Week 5 (pilot launch)** | Migrate one friendly dealer (Mission Ford or Golden Rule) to a paid tier. Watch the auth_events log. Iterate on the leaderboard. | First paying dealer. |
| **Month 2-3 (P2 + scale)** | Supabase migration. Tailwind v4 + real theming. CSV export. Multi-shot generation. Fleet view. Mobile a11y pass. | Sellable to LaFontaine. |

**Realistic time-to-first-paid-dealer:** 4 weeks of disciplined work.
**Realistic time-to-multi-rooftop-enterprise-sale:** 3 months.

---

## What you got right (don't change)

- The role split (`salesperson` / `dealer_admin` / `super_admin`) is the right shape.
- Session-gated `/api/app/*` endpoints (forcing dealer from cookie, not from request body) is the right pattern — once the cookie is actually trusted (#1).
- The disclosure object on `GeneratedPost` separating compliance text from caption text is exactly right and most competitors don't do it.
- Photo releases as first-class records (not just files on disk) — right call.
- The `requires_approval` gate per dealer is a real feature manager-level buyers will pay for.
- Tenant isolation in the post-PATCH handler (`record.getString("dealer") !== dealer.id`) is correct defense-in-depth.
- Zod 4 + TypeScript 6 + React 19 + Vite 8 — modern, sensible stack. Don't get talked into rewriting it.
- The progress messages, haptic feedback, dialpad UX — this looks like a tool a salesperson would actually use on the lot.

---

## What I'd build first if this were mine

Two evenings of work, three changes:

1. Move session storage to a `sessions` collection. Signed opaque token in the cookie. (~3 hours)
2. Make `/api/proxy/*` require a session cookie. Delete the bundled proxy token entirely. (~1 hour)
3. Hard-cap `/api/app/session` at 5 attempts/IP/15min with PB's middleware. Add an `auth_events` row per attempt. (~2 hours)

Ship those three, redeploy, do a 30-minute pen test, and you've eliminated the three things that would torpedo a pilot in the first week. The rest is engineering hygiene that can land incrementally.

---

*Reviewer's note: I read pb_hooks/main.pb.js (1,428 lines), pb_hooks/helpers.js, services/database.ts, services/posts.ts, types.ts, App.tsx, hooks/useAppController.ts, components/LoginScreen.tsx, ErrorBoundary.tsx, index.html, Dockerfile, fly.toml, entrypoint.sh, utils/schemas.ts, four pb_migrations (lock_collection_rules, add_admin_dealer, create_posts, dealer_admin_code), package.json, .env files, .gitignore, README/SETUP/SECURITY_ACTIONS docs, plus 25 commits of git history. Findings are anchored to file:line where possible. The Pieces LTM search returned a 65KB workstream dump; I skimmed the index but did not exhaustively read every entry. The memory-cloud KG and KG MCP returned empty results for both project names.*
