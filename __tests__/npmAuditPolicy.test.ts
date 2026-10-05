import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateAudit, validateExceptions } from "../scripts/check-npm-audit.mjs";

const braces = {
  source: 1240992,
  name: "braces",
  dependency: "braces",
  title: "braces vulnerable to stack-exhaustion denial of service",
  url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm",
  severity: "high",
  range: "<=3.0.3",
};

const report = (extra: Record<string, unknown> = {}) => ({
  vulnerabilities: {
    braces: { name: "braces", severity: "high", via: [braces] },
    chokidar: { name: "chokidar", severity: "high", via: ["braces"] },
    tailwindcss: { name: "tailwindcss", severity: "high", via: ["chokidar"] },
    ...extra,
  },
});

const exception = {
  advisory: "GHSA-vfj7-8cjw-p6xm",
  package: "braces",
  reviewed: "2026-10-05",
  expires: "2026-11-05",
  reason:
    "Build-time only through tailwindcss globbing of repo-owned patterns; no patched release exists.",
};

describe("npm audit exception policy", () => {
  it("passes an advisory covered by an unexpired exception, and only that one", () => {
    const result = evaluateAudit(report(), [exception], "2026-10-05");
    expect(result.ok).toBe(true);
    expect(result.excepted).toHaveLength(1);
    expect(result.failures).toEqual([]);
  });

  it("fails every advisory that has no exception", () => {
    const result = evaluateAudit(
      report({
        undici: {
          name: "undici",
          severity: "low",
          via: [
            {
              source: 1,
              name: "undici",
              title: "low severity issue",
              url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
              severity: "low",
            },
          ],
        },
      }),
      [exception],
      "2026-10-05",
    );
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      expect.stringContaining("GHSA-aaaa-bbbb-cccc undici (low)"),
    ]);
  });

  it("fails an advisory whose exception has expired", () => {
    const result = evaluateAudit(report(), [exception], "2026-11-06");
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toContain("expired on 2026-11-05");
  });

  it("does not let an exception for one package cover the same id on another", () => {
    const result = evaluateAudit(
      report(),
      [{ ...exception, package: "micromatch" }],
      "2026-10-05",
    );
    expect(result.ok).toBe(false);
  });

  it("fails closed when npm audit returns an error instead of a report", () => {
    expect(
      evaluateAudit({ error: { summary: "network down" } }, [exception], "2026-10-05")
        .ok,
    ).toBe(false);
    expect(evaluateAudit(null, [exception], "2026-10-05").ok).toBe(false);
  });

  it("reports an exception the audit no longer needs", () => {
    const result = evaluateAudit({ vulnerabilities: {} }, [exception], "2026-10-05");
    expect(result.ok).toBe(true);
    expect(result.stale).toEqual([expect.stringContaining("remove its exception")]);
  });

  it("rejects exceptions without an id, an expiry or a real reason", () => {
    expect(validateExceptions([exception])).toEqual([]);
    expect(
      validateExceptions([
        { advisory: "CVE-1", package: "", expires: "soon", reason: "ok" },
      ]),
    ).toHaveLength(4);
    expect(validateExceptions({})).toHaveLength(1);
  });

  it("keeps the checked-in exceptions valid", () => {
    const checkedIn = JSON.parse(
      readFileSync(resolve(__dirname, "../config/npm-audit-exceptions.json"), "utf8"),
    );
    expect(validateExceptions(checkedIn)).toEqual([]);
  });
});
