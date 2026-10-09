import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";

test.use({ serviceWorkers: "block" });
const VIN = "1HGCM82633A004352";
const photo = readFileSync("docs/marketing/demo/synthetic-delivery-photo.jpg");
const photoFile = { name: "synthetic-vin.jpg", mimeType: "image/jpeg", buffer: photo };

async function fixture(page: Page) {
  let photoReads = 0;
  let lookups = 0;
  await page.addInitScript(() => {
    Object.defineProperty(window, "BarcodeDetector", {
      configurable: true,
      value: undefined,
    });
  });
  await page.route("https://vpic.nhtsa.dot.gov/**", (route) => {
    lookups++;
    return route.fulfill({
      json: {
        Results: [
          {
            VIN,
            ErrorCode: "0",
            ModelYear: "2003",
            Make: "HONDA",
            Model: "Accord",
            Trim: "EX",
            DriveType: "FWD",
            FuelTypePrimary: "Gasoline",
            DisplacementL: "2.4",
          },
        ],
      },
    });
  });
  await page.route("**/api/**", (route) => {
    if (new URL(route.request().url()).hostname === "vpic.nhtsa.dot.gov")
      return route.fallback();
    const path = new URL(route.request().url()).pathname;
    if (path.includes(":generateContent")) {
      photoReads++;
      expect(route.request().postDataJSON().contents).toBeTruthy();
      return route.fulfill({
        json: {
          candidates: [
            {
              content: { role: "model", parts: [{ text: VIN }] },
              finishReason: "STOP",
            },
          ],
        },
      });
    }
    if (path === "/api/app/session")
      return route.fulfill({
        json: {
          role: "salesperson",
          dealer: { id: "vin-qa", name: "Northline Motors", requires_approval: false },
          person: {
            id: "qa-person",
            dealer: "vin-qa",
            name: "Jamie Test",
            role: "salesperson",
            active: true,
          },
        },
      });
    if (
      path === "/api/app/posts" ||
      path === "/api/app/vehicle-spins" ||
      path === "/api/app/website-destinations"
    )
      return route.fulfill({ json: { items: [], canReview: false } });
    if (path === "/api/app/health")
      return route.fulfill({
        json: { ok: true, capabilities: { veoNegativePrompt: true } },
      });
    if (path === "/api/telemetry") return route.fulfill({ json: { success: true } });
    return route.fulfill({
      status: 500,
      json: { error: `Unexpected synthetic request: ${path}` },
    });
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your next great post." }),
  ).toBeVisible();
  return { photoReads: () => photoReads, lookups: () => lookups };
}

async function confirmVinPhoto(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Scan VIN" });
  await expect(
    dialog.getByRole("button", { name: "Take VIN photo", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Choose VIN photo", exact: true }),
  ).toBeVisible();
  await dialog.getByLabel("Choose VIN photo", { exact: true }).setInputFiles(photoFile);
  await expect(
    dialog.getByRole("textbox", { name: "VIN (17 characters)" }),
  ).toHaveValue(VIN);
  await dialog.getByRole("button", { name: "Decode VIN", exact: true }).click();
  await expect(dialog.getByText(/2003 HONDA Accord EX/)).toBeVisible();
  await dialog.getByRole("button", { name: "Use this vehicle", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

test("desktop wheel reaches content, survives a dialog, and navigation starts at the top", async ({
  page,
}, info) => {
  test.skip(!info.project.name.endsWith("desktop-1440"), "Desktop wheel regression.");
  await page.setViewportSize({ width: 1440, height: 800 });
  await fixture(page);
  const scrollTop = () => page.evaluate(() => document.scrollingElement!.scrollTop);
  await page.mouse.move(720, 600);
  await page.mouse.wheel(0, 500);
  await expect.poll(scrollTop).toBeGreaterThan(50);
  await page.getByRole("button", { name: "360° vehicle studio", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Every angle. One great view.", exact: true }),
  ).toBeVisible();
  await expect.poll(scrollTop).toBe(0);
  await page.getByRole("button", { name: "Scan VIN", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Scan VIN" })
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.mouse.move(720, 600);
  await page.mouse.wheel(0, 500);
  await expect.poll(scrollTop).toBeGreaterThan(50);
  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your next great post." }),
  ).toBeVisible();
  await expect.poll(scrollTop).toBe(0);
});

test("360 VIN photo needs confirmation, keeps manual fields, and clears old facts after a VIN change", async ({
  page,
}, info) => {
  test.skip(
    !/phone-(?:320|390)$|desktop-1440$/.test(info.project.name),
    "Representative narrow phone, phone and desktop.",
  );
  const api = await fixture(page);
  await page.getByRole("button", { name: "360° vehicle studio", exact: true }).click();
  await page.getByLabel("Stock number", { exact: true }).fill("QA-42");
  await page.getByLabel("Mileage", { exact: true }).fill("12345");
  await page.getByRole("button", { name: "Scan VIN", exact: true }).click();
  expect(api.photoReads()).toBe(0);
  const dialog = page.getByRole("dialog", { name: "Scan VIN" });
  await dialog.getByLabel("Take VIN photo", { exact: true }).setInputFiles(photoFile);
  await expect(
    dialog.getByRole("textbox", { name: "VIN (17 characters)" }),
  ).toHaveValue(VIN);
  expect(api.lookups()).toBe(0);
  await dialog.getByRole("button", { name: "Decode VIN", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Use this vehicle", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Vehicle name", { exact: true })).toHaveValue("");
  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations
      .filter((v) => ["serious", "critical"].includes(v.impact || ""))
      .map((v) => v.id),
  ).toEqual([]);
  await page.screenshot({ path: info.outputPath("vin-confirmation.png") });
  await dialog.getByRole("button", { name: "Use this vehicle", exact: true }).click();
  await expect(page.getByLabel("Vehicle name", { exact: true })).toHaveValue(
    "2003 HONDA Accord EX",
  );
  await expect(page.getByLabel("VIN (optional)", { exact: true })).toHaveValue(VIN);
  await expect(page.getByLabel("Mileage", { exact: true })).toHaveValue("12345");
  await expect(page.getByLabel("Stock number", { exact: true })).toHaveValue("QA-42");
  expect(api.photoReads()).toBe(1);
  expect(api.lookups()).toBe(1);
  await page.getByLabel("VIN (optional)", { exact: true }).fill("1HGCM82633A004353");
  await expect(page.getByLabel("Vehicle name", { exact: true })).toHaveValue("");
  await expect(
    page.getByLabel("Highlights (up to 4, one per line)", { exact: true }),
  ).toHaveValue("");
});

test("photo and generated-video details share the confirmed VIN scanner", async ({
  page,
}, info) => {
  test.skip(
    !/phone-390$|desktop-1440$/.test(info.project.name),
    "Representative creation flows.",
  );
  const api = await fixture(page);
  await page
    .getByLabel("Take a photo for New arrival", { exact: true })
    .setInputFiles(photoFile);
  await page.getByRole("button", { name: /Vehicle.*Scan VIN/ }).click();
  await confirmVinPhoto(page);
  await expect(
    page.getByRole("button", { name: /Vehicle.*2003 HONDA Accord EX/ }),
  ).toBeVisible();
  expect(api.photoReads()).toBe(1);
  expect(api.lookups()).toBe(1);
  await expect(
    page.getByRole("button", { name: "Create post", exact: true }),
  ).toBeEnabled();
});
