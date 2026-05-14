import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(() => {
  return {
    server: {
      port: 5173,
      host: "0.0.0.0",
      proxy: {
        "/api": {
          target: "http://127.0.0.1:8090",
          changeOrigin: true,
        },
      },
      fs: {
        // Exclude PocketBase binary and data from being watched
        deny: ["**/pocketbase", "**/pb_data/**", "**/pb_migrations/**"],
      },
    },
    plugins: [react()],
    define: {
      // Removed GEMINI_API_KEY to prevent inlining secret into client bundle
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
            if (id.includes('node_modules')) {
              if (id.includes('react') || id.includes('zustand')) return 'vendor';
              if (id.includes('framer-motion') || id.includes('lucide-react')) return 'ui';
              if (id.includes('@google/genai')) return 'ai';
            }
          }
        },
      },
      // Increase chunk size warning limit (we have large AI models)
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
