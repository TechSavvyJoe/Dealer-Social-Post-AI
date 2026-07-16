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
    echo "ERROR: /pb/pb_data/data.db is not compatible with PocketBase 0.22.37." >&2
    echo "Refusing to replace or rename the database. Restore the matching runtime or migrate a verified backup explicitly." >&2
    exit 1
  else
    echo "Database schema is compatible with PB v0.22.37."
  fi
fi
# Create temp directory for signing operations with restrictive perms
mkdir -p /pb/temp
chmod 700 /pb/temp

# Run PocketBase as PID 1 so SIGTERM reaches it and SQLite can shut down
# cleanly during Fly deploys and machine stops.
echo "Starting PocketBase..."
exec /pb/pocketbase serve --http=0.0.0.0:8090 --hooksDir=/pb/pb_hooks --migrationsDir=/pb/pb_migrations --dir=/pb/pb_data
