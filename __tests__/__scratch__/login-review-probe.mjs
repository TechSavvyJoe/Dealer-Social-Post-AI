import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const OUT =
  "/private/tmp/claude-501/-Users-joegallant-AI-App-Development-Projects-Dealer-Social-Post-AI/996abc7b-e0db-493b-a0a3-9b6d1370243e/scratchpad/login-review";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

async function open(theme, w, h) {
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
  await page
    .getByRole("heading", { name: /^sign in$/i })
    .waitFor({ timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(600);
  return { ctx, page };
}

// 1. Clip threshold on desktop: where does the access pane start to overflow,
//    and is the footer note whole?
console.log("--- desktop clip threshold (1366 wide) ---");
for (const h of [820, 800, 780, 760, 740, 720, 700, 678, 650]) {
  const { ctx, page } = await open("dark", 1366, h);
  const r = await page.evaluate(() => {
    const pane = document.querySelector(".login-access-pane");
    const note = document.querySelector(".login-footer-note");
    const keys = [...document.querySelectorAll(".login-key")];
    const pr = pane.getBoundingClientRect();
    const nr = note?.getBoundingClientRect();
    const lastKey = keys[keys.length - 1]?.getBoundingClientRect();
    return {
      client: pane.clientHeight,
      scroll: pane.scrollHeight,
      hidden: pane.scrollHeight - pane.clientHeight,
      noteWhollyInside: nr ? nr.bottom <= pr.bottom + 0.5 : null,
      noteClippedBy: nr ? Math.round(nr.bottom - pr.bottom) : null,
      lastKeyClippedBy: lastKey ? Math.round(lastKey.bottom - pr.bottom) : null,
    };
  });
  console.log(h, JSON.stringify(r));
  await ctx.close();
}

// 2. Key fill colour off-glyph, hover vs active, both themes.
console.log("--- key fill sample (off-glyph) ---");
for (const theme of ["dark", "light"]) {
  const { ctx, page } = await open(theme, 1440, 900);
  const key = page.locator(".login-key").first();
  const b = await key.boundingBox();
  const sample = async (tag) => {
    const buf = await page.screenshot({
      clip: { x: b.x + 6, y: b.y + 6, width: 8, height: 8 },
    });
    const { createHash } = await import("node:crypto");
    return { tag, hash: createHash("md5").update(buf).digest("hex").slice(0, 8) };
  };
  const css = () =>
    key.evaluate((el) => {
      const s = getComputedStyle(el);
      return `${s.backgroundColor} | img=${s.backgroundImage}`;
    });
  console.log(theme, "rest ", await css(), JSON.stringify(await sample("rest")));
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(220);
  console.log(theme, "hover", await css(), JSON.stringify(await sample("hover")));
  await page.mouse.down();
  await page.waitForTimeout(220);
  console.log(theme, "active", await css(), JSON.stringify(await sample("active")));
  await page.mouse.up();
  // Keyboard-driven press (no hover): does the tint appear then?
  await page.mouse.move(10, 10);
  await page.waitForTimeout(150);
  console.log(theme, "no-hover rest", await css());
  await ctx.close();
}

// 3. Short-portrait tiers actually engage, keys never shrink.
console.log("--- short portrait tiers ---");
for (const [w, h] of [
  [390, 844],
  [375, 812],
  [375, 667],
  [360, 640],
  [320, 568],
]) {
  const { ctx, page } = await open("dark", w, h);
  const r = await page.evaluate(() => {
    const keys = [...document.querySelectorAll(".login-key")];
    const slot = document.querySelector(".login-code-slot");
    const label = document.querySelector(".login-code-label");
    const note = document.querySelector(".login-footer-note");
    const logo = document.querySelector(".login-mobile-logo");
    return {
      keyH: keys[0]?.getBoundingClientRect().height,
      slotH: slot?.getBoundingClientRect().height,
      label: label ? getComputedStyle(label).display : "absent",
      note: note ? getComputedStyle(note).display : "absent",
      logo: logo ? getComputedStyle(logo).display : "absent",
      lastKeyBottom: keys[keys.length - 1]?.getBoundingClientRect().bottom,
      vh: innerHeight,
      overflowX:
        document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
  console.log(w + "x" + h, JSON.stringify(r));
  await page.screenshot({ path: `${OUT}/portrait-${w}x${h}.png` });
  await ctx.close();
}

await browser.close();
