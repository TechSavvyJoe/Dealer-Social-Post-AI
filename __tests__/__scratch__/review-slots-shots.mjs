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
for (const n of [0, 1, 2]) {
  if (n) await page.keyboard.press(String(n));
  const s = await page.evaluate(() =>
    [...document.querySelectorAll(".login-code-slot")].map((el) => ({
      cls: el.className,
      w: getComputedStyle(el).borderTopWidth,
      c: getComputedStyle(el).borderTopColor,
    })),
  );
  console.log("after", n, "keys:", JSON.stringify(s, null, 1));
}
const cssHas = await page.evaluate(async () => {
  const out = [];
  for (const sheet of document.styleSheets) {
    try {
      for (const r of sheet.cssRules) {
        const t = r.cssText || "";
        if (t.includes("1.5px") || t.includes("border-brand-ink"))
          out.push(t.slice(0, 160));
      }
    } catch {}
  }
  return out.slice(0, 20);
});
console.log("CSS rules matching:", JSON.stringify(cssHas, null, 1));
await browser.close();
