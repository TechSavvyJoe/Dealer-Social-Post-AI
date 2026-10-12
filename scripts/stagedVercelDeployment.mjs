import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]+$/;
const PENDING_STATES = new Set(["BUILDING", "QUEUED", "INITIALIZING"]);
const TERMINAL_FAILURE_STATES = new Set(["CANCELED", "ERROR"]);

function hostname(value) {
  try {
    const parsed = new URL(/^https:\/\//i.test(value) ? value : `https://${value}`);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    )
      return null;
    return parsed.hostname;
  } catch {
    return null;
  }
}

export function validateStagedDeploymentInspection(
  deployment,
  { expectedUrl, expectedProjectId, expectedProjectName, expectedDeploymentId },
) {
  const expectedHostname = hostname(expectedUrl);
  const deploymentHostname = hostname(deployment?.url || "");
  if (
    !expectedHostname ||
    deploymentHostname !== expectedHostname ||
    !DEPLOYMENT_ID.test(deployment?.id || "") ||
    deployment.id !== expectedDeploymentId ||
    deployment?.projectId !== expectedProjectId ||
    deployment?.name !== expectedProjectName ||
    deployment?.target !== "production"
  ) {
    throw new Error(
      "Vercel inspection did not match the exact staged deployment identity.",
    );
  }

  const state = deployment.readyState;
  if (state === "READY") return { state, id: deployment.id };
  if (TERMINAL_FAILURE_STATES.has(state)) {
    throw new Error(`Staged Vercel deployment reached terminal state ${state}.`);
  }
  if (PENDING_STATES.has(state)) return { state, id: deployment.id };
  throw new Error("Vercel returned an unknown staged deployment state.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [mode, ...args] = process.argv.slice(2);
    let deployment;
    let expectedUrl;
    let expectedProjectId;
    let expectedProjectName;
    let expectedDeploymentId;
    if (mode === "--inspect") {
      const [url, cliVersion, deploymentId, projectId, projectName, timeoutMs] = args;
      const inspection = spawnSync(
        "npx",
        ["--yes", `vercel@${cliVersion}`, "inspect", url, "--json"],
        { encoding: "utf8", timeout: Number(timeoutMs), maxBuffer: 2 * 1024 * 1024 },
      );
      if (inspection.error || inspection.status !== 0) process.exit(1);
      deployment = JSON.parse(inspection.stdout);
      expectedUrl = url;
      expectedProjectId = projectId;
      expectedProjectName = projectName;
      expectedDeploymentId = deploymentId;
    } else {
      const [file, url, projectId, projectName, deploymentId] = [mode, ...args];
      deployment = JSON.parse(readFileSync(file, "utf8"));
      expectedUrl = url;
      expectedProjectId = projectId;
      expectedProjectName = projectName;
      expectedDeploymentId = deploymentId;
    }
    const result = validateStagedDeploymentInspection(deployment, {
      expectedUrl,
      expectedProjectId,
      expectedProjectName,
      expectedDeploymentId,
    });
    process.stdout.write(`${result.state} ${result.id}`);
  } catch {
    process.exit(1);
  }
}
