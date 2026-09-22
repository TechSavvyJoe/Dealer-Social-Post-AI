import { chromium } from "@playwright/test";
const OUT =
  "/private/tmp/claude-501/-Users-joegallant-AI-App-Development-Projects-Dealer-Social-Post-AI/996abc7b-e0db-493b-a0a3-9b6d1370243e/scratchpad/login-review";
const browser = await chromium.launch();
const cases = [
  ["s1280x680", 1280, 680, "dark"],
  ["s1024x700", 1024, 700, "dark"],
  ["s1440x620", 1440, 620, "dark"],
  ["s1024x768", 1024, 768, "light"],
  ["tab820", 820, 1180, "dark"],
  ["s1280x680L", 1280, 680, "light"],
];
for (const [name, w, h, theme] of cases) {
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
    localStorage.setItem("dealer-social-post-ai.session", JSON.stringify({ theme: t }));
  }, theme);
  await page.goto("http://localhost:5173/");
  await page
    .getByRole("heading", { name: /^sign in$/i })
    .waitFor({ timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/login-${name}.png` });
  const m = await page.evaluate(() => {
    const pane = document.querySelector(".login-access-pane");
    const card = pane?.parentElement;
    const foot = document.querySelector(".login-footer-note");
    const keypad = document.querySelector(".login-keypad");
    const h1 = document.querySelector("#login-heading");
    const vis = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        inView: r.top >= -1 && r.bottom <= innerHeight + 1,
      };
    };
    return {
      docOverflowX:
        document.documentElement.scrollWidth > document.documentElement.clientWidth,
      docOverflowY:
        document.documentElement.scrollHeight > document.documentElement.clientHeight,
      card: card && {
        w: Math.round(card.getBoundingClientRect().width),
        h: Math.round(card.getBoundingClientRect().height),
        top: Math.round(card.getBoundingClientRect().top),
        bottom: Math.round(card.getBoundingClientRect().bottom),
      },
      paneScroll: pane && {
        sh: pane.scrollHeight,
        ch: pane.clientHeight,
        scrollable: pane.scrollHeight > pane.clientHeight + 1,
      },
      h1: vis(h1),
      keypad: vis(keypad),
      footer: vis(foot),
    };
  });
  console.log(name, JSON.stringify(m));
  await ctx.close();
}
await browser.close();
