<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Dealer Social Post AI

AI-powered social media post creator for automotive dealerships. Salespeople log in with a dealer code, capture a delivery photo, and generate branded images, captions, compliance disclosures, and optional video.

## Quick Start

**Prerequisites:** Node.js 22.12+

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env.local
   ```
   Set at least:
   - `GEMINI_API_KEY` — required for generation
   - `ADMIN_DEALER_CODE` — 6+ character code for super-admin (optional but recommended)
   - `VITE_POCKETBASE_URL=http://127.0.0.1:8090`

3. **Start the app:**
   ```bash
   npm run dev:full
   ```
   This starts PocketBase (port 8090) and the Vite frontend (port 5173).

4. **Open your browser:**
   - Frontend: http://localhost:5173
   - PocketBase Admin: http://localhost:8090/_/

📖 **Detailed setup:** [SETUP.md](SETUP.md)  
🚀 **Vertex AI (video / Imagen):** [VERTEX_AI_SETUP.md](VERTEX_AI_SETUP.md)

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev:full` | Start backend + frontend |
| `npm run start:backend` | PocketBase only |
| `npm run dev` | Vite frontend only |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript check |
| `npm run test` | Unit / component tests |

## Architecture

- **Frontend:** React 19 + Vite + Tailwind + Zustand
- **Backend:** PocketBase custom hooks (`pb_hooks/`) with session cookies
- **Deploy:** Docker → Fly.io (`fly.toml`); optional Vercel rewrite for `/api/*`
