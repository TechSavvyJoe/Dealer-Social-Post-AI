import { chromium } from "@playwright/test";
const OUT =
  "/private/tmp/claude-501/-Users-joegallant-AI-App-Development-Projects-Dealer-Social-Post-AI/996abc7b-e0db-493b-a0a3-9b6d1370243e/scratchpad/shots";
const browser = await chromium.launch();
for (const [w, h] of [
  [667, 375],
  [736, 414],
  [844, 390],
  [932, 430],
]) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  await page.route("**/api/**", (r) =>
    r.fulfill({ status: 401, contentType: "application/json", body: "{}" }),
  );
  await page.goto("http://localhost:5173/");
  await page.getByRole("heading", { name: /^sign in$/i }).waitFor({ timeout: 20000 });
  await page.waitForTimeout(250);
  const m = await page.evaluate(() => {
    const keys = [...document.querySelectorAll(".login-key")];
    const lk = keys[keys.length - 1].getBoundingClientRect();
    const first = keys[0].getBoundingClientRect();
    const pane = document.querySelector(".login-access-pane");
    return {
      lastKeyBottom: Math.round(lk.bottom),
      keyW: Math.round(first.width),
      keyH: Math.round(first.height),
      vh: innerHeight,
      paneCH: pane.clientHeight,
      paneSH: pane.scrollHeight,
      docOverflowY:
        document.documentElement.scrollHeight > document.documentElement.clientHeight,
      docOverflowX:
        document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
  console.log(
    `${w}x${h}`,
    JSON.stringify(m),
    m.lastKeyBottom > m.vh ? "KEYS BELOW FOLD" : "ok",
  );
  await page.screenshot({ path: `${OUT}/land-${w}x${h}.png` });
  await ctx.close();
}
await browser.close();
