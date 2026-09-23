import { chromium } from "@playwright/test";
const OUT =
  "/private/tmp/claude-501/-Users-joegallant-AI-App-Development-Projects-Dealer-Social-Post-AI/996abc7b-e0db-493b-a0a3-9b6d1370243e/scratchpad/shots";
const browser = await chromium.launch();
for (const [theme, dsf] of [
  ["dark", 1],
  ["light", 1],
  ["dark", 2],
]) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: dsf,
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  await page.addInitScript((t) => {
    localStorage.setItem("dealer-social-post-ai.session", JSON.stringify({ theme: t }));
  }, theme);
  await page.route("**/api/**", (r) =>
    r.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ message: "Invalid sign-in credentials." }),
    }),
  );
  await page.goto("http://localhost:5173/");
  await page.getByRole("heading", { name: /^sign in$/i }).waitFor({ timeout: 20000 });
  await page.keyboard.press("1");
  await page.keyboard.press("2");
  await page.waitForTimeout(400);
  const slots = await page.evaluate(() =>
    [...document.querySelectorAll(".login-code-slot")].map(
      (el) =>
        `${getComputedStyle(el).borderTopWidth}/${getComputedStyle(el).borderTopColor}/dot:${el.children.length}`,
    ),
  );
  console.log(`SLOTS ${theme} dsf${dsf}`, JSON.stringify(slots));

  await page.hover(".login-key");
  await page.waitForTimeout(350);
  const hov = await page.evaluate(() => {
    const k = document.querySelector(".login-key");
    const card = document.querySelector(".login-card-brand").parentElement;
    const sw = document.querySelector(".login-switch");
    return {
      hoverKeyBg: getComputedStyle(k).backgroundColor,
      cardBg: getComputedStyle(card).backgroundColor,
      switchBg: getComputedStyle(sw).backgroundColor,
      keyTransition: getComputedStyle(k).transitionProperty,
    };
  });
  console.log(`HOVER ${theme} dsf${dsf}`, JSON.stringify(hov));
  await ctx.close();
}

// modes + turnstile + lockout at 1440x900 dark
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  reducedMotion: "reduce",
});
const page = await ctx.newPage();
let attempts = 0;
await page.route("**/api/**", async (route) => {
  const req = route.request();
  if (req.method() === "POST") {
    attempts++;
    if (attempts === 3)
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
  return route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
});
await page.goto("http://localhost:5173/");
await page.getByRole("heading", { name: /^sign in$/i }).waitFor({ timeout: 20000 });

for (const label of ["My code", "Manager", "System"]) {
  await page
    .getByRole("button", {
      name: new RegExp(label === "My code" ? "^My code$" : label, "i"),
    })
    .first()
    .click()
    .catch(() => {});
  await page.waitForTimeout(250);
  const info = await page.evaluate(() => {
    const form = document.querySelector(".login-form");
    const kids = [...form.children].map((c) =>
      Math.round(c.getBoundingClientRect().width),
    );
    const panel = document.querySelector(".login-mode-panel");
    return {
      instruction: document
        .querySelector("#login-heading")
        .parentElement.querySelector("p").textContent,
      h2: panel?.querySelector("h2")?.textContent ?? null,
      childWidths: kids,
      panelBox: panel
        ? {
            w: Math.round(panel.getBoundingClientRect().width),
            h: Math.round(panel.getBoundingClientRect().height),
          }
        : null,
      inputs: [...(panel?.querySelectorAll("input") ?? [])].map((i) => ({
        name: i.name || i.id,
        w: Math.round(i.getBoundingClientRect().width),
        type: i.type,
        label: document.querySelector(`label[for="${i.id}"]`)?.textContent?.trim(),
      })),
      buttons: [...(panel?.querySelectorAll("button") ?? [])].map(
        (b) => `${b.textContent.trim()}|${Math.round(b.getBoundingClientRect().width)}`,
      ),
      pressed: [
        ...document.querySelectorAll('[role="group"][aria-label="Access type"] button'),
      ].map((b) => `${b.textContent}:${b.getAttribute("aria-pressed")}`),
    };
  });
  console.log(`MODE ${label}`, JSON.stringify(info, null, 1));
  await page.screenshot({ path: `${OUT}/mode-${label.replace(/\s/g, "")}.png` });
}
await browser.close();
