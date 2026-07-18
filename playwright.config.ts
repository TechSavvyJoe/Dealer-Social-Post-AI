import { defineConfig } from "@playwright/test";

const viewports = [
  { name: "phone-320", width: 320, height: 700 },
  { name: "phone-390", width: 390, height: 844 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1440", width: 1440, height: 1000 },
] as const;

const browsers = ["chromium", "webkit"] as const;
const externalBaseUrl = process.env.E2E_BASE_URL;

/**
 * Frontend smoke e2e. The login-failure test stubs /api/app/session so CI does
 * not need a PocketBase binary. Start only Vite here.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: externalBaseUrl || "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: browsers.flatMap((browserName) =>
    viewports.map(({ name, width, height }) => ({
      name: `${browserName}-${name}`,
      use: {
        browserName,
        viewport: { width, height },
        hasTouch: width < 768,
        isMobile: width < 768,
        deviceScaleFactor: width < 768 ? 2 : 1,
      },
    })),
  ),
  webServer: externalBaseUrl
    ? undefined
    : {
        command: "npm run dev -- --host 127.0.0.1 --port 5173",
        url: "http://127.0.0.1:5173",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
