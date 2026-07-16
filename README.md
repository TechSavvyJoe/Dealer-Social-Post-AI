<div align="center">
<img width="1200" height="475" alt="Dealer Social Post AI" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Dealer Social Post AI

Production-oriented social post creation for automotive dealerships. An authenticated salesperson can capture and frame a delivery photo, generate dealership-branded creative and copy, collect required disclosures, request manager approval, and optionally create a short video.

## Quick start

Prerequisites:

- Node.js 22.12 or newer
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

# Browser-visible backend origin; this is configuration, not a secret.
VITE_POCKETBASE_URL=http://127.0.0.1:8090
```

The active text, image, and Veo routes all use `GEMINI_API_KEY`. Generic browser-accessible Vertex routes are intentionally disabled. Dealer and administrator credentials must be created and rotated through the supported workflow in [DEALER_CODE_SETUP.md](DEALER_CODE_SETUP.md); do not put real login codes in documentation or source control.

The development command starts:

- Frontend: <http://localhost:5173>
- PocketBase API/admin: <http://localhost:8090>

See [SETUP.md](SETUP.md) for the full local and production configuration and [VERTEX_AI_SETUP.md](VERTEX_AI_SETUP.md) for Google model-routing details.

## Current model routing

| Job                              | Primary                    | Fallback                                                     |
| -------------------------------- | -------------------------- | ------------------------------------------------------------ |
| Captions and prompt work         | `gemini-3.5-flash`         | `gemini-3.1-flash-lite`, then `gemini-2.5-flash`             |
| Branded image generation/editing | `gemini-3-pro-image`       | `gemini-3.1-flash-image`, then `gemini-3.1-flash-lite-image` |
| Video (Gemini API)               | `veo-3.1-generate-preview` | `veo-3.1-fast-generate-preview`                              |

The Veo IDs above are the documented Gemini API endpoints used by the active client; the Vertex-only `-001` IDs are not interchangeable. The canonical list is [services/modelConfig.ts](services/modelConfig.ts).

Premium and standard Gemini image tiers request 2K output for polished social assets. The Lite emergency tier stays at its documented 1K-only resolution.

## Architecture

- **Frontend:** React 19, Vite 8, Tailwind CSS, Zustand, and TanStack Query
- **Backend:** PocketBase custom hooks in `pb_hooks/`, pinned to the latest compatible 0.22 maintenance release (`0.22.37`)
- **Authentication:** `POST /api/app/session` exchanges a dealer credential for an opaque `HttpOnly`, `Secure`, `SameSite=Strict` cookie
- **Provider access:** authenticated browser requests use same-origin `/api/proxy/*` routes; Google credentials remain on the server, and asynchronous operation/file IDs are durably bound to the dealer session that created them
- **Storage:** PocketBase/SQLite with forward-only migrations in `pb_migrations/`
- **Private recovery:** small workflow metadata stays in localStorage while large camera/generated assets use dealer-scoped IndexedDB and are cleared on reset, logout, expiry, or authentication rejection
- **Delivery compliance:** required financing disclosures are attached automatically; prohibited claims and dealer-configured blocked phrases fail closed across generation, edits, copy, share, save, and export
- **Deployment:** one Docker image on Fly.io; Vercel can serve the frontend and rewrite `/api/*` to the backend

PocketBase 0.22.37 is a deliberate compatibility pin: the current JSVM hooks use the 0.22 API. Do not bump PocketBase to a newer major/minor line without porting and testing every hook and migration first.

## Commands

| Command                    | Description                                 |
| -------------------------- | ------------------------------------------- |
| `npm run dev:full`         | Start PocketBase and Vite                   |
| `npm run start:backend`    | Start PocketBase only                       |
| `npm run dev`              | Start Vite only                             |
| `npm run typecheck`        | Check TypeScript                            |
| `npm run test`             | Run unit/component tests                    |
| `npm run build`            | Create the production frontend bundle       |
| `npm run security:secrets` | Scan tracked source for credential patterns |

Before deploying, rotate any credential that has ever appeared in a file, terminal transcript, build log, or Git history. Take a verified database/volume snapshot before applying migrations.

The Fly workflow deploys only a commit that passed the complete `CI` workflow and verifies direct backend readiness. Disable Vercel's independent production auto-promotion (or gate it on that Fly readiness job) so a failed backend release cannot publish a mismatched frontend.
