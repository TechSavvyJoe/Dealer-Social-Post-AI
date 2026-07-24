import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = process.cwd();
const outputDir = path.join(root, "docs/marketing/demo/render");
fs.mkdirSync(outputDir, { recursive: true });

const sourcePhoto = path.join(root, "docs/marketing/demo/synthetic-delivery-photo.jpg");
const generatedPhoto = path.join(root, "docs/marketing/demo/generated-post.jpg");
const generatedImage =
  "data:image/jpeg;base64," + fs.readFileSync(generatedPhoto).toString("base64");

const browser = await chromium.launch({
  headless: true,
  args: ["--hide-scrollbars", "--autoplay-policy=no-user-gesture-required"],
});

const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: "dark",
  reducedMotion: "no-preference",
  recordVideo: {
    dir: outputDir,
    size: { width: 1440, height: 900 },
  },
});

let authenticated = false;
const page = await context.newPage();
const video = page.video();

await page.addInitScript(() => {
  Object.defineProperty(navigator, "canShare", {
    configurable: true,
    value: () => true,
  });
  Object.defineProperty(navigator, "share", {
    configurable: true,
    value: () => Promise.resolve(),
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: () => Promise.resolve() },
  });

  window.addEventListener("DOMContentLoaded", () => {
    const cursor = document.createElement("div");
    cursor.id = "marketing-demo-cursor";
    cursor.setAttribute("aria-hidden", "true");
    Object.assign(cursor.style, {
      position: "fixed",
      left: "0",
      top: "0",
      width: "26px",
      height: "26px",
      marginLeft: "-13px",
      marginTop: "-13px",
      borderRadius: "999px",
      border: "2px solid rgba(255,255,255,.95)",
      background: "rgba(94,211,255,.28)",
      boxShadow: "0 0 0 6px rgba(94,211,255,.12), 0 4px 18px rgba(0,0,0,.35)",
      pointerEvents: "none",
      zIndex: "2147483647",
      transform: "translate(-100px,-100px)",
      transition: "width 120ms ease, height 120ms ease, background 120ms ease",
    });
    document.body.appendChild(cursor);
    window.addEventListener("mousemove", (event) => {
      cursor.style.transform = `translate(${event.clientX}px,${event.clientY}px)`;
    });
    window.addEventListener("mousedown", () => {
      cursor.style.width = "18px";
      cursor.style.height = "18px";
      cursor.style.background = "rgba(255,122,89,.72)";
    });
    window.addEventListener("mouseup", () => {
      cursor.style.width = "26px";
      cursor.style.height = "26px";
      cursor.style.background = "rgba(94,211,255,.28)";
    });
  });
});

await page.route("**/api/app/session", async (route) => {
  const method = route.request().method();
  if (method === "POST") authenticated = true;
  if (method === "DELETE") authenticated = false;

  if (!authenticated) {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        code: "INVALID_CODE",
        error: "No active session",
      }),
    });
    return;
  }

  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      role: "salesperson",
      dealer: {
        id: "demo-dealer",
        name: "Northline Motors",
        requires_approval: false,
      },
      person: {
        id: "demo-person",
        dealer: "demo-dealer",
        name: "Jamie Rivera",
        role: "salesperson",
        active: true,
      },
    }),
  });
});

await page.route("**/api/telemetry", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ success: true }),
  }),
);

await page.route("**/api/app/photo_releases", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ id: "demo-release-1" }),
  }),
);

await page.route("**/api/app/photo_releases/*/link-post", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      id: "demo-release-1",
      post: "demo-post-1",
      linked: true,
    }),
  }),
);

await page.route("**/api/app/posts", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      id: "demo-post-1",
      approval_status: "n_a",
    }),
  }),
);

// Keep the genuine generation screen visible long enough for the walkthrough,
// then the script promotes a deterministic synthetic result.
await page.route("**/api/proxy/**", async (route) => {
  await new Promise((resolve) => setTimeout(resolve, 60_000));
  if (!route.request().isNavigationRequest()) {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ candidates: [] }),
    });
  }
});

const sleep = (milliseconds) => page.waitForTimeout(milliseconds);

async function moveAndClick(locator, pauseBefore = 350, pauseAfter = 650) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
      steps: 18,
    });
  }
  await sleep(pauseBefore);
  await locator.click();
  await sleep(pauseAfter);
}

async function titleCard(kicker, title, detail, duration = 2500) {
  await page.setContent(`
    <!doctype html>
    <html>
      <head>
        <style>
          * { box-sizing: border-box; }
          html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
          body {
            display: grid;
            place-items: center;
            color: #f7f6f2;
            background:
              radial-gradient(circle at 82% 18%, rgba(94,211,255,.15), transparent 31%),
              radial-gradient(circle at 12% 90%, rgba(255,122,89,.11), transparent 34%),
              linear-gradient(135deg, #071521, #102739);
            font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          }
          .card { width: min(1060px, 82vw); }
          .kicker {
            margin-bottom: 22px;
            color: #5ed3ff;
            font-size: 21px;
            font-weight: 800;
            letter-spacing: .18em;
            text-transform: uppercase;
          }
          h1 {
            margin: 0;
            max-width: 980px;
            font-size: 76px;
            line-height: 1.02;
            letter-spacing: -.045em;
          }
          p {
            margin: 28px 0 0;
            max-width: 850px;
            color: #b7c6d2;
            font-size: 28px;
            line-height: 1.4;
          }
          .rule {
            width: 118px;
            height: 7px;
            margin-top: 38px;
            border-radius: 999px;
            background: linear-gradient(90deg, #ff7a59, #5ed3ff);
          }
        </style>
      </head>
      <body>
        <main class="card">
          <div class="kicker">${kicker}</div>
          <h1>${title}</h1>
          <p>${detail}</p>
          <div class="rule"></div>
        </main>
      </body>
    </html>
  `);
  await sleep(duration);
}

await titleCard(
  "Dealer Social Post AI",
  "Turn a delivery photo into a polished social post.",
  "A fast, guided workflow built for dealership sales teams.",
  3000,
);

await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
await page.getByRole("heading", { name: /^sign in$/i }).waitFor();
await sleep(1200);

for (const digit of ["1", "2", "3", "4"]) {
  await moveAndClick(page.getByRole("button", { name: `Digit ${digit}` }), 120, 170);
}

await page.getByRole("button", { name: "Choose from device" }).waitFor();
await sleep(1200);

const upload = page.locator('input[aria-label="Upload photo from your device"]');
const chooseButton = page.getByRole("button", { name: "Choose from device" });
const chooseBox = await chooseButton.boundingBox();
if (chooseBox) {
  await page.mouse.move(
    chooseBox.x + chooseBox.width / 2,
    chooseBox.y + chooseBox.height / 2,
    { steps: 20 },
  );
}
await sleep(450);
await upload.setInputFiles(sourcePhoto);

await page.getByRole("dialog", { name: "Review photo" }).waitFor();
await sleep(1100);
await moveAndClick(page.getByRole("button", { name: "Use photo" }), 350, 1000);

await page.getByRole("heading", { name: "Create your post" }).waitFor();
await sleep(800);

const customerNameInput = page.locator('input[type="text"]').first();
await customerNameInput.fill("Taylor Morgan");
await sleep(450);

await moveAndClick(page.getByRole("button", { name: /^Modern/ }), 300, 500);
await moveAndClick(page.getByRole("button", { name: /^Facebook/ }), 250, 450);
await moveAndClick(page.getByRole("button", { name: "Professional" }), 250, 500);

await moveAndClick(
  page.getByRole("button", { name: "Capture customer release" }),
  300,
  550,
);
const releaseDialog = page.getByRole("dialog", { name: "Customer photo release" });
await releaseDialog.waitFor();
const releaseInputs = releaseDialog.locator('input[type="text"]');
await releaseInputs.nth(0).fill("Taylor Morgan");
await moveAndClick(releaseDialog.getByRole("button", { name: "Type name" }), 250, 350);
await releaseInputs.nth(1).fill("Taylor Morgan");
await moveAndClick(releaseDialog.getByRole("checkbox"), 200, 350);
await moveAndClick(
  releaseDialog.getByRole("button", { name: "Capture release" }),
  250,
  650,
);

await moveAndClick(page.getByRole("button", { name: "Generate Post" }), 400, 700);
await sleep(2100);

await page.evaluate(async ({ image }) => {
  const { useAppStore } = await import("/stores/appStore.ts");
  const store = useAppStore.getState();
  store.setGeneratedPost({
    image,
    text:
      "A standout delivery deserves a standout moment. Congratulations to Taylor on the new ride! Thank you for choosing Northline Motors. #NewCarDay #NorthlineMotors",
    postId: "demo-post-1",
    releaseStatus: "saved",
    approvalStatus: "n_a",
    disclosures: "",
    captionSource: "ai",
  });
  store.setGenerationParams({
    style: "Modern & Bold",
    tone: "Professional",
    customerName: "Taylor Morgan",
  });
  store.setStep(4);
}, { image: generatedImage });

await page
  .getByRole("heading", { name: "Ready to publish" })
  .waitFor({ timeout: 10_000 });
await sleep(3200);

// Keep the demo recording deterministic and fast while the real share dialog
// still exercises its preparation and user-activation flow.
await page.evaluate((image) => {
  HTMLCanvasElement.prototype.toDataURL = () => image;
}, generatedImage);

await moveAndClick(page.getByRole("button", { name: "Share post" }), 450, 650);
const shareDialog = page.getByRole("dialog", { name: "Share" });
await shareDialog.waitFor();
await sleep(650);
await moveAndClick(
  shareDialog.getByRole("button", { name: /Share to Facebook/ }),
  300,
  1200,
);
const shareNow = shareDialog.getByRole("button", { name: "Share now" });
if (await shareNow.isVisible()) {
  await moveAndClick(shareNow, 350, 900);
} else {
  await sleep(1500);
}

await page.keyboard.press("Escape");
await sleep(800);
await titleCard(
  "From the lot to social",
  "Capture. Create. Share.",
  "Dealer Social Post AI helps every salesperson publish better content in minutes.",
  4400,
);

await page.close();
await context.close();
const recordedPath = await video.path();
await browser.close();
const finalRawPath = path.join(outputDir, "dealer-social-post-ai-demo-raw.webm");
if (recordedPath !== finalRawPath) {
  fs.renameSync(recordedPath, finalRawPath);
}
console.log(finalRawPath);
