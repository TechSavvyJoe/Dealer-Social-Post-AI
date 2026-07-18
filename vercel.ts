import { deploymentEnv, routes, type VercelConfig } from "@vercel/config/v1";

const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(self), geolocation=(), payment=(), usb=()",
  },
];

const securityHeaderRecord = Object.fromEntries(
  securityHeaders.map(({ key, value }) => [key, value]),
);

const apiProxyRoute = routes.rewrite(
  "/api/(.*)",
  "https://dealer-social-post-ai-production.fly.dev/api/$1",
  {
    requestHeaders: {
      // This authenticates Vercel's client-IP forwarding to the Fly origin.
      // Vercel substitutes the secret at deployment; it is never bundled.
      "x-dealer-proxy-secret": deploymentEnv("VERCEL_TO_FLY_PROXY_SECRET"),
    },
    responseHeaders: securityHeaderRecord,
  },
);

const responseHeaderRoute = (
  src: string,
  headers: ReadonlyArray<{ key: string; value: string }>,
) => ({
  src,
  continue: true,
  transforms: headers.map(({ key, value }) => ({
    type: "response.headers" as const,
    op: "set" as const,
    target: { key },
    args: value,
  })),
});

export const config: VercelConfig = {
  framework: "vite",
  git: {
    // Production is promoted only after CI, Fly, canaries, and restore gates pass.
    deploymentEnabled: { main: false },
  },
  // Request-header transforms use Vercel's lower-level routes format, so all
  // response-header rules live in that same array (the formats cannot mix).
  routes: [
    apiProxyRoute,
    responseHeaderRoute("^/assets/(.*)$", [
      {
        key: "Cache-Control",
        value: "public, max-age=31536000, immutable",
      },
    ]),
    responseHeaderRoute("^/sw\\.js$", [
      {
        key: "Cache-Control",
        value: "no-cache, no-store, must-revalidate",
      },
    ]),
    responseHeaderRoute("^/(.*)$", securityHeaders),
  ],
};
