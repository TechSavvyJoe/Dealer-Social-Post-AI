import { chromium } from "@playwright/test";
const browser = await chromium.launch();
for (const h of [600, 520]) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: h },
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  await page.route("**/api/**", (r) =>
    r.fulfill({ status: 401, contentType: "application/json", body: "{}" }),
  );
  await page.goto("http://localhost:5173/");
  await page.getByRole("heading", { name: /^sign in$/i }).waitFor({ timeout: 20000 });
  const probe = () => {
    const card = document.querySelector(".login-card-brand").parentElement;
    const pane = document.querySelector(".login-access-pane");
    const cb = card.getBoundingClientRect();
    const keys = [...document.querySelectorAll(".login-key")];
    const lk = keys[keys.length - 1].getBoundingClientRect();
    const h1 = document.querySelector("#login-heading").getBoundingClientRect();
    return {
      cardTop: Math.round(cb.top),
      cardBottom: Math.round(cb.bottom),
      paneCH: pane.clientHeight,
      paneSH: pane.scrollHeight,
      canScroll: pane.scrollHeight > pane.clientHeight,
      h1Top: Math.round(h1.top),
      lastKeyBottom: Math.round(lk.bottom),
      justify: getComputedStyle(pane).justifyContent,
    };
  };
  console.log(`h${h} BEFORE`, JSON.stringify(await page.evaluate(probe)));
  await page.evaluate(() => {
    const card = document.querySelector(".login-card-brand").parentElement;
    card.style.gridTemplateRows = "minmax(0, 1fr)";
    document.querySelector(".login-access-pane").style.justifyContent = "safe center";
  });
  await page.waitForTimeout(150);
  console.log(`h${h} AFTER `, JSON.stringify(await page.evaluate(probe)));
  // and scroll to top to see if h1 becomes reachable
  await page.evaluate(() => {
    document.querySelector(".login-access-pane").scrollTop = 0;
  });
  console.log(`h${h} AFTER-scrolltop`, JSON.stringify(await page.evaluate(probe)));
  await ctx.close();
}
await browser.close();
