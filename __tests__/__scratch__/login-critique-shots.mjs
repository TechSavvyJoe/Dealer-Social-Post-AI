import { chromium } from "@playwright/test";
const OUT = process.argv[2];
const browser = await chromium.launch();
const shots = [
  ["desk-dark", 1440, 900, "dark"],
  ["desk-light", 1440, 900, "light"],
  ["desk-short", 1366, 640, "dark"],
  ["phone-dark", 390, 844, "dark"],
  ["phone-light", 390, 844, "light"],
  ["land", 844, 390, "dark"],
];
for (const [name, w, h, theme] of shots) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    colorScheme: theme,
  });
  const page = await ctx.newPage();
  await page.route("**/api/**", (r) =>
    r.fulfill({ status: 401, contentType: "application/json", body: "{}" }),
  );
  await page.addInitScript((t) => {
    localStorage.setItem("dealer-social-post-ai.session", JSON.stringify({ theme: t }));
  }, theme);
  await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /^sign in$/i }).waitFor({ timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  if (name === "desk-dark") {
    await page.getByRole("button", { name: "Digit 1" }).click();
    await page.getByRole("button", { name: "Digit 2" }).click();
  }
  await page.waitForTimeout(500);
  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollHeight > document.documentElement.clientHeight,
    main: (() => {
      const m = document.getElementById("main-content");
      return m ? m.scrollHeight > m.clientHeight + 1 : null;
    })(),
  }));
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log(`ok ${name} overflow=${JSON.stringify(overflow)}`);
  await ctx.close();
}
await browser.close();
