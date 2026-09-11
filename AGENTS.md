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

- **PocketBase is pinned to 0.22.55** on purpose — the hooks and migrations use the
  0.22 JSVM API (`$app.dao()`, `new Dao(db)`, `$apis.requestInfo`, `collection.schema`,
  `c.pathParam(...)`, `c.request()`) which changed in PB 0.23+. Do NOT bump PocketBase
  without porting all hooks and migrations. `start-pocketbase.sh` downloads the binary on
  first run (gitignored).
- **`collection.schema` is a Go struct, not a JS array.** Two idioms that look right are
  silent no-ops on 0.22 — the CLI prints "Applied"/"Reverted" and nothing changes:
  `collection.schema = Array.from(collection.schema).filter(...)` to remove a field, and
  any helper that reads `schema.length` or `schema[i]` to look one up. Use the methods:
  `collection.schema.getFieldByName(name)` to find, `collection.schema.addField(new
SchemaField(...))` to add, and `collection.schema.removeField(field.id)` — the **id**,
  never the name — to remove. `__tests__/backendCompliancePolicy.test.ts` rejects the
  no-op shapes repository-wide; 21 migrations were converted and proven against the real
  binary on 2026-09-10 after a plaintext-credential column one of them "dropped" turned
  out to still be in production. Verify any new down-migration against a copy of
  `pb_data` rather than trusting the CLI output.
- **`.env.local` is required for the backend to start.** `start-pocketbase.sh` sources
  it. Minimum useful contents: `ADMIN_LOGIN_USERNAME` + `ADMIN_LOGIN_PASSWORD` (the
  system-admin account is provisioned/rotated from these at boot; rotation invalidates
  outstanding admin sessions), `VITE_POCKETBASE_URL=http://127.0.0.1:8090`, and
  `GEMINI_API_KEY` (only needed for AI generation). Without a Gemini key the app runs and login works, but any
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

- Super-admin: **System admin** tab on login with the `ADMIN_LOGIN_USERNAME` /
  `ADMIN_LOGIN_PASSWORD` credentials → multi-dealer
  hub (`AdminDashboard`) with tabs **Dealers | Admins | Users**. Use **Open as** to
  impersonate any manager or salesperson.
- Store access uses **personal 4-digit codes** on the people roster (`salespeople`
  collection with `role` = `manager` | `salesperson`), not shared dealer codes.
  Create people from the hub (or Team tab for salespeople only as a manager).
- Example seed (after migrations): create a dealer via the hub UI, then add a manager
  and a salesperson with unique 4-digit pins. Login with those pins on **Personal code**.
