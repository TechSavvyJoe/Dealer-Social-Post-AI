import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("release artifact binding", () => {
  it("stamps the exact release SHA into CI and the immutable Fly image", () => {
    const dockerfile = read("Dockerfile");
    const ci = read(".github/workflows/ci.yml");
    const fly = read(".github/workflows/fly-deploy.yml");

    expect(dockerfile).toContain("ARG VITE_RELEASE_SHA");
    expect(dockerfile).toContain("ENV VITE_RELEASE_SHA=${VITE_RELEASE_SHA}");
    expect(ci).toContain("VITE_RELEASE_SHA: ${{ github.sha }}");
    expect(ci).toContain('--build-arg VITE_RELEASE_SHA="$GITHUB_SHA"');
    expect(fly).toContain('--build-arg VITE_RELEASE_SHA="$RELEASE_SHA"');
  });

  it("stages and promotes only a clean, current, evidence-bound Vercel artifact", () => {
    const scriptPath = resolve(process.cwd(), "scripts/vercel-staged-release.sh");
    const script = read("scripts/vercel-staged-release.sh");
    const qaScript = read("scripts/vercel-staged-qa.mjs");
    const runbook = read("docs/production-backups-and-release.md");
    const packageJson = read("package.json");
    const vercelCliVersion = "58.4.4";

    execFileSync("bash", ["-n", scriptPath]);
    expect(script).toContain(`readonly VERCEL_CLI_VERSION="${vercelCliVersion}"`);
    expect(qaScript).toContain(`const VERCEL_CLI_VERSION = "${vercelCliVersion}"`);
    expect(script).not.toMatch(/58[.]1[.]0/);
    expect(runbook).toContain(`npx vercel@${vercelCliVersion} env add`);
    expect(runbook).not.toMatch(/58[.]1[.]0/);
    expect(script).toContain("git status --porcelain --untracked-files=normal");
    expect(script).toContain("git ls-remote --exit-code origin refs/heads/main");
    expect(script).toContain("assert_expected_vercel_link");
    expect(script).toContain("team_Tc8DG6XMPUCefkTa3u71mmlN");
    expect(script).toContain("prj_h5phWNMNtK4D9dqwbOHrrrRMqrRi");
    expect(script).toContain('export VITE_RELEASE_SHA="$release_sha"');
    expect(script).toContain("validate_vercel_environment");
    expect(script).toContain(".vercel/.env.production.local");
    expect(script).toContain(
      'rmSync(".vercel/.env.production.local", { force: true })',
    );
    expect(script).toContain("env list production --json");
    expect(script).toContain('proxyEntry.type || "").toLowerCase() === "sensitive"');
    expect(script).toContain('entry?.key === "VITE_TURNSTILE_SITE_KEY"');
    expect(script).toContain("assert_trusted_proxy_route");
    expect(script).toContain("/api/app/proxy-readiness");
    expect(script).toContain("grep -Rqs --include='*.js'");
    expect(script).toContain("deploy \\");
    expect(script).toContain("--prebuilt --prod --skip-domain --yes");
    expect(script).toContain('promote "$deployment_url" --yes');
    expect(script.match(/assert_release_health/g)?.length).toBeGreaterThanOrEqual(6);
    expect(script).toContain(".release-evidence/vercel-staged-release.json");
    expect(script).toContain(".release-evidence/vercel-staged-qa.json");
    expect(script).toContain("assert_qa_evidence");
    expect(script).toContain("assert_frontend_artifact");
    expect(script).toContain("assert_promoted_deployment");
    expect(script).toContain("assert_current_promoted_deployment");
    expect(script).toContain("acquire_release_lock");
    expect(script).toContain("fs.linkSync(candidate, lockPath)");
    expect(script).toContain("assert_provider_canary_evidence");
    expect(
      script.match(/assert_provider_canary_evidence/g)?.length,
    ).toBeGreaterThanOrEqual(3);
    expect(script).toContain("begin_stage_attempt");
    expect(script).toContain("promotionAttemptedAt");
    expect(script).toContain("deploymentId");
    expect(script).not.toContain("VERCEL_RELEASE_EVIDENCE_PATH");
    expect(script).not.toContain("VERCEL_RELEASE_QA_EVIDENCE_PATH");
    expect(script).not.toContain("test-results/vercel-staged-release.json");
    expect(runbook).toContain('npm run release:vercel:stage -- "$RELEASE_SHA"');
    expect(runbook).toContain("npm run release:vercel:qa");
    expect(runbook).toContain("npm run release:vercel:promote");
    expect(packageJson).toContain('"release:vercel:stage"');
    expect(packageJson).toContain('"release:vercel:qa"');
    expect(packageJson).toContain('"release:vercel:promote"');
  });

  it("fails closed when the shell release lock is already owned", () => {
    const directory = mkdtempSync(join(tmpdir(), "dealer-release-shell-lock-"));
    const scriptsDirectory = join(directory, "scripts");
    const evidenceDirectory = join(directory, ".release-evidence");
    const scriptPath = join(scriptsDirectory, "vercel-staged-release.sh");
    const lockPath = join(evidenceDirectory, "vercel-release.lock");

    try {
      mkdirSync(scriptsDirectory, { recursive: true });
      mkdirSync(evidenceDirectory, { recursive: true, mode: 0o700 });
      writeFileSync(scriptPath, read("scripts/vercel-staged-release.sh"), {
        mode: 0o700,
      });
      writeFileSync(
        lockPath,
        `${JSON.stringify({
          schemaVersion: 1,
          pid: 999_999,
          token: "external-owner",
          createdAt: "2026-07-30T00:00:00.000Z",
        })}\n`,
        { mode: 0o600 },
      );
      execFileSync("git", ["init", "--quiet"], { cwd: directory });

      const result = spawnSync("bash", [scriptPath, "invalid"], {
        cwd: directory,
        encoding: "utf8",
        env: process.env,
      });
      const output = `${result.stdout || ""}\n${result.stderr || ""}`;

      expect(result.status).not.toBe(0);
      expect(output).toContain("another staged release command owns");
      expect(output).not.toContain("SyntaxError");
      expect(readFileSync(lockPath, "utf8")).toContain("external-owner");

      rmSync(lockPath);
      const uncontended = spawnSync("bash", [scriptPath, "invalid"], {
        cwd: directory,
        encoding: "utf8",
        env: process.env,
      });
      const uncontendedOutput = `${uncontended.stdout || ""}\n${
        uncontended.stderr || ""
      }`;
      expect(uncontended.status).not.toBe(0);
      expect(uncontendedOutput).toContain("usage:");
      expect(uncontendedOutput).not.toContain("SyntaxError");
      expect(existsSync(lockPath)).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps durable release receipts away from Playwright output", () => {
    const gitignore = read(".gitignore");
    const canary = read("scripts/production-provider-canary.mjs");
    const qa = read("scripts/vercel-staged-qa.mjs");
    const stagedSpec = read("e2e/staged-release.spec.ts");

    expect(gitignore).toContain(".release-evidence/");
    expect(canary).toContain(".release-evidence/production-provider-canary.json");
    expect(canary).toContain("Atomically invalidate any older pass");
    expect(qa).toContain(".release-evidence/vercel-staged-release.json");
    expect(qa).toContain(".release-evidence/vercel-staged-qa.json");
    expect(qa).toContain("PROVIDER_CANARY_MAX_AGE_MS");
    expect(qa).toContain("rmSync(qaPath, { force: true })");
    expect(qa).toContain("E2E_STAGED_RELEASE");
    expect(qa).toContain("--fail-on-flaky-tests");
    expect(qa).toContain('"--retries=0"');
    expect(qa).toContain("acquireReleaseLock");
    expect(qa).toContain("linkSync(candidate, lockPath)");
    expect(qa).toContain("validateProviderCanaryEvidence");
    expect(qa).not.toContain("...process.env");
    expect(stagedSpec).toContain("unsafeRequests");
    expect(stagedSpec).toContain('await context.route("**/*"');
    expect(stagedSpec).toContain('await route.abort("blockedbyclient")');
    expect(stagedSpec).toContain("expect(unsafeRequests).toEqual([])");
    expect(stagedSpec).not.toContain('name: "Digit 9"');
    expect(stagedSpec).not.toContain('page.route("**/api/app/session"');
    expect(stagedSpec).not.toContain(
      'getByRole("button", { name: /continue to system admin/i }).click()',
    );
  });

  it("keeps the stamped SHA in persisted client telemetry", () => {
    const telemetry = read("utils/telemetry.ts");
    const vite = read("vite.config.ts");
    expect(telemetry).toContain("import.meta.env.VITE_RELEASE_SHA");
    expect(telemetry).toContain("releaseSha:");
    expect(telemetry.indexOf("import.meta.env.VITE_RELEASE_SHA")).toBeLessThan(
      telemetry.indexOf("import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA"),
    );
    expect(vite).toContain("process.env.VITE_RELEASE_SHA ||");
    expect(vite).toContain("/^[0-9a-f]{40}$/i");
    expect(vite).toContain("serviceWorkerVersion");
    expect(vite).not.toContain("Date.now()");
    expect(vite).not.toContain("__SW_VERSION__");
  });

  it("runs the real PocketBase release flow in Chromium and WebKit", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("npx playwright install --with-deps chromium webkit");
    expect(ci).toContain("--project=chromium-desktop-1440");
    expect(ci).toContain("--project=webkit-desktop-1440");
  });

  it("pins current action runtimes without changing the Node 22 build contract", () => {
    const checkout =
      "actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0";
    const setupNode =
      "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0";

    for (const path of [
      ".github/workflows/ci.yml",
      ".github/workflows/fly-deploy.yml",
      ".github/workflows/pocketbase-backup.yml",
    ]) {
      const workflow = read(path);
      expect(workflow).toContain(checkout);
      expect(workflow).toContain(setupNode);
      expect(workflow).not.toContain("# v4.2.2");
      expect(workflow).not.toContain("# v4.4.0");
    }
    for (const path of [
      ".github/workflows/fly-deploy.yml",
      ".github/workflows/pocketbase-backup.yml",
      ".github/workflows/fetch-fly-logs.yml",
    ]) {
      expect(read(path)).toContain("version: 0.4.71");
    }

    expect(read(".node-version").trim()).toBe("22.23.1");
    expect(read("Dockerfile")).toContain("FROM node:22.23.1-alpine");
  });
});
