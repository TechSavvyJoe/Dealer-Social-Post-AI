import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../vercel.ts", import.meta.url), "utf8");

const requiredPatterns = [
  /deploymentEnabled:\s*{\s*main:\s*false\s*}/,
  /deploymentEnv\(["']VERCEL_TO_FLY_PROXY_SECRET["']\)/,
  /["']x-dealer-proxy-secret["']/,
  /["']https:\/\/dealer-social-post-ai-production\.fly\.dev\/api\/\$1["']/,
  /apiProxyRoute/,
  /continuingHeaderRoute\(["']\^\/assets\/\(\.\*\)\$["']/,
  /continuingHeaderRoute\(["']\^\/sw\\\\\.js\$["']/,
  /continuingHeaderRoute\(["']\^\/\(\.\*\)\$["'],\s*securityHeaders\)/,
];

for (const pattern of requiredPatterns) {
  if (!pattern.test(source)) {
    throw new Error(`Vercel release contract is missing: ${pattern}`);
  }
}

if (/x-dealer-proxy-secret['"]?\s*:\s*['"][^$]/i.test(source)) {
  throw new Error("The Vercel-to-Fly proxy secret must never be hard-coded.");
}

const { config } = await import(new URL("../vercel.ts", import.meta.url));
if (!Array.isArray(config.routes) || config.routes.length !== 4) {
  throw new Error("Vercel config must compile the proxy and three header routes.");
}
if ("rewrites" in config || "headers" in config || "redirects" in config) {
  throw new Error(
    "A transformed API proxy must not mix low-level routes with project-level routing.",
  );
}
if (config.git?.deploymentEnabled?.main !== false) {
  throw new Error("Independent main-branch production deployment must stay disabled.");
}

const apiRoute = config.routes.find(
  (route) =>
    route && route.dest === "https://dealer-social-post-ai-production.fly.dev/api/$1",
);
if (apiRoute?.src !== "^\\/api(?:\\/(.*))$") {
  throw new Error("The trusted API rewrite must match only /api paths.");
}
const proxySecretTransform = apiRoute?.transforms?.find(
  (transform) => transform?.target?.key === "x-dealer-proxy-secret",
);
if (
  proxySecretTransform?.type !== "request.headers" ||
  proxySecretTransform?.args !== "$VERCEL_TO_FLY_PROXY_SECRET" ||
  !proxySecretTransform.env?.includes("VERCEL_TO_FLY_PROXY_SECRET")
) {
  throw new Error("Compiled API route is missing the deployment-secret transform.");
}

const headerMap = (rule) =>
  new Map(
    Object.entries(rule?.headers || {}).map(([key, value]) => [
      key.toLowerCase(),
      value,
    ]),
  );
const headerRule = (src) => config.routes.find((route) => route?.src === src);

const assetRoute = headerRule("^/assets/(.*)$");
const assetHeaders = headerMap(assetRoute);
if (assetHeaders.get("cache-control") !== "public, max-age=31536000, immutable") {
  throw new Error("Hashed Vite assets must receive one-year immutable caching.");
}

const workerRoute = headerRule("^/sw\\.js$");
const workerHeaders = headerMap(workerRoute);
if (workerHeaders.get("cache-control") !== "no-cache, no-store, must-revalidate") {
  throw new Error("The service worker must always be revalidated.");
}

const securityRoute = headerRule("^/(.*)$");
const globalHeaders = headerMap(securityRoute);
const requiredSecurityHeaders = new Map([
  ["strict-transport-security", "max-age=63072000; includeSubDomains; preload"],
  ["x-content-type-options", "nosniff"],
  ["x-frame-options", "DENY"],
  ["referrer-policy", "strict-origin-when-cross-origin"],
  [
    "permissions-policy",
    "camera=(self), microphone=(self), geolocation=(), payment=(), usb=()",
  ],
]);
for (const [key, value] of requiredSecurityHeaders) {
  if (globalHeaders.get(key) !== value) {
    throw new Error(`Global security header is missing or invalid: ${key}`);
  }
}
for (const route of [assetRoute, workerRoute, securityRoute]) {
  if (route?.continue !== true || Array.isArray(route?.transforms)) {
    throw new Error(
      "Static response headers must use native continuing route headers, not transforms.",
    );
  }
}

const apiResponseTransforms = new Map(
  (apiRoute?.transforms || [])
    .filter((transform) => transform?.type === "response.headers")
    .map((transform) => [transform.target?.key?.toLowerCase(), transform.args]),
);
for (const [key, value] of requiredSecurityHeaders) {
  if (apiResponseTransforms.get(key) !== value) {
    throw new Error(`Proxied API security header is missing or invalid: ${key}`);
  }
}

console.log("Vercel staged-release and trusted-proxy contract verified.");
