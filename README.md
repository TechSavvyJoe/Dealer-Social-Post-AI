<div align="center">
<img width="1200" height="475" alt="Dealer Social Post AI" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Dealer Social Post AI

Production-oriented social post creation for automotive dealerships. An authenticated salesperson can capture and frame a delivery photo, generate dealership-branded creative and copy, collect required disclosures, request manager approval, and optionally create a short video.

## Quick start

Prerequisites:

- Node.js 22 (`22.23.1` is pinned in `.node-version` and `.nvmrc`)
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey)

```bash
npm install
cp .env.example .env.local
npm run dev:full
```

Set these values in `.env.local` before starting:

```bash
# Server-side secret used by the PocketBase proxy. Never VITE_-prefix it.
GEMINI_API_KEY=your-gemini-api-key

# Local-only bootstrap credential: exactly 12 case-sensitive alphanumeric
# characters. Replace this example before using any shared environment.
ADMIN_DEALER_CODE=your-12-character-code

# Browser-visible backend origin; this is configuration, not a secret.
VITE_POCKETBASE_URL=http://127.0.0.1:8090
```

The active text, image, and Veo routes all use `GEMINI_API_KEY`. Generic browser-accessible Vertex routes are intentionally disabled. Dealer and administrator credentials must be created and rotated through the supported workflow in [DEALER_CODE_SETUP.md](DEALER_CODE_SETUP.md); do not put real login codes in documentation or source control.

The development command starts:

- Frontend: <http://localhost:5173>
- PocketBase API/admin: <http://localhost:8090>

See [SETUP.md](SETUP.md) for the full local and production configuration and [VERTEX_AI_SETUP.md](VERTEX_AI_SETUP.md) for Google model-routing details.

## Current model routing

| Task                 | Tier     | Routing order                                                                   | Output contract            |
| -------------------- | -------- | ------------------------------------------------------------------------------- | -------------------------- |
| `caption`            | quality  | `gemini-3.6-flash` → `gemini-3.5-flash-lite`                                    | 2,048 tokens               |
| `caption_regenerate` | quality  | `gemini-3.6-flash` → `gemini-3.5-flash-lite`                                    | 2,048 tokens               |
| `caption_edit`       | fast     | `gemini-3.5-flash-lite` → `gemini-3.6-flash`                                    | 2,048 tokens               |
| `image_standard`     | standard | `gemini-3.1-flash-image` → `gemini-3-pro-image` → `gemini-3.1-flash-lite-image` | 2K → 2K → 1K; 4,096 tokens |
| `image_studio`       | studio   | `gemini-3-pro-image` → `gemini-3.1-flash-image` → `gemini-3.1-flash-lite-image` | 2K → 2K → 1K; 4,096 tokens |
| `video_standard`     | standard | `veo-3.1-fast-generate-preview`                                                 | 720p                       |
| `video_quality`      | quality  | `veo-3.1-generate-preview`                                                      | 1080p                      |

The standard image route starts with Flash; only the explicit Studio preference starts with Pro. Standard and quality video are separate one-model routes, not fallbacks for one another. The Veo IDs above are Gemini API identifiers; Vertex-only `-001` IDs are not interchangeable.

The source of truth is [config/gemini-model-policy.json](config/gemini-model-policy.json). `services/modelConfig.ts` consumes that artifact, PocketBase enforces the same contract, and `npm run model-policy:check` rejects drift.

## Architecture

- **Frontend:** React 19, Vite 8, Tailwind CSS, Zustand, and TanStack Query
- **Backend:** PocketBase custom hooks in `pb_hooks/`, pinned to the latest compatible 0.22 maintenance release (`0.22.37`)
- **Authentication:** `POST /api/app/session` exchanges a personal PIN, dealer-scoped manager username/password, or isolated system-admin secret for an opaque `HttpOnly`, `Secure`, `SameSite=Strict` app cookie; it never exposes a PocketBase auth token
- **Provider access:** authenticated browser requests use same-origin `/api/proxy/*` routes; Google credentials remain on the server, and asynchronous operation/file IDs are durably bound to the dealer session that created them
- **Storage:** PocketBase/SQLite with forward-only migrations in `pb_migrations/`
- **Private recovery:** small workflow metadata stays in localStorage while large camera/generated assets use dealer-scoped IndexedDB and are cleared on reset, logout, expiry, or authentication rejection
- **Delivery compliance:** required financing disclosures are attached automatically; prohibited claims and dealer-configured blocked phrases fail closed across generation, edits, copy, share, save, and export
- **Deployment:** one Docker image on Fly.io; Vercel can serve the frontend and rewrite `/api/*` to the backend

PocketBase 0.22.37 is a deliberate compatibility pin: the current JSVM hooks use the 0.22 API. Do not bump PocketBase to a newer major/minor line without porting and testing every hook and migration first.

## Commands

| Command                      | Description                                 |
| ---------------------------- | ------------------------------------------- |
| `npm run dev:full`           | Start PocketBase and Vite                   |
| `npm run start:backend`      | Start PocketBase only                       |
| `npm run dev`                | Start Vite only                             |
| `npm run typecheck`          | Check TypeScript                            |
| `npm run test`               | Run unit/component tests                    |
| `npm run build`              | Create the production frontend bundle       |
| `npm run model-policy:check` | Reject frontend/backend Gemini policy drift |
| `npm run format:check`       | Check the scoped release-tooling baseline   |
| `npm run security:secrets`   | Scan tracked source for credential patterns |

Before deploying, rotate any credential that has ever appeared in a file, terminal transcript, build log, or Git history. Take a verified database/volume snapshot before applying migrations.

The private R2 backup gate and the staged Fly/Vercel release sequence are documented in [docs/production-backups-and-release.md](docs/production-backups-and-release.md).

The Fly workflow deploys only a commit that passed the complete `CI` workflow and verifies direct backend readiness. Vercel's independent `main` deployment is disabled in `vercel.ts`; use the commit-bound `release:vercel:stage` and `release:vercel:promote` commands so a failed or mismatched backend release cannot publish a frontend under the production domain.
