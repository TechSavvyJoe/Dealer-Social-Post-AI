#!/bin/sh

# Start PocketBase in background
echo "Starting PocketBase in background..."
/pb/pocketbase serve --http=0.0.0.0:8090 --hooksDir=/pb/pb_hooks --dir=/pb/pb_data &
PB_PID=$!

# Wait for it to be ready
echo "Waiting for PocketBase to start..."
sleep 10

# Create admin account via API
echo "Creating admin account via API..."
curl -X POST "http://127.0.0.1:8090/api/admins" \
  -H "Content-Type: application/json" \
  -d '{"email":"joejgallant@gmail.com", "password":"Babymia78$", "passwordConfirm":"Babymia78$"}' || echo "Admin creation failed or already exists"

# Wait for the server process
wait $PB_PID
