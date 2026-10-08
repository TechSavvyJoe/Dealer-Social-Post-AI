import { deploymentEnv, routes, type VercelConfig } from "@vercel/config/v1";

export const contentSecurityPolicy = [
  "default-src 'self'",
  // The sha256 allows exactly one inline script: the pre-paint theme snippet
  // in index.html. Its hash is pinned by __tests__/prePaintTheme.test.ts, so
  // editing the snippet without updating this value fails CI, not production.
  "script-src 'self' 'sha256-o+4kI1r0Dv6RDMKm3/VtsLMcE6aR+PGeatWcEpd9/uw=' 'wasm-unsafe-eval' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-src https://challenges.cloudflare.com",
  // `blob:` is required and is NOT implied by 'self'. Generated video arrives
  // as an object URL from URL.createObjectURL, and reading it back into a File
  // to share, export or save goes through fetch(), which connect-src governs.
  // Without it the clip still plays — media-src allows blob: — while every
  // share and export path fails with an opaque "Failed to fetch". The Fly
  // origin sends no CSP at all, so this only ever broke on the Vercel origin
  // users actually load.
  "connect-src 'self' blob: https://challenges.cloudflare.com https://vpic.nhtsa.dot.gov",
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
  {
    // "same-origin" is safe here: every window.open in the app passes
    // "noopener,noreferrer", and the YouTube OAuth hop is a noopener anchor
    // whose return path is a pasted one-time code, so no flow ever relies on
    // a cross-origin opener handle that COOP would sever.
    key: "Cross-Origin-Opener-Policy",
    value: "same-origin",
  },
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
    continuingHeaderRoute(
      "^/(?:dsp-brand-mark-v4(?:-app|-maskable|-micro|-monochrome)?\\.svg|dealer-social-(?:dsp|favicon)-v[45](?:-maskable)?-[0-9]+\\.png)$",
      [
        {
          key: "Cache-Control",
          value: "public, max-age=31536000, immutable",
        },
      ],
    ),
    continuingHeaderRoute("^/sw\\.js$", [
      {
        key: "Cache-Control",
        value: "no-cache, no-store, must-revalidate",
      },
    ]),
    continuingHeaderRoute("^/(.*)$", securityHeaders),
  ],
};
