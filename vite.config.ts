import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(() => {
  const devBackendUrl = process.env.DEV_BACKEND_URL || "http://127.0.0.1:8090";

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
      // Stamp the service worker with a fresh version on every build so
      // returning users get the new app shell instead of a stale cache.
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
            const stamp = `dsp-${Date.now()}`;
            const sw = fs
              .readFileSync(swOut, "utf8")
              .replace(/const VERSION = "[^"]+";/, `const VERSION = "${stamp}";`);
            fs.writeFileSync(swOut, sw);
            console.log(`[sw] stamped version ${stamp} → ${swOut}`);
          },
        },
      },
    ],
    define: {
      // Removed GEMINI_API_KEY to prevent inlining secret into client bundle
      __SW_VERSION__: JSON.stringify(`dsp-${Date.now()}`),
    },
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
              if (id.includes("react") || id.includes("zustand")) return "vendor";
              if (id.includes("framer-motion") || id.includes("lucide-react"))
                return "ui";
            }
          },
        },
      },
      // Keep warnings useful without flagging the intentionally grouped UI vendor chunk.
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
