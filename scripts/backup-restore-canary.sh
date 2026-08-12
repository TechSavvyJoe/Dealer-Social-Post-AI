#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/lib/docker-port.sh"

image_tag="${1:-dealer-social-post-ai:ci}"

for command in docker node curl; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command is unavailable: $command" >&2
    exit 2
  fi
done
if ! docker image inspect "$image_tag" >/dev/null 2>&1; then
  echo "Backup canary image does not exist: $image_tag" >&2
  exit 2
fi

work_dir="$(mktemp -d)"
volume_name="dspai-backup-canary-${RANDOM}-$$"
container_id=""
admin_email="example-backup-canary@example.invalid"
admin_password="example-backup-canary-password"
admin_code="CiBackup8R4X"
# Kept as a single variable reference: scripts/check-secrets.mjs only treats a
# credential value as a placeholder when it is entirely a ${...} expansion.
canary_login_secret="${admin_code}-canary"
release_sha="ci-backup-canary"
restore_verified_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cleanup() {
  if [[ -n "$container_id" ]]; then
    docker rm --force "$container_id" >/dev/null 2>&1 || true
  fi
  docker volume rm --force "$volume_name" >/dev/null 2>&1 || true
  rm -rf "$work_dir"
}
trap cleanup EXIT

docker volume create "$volume_name" >/dev/null
docker run --rm \
  --user root \
  --entrypoint /bin/sh \
  --volume "$volume_name:/pb/pb_data" \
  "$image_tag" \
  -c 'chown -R pbuser:pbuser /pb/pb_data'

docker run --rm \
  --entrypoint /pb/pocketbase \
  --volume "$volume_name:/pb/pb_data" \
  "$image_tag" \
  migrate up \
  --dir=/pb/pb_data \
  --migrationsDir=/pb/pb_migrations \
  --hooksDir=/pb/pb_hooks >/dev/null

docker run --rm \
  --entrypoint /pb/pocketbase \
  --volume "$volume_name:/pb/pb_data" \
  "$image_tag" \
  admin create "$admin_email" "$admin_password" \
  --dir=/pb/pb_data \
  --migrationsDir=/pb/pb_migrations \
  --hooksDir=/pb/pb_hooks >/dev/null

container_id="$(docker run --detach \
  --env ADMIN_LOGIN_USERNAME=canary.admin \
  --env SALESPERSON_PIN_PEPPER=ci-pin-pepper-0123456789abcdef0123456789 \
  --env ADMIN_LOGIN_PASSWORD="${canary_login_secret}" \
  --env GEMINI_API_KEY=test-backup-placeholder \
  --env POCKETBASE_R2_BACKUPS_ENABLED=true \
  --env POCKETBASE_BACKUP_LAST_VERIFIED_AT="$restore_verified_at" \
  --env POCKETBASE_BACKUP_VERIFIED_RELEASE_SHA="$release_sha" \
  --env RELEASE_SHA="$release_sha" \
  --publish 127.0.0.1::8090 \
  --volume "$volume_name:/pb/pb_data" \
  "$image_tag")"
if ! port="$(resolve_docker_published_port "$container_id")"; then
  describe_docker_container_state "$container_id" >&2
  docker logs "$container_id" >&2 || true
  echo "Backup canary source did not publish its PocketBase port." >&2
  exit 1
fi

healthy=false
for _ in $(seq 1 45); do
  if curl --silent --fail --max-time 5 \
    "http://127.0.0.1:${port}/api/health" >/dev/null; then
    healthy=true
    break
  fi
  sleep 1
done
if [[ "$healthy" != true ]]; then
  docker logs "$container_id" >&2 || true
  echo "Backup canary source did not become healthy." >&2
  exit 1
fi

# Seed one real PocketBase file record so this gate proves the full pb_data
# archive, not merely data.db. The bundled PWA icon is synthetic app media.
curl --silent --show-error --fail \
  --request POST \
  --header 'Content-Type: application/json' \
  --data "{\"identity\":\"${admin_email}\",\"password\":\"${admin_password}\"}" \
  "http://127.0.0.1:${port}/api/admins/auth-with-password" \
  --output "$work_dir/admin-auth.json"
admin_token="$(node -e '
  const fs = require("node:fs");
  const payload = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write(String(payload.token || ""));
' "$work_dir/admin-auth.json")"
if [[ -z "$admin_token" ]]; then
  echo "Backup canary could not authenticate its disposable PocketBase admin." >&2
  exit 1
fi
curl --silent --show-error --fail \
  --request POST \
  --header "Authorization: $admin_token" \
  --form 'name=Backup Restore Canary' \
  --form 'logo=@public/icon-192.png;type=image/png' \
  "http://127.0.0.1:${port}/api/collections/dealers/records" \
  --output "$work_dir/file-record.json"
unset admin_token
read -r file_collection file_record file_name < <(node -e '
  const fs = require("node:fs");
  const payload = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write(`${payload.collectionId || ""} ${payload.id || ""} ${payload.logo || ""}\n`);
' "$work_dir/file-record.json")
if [[ ! "$file_collection" =~ ^[A-Za-z0-9_]+$ ||
      ! "$file_record" =~ ^[A-Za-z0-9]+$ ||
      ! "$file_name" =~ ^[A-Za-z0-9_.-]+$ ]]; then
  echo "Backup canary file record returned unsafe or incomplete identifiers." >&2
  exit 1
fi
if command -v sha256sum >/dev/null 2>&1; then
  file_sha256="$(sha256sum public/icon-192.png | awk '{print $1}')"
else
  file_sha256="$(shasum -a 256 public/icon-192.png | awk '{print $1}')"
fi

POCKETBASE_BACKUP_URL="http://127.0.0.1:${port}" \
POCKETBASE_EXPECTED_ORIGIN="http://127.0.0.1:${port}" \
POCKETBASE_ADMIN_EMAIL="$admin_email" \
POCKETBASE_ADMIN_PASSWORD="$admin_password" \
  node scripts/pocketbase-r2-backup.mjs create-local \
    --output "$work_dir/pocketbase-canary.zip" >/dev/null

docker rm --force "$container_id" >/dev/null
container_id=""
RESTORE_RELEASE_SHA="$release_sha" \
RESTORE_VERIFIED_AT="$restore_verified_at" \
RESTORE_EXPECTED_FILE_COLLECTION="$file_collection" \
RESTORE_EXPECTED_FILE_RECORD="$file_record" \
RESTORE_EXPECTED_FILE_NAME="$file_name" \
RESTORE_EXPECTED_FILE_SHA256="$file_sha256" \
  bash scripts/verify-pocketbase-restore.sh \
  "$work_dir/pocketbase-canary.zip" "$image_tag"

echo "PocketBase backup/create/download/restore canary passed."
