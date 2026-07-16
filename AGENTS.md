# AGENTS.md

## Cursor Cloud specific instructions

### What this app is
Dealer Social Post AI — a React 19 + Vite frontend served alongside a PocketBase
backend. PocketBase (`pb_hooks/main.pb.js`) implements custom `/api/app/*` and
`/api/proxy/*` routes and holds all AI provider keys server-side. There is one
product; a full dev setup runs both services.

### Services and how to run them
Standard commands live in `README.md`, `SETUP.md`, and `package.json` scripts.
Quick reference:
- Backend (PocketBase, port 8090): `npm run start:backend`
- Frontend (Vite, port 5173): `npm run dev` — Vite proxies `/api` → `127.0.0.1:8090`
- Both together: `npm run dev:full`
- Checks: `npm run typecheck` (this is the lint/type gate — there is no ESLint),
  `npm test` (vitest), `npx playwright test` (frontend-only smoke; stubs `/api`, no
  backend needed).

### Non-obvious setup caveats
- **PocketBase is pinned to 0.22.21** on purpose — the hooks and migrations use the
  0.22 JSVM API (`$app.dao()`, `new Dao(db)`, `$apis.requestInfo`, `collection.schema`)
  which was removed in PB 0.23+. Do NOT bump PocketBase without porting all hooks and
  migrations. `start-pocketbase.sh` downloads the binary on first run (gitignored).
- **`.env.local` is required for the backend to start.** `start-pocketbase.sh` sources
  it. Minimum useful contents: `ADMIN_DEALER_CODE` (enables super-admin login and
  auto-provisions a `SYSTEM ADMIN` dealer on first login with that code),
  `VITE_POCKETBASE_URL=http://127.0.0.1:8090`, and `GEMINI_API_KEY` (only needed for AI
  generation). Without a Gemini key the app runs and login works, but any
  image/caption/video generation fails and `/api/app/health` returns `ok:false` (503).
- **Fresh DB bootstrap:** `pb_data/` is gitignored, so each fresh machine bootstraps the
  schema from `pb_migrations/` on first `serve`. If a JS migration throws, PocketBase
  rolls the whole transaction back and refuses to start (you'll see only an empty
  `_migrations` table). Migration files iterate `collection.schema` — note that in PB
  0.22 `schema` is a struct with `getFieldByName()`, not an array.

### How to log in / test end to end
- Super-admin: log in with the `ADMIN_DEALER_CODE` value on the dialpad → routes to the
  multi-dealer `AdminDashboard`.
- Dealer manager (dealer-admin) and salesperson roster flows need a dealer that has an
  `admin_code`. Since these are seeded per-environment (not committed), create test data
  directly, e.g.:
  `sqlite3 pb_data/data.db "INSERT INTO dealers (id, code, name, admin_code, created, updated) VALUES ('demodlr0000001a','770011','Sunrise Auto Group','990011', strftime('%Y-%m-%d %H:%M:%fZ'), strftime('%Y-%m-%d %H:%M:%fZ'));"`
  then log in with `990011` → routes to `DealerAdminDashboard`, where the "Team" tab adds
  salespeople (`POST /api/app/salespeople`, JSON — this path works).

### Known pre-existing bug (not environment-related)
- Dealer create/update via the super-admin UI fails with
  `unsupported request content-type`. The handlers for `POST /api/app/dealers` and
  `PATCH /api/app/dealers/:id` in `pb_hooks/main.pb.js` call
  `form.loadRequest($apis.requestInfo(c), "")`, but PB 0.22's `RecordUpsertForm.loadRequest`
  expects the raw request (`c.request()`), not the `RequestInfo` object. This breaks the
  onboarding wizard "Finish setup" save and dealer editing for any content type. It is an
  application bug, not a setup issue; fix separately if needed.
