import { chromium } from "@playwright/test";
const browser = await chromium.launch();
for (const dpr of [1, 2]) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: dpr,
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  await page.route("**/api/**", (r) =>
    r.fulfill({ status: 401, contentType: "application/json", body: "{}" }),
  );
  await page.goto("http://localhost:5173/");
  await page.getByRole("heading", { name: /^sign in$/i }).waitFor({ timeout: 20000 });
  await page.waitForTimeout(400);
  const v = await page.evaluate(() => {
    const s = [...document.querySelectorAll(".login-code-slot")];
    return s.map((e) => {
      const c = getComputedStyle(e);
      return c.borderTopWidth + "|" + c.borderTopStyle + "|" + c.borderTopColor;
    });
  });
  console.log("dpr", dpr, JSON.stringify(v));
  await ctx.close();
}
await browser.close();
