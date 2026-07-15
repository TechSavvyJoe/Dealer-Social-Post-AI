#!/bin/bash

# Development Startup Script
# This script starts both PocketBase backend and Vite frontend

set -e

echo "========================================="
echo "Starting Dealer Social Post AI (Development Mode)"
echo "========================================="
echo ""

# Check if .env.local exists
if [ ! -f .env.local ]; then
    echo "Creating .env.local file..."
    cat > .env.local << 'EOF'
# Copy from .env.example and fill in real values.
# Server-side only — never prefix AI keys with VITE_.

GEMINI_API_KEY=your-api-key-here
ADMIN_DEALER_CODE=

# Optional fallbacks / Vertex for video
# ANTHROPIC_API_KEY=
# OPENAI_API_KEY=
# VERTEX_SERVICE_ACCOUNT_JSON=

VITE_POCKETBASE_URL=http://127.0.0.1:8090
EOF
    echo "✓ Created .env.local file"
    echo ""
fi

# Load environment variables safely (supports quoted values; avoids xargs breakage
# on JSON secrets like VERTEX_SERVICE_ACCOUNT_JSON).
if [ -f .env.local ]; then
    set -a
    # shellcheck disable=SC1091
    . ./.env.local
    set +a
fi

# Check if GEMINI_API_KEY is set
if [ -z "$GEMINI_API_KEY" ] || [ "$GEMINI_API_KEY" = "your-api-key-here" ]; then
    echo "⚠️  WARNING: GEMINI_API_KEY is not configured!"
    echo ""
    echo "Please follow these steps:"
    echo "1. Get your API key from: https://aistudio.google.com/app/apikey"
    echo "2. Edit .env.local file in this directory"
    echo "3. Replace 'your-api-key-here' with your actual API key"
    echo "4. Save the file and run this script again"
    echo ""
    read -p "Press Enter to continue anyway (the app will not work until you set the API key)..."
else
    echo "✓ GEMINI_API_KEY is configured"
fi

if [ -z "$ADMIN_DEALER_CODE" ]; then
    echo "ℹ️  ADMIN_DEALER_CODE is unset — super-admin login is disabled until you set it."
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo ""
    echo "Installing dependencies..."
    npm install
    echo "✓ Dependencies installed"
fi

echo ""
echo "Starting services..."
echo "- PocketBase (Backend): http://localhost:8090"
echo "- Vite (Frontend): http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop all services"
echo "========================================="
echo ""

# Function to cleanup background processes on exit
cleanup() {
    echo ""
    echo "Shutting down services..."
    kill $(jobs -p) 2>/dev/null || true
    wait 2>/dev/null || true
    echo "✓ All services stopped"
    exit 0
}

trap cleanup EXIT INT TERM

# Start PocketBase in the background
./start-pocketbase.sh &
POCKETBASE_PID=$!

# Wait a bit for PocketBase to start
sleep 3

# Start Vite dev server
npm run dev &
VITE_PID=$!

# Wait for both processes
wait $POCKETBASE_PID $VITE_PID
