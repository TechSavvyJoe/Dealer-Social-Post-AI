#!/usr/bin/env bash
set -euo pipefail

readonly VERCEL_CLI_VERSION="58.1.0"
readonly FLY_ORIGIN="https://dealer-social-post-ai-production.fly.dev"
readonly EXPECTED_VERCEL_ORG_ID="team_Tc8DG6XMPUCefkTa3u71mmlN"
readonly EXPECTED_VERCEL_PROJECT_ID="prj_h5phWNMNtK4D9dqwbOHrrrRMqrRi"
readonly DEFAULT_EVIDENCE_PATH="test-results/vercel-staged-release.json"

command_name="${1:-}"
evidence_path="${VERCEL_RELEASE_EVIDENCE_PATH:-$DEFAULT_EVIDENCE_PATH}"
work_dir=""

cleanup() {
  if [[ -n "$work_dir" ]]; then
    rm -rf "$work_dir"
  fi
}
trap cleanup EXIT

fail() {
  echo "Vercel release blocked: $*" >&2
  exit 1
}

require_tools() {
  local tool
  for tool in git curl node npx grep; do
    command -v "$tool" >/dev/null 2>&1 || fail "required command is unavailable: $tool"
  done
  [[ "$(node --version)" = "v22.23.1" ]] ||
    fail "Node 22.23.1 is required; run this command through the pinned project runtime."
}

validate_sha() {
  [[ "$1" =~ ^[0-9a-f]{40}$ ]] || fail "release SHA must be an exact lowercase commit SHA."
}

validate_deployment_url() {
  node - "$1" <<'NODE'
const value = process.argv[2] || "";
let url;
try {
  url = new URL(value);
} catch {
  process.exit(1);
}
if (
  url.protocol !== "https:" ||
  url.username ||
  url.password ||
  url.search ||
  url.hash ||
  (url.pathname !== "/" && url.pathname !== "") ||
  !url.hostname.endsWith(".vercel.app")
) {
  process.exit(1);
}
NODE
}

assert_expected_vercel_link() {
  node - \
    ".vercel/project.json" \
    "$EXPECTED_VERCEL_ORG_ID" \
    "$EXPECTED_VERCEL_PROJECT_ID" <<'NODE'
const fs = require("node:fs");
const [file, expectedOrgId, expectedProjectId] = process.argv.slice(2);
if (!fs.existsSync(file)) {
  console.error("The repository is not explicitly linked to its production Vercel project.");
  process.exit(1);
}
const link = JSON.parse(fs.readFileSync(file, "utf8"));
if (link.orgId !== expectedOrgId || link.projectId !== expectedProjectId) {
  console.error("The repository is linked to a different Vercel project or team.");
  process.exit(1);
}
NODE
}

validate_vercel_environment() {
  local env_file="$1"
  local env_inventory_file="$2"
  local static_directory="${3:-}"

  node - "$env_file" "$env_inventory_file" "$static_directory" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [envFile, envInventoryFile, staticDirectory] = process.argv.slice(2);
if (!fs.existsSync(envFile) || !fs.existsSync(envInventoryFile)) {
  console.error("Vercel production environment file was not downloaded.");
  process.exit(1);
}
const inventoryPayload = JSON.parse(fs.readFileSync(envInventoryFile, "utf8"));
const inventory = Array.isArray(inventoryPayload)
  ? inventoryPayload
  : Array.isArray(inventoryPayload?.envs)
    ? inventoryPayload.envs
    : [];
const proxyEntry = inventory.find(
  (entry) => entry?.key === "VERCEL_TO_FLY_PROXY_SECRET",
);
if (
  !proxyEntry ||
  !(
    String(proxyEntry.type || "").toLowerCase() === "sensitive" ||
    proxyEntry.sensitive === true
  )
) {
  console.error("Vercel production is missing the sensitive trusted proxy credential.");
  process.exit(1);
}
const siteKeyEntry = inventory.find(
  (entry) => entry?.key === "VITE_TURNSTILE_SITE_KEY",
);
if (
  !siteKeyEntry ||
  String(siteKeyEntry.type || "").toLowerCase() === "sensitive"
) {
  console.error("Vercel production is missing its readable Turnstile site key.");
  process.exit(1);
}
const values = {};
for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const normalized = line.trim();
  if (!normalized || normalized.startsWith("#")) continue;
  const separator = normalized.indexOf("=");
  if (separator <= 0) continue;
  const key = normalized.slice(0, separator).trim().replace(/^export\s+/, "");
  let value = normalized.slice(separator + 1).trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      value = JSON.parse(value);
    } catch {
      process.exit(1);
    }
  } else if (value.startsWith("'") && value.endsWith("'")) {
    value = value.slice(1, -1);
  }
  values[key] = value;
}
const siteKey = String(values.VITE_TURNSTILE_SITE_KEY || "");
const testSiteKeys = new Set([
  "1x00000000000000000000AA",
  "2x00000000000000000000AB",
  "1x00000000000000000000BB",
  "2x00000000000000000000BB",
  "3x00000000000000000000FF",
]);
if (!/^[A-Za-z0-9_-]{20,}$/.test(siteKey) || testSiteKeys.has(siteKey)) {
  console.error("Vercel production is missing a real Turnstile site key.");
  process.exit(1);
}
if (!staticDirectory) process.exit(0);
const files = [];
const visit = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(target);
    else if (/\.(?:html|js)$/.test(entry.name)) files.push(target);
  }
};
visit(staticDirectory);
if (!files.some((file) => fs.readFileSync(file, "utf8").includes(siteKey))) {
  console.error("The prebuilt frontend does not contain its production Turnstile site key.");
  process.exit(1);
}
NODE
}

assert_clean_current_release() {
  local release_sha="$1"
  local head_sha remote_main

  [[ -z "$(git status --porcelain --untracked-files=normal)" ]] ||
    fail "the Git worktree must be clean before staging or promoting."
  head_sha="$(git rev-parse HEAD)"
  [[ "$head_sha" = "$release_sha" ]] ||
    fail "HEAD does not match the selected release SHA."
  remote_main="$(git ls-remote --exit-code origin refs/heads/main | awk 'NR == 1 { print $1 }')"
  [[ "$remote_main" = "$release_sha" ]] ||
    fail "the selected release is no longer the current main commit."
}

assert_release_health() {
  local origin="$1"
  local release_sha="$2"
  local label="$3"
  local output_file="$work_dir/${label}.json"

  curl --silent --show-error --fail --max-time 20 \
    "${origin%/}/api/app/health" --output "$output_file"
  node - "$output_file" "$release_sha" "$label" <<'NODE'
const fs = require("node:fs");
const [file, expectedSha, label] = process.argv.slice(2);
const health = JSON.parse(fs.readFileSync(file, "utf8"));
if (
  health.ok !== true ||
  health.releaseSha !== expectedSha ||
  health.backup?.status !== "verified"
) {
  console.error(`${label} does not report the exact healthy, restore-verified release.`);
  process.exit(1);
}
NODE
}

assert_trusted_proxy_route() {
  local origin="$1"
  local label="$2"
  local output_file="$work_dir/${label}-proxy.json"

  curl --silent --show-error --fail --max-time 20 \
    "${origin%/}/api/app/proxy-readiness" --output "$output_file"
  node - "$output_file" <<'NODE'
const fs = require("node:fs");
const payload = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (payload.ok !== true) process.exit(1);
NODE
}

write_stage_evidence() {
  local release_sha="$1"
  local deployment_url="$2"
  mkdir -p "$(dirname "$evidence_path")"
  RELEASE_SHA="$release_sha" DEPLOYMENT_URL="$deployment_url" EVIDENCE_PATH="$evidence_path" \
    node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const evidence = {
  schemaVersion: 1,
  releaseSha: process.env.RELEASE_SHA,
  deploymentUrl: process.env.DEPLOYMENT_URL,
  stagedAt: new Date().toISOString(),
  promotedAt: null,
};
const target = path.resolve(process.env.EVIDENCE_PATH);
const temporary = `${target}.tmp-${process.pid}`;
fs.writeFileSync(temporary, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
fs.renameSync(temporary, target);
NODE
}

read_stage_evidence() {
  [[ -f "$evidence_path" ]] || fail "staged release evidence is missing: $evidence_path"
  node - "$evidence_path" <<'NODE'
const fs = require("node:fs");
const evidence = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (
  evidence.schemaVersion !== 1 ||
  !/^[0-9a-f]{40}$/.test(evidence.releaseSha || "") ||
  typeof evidence.deploymentUrl !== "string" ||
  evidence.promotedAt !== null
) {
  process.exit(1);
}
process.stdout.write(`${evidence.releaseSha}\n${evidence.deploymentUrl}\n`);
NODE
}

mark_promoted() {
  EVIDENCE_PATH="$evidence_path" node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const target = path.resolve(process.env.EVIDENCE_PATH);
const evidence = JSON.parse(fs.readFileSync(target, "utf8"));
evidence.promotedAt = new Date().toISOString();
const temporary = `${target}.tmp-${process.pid}`;
fs.writeFileSync(temporary, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
fs.renameSync(temporary, target);
NODE
}

stage_release() {
  local release_sha="${2:-${RELEASE_SHA:-}}"
  local deployment_url
  local env_inventory_file="$work_dir/vercel-production-env.json"

  validate_sha "$release_sha"
  assert_clean_current_release "$release_sha"
  assert_release_health "$FLY_ORIGIN" "$release_sha" "fly-before-stage"
  assert_expected_vercel_link

  export VITE_RELEASE_SHA="$release_sha"
  # Vercel preserves local-only keys during pull. Remove this one generated
  # file first so a deleted remote site key can never survive as stale input.
  node -e 'require("node:fs").rmSync(".vercel/.env.production.local", { force: true })'
  npx --yes "vercel@${VERCEL_CLI_VERSION}" pull --yes --environment=production
  npx --yes "vercel@${VERCEL_CLI_VERSION}" env list production --json \
    > "$env_inventory_file"
  validate_vercel_environment \
    ".vercel/.env.production.local" "$env_inventory_file"
  npx --yes "vercel@${VERCEL_CLI_VERSION}" build --prod
  validate_vercel_environment \
    ".vercel/.env.production.local" "$env_inventory_file" ".vercel/output/static"
  grep -Rqs --include='*.js' --fixed-strings "$release_sha" .vercel/output/static ||
    fail "the prebuilt frontend does not contain its selected release SHA."

  deployment_url="$(
    npx --yes "vercel@${VERCEL_CLI_VERSION}" deploy \
      --prebuilt --prod --skip-domain --yes | tail -n 1 | tr -d '\r'
  )"
  validate_deployment_url "$deployment_url" ||
    fail "Vercel did not return a canonical staged deployment URL."
  assert_release_health "$deployment_url" "$release_sha" "vercel-staged"
  assert_trusted_proxy_route "$deployment_url" "vercel-staged"
  write_stage_evidence "$release_sha" "$deployment_url"

  echo "Staged release verified: $deployment_url"
  echo "Evidence: $evidence_path"
}

promote_release() {
  local evidence release_sha deployment_url

  [[ "${VERCEL_RELEASE_QA_CONFIRM:-}" = "staged-browser-qa-passed" ]] ||
    fail "set VERCEL_RELEASE_QA_CONFIRM=staged-browser-qa-passed only after staged browser QA."
  evidence="$(read_stage_evidence)" || fail "staged release evidence is invalid."
  release_sha="$(printf '%s\n' "$evidence" | sed -n '1p')"
  deployment_url="$(printf '%s\n' "$evidence" | sed -n '2p')"
  validate_sha "$release_sha"
  validate_deployment_url "$deployment_url" || fail "staged deployment URL is invalid."
  assert_clean_current_release "$release_sha"
  assert_expected_vercel_link
  assert_release_health "$FLY_ORIGIN" "$release_sha" "fly-before-promotion"
  assert_release_health "$deployment_url" "$release_sha" "vercel-before-promotion"
  assert_trusted_proxy_route "$deployment_url" "vercel-before-promotion"

  npx --yes "vercel@${VERCEL_CLI_VERSION}" promote "$deployment_url" --yes
  mark_promoted
  echo "Promoted exact staged release: $deployment_url"
}

require_tools
git_root="$(git rev-parse --show-toplevel)"
cd "$git_root"
work_dir="$(mktemp -d)"

case "$command_name" in
  stage) stage_release "$@" ;;
  promote) promote_release ;;
  *) fail "usage: scripts/vercel-staged-release.sh stage RELEASE_SHA | promote" ;;
esac
