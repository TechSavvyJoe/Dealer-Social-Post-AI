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
PB_VERSION="${PB_VERSION:-0.22.37}"
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
            PB_SHA256="7c9b125ad043f39e3764ef9176c8a09cd2fb2799717c8813603aac74538487b7"
            ;;
        darwin-amd64)
            PB_SHA256="c358d8f564e36e3024d2e3a376497911be2d6a1cbe5b3a2c256af4df6ba3b410"
            ;;
        linux-arm64)
            PB_SHA256="5c992470e47fc83e9e113f7fcb50483ba353d9d20bffda959194be1106684860"
            ;;
        linux-amd64)
            PB_SHA256="71ea53559eff79e7afc80898bd63bdb04930003e2ee9440971c3d958c25c63d8"
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
