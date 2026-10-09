// Protected release only. Keep the shared recovery key out of argv, files,
// image layers and output. GitHub environments mask it and independently hold
// the same value for the restore drill and deployment.
import { spawnSync } from "node:child_process";

const key = process.env.CONNECTIONS_ENCRYPTION_KEY || "";
if (!/^[\x21-\x7e]{32}$/.test(key)) {
  throw new Error(
    "Central connection encryption must be provisioned in both protected release environments.",
  );
}
const result = spawnSync(
  "flyctl",
  ["secrets", "import", "--stage", "--app", "dealer-social-post-ai-production"],
  {
    input: `CONNECTIONS_ENCRYPTION_KEY=${key}\n`,
    encoding: "utf8",
    timeout: 120_000,
    stdio: ["pipe", "pipe", "pipe"],
  },
);
if (result.error || result.status !== 0) {
  // Upstream errors can contain request details; report a fixed safe message.
  throw new Error(
    "Could not stage the centrally managed connection key. Deployment was stopped.",
  );
}
console.log("Central connection key staged; the verified deployment will apply it.");
