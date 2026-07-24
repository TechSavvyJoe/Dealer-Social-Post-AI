import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
    const runbook = read("docs/production-backups-and-release.md");
    const packageJson = read("package.json");

    execFileSync("bash", ["-n", scriptPath]);
    expect(script).toContain("git status --porcelain --untracked-files=normal");
    expect(script).toContain("git ls-remote --exit-code origin refs/heads/main");
    expect(script).toContain('export VITE_RELEASE_SHA="$release_sha"');
    expect(script).toContain("grep -Rqs --include='*.js'");
    expect(script).toContain("deploy \\");
    expect(script).toContain("--prebuilt --prod --skip-domain --yes");
    expect(script).toContain('promote "$deployment_url" --yes');
    expect(script.match(/assert_release_health/g)?.length).toBeGreaterThanOrEqual(5);
    expect(script).toContain("test-results/vercel-staged-release.json");
    expect(runbook).toContain('npm run release:vercel:stage -- "$RELEASE_SHA"');
    expect(runbook).toContain("npm run release:vercel:promote");
    expect(packageJson).toContain('"release:vercel:stage"');
    expect(packageJson).toContain('"release:vercel:promote"');
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

    expect(read(".node-version").trim()).toBe("22.23.1");
    expect(read("Dockerfile")).toContain("FROM node:22.23.1-alpine");
  });
});
