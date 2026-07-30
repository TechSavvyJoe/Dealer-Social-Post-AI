import "./styles/globals.css";
import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "framer-motion";
import App from "./App";
import { getQueryClient } from "./services/queryClient";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider } from "./components/ui/Toast";
import { PwaUpdatePrompt } from "./components/PwaUpdatePrompt";

// Auto-reload on chunk load failure (e.g. after deployment)
window.addEventListener("vite:preloadError", (event) => {
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
    <MotionConfig reducedMotion="user">
      <QueryClientProvider client={getQueryClient()}>
        <ToastProvider>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
          <PwaUpdatePrompt />
        </ToastProvider>
        {showReactQueryDevtools && (
          <Suspense fallback={null}>
            <ReactQueryDevtools initialIsOpen={false} />
          </Suspense>
        )}
      </QueryClientProvider>
    </MotionConfig>
  </React.StrictMode>,
);
