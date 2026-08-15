# Dealer Social Post AI setup

## Prerequisites

- Node.js 22 (`22.23.1` is pinned in `.node-version` and `.nvmrc`)
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

# Local-only bootstrap credentials. Production must use separately generated
# values stored as deployment secrets (username 3-32 chars, password 8-128).
ADMIN_LOGIN_USERNAME=admin
ADMIN_LOGIN_PASSWORD=your-admin-password

# Public frontend configuration.
VITE_POCKETBASE_URL=http://127.0.0.1:8090
VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA
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
VITE_WALKAROUND_STUDIO_ENABLED=false
```

Enable `VITE_WALKAROUND_STUDIO_ENABLED=true` only in a build whose private
upload broker, durable worker, and dealership YouTube connection have passed
the walkaround release gates. The browser otherwise exposes only Photo Post.

The PocketBase runtime has a separate fail-closed gate and private service
configuration. Do not reuse a browser-exposed value for any token or signing
secret:

```bash
WALKAROUND_STUDIO_ENABLED=false
WALKAROUND_GCS_BUCKET=
WALKAROUND_UPLOAD_BROKER_URL=
WALKAROUND_UPLOAD_BROKER_TOKEN=
WALKAROUND_YOUTUBE_BROKER_URL=
WALKAROUND_YOUTUBE_BROKER_TOKEN=
WALKAROUND_WORKER_TOKEN=
WALKAROUND_WORKER_SIGNING_SECRET=
```

Manager YouTube authorization starts at
`POST /api/app/walkarounds/youtube/connect`. After Google returns the broker's
one-time state reference, the manager completes the connection through
`POST /api/app/walkarounds/youtube/complete`; PocketBase re-fetches the channel
from the trusted broker and never accepts a browser-supplied channel ID or
OAuth token.

`GEMINI_API_KEY` and fallback-provider keys are read only by PocketBase hooks. The browser receives none of them. The `VITE_ENABLE_*` values are not secrets: Vite compiles them into the browser bundle. For a Docker/Fly build, pass them explicitly as build arguments while setting the matching `ENABLE_*` values and keys as runtime secrets:

```bash
fly deploy \
  --build-arg VITE_TURNSTILE_SITE_KEY=YOUR_PUBLIC_SITE_KEY \
  --build-arg VITE_RELEASE_SHA="$(git rev-parse HEAD)" \
  --build-arg VITE_ENABLE_CLAUDE_FALLBACK=true \
  --build-arg VITE_ENABLE_OPENAI_FALLBACK=true \
  --build-arg VITE_WALKAROUND_STUDIO_ENABLED=true
```

Optional Customer Hub private-draft delivery is configured only in the
PocketBase runtime:

```bash
CUSTOMER_HUB_URL=
CUSTOMER_HUB_SECRET=
CUSTOMER_HUB_DESTINATION_ID=
CUSTOMER_HUB_DEALER_ID=
```

`CUSTOMER_HUB_URL` is the HTTPS site origin. `CUSTOMER_HUB_SECRET` is the
shared 32+ character HMAC secret installed independently on both backends.
`CUSTOMER_HUB_DESTINATION_ID` is the agreed safe destination slug, and
`CUSTOMER_HUB_DEALER_ID` must exactly equal Joe's PocketBase dealer record id.
The website option remains disabled when any value is blank or the active
dealer does not match the guard. These values are never `VITE_` variables and
must never be sent to the browser. Delivery creates only a private Customer Hub
draft; Joe's final review remains the publication gate.

The example Turnstile key is Cloudflare's public always-pass test key. Use it
only for local development and CI. Production requires its own public site key
at build time plus `TURNSTILE_SECRET` and exact
`TURNSTILE_ALLOWED_HOSTNAMES` values in the PocketBase runtime.

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

1. The browser sends a personal PIN, manager username/password, or isolated
   system-admin credential to `POST /api/app/session`.
2. The server validates it and sets an opaque `dealer_session` cookie with `HttpOnly`, `Secure`, and `SameSite=Strict` attributes.
3. The browser includes that cookie on `/api/app/*` and `/api/proxy/*` requests.
4. PocketBase resolves the server-side session, applies role/rate-limit policy, and attaches the appropriate provider credential.
5. The database stores only the session token's SHA-256 verifier, never the bearer token itself. Manager passwords use PocketBase's one-way verifier in a locked internal auth collection; the browser never receives a PocketBase auth token.

Dealer managers use only the app's dealer-scoped manager workspace. They do not
receive PocketBase dashboard or deployment-provider access. The system
administrator configures or replaces manager usernames/passwords from the
**Admins** hub; every credential change revokes the manager's active sessions.
See [DEALER_CODE_SETUP.md](DEALER_CODE_SETUP.md) for the exact provisioning and
handoff contract.

Do not call Google directly from browser code or expose a provider key through a `VITE_*` variable.

## Model routing

The active production routing is defined in `config/gemini-model-policy.json`:

| Task                 | Tier     | Routing order                                                                   | Output contract            |
| -------------------- | -------- | ------------------------------------------------------------------------------- | -------------------------- |
| `caption`            | quality  | `gemini-3.6-flash` → `gemini-3.5-flash-lite`                                    | 2,048 tokens               |
| `caption_regenerate` | quality  | `gemini-3.6-flash` → `gemini-3.5-flash-lite`                                    | 2,048 tokens               |
| `caption_edit`       | fast     | `gemini-3.5-flash-lite` → `gemini-3.6-flash`                                    | 2,048 tokens               |
| `image_standard`     | standard | `gemini-3-pro-image` → `gemini-3.1-flash-image` → `gemini-3.1-flash-lite-image` | 2K → 2K → 1K; 4,096 tokens |
| `image_studio`       | studio   | `gemini-3-pro-image` → `gemini-3.1-flash-image` → `gemini-3.1-flash-lite-image` | 4K → 2K → 1K; 4,096 tokens |
| `video_standard`     | standard | `veo-3.1-fast-generate-preview`                                                 | 720p                       |
| `video_quality`      | quality  | `veo-3.1-generate-preview`                                                      | 1080p                      |

The active video client uses Gemini API model IDs. Vertex `-001` model IDs are not valid substitutes on the Gemini API path, and generic Vertex proxy routes are intentionally denied by the server allowlist.

Both standard and Studio image routes start with `gemini-3-pro-image` for reliable customer-facing typography, then fall back to Flash and Lite. Standard requests 2K from Pro; Studio requests 4K from Pro for final hero creative. Both fall back to 2K Flash and 1K Lite. Standard and quality video are separate one-model routes rather than a primary/fallback chain. `services/modelConfig.ts` consumes the canonical artifact, PocketBase enforces it, and `npm run model-policy:check` rejects drift.

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
npm run model-policy:check
npm run format:check
npm run typecheck
npm run test:stability
npm run build
npm run security:audit
```

For a production rollout:

1. Rotate any secret previously exposed in source, generated artifacts, logs, or Git history.
2. Store secrets in the deployment secret manager, never in the frontend environment.
3. Take and verify a Fly volume/database snapshot before running forward-only migrations.
4. Deploy the backend, then confirm `/api/app/health`, session login/logout, tenant isolation, and one authorized provider smoke request.
5. Deploy the frontend/rewrite layer and repeat the same-origin session and generation checks.

The committed Fly workflow waits for the full `CI` workflow and fails if direct backend readiness does not recover. Vercel's committed configuration disables independent `main` deployments. Stage and promote through the commit-bound release scripts, which require a clean current-main checkout, match Fly health, stamp the client artifact with that SHA, and promote only the recorded prebuilt deployment.

Follow [docs/production-backups-and-release.md](docs/production-backups-and-release.md) to provision the private R2 backup gate, prove a disposable restore, stage Vercel without assigning the production domain, and promote the exact verified artifact.

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
- Retry a smaller image, or use the standard 720p video tier when the quality 1080p tier is not required.
- A 429 indicates quota/rate limiting, not proof that the entire integration is healthy.
