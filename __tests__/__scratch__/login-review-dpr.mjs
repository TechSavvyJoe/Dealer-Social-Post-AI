import { chromium } from "@playwright/test";
const browser = await chromium.launch();
for (const dsf of [2]) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: dsf,
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  await page.route("**/api/**", (r) =>
    r.fulfill({ status: 401, contentType: "application/json", body: "{}" }),
  );
  await page.goto("http://localhost:5173/");
  await page.getByRole("heading", { name: /^sign in$/i }).waitFor({ timeout: 20000 });
  await page.waitForTimeout(400);
  const out = await page.evaluate(() => {
    const slots = [...document.querySelectorAll(".login-code-slot")].map((s) => ({
      cls: s.className.match(/border-\[[^\]]+\]/)?.[0] ?? null,
      w: getComputedStyle(s).borderTopWidth,
      c: getComputedStyle(s).borderTopColor,
    }));
    // does the arbitrary rule exist anywhere in the loaded stylesheets?
    let found = [];
    for (const ss of document.styleSheets) {
      let rules;
      try {
        rules = ss.cssRules;
      } catch {
        continue;
      }
      for (const r of rules) {
        const t = r.cssText || "";
        if (t.includes("1.5px") && t.includes("border")) found.push(t.slice(0, 140));
        if (t.includes("hover") && t.includes("overlay"))
          found.push("HOVEROVERLAY:" + t.slice(0, 140));
      }
    }
    return { slots, found: found.slice(0, 8) };
  });
  console.log("dsf", dsf, JSON.stringify(out, null, 1));
  await ctx.close();
}
await browser.close();
