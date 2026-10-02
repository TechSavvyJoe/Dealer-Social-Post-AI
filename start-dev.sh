#!/bin/bash

# Development Startup Script
# This script starts both PocketBase backend and Vite frontend

set -euo pipefail

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
ADMIN_LOGIN_USERNAME=
ADMIN_LOGIN_PASSWORD=
# Dev-only pepper so personal-code creation/sign-in works locally.
# Production uses a real secret (openssl rand -hex 24) — never this value.
SALESPERSON_PIN_PEPPER=dev-only-pin-pepper-0123456789abcdef

# Optional cross-provider fallbacks
# ANTHROPIC_API_KEY=
# OPENAI_API_KEY=
# ENABLE_CLAUDE_FALLBACK=false
# ENABLE_OPENAI_FALLBACK=false

VITE_POCKETBASE_URL=http://127.0.0.1:8090
# VITE_ENABLE_CLAUDE_FALLBACK=false
# VITE_ENABLE_OPENAI_FALLBACK=false
EOF
    echo "✓ Created .env.local file"
    echo ""
fi

# Load environment variables safely (supports quoted values and avoids xargs
# splitting or exposing secret values in process arguments).
if [ -f .env.local ]; then
    set -a
    # shellcheck disable=SC1091
    . ./.env.local
    set +a
fi

# Check if GEMINI_API_KEY is set
if [ -z "${GEMINI_API_KEY:-}" ] || [ "$GEMINI_API_KEY" = "your-api-key-here" ]; then
    echo "⚠️  WARNING: GEMINI_API_KEY is not configured!"
    echo ""
    echo "Please follow these steps:"
    echo "1. Get your API key from: https://aistudio.google.com/app/apikey"
    echo "2. Edit .env.local file in this directory"
    echo "3. Replace 'your-api-key-here' with your actual API key"
    echo "4. Save the file and run this script again"
    echo ""
    echo "The app will open, but AI generation and deep readiness will be unavailable."
else
    echo "✓ GEMINI_API_KEY is configured"
fi

if [ -z "${ADMIN_LOGIN_USERNAME:-}" ] || [ -z "${ADMIN_LOGIN_PASSWORD:-}" ]; then
    echo "⚠️  ADMIN_LOGIN_USERNAME / ADMIN_LOGIN_PASSWORD are unset — the system-admin account will not be provisioned, so super-admin login will fail."
fi

PIN_PEPPER_VALUE="${SALESPERSON_PIN_PEPPER:-}"
if [ "${#PIN_PEPPER_VALUE}" -lt 32 ]; then
    echo "⚠️  SALESPERSON_PIN_PEPPER is unset or too short (needs 32+ chars) — creating people and personal-code sign-in will fail."
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
    status=$?
    trap - EXIT INT TERM
    echo ""
    echo "Shutting down services..."
    job_pids=$(jobs -p)
    if [ -n "$job_pids" ]; then
        # shellcheck disable=SC2086
        kill $job_pids 2>/dev/null || true
    fi
    wait 2>/dev/null || true
    echo "✓ All services stopped"
    exit "$status"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Start PocketBase in the background
./start-pocketbase.sh &
POCKETBASE_PID=$!

# Wait for the PocketBase router instead of assuming it starts within three
# seconds. A 503 from deep readiness still proves the hooks are serving; it
# also gives the browser an actionable configuration response after startup.
BACKEND_READY=0
for attempt in $(seq 1 60); do
    if ! kill -0 "$POCKETBASE_PID" 2>/dev/null; then
        backend_status=0
        wait "$POCKETBASE_PID" || backend_status=$?
        echo "ERROR: PocketBase exited before it became ready (status $backend_status)."
        if [ "$backend_status" -eq 0 ]; then
            exit 1
        fi
        exit "$backend_status"
    fi
    health_status=$(curl -sS --connect-timeout 1 --max-time 2 \
        -o /dev/null -w '%{http_code}' \
        http://127.0.0.1:8090/api/app/health 2>/dev/null || true)
    if [ "$health_status" = "200" ] || [ "$health_status" = "503" ]; then
        BACKEND_READY=1
        break
    fi
    sleep 0.5
done
if [ "$BACKEND_READY" -ne 1 ]; then
    echo "ERROR: PocketBase did not expose /api/app/health within 30 seconds."
    exit 1
fi

# Start Vite dev server
npm run dev &
VITE_PID=$!

# Bash 3.2 (the macOS system shell) has no `wait -n`, so poll both children
# and return the first process failure instead of hanging behind the survivor.
while kill -0 "$POCKETBASE_PID" 2>/dev/null && kill -0 "$VITE_PID" 2>/dev/null; do
    sleep 1
done

if ! kill -0 "$POCKETBASE_PID" 2>/dev/null; then
    wait "$POCKETBASE_PID"
    exit $?
fi

wait "$VITE_PID"
