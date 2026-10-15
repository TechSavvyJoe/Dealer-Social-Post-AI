#!/bin/sh
# NOTE: do NOT enable `set -x` here; runtime secrets must never be expanded
# into the container's stderr / Fly log stream. Use `set -e` so a failed setup
# step aborts startup instead.
set -e

if [ -f /pb/pb_data/data.db ]; then
  # PocketBase 0.22 and 0.23+ use incompatible collection metadata layouts.
  # Never move an attached production database aside and silently boot an
  # empty replacement: that turns a version mismatch into apparent data loss.
  if ! sqlite3 /pb/pb_data/data.db "PRAGMA table_info(_collections);" | grep -q "schema"; then
    echo "ERROR: /pb/pb_data/data.db is not compatible with the PocketBase 0.22 line." >&2
    echo "Refusing to replace or rename the database. Restore the matching runtime or migrate a verified backup explicitly." >&2
    exit 1
  else
    echo "Database schema is compatible with the PocketBase 0.22 line."
  fi
fi
# Create temp directory for signing operations with restrictive perms
mkdir -p /pb/temp
chmod 700 /pb/temp

# PocketBase binds loopback only. Caddy is the public listener on :8090 and
# blocks /_/ unless POCKETBASE_ADMIN_UI_ENABLED=true selects the open config.
echo "Starting PocketBase on 127.0.0.1:8091..."
/pb/pocketbase serve \
  --http=127.0.0.1:8091 \
  --hooksDir=/pb/pb_hooks \
  --migrationsDir=/pb/pb_migrations \
  --dir=/pb/pb_data &
PB_PID=$!

if [ "${POCKETBASE_ADMIN_UI_ENABLED:-}" = "true" ]; then
  echo "WARNING: PocketBase admin UI /_/ is enabled on the public listener." >&2
  CADDYFILE=/pb/Caddyfile.open-admin
else
  CADDYFILE=/pb/Caddyfile
fi

echo "Starting Caddy on 0.0.0.0:8090..."
caddy run --config "$CADDYFILE" --adapter caddyfile &
CADDY_PID=$!

shutdown() {
  kill -TERM "$CADDY_PID" 2>/dev/null || true
  kill -TERM "$PB_PID" 2>/dev/null || true
  wait "$PB_PID" 2>/dev/null || true
  wait "$CADDY_PID" 2>/dev/null || true
}
trap shutdown TERM INT

# Poll so either child exiting tears the pair down. Fly then replaces the
# machine instead of leaving a half-live container. SIGTERM during sleep
# runs the trap above so SQLite can shut down cleanly.
while kill -0 "$PB_PID" 2>/dev/null && kill -0 "$CADDY_PID" 2>/dev/null; do
  sleep 1
done
echo "ERROR: PocketBase or Caddy exited unexpectedly; shutting down." >&2
shutdown
exit 1
