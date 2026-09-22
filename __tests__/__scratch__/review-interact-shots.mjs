import { chromium } from "@playwright/test";
const OUT =
  "/private/tmp/claude-501/-Users-joegallant-AI-App-Development-Projects-Dealer-Social-Post-AI/996abc7b-e0db-493b-a0a3-9b6d1370243e/scratchpad/shots";
const browser = await chromium.launch();
const mk = async (theme, w, h) => {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  await page.addInitScript((t) => {
    localStorage.setItem("dealer-social-post-ai.session", JSON.stringify({ theme: t }));
  }, theme);
  return { ctx, page };
};

// 1. clipping screenshots
for (const [w, h] of [
  [1280, 600],
  [1280, 520],
]) {
  const { ctx, page } = await mk("dark", w, h);
  await page.route("**/api/**", (r) =>
    r.fulfill({ status: 401, contentType: "application/json", body: "{}" }),
  );
  await page.goto("http://localhost:5173/");
  await page
    .getByRole("heading", { name: /^sign in$/i })
    .waitFor({ timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/clipshot-${w}x${h}.png` });
  // can the user scroll the pane to reach the top?
  const res = await page.evaluate(() => {
    const p = document.querySelector(".login-access-pane");
    p.scrollTop = -9999;
    const atTopAttempt = p.scrollTop;
    p.scrollTop = 0;
    const h1 = document.querySelector("#login-heading").getBoundingClientRect();
    return {
      scrollTop: p.scrollTop,
      minScrollTop: atTopAttempt,
      h1Top: Math.round(h1.top),
      paneTop: Math.round(p.getBoundingClientRect().top),
      justify: getComputedStyle(p).justifyContent,
    };
  });
  console.log(`CLIP ${w}x${h}`, JSON.stringify(res));
  await ctx.close();
}

// 2. behaviour: keyboard entry, modes, focus order, hover colours
for (const theme of ["dark", "light"]) {
  const { ctx, page } = await mk(theme, 1440, 900);
  let attempts = 0;
  await page.route("**/api/**", async (r) => {
    const u = r.request().url();
    if (u.includes("/api/")) {
      attempts++;
      return r.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ message: "Invalid sign-in credentials." }),
      });
    }
    return r.continue();
  });
  await page.goto("http://localhost:5173/");
  await page.getByRole("heading", { name: /^sign in$/i }).waitFor({ timeout: 20000 });

  // a11y names
  const names = await page.evaluate(() => ({
    h1: document.querySelector("#login-heading")?.textContent,
    group: document.querySelector('[role="group"][aria-label="Access type"]')
      ? "yes"
      : "no",
    pressed: [
      ...document.querySelectorAll('[role="group"][aria-label="Access type"] button'),
    ].map((b) => `${b.textContent}:${b.getAttribute("aria-pressed")}`),
    status: document
      .querySelector('[role="status"][aria-label]')
      ?.getAttribute("aria-label"),
    srtext: document.querySelector('[role="status"][aria-label] .sr-only')?.textContent,
    keypadGroup: document.querySelector(
      '[role="group"][aria-label="Four digit access code keypad"]',
    )
      ? "yes"
      : "no",
    keyNames: [...document.querySelectorAll(".login-key")].map((b) =>
      b.getAttribute("aria-label"),
    ),
    instruction: document
      .querySelector("#login-heading")
      ?.parentElement?.querySelector("p")?.textContent,
  }));
  console.log(`A11Y ${theme}`, JSON.stringify(names));

  // hover colour of a key
  await page.hover(".login-key");
  const hover = await page.evaluate(() => {
    const k = document.querySelector(".login-key");
    const card = document.querySelector(".login-card-brand").parentElement;
    return {
      keyBg: getComputedStyle(k).backgroundColor,
      cardBg: getComputedStyle(card).backgroundColor,
      keyBorder:
        getComputedStyle(k).borderTopColor + " " + getComputedStyle(k).borderTopWidth,
    };
  });
  console.log(`HOVER ${theme}`, JSON.stringify(hover));

  // keyboard typing fills wells
  await page.keyboard.press("1");
  await page.keyboard.press("2");
  const after2 = await page.evaluate(() => ({
    status: document
      .querySelector('[role="status"][aria-label]')
      ?.getAttribute("aria-label"),
    filled: [...document.querySelectorAll(".login-code-slot")].map(
      (s) => s.children.length,
    ),
    brandEdge: [...document.querySelectorAll(".login-code-slot")].map(
      (s) => getComputedStyle(s).borderTopWidth,
    ),
  }));
  console.log(`TYPE2 ${theme}`, JSON.stringify(after2));
  await page.keyboard.press("Backspace");
  const afterBs = await page.evaluate(() =>
    document.querySelector('[role="status"][aria-label]')?.getAttribute("aria-label"),
  );
  console.log(`BKSP ${theme}`, afterBs);

  // tab order
  const order = await page.evaluate(async () => {
    const seq = [];
    document.body.focus();
    return seq;
  });
  const tabs = [];
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("Tab");
    tabs.push(
      await page.evaluate(() => {
        const a = document.activeElement;
        return a
          ? `${a.tagName}:${a.getAttribute("aria-label") || a.textContent?.trim().slice(0, 24)}`
          : "none";
      }),
    );
  }
  console.log(`TAB ${theme}`, JSON.stringify(tabs));

  // switch to manager
  await page.getByRole("button", { name: "Dealership manager" }).click();
  await page.waitForTimeout(200);
  const mgr = await page.evaluate(() => ({
    instruction: document
      .querySelector("#login-heading")
      ?.parentElement?.querySelector("p")?.textContent,
    h2: document.querySelector(".login-mode-panel h2")?.textContent,
    labels: [...document.querySelectorAll(".login-mode-panel label")].map((l) =>
      l.textContent.trim(),
    ),
    submit: [...document.querySelectorAll(".login-mode-panel button")].map((b) =>
      b.textContent.trim(),
    ),
    widths: [...document.querySelector(".login-form").children].map((c) =>
      Math.round(c.getBoundingClientRect().width),
    ),
  }));
  console.log(`MGR ${theme}`, JSON.stringify(mgr));
  await page.screenshot({ path: `${OUT}/mgr-${theme}.png` });

  await page.getByRole("button", { name: "System admin" }).click();
  await page.waitForTimeout(200);
  const sys = await page.evaluate(() => ({
    instruction: document
      .querySelector("#login-heading")
      ?.parentElement?.querySelector("p")?.textContent,
    h2: document.querySelector(".login-mode-panel h2")?.textContent,
  }));
  console.log(`SYS ${theme}`, JSON.stringify(sys));
  await page.screenshot({ path: `${OUT}/sys-${theme}.png` });
  await ctx.close();
}
await browser.close();
