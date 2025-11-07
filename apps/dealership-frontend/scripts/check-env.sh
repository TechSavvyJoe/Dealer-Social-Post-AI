#!/usr/bin/env bash
# Verifies required environment variables are available before running builds.

set -euo pipefail

REQUIRED_VARS=(
  "VITE_SUPABASE_URL"
  "VITE_SUPABASE_ANON_KEY"
  "VITE_GEMINI_API_KEY"
)

missing=0

for var in "${REQUIRED_VARS[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    echo "Missing environment variable: ${var}"
    missing=1
  else
    echo "${var} is set."
  fi
 done

if [[ $missing -ne 0 ]]; then
  echo "One or more environment variables are missing."
  exit 1
fi

echo "All required environment variables are present."
