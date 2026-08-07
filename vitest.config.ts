import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Tests care about settled accessible UI, not animation frame timing.
      "framer-motion": fileURLToPath(
        new URL("./test/framer-motion.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // The animation-heavy JSDOM suites remain genuinely parallel, but capping
    // workers prevents CPU starvation from turning 5-second assertions into
    // scheduling failures on 2-core CI and 8-core developer machines.
    maxWorkers: 2,
    // automation/ is a separate package with its own dependencies, vitest
    // config and check script. Root `npm ci` does not install its deps, so
    // running its suites from here fails in CI while passing for anyone who
    // has run npm install inside that directory.
    exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**", "automation/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
