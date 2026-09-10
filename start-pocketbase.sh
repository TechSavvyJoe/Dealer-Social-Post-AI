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
    set -a
    # shellcheck disable=SC1091
    . ./.env.local
    set +a
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
    # exit 1
fi

echo "✓ Environment variables loaded successfully"
echo "✓ GEMINI_API_KEY is configured"
echo ""

# Keep local development on the same tested maintenance release as Docker.
PB_VERSION="${PB_VERSION:-0.22.55}"
CURRENT_PB_VERSION=""
if [ -x "./pocketbase" ]; then
    CURRENT_PB_VERSION=$(./pocketbase --version 2>/dev/null | awk '{print $3}')
fi

if [ "$CURRENT_PB_VERSION" != "$PB_VERSION" ]; then
    if [ -n "$CURRENT_PB_VERSION" ]; then
        echo "PocketBase $CURRENT_PB_VERSION found; installing tested version $PB_VERSION..."
    else
        echo "PocketBase executable not found. Downloading $PB_VERSION..."
    fi

    # Detect OS and architecture
    OS=$(uname -s | tr '[:upper:]' '[:lower:]')
    ARCH=$(uname -m)

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

    case "${OS}-${ARCH}" in
        darwin-arm64)
            PB_SHA256="8d00428304d840b18ca57aa66ebcd9bd142e05ff5a40d1f3d564d0ba9c49fdf9"
            ;;
        darwin-amd64)
            PB_SHA256="c108087a494dc7683fa26f2a8e2a6e1b01c5a6dc86bc89e3063b32e36c93cab0"
            ;;
        linux-arm64)
            PB_SHA256="70b735f135c512e8310935efec7a2b52aef9531c79579d92c5e05c2e8a89d396"
            ;;
        linux-amd64)
            PB_SHA256="2e404f98bc693cfa7c8160bc9f1903fc7dc448c4f6fe78128c0cd1561a2db46e"
            ;;
        *)
            echo "Unsupported PocketBase platform: ${OS}-${ARCH}"
            exit 1
            ;;
    esac

    # Download PocketBase
    DOWNLOAD_URL="https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_${OS}_${ARCH}.zip"
    echo "Downloading from: $DOWNLOAD_URL"

    curl -fL "$DOWNLOAD_URL" -o pocketbase.zip
    if command -v sha256sum >/dev/null 2>&1; then
        echo "${PB_SHA256}  pocketbase.zip" | sha256sum -c -
    else
        echo "${PB_SHA256}  pocketbase.zip" | shasum -a 256 -c -
    fi
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
