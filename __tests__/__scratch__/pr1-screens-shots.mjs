import { chromium } from "@playwright/test";
const OUT = process.argv[2];
const browser = await chromium.launch();
const session = {
  role: "salesperson",
  dealer: {
    id: "qa-dealer",
    name: "Bob Maxey Ford of Howell",
    requires_approval: false,
    brand_color: "#1e40af",
  },
  person: {
    id: "qa-person",
    dealer: "qa-dealer",
    name: "Joe Gallant",
    role: "salesperson",
    active: true,
  },
};
const shots = [
  ["desk-dark", 1440, 900, "dark"],
  ["desk-light", 1440, 900, "light"],
  ["phone-dark", 390, 844, "dark"],
];
for (const [name, w, h, theme] of shots) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    colorScheme: theme,
  });
  const page = await ctx.newPage();
  await page.route("**/api/app/**", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/api/telemetry", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"success":true}',
    }),
  );
  await page.route("**/api/app/session", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(session),
    }),
  );
  await page.addInitScript((t) => {
    localStorage.setItem("dealer-social-post-ai.session", JSON.stringify({ theme: t }));
  }, theme);
  await page.goto("http://localhost:5173/#/capture", { waitUntil: "networkidle" });
  try {
    await page
      .getByRole("heading", { name: "Start with a photo" })
      .waitFor({ timeout: 20000 });
  } catch (e) {
    await page.screenshot({ path: `${OUT}/debug-${name}.png` });
    console.log("headings:", await page.getByRole("heading").allTextContents());
    throw e;
  }
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/capture-${name}.png` });
  console.log(`ok capture-${name}`);
  // upload a photo → post details
  const input = page.locator('input[type="file"]').first();
  await input.setInputFiles(`${OUT}/car.jpg`);
  await page.waitForTimeout(1500);
  const dialog = page.getByRole("dialog");
  if (await dialog.count()) {
    const btn = dialog
      .getByRole("button", { name: /use photo|continue|done|apply|keep|save/i })
      .first();
    if (await btn.count()) {
      await btn.click();
      await page.waitForTimeout(800);
    } else
      console.log(
        "dialog buttons:",
        await dialog.getByRole("button").allTextContents(),
      );
  }
  const details = page.getByRole("heading", { name: /post details/i });
  try {
    await details.waitFor({ timeout: 8000 });
  } catch {
    console.log(
      "no Post details heading; headings:",
      await page.getByRole("heading").allTextContents(),
    );
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/details-${name}.png` });
  console.log(`ok details-${name}`);
  await ctx.close();
}
await browser.close();
