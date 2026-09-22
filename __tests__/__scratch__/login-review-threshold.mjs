import { chromium } from "@playwright/test";
const browser = await chromium.launch();
for (const h of [700, 690, 680, 678, 676, 670, 660, 650, 640, 620, 600]) {
  const ctx = await browser.newContext({
    viewport: { width: 1366, height: h },
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
  await page.waitForTimeout(250);
  const m = await page.evaluate(() => {
    const pane = document.querySelector(".login-access-pane");
    const card = pane.parentElement;
    const cr = card.getBoundingClientRect();
    const foot = document.querySelector(".login-footer-note").getBoundingClientRect();
    const keys = [...document.querySelectorAll(".login-key")].map((k) =>
      k.getBoundingClientRect(),
    );
    const lastKey = keys[keys.length - 1];
    return {
      cardH: Math.round(cr.height),
      cardBottom: Math.round(cr.bottom),
      paneH: Math.round(pane.getBoundingClientRect().height),
      paneSH: pane.scrollHeight,
      paneCH: pane.clientHeight,
      footerClipped: foot.bottom > cr.bottom + 0.5,
      lastKeyClipped: lastKey.bottom > cr.bottom + 0.5,
      anyScroll:
        document.documentElement.scrollHeight > document.documentElement.clientHeight ||
        pane.scrollHeight > pane.clientHeight + 1,
    };
  });
  console.log("h=" + h, JSON.stringify(m));
  await ctx.close();
}
await browser.close();
