#!/usr/bin/env node
// One reviewed operational change. Default mode only inspects the plan.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseStorage, selectMachine } from "./inspect-fly-storage.mjs";

const APP = "dealer-social-post-ai-production";
const DATA_PATH = "/pb/pb_data";
const TARGET_GB = 60;
const CONFIRMATION = "approve-60gb-monthly-volume";

export function selectDataVolume(machines, volumes, sha) {
  const machineId = selectMachine(machines, sha);
  const machine = machines.find((item) => item.id === machineId);
  const mounts = machine.config?.mounts;
  if (
    !Array.isArray(mounts) ||
    mounts.length !== 1 ||
    mounts[0].path !== DATA_PATH ||
    !/^vol_[a-z0-9]{15,32}$/.test(mounts[0].volume || "")
  )
    throw new Error("The production data mount is missing or ambiguous.");
  const matches = Array.isArray(volumes)
    ? volumes.filter((volume) => volume.id === mounts[0].volume)
    : [];
  const volume = matches[0];
  if (
    matches.length !== 1 ||
    volume.name !== "pb_data" ||
    volume.attached_machine_id !== machineId ||
    volume.state !== "created" ||
    !Number.isSafeInteger(volume.size_gb) ||
    volume.size_gb < 1 ||
    volume.size_gb > TARGET_GB
  )
    throw new Error(
      "The attached data volume does not match the reviewed growth plan.",
    );
  return { machineId, volumeId: volume.id, allocatedGB: volume.size_gb };
}

export function validateGrowthRequest(mode, confirmation, expectedSha, health) {
  const verifiedAt = Date.parse(health?.backup?.lastVerifiedAt || "");
  if (
    !["inspect-plan", "extend-to-60gb"].includes(mode) ||
    (mode === "extend-to-60gb" && confirmation !== CONFIRMATION)
  )
    throw new Error(
      "Explicit approval for the 60 GB recurring storage charge is required.",
    );
  if (
    !/^[a-f0-9]{40}$/.test(expectedSha || "") ||
    health?.ok !== true ||
    health.releaseSha !== expectedSha ||
    health.backup?.status !== "verified" ||
    health.backup.verifiedReleaseSha !== expectedSha ||
    !Number.isFinite(verifiedAt) ||
    Date.now() - verifiedAt > 30 * 60 * 1000 ||
    verifiedAt > Date.now() + 5 * 60 * 1000
  )
    throw new Error(
      "Storage growth requires the exact healthy, recovery-verified main release.",
    );
}

function fly(args) {
  try {
    return execFileSync("flyctl", args, {
      encoding: "utf8",
      timeout: 150000,
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error(
      "The protected Fly storage operation failed; inspect its current size before retrying.",
    );
  }
}

function identity(sha) {
  return selectDataVolume(
    JSON.parse(fly(["machine", "list", "--app", APP, "--json"])),
    JSON.parse(fly(["volumes", "list", "--app", APP, "--json"])),
    sha,
  );
}

function measurements(machineId) {
  const measure = (command) =>
    fly([
      "ssh",
      "console",
      "--quiet",
      "--app",
      APP,
      "--machine",
      machineId,
      "--user",
      "pbuser",
      "--command",
      command,
    ]);
  return parseStorage(measure(`df -Pk ${DATA_PATH}`), measure(`du -sk ${DATA_PATH}`));
}

async function health() {
  const response = await fetch(`https://${APP}.fly.dev/api/app/health`, {
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error("Production health is unavailable.");
  return response.json();
}

function writeReceipt(receipt) {
  mkdirSync(".release-evidence", { recursive: true });
  writeFileSync(
    ".release-evidence/production-storage-growth.json",
    JSON.stringify(receipt, null, 2) + "\n",
    { mode: 0o600 },
  );
}

async function main() {
  const mode = process.env.STORAGE_GROW_MODE || "inspect-plan";
  const confirmation = process.env.STORAGE_GROW_CONFIRM || "";
  const sha = process.env.GITHUB_SHA || "";
  if (!process.env.FLY_API_TOKEN)
    throw new Error("The protected Fly credential is missing.");
  validateGrowthRequest(mode, confirmation, sha, await health());
  const before = identity(sha);
  const diskBefore = measurements(before.machineId);
  // Check identity again immediately before the one irreversible operation.
  validateGrowthRequest(mode, confirmation, sha, await health());
  if (JSON.stringify(identity(sha)) !== JSON.stringify(before))
    throw new Error("The production data volume changed during the preflight.");
  const changed = mode === "extend-to-60gb" && before.allocatedGB < TARGET_GB;
  // Retain preflight identity even if the extension times out after Fly accepts
  // it. An interrupted receipt never attests success or authorizes a restart.
  writeReceipt({
    app: APP,
    observedAt: new Date().toISOString(),
    releaseSha: sha,
    mode,
    volumeId: before.volumeId,
    allocatedBeforeGB: before.allocatedGB,
    targetGB: TARGET_GB,
    status: "in_progress",
    extensionRequested: changed,
    before: diskBefore,
  });
  if (changed)
    fly([
      "volumes",
      "extend",
      before.volumeId,
      "--app",
      APP,
      "--size",
      String(TARGET_GB),
      "--yes",
      "--json",
    ]);
  const after = identity(sha);
  const diskAfter = measurements(after.machineId);
  validateGrowthRequest(mode, confirmation, sha, await health());
  if (after.machineId !== before.machineId || after.volumeId !== before.volumeId)
    throw new Error("The production machine or data volume changed during growth.");
  const fleetFramesBytes = 750 * 72 * 500000;
  const fleetHeadroom =
    diskAfter.filesystemAvailableBytes >
    diskAfter.dataDirectoryBytes + fleetFramesBytes * 2 + diskAfter.backupBufferBytes;
  const mountedGrowthVerified =
    after.allocatedGB === TARGET_GB &&
    diskAfter.filesystemTotalBytes >= TARGET_GB * 1e9 * 0.9 &&
    fleetHeadroom;
  const receipt = {
    app: APP,
    observedAt: new Date().toISOString(),
    releaseSha: sha,
    mode,
    volumeId: after.volumeId,
    allocatedBeforeGB: before.allocatedGB,
    allocatedAfterGB: after.allocatedGB,
    targetGB: TARGET_GB,
    changed,
    mountedGrowthVerified,
    fleetFramesAndBackupHeadroom: fleetHeadroom,
    status:
      mode === "inspect-plan"
        ? "inspected"
        : mountedGrowthVerified
          ? "verified"
          : "capacity_unverified",
    before: diskBefore,
    after: diskAfter,
  };
  writeReceipt(receipt);
  process.stdout.write(JSON.stringify(receipt, null, 2) + "\n");
  if (mode === "extend-to-60gb" && !mountedGrowthVerified)
    throw new Error(
      "The allocated or mounted 60 GB capacity is not verified. No restart is performed automatically; inspect the receipt before any retry.",
    );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // Do not expose CLI output, service payloads or credentials.
    process.stderr.write(
      "Storage plan or growth did not pass. Inspect the safe receipt and current volume before retrying; an extension may already have occurred.\n",
    );
    process.exitCode = 1;
  });
}
