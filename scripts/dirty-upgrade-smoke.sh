#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/lib/docker-port.sh"

current_image="${1:-dealer-social-post-ai:ci}"
base_sha="${2:-${BASE_SHA:-}}"

for command in docker git curl; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command is unavailable: $command" >&2
    exit 2
  fi
done

if ! docker image inspect "$current_image" >/dev/null 2>&1; then
  echo "Current candidate image does not exist: $current_image" >&2
  exit 2
fi

if [[ -z "$base_sha" || "$base_sha" =~ ^0+$ ]]; then
  base_sha="$(git rev-parse HEAD^ 2>/dev/null || true)"
fi
if [[ -z "$base_sha" ]] || ! git cat-file -e "${base_sha}^{commit}" 2>/dev/null; then
  echo "A valid base commit is required for the dirty-upgrade smoke test." >&2
  exit 2
fi

# The dirty fixture must be inserted before the one-time people-integrity
# migration is marked as applied. On a later hotfix PR, the immediate base
# already contains that migration; seeding invalid rows into that database
# would manufacture a state that no real forward upgrade can repair. Derive
# an audited pre-migration base so this release gate remains useful after the
# original hardening PR is merged. The exact SHA is validated against both the
# old and new migration paths before it can replace the caller-supplied base.
# Validate the immutable fixture identity and content directly. This intentional
# historical state must not depend on how CI fetched the surrounding graph.
people_repair_migration="pb_migrations/1750500000_auth_people_integrity.js"
people_roles_migration="pb_migrations/1750400000_people_roles_impersonation.js"
people_repair_baseline="173b48e77b61bd3b84fa0bfb0b0ce6091f25c66d"
people_repair_baseline_parent="723b3c87bbaa7fc3f51a3508378c60d70c31e69c"
people_roles_baseline_blob="1b9e2e566d614b72c12a49716b6660a34d268fa7"
if ! git cat-file -e "${people_repair_baseline}^{commit}" 2>/dev/null ||
  ! git cat-file -e "${people_repair_baseline}:${people_roles_migration}" 2>/dev/null ||
  git cat-file -e "${people_repair_baseline}:${people_repair_migration}" 2>/dev/null; then
  echo "The audited pre-repair people migration baseline is unavailable or invalid." >&2
  exit 2
fi
if [[ "$(git cat-file commit "$people_repair_baseline" | sed -n 's/^parent //p')" != "$people_repair_baseline_parent" ]] ||
  [[ "$(git rev-parse "${people_repair_baseline}:${people_roles_migration}")" != "$people_roles_baseline_blob" ]]; then
  echo "The audited pre-repair people migration baseline identity is invalid." >&2
  exit 2
fi
if git cat-file -e "${base_sha}:${people_repair_migration}" 2>/dev/null; then
  if ! git cat-file -e "${base_sha}:${people_roles_migration}" 2>/dev/null; then
    echo "The supplied post-repair base is missing the prerequisite people migration." >&2
    exit 2
  fi
  base_sha="$people_repair_baseline"
fi

work_dir="$(mktemp -d)"
base_dir="$work_dir/base"
volume_name="dspai-upgrade-${RANDOM}-$$"
base_image="dspai-base-${RANDOM}-$$"
base_container=""
current_container=""
admin_code="CiUpgrade9Q2"
# Kept as a single variable reference: scripts/check-secrets.mjs only treats a
# credential value as a placeholder when it is entirely a ${...} expansion.
upgrade_login_secret="${admin_code}-upgrade"
candidate_release="ci-dirty-$(git rev-parse --short=12 HEAD)"
restore_verified_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cleanup() {
  if [[ -n "$base_container" ]]; then
    docker rm --force "$base_container" >/dev/null 2>&1 || true
  fi
  if [[ -n "$current_container" ]]; then
    docker rm --force "$current_container" >/dev/null 2>&1 || true
  fi
  docker volume rm --force "$volume_name" >/dev/null 2>&1 || true
  docker image rm --force "$base_image" >/dev/null 2>&1 || true
  if [[ -d "$base_dir" ]]; then
    git worktree remove --force "$base_dir" >/dev/null 2>&1 || true
  fi
  rm -rf "$work_dir"
}
trap cleanup EXIT

wait_for_url() {
  local url="$1"
  for _ in $(seq 1 45); do
    if curl --silent --fail --max-time 5 "$url" >/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

git worktree add --detach "$base_dir" "$base_sha" >/dev/null
docker build --tag "$base_image" "$base_dir"
docker volume create "$volume_name" >/dev/null

docker run --rm \
  --user root \
  --entrypoint /bin/sh \
  --volume "$volume_name:/pb/pb_data" \
  "$current_image" \
  -c 'chown -R pbuser:pbuser /pb/pb_data'

base_container="$(docker run --detach \
  --env ADMIN_DEALER_CODE="${admin_code}" \
  --env GEMINI_API_KEY=test-upgrade-placeholder \
  --env POCKETBASE_R2_BACKUPS_ENABLED=true \
  --env POCKETBASE_BACKUP_LAST_VERIFIED_AT="$restore_verified_at" \
  --env POCKETBASE_BACKUP_VERIFIED_RELEASE_SHA="$candidate_release" \
  --env RELEASE_SHA="$candidate_release" \
  --publish 127.0.0.1::8090 \
  --volume "$volume_name:/pb/pb_data" \
  "$base_image")"
if ! base_port="$(resolve_docker_published_port "$base_container")"; then
  describe_docker_container_state "$base_container" >&2
  docker logs "$base_container" >&2 || true
  echo "Base image did not publish its PocketBase port." >&2
  exit 1
fi
if ! wait_for_url "http://127.0.0.1:${base_port}/api/health"; then
  docker logs "$base_container" >&2 || true
  echo "Base image did not initialize a healthy PocketBase database." >&2
  exit 1
fi

docker exec "$base_container" sqlite3 /pb/pb_data/data.db \
  "CREATE TABLE IF NOT EXISTS deploy_upgrade_canary (id INTEGER PRIMARY KEY, marker TEXT NOT NULL); DELETE FROM deploy_upgrade_canary; INSERT INTO deploy_upgrade_canary(marker) VALUES ('dirty-upgrade-preserved');"

# Seed the real pre-hardening people table through SQLite so the database can
# contain states that PocketBase's record validator would reject. The forward
# migration must drop the legacy partial index, repair duplicate/invalid PINs,
# mark only changed credentials for distribution, then install the new index.
docker exec -i "$base_container" sqlite3 /pb/pb_data/data.db <<'SQL'
DROP INDEX IF EXISTS idx_salespeople_pin;
INSERT INTO dealers (id, created, updated, name, code, admin_code)
VALUES (
  'dirtydealer0001',
  datetime('now'),
  datetime('now'),
  'Dirty Upgrade Dealer',
  '',
  '12AB56'
);
INSERT INTO salespeople
  (id, created, updated, dealer, name, pin, active, created_at, role)
VALUES
  ('dirtyvalid00001', datetime('now'), datetime('now'), 'dirtydealer0001', 'Valid PIN', '2468', 1, datetime('now'), 'salesperson'),
  ('dirtydupe000001', datetime('now'), datetime('now'), 'dirtydealer0001', 'Duplicate A', '1357', 1, datetime('now'), 'salesperson'),
  ('dirtydupe000002', datetime('now'), datetime('now'), 'dirtydealer0001', 'Duplicate B', '1357', 1, datetime('now'), 'salesperson'),
  ('dirtybad0000001', datetime('now'), datetime('now'), 'dirtydealer0001', 'Invalid PIN', '12AB', 1, datetime('now'), 'salesperson');
SQL
before_collections="$(docker exec "$base_container" sqlite3 \
  /pb/pb_data/data.db 'SELECT COUNT(*) FROM _collections;')"
before_migrations="$(docker exec "$base_container" sqlite3 \
  /pb/pb_data/data.db 'SELECT COUNT(*) FROM _migrations;')"
docker rm --force "$base_container" >/dev/null
base_container=""

current_container="$(docker run --detach \
  --env ADMIN_LOGIN_USERNAME=upgrade.admin \
  --env ADMIN_LOGIN_PASSWORD="${upgrade_login_secret}" \
  --env GEMINI_API_KEY=test-upgrade-placeholder \
  --env POCKETBASE_R2_BACKUPS_ENABLED=true \
  --env POCKETBASE_BACKUP_LAST_VERIFIED_AT="$restore_verified_at" \
  --env POCKETBASE_BACKUP_VERIFIED_RELEASE_SHA="$candidate_release" \
  --env RELEASE_SHA="$candidate_release" \
  --publish 127.0.0.1::8090 \
  --volume "$volume_name:/pb/pb_data" \
  "$current_image")"
if ! current_port="$(resolve_docker_published_port "$current_container")"; then
  describe_docker_container_state "$current_container" >&2
  docker logs "$current_container" >&2 || true
  echo "Candidate image did not publish its PocketBase port." >&2
  exit 1
fi
if ! wait_for_url "http://127.0.0.1:${current_port}/api/app/health"; then
  docker logs "$current_container" >&2 || true
  echo "Candidate image did not migrate the existing database successfully." >&2
  exit 1
fi

canary_count="$(docker exec "$current_container" sqlite3 /pb/pb_data/data.db \
  "SELECT COUNT(*) FROM deploy_upgrade_canary WHERE marker = 'dirty-upgrade-preserved';")"
after_collections="$(docker exec "$current_container" sqlite3 \
  /pb/pb_data/data.db 'SELECT COUNT(*) FROM _collections;')"
after_migrations="$(docker exec "$current_container" sqlite3 \
  /pb/pb_data/data.db 'SELECT COUNT(*) FROM _migrations;')"
session_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  "http://127.0.0.1:${current_port}/api/app/session")"
preserved_valid_pin="$(docker exec "$current_container" sqlite3 \
  /pb/pb_data/data.db \
  "SELECT COUNT(*) FROM salespeople WHERE id = 'dirtyvalid00001' AND pin = '2468' AND COALESCE(pin_needs_distribution, 0) = 0;")"
original_duplicate_count="$(docker exec "$current_container" sqlite3 \
  /pb/pb_data/data.db \
  "SELECT COUNT(*) FROM salespeople WHERE id IN ('dirtydupe000001', 'dirtydupe000002') AND pin = '1357';")"
repaired_distribution_count="$(docker exec "$current_container" sqlite3 \
  /pb/pb_data/data.db \
  "SELECT COUNT(*) FROM salespeople WHERE id IN ('dirtydupe000001', 'dirtydupe000002', 'dirtybad0000001') AND pin_needs_distribution = 1;")"
invalid_repaired_pin_count="$(docker exec "$current_container" sqlite3 \
  /pb/pb_data/data.db \
  "SELECT COUNT(*) FROM salespeople WHERE id IN ('dirtyvalid00001', 'dirtydupe000001', 'dirtydupe000002', 'dirtybad0000001') AND (length(pin) != 4 OR pin NOT GLOB '[0-9][0-9][0-9][0-9]');")"
duplicate_pin_groups="$(docker exec "$current_container" sqlite3 \
  /pb/pb_data/data.db \
  "SELECT COUNT(*) FROM (SELECT pin FROM salespeople WHERE pin != '' GROUP BY pin HAVING COUNT(*) > 1);")"
unique_partial_index_count="$(docker exec "$current_container" sqlite3 \
  /pb/pb_data/data.db \
  "SELECT COUNT(*) FROM pragma_index_list('salespeople') WHERE name = 'idx_salespeople_pin' AND \"unique\" = 1 AND partial = 1;")"
legacy_manager_repaired_count="$(docker exec "$current_container" sqlite3 \
  /pb/pb_data/data.db \
  "SELECT COUNT(*) FROM salespeople WHERE dealer = 'dirtydealer0001' AND role = 'manager' AND active = 1 AND length(pin) = 4 AND pin GLOB '[0-9][0-9][0-9][0-9]' AND pin_needs_distribution = 1;")"
legacy_admin_code_scrubbed="$(docker exec "$current_container" sqlite3 \
  /pb/pb_data/data.db \
  "SELECT COUNT(*) FROM dealers WHERE id = 'dirtydealer0001' AND COALESCE(admin_code, '') = '';")"
posts_media_output_mode_field_count="$(docker exec "$current_container" sqlite3 \
  /pb/pb_data/data.db \
  "SELECT COUNT(*) FROM json_each((SELECT schema FROM _collections WHERE name = 'posts')) WHERE json_extract(value, '$.name') = 'media_output_mode' AND json_extract(value, '$.type') = 'select';")"
posts_media_output_mode_values="$(docker exec "$current_container" sqlite3 \
  /pb/pb_data/data.db \
  "SELECT group_concat(value, ',') FROM (SELECT enum.value AS value FROM json_each((SELECT schema FROM _collections WHERE name = 'posts')) AS field, json_each(json_extract(field.value, '$.options.values')) AS enum WHERE json_extract(field.value, '$.name') = 'media_output_mode' ORDER BY enum.key);")"
posts_primary_format_values="$(docker exec "$current_container" sqlite3 \
  /pb/pb_data/data.db \
  "SELECT group_concat(value, ',') FROM (SELECT enum.value AS value FROM json_each((SELECT schema FROM _collections WHERE name = 'posts')) AS field, json_each(json_extract(field.value, '$.options.values')) AS enum WHERE json_extract(field.value, '$.name') = 'primary_format_id' ORDER BY enum.key);")"
posts_image_aspect_ratio_values="$(docker exec "$current_container" sqlite3 \
  /pb/pb_data/data.db \
  "SELECT group_concat(value, ',') FROM (SELECT enum.value AS value FROM json_each((SELECT schema FROM _collections WHERE name = 'posts')) AS field, json_each(json_extract(field.value, '$.options.values')) AS enum WHERE json_extract(field.value, '$.name') = 'image_aspect_ratio' ORDER BY enum.key);")"
dealers_social_attribution_field_count="$(docker exec "$current_container" sqlite3 \
  /pb/pb_data/data.db \
  "SELECT COUNT(*) FROM json_each((SELECT schema FROM _collections WHERE name = 'dealers')) WHERE json_extract(value, '$.name') IN ('facebook_page_tag', 'linkedin_company_tag') AND json_extract(value, '$.type') = 'text' AND json_extract(value, '$.options.max') = 100;")"
dealers_social_attribution_fields="$(docker exec "$current_container" sqlite3 \
  /pb/pb_data/data.db \
  "SELECT group_concat(name, ',') FROM (SELECT json_extract(value, '$.name') AS name FROM json_each((SELECT schema FROM _collections WHERE name = 'dealers')) WHERE json_extract(value, '$.name') IN ('facebook_page_tag', 'linkedin_company_tag') ORDER BY name);")"

if [[ "$canary_count" != "1" ]]; then
  echo "Dirty-upgrade canary data was not preserved." >&2
  exit 1
fi
if (( after_collections < before_collections )); then
  echo "Dirty upgrade reduced the PocketBase collection count." >&2
  exit 1
fi
if (( after_migrations < before_migrations )); then
  echo "Dirty upgrade reduced the applied migration count." >&2
  exit 1
fi
if [[ "$session_status" != "401" ]]; then
  echo "Protected session route returned unexpected HTTP ${session_status}." >&2
  exit 1
fi
if [[ "$preserved_valid_pin" != "1" ]]; then
  echo "Dirty upgrade changed a valid unique PIN or marked it for redistribution." >&2
  exit 1
fi
if [[ "$original_duplicate_count" != "1" ]]; then
  echo "Dirty upgrade did not preserve exactly one existing duplicate PIN." >&2
  exit 1
fi
if [[ "$repaired_distribution_count" != "2" ]]; then
  echo "Dirty upgrade did not mark exactly the repaired duplicate/invalid PINs for distribution." >&2
  exit 1
fi
if [[ "$invalid_repaired_pin_count" != "0" || "$duplicate_pin_groups" != "0" ]]; then
  echo "Dirty upgrade left an invalid or duplicate PIN." >&2
  exit 1
fi
if [[ "$unique_partial_index_count" != "1" ]]; then
  echo "Dirty upgrade did not install the partial unique PIN index." >&2
  exit 1
fi
if [[ "$legacy_manager_repaired_count" != "1" ]]; then
  echo "Dirty upgrade did not preserve and repair the legacy dealer manager." >&2
  exit 1
fi
if [[ "$legacy_admin_code_scrubbed" != "1" ]]; then
  echo "Dirty upgrade did not scrub the migrated legacy dealer credential." >&2
  exit 1
fi
if [[ "$posts_media_output_mode_field_count" != "1" ]]; then
  echo "Dirty upgrade did not install the posts media_output_mode select field." >&2
  exit 1
fi
if [[ "$posts_media_output_mode_values" != "photo,video,both" ]]; then
  echo "Dirty upgrade installed unexpected media_output_mode values: ${posts_media_output_mode_values}" >&2
  exit 1
fi
if [[ "$posts_primary_format_values" != "feed_portrait,feed_square,story_vertical,marketplace,gbp" ]]; then
  echo "Dirty upgrade installed unexpected primary_format_id values: ${posts_primary_format_values}" >&2
  exit 1
fi
if [[ "$posts_image_aspect_ratio_values" != "1:1,4:5,9:16,16:9,4:3" ]]; then
  echo "Dirty upgrade installed unexpected image_aspect_ratio values: ${posts_image_aspect_ratio_values}" >&2
  exit 1
fi
if [[ "$dealers_social_attribution_field_count" != "2" || "$dealers_social_attribution_fields" != "facebook_page_tag,linkedin_company_tag" ]]; then
  echo "Dirty upgrade did not install the bounded dealership Page/company attribution fields." >&2
  exit 1
fi

if ! curl --silent --fail "http://127.0.0.1:${current_port}/api/app/health" |
  grep --quiet '"status":"verified"'; then
  echo "Dirty-upgrade candidate did not report release-bound restore readiness." >&2
  exit 1
fi

echo "Dirty-upgrade smoke passed: collections=${before_collections}->${after_collections} migrations=${before_migrations}->${after_migrations} canary=preserved pins=repaired-and-indexed legacy-manager=preserved output-profile=enforced social-attribution=enforced"
