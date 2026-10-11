import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  stageWebsiteCanaryConfiguration,
  websiteCanaryEnvironment,
} from "../scripts/stage-website-canary-config.mjs";

const env = {
  CUSTOMER_HUB_CANARY_DEALER_ID: "canarydealer001",
  CUSTOMER_HUB_CANARY_SECRET: "a".repeat(64),
};

describe("isolated website canary deployment", () => {
  it("preserves runtime configuration when the pair is omitted", () => {
    const run = vi.fn();
    expect(stageWebsiteCanaryConfiguration({}, run)).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects incomplete pairs, malformed identities, and environment injection before Fly", () => {
    for (const invalid of [
      { CUSTOMER_HUB_CANARY_DEALER_ID: env.CUSTOMER_HUB_CANARY_DEALER_ID },
      { CUSTOMER_HUB_CANARY_SECRET: env.CUSTOMER_HUB_CANARY_SECRET },
      { ...env, CUSTOMER_HUB_CANARY_DEALER_ID: "wrong\nOTHER=value" },
      { ...env, CUSTOMER_HUB_CANARY_SECRET: "short" },
      {
        ...env,
        CUSTOMER_HUB_CANARY_SECRET: `${env.CUSTOMER_HUB_CANARY_SECRET}\nOTHER=value`,
      },
    ]) {
      const run = vi.fn();
      expect(() => stageWebsiteCanaryConfiguration(invalid, run)).toThrow(
        "paired 256-bit",
      );
      expect(run).not.toHaveBeenCalled();
    }
  });

  it("stages only the paired identity through stdin and fails closed without echoing secrets", () => {
    const valid = { ...env, CUSTOMER_HUB_CANARY_DEALER_ID: "canarydealer001" };
    const run = vi.fn(() => ({ status: 0 }));
    expect(stageWebsiteCanaryConfiguration(valid, run)).toBe(true);
    expect(run.mock.calls[0][1]).toEqual([
      "secrets",
      "import",
      "--stage",
      "--app",
      "dealer-social-post-ai-production",
    ]);
    expect(run.mock.calls[0][2].input).toBe(websiteCanaryEnvironment(valid));
    const failure = vi.fn(() => ({
      status: 1,
      stderr: valid.CUSTOMER_HUB_CANARY_SECRET,
    }));
    expect(() => stageWebsiteCanaryConfiguration(valid, failure)).toThrow(
      "production was not deployed",
    );
    try {
      stageWebsiteCanaryConfiguration(valid, failure);
    } catch (error) {
      expect(String(error)).not.toContain(valid.CUSTOMER_HUB_CANARY_SECRET);
    }
  });

  it("stages the pair before activating the restore-tested immutable image", () => {
    const workflow = readFileSync(".github/workflows/fly-deploy.yml", "utf8");
    expect(workflow).toContain(
      "CUSTOMER_HUB_CANARY_SECRET: ${{ secrets.CUSTOMER_HUB_CANARY_SECRET }}",
    );
    const stage = workflow.indexOf("node scripts/stage-website-canary-config.mjs");
    expect(stage).toBeGreaterThan(0);
    expect(stage).toBeLessThan(
      workflow.indexOf("flyctl deploy --app dealer-social-post-ai-production"),
    );
  });
});
