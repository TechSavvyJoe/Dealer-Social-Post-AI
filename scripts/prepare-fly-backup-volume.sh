#!/usr/bin/env bash
set -euo pipefail

app_name="${1:-${FLY_BACKUP_APP:-dealer-social-post-ai-production}}"

if ! command -v flyctl >/dev/null 2>&1; then
  echo "Required command is unavailable: flyctl" >&2
  exit 2
fi
if [[ ! "$app_name" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo "Fly app name is invalid." >&2
  exit 2
fi

# Fly volumes expose the ext filesystem root at the configured mount point.
# Its root-owned lost+found directory is normally mode 0700, while PocketBase
# deliberately runs as pbuser and recursively walks pb_data for full backups.
# Make only that real metadata directory group-readable; never follow a link
# or broaden permissions on any application data.
flyctl ssh console \
  --app "$app_name" \
  --user root \
  --command "/bin/sh -c 'if [ -e /pb/pb_data/lost+found ] || [ -L /pb/pb_data/lost+found ]; then [ -d /pb/pb_data/lost+found ] && [ ! -L /pb/pb_data/lost+found ] || exit 20; [ \"\$(stat -c %u /pb/pb_data/lost+found)\" = 0 ] || exit 21; chgrp pbuser /pb/pb_data/lost+found; chmod 0750 /pb/pb_data/lost+found; fi'"

flyctl ssh console \
  --app "$app_name" \
  --user pbuser \
  --command "/bin/sh -c 'if [ -e /pb/pb_data/lost+found ] || [ -L /pb/pb_data/lost+found ]; then [ -d /pb/pb_data/lost+found ] && [ ! -L /pb/pb_data/lost+found ] && [ -r /pb/pb_data/lost+found ] && [ -x /pb/pb_data/lost+found ]; fi'"

echo "Fly backup volume metadata is readable by the unprivileged PocketBase runtime."
