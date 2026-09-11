import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * config/gemini-model-policy.json carries a `verifiedAt` date and
 * scripts/check-model-policy.mjs hard-fails once it is 45 days old. That check
 * runs inside typecheck-and-test, which playwright, container-smoke and the
 * deploy workflow all depend on, so the day it trips every release stops.
 *
 * Before this window existed, CI was green on day 44 and every deploy was
 * blocked on day 45 with no notice. These tests pin the two-week runway.
 *
 * TEST ISOLATION: these run the real script against a COPY of the repo in a
 * temp directory. An earlier version mutated config/gemini-model-policy.json
 * and pb_hooks/requestPolicies.js in place and restored them afterwards, which
 * passed locally but broke CI: vitest runs files in parallel, and
 * productionProviderCanary.test.ts shells out to a script that reads those same
 * two files, so it observed a half-mutated policy and failed with
 * POLICY_INVALID. Never mutate tracked files that another test reads.
 */
const REPO = process.cwd();
const SCRIPT = "scripts/check-model-policy.mjs";
const POLICY = "config/gemini-model-policy.json";
const MIRROR = "pb_hooks/requestPolicies.js";

/**
 * The script resolves its inputs as `dirname(import.meta.url)/..`, so a temp
 * root containing scripts/, config/ and pb_hooks/ is all it needs.
 */
const sandboxAtAgeDays = (days: number): string => {
  const root = mkdtempSync(resolve(tmpdir(), "dsp-policy-"));
  for (const dir of ["scripts", "config", "pb_hooks"]) {
    mkdirSync(resolve(root, dir), { recursive: true });
  }
  copyFileSync(resolve(REPO, SCRIPT), resolve(root, SCRIPT));

  const stamp = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const policy = JSON.parse(readFileSync(resolve(REPO, POLICY), "utf8"));
  policy.verifiedAt = stamp;
  writeFileSync(resolve(root, POLICY), `${JSON.stringify(policy, null, 2)}\n`);

  // verifiedAt is mirrored in the hand-copied snapshot and the script asserts
  // the two match before it looks at freshness; move both or the drift check
  // fires first and the exit code says nothing about the window under test.
  writeFileSync(
    resolve(root, MIRROR),
    readFileSync(resolve(REPO, MIRROR), "utf8").replace(
      /verifiedAt: "\d{4}-\d{2}-\d{2}"/,
      `verifiedAt: "${stamp}"`,
    ),
  );
  return root;
};

/** Both streams matter: the pass message is stdout, the warning is stderr. */
const runChecker = (root: string, env: Record<string, string> = {}) => {
  const result = spawnSync("node", [resolve(root, SCRIPT)], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return {
    code: result.status ?? 1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
};

describe("model policy freshness warning window", () => {
  it("says nothing while the policy is comfortably fresh", () => {
    const { code, output } = runChecker(sandboxAtAgeDays(5));
    expect(code).toBe(0);
    expect(output).not.toMatch(/WARNING/);
  });

  it("warns, without failing, once inside the two-week runway", () => {
    const { code, output } = runChecker(sandboxAtAgeDays(35));
    expect(code).toBe(0);
    expect(output).toMatch(/WARNING/);
    expect(output).toMatch(/Deploys are blocked in \d+ day\(s\)/);
    // And it must not suggest the one fix that would break every installed app.
    expect(output).toMatch(/Do NOT change the policy version/);
  });

  it("fails in the scheduled job, which is what buys the runway", () => {
    const sandbox = sandboxAtAgeDays(35);
    expect(runChecker(sandbox, { MODEL_POLICY_FRESHNESS_STRICT: "true" }).code).toBe(1);
  });

  it("still hard-fails at 45 days regardless of the strict flag", () => {
    expect(runChecker(sandboxAtAgeDays(46)).code).toBe(1);
  });

  it("leaves the real policy files untouched", () => {
    // The guard against the isolation bug described at the top of this file.
    const before = readFileSync(resolve(REPO, POLICY), "utf8");
    sandboxAtAgeDays(35);
    expect(readFileSync(resolve(REPO, POLICY), "utf8")).toBe(before);
  });

  it("is wired to a scheduled workflow, so the warning appears without a push", () => {
    const workflow = readFileSync(
      resolve(REPO, ".github/workflows/model-policy-freshness.yml"),
      "utf8",
    );
    expect(workflow).toMatch(/cron:/);
    expect(workflow).toContain('MODEL_POLICY_FRESHNESS_STRICT: "true"');
    expect(workflow).toContain("npm run model-policy:check");
  });
});
