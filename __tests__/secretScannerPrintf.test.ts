import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * scripts/check-secrets.mjs is a required CI gate. It once treated a printf
 * conversion (`%s`) as a plain placeholder and stopped looking, so
 * `printf 'NAME=%s\n' "9f3c2a77..."` — a real credential typed into the exact
 * line the secrets-rotation runbook teaches — passed clean while the scanner
 * on main caught it. These fixtures pin the line-aware behaviour: the value
 * after the format string is what gets judged.
 *
 * TEST ISOLATION: the scanner walks `git ls-files` from its cwd, so each
 * fixture runs in its own throwaway git repository rather than by planting
 * files in the real one.
 *
 * FIXTURE HYGIENE: this file is itself scanned by the gate it tests. Every
 * credential-shaped fixture is assembled at runtime from fragments, so the
 * contiguous string exists only in the temp repo and never in this source.
 * (The first draft wrote them out literally and the scanner flagged this very
 * file — correctly.)
 */
const join = (...parts: string[]) => parts.join("");
const KEY_NAME = join("GEMINI_", "API_KEY");
const TOKEN_NAME = join("PROXY_", "ACCESS_TOKEN");
const PASSWORD_NAME = join("ADMIN_", "LOGIN_PASSWORD");
const PEPPER_NAME = join("SALESPERSON_", "PIN_PEPPER");
const GOOGLE_KEY = join("AIza", "SyD1234567890abcdefghijklmnop");
const HEX_TOKEN = join("9f3c2a77", "b1e4d580aa3b");
const scannerSource = resolve(process.cwd(), "scripts/check-secrets.mjs");

const scan = (fixtureLine: string) => {
  const root = mkdtempSync(resolve(tmpdir(), "dsp-secrets-"));
  mkdirSync(resolve(root, "scripts"));
  copyFileSync(scannerSource, resolve(root, "scripts/check-secrets.mjs"));
  writeFileSync(resolve(root, "probe.sh"), `${fixtureLine}\n`);
  spawnSync("git", ["init", "-q"], { cwd: root });
  spawnSync("git", ["add", "."], { cwd: root });
  const result = spawnSync("node", ["scripts/check-secrets.mjs"], {
    cwd: root,
    encoding: "utf8",
  });
  return { code: result.status ?? 1, output: `${result.stdout}${result.stderr}` };
};

describe("secret scanner: printf conversions", () => {
  it("still passes the runbook's own shape, a variable after the format string", () => {
    const { code, output } = scan(
      `printf '${PEPPER_NAME}=%s\\n' "$NEW_PEPPER" | flyctl secrets import --app x`,
    );
    expect(code, output).toBe(0);
  });

  it("catches a literal credential typed where the variable should be", () => {
    const { code, output } = scan(
      `printf '${TOKEN_NAME}=%s\\n' "${HEX_TOKEN}" | flyctl secrets import --app x`,
    );
    expect(code).toBe(1);
    expect(output).toContain("probe.sh:1 (literal credential)");
  });

  it("catches it with single quotes too", () => {
    const { code } = scan(
      `printf '${PASSWORD_NAME}=%s\\n' '${join("hunter2", "hunter2")}'`,
    );
    expect(code).toBe(1);
  });

  it("still catches a plain literal assignment, which never involved printf", () => {
    const { code, output } = scan(`${KEY_NAME}=${GOOGLE_KEY}`);
    expect(code).toBe(1);
    expect(output).toContain("literal credential");
  });
});
