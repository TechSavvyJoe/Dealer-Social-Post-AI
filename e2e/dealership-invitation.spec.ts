import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const token = "a".repeat(64);
test("an installed app can enter its invitation without a browser address bar", async ({
  page,
}) => {
  let accepted = false;
  await page.route("**/api/**", async (route) => {
    if (new URL(route.request().url()).pathname === "/api/app/dealership-invitation") {
      if (route.request().method() === "POST") {
        expect(route.request().postDataJSON()).toEqual({ token });
        accepted = true;
      }
      return route.fulfill({
        status: accepted ? 200 : 404,
        json: accepted
          ? { id: "synthetic-store", name: "Northline Motors" }
          : { error: "Unavailable" },
      });
    }
    return route.fulfill({ status: 401, json: { error: "No active session" } });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Use a private invitation" }).click();
  await page
    .getByLabel("Private invitation link")
    .fill("https://other.example/join#" + token);
  await page.getByRole("button", { name: "Open invitation" }).click();
  await expect(page.getByLabel("Private invitation link")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  const url = new URL(page.url());
  await page.getByLabel("Private invitation link").fill(url.origin + "/join#" + token);
  const audit = await new AxeBuilder({ page }).analyze();
  expect(
    audit.violations.filter((v) => ["serious", "critical"].includes(v.impact || "")),
  ).toEqual([]);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
  ).toBe(true);
  await page.getByRole("button", { name: "Open invitation" }).click();
  await expect(
    page.getByRole("heading", { name: "Your dealership invitation" }),
  ).toBeVisible();
  expect(accepted).toBe(false);
  await page.getByRole("button", { name: "Set up this device" }).click();
  await expect(page.getByRole("heading", { name: "Northline Motors" })).toBeVisible();
  await expect(page).toHaveURL(/\/join$/);
  await page.getByRole("button", { name: "Continue to sign in" }).click();
  await expect(page.locator("#login-instruction")).toHaveText("Northline Motors");
  await expect(page.locator("#login-instruction")).toBeVisible();
  await expect(page.getByRole("button", { name: "Change dealership" })).toBeVisible();
});

test("private invitation is explicit, accessible, and removed from the address after setup", async ({
  page,
}) => {
  let accepted = false;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/app/dealership-invitation") {
      if (route.request().method() === "POST") {
        expect(route.request().postDataJSON()).toEqual({ token });
        accepted = true;
      }
      return route.fulfill({
        status: accepted ? 200 : 404,
        json: accepted
          ? { id: "synthetic-store", name: "Northline Motors" }
          : { error: "Unavailable" },
      });
    }
    return route.fulfill({ status: 401, json: { error: "No active session" } });
  });
  await page.goto("/join#" + token);
  await expect(
    page.getByRole("heading", { name: "Your dealership invitation" }),
  ).toBeVisible();
  expect(accepted).toBe(false);
  const audit = await new AxeBuilder({ page }).analyze();
  expect(
    audit.violations.filter((v) => ["serious", "critical"].includes(v.impact || "")),
  ).toEqual([]);
  await page.getByRole("button", { name: "Set up this device" }).click();
  await expect(page.getByRole("heading", { name: "Northline Motors" })).toBeVisible();
  await expect(page).toHaveURL(/\/join$/);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
  ).toBe(true);
  await page.getByRole("button", { name: "Continue to sign in" }).click();
  await expect(page.locator("#login-instruction")).toHaveText("Northline Motors");
  await expect(page.locator("#login-instruction")).toBeVisible();
});

test("an expired invitation gives a recoverable error without opening a workspace", async ({
  page,
}) => {
  await page.route("**/api/app/dealership-invitation", (route) =>
    route.fulfill({
      status: 404,
      json: {
        error:
          "This invitation is unavailable. Ask your manager for a current private link.",
      },
    }),
  );
  await page.goto("/join#" + token);
  await page.getByRole("button", { name: "Set up this device" }).click();
  await expect(page.getByRole("alert")).toContainText("Ask your manager");
  await expect(page.getByRole("button", { name: "Set up this device" })).toBeEnabled();
  await page.goto("/join#invalid");
  await expect(page.getByRole("button", { name: "Set up this device" })).toBeDisabled();
});
