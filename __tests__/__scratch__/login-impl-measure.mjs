import { chromium } from "@playwright/test";
const browser = await chromium.launch();

async function open(w, h, theme = "dark") {
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
  await page.waitForTimeout(450);
  return { ctx, page };
}

const measure = (page) =>
  page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const pane = q(".login-access-pane");
    const back = document.querySelector('[aria-label="Delete last digit"]');
    const foot = q(".login-footer-note");
    const h1 = q("#login-heading");
    const seg = document.querySelector('[aria-label="Access type"] button');
    const vh = window.innerHeight;
    const r = (e) => (e ? e.getBoundingClientRect() : null);
    return {
      vh,
      paneCH: pane.clientHeight,
      paneSH: pane.scrollHeight,
      scrollable: pane.scrollHeight > pane.clientHeight + 1,
      h1Top: Math.round(r(h1).top),
      backBottom: back ? Math.round(r(back).bottom) : null,
      backH: back ? Math.round(r(back).height) : null,
      footBottom:
        foot && foot.offsetParent !== null ? Math.round(r(foot).bottom) : "hidden",
      segH: seg ? Math.round(r(seg).height) : null,
      docScroll:
        document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });

console.log("=== DESKTOP (dark) — the band the review found broken ===");
for (const [w, h] of [
  [1440, 900],
  [1366, 768],
  [1280, 680],
  [1280, 640],
  [1366, 640],
  [1440, 620],
  [1280, 600],
  [1280, 560],
  [1280, 520],
  [1280, 505],
]) {
  const { ctx, page } = await open(w, h);
  const m = await measure(page);
  const clipped =
    m.backBottom > m.vh || (m.footBottom !== "hidden" && m.footBottom > m.vh);
  console.log(
    `${w}x${h} pane ${m.paneCH}/${m.paneSH} scrollable=${m.scrollable} h1Top=${m.h1Top} backBottom=${m.backBottom} footBottom=${m.footBottom} OVERFLOW_VISIBLE=${clipped}`,
  );
  await ctx.close();
}

console.log("=== PHONE PORTRAIT (dark) — backspace must be on screen ===");
for (const [w, h] of [
  [390, 844],
  [375, 812],
  [375, 667],
  [360, 640],
  [375, 600],
  [320, 568],
  [280, 653],
]) {
  const { ctx, page } = await open(w, h);
  const m = await measure(page);
  console.log(
    `${w}x${h} vh=${m.vh} backBottom=${m.backBottom} keyH=${m.backH} footer=${m.footBottom} scrollable=${m.scrollable} OFFSCREEN=${m.backBottom > m.vh} xOverflow=${m.docScroll}`,
  );
  await ctx.close();
}

console.log("=== LANDSCAPE (dark) — gate project sizes ===");
for (const [w, h] of [
  [844, 390],
  [736, 414],
  [667, 375],
  [932, 430],
]) {
  const { ctx, page } = await open(w, h);
  const m = await measure(page);
  console.log(
    `${w}x${h} backBottom=${m.backBottom}/${m.vh} keyH=${m.backH} OFFSCREEN=${m.backBottom > m.vh} xOverflow=${m.docScroll}`,
  );
  await ctx.close();
}

console.log("=== SUNLIGHT: segment height (must be 44) + key hover tone ===");
for (const [w, h, theme] of [
  [1440, 900, "light"],
  [1440, 900, "dark"],
  [390, 844, "light"],
  [390, 844, "dark"],
]) {
  const { ctx, page } = await open(w, h, theme);
  const m = await measure(page);
  const hov = await page.evaluate(async () => {
    const k = document.querySelector('[aria-label="Digit 2"]');
    const other = document.querySelector('[aria-label="Digit 5"]');
    const card =
      document.querySelector(".login-access-pane").closest("div.flex, div.lg\\:grid") ||
      document.querySelector(".login-access-pane").parentElement;
    const cs = (e) => getComputedStyle(e);
    const rest = cs(k).backgroundColor;
    k.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    return {
      rest,
      restImg: cs(k).backgroundImage,
      neighbour: cs(other).backgroundColor,
      card: cs(card).backgroundColor,
      switchShadow: cs(document.querySelector(".login-switch")).boxShadow,
      switchBorder: cs(document.querySelector(".login-switch")).borderTopWidth,
    };
  });
  // real hover via mouse
  await page.getByRole("button", { name: "Digit 2" }).hover();
  await page.waitForTimeout(120);
  const hovered = await page.evaluate(() => {
    const k = document.querySelector('[aria-label="Digit 2"]');
    return {
      bg: getComputedStyle(k).backgroundColor,
      img: getComputedStyle(k).backgroundImage,
    };
  });
  console.log(
    `${theme} ${w}x${h} segH=${m.segH} rest=${hov.rest} hover=${hovered.bg} hoverImg=${hovered.img.slice(0, 60)} card=${hov.card} switchBorder=${hov.switchBorder} switchShadow=${hov.switchShadow.slice(0, 50)}`,
  );
  await ctx.close();
}

await browser.close();
