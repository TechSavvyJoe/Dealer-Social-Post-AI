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
# Gemini API Key
# Get your API key from: https://aistudio.google.com/app/apikey
GEMINI_API_KEY=your-api-key-here

# Instructions:
# 1. Replace 'your-api-key-here' with your actual Gemini API key
# 2. Save this file
# 3. Restart this script
#
# Note: This file is git-ignored and will not be committed to version control
EOF
    echo "✓ Created .env.local file"
    echo ""
fi

# Load environment variables
if [ -f .env.local ]; then
    export $(grep -v '^#' .env.local | xargs)
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
