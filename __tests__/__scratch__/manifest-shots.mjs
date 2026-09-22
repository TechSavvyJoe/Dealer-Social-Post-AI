import { chromium } from "@playwright/test";
import sharp from "sharp";
const OUT = process.argv[2];
const browser = await chromium.launch();
const targets = [
  ["mobile", 390, 844, 2],
  ["desktop", 1440, 900, 1],
];
for (const [name, w, h, dpr] of targets) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: dpr,
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
  const png = await page.screenshot({ type: "png", fullPage: false });
  // manifest declares 390x844 / 1440x900 — resize the 2x phone capture back to CSS px
  await sharp(png)
    .resize(w, h, { fit: "cover" })
    .webp({ quality: 88, effort: 6 })
    .toFile(`${OUT}/login-${name}.webp`);
  const meta = await sharp(`${OUT}/login-${name}.webp`).metadata();
  console.log(`ok login-${name} ${meta.width}x${meta.height}`);
  await ctx.close();
}
await browser.close();
