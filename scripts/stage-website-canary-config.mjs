import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// An omitted pair preserves the existing runtime configuration. A partial pair
// must never activate an identity with a different or missing signing key.
export function websiteCanaryEnvironment(env = process.env) {
  const dealer = env.CUSTOMER_HUB_CANARY_DEALER_ID || "";
  const secret = env.CUSTOMER_HUB_CANARY_SECRET || "";
  if (!dealer && !secret) return null;
  if (!/^[a-z0-9]{15}$/.test(dealer) || !/^[a-f0-9]{64}$/.test(secret)) {
    throw new Error(
      "Website canary configuration requires a valid dealer and a paired 256-bit signing key.",
    );
  }
  return `CUSTOMER_HUB_CANARY_DEALER_ID=${dealer}\nCUSTOMER_HUB_CANARY_SECRET=${secret}\n`;
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {(command: string, args: string[], options: import("node:child_process").SpawnSyncOptionsWithStringEncoding) => {status: number | null, error?: Error}} run
 */
export function stageWebsiteCanaryConfiguration(env = process.env, run = spawnSync) {
  const input = websiteCanaryEnvironment(env);
  if (!input) return false;
  const result = run(
    "flyctl",
    ["secrets", "import", "--stage", "--app", "dealer-social-post-ai-production"],
    { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 60_000 },
  );
  // Never relay CLI output: a credential must not enter release logs even if a
  // future CLI version includes the submitted environment in an error.
  if (result.error || result.status !== 0) {
    throw new Error(
      "Staging website canary configuration failed; production was not deployed.",
    );
  }
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const staged = stageWebsiteCanaryConfiguration();
    console.log(
      staged
        ? "Website canary configuration staged."
        : "Website canary configuration unchanged.",
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
