import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const script = resolve(process.cwd(), "scripts/ci-runner-scope.sh");

const keys = [
  "unit",
  "stability",
  "chromium",
  "webkit",
  "editor",
  "container",
  "small",
  "docs_only",
  "draft",
] as const;

const run = (
  env: Record<string, string>,
  files?: string[],
): Record<(typeof keys)[number], string> => {
  const dir = mkdtempSync(join(tmpdir(), "ci-scope-"));
  const extra: Record<string, string> = {};
  if (files) {
    const list = join(dir, "changed");
    writeFileSync(list, files.map((file) => `${file}\0`).join(""));
    extra.CHANGED_FILES = list;
  }
  const output = join(dir, "github-output");
  const result = spawnSync("bash", [script], {
    env: { ...process.env, GITHUB_OUTPUT: output, ...env, ...extra },
    encoding: "utf8",
  });
  const text = readFileSync(output, "utf8");
  rmSync(dir, { recursive: true, force: true });
  expect(result.status, result.stderr).toBe(0);
  const parsed = Object.fromEntries(
    text
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("=")),
  );
  for (const key of keys) expect(parsed[key], key).toMatch(/^(true|false)$/);
  return parsed as Record<(typeof keys)[number], string>;
};

describe("CI runner scope", () => {
  it("runs the full release bar on push and manual dispatch", () => {
    for (const EVENT_NAME of ["push", "workflow_dispatch"]) {
      const scope = run({ EVENT_NAME });
      expect(scope).toMatchObject({
        unit: "true",
        stability: "true",
        chromium: "true",
        webkit: "true",
        editor: "true",
        container: "true",
        small: "true",
        docs_only: "false",
        draft: "false",
      });
    }
  });

  it("keeps the full push bar when GitHub sends no previous commit", () => {
    const scope = run({
      EVENT_NAME: "push",
      BASE_SHA: "0".repeat(40),
    });
    expect(scope).toMatchObject({
      unit: "true",
      webkit: "true",
      chromium: "true",
      editor: "true",
      container: "true",
      stability: "true",
    });
  });

  it("keeps the nightly run to WebKit and the 3x unit pass", () => {
    expect(run({ EVENT_NAME: "schedule" })).toMatchObject({
      unit: "true",
      stability: "true",
      webkit: "true",
      chromium: "false",
      editor: "false",
      container: "false",
      small: "false",
    });
  });

  it("skips heavy lanes on a draft and keeps the small checks", () => {
    const scope = run({ EVENT_NAME: "pull_request", PR_DRAFT: "true" }, [
      "utils/vehicleSpin.ts",
      "App.tsx",
    ]);
    expect(scope).toMatchObject({
      draft: "true",
      small: "true",
      unit: "false",
      stability: "false",
      chromium: "false",
      webkit: "false",
      editor: "false",
      container: "false",
      docs_only: "false",
    });
  });

  it("treats markdown and docs changes as docs-only", () => {
    const scope = run({ EVENT_NAME: "pull_request", PR_DRAFT: "false" }, [
      "README.md",
      "docs/runbooks/rollback.md",
      "skills/dealership-campaign-creative-director/SKILL.md",
      ".github/ISSUE_TEMPLATE/config.yml",
      ".github/pull_request_template.md",
    ]);
    expect(scope.docs_only).toBe("true");
    expect(scope.unit).toBe("false");
    expect(scope.chromium).toBe("false");
    expect(scope.editor).toBe("false");
    expect(scope.container).toBe("false");
    expect(scope.small).toBe("false");
    expect(scope.webkit).toBe("false");
  });

  it("runs Chromium once, and not WebKit, for an ordinary pull request", () => {
    const scope = run({ EVENT_NAME: "pull_request", PR_DRAFT: "false" }, [
      "App.tsx",
      "README.md",
    ]);
    expect(scope).toMatchObject({
      unit: "true",
      stability: "false",
      chromium: "true",
      webkit: "false",
      editor: "false",
      container: "true",
      small: "true",
      docs_only: "false",
    });
  });

  it("runs the 48-angle editor when a vehicle-spin path changes", () => {
    for (const file of [
      "utils/vehicleSpinBackground.ts",
      "components/VehicleSpinStudio.tsx",
      "components/Home.tsx",
      "e2e/vehicle-spin-editor.spec.ts",
      "e2e/fixtures/vehicle-background-fixture.mp4",
      "services/vehicleSpins.ts",
      "pb_hooks/vehicleSpins.pb.js",
      "playwright.config.ts",
      ".github/workflows/ci.yml",
    ]) {
      const scope = run({ EVENT_NAME: "pull_request", PR_DRAFT: "false" }, [file]);
      expect(scope.editor, file).toBe("true");
      expect(scope.webkit, file).toBe("false");
      expect(scope.stability, file).toBe("false");
    }
  });

  it("runs the heavy lanes when a pull request has no base commit", () => {
    const scope = run({
      EVENT_NAME: "pull_request",
      PR_DRAFT: "false",
      BASE_SHA: "0".repeat(40),
    });
    expect(scope.docs_only).toBe("false");
    expect(scope.editor).toBe("true");
    expect(scope.chromium).toBe("true");
    expect(scope.webkit).toBe("false");
  });

  it("runs the heavy lanes when the diff is empty", () => {
    const scope = run({ EVENT_NAME: "pull_request", PR_DRAFT: "false" }, []);
    expect(scope.docs_only).toBe("false");
    expect(scope.editor).toBe("true");
    expect(scope.chromium).toBe("true");
    expect(scope.webkit).toBe("false");
  });

  it("rejects an unknown event", () => {
    const result = spawnSync("bash", [script], {
      env: { ...process.env, EVENT_NAME: "deployment" },
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
  });
});
