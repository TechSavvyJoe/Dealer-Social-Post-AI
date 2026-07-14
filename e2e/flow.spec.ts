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
      page.getByRole("heading", { name: /enter dealer code/i })
    ).toBeVisible();

    // Dialpad buttons use accessible names like "Digit 9".
    for (let i = 0; i < 6; i++) {
      await page.getByRole("button", { name: "Digit 9" }).click();
    }

    await expect(
      page.getByText("Code not recognized. Check the code and try again.")
    ).toBeVisible({ timeout: 10_000 });
  });
});
