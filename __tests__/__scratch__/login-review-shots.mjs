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
  await page.waitForTimeout(700);
  return { ctx, page };
}

const measure = async (page) =>
  page.evaluate(() => {
    const px = (v) => Math.round(parseFloat(v) * 100) / 100;
    const g = (el) => (el ? getComputedStyle(el) : null);
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { w: px(r.width), h: px(r.height), x: px(r.left), y: px(r.top) };
    };
    const card = document.querySelector(".login-access-pane")?.parentElement;
    const brand = document.querySelector(".login-card-brand");
    const pane = document.querySelector(".login-access-pane");
    const form = document.querySelector(".login-form");
    const h1 = document.querySelector("#login-heading");
    const tagline = brand?.querySelector("p");
    const sw = document.querySelector(".login-switch");
    const seg = sw?.querySelector("button");
    const segSel = sw
      ? [...sw.querySelectorAll("button")].find(
          (b) => b.getAttribute("aria-pressed") === "true",
        )
      : null;
    const label = document.querySelector(".login-code-label");
    const slots = [...document.querySelectorAll(".login-code-slot")];
    const slotRow = slots[0]?.parentElement;
    const keypad = document.querySelector(".login-keypad");
    const keys = [...document.querySelectorAll(".login-key")];
    const note = document.querySelector(".login-footer-note");
    const cs = g(card);
    const bs = g(brand);
    const ps = g(pane);
    const fs_ = g(form);
    const hs = g(h1);
    const ts = g(tagline);
    const ss = g(sw);
    const segs = g(seg);
    const segSs = g(segSel);
    const ls = g(label);
    const sl0 = g(slots[0]);
    const sl1 = g(slots[slots.length - 1]);
    const dot = slots.map((s) => s.querySelector("span")).find(Boolean);
    const ds = g(dot);
    const kps = g(keypad);
    const k0 = g(keys[0]);
    const ns = g(note);
    return {
      viewport: { w: innerWidth, h: innerHeight },
      theme: document.documentElement.className || document.body.className,
      card: card
        ? {
            ...box(card),
            radius: cs.borderTopLeftRadius,
            border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
            shadow: cs.boxShadow,
            bg: cs.backgroundColor,
            overflow: cs.overflow,
            gridCols: cs.gridTemplateColumns,
            gridRows: cs.gridTemplateRows,
            maxH: cs.maxHeight,
            minH: cs.minHeight,
          }
        : null,
      brand: brand ? { ...box(brand), bg: bs.backgroundColor, pad: bs.padding } : null,
      pane: pane
        ? {
            ...box(pane),
            pad: ps.padding,
            justify: ps.justifyContent,
            overflowY: ps.overflowY,
            client: pane.clientHeight,
            scroll: pane.scrollHeight,
            scrollTop: pane.scrollTop,
          }
        : null,
      form: form
        ? { ...box(form), rowGap: fs_.rowGap, rows: fs_.gridTemplateRows }
        : null,
      formChildWidths: form
        ? [...form.children].map((c) => px(c.getBoundingClientRect().width))
        : null,
      h1: h1
        ? {
            ...box(h1),
            size: hs.fontSize,
            lh: hs.lineHeight,
            weight: hs.fontWeight,
            ls: hs.letterSpacing,
            family: hs.fontFamily.split(",")[0],
            color: hs.color,
          }
        : null,
      tagline: tagline
        ? {
            ...box(tagline),
            size: ts.fontSize,
            lh: ts.lineHeight,
            weight: ts.fontWeight,
            ls: ts.letterSpacing,
            maxW: ts.maxWidth,
            parentMaxW: g(tagline.parentElement).maxWidth,
            color: ts.color,
          }
        : null,
      switch: sw
        ? {
            ...box(sw),
            radius: ss.borderTopLeftRadius,
            pad: ss.padding,
            gap: ss.gap,
            bg: ss.backgroundColor,
            border: `${ss.borderTopWidth} ${ss.borderTopStyle}`,
            shadow: ss.boxShadow,
          }
        : null,
      segment: seg
        ? {
            ...box(seg),
            radius: segs.borderTopLeftRadius,
            size: segs.fontSize,
            weight: segs.fontWeight,
          }
        : null,
      segmentSelected: segSel
        ? {
            ...box(segSel),
            bg: segSs.backgroundColor,
            color: segSs.color,
            weight: segSs.fontWeight,
          }
        : null,
      codeLabel: label
        ? {
            ...box(label),
            size: ls.fontSize,
            lh: ls.lineHeight,
            weight: ls.fontWeight,
            display: ls.display,
            color: ls.color,
          }
        : null,
      slotRow: slotRow ? { ...box(slotRow), gap: g(slotRow).columnGap } : null,
      slotFirst: sl0
        ? {
            ...box(slots[0]),
            h: px(sl0.height),
            radius: sl0.borderTopLeftRadius,
            border: `${sl0.borderTopWidth} ${sl0.borderTopColor}`,
            bg: sl0.backgroundColor,
          }
        : null,
      slotLast: sl1
        ? {
            ...box(slots[slots.length - 1]),
            border: `${sl1.borderTopWidth} ${sl1.borderTopColor}`,
          }
        : null,
      dot: ds
        ? { ...box(dot), bg: ds.backgroundColor, radius: ds.borderTopLeftRadius }
        : null,
      keypad: keypad ? { ...box(keypad), gap: kps.gap } : null,
      key0: k0
        ? {
            ...box(keys[0]),
            size: k0.fontSize,
            lh: k0.lineHeight,
            weight: k0.fontWeight,
            family: k0.fontFamily.split(",")[0],
            border: `${k0.borderTopWidth} ${k0.borderTopStyle} ${k0.borderTopColor}`,
            bg: k0.backgroundColor,
            bgImage: k0.backgroundImage,
            radius: k0.borderTopLeftRadius,
            color: k0.color,
          }
        : null,
      keyWidths: [...new Set(keys.map((k) => px(k.getBoundingClientRect().width)))],
      keyHeights: [...new Set(keys.map((k) => px(k.getBoundingClientRect().height)))],
      note: note
        ? { ...box(note), size: ns.fontSize, color: ns.color, display: ns.display }
        : null,
      docOverflowX:
        document.documentElement.scrollWidth > document.documentElement.clientWidth,
      bottomKeyVisible: keys.length
        ? keys[keys.length - 1].getBoundingClientRect().bottom <= innerHeight + 0.5
        : null,
    };
  });

const results = {};

for (const [name, theme, w, h] of [
  ["desk-dark", "dark", 1440, 900],
  ["desk-light", "light", 1440, 900],
  ["phone", "dark", 390, 844],
  ["phone-light", "light", 390, 844],
  ["land", "dark", 844, 390],
  ["laptop-short", "dark", 1366, 650],
]) {
  const { ctx, page } = await open(theme, w, h);
  results[name] = await measure(page);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  await ctx.close();
}

// Key hover / active behaviour in BOTH themes (the Sunlight override round).
for (const theme of ["dark", "light"]) {
  const { ctx, page } = await open(theme, 1440, 900);
  const key = page.locator(".login-key").first();
  const b = await key.boundingBox();
  const read = () =>
    key.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        bg: s.backgroundColor,
        bgImage: s.backgroundImage,
        border: s.borderTopWidth + " " + s.borderTopColor,
      };
    });
  results[`key-${theme}-rest`] = await read();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(250);
  results[`key-${theme}-hover`] = await read();
  await page.screenshot({ path: `${OUT}/key-${theme}-hover.png` });
  await page.mouse.down();
  await page.waitForTimeout(250);
  results[`key-${theme}-active`] = await read();
  await page.screenshot({ path: `${OUT}/key-${theme}-active.png` });
  await page.mouse.up();
  await ctx.close();
}

// Manager + System modes, and the filled-code state, at desktop light.
{
  const { ctx, page } = await open("light", 1440, 900);
  for (const digit of ["1", "2"]) await page.keyboard.press(digit);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/desk-light-code-partial.png` });
  results["code-partial"] = await measure(page);
  await page.getByRole("button", { name: /manager username/i }).click();
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}/desk-light-manager.png` });
  await page.getByRole("button", { name: /system admin/i }).click();
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}/desk-light-system.png` });
  await ctx.close();
}

console.log(JSON.stringify(results, null, 2));
await browser.close();
