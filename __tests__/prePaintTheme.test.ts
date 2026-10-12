import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

/**
 * The pre-paint theme snippet is the only inline script the CSP allows, via a
 * sha256 source in vercel.ts. These assertions keep the three copies of that
 * contract (index.html, vercel.ts, and both staged-release gates) in lockstep:
 * editing the snippet without re-hashing fails here instead of shipping a
 * frontend whose theme script is silently blocked in production.
 */
describe("pre-paint theme script contract", () => {
  const html = read("index.html");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

  it("keeps exactly one plain inline script in index.html", () => {
    expect(scripts).toHaveLength(1);
  });

  it("allowlists the exact script hash in the Vercel CSP and the e2e pin", () => {
    const digest = createHash("sha256").update(scripts[0]).digest("base64");
    const source = `'sha256-${digest}'`;
    expect(read("vercel.ts")).toContain(`script-src 'self' ${source}`);
    expect(read("e2e/staged-release.spec.ts")).toContain(source);
    expect(read("scripts/vercel-staged-release.sh")).toContain(source);
  });

  it("reads the persisted session and only ever adds the light class", () => {
    const script = scripts[0];
    expect(script).toContain('localStorage.getItem("dealer-social-post-ai.session")');
    expect(script).toContain('classList.add("theme-light")');
    // Fail-open to dark: no class removal, no writes back to storage.
    expect(script).not.toContain("classList.remove");
    expect(script).not.toContain("localStorage.setItem");
  });
});
