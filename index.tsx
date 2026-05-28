import "./styles/globals.css";
import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { getQueryClient } from "./services/queryClient";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider } from "./components/ui/Toast";

// Auto-reload on chunk load failure (e.g. after deployment)
window.addEventListener("vite:preloadError", (event) => {
  window.location.reload();
});

// Register the service worker in production builds only. Dev would clash with
// Vite HMR. PocketBase serves `/sw.js` from the same origin so scope is "/".
// On deploy, the vite-config plugin stamps `sw.js` with a fresh version so
// returning users pick up the new shell instead of a stale cache.
if ("serviceWorker" in navigator && !import.meta.env.DEV) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        // When a new SW is found and finishes installing, prompt for reload.
        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (
              installing.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              // Best-effort UX prompt — let the user choose when to reload.
              const banner = document.createElement("div");
              banner.setAttribute("role", "alert");
              banner.style.cssText =
                "position:fixed;left:50%;bottom:16px;transform:translateX(-50%);background:#1d4ed8;color:#fff;padding:10px 16px;border-radius:9999px;font-size:13px;font-family:Inter,system-ui;box-shadow:0 10px 30px rgba(0,0,0,.3);z-index:9999;cursor:pointer;display:flex;align-items:center;gap:8px;";
              banner.innerHTML =
                'New version available — <u style="text-underline-offset:3px">tap to refresh</u>';
              banner.onclick = () => {
                installing.postMessage({ type: "SKIP_WAITING" });
                window.location.reload();
              };
              document.body.appendChild(banner);
              window.setTimeout(() => banner.remove(), 30000);
            }
          });
        });
      })
      .catch((err) => console.warn("[sw] registration failed", err));
  });
}

const ReactQueryDevtools = React.lazy(() =>
  import("@tanstack/react-query-devtools").then((mod) => ({
    default: mod.ReactQueryDevtools,
  }))
);

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <QueryClientProvider client={getQueryClient()}>
      <ToastProvider>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </ToastProvider>
      {import.meta.env.DEV && (
        <Suspense fallback={null}>
          <ReactQueryDevtools initialIsOpen={false} />
        </Suspense>
      )}
    </QueryClientProvider>
  </React.StrictMode>
);
