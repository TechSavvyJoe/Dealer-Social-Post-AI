#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/lib/docker-port.sh"

backup_file="${1:-}"
image_tag="${2:-dealer-social-post-ai:restore-drill}"
release_sha="${RESTORE_RELEASE_SHA:-ci-restore-canary}"
restore_verified_at="${RESTORE_VERIFIED_AT:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
expected_file_collection="${RESTORE_EXPECTED_FILE_COLLECTION:-}"
expected_file_record="${RESTORE_EXPECTED_FILE_RECORD:-}"
expected_file_name="${RESTORE_EXPECTED_FILE_NAME:-}"
expected_file_sha256="${RESTORE_EXPECTED_FILE_SHA256:-}"

if [[ -z "$backup_file" || ! -f "$backup_file" ]]; then
  echo "Usage: verify-pocketbase-restore.sh BACKUP_ZIP [IMAGE_TAG]" >&2
  exit 2
fi

for command in docker unzip curl; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command is unavailable: $command" >&2
    exit 2
  fi
done

if ! docker image inspect "$image_tag" >/dev/null 2>&1; then
  echo "Restore drill image does not exist: $image_tag" >&2
  exit 2
fi

work_dir="$(mktemp -d)"
volume_name="dspai-restore-${RANDOM}-$$"
container_name="dspai-restore-${RANDOM}-$$"
container_id=""

cleanup() {
  if [[ -n "$container_id" ]]; then
    docker rm --force "$container_id" >/dev/null 2>&1 || true
  fi
  docker volume rm --force "$volume_name" >/dev/null 2>&1 || true
  rm -rf "$work_dir"
}
trap cleanup EXIT

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

while IFS= read -r archive_path; do
  case "$archive_path" in
    /* | ../* | */../* | */..)
      echo "Backup archive contains an unsafe path." >&2
      exit 1
      ;;
  esac
done < <(unzip -Z1 "$backup_file")

unzip -tqq "$backup_file"
unzip -qq "$backup_file" -d "$work_dir/extracted"

data_db="$(find "$work_dir/extracted" -type f -name data.db -print -quit)"
if [[ -z "$data_db" ]]; then
  echo "Backup archive does not contain data.db." >&2
  exit 1
fi
restore_root="$(dirname "$data_db")"

explicit_file_fields=0
for value in "$expected_file_collection" "$expected_file_record" "$expected_file_name" "$expected_file_sha256"; do
  if [[ -n "$value" ]]; then
    explicit_file_fields=$((explicit_file_fields + 1))
  fi
done
if [[ "$explicit_file_fields" != "0" && "$explicit_file_fields" != "4" ]]; then
  echo "Restore file proof requires collection, record, name, and sha256 together." >&2
  exit 1
fi
if [[ "$explicit_file_fields" = "4" ]]; then
  if [[ ! "$expected_file_collection" =~ ^[A-Za-z0-9_]+$ ||
        ! "$expected_file_record" =~ ^[A-Za-z0-9]+$ ||
        ! "$expected_file_name" =~ ^[A-Za-z0-9_.-]+$ ||
        ! "$expected_file_sha256" =~ ^[a-f0-9]{64}$ ]]; then
    echo "Restore file proof identifiers are invalid." >&2
    exit 1
  fi
  restored_file="$restore_root/storage/$expected_file_collection/$expected_file_record/$expected_file_name"
  if [[ ! -f "$restored_file" || "$(sha256_file "$restored_file")" != "$expected_file_sha256" ]]; then
    echo "Full backup archive did not preserve the expected uploaded file." >&2
    exit 1
  fi
fi

docker volume create "$volume_name" >/dev/null
docker run --rm \
  --user root \
  --entrypoint /bin/sh \
  --volume "$restore_root:/restore:ro" \
  --volume "$volume_name:/pb/pb_data" \
  "$image_tag" \
  -c 'cp -a /restore/. /pb/pb_data/ && chown -R pbuser:pbuser /pb/pb_data'

integrity="$(docker run --rm \
  --entrypoint sqlite3 \
  --volume "$volume_name:/pb/pb_data" \
  "$image_tag" \
  /pb/pb_data/data.db 'PRAGMA quick_check;')"
if [[ "$integrity" != "ok" ]]; then
  echo "Restored SQLite database failed PRAGMA quick_check." >&2
  exit 1
fi

container_id="$(docker run --detach \
  --name "$container_name" \
  --env ADMIN_LOGIN_USERNAME=restore.admin \
  --env ADMIN_LOGIN_PASSWORD=testRstr7K3X-drill \
  --env GEMINI_API_KEY=test-restore-placeholder \
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
  echo "Restore drill container did not publish its PocketBase port." >&2
  exit 1
fi

healthy=false
for _ in $(seq 1 45); do
  if curl --silent --fail --max-time 5 \
    "http://127.0.0.1:${port}/api/app/health" >/dev/null; then
    healthy=true
    break
  fi
  sleep 1
done
if [[ "$healthy" != true ]]; then
  docker logs "$container_id" >&2 || true
  echo "Restored PocketBase did not become healthy." >&2
  exit 1
fi

if ! curl --silent --fail "http://127.0.0.1:${port}/api/app/health" |
  grep --quiet '"status":"verified"'; then
  echo "Restored PocketBase did not report release-bound restore readiness." >&2
  exit 1
fi

collection_count="$(docker exec "$container_id" sqlite3 \
  /pb/pb_data/data.db 'SELECT COUNT(*) FROM _collections;')"
migration_count="$(docker exec "$container_id" sqlite3 \
  /pb/pb_data/data.db 'SELECT COUNT(*) FROM _migrations;')"
if [[ ! "$collection_count" =~ ^[0-9]+$ || "$collection_count" -lt 1 ]]; then
  echo "Restored database has no PocketBase collections." >&2
  exit 1
fi
if [[ ! "$migration_count" =~ ^[0-9]+$ || "$migration_count" -lt 1 ]]; then
  echo "Restored database has no applied migrations." >&2
  exit 1
fi

if [[ "$explicit_file_fields" = "4" ]]; then
  reference_count="$(docker exec "$container_id" sqlite3 /pb/pb_data/data.db \
    "SELECT COUNT(*) FROM dealers WHERE id = '$expected_file_record' AND logo = '$expected_file_name';")"
  if [[ "$reference_count" != "1" ]]; then
    echo "Restored database no longer references the expected uploaded file." >&2
    exit 1
  fi
  curl --silent --show-error --fail \
    "http://127.0.0.1:${port}/api/files/${expected_file_collection}/${expected_file_record}/${expected_file_name}" \
    --output "$work_dir/restored-upload"
  if [[ "$(sha256_file "$work_dir/restored-upload")" != "$expected_file_sha256" ]]; then
    echo "Restored PocketBase did not serve the expected uploaded file intact." >&2
    exit 1
  fi
fi

# Verify every known file-field reference, not merely one convenient logo.
# The normalization also handles PocketBase multi-file JSON arrays if a field
# is expanded later without weakening this release gate.
file_references="$(docker exec "$container_id" sqlite3 /pb/pb_data/data.db "
WITH raw_file_refs(collection_name, collection_id, field_name, record_id, raw_value) AS (
  SELECT 'dealers', (SELECT id FROM _collections WHERE name = 'dealers'), 'logo', id, CAST(logo AS TEXT)
    FROM dealers WHERE logo IS NOT NULL AND logo != ''
  UNION ALL
  SELECT 'photo_releases', (SELECT id FROM _collections WHERE name = 'photo_releases'), 'signature_png', id, CAST(signature_png AS TEXT)
    FROM photo_releases WHERE signature_png IS NOT NULL AND signature_png != ''
  UNION ALL
  SELECT 'posts', (SELECT id FROM _collections WHERE name = 'posts'), 'creative_image', id, CAST(creative_image AS TEXT)
    FROM posts WHERE creative_image IS NOT NULL AND creative_image != ''
  UNION ALL
  SELECT 'vehicle_spin_frames', (SELECT id FROM _collections WHERE name = 'vehicle_spin_frames'), 'image', id, CAST(image AS TEXT)
    FROM vehicle_spin_frames WHERE image IS NOT NULL AND image != ''
), normalized AS (
  SELECT collection_name, collection_id, field_name, record_id,
    CASE
      WHEN json_valid(raw_value) THEN
        CASE
          WHEN json_type(raw_value) = 'array' THEN raw_value
          WHEN json_type(raw_value) = 'text' THEN json_array(json_extract(raw_value, '$'))
          ELSE json_array(raw_value)
        END
      ELSE json_array(raw_value)
    END AS values_json
  FROM raw_file_refs
)
SELECT collection_name || '|' || collection_id || '|' || field_name || '|' || record_id || '|' || CAST(files.value AS TEXT)
FROM normalized, json_each(normalized.values_json) AS files
WHERE CAST(files.value AS TEXT) != ''
ORDER BY collection_name, record_id, field_name, CAST(files.value AS TEXT);")"

verified_media_count=0
if [[ -n "$file_references" ]]; then
  while IFS='|' read -r collection_name file_collection field_name file_record file_name; do
    case "$collection_name.$field_name" in
      dealers.logo | photo_releases.signature_png | posts.creative_image | vehicle_spin_frames.image) ;;
      *)
        echo "Restore media query returned an unexpected file field." >&2
        exit 1
        ;;
    esac
    if [[ ! "$file_collection" =~ ^[A-Za-z0-9_]+$ ||
          ! "$file_record" =~ ^[A-Za-z0-9]+$ ||
          ! "$file_name" =~ ^[A-Za-z0-9_.-]+$ ]]; then
      echo "A restored file reference contains an unsafe identifier." >&2
      exit 1
    fi

    archive_object="$restore_root/storage/$file_collection/$file_record/$file_name"
    if [[ ! -f "$archive_object" ]]; then
      echo "A restored database file reference has no matching archive object." >&2
      exit 1
    fi
    archive_sha256="$(sha256_file "$archive_object")"
    restored_object="$work_dir/restored-object-${verified_media_count}"
    docker cp \
      "$container_id:/pb/pb_data/storage/$file_collection/$file_record/$file_name" \
      "$restored_object" >/dev/null
    if [[ "$(sha256_file "$restored_object")" != "$archive_sha256" ]]; then
      echo "A restored volume file does not match its backup archive object." >&2
      exit 1
    fi

    if [[ "$collection_name.$field_name" = "dealers.logo" ]]; then
      served_object="$work_dir/served-object-${verified_media_count}"
      curl --silent --show-error --fail \
        "http://127.0.0.1:${port}/api/files/${file_collection}/${file_record}/${file_name}" \
        --output "$served_object"
      if [[ "$(sha256_file "$served_object")" != "$archive_sha256" ]]; then
        echo "PocketBase did not serve a restored public logo intact." >&2
        exit 1
      fi
    fi
    verified_media_count=$((verified_media_count + 1))
  done <<< "$file_references"
fi

if [[ "$explicit_file_fields" = "4" && "$verified_media_count" -lt 1 ]]; then
  echo "The explicit uploaded-media canary was not included in the full reference scan." >&2
  exit 1
fi
media_status="none-referenced"
if [[ "$verified_media_count" -gt 0 ]]; then
  media_status="verified-${verified_media_count}"
fi

echo "Restore drill passed: integrity=ok collections=${collection_count} migrations=${migration_count} uploaded-media=${media_status}"
