import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";

const OUT =
  "/private/tmp/claude-501/-Users-joegallant-AI-App-Development-Projects-Dealer-Social-Post-AI/996abc7b-e0db-493b-a0a3-9b6d1370243e/scratchpad/shots";
const BASE = "http://localhost:5173";
const log = [];

const session = (role) => ({
  role,
  dealer: {
    id: "qa-dealer",
    name: "Bob Maxey Ford of Howell",
    requires_approval: true,
    brand_color: "#1e40af",
    oem_affiliation: "Ford",
  },
  person: {
    id: "qa-person",
    dealer: "qa-dealer",
    name: "Jamie Rivera",
    role,
    active: true,
  },
});

async function mock(page, role) {
  // Playwright runs the most recently registered route first: catch-all goes first.
  await page.route("**/api/app/**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [] }),
    }),
  );
  await page.route("**/api/app/session", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(session(role)),
    }),
  );
  await page.route("**/api/telemetry", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true }),
    }),
  );
  await page.route("**/api/app/posts/**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "qa-post-1",
        updated: true,
        post_revision: "2026-08-05 09:43:00.000Z",
        status: "not_requested",
      }),
    }),
  );
  await page.route("**/api/app/posts**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [],
        page: 1,
        perPage: 50,
        totalItems: 0,
        totalPages: 0,
      }),
    }),
  );
  await page.route("**/api/app/dealers/**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(session(role).dealer),
    }),
  );
  await page.route("**/api/app/dealers**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [session(role).dealer], totalItems: 1 }),
    }),
  );
  await page.route("**/api/app/salespeople**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [session(role).person], totalItems: 1 }),
    }),
  );
  await page.route("**/api/app/photo_releases**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [], totalItems: 0 }),
    }),
  );
  await page.route("**/api/app/website-destinations**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    }),
  );
  await page.route("**/api/app/walkarounds/**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ connected: false, items: [] }),
    }),
  );
  await page.route("**/api/app/health", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, sha: "dev" }),
    }),
  );
}

async function shot(page, name) {
  await page.waitForTimeout(600);
  await page.screenshot({
    path: `${OUT}/${name}.png`,
    fullPage: false,
    animations: "disabled",
  });
  log.push(`ok ${name}`);
}

async function pngBuffer(page) {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 1200;
    c.height = 900;
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 1200, 900);
    grad.addColorStop(0, "#1b2a44");
    grad.addColorStop(1, "#7a8ba6");
    g.fillStyle = grad;
    g.fillRect(0, 0, 1200, 900);
    g.fillStyle = "#e8eef8";
    g.beginPath();
    g.moveTo(150, 620);
    g.lineTo(1050, 620);
    g.lineTo(940, 420);
    g.lineTo(340, 420);
    g.closePath();
    g.fill();
    g.fillStyle = "#0b1220";
    g.beginPath();
    g.arc(380, 650, 80, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(820, 650, 80, 0, Math.PI * 2);
    g.fill();
    return c.toDataURL("image/png");
  });
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

async function seedResult(page, theme) {
  await page.evaluate(
    async ({ theme }) => {
      const image =
        "data:image/svg+xml;charset=utf-8," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1350"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#07111f"/><stop offset="1" stop-color="#2563eb"/></linearGradient></defs><rect width="1080" height="1350" fill="url(#g)"/><path d="M140 800h800l-92-210H310z" fill="#e8eef8" opacity=".92"/><circle cx="350" cy="840" r="88" fill="#07111f"/><circle cx="760" cy="840" r="88" fill="#07111f"/><text x="540" y="1040" text-anchor="middle" font-family="Arial" font-size="54" fill="white">BOB MAXEY FORD</text></svg>',
        );
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open("dealer-social-post-ai", 2);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains("creative-assets"))
            d.createObjectStore("creative-assets", { keyPath: "key" });
          if (!d.objectStoreNames.contains("media-archive")) {
            const a = d.createObjectStore("media-archive", { keyPath: "id" });
            a.createIndex("dealerId", "dealerId", { unique: false });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction("creative-assets", "readwrite");
        tx.objectStore("creative-assets").put({
          key: "qa-dealer:generated",
          value: image,
          updatedAt: Date.now(),
          mediaEpoch: 0,
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      localStorage.setItem(
        "dealer-social-post-ai.session",
        JSON.stringify({
          dealerId: "qa-dealer",
          step: 4,
          loginTimestamp: Date.now(),
          theme,
          generatedPost: {
            text: "Keys in hand and big smiles all around. Another happy delivery at Bob Maxey Ford of Howell — congratulations on the new Bronco Sport!",
            postId: "qa-post-1",
            releaseStatus: "saved",
            aiMeta: { modelPolicyVersion: "5" },
            platformIds: ["facebook_feed", "instagram_feed", "linkedin"],
            mediaOutputMode: "photo",
            primaryFormatId: "feed_portrait",
            imageAspectRatio: "4:5",
            scenarioId: "customer_delivery",
          },
          generationParams: {
            style: "Modern & Bold",
            tone: "Excited",
            customerName: "",
            platformIds: ["facebook_feed", "instagram_feed", "linkedin"],
            mediaOutputMode: "photo",
            primaryFormatId: "feed_portrait",
            imageAspectRatio: "4:5",
          },
        }),
      );
    },
    { theme },
  );
}

async function run(label, { width, height, mobile, theme, role, flow }) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: mobile ? 2 : 1,
    isMobile: mobile,
    hasTouch: mobile,
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  await page.addInitScript((theme) => {
    try {
      if (!localStorage.getItem("dealer-social-post-ai.session"))
        localStorage.setItem(
          "dealer-social-post-ai.session",
          JSON.stringify({ theme }),
        );
    } catch {}
  }, theme);
  await mock(page, role);
  try {
    await flow(page, label);
  } catch (e) {
    log.push(`FAIL ${label}: ${String(e).split("\n")[0]}`);
    try {
      await page.screenshot({ path: `${OUT}/${label}-FAIL.png` });
    } catch {}
  }
  await browser.close();
}

const salesFlow = async (page, label) => {
  await page.goto(BASE + "/#/capture");
  await page
    .getByRole("heading", { name: "Start with a photo" })
    .waitFor({ timeout: 15000 });
  await shot(page, `${label}-1-capture`);
  const buf = await pngBuffer(page);
  await page
    .locator('input[type="file"][aria-label="Upload photo from your device"]')
    .setInputFiles({ name: "delivery.png", mimeType: "image/png", buffer: buf });
  await page.getByRole("dialog").waitFor({ timeout: 15000 });
  await shot(page, `${label}-2-crop`);
  const confirm = page
    .getByRole("dialog")
    .getByRole("button", { name: /use|confirm|continue|done|apply|next|looks good/i })
    .first();
  await confirm.click();
  await page.getByText("Post details").waitFor({ timeout: 15000 });
  await shot(page, `${label}-3-customize-top`);
  await page.locator("#main-content").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await shot(page, `${label}-3-customize-bottom`);
  // History + settings from header (desktop) / hidden on mobile studio
  const history = page.getByRole("button", { name: /history/i }).first();
  if (await history.isVisible().catch(() => false)) {
    await history.click();
    await page.waitForTimeout(800);
    await shot(page, `${label}-5-history`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }
  const settings = page.getByRole("button", { name: /settings/i }).first();
  if (await settings.isVisible().catch(() => false)) {
    await settings.click();
    await page.waitForTimeout(800);
    await shot(page, `${label}-6-settings`);
    await page.keyboard.press("Escape");
  }
};

const resultFlow = async (page, label) => {
  await page.goto(BASE + "/");
  await page
    .getByRole("heading", { name: "Start with a photo" })
    .waitFor({ timeout: 15000 });
  await seedResult(page, label.includes("light") ? "light" : "dark");
  await page.reload();
  await page.getByRole("region", { name: "Media preview" }).waitFor({ timeout: 20000 });
  await shot(page, `${label}-4-result-top`);
  await page
    .locator("#main-content")
    .evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    })
    .catch(() => {});
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await shot(page, `${label}-4-result-bottom`);
};

const adminFlow = async (page, label) => {
  await page.goto(BASE + "/");
  await page.waitForTimeout(2500);
  await shot(page, `${label}-7-admin-top`);
  await page
    .locator("#main-content")
    .evaluate((el) => {
      el.scrollTop = 900;
    })
    .catch(() => {});
  await page.evaluate(() => window.scrollTo(0, 900));
  await shot(page, `${label}-7-admin-scrolled`);
};

const D = { width: 1440, height: 1000, mobile: false };
const M = { width: 390, height: 844, mobile: true };
await run("desk-dark", { ...D, theme: "dark", role: "salesperson", flow: salesFlow });
await run("phone-dark", { ...M, theme: "dark", role: "salesperson", flow: salesFlow });
await run("desk-light", { ...D, theme: "light", role: "salesperson", flow: salesFlow });
await run("desk-dark", { ...D, theme: "dark", role: "salesperson", flow: resultFlow });
await run("phone-dark", { ...M, theme: "dark", role: "salesperson", flow: resultFlow });
await run("desk-dark-dealeradmin", {
  ...D,
  theme: "dark",
  role: "dealer_admin",
  flow: adminFlow,
});
await run("phone-dark-dealeradmin", {
  ...M,
  theme: "dark",
  role: "dealer_admin",
  flow: adminFlow,
});
await run("desk-dark-superadmin", {
  ...D,
  theme: "dark",
  role: "super_admin",
  flow: adminFlow,
});
writeFileSync(`${OUT}/log.txt`, log.join("\n"));
console.log(log.join("\n"));
