import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  return {
    server: {
      port: 3000,
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
  };
});
