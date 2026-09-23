import { chromium } from "@playwright/test";
const OUT =
  "/private/tmp/claude-501/-Users-joegallant-AI-App-Development-Projects-Dealer-Social-Post-AI/996abc7b-e0db-493b-a0a3-9b6d1370243e/scratchpad/shots";
const browser = await chromium.launch();

// card height across modes
{
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
  for (const n of ["My code", "Manager username and password", "System admin"]) {
    await page.getByRole("button", { name: n, exact: true }).click();
    await page.waitForTimeout(300);
    const b = await page.evaluate(() => {
      const c = document
        .querySelector(".login-card-brand")
        .parentElement.getBoundingClientRect();
      return { top: Math.round(c.top), h: Math.round(c.height) };
    });
    console.log("CARD", n, JSON.stringify(b));
  }
  await ctx.close();
}

// turnstile pending + lockout
{
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  let n = 0;
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.includes("challenges.cloudflare.com"))
      return route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: "window.turnstile={render:()=>'w',reset:()=>{},remove:()=>{}};if(window.__cfCb)window.__cfCb();",
      });
    if (route.request().method() === "POST" && url.includes("/api/")) {
      n++;
      if (n >= 2)
        return route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({
            challengeRequired: true,
            siteKey: "1x00000000000000000000AA",
            message: "Security check required.",
          }),
        });
      return route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ message: "Invalid sign-in credentials." }),
      });
    }
    return route.continue();
  });
  await page.goto("http://localhost:5173/");
  await page.getByRole("heading", { name: /^sign in$/i }).waitFor({ timeout: 20000 });
  for (let i = 0; i < 2; i++) {
    for (const d of ["1", "2", "3", "4"]) await page.keyboard.press(d);
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(600);
  const t = await page.evaluate(() => ({
    instruction: document
      .querySelector("#login-heading")
      ?.parentElement?.querySelector("p")?.textContent,
    body:
      document.querySelector(".login-mode-panel")?.textContent?.slice(0, 200) ??
      document.querySelector(".login-form")?.textContent?.slice(0, 300),
    childWidths: [...document.querySelector(".login-form").children].map((c) =>
      Math.round(c.getBoundingClientRect().width),
    ),
    kidHeights: [...document.querySelector(".login-form").children].map((c) =>
      Math.round(c.getBoundingClientRect().height),
    ),
  }));
  console.log("TURNSTILE", JSON.stringify(t, null, 1));
  await page.screenshot({ path: `${OUT}/turnstile.png` });
  await ctx.close();
}
await browser.close();
