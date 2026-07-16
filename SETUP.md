# Dealer Social Post AI setup

## Prerequisites

- Node.js 22.12 or newer
- `curl` and `unzip` for the verified PocketBase download
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey)

The repository is pinned to PocketBase `0.22.37`, the latest maintenance release on the compatibility line used by the current JSVM hooks. `start-pocketbase.sh` downloads the correct macOS/Linux and arm64/amd64 archive and verifies its SHA-256 checksum. The Docker image uses the same release.

## Install and configure

```bash
npm install
cp .env.example .env.local
```

At minimum, configure:

```bash
# Server-side only. Do not rename this to a VITE_-prefixed variable.
GEMINI_API_KEY=your-gemini-api-key

# Public frontend configuration.
VITE_POCKETBASE_URL=http://127.0.0.1:8090
```

Optional provider configuration:

```bash
# Cross-provider fallbacks are disabled unless explicitly enabled.
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
ENABLE_CLAUDE_FALLBACK=false
ENABLE_OPENAI_FALLBACK=false

# Public build-time flags; these are compiled into the frontend bundle.
VITE_ENABLE_CLAUDE_FALLBACK=false
VITE_ENABLE_OPENAI_FALLBACK=false
```

`GEMINI_API_KEY` and fallback-provider keys are read only by PocketBase hooks. The browser receives none of them. The `VITE_ENABLE_*` values are not secrets: Vite compiles them into the browser bundle. For a Docker/Fly build, pass them explicitly as build arguments while setting the matching `ENABLE_*` values and keys as runtime secrets:

```bash
fly deploy \
  --build-arg VITE_ENABLE_CLAUDE_FALLBACK=true \
  --build-arg VITE_ENABLE_OPENAI_FALLBACK=true
```

For dealer and administrator login provisioning, follow [DEALER_CODE_SETUP.md](DEALER_CODE_SETUP.md); it is the authoritative credential guide.

## Run locally

Start both services:

```bash
npm run dev:full
```

Or run them separately:

```bash
# Terminal 1
npm run start:backend

# Terminal 2
npm run dev
```

Local endpoints:

- Frontend: <http://localhost:5173>
- PocketBase API/admin: <http://localhost:8090>
- Readiness: <http://localhost:8090/api/app/health>

The public readiness response is intentionally aggregate. Detailed provider/configuration checks are returned only to an authenticated super-admin session.

## Authentication and provider requests

1. The browser sends a dealer credential to `POST /api/app/session`.
2. The server validates it and sets an opaque `dealer_session` cookie with `HttpOnly`, `Secure`, and `SameSite=Strict` attributes.
3. The browser includes that cookie on `/api/app/*` and `/api/proxy/*` requests.
4. PocketBase resolves the server-side session, applies role/rate-limit policy, and attaches the appropriate provider credential.
5. The database stores only the session token's SHA-256 verifier, never the bearer token itself.

Do not call Google directly from browser code or expose a provider key through a `VITE_*` variable.

## Model routing

The active, production-oriented routing lives in `services/modelConfig.ts`:

| Workload           | Models                                                                          |
| ------------------ | ------------------------------------------------------------------------------- |
| Text/captions      | `gemini-3.5-flash` → `gemini-3.1-flash-lite` → `gemini-2.5-flash`               |
| Images/edits       | `gemini-3-pro-image` → `gemini-3.1-flash-image` → `gemini-3.1-flash-lite-image` |
| Video (Gemini API) | `veo-3.1-generate-preview` → `veo-3.1-fast-generate-preview`                    |

The active video client uses Gemini API model IDs. Vertex `-001` model IDs are not valid substitutes on the Gemini API path, and generic Vertex proxy routes are intentionally denied by the server allowlist.

The primary and standard image tiers request 2K output. The Lite emergency model is sent 1K because that is the only resolution it supports.

## Project structure

```text
.
├── components/              # React product UI
├── services/                # Provider clients, routing, and app API clients
├── pb_hooks/                # Authenticated PocketBase API/proxy routes
├── pb_migrations/           # Forward-only schema/security migrations
├── scripts/                 # Guarded diagnostics and verification tools
├── start-pocketbase.sh      # Verified local PocketBase bootstrap
├── Dockerfile               # Node 22 build + PocketBase 0.22.37 runtime
└── .env.example             # Documented variables with no real secrets
```

`pb_data/` and `.env.local` are local/runtime state and must never be committed.

## Validate before deployment

```bash
npm run security:secrets
npm run typecheck
npm test
npm run build
npm audit --omit=dev
```

For a production rollout:

1. Rotate any secret previously exposed in source, generated artifacts, logs, or Git history.
2. Store secrets in the deployment secret manager, never in the frontend environment.
3. Take and verify a Fly volume/database snapshot before running forward-only migrations.
4. Deploy the backend, then confirm `/api/app/health`, session login/logout, tenant isolation, and one authorized provider smoke request.
5. Deploy the frontend/rewrite layer and repeat the same-origin session and generation checks.

The committed Fly workflow waits for the full `CI` workflow and fails if direct backend readiness does not recover. Vercel Git auto-promotion is an external project setting: disable it or require the successful Fly readiness job before promoting the matching frontend revision. Independent auto-deploys can create a split release when Fly fails.

Do not upgrade PocketBase beyond 0.22.37 as a routine dependency bump. Releases after the 0.22 compatibility line removed APIs used by the current hooks; upgrading requires a separately reviewed hook/migration port.

## Troubleshooting

### Generation returns 401 or 403

- Confirm the browser has a current dealer session; provider proxy routes require the session cookie.
- Confirm `GEMINI_API_KEY` is set in the PocketBase process environment.
- Restart only the development process you launched after changing `.env.local`.
- Check the backend log for the sanitized upstream status; do not paste keys or credential JSON into an issue.

### PocketBase does not start

- Check whether port 8090 is already in use with `lsof -nP -iTCP:8090 -sTCP:LISTEN`.
- Run `./pocketbase --version`; the supported local version is `0.22.37`.
- If the verified download fails, check network/TLS access to GitHub Releases. Do not substitute an unverified binary.

### Long-running image or video request times out

- Keep the browser open while Veo polls its asynchronous operation.
- Check provider quota and regional availability.
- Retry a smaller image or the configured fast Veo fallback.
- A 429 indicates quota/rate limiting, not proof that the entire integration is healthy.
