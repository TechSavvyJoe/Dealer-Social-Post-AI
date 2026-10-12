import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../vercel.ts", import.meta.url), "utf8");

const requiredPatterns = [
  /deploymentEnabled:\s*{\s*main:\s*false\s*}/,
  /deploymentEnv\(["']VERCEL_TO_FLY_PROXY_SECRET["']\)/,
  /["']x-dealer-proxy-secret["']/,
  /["']https:\/\/dealer-social-post-ai-production\.fly\.dev\/api\/\$1["']/,
  /apiProxyRoute/,
  /continuingHeaderRoute\(["']\^\/assets\/\(\.\*\)\$["']/,
  /dealer-social-v6-/,
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

const { config, contentSecurityPolicy } = await import(
  new URL("../vercel.ts", import.meta.url)
);
if (!Array.isArray(config.routes) || config.routes.length !== 6) {
  throw new Error(
    "Vercel config must compile the proxy, invitation shell, and four header routes.",
  );
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

const identityRoute = config.routes.find((route) =>
  String(route?.src || "").includes("dealer-social-v6-"),
);
const identityHeaders = headerMap(identityRoute);
if (identityHeaders.get("cache-control") !== "public, max-age=31536000, immutable") {
  throw new Error("Versioned v6 identity assets must receive immutable caching.");
}
const identityPathPattern = new RegExp(identityRoute.src);
for (const path of [
  "/dealer-social-og-v6.png",
  "/dealer-social-v6-32.png",
  "/dealer-social-v6-180.png",
  "/dealer-social-v6-192.png",
  "/dealer-social-v6-512.png",
  "/dealer-social-v6-1024.png",
  "/dealer-social-v6-maskable-192.png",
  "/dealer-social-v6-maskable-512.png",
  "/dealer-social-v6-maskable-1024.png",
  "/dealer-social-v6-symbol.svg",
  "/dealer-social-v6-symbol-reverse.svg",
  "/dealer-social-v6-symbol-black.svg",
  "/dealer-social-v6-symbol-white.svg",
  "/dealer-social-v6-app.svg",
  "/dealer-social-v6-maskable.svg",
  "/dealer-social-v6-horizontal.svg",
  "/dealer-social-v6-horizontal-reverse.svg",
  "/dealer-social-v6-horizontal-white.svg",
  "/dsp-brand-mark-v4.svg",
  "/dsp-brand-mark-v4-app.svg",
  "/dsp-brand-mark-v4-micro.svg",
  "/dsp-brand-mark-v4-maskable.svg",
  "/dsp-brand-mark-v4-monochrome.svg",
  "/dealer-social-dsp-v5-180.png",
  "/dealer-social-dsp-v5-192.png",
  "/dealer-social-dsp-v5-512.png",
  "/dealer-social-dsp-v5-1024.png",
  "/dealer-social-dsp-v5-maskable-192.png",
  "/dealer-social-dsp-v5-maskable-512.png",
  "/dealer-social-dsp-v5-maskable-1024.png",
  "/dealer-social-favicon-v4-16.png",
  "/dealer-social-favicon-v4-32.png",
  "/dealer-social-favicon-v4-48.png",
]) {
  if (!identityPathPattern.test(path)) {
    throw new Error(`Immutable identity route does not cover ${path}.`);
  }
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
  ["content-security-policy", contentSecurityPolicy],
]);
for (const [key, value] of requiredSecurityHeaders) {
  if (globalHeaders.get(key) !== value) {
    throw new Error(`Global security header is missing or invalid: ${key}`);
  }
}

const cspDirectives = new Map(
  String(globalHeaders.get("content-security-policy"))
    .split(";")
    .map((directive) => directive.trim().split(/\s+/))
    .filter(([name]) => Boolean(name))
    .map(([name, ...values]) => [name, values]),
);
for (const directive of ["script-src", "frame-src", "connect-src"]) {
  if (!cspDirectives.get(directive)?.includes("https://challenges.cloudflare.com")) {
    throw new Error(`Production CSP blocks Turnstile in ${directive}.`);
  }
}
// Generated video is handed around as a blob: object URL. Sharing, exporting
// and saving all read it back with fetch(), which connect-src governs, and
// 'self' does not cover the blob: scheme. Losing this silently breaks every
// share and export path while the clip still plays, because media-src allows
// blob: independently.
for (const directive of ["connect-src", "media-src", "img-src"]) {
  if (!cspDirectives.get(directive)?.includes("blob:")) {
    throw new Error(
      `Production CSP must allow blob: in ${directive}; media sharing and export read object URLs.`,
    );
  }
}
if (cspDirectives.get("script-src")?.includes("https:")) {
  throw new Error("Production CSP must not allow arbitrary HTTPS scripts.");
}
if (cspDirectives.get("script-src")?.includes("blob:")) {
  throw new Error("Production CSP must not allow blob: scripts.");
}
if (cspDirectives.get("frame-src")?.includes("https:")) {
  throw new Error("Production CSP must not allow arbitrary HTTPS frames.");
}
if (
  cspDirectives.get("object-src")?.join(" ") !== "'none'" ||
  cspDirectives.get("frame-ancestors")?.join(" ") !== "'none'"
) {
  throw new Error("Production CSP must deny plugins and framing.");
}
for (const route of [assetRoute, identityRoute, workerRoute, securityRoute]) {
  if (route?.continue !== true || Array.isArray(route?.transforms)) {
    throw new Error(
      "Static response headers must use native continuing route headers, not transforms.",
    );
  }
}

const invitationRoute = headerRule("^/join$");
if (invitationRoute?.dest !== "/index.html" || invitationRoute?.continue) {
  throw new Error("Private invitation direct navigation must serve the app shell.");
}
for (const [key, value] of requiredSecurityHeaders) {
  if (headerMap(invitationRoute).get(key) !== value) {
    throw new Error(`Invitation shell security header is missing: ${key}`);
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
