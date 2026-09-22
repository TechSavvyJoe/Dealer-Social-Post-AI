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
  await page.waitForTimeout(400);
  return { ctx, page };
}

console.log(
  "=== reachability: scroll the pane to the end, is the footer on screen? ===",
);
for (const [w, h] of [
  [1440, 620],
  [1280, 600],
  [1280, 520],
  [1280, 505],
]) {
  const { ctx, page } = await open(w, h);
  const out = await page.evaluate(() => {
    const pane = document.querySelector(".login-access-pane");
    const h1 = document.querySelector("#login-heading");
    const top = { h1: Math.round(h1.getBoundingClientRect().top), st: pane.scrollTop };
    pane.scrollTop = pane.scrollHeight;
    const foot = document.querySelector(".login-footer-note");
    const back = document.querySelector('[aria-label="Delete last digit"]');
    return {
      top,
      end: {
        st: Math.round(pane.scrollTop),
        foot: Math.round(foot.getBoundingClientRect().bottom),
        back: Math.round(back.getBoundingClientRect().bottom),
      },
      vh: innerHeight,
    };
  });
  console.log(
    `${w}x${h} atOrigin h1Top=${out.top.h1} | scrolledToEnd footBottom=${out.end.foot} backBottom=${out.end.back} vh=${out.vh} FOOTER_REACHABLE=${out.end.foot <= out.vh}`,
  );
  await ctx.close();
}

console.log(
  "=== desktop fidelity at 1440x900 (artboard: card 1040 wide, brand col 432, column 352, keys 64, slots 56) ===",
);
{
  const { ctx, page } = await open(1440, 900);
  const m = await page.evaluate(() => {
    const pane = document.querySelector(".login-access-pane");
    const card = pane.parentElement;
    const brand = document.querySelector(".login-card-brand");
    const form = document.querySelector(".login-form");
    const r = (e) => {
      const b = e.getBoundingClientRect();
      return [Math.round(b.width), Math.round(b.height), Math.round(b.x)];
    };
    const kids = [...form.children].map((c) =>
      Math.round(c.getBoundingClientRect().width),
    );
    return {
      card: r(card),
      brand: r(brand),
      form: r(form),
      kids,
      slot: r(document.querySelector(".login-code-slot")),
      key: r(document.querySelector('[aria-label="Digit 1"]')),
      radius: getComputedStyle(card).borderRadius,
      h1: getComputedStyle(document.querySelector("#login-heading")).font,
    };
  });
  console.log(JSON.stringify(m, null, 1));
  await ctx.close();
}

console.log("=== all three modes keep one 352px column (desktop) ===");
for (const name of ["Manager username and password", "System admin"]) {
  const { ctx, page } = await open(1440, 900);
  await page.getByRole("button", { name }).click();
  await page.waitForTimeout(250);
  const w = await page.evaluate(() =>
    [...document.querySelector(".login-form").children].map((c) =>
      Math.round(c.getBoundingClientRect().width),
    ),
  );
  console.log(`${name}: childWidths=${w.join("/")}`);
  await ctx.close();
}
await browser.close();
