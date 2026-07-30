#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { createR2ClientFromEnv, hashFile } from "./lib/r2-s3.mjs";

const execFileAsync = promisify(execFile);
const BACKUP_RETENTION = 30;
const DEFAULT_PREFIX = "dealer-social-post-ai/pocketbase";
const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const IMAGE_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
// This exact namespace is owned only by this tool. Older `dspai_*.zip` and all
// other names are deliberately unrecognized so manual Dashboard backups can
// never be removed by automated cleanup.
const TOOL_OWNED_POCKETBASE_BACKUP_PATTERN =
  /^dspai_tool_[0-9]{8}t[0-9]{9}z_[a-z0-9]{1,12}\.zip$/;

function required(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`Missing required environment variable: ${name}`);
  return normalized;
}

function parseArguments(argumentsList) {
  const options = {};
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument: ${argument}`);
    const name = argument.slice(2);
    const value = argumentsList[index + 1];
    if (!value || value.startsWith("--"))
      throw new Error(`Missing value for --${name}`);
    options[name] = value;
    index += 1;
  }
  return options;
}

function backupPrefix() {
  const prefix = String(process.env.R2_BACKUP_PREFIX || DEFAULT_PREFIX)
    .trim()
    .replace(/^\/+|\/+$/g, "");
  if (!prefix || prefix.split("/").includes("..")) {
    throw new Error("R2_BACKUP_PREFIX is invalid.");
  }
  return prefix;
}

function normalizedPocketBaseOrigin(value, name) {
  const url = new URL(required(value, name));
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error(`${name} must use HTTPS unless it is localhost.`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must be a credential-free origin.`);
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new Error(`${name} must not include a path.`);
  }
  return new URL(`${url.origin}/`);
}

function pocketBaseUrl() {
  const source = normalizedPocketBaseOrigin(
    process.env.POCKETBASE_BACKUP_URL,
    "POCKETBASE_BACKUP_URL",
  );
  const expected = normalizedPocketBaseOrigin(
    process.env.POCKETBASE_EXPECTED_ORIGIN,
    "POCKETBASE_EXPECTED_ORIGIN",
  );
  if (source.origin !== expected.origin) {
    throw new Error(
      `POCKETBASE_BACKUP_URL must exactly match POCKETBASE_EXPECTED_ORIGIN (${expected.origin}).`,
    );
  }
  return source;
}

function requiredGitSha(value, name) {
  const sha = required(value, name).toLowerCase();
  if (!GIT_SHA_PATTERN.test(sha)) {
    throw new Error(`${name} must be an exact 40-character Git SHA.`);
  }
  return sha;
}

async function pocketBaseRequest(path, options = {}) {
  const {
    allowedStatuses = [],
    timeoutMs = 20 * 60 * 1000,
    ...requestOptions
  } = options;
  const response = await fetch(new URL(path, pocketBaseUrl()), {
    ...requestOptions,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok && !allowedStatuses.includes(response.status)) {
    const body = (await response.text()).slice(0, 500).replace(/\s+/g, " ");
    throw new Error(
      `PocketBase ${options.method || "GET"} ${path} failed with HTTP ${response.status}: ${body}`,
    );
  }
  return response;
}

async function authenticatePocketBaseAdmin() {
  const response = await pocketBaseRequest("/api/admins/auth-with-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      identity: required(process.env.POCKETBASE_ADMIN_EMAIL, "POCKETBASE_ADMIN_EMAIL"),
      password: required(
        process.env.POCKETBASE_ADMIN_PASSWORD,
        "POCKETBASE_ADMIN_PASSWORD",
      ),
    }),
  });
  const payload = await response.json();
  return required(payload.token, "PocketBase admin token response");
}

async function verifiedSourceRelease() {
  const expectedReleaseSha = requiredGitSha(
    process.env.POCKETBASE_EXPECTED_RELEASE_SHA,
    "POCKETBASE_EXPECTED_RELEASE_SHA",
  );
  const response = await pocketBaseRequest("/api/app/health", {
    timeoutMs: 15 * 1000,
    // A stale restore-evidence gate intentionally makes health 503. Backups
    // must still be able to refresh that evidence as long as the deployment
    // identifies the exact source release.
    allowedStatuses: [503],
  });
  const health = await response.json();
  const reportedReleaseSha = String(health?.releaseSha || "")
    .trim()
    .toLowerCase();
  const sourceIdentity = required(
    process.env.POCKETBASE_SOURCE_IDENTITY,
    "POCKETBASE_SOURCE_IDENTITY",
  );
  const sourceImageDigest = required(
    process.env.POCKETBASE_SOURCE_IMAGE_DIGEST,
    "POCKETBASE_SOURCE_IMAGE_DIGEST",
  ).toLowerCase();
  if (!IMAGE_DIGEST_PATTERN.test(sourceImageDigest)) {
    throw new Error("POCKETBASE_SOURCE_IMAGE_DIGEST is invalid.");
  }
  if (reportedReleaseSha) {
    const sourceReleaseSha = requiredGitSha(
      reportedReleaseSha,
      "PocketBase health releaseSha",
    );
    if (sourceIdentity !== "health") {
      throw new Error(
        "Fly image bootstrap identity cannot override an available health releaseSha.",
      );
    }
    if (sourceReleaseSha !== expectedReleaseSha) {
      throw new Error(
        `PocketBase source release changed: expected ${expectedReleaseSha}, received ${sourceReleaseSha}.`,
      );
    }
    return { sourceReleaseSha, sourceIdentity, sourceImageDigest };
  }
  if (
    sourceIdentity !== "fly_image_label" ||
    process.env.POCKETBASE_BOOTSTRAP_IDENTITY_VERIFIED !== "true"
  ) {
    throw new Error(
      "PocketBase health has no releaseSha and no verified Fly image bootstrap identity was provided.",
    );
  }
  return {
    sourceReleaseSha: expectedReleaseSha,
    sourceIdentity,
    sourceImageDigest,
  };
}

function authorization(token) {
  return { authorization: token };
}

export function planToolOwnedPocketBaseBackupCleanup(backups, preserveName = "") {
  const preserved = String(preserveName || "");
  return (Array.isArray(backups) ? backups : [])
    .map((backup) => String(backup?.key || ""))
    .filter(
      (key) => TOOL_OWNED_POCKETBASE_BACKUP_PATTERN.test(key) && key !== preserved,
    )
    .sort();
}

function createBackupName() {
  const timestamp = new Date().toISOString().replace(/[-:.]/g, "").toLowerCase();
  const commit = String(process.env.GITHUB_SHA || "manual")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 12);
  return `dspai_tool_${timestamp}_${commit || "manual"}.zip`;
}

async function validateZip(filePath) {
  await execFileAsync("unzip", ["-tqq", filePath], { timeout: 10 * 60 * 1000 });
}

async function deletePocketBaseBackup(name, token) {
  await pocketBaseRequest(`/api/backups/${encodeURIComponent(name)}`, {
    method: "DELETE",
    headers: authorization(token),
  });
}

async function pruneToolOwnedPocketBaseBackups(token, preserveName = "") {
  const response = await pocketBaseRequest("/api/backups", {
    method: "GET",
    headers: authorization(token),
  });
  const backups = await response.json();
  if (!Array.isArray(backups)) {
    throw new Error("PocketBase returned an invalid backup inventory.");
  }
  const expired = planToolOwnedPocketBaseBackupCleanup(backups, preserveName);
  for (const name of expired) {
    await deletePocketBaseBackup(name, token);
  }
  return {
    pruned: expired.length,
    retainedEmergency: backups.some(
      (backup) =>
        backup?.key === preserveName &&
        TOOL_OWNED_POCKETBASE_BACKUP_PATTERN.test(preserveName),
    ),
  };
}

async function retainOnlyCurrentEmergencyBackup(token, name) {
  try {
    const result = await pruneToolOwnedPocketBaseBackups(token, name);
    process.stderr.write(
      result.retainedEmergency
        ? "Backup failed after PocketBase created an archive; one tool-owned emergency archive was retained.\n"
        : "Backup failed before a tool-owned emergency archive was created.\n",
    );
  } catch (_cleanupError) {
    // The mandatory pre-create prune completed before this run was allowed to
    // create anything, so even an unavailable cleanup API can leave at most the
    // one archive from this attempt.
    process.stderr.write(
      "Backup cleanup could not recheck PocketBase; the pre-create bound permits at most this attempt's one tool-owned archive.\n",
    );
  }
}

async function createAndDownloadPocketBaseBackup(outputPath) {
  const token = await authenticatePocketBaseAdmin();
  // Abort before creating a new archive unless all prior tool-owned emergency
  // archives were removed. Manual and legacy/unrecognized names are untouched.
  await pruneToolOwnedPocketBaseBackups(token);
  const name = createBackupName();
  try {
    await pocketBaseRequest("/api/backups", {
      method: "POST",
      headers: { ...authorization(token), "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });

    const fileTokenResponse = await pocketBaseRequest("/api/files/token", {
      method: "POST",
      headers: authorization(token),
    });
    const fileTokenPayload = await fileTokenResponse.json();
    const fileToken = required(
      fileTokenPayload.token,
      "PocketBase file token response",
    );
    const downloadUrl = new URL(
      `/api/backups/${encodeURIComponent(name)}`,
      pocketBaseUrl(),
    );
    downloadUrl.searchParams.set("token", fileToken);
    const response = await fetch(downloadUrl, {
      signal: AbortSignal.timeout(20 * 60 * 1000),
    });
    if (!response.ok || !response.body) {
      throw new Error(
        `PocketBase backup download failed with HTTP ${response.status}.`,
      );
    }

    await mkdir(dirname(outputPath), { recursive: true });
    await pipeline(Readable.fromWeb(response.body), createWriteStream(outputPath));
    await validateZip(outputPath);
    return { name, outputPath, token };
  } catch (error) {
    await retainOnlyCurrentEmergencyBackup(token, name);
    throw error;
  }
}

function isToolOwnedR2BackupKey(key, prefix) {
  const prefixPath = `${String(prefix || "").replace(/\/+$/g, "")}/`;
  if (!key.startsWith(prefixPath)) return false;
  const filename = key.slice(prefixPath.length);
  return !filename.includes("/") && TOOL_OWNED_POCKETBASE_BACKUP_PATTERN.test(filename);
}

export function planToolOwnedR2BackupCleanup(objects, prefix) {
  const objectKeys = new Set(
    (Array.isArray(objects) ? objects : []).map((object) => String(object?.key || "")),
  );
  return [...objectKeys]
    .filter((key) => objectKeys.has(`${key}.manifest.json`))
    .filter((key) => isToolOwnedR2BackupKey(key, prefix))
    .sort((left, right) => right.localeCompare(left));
}

function manifestsMatch(actual, expected) {
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
  const expectedEntries = Object.entries(expected);
  return (
    Object.keys(actual).length === expectedEntries.length &&
    expectedEntries.every(([key, value]) => actual[key] === value)
  );
}

async function deleteCurrentRunR2PairBestEffort(client, key) {
  const failures = [];
  for (const objectKey of [`${key}.manifest.json`, key]) {
    try {
      await client.delete(objectKey);
    } catch (error) {
      failures.push(
        `${objectKey}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (failures.length > 0) {
    process.stderr.write(
      `R2 partial-upload cleanup could not remove every current-run object: ${failures.join(
        "; ",
      )}\n`,
    );
  }
}

export async function uploadAndVerifyR2BackupPair(
  client,
  { prefix, key, outputPath, metadata, createManifest },
) {
  if (!isToolOwnedR2BackupKey(key, prefix)) {
    throw new Error("Refusing to upload an R2 backup outside the tool-owned prefix.");
  }
  try {
    const uploaded = await client.putFile(key, outputPath, metadata);
    const manifest = createManifest(uploaded);
    const manifestKey = `${key}.manifest.json`;
    await client.putJson(manifestKey, manifest);
    const uploadedManifest = await client.getJson(manifestKey);
    if (!manifestsMatch(uploadedManifest, manifest)) {
      throw new Error("Uploaded R2 backup manifest failed read-back validation.");
    }
    return { uploaded, manifest };
  } catch (error) {
    // An object-store write can persist before its client promise rejects.
    // Treat every failed upload as ambiguous and remove only this run's exact,
    // already namespace-validated archive/manifest keys.
    await deleteCurrentRunR2PairBestEffort(client, key);
    throw error;
  }
}

async function pruneOldBackups(client, prefix) {
  const backupObjects = await client.list(`${prefix}/`);
  const toolOwnedKeys = planToolOwnedR2BackupCleanup(backupObjects, prefix);
  const expired = toolOwnedKeys.slice(BACKUP_RETENTION);
  for (const key of expired) {
    await client.delete(key);
    await client.delete(`${key}.manifest.json`);
  }
  return {
    retained: Math.min(toolOwnedKeys.length, BACKUP_RETENTION),
    pruned: expired.length,
  };
}

async function backupToR2() {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "dspai-backup-"));
  let pocketBaseBackup;
  try {
    const sourceOrigin = pocketBaseUrl().origin;
    const sourceRelease = await verifiedSourceRelease();
    const targetReleaseSha = requiredGitSha(
      process.env.POCKETBASE_TARGET_RELEASE_SHA,
      "POCKETBASE_TARGET_RELEASE_SHA",
    );
    const toolingCommit = requiredGitSha(process.env.GITHUB_SHA, "GITHUB_SHA");
    const outputPath = join(temporaryDirectory, "pocketbase.zip");
    pocketBaseBackup = await createAndDownloadPocketBaseBackup(outputPath);
    const client = createR2ClientFromEnv();
    const prefix = backupPrefix();
    const key = `${prefix}/${pocketBaseBackup.name}`;
    const { manifest } = await uploadAndVerifyR2BackupPair(client, {
      prefix,
      key,
      outputPath,
      metadata: {
        sha256: await hashFile(outputPath),
        source: "pocketbase-0.22.37",
      },
      createManifest: (uploaded) => ({
        formatVersion: 2,
        key,
        createdAt: new Date().toISOString(),
        sha256: uploaded.sha256,
        size: uploaded.size,
        source: "PocketBase 0.22.37 full pb_data backup",
        sourceOrigin,
        sourceReleaseSha: sourceRelease.sourceReleaseSha,
        sourceIdentity: sourceRelease.sourceIdentity,
        sourceImageDigest: sourceRelease.sourceImageDigest,
        targetReleaseSha,
        toolingCommit,
      }),
    });
    await client.putJson(`${prefix}/latest.json`, manifest);
    const retention = await pruneOldBackups(client, prefix);
    await deletePocketBaseBackup(pocketBaseBackup.name, pocketBaseBackup.token);
    process.stdout.write(`${JSON.stringify({ ...manifest, retention })}\n`);
  } catch (error) {
    if (pocketBaseBackup) {
      await retainOnlyCurrentEmergencyBackup(
        pocketBaseBackup.token,
        pocketBaseBackup.name,
      );
    }
    throw error;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function createLocalBackup(options) {
  const outputPath = resolve(required(options.output, "--output"));
  const result = await createAndDownloadPocketBaseBackup(outputPath);
  try {
    const manifest = {
      formatVersion: 1,
      name: result.name,
      outputPath,
      sha256: await hashFile(outputPath),
    };
    await deletePocketBaseBackup(result.name, result.token);
    process.stdout.write(`${JSON.stringify(manifest)}\n`);
  } catch (error) {
    await retainOnlyCurrentEmergencyBackup(result.token, result.name);
    throw error;
  }
}

async function downloadFromR2(options) {
  const client = createR2ClientFromEnv();
  const prefix = backupPrefix();
  const latest = options.key ? null : await client.getJson(`${prefix}/latest.json`);
  const key = String(options.key || latest?.key || "");
  if (!key.startsWith(`${prefix}/`) || !key.endsWith(".zip")) {
    throw new Error("The requested backup key is outside the configured prefix.");
  }
  const outputPath = resolve(required(options.output, "--output"));
  const expected = await client.getJson(`${key}.manifest.json`);
  const expectedSourceOrigin = normalizedPocketBaseOrigin(
    process.env.POCKETBASE_EXPECTED_ORIGIN,
    "POCKETBASE_EXPECTED_ORIGIN",
  ).origin;
  const expectedSourceRelease = requiredGitSha(
    process.env.POCKETBASE_EXPECTED_RELEASE_SHA,
    "POCKETBASE_EXPECTED_RELEASE_SHA",
  );
  const expectedTargetRelease = requiredGitSha(
    process.env.POCKETBASE_TARGET_RELEASE_SHA,
    "POCKETBASE_TARGET_RELEASE_SHA",
  );
  const expectedSourceIdentity = required(
    process.env.POCKETBASE_SOURCE_IDENTITY,
    "POCKETBASE_SOURCE_IDENTITY",
  );
  if (
    expectedSourceIdentity !== "health" &&
    expectedSourceIdentity !== "fly_image_label"
  ) {
    throw new Error("POCKETBASE_SOURCE_IDENTITY is invalid.");
  }
  const expectedSourceImageDigest = String(
    process.env.POCKETBASE_SOURCE_IMAGE_DIGEST || "",
  )
    .trim()
    .toLowerCase();
  if (!IMAGE_DIGEST_PATTERN.test(expectedSourceImageDigest)) {
    throw new Error("POCKETBASE_SOURCE_IMAGE_DIGEST does not match the identity mode.");
  }
  if (
    expected?.formatVersion !== 2 ||
    expected.sourceOrigin !== expectedSourceOrigin ||
    expected.sourceReleaseSha !== expectedSourceRelease ||
    expected.targetReleaseSha !== expectedTargetRelease ||
    expected.sourceIdentity !== expectedSourceIdentity ||
    expected.sourceImageDigest !== expectedSourceImageDigest
  ) {
    throw new Error(
      "Backup manifest does not match the expected production origin and source/target releases.",
    );
  }
  const downloaded = await client.getToFile(key, outputPath);
  if (downloaded.sha256 !== expected.sha256 || downloaded.size !== expected.size) {
    throw new Error("Downloaded backup does not match its R2 integrity manifest.");
  }
  await validateZip(outputPath);
  process.stdout.write(
    `${JSON.stringify({ key, outputPath, sha256: downloaded.sha256, size: downloaded.size })}\n`,
  );
}

async function pruneR2() {
  const client = createR2ClientFromEnv();
  const result = await pruneOldBackups(client, backupPrefix());
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function main() {
  const [command = "", ...argumentsList] = process.argv.slice(2);
  const options = parseArguments(argumentsList);
  if (command === "backup") return backupToR2();
  if (command === "create-local") return createLocalBackup(options);
  if (command === "download") return downloadFromR2(options);
  if (command === "prune") return pruneR2();
  throw new Error(
    "Usage: pocketbase-r2-backup.mjs backup|prune|create-local --output FILE|download [--key KEY] --output FILE",
  );
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`Backup tooling failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
