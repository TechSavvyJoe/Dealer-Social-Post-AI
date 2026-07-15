# Dealer Social Post AI - Setup Guide

## Quick Start

### 1. Prerequisites

- Node.js **22.12+**
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey)

### 2. Configure environment

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```bash
GEMINI_API_KEY=your-actual-api-key-here
ADMIN_DEALER_CODE=your-private-super-admin-code
VITE_POCKETBASE_URL=http://127.0.0.1:8090
```

`ADMIN_DEALER_CODE` is required for super-admin login. There is no hardcoded fallback.

Optional:
- `VERTEX_SERVICE_ACCOUNT_JSON` — Veo video + Imagen
- `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` — fallback providers
- `VITE_ENABLE_CLAUDE_FALLBACK` / `VITE_ENABLE_OPENAI_FALLBACK`

### 3. Install Dependencies

```bash
npm install
```

### 4. Start the Application

**Option A: Start Everything (Recommended for development)**
```bash
npm run dev:full
```
This starts both the PocketBase backend (port 8090) and Vite frontend (port 5173).

**Option B: Start Services Separately**

Terminal 1 - Backend:
```bash
npm run start:backend
```

Terminal 2 - Frontend:
```bash
npm run dev
```

### 5. Access the Application

- **Frontend**: http://localhost:5173
- **PocketBase Admin**: http://localhost:8090/_/

## Troubleshooting

### Error: "Failed to generate image content"

**Cause**: The GEMINI_API_KEY environment variable is not set or is invalid.

**Solution**:
1. Check that `.env.local` exists and contains your API key
2. Verify the API key is correct (no extra spaces or quotes)
3. Restart PocketBase: `npm run start:backend`

### Error: "Something went wrong while processing your request"

**Cause**: This is the error you were experiencing. It happens when:
- The API key is not loaded by PocketBase
- The API key is invalid or expired
- Network connectivity issues with Google's servers

**Solution**:
1. Make sure you've set the GEMINI_API_KEY in `.env.local`
2. Restart PocketBase completely (stop and start again)
3. Check the terminal for any error messages from PocketBase

### Timeout Errors

**Cause**: Complex image generation can take time.

**Solution**: The timeout has been increased to 5 minutes (300 seconds) in the PocketBase proxy. If you still experience timeouts:
1. Try with a simpler image
2. Check your internet connection
3. Ensure the Gemini API service is operational

### PocketBase won't start

**Cause**: Port 8090 is already in use or executable doesn't exist.

**Solution**:
1. Check if another PocketBase instance is running: `ps aux | grep pocketbase`
2. Kill any existing instances: `killall pocketbase`
3. The startup script will automatically download PocketBase if needed

## Project Structure

```
.
├── .env.local                 # Your API key (DO NOT COMMIT)
├── start-pocketbase.sh        # Backend startup script
├── start-dev.sh              # Full development environment
├── pb_hooks/                 # PocketBase server-side hooks
│   └── main.pb.js           # API proxy with environment variables
├── services/                 # Frontend services
│   ├── geminiClient.ts      # Gemini API client wrapper
│   ├── geminiProxy.ts       # Proxy communication layer
│   └── geminiService.ts     # AI generation services
└── pb_data/                  # PocketBase database (auto-created)
```

## Development Workflow

1. **First Time Setup**:
   ```bash
   npm install
   # Edit .env.local with your API key
   npm run dev:full
   ```

2. **Daily Development**:
   ```bash
   npm run dev:full
   ```

3. **Testing**:
   ```bash
   npm run test        # Run tests once
   npm run test:watch  # Watch mode
   npm run typecheck   # TypeScript check
   ```

4. **Production Build**:
   ```bash
   npm run build
   npm run preview
   ```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `GEMINI_API_KEY` | Your Google Gemini API key | Yes |

## Security Notes

- ✅ `.env.local` is git-ignored and will never be committed
- ✅ API key is only stored on the backend (PocketBase)
- ✅ Frontend never sees or handles the raw API key
- ✅ All Gemini API calls go through the secure backend proxy

## NPM Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Vite frontend only |
| `npm run dev:full` | Start both backend and frontend |
| `npm run start:backend` | Start PocketBase backend only |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run test` | Run tests once |
| `npm run test:watch` | Run tests in watch mode |

## Support

If you continue to experience issues:
1. Check that your Gemini API key is valid
2. Ensure you're on a stable internet connection
3. Check the PocketBase console logs for detailed error messages
4. Try with a simpler image first to isolate the issue

## What Was Fixed

The error you were experiencing ("Failed to generate image content: 400") was caused by:

1. **Missing Environment Variable**: PocketBase wasn't reading the GEMINI_API_KEY
2. **Short Timeout**: 120s was too short for complex image generation
3. **No Validation**: No checks to ensure the API key was loaded

### Changes Made:

✅ Created `.env.local` for secure API key storage
✅ Created `start-pocketbase.sh` that loads environment variables
✅ Created `start-dev.sh` for easy full-stack development
✅ Increased timeout from 120s to 300s (5 minutes)
✅ Added API key validation and helpful error messages
✅ Updated `.gitignore` to protect sensitive files
✅ Added npm scripts for easy startup
✅ Auto-downloads PocketBase if not present

You should now be able to generate images without the 400 error!
