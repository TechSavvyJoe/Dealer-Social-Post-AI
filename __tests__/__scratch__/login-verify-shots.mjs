import { chromium } from "@playwright/test";

const OUT =
  "/private/tmp/claude-501/-Users-joegallant-AI-App-Development-Projects-Dealer-Social-Post-AI/996abc7b-e0db-493b-a0a3-9b6d1370243e/scratchpad";

const HELPERS = () => {
  window.__lum = (c) => {
    const [r, g, b] = c;
    const f = (v) => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  window.__parse = (s) => {
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1]
      .split(/[,\s/]+/)
      .filter(Boolean)
      .map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  window.__bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = window.__parse(getComputedStyle(n).backgroundColor);
      if (c && c[3] > 0.99) return c;
      n = n.parentElement;
    }
    const c = window.__parse(getComputedStyle(document.body).backgroundColor);
    return c || [0, 0, 0, 1];
  };
  window.__ratio = (el) => {
    const cs = getComputedStyle(el);
    const fg = window.__parse(cs.color);
    const op = parseFloat(cs.opacity);
    const bg = window.__bgOf(el);
    // flatten fg alpha + element opacity over bg
    const a = (fg[3] ?? 1) * (isNaN(op) ? 1 : op);
    const eff = [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a));
    const l1 = window.__lum(eff);
    const l2 = window.__lum(bg);
    const hi = Math.max(l1, l2),
      lo = Math.min(l1, l2);
    return {
      ratio: +((hi + 0.05) / (lo + 0.05)).toFixed(2),
      fg: eff.map((v) => Math.round(v)).join(","),
      bg: bg.slice(0, 3).join(","),
      px: cs.fontSize,
      weight: cs.fontWeight,
    };
  };
};

const ctxFor = async (browser, w, h, theme, rm = "reduce") => {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 1,
    reducedMotion: rm,
  });
  const page = await ctx.newPage();
  await page.route("**/api/**", (r) =>
    r.fulfill({ status: 401, contentType: "application/json", body: "{}" }),
  );
  await page.addInitScript((t) => {
    localStorage.setItem("dealer-social-post-ai.session", JSON.stringify({ theme: t }));
  }, theme);
  await page.addInitScript(HELPERS);
  await page.goto("http://localhost:5173/");
  await page.getByRole("heading", { name: /^sign in$/i }).waitFor({ timeout: 20000 });
  await page.waitForTimeout(500);
  return { ctx, page };
};

const log = (...a) => console.log(...a);

for (const theme of ["dark", "light"]) {
  const browser = await chromium.launch();
  log(`\n################ THEME=${theme} ################`);

  // ---------- A. desktop geometry + contrast ----------
  {
    const { ctx, page } = await ctxFor(browser, 1440, 900, theme);
    const themeClass = await page.evaluate(() => document.documentElement.className);
    log(`htmlClass="${themeClass}"`);

    const geo = await page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const r = (el) => {
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return {
          w: +b.width.toFixed(1),
          h: +b.height.toFixed(1),
          x: +b.x.toFixed(1),
          y: +b.y.toFixed(1),
        };
      };
      const card = q(".login-card-brand")?.parentElement;
      const seg = document.querySelector('[aria-label="Access type"] button');
      const key = q(".login-key");
      return {
        card: r(card),
        cardRadius: card ? getComputedStyle(card).borderRadius : null,
        brand: r(q(".login-card-brand")),
        pane: r(q(".login-access-pane")),
        form: r(q(".login-form")),
        switchTrack: r(q(".login-switch")),
        segment: r(seg),
        segBoxSizing: seg ? getComputedStyle(seg).boxSizing : null,
        slot: r(q(".login-code-slot")),
        key: r(key),
        keyBorder: key ? getComputedStyle(key).borderWidth : null,
        keyBg: key ? getComputedStyle(key).backgroundColor : null,
        keypad: r(q(".login-keypad")),
        paneScroll: (() => {
          const p = q(".login-access-pane");
          return p ? { c: p.clientHeight, s: p.scrollHeight } : null;
        })(),
      };
    });
    log("GEO", JSON.stringify(geo));

    const contrast = await page.evaluate(() => {
      const out = {};
      const add = (name, sel) => {
        const el = document.querySelector(sel);
        out[name] = el ? window.__ratio(el) : "MISSING";
      };
      add("instruction(15px ink-2)", ".login-form p.text-\\[15px\\]");
      add("codeLabel(13px ink-2)", ".login-code-label");
      add("footerNote(ink-hint)", ".login-footer-note");
      add("h1", "#login-heading");
      // unselected segment (3rd = System)
      const segs = [...document.querySelectorAll('[aria-label="Access type"] button')];
      out["segSelected"] = window.__ratio(segs[0]);
      out["segUnselected"] = window.__ratio(segs[2]);
      // brand column copy
      const bp = [...document.querySelectorAll(".login-card-brand p")];
      out["brandHeadline"] = bp[0] ? window.__ratio(bp[0]) : "MISSING";
      out["brandSub(opacity80)"] = bp[1] ? window.__ratio(bp[1]) : "MISSING";
      // key numeral
      out["keyNumeral"] = window.__ratio(document.querySelector(".login-key"));
      // backspace icon colour vs key bg (non-text 3:1)
      const icon = document.querySelector('[aria-label="Delete last digit"] svg');
      if (icon) {
        const cs = getComputedStyle(icon);
        const fg = window.__parse(cs.color);
        const bg = window.__bgOf(icon.parentElement);
        const l1 = window.__lum(fg),
          l2 = window.__lum(bg);
        out["backspaceIcon"] = {
          ratio: +((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2),
          fg: fg.slice(0, 3).join(","),
          bg: bg.slice(0, 3).join(","),
        };
      }
      // active slot border vs slot bg (non-text 3:1)
      const slot = document.querySelector(".login-code-slot");
      if (slot) {
        const cs = getComputedStyle(slot);
        const bc = window.__parse(cs.borderTopColor);
        const bg = window.__bgOf(slot.parentElement);
        const l1 = window.__lum(bc),
          l2 = window.__lum(bg);
        out["activeSlotBorder"] = {
          ratio: +((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2),
          width: cs.borderTopWidth,
          color: bc.slice(0, 3).join(","),
          bg: bg.slice(0, 3).join(","),
        };
      }
      return out;
    });
    log("CONTRAST", JSON.stringify(contrast, null, 1));

    // ---------- B. key hover / active ----------
    const keyBox = await page.locator('[aria-label="Digit 5"]').boundingBox();
    const read = () =>
      page.evaluate(() => {
        const k = document.querySelector('[aria-label="Digit 5"]');
        const cs = getComputedStyle(k);
        return {
          bgColor: cs.backgroundColor,
          bgImage: cs.backgroundImage.slice(0, 60),
          border: cs.borderTopWidth + " " + cs.borderTopColor,
        };
      });
    log("KEY rest  ", JSON.stringify(await read()));
    await page.mouse.move(keyBox.x + keyBox.width / 2, keyBox.y + keyBox.height / 2);
    await page.waitForTimeout(200);
    log("KEY hover ", JSON.stringify(await read()));
    await page.mouse.down();
    await page.waitForTimeout(200);
    log("KEY active", JSON.stringify(await read()));
    await page.mouse.up();
    await page.waitForTimeout(150);

    // segment hover
    const segBox = await page
      .getByRole("button", { name: "System admin" })
      .boundingBox();
    await page.mouse.move(segBox.x + segBox.width / 2, segBox.y + segBox.height / 2);
    await page.waitForTimeout(200);
    log(
      "SEG hover ",
      await page.evaluate(() => {
        const s = document.querySelectorAll('[aria-label="Access type"] button')[2];
        const cs = getComputedStyle(s);
        return JSON.stringify({ color: cs.color, bg: cs.backgroundColor });
      }),
    );
    await page.mouse.move(5, 5);

    // ---------- D. keyboard-only ----------
    const order = [];
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      order.push(
        await page.evaluate(() => {
          const a = document.activeElement;
          if (!a) return "none";
          return (
            (a.getAttribute("aria-label") || a.textContent || a.tagName)
              .trim()
              .slice(0, 34) +
            " | outline:" +
            getComputedStyle(a).outline +
            " | ariaPressed:" +
            a.getAttribute("aria-pressed")
          );
        }),
      );
    }
    log("TAB ORDER", JSON.stringify(order, null, 1));

    // keyboard digits + status text
    await page.keyboard.press("2");
    await page.keyboard.press("7");
    await page.waitForTimeout(150);
    log(
      "STATUS after 2 digits:",
      await page.evaluate(() => {
        const r = document.querySelector('[role="status"][aria-label]');
        return JSON.stringify({
          label: r?.getAttribute("aria-label"),
          srText: r?.querySelector(".sr-only")?.textContent,
          filled: [...document.querySelectorAll(".login-code-slot")]
            .map((s) => (s.children.length ? "•" : "_"))
            .join(""),
          activeBorder: [...document.querySelectorAll(".login-code-slot")]
            .map((s) => getComputedStyle(s).borderTopWidth)
            .join("/"),
        });
      }),
    );
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(120);
    log(
      "STATUS after backspace:",
      await page.evaluate(() =>
        document
          .querySelector('[role="status"][aria-label]')
          ?.getAttribute("aria-label"),
      ),
    );

    await page.screenshot({ path: `${OUT}/vfy-${theme}-desk.png` });
    await ctx.close();
  }

  // ---------- E. short desktop ----------
  for (const [w, h] of [
    [1366, 638],
    [1280, 600],
    [1280, 520],
  ]) {
    const { ctx, page } = await ctxFor(browser, w, h, theme);
    const info = await page.evaluate(() => {
      const pane = document.querySelector(".login-access-pane");
      const card = document.querySelector(".login-card-brand")?.parentElement;
      const h1 = document.querySelector("#login-heading");
      const cb = card.getBoundingClientRect();
      return {
        card: { h: +cb.height.toFixed(0), y: +cb.y.toFixed(0) },
        pane: { c: pane.clientHeight, s: pane.scrollHeight },
        h1TopInPane: +(
          h1.getBoundingClientRect().top -
          pane.getBoundingClientRect().top +
          pane.scrollTop
        ).toFixed(0),
        justify: getComputedStyle(pane).justifyContent,
      };
    });
    // scroll to bottom, check footer note on screen
    const end = await page.evaluate(() => {
      const pane = document.querySelector(".login-access-pane");
      pane.scrollTop = pane.scrollHeight;
      const note = document.querySelector(".login-footer-note");
      const bs = document.querySelector('[aria-label="Delete last digit"]');
      const pr = pane.getBoundingClientRect();
      const inside = (el) => {
        if (!el || getComputedStyle(el).display === "none") return "hidden";
        const r = el.getBoundingClientRect();
        return r.top >= pr.top - 1 && r.bottom <= pr.bottom + 1 ? "yes" : "NO";
      };
      return { noteOnScreen: inside(note), backspaceOnScreen: inside(bs) };
    });
    log(`SHORT-DESK ${w}x${h}`, JSON.stringify({ ...info, ...end }));
    await page.screenshot({ path: `${OUT}/vfy-${theme}-${w}x${h}.png` });
    await ctx.close();
  }

  // ---------- F. phones ----------
  for (const [w, h] of [
    [390, 844],
    [375, 667],
    [360, 640],
    [320, 568],
    [280, 653],
    [844, 390],
  ]) {
    const { ctx, page } = await ctxFor(browser, w, h, theme);
    const info = await page.evaluate(() => {
      const pane = document.querySelector(".login-access-pane");
      const key = document.querySelector(".login-key");
      const bs = document.querySelector('[aria-label="Delete last digit"]');
      const slot = document.querySelector(".login-code-slot");
      const seg = document.querySelector('[aria-label="Access type"] button');
      const vis = (s) => {
        const el = document.querySelector(s);
        return el ? getComputedStyle(el).display !== "none" : "missing";
      };
      return {
        hOverflow:
          document.documentElement.scrollWidth > document.documentElement.clientWidth,
        keyH: +key.getBoundingClientRect().height.toFixed(1),
        segH: +seg.getBoundingClientRect().height.toFixed(1),
        slotH: +slot.getBoundingClientRect().height.toFixed(1),
        bsBottom: +bs.getBoundingClientRect().bottom.toFixed(0),
        vh: window.innerHeight,
        paneScroll: { c: pane.clientHeight, s: pane.scrollHeight },
        label: vis(".login-code-label"),
        note: vis(".login-footer-note"),
        logo: vis(".login-mobile-logo"),
      };
    });
    log(`PHONE ${w}x${h}`, JSON.stringify(info));
    await page.screenshot({ path: `${OUT}/vfy-${theme}-${w}x${h}.png` });
    await ctx.close();
  }

  await browser.close();
}
console.log("\nDONE");
