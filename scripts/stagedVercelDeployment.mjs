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
  {
    expectedUrl,
    expectedProjectId,
    expectedProjectName,
    expectedDeploymentId,
    expectedOrgId,
  },
) {
  const expectedHostname = hostname(expectedUrl);
  const deploymentHostname = hostname(deployment?.url || "");
  if (
    !expectedHostname ||
    deploymentHostname !== expectedHostname ||
    !DEPLOYMENT_ID.test(deployment?.id || "") ||
    deployment.id !== expectedDeploymentId ||
    !/^prj_[A-Za-z0-9]+$/.test(expectedProjectId || "") ||
    deployment?.projectId !== expectedProjectId ||
    !/^team_[A-Za-z0-9]+$/.test(expectedOrgId || "") ||
    deployment?.ownerId !== expectedOrgId ||
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

export function inspectStagedDeployment(options, run = spawnSync) {
  const { cliVersion, timeoutMs, ...identity } = options;
  if (
    !/^\d+\.\d+\.\d+$/.test(cliVersion || "") ||
    !DEPLOYMENT_ID.test(identity.expectedDeploymentId || "") ||
    !/^team_[A-Za-z0-9]+$/.test(identity.expectedOrgId || "") ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > 300_000
  )
    throw new Error("Invalid staged inspection request.");

  // `vercel inspect --json` omits projectId and ownerId in CLI 58.4.4.
  // The authenticated deployment API supplies both; fail closed when the
  // caller only has access to the API's reduced public response.
  const endpoint = `/v13/deployments/${identity.expectedDeploymentId}?teamId=${identity.expectedOrgId}`;
  const inspection = run(
    "npx",
    ["--yes", `vercel@${cliVersion}`, "api", endpoint, "--method", "GET", "--raw"],
    { encoding: "utf8", timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 },
  );
  if (inspection.error || inspection.status !== 0) {
    throw new Error("Authenticated Vercel deployment inspection failed.");
  }
  return validateStagedDeploymentInspection(JSON.parse(inspection.stdout), identity);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [mode, ...args] = process.argv.slice(2);
    let deployment;
    let expectedUrl;
    let expectedProjectId;
    let expectedProjectName;
    let expectedDeploymentId;
    let expectedOrgId;
    if (mode === "--inspect") {
      const [url, cliVersion, deploymentId, projectId, projectName, timeoutMs, orgId] =
        args;
      const result = inspectStagedDeployment({
        expectedUrl: url,
        expectedProjectId: projectId,
        expectedProjectName: projectName,
        expectedDeploymentId: deploymentId,
        expectedOrgId: orgId,
        cliVersion,
        timeoutMs: Number(timeoutMs),
      });
      process.stdout.write(`${result.state} ${result.id}`);
      process.exit(0);
    } else {
      const [file, url, projectId, projectName, deploymentId, orgId] = [mode, ...args];
      deployment = JSON.parse(readFileSync(file, "utf8"));
      expectedUrl = url;
      expectedProjectId = projectId;
      expectedProjectName = projectName;
      expectedDeploymentId = deploymentId;
      expectedOrgId = orgId;
    }
    const result = validateStagedDeploymentInspection(deployment, {
      expectedUrl,
      expectedProjectId,
      expectedProjectName,
      expectedDeploymentId,
      expectedOrgId,
    });
    process.stdout.write(`${result.state} ${result.id}`);
  } catch {
    process.exit(1);
  }
}
