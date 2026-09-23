import { chromium } from "@playwright/test";
const OUT =
  "/private/tmp/claude-501/-Users-joegallant-AI-App-Development-Projects-Dealer-Social-Post-AI/996abc7b-e0db-493b-a0a3-9b6d1370243e/scratchpad/login-impl";
const browser = await chromium.launch();
const shots = [
  ["desk", 1440, 900, "dark", null],
  ["desk", 1440, 900, "light", null],
  ["phone", 390, 844, "dark", null],
  ["land", 844, 390, "dark", null],
  ["short", 1280, 600, "dark", null],
  ["hover", 1440, 900, "light", "Digit 2"],
  ["phoneshort", 375, 667, "dark", null],
];
for (const [name, w, h, theme, hover] of shots) {
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
  await page.getByRole("heading", { name: /^sign in$/i }).waitFor({ timeout: 20000 });
  await page.waitForTimeout(600);
  if (hover) {
    await page.getByRole("button", { name: hover }).hover();
    await page.waitForTimeout(200);
  }
  await page.screenshot({ path: `${OUT}/login-${theme}-${name}.png`, fullPage: false });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  console.log(`ok login-${theme}-${name} xOverflow=${overflow}`);
  await ctx.close();
}
await browser.close();
