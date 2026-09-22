import { chromium } from "@playwright/test";
const OUT =
  "/private/tmp/claude-501/-Users-joegallant-AI-App-Development-Projects-Dealer-Social-Post-AI/996abc7b-e0db-493b-a0a3-9b6d1370243e/scratchpad/shots";
const browser = await chromium.launch();
const heights = [900, 820, 780, 720, 690, 680, 670, 640, 620, 600, 560, 520, 505];
for (const h of heights) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: h },
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
  await page.waitForTimeout(350);
  const m = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const r = (el) => (el ? el.getBoundingClientRect() : null);
    const card = q(".login-card-brand")?.parentElement ?? null;
    const cb = r(card),
      pane = q(".login-access-pane");
    const keys = [...document.querySelectorAll(".login-key")];
    const lastKey = keys.length ? r(keys[keys.length - 1]) : null;
    const foot = q(".login-footer-note"),
      fb = r(foot);
    const head = q("#login-heading"),
      hb = r(head);
    return {
      cardTop: Math.round(cb.top),
      cardBottom: Math.round(cb.bottom),
      cardH: Math.round(cb.height),
      paneCH: pane.clientHeight,
      paneSH: pane.scrollHeight,
      headTop: hb ? Math.round(hb.top) : null,
      lastKeyBottom: lastKey ? Math.round(lastKey.bottom) : null,
      footBottom: fb ? Math.round(fb.bottom) : null,
      footHidden: foot ? getComputedStyle(foot).display === "none" : true,
    };
  });
  const keyClip = m.lastKeyBottom !== null && m.lastKeyBottom > m.cardBottom;
  const footClip =
    !m.footHidden && m.footBottom !== null && m.footBottom > m.cardBottom;
  const headClip = m.headTop < m.cardTop;
  console.log(
    `1280x${h}  card ${m.cardTop}..${m.cardBottom} (h${m.cardH})  pane ch${m.paneCH}/sh${m.paneSH}  head@${m.headTop}${headClip ? " HEAD-CLIPPED" : ""}  lastKeyBottom ${m.lastKeyBottom}${keyClip ? " KEY-CLIPPED" : ""}  footBottom ${m.footBottom}${footClip ? " FOOTER-CLIPPED" : ""}`,
  );
  if (keyClip || footClip || headClip)
    await page.screenshot({ path: `${OUT}/clip-1280x${h}.png` });
  await ctx.close();
}
await browser.close();
