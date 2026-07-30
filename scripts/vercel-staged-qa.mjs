#!/usr/bin/env node

/**
 * Runs the non-mutating browser gate against the exact Vercel artifact recorded
 * by `vercel-staged-release.sh`. Playwright owns `test-results`, so durable
 * release receipts deliberately live in `.release-evidence`.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VERCEL_CLI_VERSION = "58.4.4";
const EXPECTED_VERCEL_ORG_ID = "team_Tc8DG6XMPUCefkTa3u71mmlN";
const EXPECTED_VERCEL_PROJECT_ID = "prj_h5phWNMNtK4D9dqwbOHrrrRMqrRi";
const EXPECTED_VERCEL_PROJECT_NAME = "dealer-social-post-ai";
const DEFAULT_STAGE_EVIDENCE_PATH = resolve(
  root,
  ".release-evidence/vercel-staged-release.json",
);
const DEFAULT_QA_EVIDENCE_PATH = resolve(
  root,
  ".release-evidence/vercel-staged-qa.json",
);
const DEFAULT_PROVIDER_CANARY_EVIDENCE_PATH = resolve(
  root,
  ".release-evidence/production-provider-canary.json",
);
const RELEASE_LOCK_PATH = resolve(root, ".release-evidence/vercel-release.lock");
const PRODUCTION_FLY_ORIGIN = "https://dealer-social-post-ai-production.fly.dev";
const PROVIDER_CANARY_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export const HOSTED_QA_PROJECTS = Object.freeze([
  "chromium-phone-fold-280",
  "chromium-phone-320",
  "chromium-android-360",
  "chromium-phone-390",
  "chromium-phone-large-440",
  "chromium-phone-landscape-844",
  "chromium-tablet-768",
  "chromium-desktop-1440",
  "webkit-phone-fold-280",
  "webkit-phone-320",
  "webkit-android-360",
  "webkit-phone-390",
  "webkit-phone-large-440",
  "webkit-phone-landscape-844",
  "webkit-tablet-768",
  "webkit-desktop-1440",
]);

const fail = (message) => {
  throw new Error(`Staged browser QA blocked: ${message}`);
};

const readJson = (path, label) => {
  if (!existsSync(path)) {
    fail(`${label} is missing: ${path}`);
  }
  if (lstatSync(path).isSymbolicLink()) {
    fail(`${label} must not be a symbolic link: ${path}`);
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail(`${label} is invalid: ${path}`);
  }
};

const isExactSha = (value) => /^[0-9a-f]{40}$/.test(value || "");
const isDeploymentId = (value) => /^dpl_[A-Za-z0-9]+$/.test(value || "");

const isCanonicalDeploymentUrl = (value) => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.pathname === "/" || url.pathname === "") &&
      url.hostname.endsWith(".vercel.app")
    );
  } catch {
    return false;
  }
};

export const validateStageEvidence = (evidence) => {
  if (
    evidence?.schemaVersion !== 3 ||
    !/^[0-9a-f]{32}$/.test(evidence.attemptId || "") ||
    evidence.status !== "staged" ||
    !isExactSha(evidence.releaseSha) ||
    !isCanonicalDeploymentUrl(evidence.deploymentUrl) ||
    !isDeploymentId(evidence.deploymentId) ||
    !Number.isFinite(Date.parse(evidence.stagedAt || "")) ||
    evidence.promotedAt !== null
  ) {
    fail("the staged release receipt does not match the current schema.");
  }
  return evidence;
};

export const resolveVercelAliasPage = (payload, requestedAlias) => {
  if (
    !payload ||
    !Array.isArray(payload.aliases) ||
    !payload.pagination ||
    typeof requestedAlias !== "string" ||
    !requestedAlias.endsWith(".vercel.app")
  ) {
    fail("the Vercel alias inventory page is invalid.");
  }

  const matches = payload.aliases.filter(
    (entry) => entry && entry.alias === requestedAlias,
  );
  if (matches.length > 1) {
    fail("the Vercel alias inventory contains duplicate exact aliases.");
  }

  const deploymentId = matches[0]?.deploymentId ?? null;
  if (deploymentId !== null && !isDeploymentId(deploymentId)) {
    fail("the Vercel alias inventory contains an invalid deployment ID.");
  }

  const next = payload.pagination.next;
  if (next !== null && (!Number.isSafeInteger(next) || next <= 0)) {
    fail("the Vercel alias inventory contains an invalid pagination cursor.");
  }

  return { deploymentId, next };
};

const git = (...args) =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const assertCleanCurrentMain = (releaseSha) => {
  if (git("status", "--porcelain", "--untracked-files=normal")) {
    fail("the Git worktree must be clean.");
  }
  if (git("rev-parse", "HEAD") !== releaseSha) {
    fail("HEAD no longer matches the staged release.");
  }
  const remoteMain = git("ls-remote", "--exit-code", "origin", "refs/heads/main").split(
    /\s+/,
  )[0];
  if (remoteMain !== releaseSha) {
    fail("the staged release is no longer the current main commit.");
  }
};

export const validateDeploymentInspection = (deployment, stageEvidence) => {
  const deploymentHostname = new URL(stageEvidence.deploymentUrl).hostname;
  const aliases = Array.isArray(deployment?.aliases) ? deployment.aliases : [];
  if (
    deployment?.id !== stageEvidence.deploymentId ||
    deployment?.name !== EXPECTED_VERCEL_PROJECT_NAME ||
    deployment?.readyState !== "READY" ||
    deployment?.target !== "production" ||
    (deployment?.url !== deploymentHostname && !aliases.includes(deploymentHostname))
  ) {
    fail("Vercel inspection does not match the recorded production artifact.");
  }
  return deployment;
};

export const validateQaEvidence = (evidence, stageEvidence) => {
  const passedAt = Date.parse(evidence?.passedAt || "");
  const stagedAt = Date.parse(stageEvidence?.stagedAt || "");
  if (
    evidence?.schemaVersion !== 2 ||
    evidence.attemptId !== stageEvidence.attemptId ||
    evidence.releaseSha !== stageEvidence.releaseSha ||
    evidence.deploymentUrl !== stageEvidence.deploymentUrl ||
    evidence.deploymentId !== stageEvidence.deploymentId ||
    evidence.spec !== "e2e/staged-release.spec.ts" ||
    evidence.outcome !== "passed" ||
    !Number.isFinite(passedAt) ||
    !Number.isFinite(stagedAt) ||
    passedAt < stagedAt ||
    passedAt > Date.now() + 300_000 ||
    !Array.isArray(evidence.projects) ||
    evidence.projects.length !== HOSTED_QA_PROJECTS.length ||
    !HOSTED_QA_PROJECTS.every((project) => evidence.projects.includes(project))
  ) {
    fail("the browser QA receipt does not match the staged release.");
  }
  return evidence;
};

export const validateProviderCanaryEvidence = (evidence, releaseSha) => {
  const startedAt = Date.parse(evidence?.startedAt || "");
  const completedAt = Date.parse(evidence?.completedAt || "");
  const requiredChecks = [
    "authentication",
    "health",
    "caption",
    "standardImage",
    "standardVideo",
    "qualityVideo",
    "sessionRevocation",
  ];
  if (
    evidence?.schemaVersion !== 3 ||
    evidence.canary !== "production-provider-proxy" ||
    evidence.syntheticAsset !== "public/icon-512.png" ||
    evidence.targetOrigin !== PRODUCTION_FLY_ORIGIN ||
    evidence.expectedReleaseSha !== releaseSha ||
    evidence.outcome !== "passed" ||
    !Number.isFinite(startedAt) ||
    !Number.isFinite(completedAt) ||
    completedAt < startedAt ||
    completedAt > Date.now() + 300_000 ||
    Date.now() - completedAt > PROVIDER_CANARY_MAX_AGE_MS ||
    evidence.checks?.authentication?.role !== "salesperson" ||
    evidence.checks?.health?.releaseSha !== releaseSha ||
    evidence.checks?.health?.backupStatus !== "verified" ||
    !requiredChecks.every((name) => evidence.checks?.[name]?.passed === true)
  ) {
    fail("the provider canary receipt does not prove the exact Fly release.");
  }
  return evidence;
};

export const acquireReleaseLock = (lockPath = RELEASE_LOCK_PATH) => {
  const evidenceDirectory = dirname(lockPath);
  if (existsSync(evidenceDirectory) && lstatSync(evidenceDirectory).isSymbolicLink()) {
    fail("the release evidence directory must not be a symbolic link.");
  }
  mkdirSync(evidenceDirectory, { recursive: true, mode: 0o700 });
  if (
    !lstatSync(evidenceDirectory).isDirectory() ||
    lstatSync(evidenceDirectory).isSymbolicLink()
  ) {
    fail("the release evidence path is not a private directory.");
  }
  chmodSync(evidenceDirectory, 0o700);

  const token = randomBytes(16).toString("hex");
  const candidate = `${lockPath}.candidate-${process.pid}-${token}`;
  const owner = {
    schemaVersion: 1,
    pid: process.pid,
    token,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(candidate, `${JSON.stringify(owner)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  try {
    try {
      // The owner record is complete before this atomic link makes it visible.
      linkSync(candidate, lockPath);
      chmodSync(lockPath, 0o600);
    } catch (error) {
      if (!(error instanceof Error) || error.code !== "EEXIST") throw error;
      if (lstatSync(lockPath).isSymbolicLink()) {
        fail("the staged release lock path is unsafe.");
      }
      throw Object.assign(
        new Error(
          "another staged release command owns the release lock; remove it manually only after proving no release command is running.",
        ),
        { code: "RELEASE_LOCKED" },
      );
    }
  } finally {
    rmSync(candidate, { force: true });
  }

  return () => {
    if (!existsSync(lockPath) || lstatSync(lockPath).isSymbolicLink()) return;
    let currentOwner;
    try {
      currentOwner = JSON.parse(readFileSync(lockPath, "utf8"));
    } catch {
      return;
    }
    if (currentOwner.pid !== process.pid || currentOwner.token !== token) return;
    rmSync(lockPath);
  };
};

const assertExpectedVercelDeployment = (stageEvidence) => {
  const link = readJson(resolve(root, ".vercel/project.json"), "Vercel project link");
  if (
    link.orgId !== EXPECTED_VERCEL_ORG_ID ||
    link.projectId !== EXPECTED_VERCEL_PROJECT_ID
  ) {
    fail("the repository is linked to a different Vercel project or team.");
  }
  let inspection;
  try {
    inspection = JSON.parse(
      execFileSync(
        "npx",
        [
          "--yes",
          `vercel@${VERCEL_CLI_VERSION}`,
          "inspect",
          stageEvidence.deploymentUrl,
          "--json",
        ],
        {
          cwd: root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      ),
    );
  } catch {
    fail("the staged Vercel deployment could not be inspected.");
  }
  validateDeploymentInspection(inspection, stageEvidence);
};

const writeQaEvidence = (target, stageEvidence) => {
  const evidence = {
    schemaVersion: 2,
    attemptId: stageEvidence.attemptId,
    releaseSha: stageEvidence.releaseSha,
    deploymentUrl: stageEvidence.deploymentUrl,
    deploymentId: stageEvidence.deploymentId,
    spec: "e2e/staged-release.spec.ts",
    projects: [...HOSTED_QA_PROJECTS],
    outcome: "passed",
    passedAt: new Date().toISOString(),
  };
  const directory = dirname(target);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (basename(directory) === ".release-evidence") {
    chmodSync(directory, 0o700);
  }
  const temporary = `${target}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(evidence, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(temporary, target);
};

export const runHostedQa = () => {
  if (process.version !== "v22.23.1") {
    fail("Node 22.23.1 is required; run through the pinned project runtime.");
  }
  const releaseLockCleanup = acquireReleaseLock();
  try {
    const stagePath = DEFAULT_STAGE_EVIDENCE_PATH;
    const qaPath = DEFAULT_QA_EVIDENCE_PATH;
    const stageEvidence = validateStageEvidence(readJson(stagePath, "stage evidence"));
    assertCleanCurrentMain(stageEvidence.releaseSha);
    assertExpectedVercelDeployment(stageEvidence);

    // A failed, flaky, or interrupted run must never leave an older pass receipt.
    rmSync(qaPath, { force: true });

    const allowedEnvironment = {};
    for (const name of [
      "PATH",
      "HOME",
      "TMPDIR",
      "TMP",
      "TEMP",
      "LANG",
      "LC_ALL",
      "PLAYWRIGHT_BROWSERS_PATH",
    ]) {
      if (process.env[name]) allowedEnvironment[name] = process.env[name];
    }
    const result = spawnSync(
      resolve(root, "node_modules/.bin/playwright"),
      [
        "test",
        "e2e/staged-release.spec.ts",
        "--reporter=line",
        "--retries=0",
        "--fail-on-flaky-tests",
        ...HOSTED_QA_PROJECTS.map((project) => `--project=${project}`),
      ],
      {
        cwd: root,
        stdio: "inherit",
        env: {
          ...allowedEnvironment,
          CI: "true",
          E2E_STAGED_RELEASE: "true",
          E2E_BASE_URL: stageEvidence.deploymentUrl,
          E2E_EXPECTED_SHA: stageEvidence.releaseSha,
        },
      },
    );

    if (result.error) fail(`Playwright could not start: ${result.error.message}`);
    if (result.status !== 0) {
      fail(`hosted browser QA failed with exit code ${result.status ?? "unknown"}.`);
    }

    writeQaEvidence(qaPath, stageEvidence);
    process.stdout.write(`Hosted staged browser QA passed.\nEvidence: ${qaPath}\n`);
  } finally {
    releaseLockCleanup();
  }
};

const invokedAsScript =
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (invokedAsScript) {
  try {
    if (process.argv[2] === "--verify-receipt") {
      const [releaseSha, deploymentUrl, deploymentId, stagedAt, attemptId] =
        process.argv.slice(3);
      validateQaEvidence(readJson(DEFAULT_QA_EVIDENCE_PATH, "browser QA evidence"), {
        releaseSha,
        deploymentUrl,
        deploymentId,
        stagedAt,
        attemptId,
      });
    } else if (process.argv[2] === "--verify-provider-canary") {
      validateProviderCanaryEvidence(
        readJson(DEFAULT_PROVIDER_CANARY_EVIDENCE_PATH, "provider canary evidence"),
        process.argv[3] || "",
      );
    } else if (process.argv[2] === "--resolve-alias-page") {
      const result = resolveVercelAliasPage(
        readJson(resolve(process.argv[3] || ""), "Vercel alias inventory"),
        process.argv[4] || "",
      );
      process.stdout.write(`${result.deploymentId || "-"}\n${result.next ?? "-"}\n`);
    } else if (process.argv.length === 2) {
      runHostedQa();
    } else {
      fail(
        "usage: scripts/vercel-staged-qa.mjs [--verify-receipt release url id staged-at attempt | --verify-provider-canary release | --resolve-alias-page file alias]",
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
