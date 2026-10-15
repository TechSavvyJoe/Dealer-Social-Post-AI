import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("CI minute policy", () => {
  const ci = read(".github/workflows/ci.yml");
  const deploy = read(".github/workflows/fly-deploy.yml");
  const probe = read(".github/workflows/studio-decoder-probe.yml");

  it("keeps the check names branch protection already uses", () => {
    for (const name of [
      "name: typecheck + vitest",
      "name: 25 dealerships / 250 users",
      "name: automation package (typecheck + vitest)",
      "name: Full 48-angle background editor",
      "name: Playwright e2e",
      "name: production container + migration and backup safety",
      "name: Playwright chromium shard ${{ matrix.shard }}/${{ matrix.shards }}",
      "name: Playwright webkit shard 1/1",
      "name: Playwright webkit shard ${{ matrix.shard }}/4",
    ]) {
      expect(ci).toContain(name);
    }
  });

  it("skips heavy work on drafts and docs, and reruns when a draft is ready", () => {
    expect(ci).toContain("types: [opened, synchronize, reopened, ready_for_review]");
    expect(ci).toContain("paths-ignore:");
    expect(ci).toContain('"**/*.md"');
    expect(ci).toContain('"docs/**"');
    expect(ci).toContain("bash scripts/ci-runner-scope.sh");
    expect(ci).not.toContain("pull_request:\n    paths-ignore:");
  });

  it("runs WebKit and the 3x unit pass on main and nightly, not on pull requests", () => {
    expect(ci).toContain('cron: "15 9 * * *"');
    expect(ci).toContain("needs.detect-changes.outputs.webkit == 'true'");
    expect(ci).toContain("needs.detect-changes.outputs.chromium == 'true'");
    expect(ci).toContain("needs.detect-changes.outputs.stability == 'true'");
    expect(ci).toContain("run: npm test");
    expect(ci).toContain("run: npm run test:stability");
    expect(ci).toContain('require "Playwright webkit" "$WEBKIT"');
    expect(ci).toContain('allow_skip "Playwright webkit" "$WEBKIT"');
  });

  it("still makes Deploy production wait for a successful main CI run", () => {
    expect(ci.startsWith("name: CI\n")).toBe(true);
    expect(deploy).toContain("workflows: [CI]");
    expect(deploy).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(deploy).toContain(
      "github.event.workflow_run.event == 'push' || github.event.workflow_run.event == 'workflow_dispatch'",
    );
    expect(deploy).toContain("github.event.workflow_run.head_branch == 'main'");
    expect(ci).toContain('require "Playwright webkit" "$WEBKIT"');
    expect(ci).toContain('require "Full 48-angle background editor" "$EDITOR"');
    expect(ci).toContain(
      'require "production container + migration and backup safety" "$CONTAINER"',
    );
  });

  it("caches browsers and repeats the studio decoder probe three times", () => {
    expect(ci).toContain("path: ~/.cache/ms-playwright");
    expect(ci).toContain(
      "actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830 # v4.3.0",
    );
    expect(ci).toContain("npx playwright install --with-deps chromium webkit");
    expect(probe).toContain("--repeat-each=3");
    expect(probe).not.toContain("--repeat-each=10");
  });

  it("leaves the existing daily schedules alone", () => {
    expect(read(".github/workflows/pocketbase-backup.yml")).toContain(
      'cron: "17 7 * * *"',
    );
    expect(read(".github/workflows/model-policy-freshness.yml")).toContain(
      'cron: "41 7 * * *"',
    );
    expect(read(".github/workflows/revision-compatibility.yml")).toContain(
      'cron: "17 14 * * *"',
    );
  });
});
