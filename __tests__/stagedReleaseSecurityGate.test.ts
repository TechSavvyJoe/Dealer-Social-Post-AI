import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const shell = read("scripts/vercel-staged-release.sh");

describe("staged release security and canonical promotion", () => {
  it("accepts the deployed CSP but rejects missing or broadened script protection", () => {
    const config = read("vercel.ts").match(
      /export const contentSecurityPolicy = ([\s\S]*?\.join\("; "\));/,
    )!;
    const policy: string = runInNewContext(config[1]);
    const start = shell.indexOf("const csp = rootResponse.headers.get(");
    const end = shell.indexOf("\nif (\n  !html.includes(", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const check = (csp: string) =>
      runInNewContext(shell.slice(start, end), {
        label: "test",
        rootResponse: {
          headers: new Headers({
            "content-security-policy": csp,
            "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
            "x-content-type-options": "nosniff",
            "x-frame-options": "DENY",
            "referrer-policy": "strict-origin-when-cross-origin",
            "permissions-policy":
              "camera=(self), microphone=(self), payment=(), usb=()",
          }),
        },
      });
    expect(() => check(policy)).not.toThrow();
    for (const invalid of [
      policy.replace(/script-src[^;]+; /, ""),
      policy.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
      policy.replace("'wasm-unsafe-eval'", "'unsafe-eval'"),
      policy.replace(/'sha256-[^']+'/g, "'sha256-wrong'"),
    ]) {
      expect(() => check(invalid)).toThrow("required frontend security headers");
    }
  });

  it.each([false, true])(
    "binds the canonical alias and fails closed on alias error=%s",
    (aliasFails) => {
      const promote = shell.match(/^promote_release\(\) \{[\s\S]*?^\}/m)![0];
      const noopNames = [
        "validate_sha",
        "validate_deployment_url",
        "validate_deployment_id",
        "assert_provider_canary_evidence",
        "assert_website_handoff_canary_evidence",
        "assert_qa_evidence",
        "assert_clean_current_release",
        "assert_expected_vercel_link",
        "assert_release_health",
        "assert_trusted_proxy_route",
        "assert_frontend_artifact",
      ];
      const script = `set -euo pipefail
VERCEL_RELEASE_QA_CONFIRM=staged-browser-qa-passed
VERCEL_CLI_VERSION=58.4.4
PRODUCTION_VERCEL_ORIGIN=https://dealer-social-post-ai.vercel.app
EXPECTED_VERCEL_ORG_ID=team_expected
FLY_ORIGIN=https://backend.example
read_stage_evidence() { printf '%s\\n' '${"a".repeat(40)}' 'https://immutable.vercel.app' 'dpl_Exact' '2026-10-12T12:00:00Z' '${"b".repeat(32)}' 'staged'; }
inspect_deployment_id() { printf '%s' dpl_Exact; }
${noopNames.map((name) => `${name}() { :; }`).join("\n")}
fail() { exit 1; }
update_promotion_state() { printf 'state:%s\\n' "$1"; }
assert_promoted_deployment() { echo verify-alias; }
assert_current_promoted_deployment() { echo verify-final-alias; }
npx() { printf 'cli:%s\\n' "$*"; if [[ "$*" == *'alias set'* && '${aliasFails}' == true ]]; then return 42; fi; }
${promote}
promote_release
`;
      const result = spawnSync("bash", ["-c", script], { encoding: "utf8" });
      expect(result.stdout).toContain(
        "alias set https://immutable.vercel.app dealer-social-post-ai.vercel.app --scope team_expected",
      );
      if (aliasFails) {
        expect(result.status).toBe(42);
        expect(result.stdout).not.toContain("verify-alias");
        expect(result.stdout).not.toContain("state:promoted");
      } else {
        expect(result.status).toBe(0);
        expect(
          result.stdout.indexOf("promote https://immutable.vercel.app"),
        ).toBeLessThan(result.stdout.indexOf("alias set"));
        expect(result.stdout.indexOf("alias set")).toBeLessThan(
          result.stdout.indexOf("verify-alias"),
        );
        expect(result.stdout.indexOf("verify-final-alias")).toBeLessThan(
          result.stdout.indexOf("state:promoted"),
        );
      }
    },
  );
});
