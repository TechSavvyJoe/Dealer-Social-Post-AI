import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";

// No dealership session is needed for an explicitly shared, approved spin.
test("customer spin opens privately, supports controls and clears a revoked view", async ({
  page,
}, info) => {
  test.skip(
    !/(phone-320|desktop-1440)$/.test(info.project.name),
    "Two widths per browser cover the customer viewer.",
  );
  const token = "b".repeat(48);
  const jpeg = await readFile(new URL("./fixtures/spin-angle.jpg", import.meta.url));
  let sessionRequests = 0;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/app/session") sessionRequests++;
    expect(request.url()).not.toContain(token);
    expect(request.headers()["cookie"]).toBeUndefined();
    if (path.startsWith("/api/public/vehicle-spin")) {
      if (request.headers()["x-vehicle-spin"] !== token)
        return route.fulfill({
          status: 404,
          json: { error: "This vehicle view is unavailable." },
        });
      if (path.includes("/frames/"))
        return route.fulfill({ contentType: "image/jpeg", body: jpeg });
      return route.fulfill({
        json: {
          id: "public-test",
          vehicle: {
            title: "2024 Test Vehicle",
            vin: "1HGCM82633A004352",
            stock: "QA",
            mileage: "12345",
            highlights: ["Verified equipment"],
            caption: "Synthetic fixture",
          },
          frameCount: 24,
          background: "original",
          dealerName: "Northline Motors",
          state: "approved",
          canDeliver: true,
        },
      });
    }
    return route.fulfill({ status: 401, json: {} });
  });
  await page.goto("/#/spin/" + token);
  await expect(page.getByRole("heading", { name: "2024 Test Vehicle" })).toBeVisible();
  await page.getByRole("button", { name: "Previous angle" }).click();
  await expect(page.getByRole("slider", { name: "View angle" })).toHaveValue("23");
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(page.getByText("Drag to inspect • Zoom out to spin")).toBeVisible();
  expect(sessionRequests).toBe(0);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.filter((v) => ["serious", "critical"].includes(v.impact || "")),
  ).toEqual([]);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
  ).toBe(true);
  await page.goto("/#/spin/" + "c".repeat(48));
  await expect(
    page.getByRole("heading", { name: "Vehicle view unavailable" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "2024 Test Vehicle" })).toHaveCount(0);
  await expect(page.getByRole("img")).toHaveCount(0);
});
