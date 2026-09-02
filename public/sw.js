/**
 * Dealer Social Post AI service worker.
 *
 * Network-first for everything (because AI responses can't be cached safely
 * and the app shell is small enough that revalidate-on-fetch is fine), with
 * cache-first for immutable content-hashed /assets/ files and a
 * stale-while-revalidate cache for other static assets so the
 * install-to-homescreen experience boots fast on slow LTE.
 *
 * Critical: we never cache `/api/*` endpoints. Those carry session cookies,
 * proxy tokens, and credential responses; caching them would be a security bug.
 */
const VERSION = "dsp-v2026.05.27";
const STATIC_CACHE = `${VERSION}-static`;

const APP_SHELL = ["/", "/index.html", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    // Keep the prior worker active if the core offline shell cannot be cached.
    // Silently activating a worker without index.html would advertise offline
    // support while leaving installed users with a blank navigation failure.
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(APP_SHELL)),
    // Don't auto-skipWaiting; let the client prompt the user. The user's
    // "tap to refresh" banner posts SKIP_WAITING below.
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never touch API traffic.
  if (url.pathname.startsWith("/api/")) return;

  // Cross-origin: let the browser handle it; the importmap CDN does its own caching.
  if (url.origin !== self.location.origin) return;

  // For navigations, prefer network; fall back to cached shell when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Only cache good responses; a cached error page would replace the
          // offline app shell for every future offline navigation.
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches
            .match("/index.html")
            .then((cachedIndex) => cachedIndex || caches.match("/")),
        ),
    );
    return;
  }

  // Install metadata must not be served stale. Versioned icon URLs keep the
  // pixels immutable, while the stable manifest URL must describe the newest
  // icon set before a user adds the app to their Home Screen.
  if (url.pathname === "/manifest.webmanifest") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req)),
    );
    return;
  }

  // Content-hashed build assets are immutable by construction: Vite renames a
  // file whenever its bytes change, and the activate handler purges old
  // caches on release rollover, so a cached copy can never be stale. Serve
  // them cache-first — stale-while-revalidate here would re-fetch every
  // JS/CSS/font file on every boot for bytes guaranteed identical. Mirrors
  // the "public, max-age=31536000, immutable" rule vercel.ts applies to
  // the same paths.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            if (res && res.status === 200 && res.type === "basic") {
              const copy = res.clone();
              caches.open(STATIC_CACHE).then((cache) => cache.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Stale-while-revalidate for other static assets (root-level icons, svgs).
  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || networkFetch;
    }),
  );
});
