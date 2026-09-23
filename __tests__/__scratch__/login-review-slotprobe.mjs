import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  reducedMotion: "reduce",
});
const page = await ctx.newPage();
await page.route("**/api/**", (r) =>
  r.fulfill({ status: 401, contentType: "application/json", body: "{}" }),
);
await page.goto("http://localhost:5173/");
await page.getByRole("heading", { name: /^sign in$/i }).waitFor({ timeout: 20000 });
await page.waitForTimeout(500);
console.log(
  JSON.stringify(
    await page.evaluate(() => {
      const s = document.querySelectorAll(".login-code-slot");
      const out = [...s].map((e) => ({
        cls: e.className,
        bw: getComputedStyle(e).borderTopWidth,
        bc: getComputedStyle(e).borderTopColor,
      }));
      // find any CSS rule for border-[1.5px]
      let rules = [];
      for (const sh of document.styleSheets) {
        try {
          for (const r of sh.cssRules) {
            if (r.cssText && /1\.5px/.test(r.cssText) && /border/.test(r.cssText))
              rules.push(r.cssText.slice(0, 160));
          }
        } catch (e) {}
      }
      return { out, rules: rules.slice(0, 10) };
    }),
  ),
);
await page.keyboard.press("1");
await page.waitForTimeout(200);
console.log(
  JSON.stringify(
    await page.evaluate(() => {
      const s = [...document.querySelectorAll(".login-code-slot")];
      const dot = document.querySelector(".login-code-slot > span");
      const cs = dot ? getComputedStyle(dot) : null;
      return {
        borders: s.map(
          (e) =>
            getComputedStyle(e).borderTopWidth +
            " " +
            getComputedStyle(e).borderTopColor,
        ),
        dot: cs
          ? { w: cs.width, h: cs.height, r: cs.borderRadius, bg: cs.backgroundColor }
          : null,
      };
    }),
  ),
);
await browser.close();
