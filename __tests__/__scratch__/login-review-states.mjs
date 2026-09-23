import { chromium } from "@playwright/test";
const OUT =
  "/private/tmp/claude-501/-Users-joegallant-AI-App-Development-Projects-Dealer-Social-Post-AI/996abc7b-e0db-493b-a0a3-9b6d1370243e/scratchpad/login-review";
const browser = await chromium.launch();
for (const theme of ["dark", "light"]) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  await page.route("**/api/**", (r) =>
    r.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "Invalid code" }),
    }),
  );
  await page.addInitScript((t) => {
    localStorage.setItem("dealer-social-post-ai.session", JSON.stringify({ theme: t }));
  }, theme);
  await page.goto("http://localhost:5173/");
  await page.getByRole("heading", { name: /^sign in$/i }).waitFor({ timeout: 20000 });
  // svg geometry
  const svg = await page.evaluate(() => {
    const s = document.querySelector(".login-card-brand svg[aria-hidden]");
    const col = document.querySelector(".login-card-brand");
    const cs = getComputedStyle(s);
    const r = s.getBoundingClientRect();
    const cr = col.getBoundingClientRect();
    return {
      right: cs.right,
      bottom: cs.bottom,
      w: cs.width,
      h: cs.height,
      relX: Math.round(r.x - cr.x),
      relY: Math.round(r.y - cr.y),
      colW: Math.round(cr.width),
      colH: Math.round(cr.height),
      viewBox: s.getAttribute("viewBox"),
    };
  });
  console.log(theme, "svg", JSON.stringify(svg));
  // focus a key with keyboard
  await page.getByRole("button", { name: "Digit 5" }).focus();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/login-${theme}-focus-key.png` });
  const fs = await page.evaluate(() => {
    const el = document.activeElement;
    const cs = getComputedStyle(el);
    return {
      name: el.getAttribute("aria-label"),
      outline: cs.outline,
      outlineOffset: cs.outlineOffset,
      boxShadow: cs.boxShadow,
    };
  });
  console.log(theme, "focus", JSON.stringify(fs));
  // wrong code -> error
  for (const d of ["9", "9", "9", "9"])
    await page.getByRole("button", { name: `Digit ${d}` }).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/login-${theme}-error.png` });
  const err = await page.evaluate(() => {
    const p = [...document.querySelectorAll('[role="alert"]')].map((e) =>
      e.textContent.trim(),
    );
    const pane = document.querySelector(".login-access-pane");
    const card = pane.parentElement;
    return { alerts: p, cardH: Math.round(card.getBoundingClientRect().height) };
  });
  console.log(theme, "error", JSON.stringify(err));
  await ctx.close();
}
await browser.close();
