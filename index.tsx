import "./styles/globals.css";
import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { domAnimation, LazyMotion, MotionConfig } from "framer-motion";
import App from "./App";
import { getQueryClient } from "./services/queryClient";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider } from "./components/ui/Toast";

// Auto-reload on chunk load failure (e.g. after deployment). An offline
// chunk-miss must not reload-loop or discard the workspace, so only reload
// while online and at most once per minute; otherwise let Vite rethrow so the
// ErrorBoundary catches the failed lazy import instead.
const CHUNK_RELOAD_KEY = "dsp.chunk-reload-once";
const CHUNK_RELOAD_WINDOW_MS = 60_000;
window.addEventListener("vite:preloadError", () => {
  if (navigator.onLine === false) return;
  try {
    const lastReload = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY));
    if (lastReload && Date.now() - lastReload < CHUNK_RELOAD_WINDOW_MS) return;
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  } catch {
    // sessionStorage can throw (private mode, webviews); behave as if the
    // one-shot was already spent rather than risk a reload loop.
    return;
  }
  window.location.reload();
});

const ReactQueryDevtools = React.lazy(() =>
  import("@tanstack/react-query-devtools").then((mod) => ({
    default: mod.ReactQueryDevtools,
  })),
);
const showReactQueryDevtools =
  import.meta.env.DEV && import.meta.env.VITE_SHOW_QUERY_DEVTOOLS === "true";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <LazyMotion features={domAnimation} strict={true}>
      <MotionConfig reducedMotion="user">
        <QueryClientProvider client={getQueryClient()}>
          <ToastProvider>
            <ErrorBoundary>
              <App />
            </ErrorBoundary>
          </ToastProvider>
          {showReactQueryDevtools && (
            <Suspense fallback={null}>
              <ReactQueryDevtools initialIsOpen={false} />
            </Suspense>
          )}
        </QueryClientProvider>
      </MotionConfig>
    </LazyMotion>
  </React.StrictMode>,
);
