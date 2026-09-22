import { chromium } from "@playwright/test";
const OUT =
  "/private/tmp/claude-501/-Users-joegallant-AI-App-Development-Projects-Dealer-Social-Post-AI/996abc7b-e0db-493b-a0a3-9b6d1370243e/scratchpad/login-review";
const browser = await chromium.launch();
for (const [w, h] of [
  [375, 667],
  [375, 812],
  [390, 844],
  [360, 640],
  [412, 915],
  [375, 600],
]) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    isMobile: false,
  });
  const page = await ctx.newPage();
  await page.route("**/api/**", (r) =>
    r.fulfill({ status: 401, contentType: "application/json", body: "{}" }),
  );
  await page.goto("http://localhost:5173/");
  await page
    .getByRole("heading", { name: /^sign in$/i })
    .waitFor({ timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(350);
  const m = await page.evaluate(() => {
    const keys = [...document.querySelectorAll(".login-key")];
    const zero = keys.find((k) => k.getAttribute("aria-label") === "Digit 0");
    const back = keys.find((k) => k.getAttribute("aria-label") === "Delete last digit");
    const foot = document.querySelector(".login-footer-note");
    const r = (el) =>
      el
        ? {
            top: Math.round(el.getBoundingClientRect().top),
            bottom: Math.round(el.getBoundingClientRect().bottom),
          }
        : null;
    return {
      vh: innerHeight,
      zero: r(zero),
      back: r(back),
      footer: r(foot),
      zeroOffscreen: zero
        ? zero.getBoundingClientRect().bottom > innerHeight + 0.5
        : null,
      footerOffscreen: foot
        ? foot.getBoundingClientRect().bottom > innerHeight + 0.5
        : null,
      pageScrollable:
        document.documentElement.scrollHeight > document.documentElement.clientHeight,
      anyScroller: (() => {
        let n = 0;
        document.querySelectorAll("*").forEach((e) => {
          if (
            e.scrollHeight > e.clientHeight + 1 &&
            ["auto", "scroll"].includes(getComputedStyle(e).overflowY)
          )
            n++;
        });
        return n;
      })(),
    };
  });
  console.log(w + "x" + h, JSON.stringify(m));
  if (h === 667 || h === 640)
    await page.screenshot({ path: `${OUT}/login-small-${w}x${h}.png` });
  await ctx.close();
}
await browser.close();
