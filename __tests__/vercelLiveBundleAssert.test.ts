import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertLiveBundleMatchesBuild,
  assertLiveBundleWithPropagation,
  assertLiveIdentityMatchesBuild,
  collectBuiltChunks,
  evaluateGraphResult,
  extractChunkReferences,
  isChunkFileName,
  parseEntryScripts,
  resolveCanonicalAlias,
  sha256,
  V4_IDENTITY_ASSETS,
  validateAliasResolution,
  walkLiveGraph,
} from "../scripts/vercel-live-bundle-assert.mjs";

const RELEASE_SHA = "a".repeat(40);
const CANONICAL_HOST = "dealer-social-post-ai.vercel.app";
const temporaryDirectories: string[] = [];

/**
 * Builds a throwaway static directory shaped like `.vercel/output/static`:
 * an entry chunk that imports a geminiService chunk, plus the shell.
 */
const buildStaticFixture = (
  overrides: { entry?: string; gemini?: string; entrySource?: string } = {},
) => {
  const directory = mkdtempSync(join(tmpdir(), "dsp-live-bundle-"));
  temporaryDirectories.push(directory);
  const entry = overrides.entry ?? "index-D3iON-aV.js";
  const gemini = overrides.gemini ?? "geminiService-Cx1TuEkG.js";
  mkdirSync(join(directory, "assets"), { recursive: true });
  const entrySource =
    overrides.entrySource ??
    `const s="${RELEASE_SHA}";import("./${gemini}");export{s};`;
  writeFileSync(join(directory, "assets", entry), entrySource);
  writeFileSync(join(directory, "assets", gemini), `export const caption=()=>1;`);
  writeFileSync(
    join(directory, "index.html"),
    `<!doctype html><html><head><script type="module" crossorigin src="/assets/${entry}"></script></head><body></body></html>`,
  );
  for (const asset of V4_IDENTITY_ASSETS) {
    const bytes =
      asset.path === "/manifest.webmanifest"
        ? Buffer.from('{"name":"Dealer Social Post AI","icons":[]}')
        : asset.contentType === "image/png"
          ? Buffer.concat([
              Buffer.from("89504e470d0a1a0a", "hex"),
              Buffer.from(`fixture:${asset.path}`),
            ])
          : Buffer.from(
              `<svg xmlns="http://www.w3.org/2000/svg"><title>${asset.path}</title></svg>`,
            );
    writeFileSync(join(directory, asset.path.slice(1)), bytes);
  }
  return { directory, entry, gemini, entrySource };
};

/** Serves a static fixture over the injected fetch seam. */
const serveFixture = (fixture: ReturnType<typeof buildStaticFixture>) => {
  const files = new Map<string, Buffer>([
    [
      "/",
      Buffer.from(
        `<!doctype html><html><head><script type="module" crossorigin src="/assets/${fixture.entry}"></script></head><body></body></html>`,
      ),
    ],
    [`/assets/${fixture.entry}`, Buffer.from(fixture.entrySource)],
    [`/assets/${fixture.gemini}`, Buffer.from(`export const caption=()=>1;`)],
  ]);
  for (const asset of V4_IDENTITY_ASSETS) {
    files.set(asset.path, readFileSync(join(fixture.directory, asset.path.slice(1))));
  }
  return async (path: string) => {
    const body = files.get(path);
    if (body === undefined) throw new Error(`${path} returned HTTP 404.`);
    const identity = V4_IDENTITY_ASSETS.find((asset) => asset.path === path);
    return {
      bytes: body,
      text: body.toString("utf8"),
      headers: identity
        ? {
            "content-type": identity.contentType,
            "cache-control": identity.immutable
              ? "public, max-age=31536000, immutable"
              : "public, max-age=0, must-revalidate",
          }
        : {},
    };
  };
};

afterEach(() => {
  while (temporaryDirectories.length) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

describe("built chunk collection", () => {
  it("indexes every emitted JavaScript chunk by name and digest", () => {
    const fixture = buildStaticFixture();
    const chunks = collectBuiltChunks(fixture.directory);
    expect([...chunks.keys()].sort()).toEqual([fixture.entry, fixture.gemini].sort());
    expect(chunks.get(fixture.gemini)!.digest).toBe(
      sha256(Buffer.from("export const caption=()=>1;")),
    );
  });

  it("refuses a directory that emitted no chunks", () => {
    const directory = mkdtempSync(join(tmpdir(), "dsp-empty-"));
    temporaryDirectories.push(directory);
    mkdirSync(join(directory, "assets"), { recursive: true });
    expect(() => collectBuiltChunks(directory)).toThrow(/no JavaScript chunks/);
    expect(() => collectBuiltChunks(join(directory, "missing"))).toThrow(/no assets/);
  });
});

describe("module graph parsing", () => {
  it("reads the entry point out of the application shell", () => {
    expect(
      parseEntryScripts(
        `<script type="module" crossorigin src="/assets/index-D3iON-aV.js"></script>`,
      ),
    ).toEqual(["/assets/index-D3iON-aV.js"]);
    expect(() => parseEntryScripts("<html></html>")).toThrow(/no JavaScript entry/);
  });

  it("collects relative and preload-manifest chunk references", () => {
    const references = extractChunkReferences(
      `import("./geminiService-Cx1TuEkG.js");"assets/vendor-DkOvrxcr.js";'/assets/ui-DpWxPK4c.js'`,
    );
    expect([...references].sort()).toEqual([
      "geminiService-Cx1TuEkG.js",
      "ui-DpWxPK4c.js",
      "vendor-DkOvrxcr.js",
    ]);
  });

  it("rejects traversal and non-chunk names", () => {
    expect(isChunkFileName("geminiService-Cx1TuEkG.js")).toBe(true);
    expect(isChunkFileName("../../etc/passwd-AAAAAAAA.js")).toBe(false);
    expect(isChunkFileName("sw.js")).toBe(false);
    expect(isChunkFileName("")).toBe(false);
  });
});

describe("live graph walk", () => {
  it("matches every reachable chunk when the alias serves the new build", async () => {
    const fixture = buildStaticFixture();
    const result = await walkLiveGraph({
      entryScripts: [`/assets/${fixture.entry}`],
      builtChunks: collectBuiltChunks(fixture.directory),
      fetchPath: serveFixture(fixture),
    });
    expect([...result.matched].sort()).toEqual([fixture.entry, fixture.gemini].sort());
    expect(result.mismatched).toEqual([]);
    expect(result.missingFromBuild).toEqual([]);
    expect(evaluateGraphResult(result)).toEqual([]);
  });

  it("flags a live chunk whose bytes differ from the build", async () => {
    const fixture = buildStaticFixture();
    const serve = serveFixture(fixture);
    const result = await walkLiveGraph({
      entryScripts: [`/assets/${fixture.entry}`],
      builtChunks: collectBuiltChunks(fixture.directory),
      fetchPath: async (path: string) => {
        if (path === `/assets/${fixture.gemini}`) {
          const bytes = Buffer.from("export const caption=()=>2;");
          return { bytes, text: bytes.toString() };
        }
        return serve(path);
      },
    });
    expect(result.mismatched).toEqual([fixture.gemini]);
    expect(evaluateGraphResult(result).join(" ")).toMatch(/stale bytes/);
  });

  it("flags a chunk name this build never emitted", async () => {
    const fixture = buildStaticFixture();
    const result = await walkLiveGraph({
      entryScripts: [`/assets/${fixture.entry}`],
      builtChunks: collectBuiltChunks(fixture.directory),
      fetchPath: async (path: string) => {
        if (path === `/assets/${fixture.entry}`) {
          const body = `import("./geminiService-STALE001.js");`;
          return { bytes: Buffer.from(body), text: body };
        }
        return serveFixture(fixture)(path);
      },
    });
    expect(result.missingFromBuild).toEqual(["geminiService-STALE001.js"]);
    expect(evaluateGraphResult(result).join(" ")).toMatch(/never emitted/);
  });

  it("fails when the required geminiService chunk is unreachable", () => {
    expect(
      evaluateGraphResult({
        matched: new Set(["index-D3iON-aV.js"]),
        mismatched: [],
        missingFromBuild: [],
      }).join(" "),
    ).toMatch(/geminiService-\*\.js was reachable/);
  });
});

describe("end-to-end live bundle assertion", () => {
  it("passes when the origin serves exactly the built graph", async () => {
    const fixture = buildStaticFixture();
    const summary = await assertLiveBundleMatchesBuild({
      origin: `https://${CANONICAL_HOST}`,
      staticDirectory: fixture.directory,
      releaseSha: RELEASE_SHA,
      fetchPath: serveFixture(fixture),
    });
    expect(summary.requiredChunks).toEqual([fixture.gemini]);
    expect(summary.verifiedChunks).toContain(fixture.entry);
    expect(summary.verifiedIdentityAssets).toEqual(
      V4_IDENTITY_ASSETS.map(({ path }) => path),
    );
  });

  it("fails fast when the alias still serves a previous entry chunk", async () => {
    const current = buildStaticFixture({
      entry: "index-NEW00001.js",
      gemini: "geminiService-NEW00001.js",
    });
    const previous = buildStaticFixture({
      entry: "index-OLD00001.js",
      gemini: "geminiService-OLD00001.js",
    });
    await expect(
      assertLiveBundleMatchesBuild({
        origin: `https://${CANONICAL_HOST}`,
        staticDirectory: current.directory,
        releaseSha: RELEASE_SHA,
        fetchPath: serveFixture(previous),
      }),
    ).rejects.toThrow(/pointing at an older deployment/);
  });

  it("fails when no verified chunk carries the release SHA", async () => {
    const fixture = buildStaticFixture({
      entrySource: `import("./geminiService-Cx1TuEkG.js");`,
    });
    await expect(
      assertLiveBundleMatchesBuild({
        origin: `https://${CANONICAL_HOST}`,
        staticDirectory: fixture.directory,
        releaseSha: RELEASE_SHA,
        fetchPath: serveFixture(fixture),
      }),
    ).rejects.toThrow(/carries release/);
  });

  it("requires a full release SHA", async () => {
    const fixture = buildStaticFixture();
    await expect(
      assertLiveBundleMatchesBuild({
        origin: `https://${CANONICAL_HOST}`,
        staticDirectory: fixture.directory,
        releaseSha: "abc123",
        fetchPath: serveFixture(fixture),
      }),
    ).rejects.toThrow(/40-character/);
  });
});

describe("v4 identity byte integrity", () => {
  it("matches every live v4 identity file to the selected build", async () => {
    const fixture = buildStaticFixture();
    const verified = await assertLiveIdentityMatchesBuild({
      staticDirectory: fixture.directory,
      fetchPath: serveFixture(fixture),
    });

    expect(verified.map(({ path }) => path)).toEqual(
      V4_IDENTITY_ASSETS.map(({ path }) => path),
    );
    expect(verified.every(({ digest }) => /^[0-9a-f]{64}$/.test(digest))).toBe(true);
  });

  it("rejects stale live icon bytes even when the JavaScript graph matches", async () => {
    const fixture = buildStaticFixture();
    const serve = serveFixture(fixture);
    await expect(
      assertLiveBundleMatchesBuild({
        origin: `https://${CANONICAL_HOST}`,
        staticDirectory: fixture.directory,
        releaseSha: RELEASE_SHA,
        fetchPath: async (path: string) => {
          const result = await serve(path);
          if (path !== "/dealer-social-dsp-v4-512.png") return result;
          const bytes = Buffer.from("stale-icon-bytes");
          return { ...result, bytes, text: bytes.toString("utf8") };
        },
      }),
    ).rejects.toThrow(/dealer-social-dsp-v4-512\.png served stale identity bytes/);
  });

  it("requires v4 identity content types and immutable caching", async () => {
    const fixture = buildStaticFixture();
    const serve = serveFixture(fixture);
    await expect(
      assertLiveIdentityMatchesBuild({
        staticDirectory: fixture.directory,
        assets: [
          {
            path: "/dsp-brand-mark-v4.svg",
            contentType: "image/svg+xml",
            immutable: true,
          },
        ],
        fetchPath: async (path: string) => {
          const result = await serve(path);
          return {
            ...result,
            headers: { "content-type": "text/plain", "cache-control": "no-cache" },
          };
        },
      }),
    ).rejects.toThrow(/returned content-type text\/plain/);

    await expect(
      assertLiveIdentityMatchesBuild({
        staticDirectory: fixture.directory,
        assets: [
          {
            path: "/dealer-social-dsp-v4-192.png",
            contentType: "image/png",
            immutable: true,
          },
        ],
        fetchPath: async (path: string) => {
          const result = await serve(path);
          return {
            ...result,
            headers: { "content-type": "image/png", "cache-control": "no-cache" },
          };
        },
      }),
    ).rejects.toThrow(/versioned but not immutable/);
  });
});

/** A complete assertion summary, matching what a real pass returns. */
const passingSummary = () => ({
  origin: `https://${CANONICAL_HOST}`,
  releaseSha: RELEASE_SHA,
  entryScripts: ["/assets/index-NEW00001.js"],
  verifiedChunks: ["geminiService-NEW00001.js", "index-NEW00001.js"],
  requiredChunks: ["geminiService-NEW00001.js"],
  verifiedIdentityAssets: V4_IDENTITY_ASSETS.map(({ path }) => path),
});

describe("alias propagation tolerance", () => {
  it("succeeds once a slow alias update becomes visible", async () => {
    let calls = 0;
    const summary = await assertLiveBundleWithPropagation({
      origin: `https://${CANONICAL_HOST}`,
      staticDirectory: "/unused",
      releaseSha: RELEASE_SHA,
      delayMs: 0,
      sleep: async () => {},
      assertOnce: async () => {
        calls += 1;
        if (calls < 3) {
          throw new Error(
            "The canonical alias is still pointing at an older deployment.",
          );
        }
        return passingSummary();
      },
    });
    expect(calls).toBe(3);
    expect(summary.origin).toBe(`https://${CANONICAL_HOST}`);
  });

  it("still fails a genuinely stale alias, surfacing the real error", async () => {
    let calls = 0;
    await expect(
      assertLiveBundleWithPropagation({
        origin: `https://${CANONICAL_HOST}`,
        staticDirectory: "/unused",
        releaseSha: RELEASE_SHA,
        attempts: 4,
        delayMs: 0,
        sleep: async () => {},
        assertOnce: async () => {
          calls += 1;
          throw new Error("serves entry script /assets/index-OLD.js");
        },
      }),
    ).rejects.toThrow(/did not serve the deployed bundle within .*index-OLD\.js/s);
    expect(calls).toBe(4);
  });

  it("does not waste retries on a malformed release SHA", async () => {
    let calls = 0;
    await expect(
      assertLiveBundleWithPropagation({
        origin: `https://${CANONICAL_HOST}`,
        staticDirectory: "/unused",
        releaseSha: "not-a-sha",
        delayMs: 0,
        sleep: async () => {},
        assertOnce: async () => {
          calls += 1;
          throw new Error("a full 40-character lowercase release SHA is required.");
        },
      }),
    ).rejects.toThrow(/40-character/);
    expect(calls).toBe(1);
  });

  it("reports progress so a slow release is visible in CI logs", async () => {
    const seen: number[] = [];
    let calls = 0;
    await assertLiveBundleWithPropagation({
      origin: `https://${CANONICAL_HOST}`,
      staticDirectory: "/unused",
      releaseSha: RELEASE_SHA,
      delayMs: 0,
      sleep: async () => {},
      onRetry: (attempt: number) => {
        seen.push(attempt);
      },
      assertOnce: async () => {
        calls += 1;
        if (calls < 3) throw new Error("not yet");
        return passingSummary();
      },
    });
    expect(seen).toEqual([1, 2]);
  });
});

describe("canonical alias resolution", () => {
  it("accepts the alias record for the deployment just released", () => {
    expect(
      validateAliasResolution(
        { alias: CANONICAL_HOST, deploymentId: "dpl_New123" },
        { expectedDeploymentId: "dpl_New123", canonicalHost: CANONICAL_HOST },
      ),
    ).toBeNull();
  });

  it("rejects an alias still pointing at the previous deployment", () => {
    expect(
      validateAliasResolution(
        { alias: CANONICAL_HOST, deploymentId: "dpl_Old123" },
        { expectedDeploymentId: "dpl_New123", canonicalHost: CANONICAL_HOST },
      ),
    ).toMatch(/was not moved/);
  });

  it("rejects malformed and mismatched alias records", () => {
    expect(
      validateAliasResolution(
        { alias: CANONICAL_HOST, deploymentId: "not-a-deployment" },
        { expectedDeploymentId: "dpl_New123", canonicalHost: CANONICAL_HOST },
      ),
    ).toMatch(/did not resolve/);
    expect(
      validateAliasResolution(
        { alias: "some-other-host.vercel.app", deploymentId: "dpl_New123" },
        { expectedDeploymentId: "dpl_New123", canonicalHost: CANONICAL_HOST },
      ),
    ).toMatch(/wrong alias record/);
    expect(
      validateAliasResolution(undefined, {
        expectedDeploymentId: "dpl_New123",
        canonicalHost: CANONICAL_HOST,
      }),
    ).toMatch(/did not resolve/);
  });

  it("retries a flaky alias lookup before giving up", async () => {
    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls < 3) throw new Error("ECONNRESET");
      return {
        ok: true,
        json: async () => ({ alias: CANONICAL_HOST, deploymentId: "dpl_New123" }),
      };
    }) as unknown as typeof fetch;
    try {
      const record = await resolveCanonicalAlias({
        host: CANONICAL_HOST,
        teamId: "team_Example",
        token: "test-token",
        delayMs: 0,
        sleep: async () => {},
      });
      expect(record.deploymentId).toBe("dpl_New123");
      expect(calls).toBe(3);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("gives up with a clear message after exhausting attempts", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: false,
      status: 404,
    })) as unknown as typeof fetch;
    try {
      await expect(
        resolveCanonicalAlias({
          host: CANONICAL_HOST,
          teamId: "team_Example",
          token: "test-token",
          attempts: 2,
          delayMs: 0,
          sleep: async () => {},
        }),
      ).rejects.toThrow(/HTTP 404/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
