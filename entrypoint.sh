#!/bin/sh
set -x

# Debug: List files
ls -la /pb

# Start PocketBase in background
echo "Starting PocketBase in background..."

# Inject Vertex AI Credentials if provided
if [ -n "$VERTEX_SERVICE_ACCOUNT_JSON" ]; then
    echo "Injecting Vertex AI credentials from VERTEX_SERVICE_ACCOUNT_JSON..."
    echo "$VERTEX_SERVICE_ACCOUNT_JSON" > /pb/pb_hooks/vertex_key.json
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
