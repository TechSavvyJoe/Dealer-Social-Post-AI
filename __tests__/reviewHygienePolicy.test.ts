import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("review hygiene follow-ups", () => {
  it("keeps engines.node at or above lint-staged's requirement", () => {
    const pkg = JSON.parse(read("package.json")) as {
      engines?: { node?: string };
      devDependencies?: { "lint-staged"?: string };
    };
    const lock = read("package-lock.json");
    expect(pkg.engines?.node).toMatch(/^>=22\.22\.1/);
    expect(pkg.engines?.node).toContain("<23");
    // lint-staged@17.2.0 declares engines.node >=22.22.1
    expect(lock).toContain('"lint-staged"');
    expect(lock).toContain('"node": ">=22.22.1"');
  });

  it("fails closed on unstubbed fixture API routes", () => {
    const source = read("e2e/isolateFromLiveApi.ts");
    expect(source).toContain("Unstubbed ${method} ${path} in fixture");
    expect(source).not.toMatch(/if \(method === "GET"\) return json\(\{\}\)/);
    const afterProxyStub = source.slice(
      source.indexOf('if (path.startsWith("/api/proxy/")'),
    );
    expect(afterProxyStub).toContain(", 501)");
    expect(afterProxyStub).not.toContain("success: true");
    expect(afterProxyStub).not.toContain("return json({})");
  });

  it("uses the repo scrollbar-hide utility on the post media rail", () => {
    const card = read("components/post/PostPreviewCard.tsx");
    expect(card).toContain("scrollbar-hide");
    expect(card).not.toContain("scrollbar-none");
    expect(read("styles/globals.css")).toContain("@utility scrollbar-hide");
  });

  it("marks the stranded photo-release open issue as resolved", () => {
    const doc = read("docs/open-issues-2026-09-03.md");
    expect(doc).toMatch(/P0 — Photo release lock.*resolved/i);
    expect(doc).toContain("linkReleaseToPostWithRetry");
    expect(doc).toContain("useReleaseRepair");
  });

  it("treats scaffold Gemini keys as unset for readiness", () => {
    const module = {
      exports: {} as { isConfiguredProviderApiKey: (v: string) => boolean },
    };
    runInNewContext(read("pb_hooks/helpers.js"), {
      module,
      $os: { getenv: () => "" },
      $security: { sha256: () => "a".repeat(64), randomStringWithAlphabet: () => "a" },
      $app: { dao: () => ({}) },
    });
    const check = module.exports.isConfiguredProviderApiKey;
    expect(check("")).toBe(false);
    expect(check("your-api-key-here")).toBe(false);
    expect(check("YOUR-API-KEY-HERE")).toBe(false);
    expect(check("changeme")).toBe(false);
    expect(check("replace-me")).toBe(false);
    // CI container boots with this synthetic value.
    expect(check("test-gemini-key")).toBe(true);
    expect(check("synthetic-provider-key-for-readiness")).toBe(true);
  });
});
