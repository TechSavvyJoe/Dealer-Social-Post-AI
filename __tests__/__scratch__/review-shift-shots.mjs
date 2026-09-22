import { chromium } from "@playwright/test";
const OUT =
  "/private/tmp/claude-501/-Users-joegallant-AI-App-Development-Projects-Dealer-Social-Post-AI/996abc7b-e0db-493b-a0a3-9b6d1370243e/scratchpad/shots";
const browser = await chromium.launch();
for (const [w, h, tag] of [
  [1440, 900, "desk"],
  [390, 844, "phone"],
]) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  await page.route("**/api/**", (r) =>
    r.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ message: "That code was not recognised." }),
    }),
  );
  await page.goto("http://localhost:5173/");
  await page.getByRole("heading", { name: /^sign in$/i }).waitFor({ timeout: 20000 });
  const before = await page.evaluate(() => {
    const k = document.querySelector(".login-keypad").getBoundingClientRect();
    const c = document
      .querySelector(".login-card-brand")
      ?.parentElement?.getBoundingClientRect();
    return {
      keypadTop: Math.round(k.top),
      cardTop: c ? Math.round(c.top) : null,
      cardH: c ? Math.round(c.height) : null,
    };
  });
  // focus ring
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const ring = await page.evaluate(() => {
    const a = document.activeElement;
    const s = getComputedStyle(a);
    return {
      el: a.getAttribute("aria-label"),
      outline: s.outlineWidth + " " + s.outlineStyle + " " + s.outlineColor,
      offset: s.outlineOffset,
    };
  });
  console.log(`FOCUS ${tag}`, JSON.stringify(ring));
  for (const d of ["9", "9", "9", "9"]) await page.keyboard.press(d);
  await page.waitForTimeout(1200);
  const after = await page.evaluate(() => {
    const k = document.querySelector(".login-keypad")?.getBoundingClientRect();
    const c = document
      .querySelector(".login-card-brand")
      ?.parentElement?.getBoundingClientRect();
    const err = [...document.querySelectorAll('[role="alert"]')].map(
      (e) => e.textContent,
    );
    return {
      keypadTop: k ? Math.round(k.top) : null,
      cardTop: c ? Math.round(c.top) : null,
      cardH: c ? Math.round(c.height) : null,
      err,
    };
  });
  console.log(
    `SHIFT ${tag} before`,
    JSON.stringify(before),
    "after",
    JSON.stringify(after),
  );
  await page.screenshot({ path: `${OUT}/error-${tag}.png` });
  await ctx.close();
}
await browser.close();
