import { chromium } from "@playwright/test";
const OUT =
  "/private/tmp/claude-501/-Users-joegallant-AI-App-Development-Projects-Dealer-Social-Post-AI/996abc7b-e0db-493b-a0a3-9b6d1370243e/scratchpad/shots";
const browser = await chromium.launch();
const sizes = [
  ["desk1440x900", 1440, 900],
  ["desk1280x680", 1280, 680],
  ["desk1024x620", 1024, 620],
  ["phone390", 390, 844],
  ["land844", 844, 390],
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
      .waitFor({ timeout: 20000 })
      .catch(() => {});
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/rev-${theme}-${name}.png` });
    const m = await page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const box = (el) =>
        el
          ? (({ x, y, width, height }) => ({
              x: Math.round(x),
              y: Math.round(y),
              w: Math.round(width),
              h: Math.round(height),
            }))(el.getBoundingClientRect())
          : null;
      const pane = q(".login-access-pane");
      const card = q(".login-card-brand")?.parentElement ?? null;
      const form = q(".login-form");
      const kids = form ? [...form.children].map(box) : [];
      return {
        vw: innerWidth,
        vh: innerHeight,
        paneJustify: pane ? getComputedStyle(pane).justifyContent : null,
        paneOverflowY: pane ? getComputedStyle(pane).overflowY : null,
        paneScroll: pane ? { sh: pane.scrollHeight, ch: pane.clientHeight } : null,
        card: box(card),
        formChildren: kids,
        modePanel: box(q(".login-mode-panel")),
        keypad: box(q(".login-keypad")),
        switchBox: box(q(".login-switch")),
        codeSlot: box(q(".login-code-slot")),
        codeLabelDisplay: q(".login-code-label")
          ? getComputedStyle(q(".login-code-label")).display
          : "absent",
        footerDisplay: q(".login-footer-note")
          ? getComputedStyle(q(".login-footer-note")).display
          : "absent",
        mobileLogoDisplay: q(".login-mobile-logo")
          ? getComputedStyle(q(".login-mobile-logo")).display
          : "absent",
        keyBg: q(".login-key")
          ? getComputedStyle(q(".login-key")).backgroundColor
          : null,
        keyBorder: q(".login-key")
          ? getComputedStyle(q(".login-key")).borderTopWidth +
            " " +
            getComputedStyle(q(".login-key")).borderTopColor
          : null,
        docOverflowX:
          document.documentElement.scrollWidth > document.documentElement.clientWidth,
        docOverflowY:
          document.documentElement.scrollHeight > document.documentElement.clientHeight,
        mainOverflow: (() => {
          const mn = q("#main-content");
          return mn ? { sh: mn.scrollHeight, ch: mn.clientHeight } : null;
        })(),
      };
    });
    console.log(JSON.stringify({ theme, name, ...m }, null, 1));
    await ctx.close();
  }
}
await browser.close();
