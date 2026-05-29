#!/bin/sh
# NOTE: do NOT enable `set -x` here. Command tracing would expand and echo the
# full $VERTEX_SERVICE_ACCOUNT_JSON (incl. the RSA private_key) into the
# container's stderr / Fly log stream. Use `set -e` so a failed setup step
# aborts startup instead.
set -e

# Debug: List files
ls -la /pb

# Start PocketBase in background
echo "Starting PocketBase in background..."

if [ -f /pb/pb_data/data.db ]; then
  # Check if _collections has a schema column
  if ! sqlite3 /pb/pb_data/data.db "PRAGMA table_info(_collections);" | grep -q "schema"; then
    echo "WARNING: Database appears to be from PB v0.23+. Moving out of the way for fresh v0.22.21 creation..."
    mv /pb/pb_data/data.db /pb/pb_data/data.db.v23bak
    [ -f /pb/pb_data/logs.db ] && mv /pb/pb_data/logs.db /pb/pb_data/logs.db.v23bak
  else
    echo "Database schema is compatible with PB v0.22.21."
  fi
fi
# Inject Vertex AI Credentials if provided
if [ -n "$VERTEX_SERVICE_ACCOUNT_JSON" ]; then
    echo "Injecting Vertex AI credentials from VERTEX_SERVICE_ACCOUNT_JSON..."
    # Write the secret without tracing. printf avoids the trailing newline and,
    # crucially, the value is never echoed to logs.
    printf '%s' "$VERTEX_SERVICE_ACCOUNT_JSON" > /pb/pb_hooks/vertex_key.json
    chmod 600 /pb/pb_hooks/vertex_key.json
elif [ -n "$private_key" ] && [ -n "$client_email" ]; then
    echo "Vertex AI credentials detected via individual env vars (private_key, client_email, etc.)"
    echo "Service account will be constructed at runtime."
else
    echo "WARNING: VERTEX_SERVICE_ACCOUNT_JSON not set and individual credentials not found."
    echo "Video generation may fail if Vertex AI is required."
fi

# Create temp directory for signing operations with restrictive perms
mkdir -p /pb/temp
chmod 700 /pb/temp

# Ensure PocketBase is executable
chmod +x /pb/pocketbase
ls -l /pb/pocketbase

# Start PocketBase in foreground
echo "Starting PocketBase..."
# Start PocketBase in foreground
echo "Starting PocketBase..."
/pb/pocketbase serve --http=0.0.0.0:8090 --hooksDir=/pb/pb_hooks --migrationsDir=/pb/pb_migrations --dir=/pb/pb_data
