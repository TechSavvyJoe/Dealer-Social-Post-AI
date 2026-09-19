// Renders public/dealer-social-og-v4.png (1200x630) for link previews from the brand
// mark and the app's own webfont. Sharp cannot load Barlow, so the card is a
// tiny HTML page screenshotted with the Playwright Chromium already in the
// repo's devDependencies. Run: node scripts/render-og-image.mjs
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const font = (pkg, file) =>
  `url(data:font/woff2;base64,${readFileSync(
    resolve(root, "node_modules/@fontsource", pkg, "files", file),
  ).toString("base64")}) format("woff2")`;
const mark = readFileSync(resolve(root, "public/dsp-brand-mark-v4.svg"), "utf8");

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:"Barlow Semi Condensed";font-weight:600;src:${font("barlow-semi-condensed", "barlow-semi-condensed-latin-600-normal.woff2")}}
@font-face{font-family:"Barlow";font-weight:400;src:${font("barlow", "barlow-latin-400-normal.woff2")}}
html,body{margin:0;width:1200px;height:630px;background:#121416;color:#f0f2f4;overflow:hidden}
.card{position:relative;width:1200px;height:630px;display:flex;flex-direction:column;justify-content:space-between;padding:88px 96px;box-sizing:border-box}
.mark{width:168px;height:168px}
h1{margin:0;font:600 76px/1 "Barlow Semi Condensed",sans-serif;letter-spacing:-0.01em}
p{margin:18px 0 0;font:400 32px/1.3 "Barlow",sans-serif;color:#b2bac2}
.rule{position:absolute;left:96px;right:96px;bottom:60px;height:1px;background:#2f3439}
</style></head><body><div class="card"><div class="mark">${mark.replace('width="120" height="120"', 'width="168" height="168"')}</div><div><h1>Dealer Social Post AI</h1><p>Dealership photos, ready to post.</p></div><div class="rule"></div></div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 1,
});
await page.setContent(html, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
const png = await page.screenshot({
  type: "png",
  clip: { x: 0, y: 0, width: 1200, height: 630 },
});
await browser.close();
writeFileSync(resolve(root, "public/dealer-social-og-v4.png"), png);
console.log(`wrote public/dealer-social-og-v4.png (${png.length} bytes)`);
