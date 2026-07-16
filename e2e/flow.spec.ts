import { test, expect } from "@playwright/test";

test.describe("Dealer Social Post AI Flow", () => {
  test("should load the login page and handle invalid login", async ({
    page,
  }) => {
    // Keep this smoke test independent of PocketBase in CI: stub session APIs
    // so Vite can run alone and the login failure path is deterministic.
    await page.route("**/api/app/session", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ error: "Invalid dealer code" }),
        });
        return;
      }
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "No active session" }),
      });
    });
    await page.route("**/api/telemetry", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: /open your post studio/i }),
    ).toBeVisible();

    // Dialpad buttons use accessible names like "Digit 9".
    for (let i = 0; i < 6; i++) {
      await page.getByRole("button", { name: "Digit 9" }).click();
    }

    await expect(
      page.getByText("Code not recognized. Check the code and try again."),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("keeps the mobile result workspace job-first", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });

    await page.route("**/api/app/session", async (route) => {
      // Give the pre-app IndexedDB seed below time to commit. In production
      // this asset was written before the refresh that triggers restoration.
      await new Promise((resolve) => setTimeout(resolve, 150));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          role: "salesperson",
          dealer: {
            id: "qa-dealer",
            name: "Northline Motors",
            requires_approval: false,
          },
        }),
      });
    });

    await page.addInitScript(() => {
      const image =
        "data:image/svg+xml;charset=utf-8," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#07111f"/><stop offset="1" stop-color="#2563eb"/></linearGradient></defs><rect width="1080" height="1080" fill="url(#g)"/><path d="M140 640h800l-92-210H310z" fill="#e8eef8" opacity=".92"/><circle cx="350" cy="680" r="88" fill="#07111f"/><circle cx="760" cy="680" r="88" fill="#07111f"/><text x="540" y="860" text-anchor="middle" font-family="Arial" font-size="54" fill="white">NORTHLINE MOTORS</text></svg>',
        );

      localStorage.setItem(
        "dealer-social-post-ai.session",
        JSON.stringify({
          dealerId: "qa-dealer",
          step: 4,
          loginTimestamp: Date.now(),
          generatedPost: {
            text: "A standout delivery deserves a standout moment. Congratulations on the new ride!",
            postId: "qa-post-1",
            releaseStatus: "saved",
          },
          generationParams: {
            style: "Modern & Bold",
            tone: "Excited",
            customerName: "",
          },
        }),
      );

      const request = indexedDB.open("dealer-social-post-ai", 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("creative-assets")) {
          database.createObjectStore("creative-assets", { keyPath: "key" });
        }
      };
      request.onsuccess = () => {
        const transaction = request.result.transaction(
          "creative-assets",
          "readwrite",
        );
        transaction.objectStore("creative-assets").put({
          key: "qa-dealer:generated",
          value: image,
          updatedAt: Date.now(),
        });
      };
    });

    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: "Ready to publish" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Copy caption" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Share post" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save image" }),
    ).toBeVisible();

    const creativeTools = page.getByRole("button", { name: /creative tools/i });
    await expect(creativeTools).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("creative-tools-panel")).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Regenerate image" }),
    ).toBeHidden();

    await page.screenshot({
      path: testInfo.outputPath("result-mobile.png"),
      fullPage: true,
    });
  });
});
