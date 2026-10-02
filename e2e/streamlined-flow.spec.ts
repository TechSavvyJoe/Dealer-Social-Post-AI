import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const dealer = {
  id: "qa-dealer",
  name: "Northline Motors",
  address: "123 Main St, Howell, MI 48843",
  brand_primary_color: "#1e40af",
  requires_approval: false,
  default_style: "Modern",
  employee_disclosure_enabled: true,
};
const person = {
  id: "qa-person",
  dealer: "qa-dealer",
  name: "Jamie Rivera",
  role: "salesperson",
  active: true,
};
const photo = readFileSync(resolve("docs/marketing/demo/synthetic-delivery-photo.jpg"));
const dataUrl = `data:image/jpeg;base64,${photo.toString("base64")}`;
async function fixture(page: Page, role = "salesperson") {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = { items: [], success: true };
    if (path.endsWith("/session"))
      body = {
        role,
        dealer,
        person: {
          ...person,
          role: role === "dealer_admin" ? "manager" : "salesperson",
        },
      };
    else if (path.endsWith("/health"))
      body = {
        ok: true,
        capabilities: { veoNegativePrompt: true },
        releaseSha: "test",
      };
    else if (path.endsWith("/website-destinations")) body = { items: [] };
    else if (path.endsWith("/dealers")) body = [dealer];
    else if (path.endsWith("/draft"))
      body = {
        id: "qa-post",
        updated: true,
        post_revision: "2026-10-02 01:00:01.000Z",
      };
    else if (path.endsWith("/shared"))
      body = {
        id: "qa-post",
        post_revision: "2026-10-02 01:00:01.000Z",
        share_summary: [
          {
            channel: "facebook_feed",
            method: "native_share",
            shared_at: "2026-10-02T01:00:02Z",
          },
        ],
      };
    else if (path.endsWith("/connections")) {
      const state = { configured: true, enabled: true, verification: "not_tested" };
      body = {
        scope: "configuration_only",
        providers: {
          gemini: state,
          anthropic: { ...state, configured: false, enabled: false },
          openai: state,
        },
        automation: {
          customer_hub: state,
          walkaround: { ...state, configured: false, enabled: false },
        },
        apiContractVersion: "test",
        modelPolicyVersion: "5",
        capabilities: { veoNegativePrompt: true },
      };
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
}
async function quality(page: Page) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations
      .filter((v) => ["serious", "critical"].includes(v.impact || ""))
      .map((v) => ({
        id: v.id,
        targets: v.nodes.map((n) => ({
          target: n.target,
          html: n.html,
          summary: n.failureSummary,
        })),
      })),
  ).toEqual([]);
}
async function shot(page: Page, name: string, project: string) {
  mkdirSync("/tmp/dsp-redesign-qa", { recursive: true });
  await page.screenshot({
    path: `/tmp/dsp-redesign-qa/${name}-${project}.png`,
    fullPage: true,
  });
}

test("category capture opens Details directly, with a single signature sheet", async ({
  page,
}, info) => {
  await fixture(page);
  await expect(
    page.getByRole("heading", { name: "What are you posting?" }),
  ).toBeVisible();
  await quality(page);
  await shot(page, "home", info.project.name);
  const file = page.getByLabel("Take a photo for Delivery", { exact: true });
  await file.setInputFiles({
    name: "delivery.jpg",
    mimeType: "image/jpeg",
    buffer: photo,
  });
  await expect(
    page.getByRole("button", { name: "Get customer's signature" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create post", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await quality(page);
  await shot(page, "details", info.project.name);
  await page.getByRole("button", { name: "Get customer's signature" }).click();
  await expect(
    page.getByRole("dialog", { name: "Customer photo release" }),
  ).toBeVisible();
  await quality(page);
  await shot(page, "release", info.project.name);
});

test("non-customer category offers optional details and permits creation", async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByLabel("Take a photo for New arrival", { exact: true })
    .setInputFiles({ name: "inventory.jpg", mimeType: "image/jpeg", buffer: photo });
  await expect(
    page.getByRole("button", { name: "Create post", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Get customer's signature" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /Anything to mention/ }).click();
  await page
    .getByRole("textbox", { name: /Anything to mention/ })
    .fill("Fresh on the lot.");
  await expect(page.getByRole("textbox", { name: /Anything to mention/ })).toHaveValue(
    "Fresh on the lot.",
  );
  await quality(page);
});

test("restored Post prepares direct sharing and follows Sunlight preference", async ({
  page,
}, info) => {
  test.setTimeout(60_000);
  await fixture(page);
  await expect(
    page.getByRole("heading", { name: "What are you posting?" }),
  ).toBeVisible();
  await page.evaluate(async (image) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("dealer-social-post-ai", 2);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains("creative-assets"))
          req.result.createObjectStore("creative-assets", { keyPath: "key" });
        if (!req.result.objectStoreNames.contains("media-archive")) {
          const store = req.result.createObjectStore("media-archive", {
            keyPath: "id",
          });
          store.createIndex("dealerId", "dealerId", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
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
        theme: "light",
        loginTimestamp: Date.now(),
        generatedPost: {
          image: "",
          text: "Find your next adventure at Northline Motors.",
          postId: "qa-post",
          postRevision: "2026-10-02 01:00:00.000Z",
          scenarioId: "new_arrival",
          customerIdentityRequired: false,
          imageReviewRequired: false,
          releaseStatus: "not_required",
          approvalStatus: "n_a",
          platformIds: ["facebook_feed", "instagram_feed"],
          primaryFormatId: "feed_portrait",
          imageAspectRatio: "4:5",
          mediaOutputMode: "photo",
          aiMeta: { modelPolicyVersion: "5" },
        },
      }),
    );
  }, dataUrl);
  await page.addInitScript(() => {
    (window as unknown as { __shareCalls: unknown[] }).__shareCalls = [];
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => true,
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: (data: unknown) => {
        (window as unknown as { __shareCalls: unknown[] }).__shareCalls.push(data);
        return Promise.resolve();
      },
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.resolve() },
    });
  });
  await page.reload();
  await expect(page.getByRole("region", { name: "Post preview" })).toBeVisible();
  await expect(page.locator("html")).toHaveClass(/theme-light/);
  await quality(page);
  const viewportWidth = page.viewportSize()?.width ?? 1440;
  if (viewportWidth === 320 || viewportWidth === 1440) {
    await page.evaluate(() => {
      const key = "dealer-social-post-ai.session";
      const session = JSON.parse(localStorage.getItem(key) || "{}");
      localStorage.setItem(key, JSON.stringify({ ...session, theme: "dark" }));
    });
    await page.reload();
    await expect(page.getByRole("region", { name: "Post preview" })).toBeVisible();
    await expect(page.locator("html")).not.toHaveClass(/theme-light/);
    await expect(
      page.getByRole("button", {
        name: viewportWidth < 1200 ? "Share to Facebook" : "Download for Facebook",
        exact: true,
      }),
    ).toBeEnabled({ timeout: 15000 });
    await quality(page);
    await shot(page, "post-dark", info.project.name);
    await page.evaluate(() => {
      const key = "dealer-social-post-ai.session";
      const session = JSON.parse(localStorage.getItem(key) || "{}");
      localStorage.setItem(key, JSON.stringify({ ...session, theme: "light" }));
    });
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/theme-light/);
  }
  if ((page.viewportSize()?.width ?? 1440) < 1200) {
    const share = page.getByRole("button", { name: "Share to Facebook", exact: true });
    await expect(share).toBeEnabled({ timeout: 15000 });
    await shot(page, "post-light", info.project.name);
    await share.click();
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { __shareCalls: unknown[] }).__shareCalls.length,
        ),
      )
      .toBe(1);
    await expect(page.getByRole("button", { name: "Done", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "What are you posting?" }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  } else {
    await expect(
      page.getByRole("button", { name: "Download for Facebook", exact: true }),
    ).toBeEnabled({ timeout: 15000 });
    await shot(page, "post-light", info.project.name);
  }
});

test("system admin sees AI connections and setup guidance", async ({ page }, info) => {
  await fixture(page, "super_admin");
  await page.getByRole("tab", { name: "Connections" }).click();
  await expect(
    page.getByRole("heading", { name: "AI providers & automation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Setup instructions" }).first().click();
  await expect(page.getByText("Set the Gemini key on the backend host.")).toBeVisible();
  await quality(page);
  await shot(page, "admin-connections", info.project.name);
});

test("dealership setup exposes store instructions and advanced workflow, without provider controls", async ({
  page,
}, info) => {
  test.setTimeout(60_000);
  await page.addInitScript(() =>
    localStorage.setItem("dsp.dealerSetupDismissed.v1.qa-dealer", "1"),
  );
  await fixture(page, "dealer_admin");
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("progressbar", { name: "Store setup progress" }),
  ).toBeVisible();
  await quality(page);
  await shot(page, "manager-profile", info.project.name);
  await page.getByRole("button", { name: /^Voice/ }).click();
  await expect(page.getByText("AI providers & automation")).toHaveCount(0);
  await quality(page);
  await shot(page, "manager-voice", info.project.name);
  await page.getByRole("button", { name: /^Workflow/ }).click();
  await page
    .getByRole("button", { name: "Advanced workflow controls", exact: true })
    .click();
  await expect(page.getByText("Team feature access", { exact: true })).toBeVisible();
  await quality(page);
  await shot(page, "manager-workflow", info.project.name);
  await page.getByRole("button", { name: /^Channels/ }).click();
  await expect(
    page.getByText("Customer website connection", { exact: true }),
  ).toBeVisible();
  await quality(page);
  await shot(page, "manager-channels", info.project.name);
});
