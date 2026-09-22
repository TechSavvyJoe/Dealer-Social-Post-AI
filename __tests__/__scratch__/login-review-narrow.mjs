import { chromium } from "@playwright/test";
const OUT =
  "/private/tmp/claude-501/-Users-joegallant-AI-App-Development-Projects-Dealer-Social-Post-AI/996abc7b-e0db-493b-a0a3-9b6d1370243e/scratchpad/login-review";
const browser = await chromium.launch();
for (const [w, h, mode] of [
  [320, 568, "personal"],
  [320, 568, "manager"],
  [768, 1024, "personal"],
]) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  await page.route("**/api/**", (r) =>
    r.fulfill({ status: 401, contentType: "application/json", body: "{}" }),
  );
  await page.goto("http://localhost:5173/");
  await page
    .getByRole("heading", { name: /^sign in$/i })
    .waitFor({ timeout: 20000 })
    .catch(() => {});
  if (mode === "manager")
    await page
      .getByRole("button", { name: /Manager username and password/i })
      .click()
      .catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({
    path: `${OUT}/login-narrow-${w}x${h}-${mode}.png`,
    fullPage: false,
  });
  const m = await page.evaluate(() => ({
    ox: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
    segs: [...document.querySelectorAll('[aria-label="Access type"] button')].map(
      (b) => ({
        t: b.textContent.trim(),
        w: Math.round(b.getBoundingClientRect().width),
        h: Math.round(b.getBoundingClientRect().height),
        overflow: b.scrollWidth > b.clientWidth + 1,
      }),
    ),
    keys: [...document.querySelectorAll(".login-key")]
      .slice(0, 1)
      .map((k) => ({
        w: Math.round(k.getBoundingClientRect().width),
        h: Math.round(k.getBoundingClientRect().height),
      })),
    bodyScrollY:
      document.documentElement.scrollHeight > document.documentElement.clientHeight,
  }));
  console.log(w + "x" + h, mode, JSON.stringify(m));
  await ctx.close();
}
await browser.close();
