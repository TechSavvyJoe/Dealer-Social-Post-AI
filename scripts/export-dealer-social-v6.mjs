#!/usr/bin/env node
// New v6 URLs only. Earlier installed-client assets are intentionally immutable.
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const kit = path.join(root, "docs/brand/dealer-social-v6");
const require = createRequire(import.meta.url);
let sharp;
try {
  sharp = require("sharp");
} catch {
  if (!process.env.BRAND_RENDER_NODE_MODULES) {
    throw new Error(
      "Install sharp in an external tools directory and set BRAND_RENDER_NODE_MODULES to its node_modules directory. See the v6 README.",
    );
  }
  sharp = require(path.join(process.env.BRAND_RENDER_NODE_MODULES, "sharp"));
}
const glyphs = JSON.parse(
  await fs.readFile(path.join(kit, "source/wordmark-glyphs.json"), "utf8"),
);
const C = { dark: "#111517", white: "#F4F5F5", blue: "#315CE6" };

// Original DS ligature. Two filled contours, a shared 0.75 slope shoulder,
// and an open diagonal seam. Curves are authored; no raster is traced.
const D =
  "M0 0H100C124 0 145 8 162 31L222 119H168L121 55C113 46 107 46 95 46H46V169H95C124 169 146 149 153 120L169 141C194 174 170 214 103 214H0Z";
const S =
  "M174 31C191 11 214 0 241 0H340V46H240C224 46 216 53 216 63C216 73 224 79 241 79H283C323 79 351 106 351 146C351 185 321 214 281 214H166L185 192C195 180 198 171 199 167H273C287 167 295 157 295 146C295 133 285 123 270 123H243Z";
const mark = (d = C.dark, s = C.blue, x = 0, y = 0, scale = 1) =>
  `<g transform="translate(${x} ${y}) scale(${scale})"><path fill="${d}" d="${D}"/><path fill="${s}" d="${S}"/></g>`;
const kern = {
  De: -16,
  ea: -18,
  al: -16,
  le: -14,
  er: -28,
  So: -22,
  oc: -6,
  ci: -12,
  ia: -20,
};
function wordmark(color, x, baseline, size = 64) {
  let cursor = 0;
  const chars = [..."Dealer Social"];
  const pieces = chars.map((char, i) => {
    const glyph = glyphs.glyphs[char];
    const out = `<path transform="translate(${cursor} 0)" d="${glyph.path}"/>`;
    cursor +=
      glyph.advance - (char === " " ? 0 : 23) + (kern[char + chars[i + 1]] ?? 0);
    return out;
  });
  return `<g aria-label="Dealer Social" fill="${color}" transform="translate(${x} ${baseline}) scale(${size / glyphs.unitsPerEm} ${-size / glyphs.unitsPerEm})">${pieces.join("")}</g>`;
}
const svg = (w, h, contents, description) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="title desc"><title id="title">Dealer Social</title><desc id="desc">${description}; official product name Dealer Social Post AI.</desc>${contents}</svg>\n`;
const assets = new Map();
for (const [name, ink, accent] of [
  ["symbol", C.dark, C.blue],
  ["symbol-reverse", C.white, C.blue],
  ["symbol-black", "#000000", "#000000"],
  ["symbol-white", C.white, C.white],
])
  assets.set(
    name,
    svg(
      383,
      246,
      mark(ink, accent, 16, 16),
      "Original DS monogram with an open diagonal seam",
    ),
  );
for (const [suffix, ink, accent] of [
  ["", C.dark, C.blue],
  ["-reverse", C.white, C.blue],
  ["-black", "#000000", "#000000"],
  ["-white", C.white, C.white],
]) {
  assets.set(
    `horizontal${suffix}`,
    svg(
      500,
      100,
      mark(ink, accent, 8, 14, 0.336) + wordmark(ink, 150, 71, 55),
      "Horizontal DS monogram and Dealer Social wordmark",
    ),
  );
  assets.set(
    `stacked${suffix}`,
    svg(
      480,
      270,
      mark(ink, accent, 122.16, 18, 0.67) + wordmark(ink, 67.3, 234, 56),
      "Stacked DS monogram and Dealer Social wordmark",
    ),
  );
}
// Opaque square artwork: let each OS apply its own outer corner treatment.
assets.set(
  "app",
  svg(
    1024,
    1024,
    `<rect width="1024" height="1024" fill="${C.dark}"/>${mark(C.white, C.blue, 144.41, 288, 2.095)}`,
    "Opaque square application icon",
  ),
);
// All foreground corners are within r=409.6, the maskable 80% safe circle.
assets.set(
  "maskable",
  svg(
    1024,
    1024,
    `<rect width="1024" height="1024" fill="${C.dark}"/>${mark(C.white, C.blue, 217.16, 332.24, 1.68)}`,
    "Opaque maskable icon with foreground inside the 80 percent safe circle",
  ),
);

await fs.mkdir(path.join(kit, "master"), { recursive: true });
await fs.mkdir(path.join(kit, "exports"), { recursive: true });
await fs.mkdir(path.join(kit, "validation"), { recursive: true });
for (const [name, content] of assets) {
  await fs.writeFile(path.join(kit, "master", `${name}.svg`), content);
  await fs.writeFile(
    path.join(root, "public", `dealer-social-v6-${name}.svg`),
    content,
  );
}
const render = async (source, width, output, opaque = false) => {
  let pipeline = sharp(Buffer.from(source)).resize({ width });
  if (opaque) pipeline = pipeline.flatten({ background: C.dark }).removeAlpha();
  await pipeline.png().toFile(output);
};
for (const name of [
  "horizontal",
  "horizontal-reverse",
  "horizontal-black",
  "horizontal-white",
  "stacked",
  "stacked-reverse",
  "symbol",
  "symbol-reverse",
  "symbol-black",
  "symbol-white",
]) {
  const width = name.startsWith("horizontal") ? 2240 : 1536;
  await render(
    assets.get(name),
    width,
    path.join(kit, "exports", `${name}-${width}-transparent.png`),
  );
}
for (const size of [16, 24, 32, 48, 180, 192, 512, 1024]) {
  await render(
    assets.get("app"),
    size,
    path.join(root, "public", `dealer-social-v6-${size}.png`),
    true,
  );
  if (size <= 48)
    await render(
      assets.get("app"),
      size,
      path.join(kit, "validation", `app-${size}.png`),
      true,
    );
}
for (const size of [192, 512, 1024])
  await render(
    assets.get("maskable"),
    size,
    path.join(root, "public", `dealer-social-v6-maskable-${size}.png`),
    true,
  );

const label = (text, x, y, fill = C.dark, size = 16, extra = "") =>
  `<text x="${x}" y="${y}" fill="${fill}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" ${extra}>${text}</text>`;
let board = `<rect width="1440" height="1080" fill="${C.white}"/><rect width="1440" height="420" fill="${C.dark}"/>`;
board += label(
  "DEALER SOCIAL  /  IDENTITY 06",
  58,
  55,
  C.white,
  16,
  'letter-spacing="3"',
);
board += label(
  "A single diagonal seam. Two initials. One studio.",
  58,
  389,
  "#A9B1B8",
  20,
);
board += mark(C.white, C.blue, 74, 128, 0.9) + wordmark(C.white, 445, 281, 104);
board += label("LIGHT / PRIMARY", 58, 475, "#647078", 14, 'letter-spacing="2"');
board += mark(C.dark, C.blue, 60, 510, 0.42) + wordmark(C.dark, 242, 578, 57);
board += label(
  "ONE COLOR / SHARED SEAM",
  800,
  475,
  "#647078",
  14,
  'letter-spacing="2"',
);
board += mark(C.dark, C.dark, 820, 510, 0.42) + mark(C.dark, C.blue, 1120, 510, 0.42);
board += `<path d="M58 636H1382" stroke="#CDD2D5"/>`;
board += label("PALETTE", 58, 681, "#647078", 14, 'letter-spacing="2"');
for (const [i, color, name] of [
  [0, C.dark, "Graphite"],
  [1, C.white, "Warm white"],
  [2, C.blue, "Cobalt"],
]) {
  board += `<rect x="${58 + i * 236}" y="705" width="208" height="60" rx="2" fill="${color}" stroke="#CDD2D5"/>`;
  board += label(`${name}  ${color}`, 58 + i * 236, 792, C.dark, 16);
}
board += label("TYPE", 830, 681, "#647078", 14, 'letter-spacing="2"');
board += label("Inter 700 — Rasmus Andersson", 830, 722, C.dark, 23);
board += label("Outlined / adjusted spacing / SIL OFL 1.1", 830, 754, "#647078", 16);
board += label("Official product name: Dealer Social Post AI", 830, 786, "#647078", 16);
board += `<path d="M58 825H1382" stroke="#CDD2D5"/>`;
board += label(
  "APP ICON / ACTUAL 16, 24, 32 PX + 4× INSPECTION",
  58,
  866,
  "#647078",
  14,
  'letter-spacing="1"',
);
for (const [i, size] of [16, 24, 32].entries()) {
  const png = await fs.readFile(path.join(kit, "validation", `app-${size}.png`));
  const href = `data:image/png;base64,${png.toString("base64")}`;
  board += `<image x="${58 + i * 205}" y="895" width="${size}" height="${size}" href="${href}"/><image x="${111 + i * 205}" y="891" width="${size * 4}" height="${size * 4}" style="image-rendering:pixelated" href="${href}"/>`;
}
board += label("CLEAR SPACE", 830, 866, "#647078", 14, 'letter-spacing="2"');
board += label("Keep ½ stem width outside every mark edge.", 830, 905, C.dark, 19);
board += label(
  "Symbol: 24 px wide preferred; 16 px favicon permitted.",
  830,
  935,
  "#647078",
  16,
);
board += label(
  "Horizontal: 180 px wide minimum. Stacked: 160 px.",
  830,
  963,
  "#647078",
  16,
);
board += label(
  "Maskable artwork: foreground inside the 80% safe circle.",
  830,
  991,
  "#647078",
  16,
);
const presentation = svg(
  1440,
  1080,
  board,
  "Dealer Social identity presentation with color, type, clear space, and actual small-size checks",
);
await fs.writeFile(path.join(kit, "presentation.svg"), presentation);
await render(presentation, 1440, path.join(kit, "presentation.png"));
await render(presentation, 2880, path.join(kit, "presentation-2x.png"));
// Native small-size strips on light and dark.
let checks = `<rect width="1000" height="420" fill="${C.white}"/><rect x="500" width="500" height="420" fill="${C.dark}"/>`;
checks +=
  label("LIGHT / REAL SVG RASTERIZATION", 30, 36, C.dark, 15) +
  label("DARK / REAL SVG RASTERIZATION", 530, 36, C.white, 15);
for (const [i, width] of [16, 24, 32, 64, 128].entries()) {
  for (const [side, name] of [
    [0, "symbol"],
    [1, "symbol-reverse"],
  ]) {
    const source = assets.get(name);
    const file = path.join(kit, "validation", `${name}-${width}.png`);
    await render(source, width, file);
    const png = await fs.readFile(file);
    checks += `<image x="${30 + i * 80 + side * 500}" y="70" width="${width}" height="${Math.round((width * 246) / 383)}" href="data:image/png;base64,${png.toString("base64")}"/>`;
    checks += label(
      `${width} px`,
      30 + i * 80 + side * 500,
      172,
      side ? C.white : C.dark,
      12,
    );
  }
}
checks += mark(C.dark, C.dark, 36, 218, 0.5) + mark(C.white, C.white, 536, 218, 0.5);
checks +=
  label("ONE COLOR", 30, 368, C.dark, 13) + label("ONE COLOR", 530, 368, C.white, 13);
await fs.writeFile(
  path.join(kit, "validation/render-checks.svg"),
  svg(
    1000,
    420,
    checks,
    "Actual rasterized DS mark at small widths and solid one-color geometry",
  ),
);
await render(
  svg(
    1000,
    420,
    checks,
    "Actual rasterized DS mark at small widths and solid one-color geometry",
  ),
  1000,
  path.join(kit, "validation/render-checks.png"),
);
// librsvg does not consistently decode embedded WebP. Preserve the photo pixels
// in a PNG encoding for portable SVG presentation rendering.
const photo = await sharp(path.join(root, "public/category/inventory.webp"))
  .png()
  .toBuffer();
const photoProof = svg(
  960,
  400,
  `<image width="960" height="400" href="data:image/png;base64,${photo.toString("base64")}"/><rect x="38" y="30" width="430" height="88" rx="4" fill="${C.dark}"/>${mark(C.white, C.blue, 56, 48, 0.25)}${wordmark(C.white, 167, 88, 39)}`,
  "Identity on the existing inventory sample photo using an opaque contrast plate",
);
await fs.writeFile(path.join(kit, "validation/photo-contrast.svg"), photoProof);
await render(photoProof, 960, path.join(kit, "validation/photo-contrast.png"));
const og = svg(
  1200,
  630,
  `<rect width="1200" height="630" fill="${C.dark}"/>${mark(C.white, C.blue, 116, 243, 0.672)}${wordmark(C.white, 400, 357, 110)}<rect x="116" y="482" width="64" height="3" fill="${C.blue}"/>`,
  "Native vector Dealer Social horizontal identity on graphite for social previews",
);
await fs.writeFile(path.join(kit, "master/og.svg"), og);
const ogPath = path.join(root, "public/dealer-social-og-v6.png");
await render(og, 1200, ogPath, true);
const checked = [];
for (const file of (await fs.readdir(path.join(root, "public"))).filter((name) =>
  name.startsWith("dealer-social-v6-"),
)) {
  const content = await fs.readFile(path.join(root, "public", file));
  const item = {
    file: `public/${file}`,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
  if (file.endsWith(".png")) {
    const metadata = await sharp(content).metadata();
    const expected = Number(file.match(/-(\d+)\.png$/)[1]);
    if (
      metadata.width !== expected ||
      metadata.height !== expected ||
      metadata.hasAlpha
    )
      throw new Error(`Invalid app export: ${file}`);
    Object.assign(item, {
      width: metadata.width,
      height: metadata.height,
      hasAlpha: metadata.hasAlpha,
    });
  } else if (/<image\b|<text\b/.test(content.toString())) {
    throw new Error(`Production master contains raster or live type: ${file}`);
  }
  checked.push(item);
}
const ogContent = await fs.readFile(ogPath);
const ogMetadata = await sharp(ogContent).metadata();
if (ogMetadata.width !== 1200 || ogMetadata.height !== 630 || ogMetadata.hasAlpha) {
  throw new Error("Invalid 1200 × 630 social-preview export");
}
checked.push({
  file: "public/dealer-social-og-v6.png",
  sha256: createHash("sha256").update(ogContent).digest("hex"),
  width: ogMetadata.width,
  height: ogMetadata.height,
  hasAlpha: ogMetadata.hasAlpha,
});
for (const file of await fs.readdir(path.join(kit, "exports"))) {
  const metadata = await sharp(path.join(kit, "exports", file)).metadata();
  if (!metadata.hasAlpha) throw new Error(`Transparent export lost alpha: ${file}`);
  checked.push({
    file: `docs/brand/dealer-social-v6/exports/${file}`,
    width: metadata.width,
    height: metadata.height,
    hasAlpha: metadata.hasAlpha,
  });
}
const safeRadius = Math.hypot((351 * 1.68) / 2, (214 * 1.68) / 2);
if (safeRadius > 409.6) throw new Error("Maskable foreground exceeds safe circle");
await fs.writeFile(
  path.join(kit, "validation/export-checks.json"),
  `${JSON.stringify({ renderer: `sharp ${sharp.versions.sharp}`, maskableForegroundBoundingBoxCornerRadius: safeRadius, maskableSafeRadius: 409.6, assets: checked }, null, 2)}\n`,
);
console.log(
  `Exported ${assets.size} SVG masters, transparent PNGs, opaque app icons, and presentation to ${kit}`,
);
