# PocketBase Backend Assets

This directory holds the source assets that travel with the project and the runtime instructions for the PocketBase server that powers the Dealership AI tools.

```
backend/
  pocketbase/
    migrations/    # schema migrations exported from the production server
    scripts/       # utility scripts used during setup & maintenance
    README.md      # you are here
    CHANGELOG.md   # historical notes from the original server setup
```

Runtime files such as the `pocketbase` binary, `pb_data/`, logs, LaunchAgents, and Cloudflare credentials are **not** tracked in git. Each Mac hosts those items locally.

## Getting the server running on a Mac

1. **Download PocketBase**
   ```bash
   cd ~/server   # or any location outside the repo
   curl -L https://github.com/pocketbase/pocketbase/releases/download/v0.22.0/pocketbase_0.22.0_darwin_amd64.zip -o pocketbase.zip
   unzip pocketbase.zip
   rm pocketbase.zip
   ```
   Keep the binary alongside runtime files (e.g. `~/server/pocketbase`).

2. **Apply migrations**
   ```bash
   ./pocketbase migrate up --dir /path/to/Dealer-Social-Post-AI/backend/pocketbase/migrations
   ```

3. **Seed/maintain data** (optional)
   ```bash
   node /path/to/Dealer-Social-Post-AI/backend/pocketbase/scripts/add-sales-fields.js
   node /path/to/Dealer-Social-Post-AI/backend/pocketbase/scripts/add-sales-fields-v2.js
   node /path/to/Dealer-Social-Post-AI/backend/pocketbase/scripts/fix-permissions.js
   ```
   These scripts mirror the original production setup. Run them as needed after authenticating with an admin account.

4. **Start the server**
   ```bash
   ./pocketbase serve 0.0.0.0:8090
   ```
   Configure a LaunchAgent on each Mac if you want PocketBase to auto-start (instructions live outside the repo because they are machine specific).

5. **Expose the API (optional)**
   - Configure Cloudflare Tunnel (or your chosen reverse proxy) manually.
   - Keep tunnel credentials, configuration files, and logs outside the repository.

## Frontend pairing

The React frontend now lives at `apps/dealership-frontend`. After cloning the repository:

```bash
cd /path/to/Dealer-Social-Post-AI/apps/dealership-frontend
npm install
npm run dev
```

Create a `.env.local` with the active PocketBase URL (and Gemini key if needed). These files are git-ignored.

## Machine-specific files to keep local

- `backend/pocketbase/pb_data/`
- `backend/pocketbase/pocketbase`
- `backend/pocketbase/*.log`
- `backend/pocketbase/backup.sh`
- `backend/pocketbase/tunnel-url.log`
- Any `LaunchAgents` plist files
- `**/.env.local`
- Cloudflare tunnel credentials (`~/.cloudflared`)

## Useful operational commands

```bash
# Check if PocketBase is listening on port 8090
lsof -i :8090

# Tail PocketBase logs (if you keep them locally)
tail -f ~/server/pocketbase.log

# Verify Cloudflare tunnel
cloudflared tunnel info dealership-backend
```

Keep backups by archiving the `pb_data/` directory on a schedule (script intentionally excluded from git). Remember to restore backups only when the service is stopped.

