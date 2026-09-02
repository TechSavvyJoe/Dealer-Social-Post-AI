import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(() => {
  const devBackendUrl = process.env.DEV_BACKEND_URL || "http://127.0.0.1:8090";
  const releaseSha = (
    process.env.VITE_RELEASE_SHA ||
    process.env.VITE_VERCEL_GIT_COMMIT_SHA ||
    ""
  ).trim();
  if (releaseSha && !/^[0-9a-f]{40}$/i.test(releaseSha)) {
    throw new Error(
      "VITE_RELEASE_SHA (or VITE_VERCEL_GIT_COMMIT_SHA) must be a full 40-character Git SHA.",
    );
  }
  const serviceWorkerVersion = `dsp-${releaseSha.toLowerCase() || "development"}`;

  return {
    server: {
      port: 5173,
      host: "0.0.0.0",
      proxy: {
        "/api": {
          target: devBackendUrl,
          changeOrigin: true,
        },
      },
      fs: {
        // Exclude PocketBase binary and data from being watched
        deny: ["**/pocketbase", "**/pb_data/**", "**/pb_migrations/**"],
      },
    },
    plugins: [
      react(),
      // Bind the service worker cache to the selected immutable release. Two
      // builds of the same release now produce the same worker, while a new
      // release reliably invalidates the prior app shell.
      // Runs AFTER the static-copy step (writeBundle + enforce:"post") so
      // we patch the file the user actually downloads, not a temp copy.
      {
        name: "stamp-service-worker",
        apply: "build",
        enforce: "post",
        writeBundle: {
          sequential: true,
          order: "post",
          handler: (options) => {
            const fs = require("fs");
            const pathMod = require("path");
            const outDir = (options && options.dir) || "dist";
            const swOut = pathMod.resolve(__dirname, outDir, "sw.js");
            if (!fs.existsSync(swOut)) return;
            const sw = fs
              .readFileSync(swOut, "utf8")
              .replace(
                /const VERSION = "[^"]+";/,
                `const VERSION = "${serviceWorkerVersion}";`,
              );
            fs.writeFileSync(swOut, sw);
            console.log(`[sw] stamped version ${serviceWorkerVersion} → ${swOut}`);
          },
        },
      },
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "."),
      },
    },
    // Exclude PocketBase files from optimization
    optimizeDeps: {
      exclude: ["pocketbase"],
    },
    build: {
      // Enable CSS code splitting for better caching
      cssCodeSplit: true,
      // Configure manual chunking for optimal caching
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules")) {
              // Match the react runtime precisely — a bare `includes("react")`
              // also captured lucide-react (and any future *react* package),
              // dragging every icon in the app into the boot-critical vendor
              // chunk. Left unassigned, lucide icons chunk by usage so
              // admin-only icons ride the lazy admin chunks instead.
              if (
                /node_modules\/(react|react-dom|scheduler)\//.test(id) ||
                id.includes("@tanstack/react-query") ||
                id.includes("zustand")
              )
                return "vendor";
              if (id.includes("framer-motion")) return "ui";
            }
          },
        },
      },
      // Keep warnings useful without flagging the intentionally grouped
      // framer-motion UI chunk.
      chunkSizeWarningLimit: 1000,
      // Enable minification
      minify: "esbuild" as const,
      // Source maps for production debugging (disabled for smaller bundle)
      sourcemap: false,
    },
    // CSS optimization
    css: {
      devSourcemap: true,
    },
  };
});
