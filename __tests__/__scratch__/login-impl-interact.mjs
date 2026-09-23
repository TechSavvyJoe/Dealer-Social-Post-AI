import { chromium } from "@playwright/test";
const browser = await chromium.launch();
for (const [w, h, label] of [
  [1440, 900, "desk"],
  [375, 667, "short-portrait"],
  [844, 390, "landscape"],
]) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  await page.route("**/api/**", (r) =>
    r.fulfill({ status: 401, contentType: "application/json", body: "{}" }),
  );
  await page.goto("http://localhost:5173/");
  await page.getByRole("heading", { name: /^sign in$/i }).waitFor({ timeout: 20000 });
  // status region name (pinned by tests)
  const zero = await page
    .getByRole("status", { name: "0 of 4 digits entered" })
    .count();
  await page.keyboard.press("1");
  await page.keyboard.press("2");
  const two = await page.getByRole("status", { name: "2 of 4 digits entered" }).count();
  await page.keyboard.press("Backspace");
  const one = await page.getByRole("status", { name: "1 of 4 digits entered" }).count();
  // keypad click + aria-pressed on the switch
  await page.getByRole("button", { name: "Digit 9" }).click();
  const two2 = await page
    .getByRole("status", { name: "2 of 4 digits entered" })
    .count();
  const pressedBefore = await page
    .getByRole("button", { name: "My code" })
    .getAttribute("aria-pressed");
  await page.getByRole("button", { name: "Manager username and password" }).click();
  await page.waitForTimeout(200);
  const mgrPressed = await page
    .getByRole("button", { name: "Manager username and password" })
    .getAttribute("aria-pressed");
  const mgrBtn = await page
    .getByRole("button", { name: "Continue to manager workspace" })
    .count();
  const userField = await page.getByLabel("Username").count();
  console.log(
    `${label} ${w}x${h}: status0=${zero} status2=${two} back->1=${one} click->2=${two2} myCodePressed=${pressedBefore} mgrPressed=${mgrPressed} mgrSubmit=${mgrBtn} usernameField=${userField}`,
  );
  await ctx.close();
}
await browser.close();
