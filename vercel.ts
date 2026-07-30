import { deploymentEnv, routes, type VercelConfig } from "@vercel/config/v1";

export const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-src https://challenges.cloudflare.com",
  "connect-src 'self' https://challenges.cloudflare.com https://vpic.nhtsa.dot.gov",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

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
  {
    key: "Content-Security-Policy",
    value: contentSecurityPolicy,
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

const continuingHeaderRoute = (
  src: string,
  headers: ReadonlyArray<{ key: string; value: string }>,
) => ({
  src,
  headers: Object.fromEntries(headers.map(({ key, value }) => [key, value])),
  continue: true,
});

export const config: VercelConfig = {
  framework: "vite",
  git: {
    // Production is promoted only after CI, Fly, canaries, and restore gates pass.
    deploymentEnabled: { main: false },
  },
  // The deployment-secret request transform requires Vercel's low-level
  // routes collection. Native route `headers` are the supported response form;
  // response-header transforms do not reliably apply to static Vite files.
  routes: [
    apiProxyRoute,
    continuingHeaderRoute("^/assets/(.*)$", [
      {
        key: "Cache-Control",
        value: "public, max-age=31536000, immutable",
      },
    ]),
    continuingHeaderRoute("^/sw\\.js$", [
      {
        key: "Cache-Control",
        value: "no-cache, no-store, must-revalidate",
      },
    ]),
    continuingHeaderRoute("^/(.*)$", securityHeaders),
  ],
};
