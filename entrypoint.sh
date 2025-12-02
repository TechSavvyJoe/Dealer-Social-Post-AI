#!/bin/sh

# Start PocketBase in background
echo "Starting PocketBase in background..."

# Inject Vertex AI Credentials if provided
if [ -n "$VERTEX_SERVICE_ACCOUNT_JSON" ]; then
    echo "Injecting Vertex AI credentials..."
    echo "$VERTEX_SERVICE_ACCOUNT_JSON" > /pb/pb_hooks/vertex_key.json
    chmod 600 /pb/pb_hooks/vertex_key.json
else
    echo "WARNING: VERTEX_SERVICE_ACCOUNT_JSON not set. Video generation will fail."
fi

# Create temp directory for signing operations
mkdir -p /pb/temp
chmod 777 /pb/temp

/pb/pocketbase serve --http=0.0.0.0:8090 --hooksDir=/pb/pb_hooks --migrationsDir=/pb/pb_migrations --dir=/pb/pb_data &
PB_PID=$!

# Wait for it to be ready
echo "Waiting for PocketBase to start..."
sleep 10

# Create admin account via API
echo "Creating admin account via API..."
curl -X POST "http://127.0.0.1:8090/api/admins" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${ADMIN_EMAIL}\", \"password\":\"${ADMIN_PASSWORD}\", \"passwordConfirm\":\"${ADMIN_PASSWORD}\"}" || echo "Admin creation failed or already exists"

# Wait for the server process
wait $PB_PID
