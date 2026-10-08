#!/usr/bin/env node
// Read-only production inspection. Never return file names, credentials or logs.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const APP = "dealer-social-post-ai-production";
const DATA_PATH = "/pb/pb_data";

export function parseStorage(dfOutput, duOutput) {
  const diskLines = String(dfOutput).trim().split(/\r?\n/);
  const disk = diskLines.at(-1)?.trim().split(/\s+/);
  const data = String(duOutput).trim().split(/\s+/);
  if (
    diskLines.length !== 2 ||
    !/^Filesystem\s/.test(diskLines[0]) ||
    disk?.length !== 6 ||
    disk[5] !== DATA_PATH ||
    data.length !== 2 ||
    data[1] !== DATA_PATH ||
    ![disk[1], disk[2], disk[3], data[0]].every((n) => /^\d+$/.test(n))
  )
    throw new Error("Storage measurements are unavailable or malformed.");
  const [total, used, available, dataUsed] = [disk[1], disk[2], disk[3], data[0]].map(
    (n) => Number(n) * 1024,
  );
  if (
    ![total, used, available, dataUsed].every(Number.isSafeInteger) ||
    total <= 0 ||
    dataUsed > total ||
    used > total ||
    available > total ||
    used + available > total
  )
    throw new Error("Storage measurements are inconsistent.");
  const maxSpinBytes = 72 * 500000;
  return {
    filesystemTotalBytes: total,
    filesystemUsedBytes: used,
    filesystemAvailableBytes: available,
    dataDirectoryBytes: dataUsed,
    oneMaximumSpinBytes: maxSpinBytes,
    backupBufferBytes: 256 * 1024 * 1024,
    // Same conservative rule as the upload guard. This is not a fleet capacity
    // or availability attestation; other writes may change the next snapshot.
    nextMaximumSpinFitsWithBackup:
      available > dataUsed + maxSpinBytes * 2 + 256 * 1024 * 1024,
  };
}

export function selectMachine(machines, releaseSha) {
  const started = Array.isArray(machines)
    ? machines.filter((machine) => machine?.state === "started")
    : [];
  if (
    started.length !== 1 ||
    !/^[a-f0-9]{14}$/.test(started[0]?.id ?? "") ||
    started[0]?.image_ref?.labels?.GH_SHA !== releaseSha
  )
    throw new Error(
      "Storage inspection requires one started machine matching the running release.",
    );
  return started[0].id;
}

function fly(args) {
  try {
    return execFileSync("flyctl", args, {
      timeout: 150000,
      maxBuffer: 1024 * 1024,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    // CLI stderr may contain connection details. Keep it out of the receipt.
    throw new Error(
      "The protected Fly credential could not measure production storage.",
    );
  }
}

function machineFor(releaseSha) {
  return selectMachine(
    JSON.parse(fly(["machine", "list", "--app", APP, "--json"])),
    releaseSha,
  );
}

function measure(machine, command) {
  return fly([
    "ssh",
    "console",
    "--quiet",
    "--app",
    APP,
    "--machine",
    machine,
    "--user",
    "pbuser",
    "--command",
    command,
  ]);
}

async function release() {
  const response = await fetch(`https://${APP}.fly.dev/api/app/health`, {
    signal: AbortSignal.timeout(30000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Production health is unavailable.");
  const body = await response.json();
  const sha = body.releaseSha;
  if (body.ok !== true || !/^[a-f0-9]{40}$/.test(sha ?? ""))
    throw new Error("Production health has no verified release identity.");
  return sha;
}

async function main() {
  if (!process.env.FLY_API_TOKEN)
    throw new Error("The protected environment is missing its Fly credential.");
  const releaseBefore = await release();
  const machine = machineFor(releaseBefore);
  const disk = measure(machine, `df -Pk ${DATA_PATH}`);
  const data = measure(machine, `du -sk ${DATA_PATH}`);
  const measurements = parseStorage(disk, data);
  if ((await release()) !== releaseBefore || machineFor(releaseBefore) !== machine)
    throw new Error(
      "The production release changed during inspection; retry the check.",
    );
  const receipt = {
    app: APP,
    observedAt: new Date().toISOString(),
    releaseSha: releaseBefore,
    ...measurements,
  };
  mkdirSync(".release-evidence", { recursive: true });
  writeFileSync(
    ".release-evidence/production-storage.json",
    JSON.stringify(receipt, null, 2) + "\n",
    { mode: 0o600 },
  );
  process.stdout.write(JSON.stringify(receipt, null, 2) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`Storage inspection failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
