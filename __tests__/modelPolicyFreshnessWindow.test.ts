import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * config/gemini-model-policy.json carries a `verifiedAt` date and
 * scripts/check-model-policy.mjs hard-fails once it is 45 days old. That check
 * runs inside typecheck-and-test, which playwright, container-smoke and the
 * deploy workflow all depend on, so the day it trips every release stops.
 *
 * Before this window existed, CI was green on day 44 and every deploy was
 * blocked on day 45 with no notice. These tests pin the two-week runway.
 */
const POLICY = resolve(process.cwd(), "config/gemini-model-policy.json");
const MIRROR = resolve(process.cwd(), "pb_hooks/requestPolicies.js");
const originalPolicy = readFileSync(POLICY, "utf8");
const originalMirror = readFileSync(MIRROR, "utf8");

afterEach(() => {
  writeFileSync(POLICY, originalPolicy);
  writeFileSync(MIRROR, originalMirror);
});

/**
 * verifiedAt lives in both the canonical JSON and its hand-copied snapshot in
 * pb_hooks/requestPolicies.js, and the checker asserts the two match before it
 * looks at freshness. Move both, or the drift assertion fires first and the
 * exit code says nothing about the window under test.
 */
const withAgeDays = (days: number) => {
  const policy = JSON.parse(originalPolicy);
  const stamp = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  policy.verifiedAt = stamp;
  writeFileSync(POLICY, `${JSON.stringify(policy, null, 2)}\n`);
  writeFileSync(
    MIRROR,
    originalMirror.replace(/verifiedAt: "\d{4}-\d{2}-\d{2}"/, `verifiedAt: "${stamp}"`),
  );
};

/** Both streams matter: the pass message is stdout, the warning is stderr. */
const runChecker = (env: Record<string, string> = {}) => {
  const result = spawnSync("node", ["scripts/check-model-policy.mjs"], {
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
    withAgeDays(5);
    const { code, output } = runChecker();
    expect(code).toBe(0);
    expect(output).not.toMatch(/WARNING/);
  });

  it("warns, without failing, once inside the two-week runway", () => {
    withAgeDays(35);
    const { output } = runChecker();
    expect(output).toMatch(/WARNING/);
    expect(output).toMatch(/Deploys are blocked in \d+ day\(s\)/);
    // And it must not suggest the one fix that would break every installed app.
    expect(output).toMatch(/Do NOT change the policy version/);
  });

  it("fails in the scheduled job, which is what buys the runway", () => {
    withAgeDays(35);
    expect(runChecker({ MODEL_POLICY_FRESHNESS_STRICT: "true" }).code).toBe(1);
  });

  it("still hard-fails at 45 days regardless of the strict flag", () => {
    withAgeDays(46);
    expect(runChecker().code).toBe(1);
  });

  it("is wired to a scheduled workflow, so the warning appears without a push", () => {
    const workflow = readFileSync(
      resolve(process.cwd(), ".github/workflows/model-policy-freshness.yml"),
      "utf8",
    );
    expect(workflow).toMatch(/cron:/);
    expect(workflow).toContain('MODEL_POLICY_FRESHNESS_STRICT: "true"');
    expect(workflow).toContain("npm run model-policy:check");
  });
});
