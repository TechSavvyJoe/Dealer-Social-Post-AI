import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../vercel.ts", import.meta.url), "utf8");

const requiredPatterns = [
  /deploymentEnabled:\s*{\s*main:\s*false\s*}/,
  /deploymentEnv\(["']VERCEL_TO_FLY_PROXY_SECRET["']\)/,
  /["']x-dealer-proxy-secret["']/,
  /["']https:\/\/dealer-social-post-ai-production\.fly\.dev\/api\/\$1["']/,
  /apiProxyRoute/,
  /responseHeaderRoute\(["']\^\/\(\.\*\)\$["'],\s*securityHeaders\)/,
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
if (!Array.isArray(config.routes) || config.routes.length < 4) {
  throw new Error("Vercel config must compile all transforms into routes.");
}
if ("rewrites" in config || "headers" in config) {
  throw new Error("Vercel transforms cannot be mixed with rewrites or headers.");
}
if (config.git?.deploymentEnabled?.main !== false) {
  throw new Error("Independent main-branch production deployment must stay disabled.");
}

const apiRoute = config.routes.find(
  (route) =>
    route && route.dest === "https://dealer-social-post-ai-production.fly.dev/api/$1",
);
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
const responseOnlyRoutes = config.routes.filter(
  (route) => route && !route.dest && Array.isArray(route.transforms),
);
if (
  responseOnlyRoutes.length < 3 ||
  responseOnlyRoutes.some((route) => route.continue !== true)
) {
  throw new Error("Response-header routes must continue to the Vite filesystem.");
}

console.log("Vercel staged-release and trusted-proxy contract verified.");
