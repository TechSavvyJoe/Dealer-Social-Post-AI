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
- Checks: `npm run typecheck` (this is the type/lint gate — there is no ESLint),
  `npm test` (vitest), `npx playwright test` (frontend-only smoke; stubs `/api`, no
  backend needed).

### Non-obvious setup caveats
- **PocketBase is pinned to 0.22.37** on purpose — the hooks and migrations use the
  0.22 JSVM API (`$app.dao()`, `new Dao(db)`, `$apis.requestInfo`, `collection.schema`,
  `c.pathParam(...)`, `c.request()`) which changed in PB 0.23+. Do NOT bump PocketBase
  without porting all hooks and migrations. `start-pocketbase.sh` downloads the binary on
  first run (gitignored).
- **`.env.local` is required for the backend to start.** `start-pocketbase.sh` sources
  it. Minimum useful contents: `ADMIN_DEALER_CODE` (enables super-admin login and
  auto-provisions a `SYSTEM ADMIN` dealer on first login with that code),
  `VITE_POCKETBASE_URL=http://127.0.0.1:8090`, and `GEMINI_API_KEY` (only needed for AI
  generation). Without a Gemini key the app runs and login works, but any
  image/caption/video generation fails and `/api/app/health` returns `ok:false` (503).
- **AI generation** (captions + branded images) routes through the session-gated
  `/api/proxy/*` PocketBase route, which appends `GEMINI_API_KEY` server-side and calls
  the Gemini API. The frontend model chain (`services/modelConfig.ts`) prefers preview
  models (e.g. `gemini-3-*`) and falls back to GA models like `gemini-3.1-flash-lite` or
  `gemini-3.1-flash-image`, so generation works even if a preview model id isn't
  available to your key.
- **Fresh DB bootstrap:** `pb_data/` is gitignored, so each fresh machine bootstraps the
  schema from `pb_migrations/` on first `serve`. If a JS migration throws, PocketBase
  rolls the whole transaction back and refuses to start (you'll see only an empty
  `_migrations` table). Migrations use PB 0.22 accessors (e.g. `schema.getFieldByName()`).

### How to log in / test end to end
- Super-admin: log in with the `ADMIN_DEALER_CODE` value on the dialpad → routes to the
  multi-dealer `AdminDashboard`.
- Dealer manager (dealer-admin) and salesperson roster flows need a dealer that has an
  `admin_code`. Since these are seeded per-environment (not committed), create test data
  directly, e.g.:
  `sqlite3 pb_data/data.db "INSERT INTO dealers (id, code, name, admin_code, created, updated) VALUES ('demodlr0000001a','770011','Sunrise Auto Group','990011', strftime('%Y-%m-%d %H:%M:%fZ'), strftime('%Y-%m-%d %H:%M:%fZ'));"`
  then log in with the dealer `code` (`770011`) for the salesperson capture/generate flow,
  or the `admin_code` (`990011`) for the `DealerAdminDashboard` (Team tab adds salespeople
  via `POST /api/app/salespeople`).
