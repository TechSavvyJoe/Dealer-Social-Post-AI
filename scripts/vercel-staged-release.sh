#!/usr/bin/env bash
set -euo pipefail

readonly VERCEL_CLI_VERSION="56.3.1"
readonly FLY_ORIGIN="https://dealer-social-post-ai-production.fly.dev"
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

  validate_sha "$release_sha"
  assert_clean_current_release "$release_sha"
  assert_release_health "$FLY_ORIGIN" "$release_sha" "fly-before-stage"

  export VITE_RELEASE_SHA="$release_sha"
  npx --yes "vercel@${VERCEL_CLI_VERSION}" pull --yes --environment=production
  npx --yes "vercel@${VERCEL_CLI_VERSION}" build --prod
  grep -Rqs --include='*.js' --fixed-strings "$release_sha" .vercel/output/static ||
    fail "the prebuilt frontend does not contain its selected release SHA."

  deployment_url="$(
    npx --yes "vercel@${VERCEL_CLI_VERSION}" deploy \
      --prebuilt --prod --skip-domain --yes | tail -n 1 | tr -d '\r'
  )"
  validate_deployment_url "$deployment_url" ||
    fail "Vercel did not return a canonical staged deployment URL."
  assert_release_health "$deployment_url" "$release_sha" "vercel-staged"
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
  assert_release_health "$FLY_ORIGIN" "$release_sha" "fly-before-promotion"
  assert_release_health "$deployment_url" "$release_sha" "vercel-before-promotion"

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
