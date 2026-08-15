#!/usr/bin/env bash
set -euo pipefail

readonly VERCEL_CLI_VERSION="58.4.4"
readonly FLY_ORIGIN="https://dealer-social-post-ai-production.fly.dev"
readonly PRODUCTION_VERCEL_ORIGIN="https://dealer-social-post-ai.vercel.app"
readonly EXPECTED_VERCEL_ORG_ID="team_Tc8DG6XMPUCefkTa3u71mmlN"
readonly EXPECTED_VERCEL_PROJECT_ID="prj_h5phWNMNtK4D9dqwbOHrrrRMqrRi"
readonly EXPECTED_VERCEL_PROJECT_NAME="dealer-social-post-ai"
readonly EVIDENCE_DIRECTORY=".release-evidence"
readonly DEFAULT_EVIDENCE_PATH=".release-evidence/vercel-staged-release.json"
readonly DEFAULT_QA_EVIDENCE_PATH=".release-evidence/vercel-staged-qa.json"
readonly PROVIDER_CANARY_EVIDENCE_PATH=".release-evidence/production-provider-canary.json"
readonly WEBSITE_HANDOFF_CANARY_EVIDENCE_PATH=".release-evidence/production-website-handoff-canary.json"

command_name="${1:-}"
evidence_path="$DEFAULT_EVIDENCE_PATH"
qa_evidence_path="$DEFAULT_QA_EVIDENCE_PATH"
work_dir=""
release_lock_path=""
release_lock_token=""
release_lock_acquired=false

cleanup() {
  if [[ "$release_lock_acquired" = true && -n "$release_lock_path" ]]; then
    node - "$release_lock_path" "$release_lock_token" "$$" <<'NODE' || true
const fs = require("node:fs");
const [lockPath, token, pid] = process.argv.slice(2);
try {
  if (fs.lstatSync(lockPath).isSymbolicLink()) process.exit(0);
  const owner = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  if (owner.token === token && String(owner.pid) === pid) {
    fs.rmSync(lockPath);
  }
} catch {}
NODE
  fi
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

acquire_release_lock() {
  [[ ! -L "$EVIDENCE_DIRECTORY" ]] ||
    fail "the release evidence directory must not be a symbolic link."
  mkdir -p "$EVIDENCE_DIRECTORY"
  [[ -d "$EVIDENCE_DIRECTORY" && ! -L "$EVIDENCE_DIRECTORY" ]] ||
    fail "the release evidence path is not a private directory."
  chmod 700 "$EVIDENCE_DIRECTORY"
  release_lock_path="$git_root/$EVIDENCE_DIRECTORY/vercel-release.lock"
  release_lock_token="$(
    node -e 'process.stdout.write(require("node:crypto").randomBytes(16).toString("hex"))'
  )"

  if ! LOCK_PATH="$release_lock_path" \
    LOCK_TOKEN="$release_lock_token" \
    OWNER_PID="$$" \
    node <<'NODE'
const fs = require("node:fs");
const lockPath = process.env.LOCK_PATH;
const token = process.env.LOCK_TOKEN;
const pid = Number(process.env.OWNER_PID);
const candidate = `${lockPath}.candidate-${pid}-${token}`;
const owner = {
  schemaVersion: 1,
  pid,
  token,
  createdAt: new Date().toISOString(),
};

try {
  fs.writeFileSync(candidate, `${JSON.stringify(owner)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  try {
    // The candidate already contains its owner before this atomic link makes
    // it visible as the shared lock. There is never a PID-less lock window.
    fs.linkSync(candidate, lockPath);
    fs.chmodSync(lockPath, 0o600);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const kind = fs.lstatSync(lockPath).isSymbolicLink()
      ? "an unsafe symbolic link"
      : "an existing owner record";
    console.error(`Release lock already exists as ${kind}.`);
    process.exitCode = 2;
  }
} finally {
  fs.rmSync(candidate, { force: true });
}
NODE
  then
    fail "another staged release command owns the release lock; remove the lock manually only after proving no release command is running."
  fi
  release_lock_acquired=true
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

deployment_url_from_json() {
  local deploy_output_file="$1"

  node - "$deploy_output_file" <<'NODE'
const fs = require("node:fs");
const payload = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const candidate = [
  payload?.url,
  payload?.deploymentUrl,
  payload?.deployment?.url,
].find((value) => typeof value === "string" && value.trim());
if (!candidate) process.exit(1);
const normalized = /^https:\/\//i.test(candidate.trim())
  ? candidate.trim()
  : `https://${candidate.trim()}`;
process.stdout.write(normalized);
NODE
}

validate_deployment_id() {
  [[ "$1" =~ ^dpl_[A-Za-z0-9]+$ ]]
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

inspect_deployment_id() {
  local deployment_url="$1"
  local inspection_file

  inspection_file="$(mktemp "$work_dir/vercel-inspect.XXXXXX")"
  npx --yes "vercel@${VERCEL_CLI_VERSION}" inspect "$deployment_url" --json \
    > "$inspection_file" ||
    return 1
  node - \
    "$inspection_file" \
    "$deployment_url" \
    "$EXPECTED_VERCEL_PROJECT_NAME" <<'NODE'
const fs = require("node:fs");
const [file, requestedUrl, expectedProjectName] = process.argv.slice(2);
const deployment = JSON.parse(fs.readFileSync(file, "utf8"));
const requestedHostname = new URL(requestedUrl).hostname;
const aliases = Array.isArray(deployment.aliases) ? deployment.aliases : [];
if (
  !/^dpl_[A-Za-z0-9]+$/.test(deployment.id || "") ||
  deployment.name !== expectedProjectName ||
  deployment.readyState !== "READY" ||
  deployment.target !== "production" ||
  (deployment.url !== requestedHostname && !aliases.includes(requestedHostname))
) {
  process.exit(1);
}
process.stdout.write(deployment.id);
NODE
}

inspect_alias_deployment_id() {
  local alias_url="$1"
  local alias_hostname next_cursor="" inventory_file page_result deployment_id
  local seen_cursors="|"
  local -a alias_args
  local page_count=0

  alias_hostname="$(
    node -e 'process.stdout.write(new URL(process.argv[1]).hostname)' "$alias_url"
  )" || return 1

  while ((page_count < 100)); do
    page_count=$((page_count + 1))
    inventory_file="$(mktemp "$work_dir/vercel-aliases.XXXXXX")"
    alias_args=(alias list --json --limit 100)
    if [[ -n "$next_cursor" ]]; then
      alias_args+=(--next "$next_cursor")
    fi
    npx --yes "vercel@${VERCEL_CLI_VERSION}" "${alias_args[@]}" \
      > "$inventory_file" ||
      return 1
    page_result="$(
      node scripts/vercel-staged-qa.mjs \
        --resolve-alias-page "$inventory_file" "$alias_hostname"
    )" || return 1
    deployment_id="$(printf '%s\n' "$page_result" | sed -n '1p')"
    next_cursor="$(printf '%s\n' "$page_result" | sed -n '2p')"

    if [[ "$deployment_id" != "-" ]]; then
      validate_deployment_id "$deployment_id" || return 1
      printf '%s' "$deployment_id"
      return 0
    fi
    if [[ "$next_cursor" = "-" ]]; then
      return 1
    fi
    [[ "$next_cursor" =~ ^[0-9]+$ ]] || return 1
    [[ "$seen_cursors" != *"|${next_cursor}|"* ]] || return 1
    seen_cursors+="${next_cursor}|"
  done
  return 1
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

assert_frontend_artifact() {
  local origin="$1"
  local release_sha="$2"
  local label="$3"

  node --input-type=module - "$origin" "$release_sha" "$label" <<'NODE'
const [originValue, expectedSha, label] = process.argv.slice(2);
const origin = new URL(originValue);
const fetchExact = async (path) => {
  const requestedUrl = new URL(path, origin);
  const response = await fetch(requestedUrl, {
    headers: { "cache-control": "no-cache" },
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok || new URL(response.url).origin !== origin.origin) {
    throw new Error(`${label} returned ${response.status} for ${path}.`);
  }
  return response;
};
const fetchText = async (path) => {
  const response = await fetchExact(path);
  return { response, text: await response.text() };
};
const fetchBytes = async (path) => {
  const response = await fetchExact(path);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 100) {
    throw new Error(`${label} returned an unexpectedly small asset for ${path}.`);
  }
  return { response, bytes };
};

const { response: rootResponse, text: html } = await fetchText("/");
const csp = rootResponse.headers.get("content-security-policy") || "";
const requiredCspDirectives = [
  "default-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
];
if (
  !requiredCspDirectives.every((directive) => csp.split("; ").includes(directive)) ||
  rootResponse.headers.get("strict-transport-security") !==
    "max-age=63072000; includeSubDomains; preload" ||
  rootResponse.headers.get("x-content-type-options") !== "nosniff" ||
  rootResponse.headers.get("x-frame-options") !== "DENY" ||
  rootResponse.headers.get("referrer-policy") !== "strict-origin-when-cross-origin" ||
  !(
    rootResponse.headers
      .get("permissions-policy")
      ?.includes("camera=(self), microphone=(self)") &&
    rootResponse.headers.get("permissions-policy")?.includes("payment=(), usb=()")
  )
) {
  throw new Error(`${label} is missing required frontend security headers.`);
}
if (
  !html.includes("<title>Dealer Social Post AI</title>") ||
  !html.includes('rel="manifest"') ||
  !html.includes("viewport-fit=cover")
) {
  throw new Error(`${label} is missing the production application shell.`);
}
const scripts = Array.from(
  html.matchAll(/<script[^>]+src="([^"]+[.]js)"/g),
  (match) => match[1],
);
if (scripts.length === 0) {
  throw new Error(`${label} did not reference a frontend JavaScript bundle.`);
}
let releaseFound = false;
for (const script of scripts) {
  const { response, text } = await fetchText(script);
  if (
    !response.headers.get("content-type")?.includes("javascript") ||
    !response.headers.get("cache-control")?.includes("immutable")
  ) {
    throw new Error(`${label} returned unsafe caching or content type for ${script}.`);
  }
  if (text.includes(expectedSha)) releaseFound = true;
}
if (!releaseFound) {
  throw new Error(`${label} frontend bundle is not bound to the expected release.`);
}

const { response: manifestResponse, text: manifestText } =
  await fetchText("/manifest.webmanifest");
if (!manifestResponse.headers.get("content-type")?.includes("manifest+json")) {
  throw new Error(`${label} returned an invalid web app manifest content type.`);
}
const manifest = JSON.parse(manifestText);
const expectedManifestIcons = [
  ["/dealer-social-dsp-v3-192.png", "192x192", "image/png", "any"],
  ["/dealer-social-dsp-v3-512.png", "512x512", "image/png", "any"],
  ["/dealer-social-dsp-v3-1024.png", "1024x1024", "image/png", "any"],
  ["/dealer-social-dsp-v3-maskable-192.png", "192x192", "image/png", "maskable"],
  ["/dealer-social-dsp-v3-maskable-512.png", "512x512", "image/png", "maskable"],
  ["/dealer-social-dsp-v3-maskable-1024.png", "1024x1024", "image/png", "maskable"],
  ["/dsp-brand-mark-v3-monochrome.svg", "any", "image/svg+xml", "monochrome"],
];
if (
  manifest.name !== "Dealer Social Post AI" ||
  manifest.display !== "standalone" ||
  !Array.isArray(manifest.icons) ||
  !expectedManifestIcons.every(([src, sizes, type, purpose]) =>
    manifest.icons.some(
      (icon) =>
        icon?.src === src &&
        icon?.sizes === sizes &&
        icon?.type === type &&
        icon?.purpose === purpose,
    ),
  )
) {
  throw new Error(`${label} web app manifest is incomplete.`);
}
for (const icon of [
  "/dealer-social-dsp-v3-180.png",
  "/dealer-social-dsp-v3-192.png",
  "/dealer-social-dsp-v3-512.png",
  "/dealer-social-dsp-v3-1024.png",
  "/dealer-social-dsp-v3-maskable-192.png",
  "/dealer-social-dsp-v3-maskable-512.png",
  "/dealer-social-dsp-v3-maskable-1024.png",
  "/dealer-social-favicon-v3-32.png",
]) {
  const { response, bytes } = await fetchBytes(icon);
  if (
    !response.headers.get("content-type")?.startsWith("image/png") ||
    !response.headers.get("cache-control")?.includes("immutable") ||
    !bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
  ) {
    throw new Error(`${label} returned an invalid PNG app icon for ${icon}.`);
  }
}
for (const mark of [
  "/dsp-brand-mark-v3.svg",
  "/dsp-brand-mark-v3-micro.svg",
  "/dsp-brand-mark-v3-maskable.svg",
  "/dsp-brand-mark-v3-monochrome.svg",
]) {
  const { response, bytes } = await fetchBytes(mark);
  if (
    !response.headers.get("content-type")?.startsWith("image/svg+xml") ||
    !response.headers.get("cache-control")?.includes("immutable") ||
    !bytes.toString("utf8", 0, 200).includes("<svg")
  ) {
    throw new Error(`${label} returned an invalid SVG brand mark for ${mark}.`);
  }
}

const { response: workerResponse, text: worker } = await fetchText("/sw.js");
const workerCache = workerResponse.headers.get("cache-control") || "";
if (
  workerCache !== "no-cache, no-store, must-revalidate" ||
  !workerResponse.headers.get("content-type")?.includes("javascript") ||
  !worker.includes(`dsp-${expectedSha}`) ||
  !worker.includes('url.pathname.startsWith("/api/")') ||
  !worker.includes('event.data.type === "SKIP_WAITING"')
) {
  throw new Error(`${label} service worker is not bound to the expected release.`);
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

begin_stage_attempt() {
  local release_sha="$1"
  local attempt_id="$2"

  RELEASE_SHA="$release_sha" \
    ATTEMPT_ID="$attempt_id" \
    EVIDENCE_PATH="$evidence_path" \
    QA_EVIDENCE_PATH="$qa_evidence_path" \
    node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const target = path.resolve(process.env.EVIDENCE_PATH);
const qaTarget = path.resolve(process.env.QA_EVIDENCE_PATH);
const directory = path.dirname(target);
const temporary = `${target}.tmp-${process.pid}`;
const evidence = {
  schemaVersion: 3,
  attemptId: process.env.ATTEMPT_ID,
  status: "staging",
  releaseSha: process.env.RELEASE_SHA,
  attemptStartedAt: new Date().toISOString(),
  deploymentUrl: null,
  deploymentId: null,
  stagedAt: null,
  promotionAttemptedAt: null,
  promotedAt: null,
};
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
if (path.basename(directory) === ".release-evidence") {
  fs.chmodSync(directory, 0o700);
}
fs.rmSync(qaTarget, { force: true });
fs.writeFileSync(temporary, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
fs.renameSync(temporary, target);
NODE
}

write_stage_evidence() {
  local release_sha="$1"
  local attempt_id="$2"
  local deployment_url="$3"
  local deployment_id="$4"

  RELEASE_SHA="$release_sha" \
    ATTEMPT_ID="$attempt_id" \
    DEPLOYMENT_URL="$deployment_url" \
    DEPLOYMENT_ID="$deployment_id" \
    EVIDENCE_PATH="$evidence_path" \
    node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const target = path.resolve(process.env.EVIDENCE_PATH);
if (fs.lstatSync(target).isSymbolicLink()) process.exit(1);
const evidence = JSON.parse(fs.readFileSync(target, "utf8"));
if (
  evidence.schemaVersion !== 3 ||
  evidence.status !== "staging" ||
  evidence.releaseSha !== process.env.RELEASE_SHA ||
  evidence.attemptId !== process.env.ATTEMPT_ID ||
  evidence.promotedAt !== null
) {
  process.exit(1);
}
evidence.status = "staged";
evidence.deploymentUrl = process.env.DEPLOYMENT_URL;
evidence.deploymentId = process.env.DEPLOYMENT_ID;
evidence.stagedAt = new Date().toISOString();
const temporary = `${target}.tmp-${process.pid}`;
fs.writeFileSync(temporary, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
fs.renameSync(temporary, target);
NODE
}

read_stage_evidence() {
  [[ -f "$evidence_path" ]] || fail "staged release evidence is missing: $evidence_path"
  node - "$evidence_path" <<'NODE'
const fs = require("node:fs");
if (fs.lstatSync(process.argv[2]).isSymbolicLink()) process.exit(1);
const evidence = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (
  evidence.schemaVersion !== 3 ||
  !/^[0-9a-f]{32}$/.test(evidence.attemptId || "") ||
  !["staged", "promoting"].includes(evidence.status) ||
  !/^[0-9a-f]{40}$/.test(evidence.releaseSha || "") ||
  typeof evidence.deploymentUrl !== "string" ||
  !/^dpl_[A-Za-z0-9]+$/.test(evidence.deploymentId || "") ||
  !Number.isFinite(Date.parse(evidence.stagedAt || "")) ||
  evidence.promotedAt !== null
) {
  process.exit(1);
}
process.stdout.write(
  [
    evidence.releaseSha,
    evidence.deploymentUrl,
    evidence.deploymentId,
    evidence.stagedAt,
    evidence.attemptId,
    evidence.status,
  ].join("\n") + "\n",
);
NODE
}

assert_qa_evidence() {
  local release_sha="$1"
  local deployment_url="$2"
  local deployment_id="$3"
  local staged_at="$4"
  local attempt_id="$5"

  [[ -f "$qa_evidence_path" ]] ||
    fail "staged browser QA evidence is missing: $qa_evidence_path"
  node scripts/vercel-staged-qa.mjs \
    --verify-receipt \
    "$release_sha" \
    "$deployment_url" \
    "$deployment_id" \
    "$staged_at" \
    "$attempt_id"
}

assert_provider_canary_evidence() {
  local release_sha="$1"

  [[ -f "$PROVIDER_CANARY_EVIDENCE_PATH" ]] ||
    fail "production provider canary evidence is missing: $PROVIDER_CANARY_EVIDENCE_PATH"
  node scripts/vercel-staged-qa.mjs \
    --verify-provider-canary \
    "$release_sha"
}

assert_website_handoff_canary_evidence() {
  local release_sha="$1"

  [[ -f "$WEBSITE_HANDOFF_CANARY_EVIDENCE_PATH" ]] ||
    fail "production website handoff canary evidence is missing: $WEBSITE_HANDOFF_CANARY_EVIDENCE_PATH"
  node scripts/vercel-staged-qa.mjs \
    --verify-website-handoff-canary \
    "$release_sha"
}

update_promotion_state() {
  local next_status="$1"
  local release_sha="$2"
  local deployment_url="$3"
  local deployment_id="$4"
  local attempt_id="$5"

  NEXT_STATUS="$next_status" \
    RELEASE_SHA="$release_sha" \
    DEPLOYMENT_URL="$deployment_url" \
    DEPLOYMENT_ID="$deployment_id" \
    ATTEMPT_ID="$attempt_id" \
    EVIDENCE_PATH="$evidence_path" \
    node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const target = path.resolve(process.env.EVIDENCE_PATH);
if (fs.lstatSync(target).isSymbolicLink()) process.exit(1);
const evidence = JSON.parse(fs.readFileSync(target, "utf8"));
if (
  evidence.schemaVersion !== 3 ||
  evidence.releaseSha !== process.env.RELEASE_SHA ||
  evidence.deploymentUrl !== process.env.DEPLOYMENT_URL ||
  evidence.deploymentId !== process.env.DEPLOYMENT_ID ||
  evidence.attemptId !== process.env.ATTEMPT_ID ||
  evidence.promotedAt !== null
) {
  process.exit(1);
}
if (process.env.NEXT_STATUS === "promoting") {
  if (!["staged", "promoting"].includes(evidence.status)) process.exit(1);
  evidence.status = "promoting";
  evidence.promotionAttemptedAt ||= new Date().toISOString();
} else if (process.env.NEXT_STATUS === "promoted") {
  if (evidence.status !== "promoting") process.exit(1);
  evidence.status = "promoted";
  evidence.promotedAt = new Date().toISOString();
} else {
  process.exit(1);
}
const temporary = `${target}.tmp-${process.pid}`;
fs.writeFileSync(temporary, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
fs.renameSync(temporary, target);
NODE
}

assert_promoted_deployment() {
  local expected_deployment_id="$1"
  local current_id=""
  local delay
  local delays=(0 2 3 5 8 13 15 15 15 15)

  for delay in "${delays[@]}"; do
    if ((delay > 0)); then
      sleep "$delay"
    fi
    current_id="$(
      inspect_alias_deployment_id "$PRODUCTION_VERCEL_ORIGIN" 2>/dev/null || true
    )"
    if [[ "$current_id" = "$expected_deployment_id" ]]; then
      return 0
    fi
  done
  fail "the production domain was not assigned to the exact staged deployment."
}

assert_current_promoted_deployment() {
  local expected_deployment_id="$1"
  local current_id=""

  current_id="$(inspect_alias_deployment_id "$PRODUCTION_VERCEL_ORIGIN")" ||
    fail "the production domain could not be inspected after verification."
  [[ "$current_id" = "$expected_deployment_id" ]] ||
    fail "the production domain changed during final verification."
}

stage_release() {
  local release_sha="${2:-${RELEASE_SHA:-}}"
  local attempt_id deployment_url deployment_id
  local deploy_output_file="$work_dir/vercel-deploy.json"
  local env_inventory_file="$work_dir/vercel-production-env.json"

  validate_sha "$release_sha"
  assert_clean_current_release "$release_sha"
  assert_provider_canary_evidence "$release_sha" ||
    fail "the provider canary receipt is invalid or belongs to another release."
  assert_website_handoff_canary_evidence "$release_sha" ||
    fail "the website handoff canary receipt is invalid, incomplete, or belongs to another release."
  attempt_id="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(16).toString("hex"))')"
  begin_stage_attempt "$release_sha" "$attempt_id"
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

  npx --yes "vercel@${VERCEL_CLI_VERSION}" deploy \
    --prebuilt --prod --skip-domain --yes --json > "$deploy_output_file"
  deployment_url="$(deployment_url_from_json "$deploy_output_file")" ||
    fail "Vercel returned invalid staged deployment JSON."
  validate_deployment_url "$deployment_url" ||
    fail "Vercel did not return a canonical staged deployment URL."
  deployment_id="$(inspect_deployment_id "$deployment_url")" ||
    fail "Vercel did not return a ready immutable deployment ID."
  validate_deployment_id "$deployment_id" ||
    fail "Vercel returned an invalid immutable deployment ID."
  assert_release_health "$deployment_url" "$release_sha" "vercel-staged"
  assert_trusted_proxy_route "$deployment_url" "vercel-staged"
  assert_frontend_artifact "$deployment_url" "$release_sha" "vercel-staged"
  write_stage_evidence "$release_sha" "$attempt_id" "$deployment_url" "$deployment_id"

  echo "Staged release verified: $deployment_url"
  echo "Evidence: $evidence_path"
}

promote_release() {
  local evidence release_sha deployment_url deployment_id staged_at attempt_id status
  local inspected_deployment_id

  [[ "${VERCEL_RELEASE_QA_CONFIRM:-}" = "staged-browser-qa-passed" ]] ||
    fail "set VERCEL_RELEASE_QA_CONFIRM=staged-browser-qa-passed only after staged browser QA."
  evidence="$(read_stage_evidence)" || fail "staged release evidence is invalid."
  release_sha="$(printf '%s\n' "$evidence" | sed -n '1p')"
  deployment_url="$(printf '%s\n' "$evidence" | sed -n '2p')"
  deployment_id="$(printf '%s\n' "$evidence" | sed -n '3p')"
  staged_at="$(printf '%s\n' "$evidence" | sed -n '4p')"
  attempt_id="$(printf '%s\n' "$evidence" | sed -n '5p')"
  status="$(printf '%s\n' "$evidence" | sed -n '6p')"
  validate_sha "$release_sha"
  validate_deployment_url "$deployment_url" || fail "staged deployment URL is invalid."
  validate_deployment_id "$deployment_id" || fail "staged deployment ID is invalid."
  [[ "$attempt_id" =~ ^[0-9a-f]{32}$ ]] || fail "staged attempt ID is invalid."
  [[ "$status" = "staged" || "$status" = "promoting" ]] ||
    fail "staged release is not eligible for promotion."
  assert_provider_canary_evidence "$release_sha" ||
    fail "the provider canary receipt is invalid or belongs to another release."
  assert_website_handoff_canary_evidence "$release_sha" ||
    fail "the website handoff canary receipt is invalid, incomplete, or belongs to another release."
  assert_qa_evidence \
    "$release_sha" \
    "$deployment_url" \
    "$deployment_id" \
    "$staged_at" \
    "$attempt_id" ||
    fail "staged browser QA evidence is invalid or belongs to another deployment."
  assert_clean_current_release "$release_sha"
  assert_expected_vercel_link
  inspected_deployment_id="$(inspect_deployment_id "$deployment_url")" ||
    fail "the staged deployment could not be inspected immediately before promotion."
  [[ "$inspected_deployment_id" = "$deployment_id" ]] ||
    fail "the staged deployment ID no longer matches its receipt."
  assert_release_health "$FLY_ORIGIN" "$release_sha" "fly-before-promotion"
  assert_release_health "$deployment_url" "$release_sha" "vercel-before-promotion"
  assert_trusted_proxy_route "$deployment_url" "vercel-before-promotion"
  assert_frontend_artifact "$deployment_url" "$release_sha" "vercel-before-promotion"

  update_promotion_state \
    "promoting" \
    "$release_sha" \
    "$deployment_url" \
    "$deployment_id" \
    "$attempt_id"
  npx --yes "vercel@${VERCEL_CLI_VERSION}" promote "$deployment_url" --yes
  assert_promoted_deployment "$deployment_id"
  assert_release_health "$PRODUCTION_VERCEL_ORIGIN" "$release_sha" "vercel-production"
  assert_trusted_proxy_route "$PRODUCTION_VERCEL_ORIGIN" "vercel-production"
  assert_frontend_artifact "$PRODUCTION_VERCEL_ORIGIN" "$release_sha" "vercel-production"
  assert_current_promoted_deployment "$deployment_id"
  update_promotion_state \
    "promoted" \
    "$release_sha" \
    "$deployment_url" \
    "$deployment_id" \
    "$attempt_id"
  echo "Promoted exact staged release: $deployment_url"
}

require_tools
git_root="$(git rev-parse --show-toplevel)"
cd "$git_root"
work_dir="$(mktemp -d)"
acquire_release_lock

case "$command_name" in
  stage) stage_release "$@" ;;
  promote) promote_release ;;
  *) fail "usage: scripts/vercel-staged-release.sh stage RELEASE_SHA | promote" ;;
esac
