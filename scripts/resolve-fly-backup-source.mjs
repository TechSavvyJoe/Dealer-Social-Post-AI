#!/usr/bin/env node

import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const IMAGE_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

function required(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`Missing required environment variable: ${name}`);
  return normalized;
}

function exactOrigin() {
  const url = new URL(
    required(process.env.POCKETBASE_EXPECTED_ORIGIN, "POCKETBASE_EXPECTED_ORIGIN"),
  );
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("POCKETBASE_EXPECTED_ORIGIN must be an exact HTTPS origin.");
  }
  return url.origin;
}

function bootstrapWindowIsValid() {
  if (process.env.ALLOW_FLY_IMAGE_IDENTITY_BOOTSTRAP !== "true") return false;
  const expiresAt = Date.parse(
    required(
      process.env.FLY_IMAGE_IDENTITY_BOOTSTRAP_EXPIRES_AT,
      "FLY_IMAGE_IDENTITY_BOOTSTRAP_EXPIRES_AT",
    ),
  );
  const now = Date.now();
  return (
    Number.isFinite(expiresAt) &&
    expiresAt > now &&
    expiresAt <= now + 24 * 60 * 60 * 1000
  );
}

async function healthReleaseSha(origin) {
  const response = await fetch(`${origin}/api/app/health`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status !== 200 && response.status !== 503) {
    throw new Error(`Production health returned unexpected HTTP ${response.status}.`);
  }
  const payload = await response.json();
  const releaseSha = String(payload?.releaseSha || "")
    .trim()
    .toLowerCase();
  if (!releaseSha) return "";
  if (!GIT_SHA_PATTERN.test(releaseSha)) {
    throw new Error("Production health returned a malformed releaseSha.");
  }
  return releaseSha;
}

export function resolveFlyMachineIdentity(machines, expectedRepository) {
  const identities = (Array.isArray(machines) ? machines : [])
    .filter((machine) => machine?.state === "started")
    .map((machine) => ({
      releaseSha: String(machine?.image_ref?.labels?.GH_SHA || "")
        .trim()
        .toLowerCase(),
      repository: String(machine?.image_ref?.labels?.GH_REPO || "").trim(),
      sourceImageDigest: String(machine?.image_ref?.digest || "")
        .trim()
        .toLowerCase(),
    }));
  if (!identities.length)
    throw new Error("Fly reports no started production machines.");
  if (
    identities.some(
      (identity) =>
        !GIT_SHA_PATTERN.test(identity.releaseSha) ||
        !IMAGE_DIGEST_PATTERN.test(identity.sourceImageDigest) ||
        identity.repository !== expectedRepository,
    )
  ) {
    throw new Error(
      "The running Fly image lacks a trusted repository, Git SHA, or digest label.",
    );
  }
  const unique = new Set(
    identities.map(
      (identity) => `${identity.releaseSha}:${identity.sourceImageDigest}`,
    ),
  );
  if (unique.size !== 1) {
    throw new Error(
      "Running Fly machines do not agree on one source release identity.",
    );
  }
  return {
    releaseSha: identities[0].releaseSha,
    sourceIdentity: "fly_image_label",
    sourceImageDigest: identities[0].sourceImageDigest,
    bootstrapIdentityVerified: true,
  };
}

export function bindHealthToFlyIdentity(releaseSha, flyIdentity) {
  if (!GIT_SHA_PATTERN.test(releaseSha || "")) {
    throw new Error("Production health did not provide an exact Git release SHA.");
  }
  if (!flyIdentity || flyIdentity.releaseSha !== releaseSha) {
    throw new Error(
      "Production health and the running Fly image do not identify the same release.",
    );
  }
  return {
    releaseSha,
    sourceIdentity: "health",
    sourceImageDigest: flyIdentity.sourceImageDigest,
    bootstrapIdentityVerified: false,
  };
}

async function flyImageIdentity(requiresBootstrapWindow) {
  if (requiresBootstrapWindow && !bootstrapWindowIsValid()) {
    throw new Error(
      "Production health has no releaseSha. Open a time-limited Fly image identity bootstrap window (maximum 24 hours) for the first v2 release.",
    );
  }
  const app = required(process.env.FLY_BACKUP_APP, "FLY_BACKUP_APP");
  const expectedRepository = required(
    process.env.EXPECTED_GITHUB_REPOSITORY,
    "EXPECTED_GITHUB_REPOSITORY",
  );
  const { stdout } = await execFileAsync(
    "flyctl",
    ["machine", "list", "--app", app, "--json"],
    { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 },
  );
  return resolveFlyMachineIdentity(JSON.parse(stdout), expectedRepository);
}

async function main() {
  const origin = exactOrigin();
  const releaseSha = await healthReleaseSha(origin);
  // Always attest the running registry image, even after health exposes a SHA.
  // A commit can be rebuilt into more than one image, so SHA-only identity is
  // insufficient for a source-bound recovery manifest.
  const flyIdentity = await flyImageIdentity(!releaseSha);
  const identity = releaseSha
    ? bindHealthToFlyIdentity(releaseSha, flyIdentity)
    : flyIdentity;
  process.stdout.write(`${JSON.stringify({ sourceOrigin: origin, ...identity })}\n`);
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`Source identity resolution failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
