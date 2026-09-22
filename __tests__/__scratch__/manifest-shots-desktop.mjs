import { chromium } from "@playwright/test";
import sharp from "sharp";
const OUT = process.argv[2];
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  reducedMotion: "reduce",
  colorScheme: "dark",
});
const page = await ctx.newPage();
await page.route("**/api/**", (r) =>
  r.fulfill({ status: 401, contentType: "application/json", body: "{}" }),
);
await page.addInitScript(() => {
  localStorage.setItem(
    "dealer-social-post-ai.session",
    JSON.stringify({ theme: "dark" }),
  );
});
await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await page.getByRole("heading", { name: /^sign in$/i }).waitFor({ timeout: 20000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(800);
const facts = await page.evaluate(() => {
  const main = document.getElementById("main-content");
  const pair = main?.firstElementChild;
  const r = pair?.getBoundingClientRect();
  return {
    themeColor: document
      .querySelector('meta[name="theme-color"]')
      ?.getAttribute("content"),
    pairTop: r?.top,
    pairBottom: r?.bottom,
    viewport: window.innerHeight,
    mainScrollOverflow: main ? main.scrollHeight > main.clientHeight : null,
    docOverflow:
      document.documentElement.scrollHeight > document.documentElement.clientHeight,
  };
});
console.log("facts", JSON.stringify(facts));
const png = await page.screenshot({ type: "png", fullPage: false });
await sharp(png)
  .resize(1440, 900, { fit: "cover" })
  .webp({ quality: 88, effort: 6 })
  .toFile(`${OUT}/login-desktop.webp`);
await sharp(png).toFile(`${OUT}/login-desktop.png`);
console.log("ok login-desktop");
await browser.close();
