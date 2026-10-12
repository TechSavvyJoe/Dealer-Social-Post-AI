#!/usr/bin/env node
// Proves the canonical production origin actually serves the bundle that was
// built for the deployed release.
//
// The failure this exists to catch: a deploy step reports success, the Vercel
// deployment is genuinely READY, and `vercel promote` still leaves
// dealer-social-post-ai.vercel.app aliased to an older deployment. Users then
// keep loading a stale client while every pipeline light is green.
//
// Vite content-hashes every chunk, so byte-identity between the live chunk and
// the locally built chunk of the same name is a complete proof that the alias
// moved. Checking only the release SHA is weaker: a lazily loaded chunk such as
// geminiService-*.js can change while the entry chunk that carries the SHA is
// still byte-identical to a previous release's entry chunk.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CANONICAL_PRODUCTION_ORIGIN = "https://dealer-social-post-ai.vercel.app";
// The chunk whose staleness caused the 2026-08-07 incident. Requiring it by
// name keeps the assertion honest if the module graph is ever restructured so
// that this code stops being reachable from the entry chunk.
const REQUIRED_CHUNK_PREFIXES = ["geminiService-"];
const MAX_GRAPH_DEPTH = 6;
const REQUEST_TIMEOUT_MS = 20_000;
// A freshly moved alias is usually visible in under five seconds, but a slow
// CDN update must not fail a release that actually succeeded.
const DEFAULT_PROPAGATION_ATTEMPTS = 10;
const DEFAULT_PROPAGATION_DELAY_MS = 10_000;
// These root-level files are copied into both production artifacts without a
// Vite content hash. Their versioned names are therefore the cache key:
// proving the live bytes match the build prevents a stale alias/CDN response
// from silently mixing a new JavaScript graph with an older installed identity.
export const IDENTITY_ASSETS = [
  {
    path: "/dealer-social-og-v6.png",
    contentType: "image/png",
    immutable: true,
  },
  {
    path: "/manifest.webmanifest",
    contentType: "application/manifest+json",
    immutable: false,
  },
  {
    path: "/dealer-social-v6-symbol.svg",
    contentType: "image/svg+xml",
    immutable: true,
  },
  {
    path: "/dealer-social-v6-symbol-reverse.svg",
    contentType: "image/svg+xml",
    immutable: true,
  },
  {
    path: "/dealer-social-v6-symbol-black.svg",
    contentType: "image/svg+xml",
    immutable: true,
  },
  {
    path: "/dealer-social-v6-symbol-white.svg",
    contentType: "image/svg+xml",
    immutable: true,
  },
  {
    path: "/dealer-social-v6-app.svg",
    contentType: "image/svg+xml",
    immutable: true,
  },
  {
    path: "/dealer-social-v6-maskable.svg",
    contentType: "image/svg+xml",
    immutable: true,
  },
  {
    path: "/dealer-social-v6-horizontal.svg",
    contentType: "image/svg+xml",
    immutable: true,
  },
  {
    path: "/dealer-social-v6-horizontal-reverse.svg",
    contentType: "image/svg+xml",
    immutable: true,
  },
  {
    path: "/dealer-social-v6-horizontal-white.svg",
    contentType: "image/svg+xml",
    immutable: true,
  },
  { path: "/dealer-social-v6-180.png", contentType: "image/png", immutable: true },
  { path: "/dealer-social-v6-192.png", contentType: "image/png", immutable: true },
  { path: "/dealer-social-v6-512.png", contentType: "image/png", immutable: true },
  {
    path: "/dealer-social-v6-1024.png",
    contentType: "image/png",
    immutable: true,
  },
  {
    path: "/dealer-social-v6-maskable-192.png",
    contentType: "image/png",
    immutable: true,
  },
  {
    path: "/dealer-social-v6-maskable-512.png",
    contentType: "image/png",
    immutable: true,
  },
  {
    path: "/dealer-social-v6-maskable-1024.png",
    contentType: "image/png",
    immutable: true,
  },
  {
    path: "/dealer-social-v6-32.png",
    contentType: "image/png",
    immutable: true,
  },
];

const fail = (message) => {
  console.error(`Live bundle assertion failed: ${message}`);
  process.exit(1);
};

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export const isExactSha = (value) => /^[0-9a-f]{40}$/.test(value || "");

export const isDeploymentId = (value) => /^dpl_[A-Za-z0-9]+$/.test(value || "");

/**
 * Chunk file names Vite emits are `name-HASH.js`. Accepting only that shape
 * keeps path traversal and absolute URLs out of the graph walk.
 */
export const isChunkFileName = (value) =>
  /^[A-Za-z0-9_$.-]+-[A-Za-z0-9_-]{6,}\.js$/.test(value || "") && !value.includes("..");

/** Reads every emitted `assets/*.js` chunk and indexes it by file name. */
export const collectBuiltChunks = (staticDirectory) => {
  const assetsDirectory = join(staticDirectory, "assets");
  let entries;
  try {
    entries = readdirSync(assetsDirectory, { withFileTypes: true });
  } catch {
    throw new Error(`the built static directory has no assets/: ${assetsDirectory}`);
  }
  const chunks = new Map();
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
    const bytes = readFileSync(join(assetsDirectory, entry.name));
    chunks.set(entry.name, { bytes, digest: sha256(bytes) });
  }
  if (chunks.size === 0) {
    throw new Error(`the built static directory emitted no JavaScript chunks.`);
  }
  return chunks;
};

/** Extracts the module entry point the application shell actually loads. */
export const parseEntryScripts = (html) => {
  const scripts = Array.from(
    String(html).matchAll(/<script[^>]+src="([^"]+\.js)"/g),
    (match) => match[1],
  );
  const unique = [...new Set(scripts)];
  if (unique.length === 0) {
    throw new Error("the application shell referenced no JavaScript entry point.");
  }
  return unique;
};

/**
 * Collects the chunk file names a chunk imports. Vite emits relative
 * (`"./chunk-HASH.js"`) and preload-manifest (`"assets/chunk-HASH.js"`) forms;
 * both are reduced to a bare file name.
 */
export const extractChunkReferences = (source) => {
  const references = new Set();
  for (const match of String(source).matchAll(
    /["'`](?:\.{1,2}\/|\/)?(?:assets\/)?([A-Za-z0-9_$.-]+-[A-Za-z0-9_-]{6,}\.js)["'`]/g,
  )) {
    if (isChunkFileName(match[1])) references.add(match[1]);
  }
  return references;
};

const chunkFileNameFromPath = (scriptPath) => {
  const name = String(scriptPath).split("?")[0].split("#")[0].split("/").pop() || "";
  return isChunkFileName(name) ? name : null;
};

const createFetcher = (origin) => async (path) => {
  const requestedUrl = new URL(path, origin);
  if (requestedUrl.origin !== new URL(origin).origin) {
    throw new Error(`refused to follow ${path} off the asserted origin.`);
  }
  const response = await fetch(requestedUrl, {
    headers: { "cache-control": "no-cache", pragma: "no-cache" },
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${requestedUrl.pathname} returned HTTP ${response.status}.`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return { bytes, text: bytes.toString("utf8"), headers: response.headers };
};

const headerValue = (headers, name) => {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || "";
  const expected = name.toLowerCase();
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === expected);
  return entry ? String(entry[1] || "") : "";
};

/**
 * Byte-compares every current install/brand asset against the selected build.
 *
 * Unlike hashed Vite chunks these files live at root-level semantic paths, so
 * checking only that they return 200 would allow a stale Home Screen icon or
 * manifest to pass the same release gate as the correct JavaScript bundle.
 */
export const assertLiveIdentityMatchesBuild = async ({
  staticDirectory,
  fetchPath,
  assets = IDENTITY_ASSETS,
}) => {
  const verified = [];
  for (const asset of assets) {
    let builtBytes;
    try {
      builtBytes = readFileSync(join(staticDirectory, asset.path.slice(1)));
    } catch {
      throw new Error(`the built static directory is missing ${asset.path}.`);
    }

    const live = await fetchPath(asset.path);
    const liveDigest = sha256(live.bytes);
    const builtDigest = sha256(builtBytes);
    if (liveDigest !== builtDigest) {
      throw new Error(
        `${asset.path} served stale identity bytes (${liveDigest}), not this build (${builtDigest}).`,
      );
    }

    const contentType = headerValue(live.headers, "content-type").toLowerCase();
    if (!contentType.includes(asset.contentType)) {
      throw new Error(
        `${asset.path} returned content-type ${contentType || "<missing>"}, expected ${asset.contentType}.`,
      );
    }

    const cacheControl = headerValue(live.headers, "cache-control").toLowerCase();
    if (asset.immutable) {
      if (
        !cacheControl.includes("max-age=31536000") ||
        !cacheControl.includes("immutable")
      ) {
        throw new Error(
          `${asset.path} is versioned but not immutable (${cacheControl || "<missing>"}).`,
        );
      }
    } else if (cacheControl.includes("immutable")) {
      throw new Error(`${asset.path} must remain revalidated, not immutable.`);
    }

    verified.push({ path: asset.path, digest: builtDigest });
  }
  return verified;
};

/**
 * Walks the live module graph and byte-compares every chunk it reaches against
 * the chunk of the same name in the build output.
 *
 * `fetchPath` is injected so the walk is testable without a network.
 */
export const walkLiveGraph = async ({
  entryScripts,
  builtChunks,
  fetchPath,
  maxDepth = MAX_GRAPH_DEPTH,
}) => {
  const matched = new Set();
  const mismatched = [];
  const missingFromBuild = [];
  const seen = new Set();

  let frontier = [];
  for (const script of entryScripts) {
    const name = chunkFileNameFromPath(script);
    if (!name) throw new Error(`the shell referenced a non-chunk script: ${script}`);
    frontier.push(name);
  }

  for (let depth = 0; depth <= maxDepth && frontier.length > 0; depth += 1) {
    const next = [];
    for (const name of frontier) {
      if (seen.has(name)) continue;
      seen.add(name);

      const built = builtChunks.get(name);
      if (!built) {
        // The live origin serves a chunk name this build never emitted, which
        // is the signature of a stale alias.
        missingFromBuild.push(name);
        continue;
      }
      const { bytes, text } = await fetchPath(`/assets/${name}`);
      if (sha256(bytes) === built.digest) matched.add(name);
      else mismatched.push(name);

      for (const reference of extractChunkReferences(text)) {
        if (!seen.has(reference)) next.push(reference);
      }
    }
    frontier = next;
  }

  return { matched, mismatched, missingFromBuild, visited: seen };
};

/** Confirms the required chunks were reached and matched byte for byte. */
export const evaluateGraphResult = ({
  matched,
  mismatched,
  missingFromBuild,
  requiredPrefixes = REQUIRED_CHUNK_PREFIXES,
}) => {
  const problems = [];
  if (missingFromBuild.length > 0) {
    problems.push(
      `the live origin served chunks this build never emitted: ${missingFromBuild.join(", ")}`,
    );
  }
  if (mismatched.length > 0) {
    problems.push(`the live origin served stale bytes for: ${mismatched.join(", ")}`);
  }
  for (const prefix of requiredPrefixes) {
    if (![...matched].some((name) => name.startsWith(prefix))) {
      problems.push(
        `no live chunk matching ${prefix}*.js was reachable and verified against the build`,
      );
    }
  }
  return problems;
};

/**
 * Confirms the canonical host resolves to the deployment just released.
 *
 * This must be checked from the alias side. `vercel inspect <deployment>`
 * reports only the project-scoped `*-joes-projects-*.vercel.app` aliases and
 * omits dealer-social-post-ai.vercel.app even while that host resolves to the
 * very same deployment, so a deployment-side check silently passes on a stale
 * alias and silently fails on a healthy one.
 */
export const validateAliasResolution = (
  aliasRecord,
  { expectedDeploymentId, canonicalHost },
) => {
  const resolvedId = aliasRecord?.deploymentId || aliasRecord?.deployment?.id || "";
  if (!isDeploymentId(resolvedId)) {
    return `${canonicalHost} did not resolve to a Vercel deployment id.`;
  }
  if (aliasRecord?.alias && aliasRecord.alias !== canonicalHost) {
    return `resolved the wrong alias record: ${aliasRecord.alias}.`;
  }
  if (resolvedId !== expectedDeploymentId) {
    return (
      `${canonicalHost} still resolves to ${resolvedId}, not the deployment just ` +
      `released (${expectedDeploymentId}). The alias was not moved.`
    );
  }
  return null;
};

/** Reads the alias -> deployment mapping straight from the Vercel API. */
export const resolveCanonicalAlias = async ({
  host,
  teamId,
  token,
  attempts = 5,
  delayMs = 3000,
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
}) => {
  let lastError = "";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const url = new URL(
        `https://api.vercel.com/v4/aliases/${encodeURIComponent(host)}`,
      );
      if (teamId) url.searchParams.set("teamId", teamId);
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.ok) return await response.json();
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error?.message || String(error);
    }
    if (attempt < attempts) await sleep(delayMs);
  }
  throw new Error(`could not resolve ${host} from the Vercel API (${lastError}).`);
};

export const assertLiveBundleMatchesBuild = async ({
  origin,
  staticDirectory,
  releaseSha,
  fetchPath,
}) => {
  if (!isExactSha(releaseSha)) {
    throw new Error("a full 40-character lowercase release SHA is required.");
  }
  const fetchLivePath = fetchPath || createFetcher(origin);
  const builtChunks = collectBuiltChunks(staticDirectory);

  const { text: html } = await fetchLivePath("/");
  const entryScripts = parseEntryScripts(html);

  // A stale alias almost always shows up here first: the shell still points at
  // the previous release's content-hashed entry chunk.
  for (const script of entryScripts) {
    const name = chunkFileNameFromPath(script);
    if (!name || !builtChunks.has(name)) {
      throw new Error(
        `${origin} serves entry script ${script}, which this build did not emit. ` +
          `The canonical alias is still pointing at an older deployment.`,
      );
    }
  }

  const result = await walkLiveGraph({
    entryScripts,
    builtChunks,
    fetchPath: fetchLivePath,
  });
  const problems = evaluateGraphResult(result);
  if (problems.length > 0) {
    throw new Error(problems.join("; "));
  }

  // Belt and braces: the release SHA must also be present in the live graph,
  // matching the binding the service worker and health endpoint rely on.
  const carriesReleaseSha = [...result.matched].some((name) =>
    builtChunks.get(name).bytes.includes(releaseSha),
  );
  if (!carriesReleaseSha) {
    throw new Error(`no verified live chunk carries release ${releaseSha}.`);
  }

  const verifiedIdentity = await assertLiveIdentityMatchesBuild({
    staticDirectory,
    fetchPath: fetchLivePath,
  });

  return {
    origin,
    releaseSha,
    entryScripts,
    verifiedChunks: [...result.matched].sort(),
    requiredChunks: [...result.matched]
      .filter((name) => REQUIRED_CHUNK_PREFIXES.some((p) => name.startsWith(p)))
      .sort(),
    verifiedIdentityAssets: verifiedIdentity.map(({ path }) => path),
  };
};

/**
 * Retries the assertion while a freshly moved alias propagates.
 *
 * An alias that has genuinely not moved and one that is still propagating look
 * identical from outside — both serve the previous entry chunk — so this cannot
 * discriminate between them and deliberately does not try. It only bounds how
 * long a correct deploy is allowed to look wrong. Past the deadline the real
 * error is raised, so a genuinely stale alias still fails the release; it just
 * fails a minute later instead of instantly.
 */
export const assertLiveBundleWithPropagation = async ({
  origin,
  staticDirectory,
  releaseSha,
  attempts = DEFAULT_PROPAGATION_ATTEMPTS,
  delayMs = DEFAULT_PROPAGATION_DELAY_MS,
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  assertOnce = assertLiveBundleMatchesBuild,
  onRetry = (_attempt, _total, _error) => {},
}) => {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await assertOnce({ origin, staticDirectory, releaseSha });
    } catch (error) {
      lastError = error;
      // A malformed invocation will never come good by waiting.
      if (!isExactSha(releaseSha)) throw error;
      if (attempt < attempts) {
        onRetry(attempt, attempts, error);
        await sleep(delayMs);
      }
    }
  }
  const waited = Math.round(((attempts - 1) * delayMs) / 1000);
  throw new Error(
    `${origin} did not serve the deployed bundle within ${waited}s. ` +
      `Last failure: ${lastError?.message || String(lastError)}`,
  );
};

const positiveIntegerFromEnv = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const invokedAsScript =
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (invokedAsScript) {
  const [command] = process.argv.slice(2);
  try {
    if (command === "--assert-live-bundle") {
      const [origin, staticDirectory, releaseSha] = process.argv.slice(3);
      const summary = await assertLiveBundleWithPropagation({
        origin: origin || CANONICAL_PRODUCTION_ORIGIN,
        staticDirectory: resolve(
          staticDirectory ||
            join(dirnameOfThisFile(), "..", ".vercel", "output", "static"),
        ),
        releaseSha: releaseSha || "",
        attempts: positiveIntegerFromEnv(
          "LIVE_BUNDLE_ASSERT_ATTEMPTS",
          DEFAULT_PROPAGATION_ATTEMPTS,
        ),
        delayMs: positiveIntegerFromEnv(
          "LIVE_BUNDLE_ASSERT_DELAY_MS",
          DEFAULT_PROPAGATION_DELAY_MS,
        ),
        onRetry: (attempt, total, error) => {
          console.error(
            `Attempt ${attempt}/${total}: ${error?.message || error} — retrying.`,
          );
        },
      });
      console.log(JSON.stringify(summary, null, 2));
    } else if (command === "--assert-alias") {
      const [expectedDeploymentId, hostArgument] = process.argv.slice(3);
      const canonicalHost =
        hostArgument || new URL(CANONICAL_PRODUCTION_ORIGIN).hostname;
      const token = process.env.VERCEL_TOKEN || "";
      if (!token) fail("VERCEL_TOKEN is required to resolve the canonical alias.");
      if (!isDeploymentId(expectedDeploymentId)) {
        fail("a dpl_ deployment id is required.");
      }
      const aliasRecord = await resolveCanonicalAlias({
        host: canonicalHost,
        teamId: process.env.VERCEL_ORG_ID || "",
        token,
      });
      const problem = validateAliasResolution(aliasRecord, {
        expectedDeploymentId,
        canonicalHost,
      });
      if (problem) fail(problem);
      console.log(`${canonicalHost} resolves to ${expectedDeploymentId}.`);
    } else {
      console.error(
        "usage: scripts/vercel-live-bundle-assert.mjs " +
          "[--assert-live-bundle origin staticDir releaseSha " +
          "| --assert-alias deploymentId [host]]",
      );
      process.exit(1);
    }
  } catch (error) {
    fail(error?.message || String(error));
  }
}

function dirnameOfThisFile() {
  return resolve(fileURLToPath(import.meta.url), "..");
}

export { CANONICAL_PRODUCTION_ORIGIN, REQUIRED_CHUNK_PREFIXES };
