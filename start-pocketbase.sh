#!/bin/bash

# PocketBase Startup Script
# This script loads environment variables and starts PocketBase with hooks enabled

set -e

echo "========================================="
echo "Starting Dealer Social Post AI"
echo "========================================="

# Load environment variables from .env.local if it exists
if [ -f .env.local ]; then
    echo "Loading environment variables from .env.local..."
    export $(grep -v '^#' .env.local | xargs)
else
    echo "WARNING: .env.local file not found!"
    echo "Please create .env.local with your GEMINI_API_KEY"
    exit 1
fi

# Check if GEMINI_API_KEY is set
if [ -z "$GEMINI_API_KEY" ] || [ "$GEMINI_API_KEY" = "your-api-key-here" ]; then
    echo ""
    echo "ERROR: GEMINI_API_KEY is not configured!"
    echo ""
    echo "Please follow these steps:"
    echo "1. Get your API key from: https://aistudio.google.com/app/apikey"
    echo "2. Edit .env.local file"
    echo "3. Replace 'your-api-key-here' with your actual API key"
    echo "4. Save the file and run this script again"
    echo ""
    exit 1
fi

echo "✓ Environment variables loaded successfully"
echo "✓ GEMINI_API_KEY is configured"
echo ""

# Check if pocketbase executable exists
if [ ! -f "./pocketbase" ]; then
    echo "PocketBase executable not found. Downloading..."

    # Detect OS and architecture
    OS=$(uname -s | tr '[:upper:]' '[:lower:]')
    ARCH=$(uname -m)

    # Set PocketBase version
    PB_VERSION="0.22.21"

    # Map architecture names
    case "$ARCH" in
        x86_64)
            ARCH="amd64"
            ;;
        arm64|aarch64)
            ARCH="arm64"
            ;;
        *)
            echo "Unsupported architecture: $ARCH"
            exit 1
            ;;
    esac

    # Download PocketBase
    DOWNLOAD_URL="https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_${OS}_${ARCH}.zip"
    echo "Downloading from: $DOWNLOAD_URL"

    curl -L "$DOWNLOAD_URL" -o pocketbase.zip
    unzip -o pocketbase.zip
    rm pocketbase.zip
    chmod +x pocketbase

    echo "✓ PocketBase downloaded successfully"
    echo ""
fi

# Start PocketBase
echo "Starting PocketBase server..."
echo "Server will be available at: http://localhost:8090"
echo ""
echo "Press Ctrl+C to stop the server"
echo "========================================="
echo ""

./pocketbase serve --http=0.0.0.0:8090 --hooksDir=./pb_hooks
