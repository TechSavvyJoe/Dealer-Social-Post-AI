import { chromium } from "@playwright/test";
const OUT =
  "/private/tmp/claude-501/-Users-joegallant-AI-App-Development-Projects-Dealer-Social-Post-AI/996abc7b-e0db-493b-a0a3-9b6d1370243e/scratchpad/shots";
const browser = await chromium.launch();
const sizes = [
  ["desk", 1440, 1000],
  ["lap", 1024, 768],
  ["tab", 820, 1180],
  ["phone", 390, 844],
  ["land", 844, 390],
];
for (const theme of ["dark", "light"]) {
  for (const [name, w, h] of sizes) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: h },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
    });
    const page = await ctx.newPage();
    await page.route("**/api/**", (r) =>
      r.fulfill({ status: 401, contentType: "application/json", body: "{}" }),
    );
    await page.addInitScript((t) => {
      localStorage.setItem(
        "dealer-social-post-ai.session",
        JSON.stringify({ theme: t }),
      );
    }, theme);
    await page.goto("http://localhost:5173/");
    await page
      .getByRole("heading", { name: /^sign in$/i })
      .waitFor({ timeout: 15000 })
      .catch(() => {});
    await page.waitForTimeout(600);
    await page.screenshot({
      path: `${OUT}/login-${theme}-${name}.png`,
      fullPage: false,
    });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    console.log(`ok login-${theme}-${name} overflow=${overflow}`);
    await ctx.close();
  }
}
await browser.close();
