import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Turnstile production release contract", () => {
  it("allows only the official challenge origin in the required CSP directives", () => {
    const html = read("index.html");
    const csp = html.match(
      /http-equiv="Content-Security-Policy"[\s\S]*?content="([^"]+)"/,
    )?.[1];
    expect(csp).toBeDefined();

    const directives = Object.fromEntries(
      String(csp)
        .split(";")
        .map((directive) => directive.trim().split(/\s+/))
        .filter(([name]) => Boolean(name))
        .map(([name, ...values]) => [name, values]),
    );
    for (const directive of ["script-src", "frame-src", "connect-src"]) {
      expect(directives[directive]).toContain("https://challenges.cloudflare.com");
    }
    expect(directives["script-src"]).not.toContain("https:");
    expect(directives["frame-src"]).not.toContain("https:");
  });

  it("passes a public site key into Docker and rejects the CI key in Fly production", () => {
    const docker = read("Dockerfile");
    const ci = read(".github/workflows/ci.yml");
    const fly = read(".github/workflows/fly-deploy.yml");
    const runbook = read("docs/production-backups-and-release.md");

    expect(docker).toContain("ARG VITE_TURNSTILE_SITE_KEY");
    expect(docker).toContain("ENV VITE_TURNSTILE_SITE_KEY=${VITE_TURNSTILE_SITE_KEY}");
    expect(ci).toContain(
      "--build-arg VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA",
    );
    expect(fly).toContain("TURNSTILE_SITE_KEY: ${{ vars.VITE_TURNSTILE_SITE_KEY }}");
    const testSiteKeys = [
      "1x00000000000000000000AA",
      "2x00000000000000000000AB",
      "1x00000000000000000000BB",
      "2x00000000000000000000BB",
      "3x00000000000000000000FF",
    ];
    const testSecrets = [
      "1x0000000000000000000000000000000AA",
      "2x0000000000000000000000000000000AA",
      "3x0000000000000000000000000000000AA",
    ];
    const helpers = read("pb_hooks/helpers.js");
    const backend = read("pb_hooks/main.pb.js");
    for (const key of testSiteKeys) {
      expect(fly).toContain(key);
      expect(helpers).toContain(key);
    }
    for (const secret of testSecrets) expect(helpers).toContain(secret);
    expect(fly).toContain("Cloudflare test sitekeys are CI-only");
    expect(fly).toContain('--build-arg VITE_TURNSTILE_SITE_KEY="$TURNSTILE_SITE_KEY"');
    expect(backend).toContain("helpers.isTurnstileTestSecret(turnstileSecret)");
    expect(backend).toContain("helpers.isTurnstileTestSiteKey(turnstileSiteKey)");
    expect(runbook).toContain("turnstile-spin-v2");
    expect(runbook).toContain("Vercel production as `VITE_TURNSTILE_SITE_KEY`");
    expect(runbook).toContain("Every official Cloudflare test sitekey and secret");
  });
});
