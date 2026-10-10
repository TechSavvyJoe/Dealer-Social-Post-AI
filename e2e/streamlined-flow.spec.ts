import { test, expect, type Page, type Request, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

// These journeys own every API response. A production service worker must
// not bypass the synthetic routes after a reload and contact the live backend.
test.use({ serviceWorkers: "block" });

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
/** buildEmployeeDisclosure(dealer) with the default template. */
const EMPLOYEE_DISCLOSURE = "Posted by a Northline Motors team member.";
/** The revision the restored session holds before any save. */
const SEEDED_REVISION = "2026-10-02 01:00:00.000Z";
/** The revision every stubbed draft save answers with. */
const DRAFT_REVISION = "2026-10-02 01:00:01.000Z";

const photo = readFileSync(resolve("docs/marketing/demo/synthetic-delivery-photo.jpg"));
const dataUrl = `data:image/jpeg;base64,${photo.toString("base64")}`;

type Json = Record<string, unknown>;
/** What a test answers for one request; undefined falls through to the shared stubs. */
type Reply =
  { status?: number; json?: unknown; body?: Buffer; contentType?: string } | "hold";
type Override = (request: Request, path: string) => Reply | undefined;

interface Api {
  /** Every /api request, in the order the page sent it. */
  calls: string[];
  /** Requests no stub claims: answered 500 and failed in afterEach. */
  unknown: string[];
  /** Multipart fields of each PATCH …/draft. */
  drafts: Array<Record<string, string>>;
  /** JSON bodies of each POST …/shared. */
  shares: Json[];
  /** Requests a test chose to hold open. */
  held: Route[];
}

let api: Api | null = null;

test.afterEach(async () => {
  const current = api;
  api = null;
  for (const route of current?.held || []) await route.abort().catch(() => {});
  // A stub that answers anything with 200 hides contract breaks: every /api
  // path a journey reaches must be one this file stubs on purpose.
  expect(current?.unknown || [], "unstubbed /api requests").toEqual([]);
});

/** One multipart text field, read from the raw body. */
const multipartFields = (request: Request): Record<string, string> => {
  const raw = request.postDataBuffer()?.toString("latin1") || "";
  const fields: Record<string, string> = {};
  for (const match of raw.matchAll(
    /name="([^"]+)"\r\n(?:Content-Type:[^\r]*\r\n)?\r\n([\s\S]*?)\r\n--/g,
  )) {
    if (!/filename=/.test(match[0])) fields[match[1]] = match[2];
  }
  return fields;
};

const geminiText = (text: string) => ({
  candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }],
});

const GENERATED_CAPTION =
  "Congratulations on the new ride! The whole Northline Motors team loved being part of your big day.";

async function fixture(page: Page, role = "salesperson", override?: Override) {
  const state: Api = { calls: [], unknown: [], drafts: [], shares: [], held: [] };
  api = state;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname;
    state.calls.push(`${method} ${path}`);
    const reply: Reply | undefined =
      override?.(request, path) ?? defaultReply(state, role, request, method, path);
    if (reply === "hold") {
      state.held.push(route);
      return;
    }
    if (!reply) {
      state.unknown.push(`${method} ${path}`);
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: `Unstubbed ${method} ${path}` }),
      });
      return;
    }
    await route.fulfill({
      status: reply.status ?? 200,
      contentType: reply.contentType ?? "application/json",
      body: reply.body ?? JSON.stringify(reply.json ?? {}),
    });
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  return state;
}

function defaultReply(
  state: Api,
  role: string,
  request: Request,
  method: string,
  path: string,
): Reply | undefined {
  if (method === "GET" && path === "/api/app/session")
    return {
      json: {
        role,
        dealer,
        person: {
          ...person,
          role: role === "dealer_admin" ? "manager" : "salesperson",
        },
      },
    };
  if (method === "POST" && path === "/api/telemetry")
    return { json: { success: true } };
  if (method === "GET" && path === "/api/app/health")
    return {
      json: { ok: true, capabilities: { veoNegativePrompt: true }, releaseSha: "test" },
    };
  if (method === "GET" && path === "/api/app/website-destinations")
    return { json: { items: [] } };
  if (method === "GET" && path === "/api/app/posts") return { json: { items: [] } };
  if (method === "GET" && path === "/api/app/dealers") return { json: [dealer] };
  if (method === "GET" && path === "/api/app/salespeople")
    return { json: { items: [], nextCursor: null } };
  // The manager's Channels section shows the YouTube link; unlinked here.
  if (method === "GET" && path === "/api/app/walkarounds/youtube/status")
    return { json: { connected: false } };
  if (method === "PATCH" && /^\/api\/app\/posts\/[^/]+\/draft$/.test(path)) {
    state.drafts.push(multipartFields(request));
    return {
      json: {
        id: path.split("/")[4],
        updated: true,
        post_revision: DRAFT_REVISION,
      },
    };
  }
  if (method === "POST" && /^\/api\/app\/posts\/[^/]+\/shared$/.test(path)) {
    const body = request.postDataJSON() as Json;
    state.shares.push(body);
    // The route's real response (pb_hooks/main.pb.js): the post's id, the
    // receipt, the server-written time and the revision whose locks were
    // checked.
    return {
      json: {
        id: path.split("/")[4],
        channel: body.channel,
        via: body.via,
        shared_at: "2026-10-02T01:00:02.000Z",
        deduplicated: false,
        post_revision: body.expected_post_revision,
      },
    };
  }
  if (method === "GET" && path === "/api/app/studio-capabilities") {
    return { json: { walkaround: false } };
  }
  if (method === "GET" && path === "/api/app/connections") {
    const service = (
      id: "gemini" | "anthropic" | "openai" | "website" | "walkaround",
      scope: "global" | "dealer",
      state: "needs_test" | "off",
      dealerId?: string,
    ) => ({
      service: id,
      scope,
      ...(dealerId ? { dealerId } : {}),
      configured: state !== "off",
      enabled: state !== "off",
      revision: state === "off" ? 0 : 1,
      state,
      capabilities:
        id === "gemini"
          ? [
              { id: "caption_text", label: "Caption generation", state: "not_tested" },
              { id: "images", label: "Image generation", state: "not_tested" },
              { id: "video", label: "Video generation", state: "not_tested" },
            ]
          : id === "website"
            ? [
                {
                  id: "websiteReady",
                  label: "Private draft delivery",
                  state: "not_tested",
                },
              ]
            : [],
      nextAction: state === "off" ? "Optional service is off." : "Run a test.",
      settings: {},
      credentialConfigured: {},
    });
    return {
      json: {
        scope: "guided_setup",
        secureStorageAvailable: true,
        dealers: [{ id: dealer.id, name: dealer.name }],
        services: [
          service("gemini", "global", "needs_test"),
          service("anthropic", "global", "off"),
          service("openai", "global", "off"),
          service("website", "dealer", "off", dealer.id),
          service("walkaround", "global", "off"),
        ],
        apiContractVersion: "test",
        modelPolicyVersion: "5",
        capabilities: { veoNegativePrompt: true, walkaroundStudio: true },
      },
    };
  }
  if (method === "GET" && path === "/api/app/dealer-connections")
    return {
      json: {
        services: [
          {
            service: "website",
            enabled: false,
            configured: false,
            revision: 0,
            state: "off",
            capabilities: [],
          },
          {
            service: "walkaround",
            enabled: false,
            configured: false,
            revision: 0,
            state: "off",
            capabilities: [
              { id: "walkaroundStudio", label: "Video studio", state: "not_tested" },
            ],
          },
        ],
      },
    };
  return undefined;
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

/** Records navigator.share and clipboard writes; share resolves at once. */
async function recordSharing(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __shareCalls: Array<{ text?: string; title?: string; files: number }>;
      __clipboardWrites: string[];
    };
    w.__shareCalls = [];
    w.__clipboardWrites = [];
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => true,
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: (data: ShareData) => {
        w.__shareCalls.push({
          text: data.text,
          title: data.title,
          files: data.files?.length || 0,
        });
        return Promise.resolve();
      },
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (value: string) => {
          w.__clipboardWrites.push(value);
          return Promise.resolve();
        },
      },
    });
  });
}
const shareCalls = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          __shareCalls: Array<{ text?: string; title?: string; files: number }>;
        }
      ).__shareCalls,
  );
const clipboardWrites = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __clipboardWrites: string[] }).__clipboardWrites,
  );

async function seedRestoredPost(
  page: Page,
  platformIds = ["facebook_feed", "instagram_feed"],
  restoreSource = false,
) {
  await page.evaluate(
    async ({ image, revision, platformIds, restoreSource }) => {
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
        if (restoreSource)
          tx.objectStore("creative-assets").put({
            key: "qa-dealer:selected",
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
            postRevision: revision,
            scenarioId: "new_arrival",
            customerIdentityRequired: false,
            imageReviewRequired: false,
            releaseStatus: "not_required",
            approvalStatus: "n_a",
            platformIds,
            primaryFormatId: "feed_portrait",
            imageAspectRatio: "4:5",
            mediaOutputMode: "photo",
            aiMeta: { modelPolicyVersion: "5" },
          },
        }),
      );
    },
    { image: dataUrl, revision: SEEDED_REVISION, platformIds, restoreSource },
  );
}

async function signRelease(
  page: Page,
  customerName: string,
  method: "draw" | "type" = "draw",
) {
  const dialog = page.getByRole("dialog", { name: "Customer photo release" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Customer's full name").fill(customerName);
  if (method === "type") {
    await dialog.getByRole("button", { name: "Type name instead" }).click();
    await dialog.getByLabel("Type the customer’s full legal name").fill(customerName);
    await dialog.getByRole("checkbox").check();
    await expect(dialog.getByText("Electronic signature ready")).toBeVisible();
    await dialog.getByRole("button", { name: "Save signature" }).click();
    await expect(dialog).toBeHidden();
    return;
  }
  const pad = dialog.getByRole("img", { name: /Draw the customer's signature/ });
  await pad.scrollIntoViewIfNeeded();
  const box = await pad.boundingBox();
  expect(box).not.toBeNull();
  const { x, y, width, height } = box!;
  await page.mouse.move(x + width * 0.15, y + height * 0.6);
  await page.mouse.down();
  for (let step = 1; step <= 12; step += 1) {
    await page.mouse.move(
      x + width * (0.15 + step * 0.05),
      y + height * (0.6 - Math.sin(step / 2) * 0.25),
    );
  }
  await page.mouse.up();
  await expect(dialog.getByText("Signed", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Save signature" }).click();
  await expect(dialog).toBeHidden();
}

test("Facebook Instagram and TikTok recover from a closed sheet with save-and-copy", async ({
  page,
}, info) => {
  test.skip(
    !info.project.name.endsWith("phone-390"),
    "Representative phone handoff coverage",
  );
  test.setTimeout(90_000);
  await recordSharing(page);
  await page.addInitScript(() => {
    let attempts = 0;
    const apple = /iPad|iPhone|iPod/.test(navigator.userAgent);
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: () => {
        attempts += 1;
        // First sheet has no selected social app; the next iOS sheet saves to Photos.
        return apple && attempts % 2 === 0
          ? Promise.resolve()
          : Promise.reject(new DOMException("Closed", "AbortError"));
      },
    });
  });
  await fixture(page);
  await expect(
    page.getByRole("heading", { name: "Your next great post." }),
  ).toBeVisible();
  await seedRestoredPost(page, ["facebook_feed", "instagram_feed", "tiktok"]);
  await page.reload();
  const apple = await page.evaluate(() => /iPad|iPhone|iPod/.test(navigator.userAgent));
  for (const label of ["Facebook", "Instagram", "TikTok"]) {
    await page
      .getByRole("group", { name: "Share to" })
      .getByRole("button", { name: label, exact: true })
      .click();
    const share = page.getByRole("button", { name: `Share to ${label}`, exact: true });
    await expect(share).toBeEnabled({ timeout: 15000 });
    await share.click();
    await expect(
      page.getByText("Your post is still ready", { exact: true }),
    ).toBeVisible();
    if (apple) {
      await page.getByRole("button", { name: "Save to Photos", exact: true }).click();
      await expect(
        page.getByText("Save to Photos opened", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(
          `Caption copied. Choose Save Image, then open ${label} and add it. Paste the caption only if missing.`,
          { exact: true },
        ),
      ).toBeVisible();
    } else {
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "Save image", exact: true }).click();
      const file = await download;
      expect(file.suggestedFilename()).toMatch(/\.(jpg|jpeg|png)$/);
      await expect(
        page.getByText(
          `Caption copied. Open ${label}, add the image, and check the caption. Paste only if missing, then post.`,
          { exact: true },
        ),
      ).toBeVisible();
    }
    expect((await clipboardWrites(page)).at(-1)).toContain(EMPLOYEE_DISCLOSURE);
    await expect(
      page.getByRole("button", { name: `Open ${label}`, exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("link", { name: `Open ${label} in browser instead` }),
    ).toBeVisible();
    await quality(page);
  }
  const dir = "/tmp/dsp-social-polish-screens";
  mkdirSync(dir, { recursive: true });
  await page.screenshot({
    path: resolve(dir, `manual-${info.project.name}.png`),
    fullPage: true,
  });
});

test("desktop save copies caption and opens the selected destination", async ({
  page,
}, info) => {
  test.skip(
    !info.project.name.endsWith("desktop-1440"),
    "Representative desktop handoff coverage",
  );
  test.setTimeout(90_000);
  await recordSharing(page);
  await page.addInitScript(() => {
    (window as unknown as { __opened: string[] }).__opened = [];
    window.open = ((url?: string | URL) => {
      (window as unknown as { __opened: string[] }).__opened.push(String(url));
      return null;
    }) as typeof window.open;
  });
  await fixture(page);
  await expect(
    page.getByRole("heading", { name: "Your next great post." }),
  ).toBeVisible();
  await seedRestoredPost(page, ["facebook_feed", "instagram_feed", "tiktok"]);
  await page.reload();
  for (const [label, origin] of [
    ["Facebook", "https://www.facebook.com/"],
    ["Instagram", "https://www.instagram.com/"],
    ["TikTok", "https://www.tiktok.com/upload"],
  ]) {
    await page
      .getByRole("group", { name: "Share to" })
      .getByRole("button", { name: label, exact: true })
      .click();
    const save = page.getByRole("button", {
      name: `Download for ${label}`,
      exact: true,
    });
    await expect(save).toBeEnabled({ timeout: 15000 });
    const download = page.waitForEvent("download");
    await save.click();
    await download;
    await expect(
      page.getByText(
        `Caption copied. Open ${label}, add the image, and check the caption. Paste only if missing, then post.`,
        { exact: true },
      ),
    ).toBeVisible();
    await page.getByRole("button", { name: `Open ${label}`, exact: true }).click();
    expect(
      await page.evaluate(() =>
        (window as unknown as { __opened: string[] }).__opened.at(-1),
      ),
    ).toBe(origin);
    await quality(page);
  }
  const dir = "/tmp/dsp-social-polish-screens";
  mkdirSync(dir, { recursive: true });
  await page.screenshot({
    path: resolve(dir, `desktop-${info.project.name}.png`),
    fullPage: true,
  });
});

test("blocked clipboard exposes the complete outbound caption for manual copying", async ({
  page,
}, info) => {
  test.setTimeout(60_000);
  test.skip(
    !info.project.name.endsWith("phone-390"),
    "Representative phone clipboard recovery",
  );
  await recordSharing(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("Clipboard blocked")) },
    });
    document.execCommand = () => false;
  });
  await fixture(page);
  await expect(
    page.getByRole("heading", { name: "Your next great post." }),
  ).toBeVisible();
  await seedRestoredPost(page);
  await page.reload();
  await page
    .getByRole("button", { name: "App not listed? Save and open instead" })
    .click();
  await page.getByRole("button", { name: "Copy caption", exact: true }).click();
  const field = page.getByRole("textbox", { name: "Full caption to copy" });
  await expect(field).toBeVisible();
  expect(await field.inputValue()).toContain(EMPLOYEE_DISCLOSURE);
  await field.focus();
  expect(
    await field.evaluate(
      (el: HTMLTextAreaElement) => el.selectionEnd - el.selectionStart,
    ),
  ).toBe((await field.inputValue()).length);
  await expect(
    page.getByRole("button", { name: /^Save (image|to Photos)$/ }),
  ).toBeEnabled();
});

test("category capture opens Details directly, with a single signature sheet", async ({
  page,
}, info) => {
  await fixture(page);
  await expect(
    page.getByRole("heading", { name: "Your next great post." }),
  ).toBeVisible();
  await quality(page);
  await shot(page, "home", info.project.name);
  const file = page.getByLabel("Take a photo for Delivery", { exact: true });
  await file.setInputFiles({
    name: "delivery.jpg",
    mimeType: "image/jpeg",
    buffer: photo,
  });
  // Until the customer signs, the one primary asks for the signature and
  // there is no Create post button at all.
  await expect(
    page.getByRole("button", { name: "Get customer's signature" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Create post", exact: true }),
  ).toHaveCount(0);
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

test("Create post stores the signature first, Cancel keeps the draft, and the retry reaches Post", async ({
  page,
}) => {
  test.setTimeout(90_000);
  let holdProvider = true;
  let createdCaption = "";
  /** The revision link-post answers with; the create answered an older one. */
  const LINK_REVISION = "2026-10-06 12:00:01.000Z";
  const created = {
    id: "qa-created-post",
    dealer: dealer.id,
    salesperson_id: person.id,
    salesperson_name: person.name,
    scenario_id: "customer_delivery",
    platform_ids: ["facebook_feed", "instagram_feed"],
    media_output_mode: "photo",
    primary_format_id: "feed_portrait",
    image_aspect_ratio: "4:5",
    approval_status: "n_a",
    release_required: true,
    release_status: "pending",
    has_release: false,
    created: "2026-10-06 12:00:00.000Z",
    updated: "2026-10-06 12:00:00.000Z",
  };
  await recordSharing(page);
  const state = await fixture(page, "salesperson", (request, path) => {
    const method = request.method();
    if (method === "POST" && path === "/api/app/photo_releases")
      return { json: { id: "qa-release-1", customer_name: "Alex Johnson" } };
    if (method === "POST" && path === "/api/app/photo_releases/qa-release-1/link-post")
      return {
        json: {
          id: "qa-release-1",
          post: created.id,
          post_revision: LINK_REVISION,
        },
      };
    if (path.startsWith("/api/proxy/")) {
      if (holdProvider) return "hold";
      // The caption task gets a usable caption; any other provider task
      // (image, caption pack, checks) gets text with no image, which the
      // pipeline answers by shipping the original photo.
      return request.headers()["x-generation-task"] === "caption"
        ? { json: geminiText(GENERATED_CAPTION) }
        : { json: geminiText("{}") };
    }
    if (method === "POST" && path === "/api/app/posts") {
      createdCaption = multipartFields(request).caption || "";
      return { json: { ...created, caption: createdCaption } };
    }
    return undefined;
  });

  await page
    .getByLabel("Take a photo for Delivery", { exact: true })
    .setInputFiles({ name: "delivery.jpg", mimeType: "image/jpeg", buffer: photo });
  await page.getByRole("button", { name: "Get customer's signature" }).click();
  await signRelease(page, "Alex Johnson");
  const signatureRow = page.getByRole("button", { name: /^Customer's signature/ });
  await expect(signatureRow.getByText("Signed", { exact: true })).toBeVisible();
  await expect(signatureRow.getByText("Alex Johnson", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Anything to mention/ }).click();
  await page
    .getByRole("textbox", { name: /Anything to mention/ })
    .fill("Picked up on her birthday.");

  // First attempt: the provider is held, so Creating stays on screen.
  await page.getByRole("button", { name: "Create post", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Creating your post…" }),
  ).toBeVisible();
  await expect.poll(() => state.held.length).toBeGreaterThan(0);
  const firstProxy = state.calls.findIndex((call) => call.includes(" /api/proxy/"));
  const releasePost = state.calls.indexOf("POST /api/app/photo_releases");
  expect(
    releasePost,
    "the signature is stored before any provider call",
  ).toBeGreaterThanOrEqual(0);
  expect(releasePost).toBeLessThan(firstProxy);

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Creating your post…" })).toHaveCount(
    0,
    { timeout: 15_000 },
  );
  // Back on Details with everything kept: the signature and the note.
  await expect(signatureRow.getByText("Signed", { exact: true })).toBeVisible();
  await expect(signatureRow.getByText("Alex Johnson", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /Anything to mention/ })).toHaveValue(
    "Picked up on her birthday.",
  );
  expect(state.calls).not.toContain("POST /api/app/posts");

  // Second attempt: the provider answers and the post is saved.
  holdProvider = false;
  for (const route of state.held.splice(0)) await route.abort().catch(() => {});
  await page.getByRole("button", { name: "Create post", exact: true }).click();
  await expect(page.getByRole("region", { name: "Post preview" })).toBeVisible({
    timeout: 30_000,
  });
  // The stored signature was reused: it was sent once across both attempts.
  expect(
    state.calls.filter((call) => call === "POST /api/app/photo_releases"),
  ).toHaveLength(1);
  const savedAt = state.calls.indexOf("POST /api/app/posts");
  expect(savedAt).toBeGreaterThan(
    state.calls.lastIndexOf("POST /api/app/photo_releases"),
  );
  expect(
    state.calls.indexOf("POST /api/app/photo_releases/qa-release-1/link-post"),
  ).toBeGreaterThan(savedAt);
  expect(createdCaption.length).toBeGreaterThan(0);
  await expect(page.getByRole("group", { name: "Share to" })).toBeVisible();

  // Linking the release advanced the post past the revision the create
  // answered with. The new post must adopt the link revision: its first save
  // and its share receipt are bound to it, or the real backend answers 409
  // and the new post can never record a share.
  const phone = (page.viewportSize()?.width ?? 1440) < 1200;
  const deliver = page.getByRole("button", {
    name: phone ? "Share to Instagram" : "Copy caption",
    exact: true,
  });
  await expect(deliver).toBeEnabled({ timeout: 15_000 });
  await deliver.click();
  await expect.poll(() => state.shares.length).toBe(1);
  expect(state.shares[0]).toMatchObject({
    channel: "instagram_feed",
    via: phone ? "share_sheet" : "copy",
  });
  // A stubbed draft save answers DRAFT_REVISION, so that one is only valid
  // when the first draft itself was sent against the link revision.
  if (state.drafts.length) {
    expect(state.drafts[0].expected_post_revision).toBe(LINK_REVISION);
  }
  for (const draft of state.drafts) {
    expect([LINK_REVISION, DRAFT_REVISION]).toContain(draft.expected_post_revision);
  }
  expect([LINK_REVISION, DRAFT_REVISION]).toContain(
    state.shares[0].expected_post_revision,
  );
  // "Shared" follows a completed share-sheet share only, never a copy.
  if (phone) {
    await expect(page.getByText("Shared · Instagram", { exact: true })).toBeVisible();
  }
});

test("ambiguous image failure saves the signed delivery with its original photo and caption", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const deliveryCaption =
    "Congratulations, Alex, on your exciting new ride! The Northline Motors team is happy to celebrate this special delivery with you. We hope every mile ahead brings another great memory. #NewCarDelivery #NorthlineMotors";
  const created = {
    id: "qa-ambiguous-image-post",
    dealer: dealer.id,
    salesperson_id: person.id,
    salesperson_name: person.name,
    scenario_id: "customer_delivery",
    platform_ids: ["facebook_feed", "instagram_feed"],
    media_output_mode: "photo",
    primary_format_id: "feed_portrait",
    image_aspect_ratio: "4:5",
    approval_status: "n_a",
    release_required: true,
    release_status: "pending",
    has_release: false,
    created: "2026-10-06 12:00:00.000Z",
    updated: "2026-10-06 12:00:00.000Z",
  };
  const imageCalls: Request[] = [];
  const degradationEvents: string[] = [];
  let captionPrompt = "";
  let savedCaption = "";
  await recordSharing(page);
  const state = await fixture(page, "salesperson", (request, path) => {
    const method = request.method();
    if (method === "POST" && path === "/api/telemetry") {
      degradationEvents.push(request.postData() || "");
      return { json: { success: true } };
    }
    if (method === "POST" && path === "/api/app/photo_releases")
      return { json: { id: "qa-ambiguous-release", customer_name: "Alex Johnson" } };
    if (
      method === "POST" &&
      path === "/api/app/photo_releases/qa-ambiguous-release/link-post"
    )
      return {
        json: {
          id: "qa-ambiguous-release",
          post: created.id,
          post_revision: "2026-10-06 12:00:01.000Z",
        },
      };
    if (path.startsWith("/api/proxy/")) {
      const task = request.headers()["x-generation-task"];
      if (task === "caption") {
        captionPrompt = request.postData() || "";
        return { json: geminiText(deliveryCaption) };
      }
      if (task === "image_standard" || task === "image_studio") {
        imageCalls.push(request);
        // The provider may have started billing before this response was lost.
        return { status: 503, json: { error: "Upstream response unavailable" } };
      }
      return undefined;
    }
    if (method === "POST" && path === "/api/app/posts") {
      savedCaption = multipartFields(request).caption || "";
      return { json: { ...created, caption: savedCaption } };
    }
    return undefined;
  });

  await page
    .getByLabel("Take a photo for Delivery", { exact: true })
    .setInputFiles({ name: "delivery.jpg", mimeType: "image/jpeg", buffer: photo });
  await page.getByRole("button", { name: "Get customer's signature" }).click();
  await signRelease(page, "Alex Johnson");
  await page.getByRole("button", { name: /Anything to mention/ }).click();
  await page
    .getByRole("textbox", { name: /Anything to mention/ })
    .fill("Picked up on her birthday.");
  await page.getByRole("button", { name: "Create post", exact: true }).click();

  await expect(page.getByRole("region", { name: "Post preview" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("img", { name: "Post image" })).toBeVisible();
  expect(captionPrompt).toContain("Picked up on her birthday.");
  expect(savedCaption).toContain("Congratulations, Alex, on your exciting new ride!");
  expect(savedCaption).toContain("#NorthlineMotors");
  expect(imageCalls).toHaveLength(1);
  expect(
    degradationEvents.some((event) => event.includes("image.fallback.original")),
    "the app records that it used the original photo after the ambiguous image failure",
  ).toBe(true);
  expect(
    state.calls.filter((call) => call.startsWith("POST /api/proxy/")),
  ).toHaveLength(2);
  expect(
    state.calls.filter((call) => call === "POST /api/app/photo_releases"),
  ).toHaveLength(1);
  expect(
    state.calls.filter(
      (call) => call === "POST /api/app/photo_releases/qa-ambiguous-release/link-post",
    ),
  ).toHaveLength(1);
  const saved = state.calls.indexOf("POST /api/app/posts");
  expect(saved).toBeGreaterThanOrEqual(0);
  expect(saved).toBeLessThan(
    state.calls.indexOf("POST /api/app/photo_releases/qa-ambiguous-release/link-post"),
  );
  expect(state.unknown).toEqual([]);
});

for (const committed of [false, true]) {
  test(`generated post recovers a ${committed ? "lost save response" : "failed save"} without another AI call`, async ({
    page,
  }, info) => {
    test.setTimeout(150_000);
    const writes: Record<string, string>[] = [];
    const recovered = {
      id: "qa-recovered-post",
      dealer: dealer.id,
      salesperson_id: person.id,
      salesperson_name: person.name,
      scenario_id: "customer_delivery",
      platform_ids: ["facebook_feed", "instagram_feed"],
      media_output_mode: "photo",
      primary_format_id: "feed_portrait",
      image_aspect_ratio: "4:5",
      approval_status: "n_a",
      release_required: true,
      release_status: "pending",
      has_release: false,
      created: "2026-10-06 12:00:00.000Z",
      updated: "2026-10-06 12:00:00.000Z",
    };
    await recordSharing(page);
    const state = await fixture(page, "salesperson", (request, path) => {
      if (request.method() === "POST" && path === "/api/app/photo_releases")
        return { json: { id: "qa-recovery-release", customer_name: "Alex Johnson" } };
      if (
        request.method() === "POST" &&
        path === "/api/app/photo_releases/qa-recovery-release/link-post"
      )
        return {
          json: {
            id: "qa-recovery-release",
            post: recovered.id,
            post_revision: DRAFT_REVISION,
          },
        };
      if (path.startsWith("/api/proxy/"))
        return {
          json: geminiText(
            request.headers()["x-generation-task"] === "caption"
              ? GENERATED_CAPTION
              : "{}",
          ),
        };
      if (request.method() === "GET" && path.startsWith("/api/app/post-operations/"))
        return committed
          ? { json: { ...recovered, caption: writes[0]?.caption || "" } }
          : {
              status: 404,
              json: {
                code: "POST_SAVE_NOT_FOUND",
                error: "This generated result has not been saved",
              },
            };
      if (request.method() === "POST" && path === "/api/app/posts") {
        writes.push(multipartFields(request));
        return writes.length === 1
          ? { status: 503, json: { error: "The save response was interrupted" } }
          : { json: { ...recovered, caption: writes[0].caption } };
      }
      return undefined;
    });
    await page
      .getByLabel("Take a photo for Delivery", { exact: true })
      .setInputFiles({ name: "delivery.jpg", mimeType: "image/jpeg", buffer: photo });
    await page.getByRole("button", { name: "Get customer's signature" }).click();
    await signRelease(page, "Alex Johnson", "type");
    await page.getByRole("button", { name: "Create post", exact: true }).click();
    await expect(page.getByRole("region", { name: "Post preview" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("Your post is ready, but not saved")).toBeVisible();
    // Compare the entire payload without sending hundreds of thousands of
    // numbers through the test protocol or constructing a huge failure diff.
    const previewFingerprint = () =>
      page.getByRole("img", { name: "Post image" }).evaluate(async (element) => {
        const source = (element as HTMLImageElement).src;
        const bytes = await (await fetch(source)).arrayBuffer();
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        return {
          length: bytes.byteLength,
          sha256: Array.from(new Uint8Array(digest), (byte) =>
            byte.toString(16).padStart(2, "0"),
          ).join(""),
        };
      });
    const image = await previewFingerprint();
    expect(image.length).toBeGreaterThan(0);
    const providerCalls = state.calls.filter((call) =>
      call.includes(" /api/proxy/"),
    ).length;
    expect(providerCalls).toBeGreaterThan(0);
    expect(writes).toHaveLength(1);
    expect(writes[0].save_operation_id).toMatch(/^[a-f0-9]{32,64}$/);
    expect(writes[0].save_payload_digest).toMatch(/^[a-f0-9]{64}$/);
    await quality(page);
    await shot(
      page,
      committed ? "save-response-recovery" : "save-failure-recovery",
      info.project.name,
    );
    await page.getByRole("button", { name: "Retry saving post", exact: true }).click();
    await expect(page.getByText("Your post is ready, but not saved")).toHaveCount(0);
    const phone = (page.viewportSize()?.width ?? 1440) < 1200;
    const shareButton = page.getByRole("button", {
      name: phone ? "Share to Instagram" : "Copy caption",
      exact: true,
    });
    await expect(shareButton).toBeEnabled({ timeout: 15_000 });
    expect(await previewFingerprint()).toEqual(image);
    expect(state.calls.filter((call) => call.includes(" /api/proxy/"))).toHaveLength(
      providerCalls,
    );
    expect(
      state.calls.filter((call) => call === "POST /api/app/photo_releases"),
    ).toHaveLength(1);
    expect(writes).toHaveLength(committed ? 1 : 2);
    for (const write of writes) {
      expect(write.save_operation_id).toBe(writes[0].save_operation_id);
      expect(write.save_payload_digest).toBe(writes[0].save_payload_digest);
    }
    await shareButton.click();
    await expect.poll(() => state.shares.length).toBe(1);
    expect(state.shares[0].expected_post_revision).toBe(DRAFT_REVISION);
  });
}

test("installed iPhone fills its canvas with a stale viewport and reachable image/video actions", async ({
  page,
}, info) => {
  test.skip(
    !info.project.name.endsWith("phone-390"),
    "Representative installed phone in both browser engines.",
  );
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", {
      configurable: true,
      get: () => true,
    });
    Object.defineProperty(screen, "width", {
      configurable: true,
      get: () => document.documentElement.clientWidth,
    });
    Object.defineProperty(screen, "height", {
      configurable: true,
      get: () => document.documentElement.clientHeight,
    });
    const nativeInnerHeight = () => document.documentElement.clientHeight;
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      get: () => nativeInnerHeight() - 93,
    });
    if (window.visualViewport)
      Object.defineProperty(window.visualViewport, "height", {
        configurable: true,
        get: () =>
          (window as unknown as { __keyboardHeight?: number }).__keyboardHeight ||
          nativeInnerHeight() - 93,
      });
  });
  const encodedVideo = readFileSync(
    resolve("e2e/fixtures/studio-preview-6s.mp4"),
  ).toString("base64");
  await fixture(page, "salesperson", (request, path) => {
    if (path.startsWith("/api/proxy/"))
      return {
        json: request.url().includes(":predictLongRunning")
          ? { name: "operations/installed-preview" }
          : {
              name: "operations/installed-preview",
              done: true,
              response: {
                generateVideoResponse: {
                  generatedSamples: [{ video: { encodedVideo } }],
                },
              },
            },
      };
    if (path.endsWith("/video-generated")) return { json: { id: "qa-post" } };
    return undefined;
  });
  await expect(
    page.getByRole("heading", { name: "Your next great post." }),
  ).toBeVisible({ timeout: 15000 });
  await seedRestoredPost(page, ["facebook_feed", "instagram_feed"], true);
  await recordSharing(page);
  await page.reload();
  await page.evaluate(() => {
    document.documentElement.style.setProperty("--sat", "59px");
    document.documentElement.style.setProperty("--sab", "34px");
  });
  const share = page.getByRole("button", { name: "Share to Facebook", exact: true });
  await expect(share).toBeEnabled({ timeout: 15000 });
  const assertCanvas = async (expectedHeight: number) => {
    await expect
      .poll(() =>
        page.locator("#root").evaluate((root) => root.getBoundingClientRect().bottom),
      )
      .toBe(expectedHeight);
    const geometry = await page.evaluate(() => {
      const bar = document.querySelector<HTMLElement>(".phone-action-bar")!;
      return {
        rootBottom: document.getElementById("root")!.getBoundingClientRect().bottom,
        bodyPosition: getComputedStyle(document.body).position,
        barPosition: getComputedStyle(bar).position,
        barBottom: bar.getBoundingClientRect().bottom,
        headerTop: document.querySelector("header")!.getBoundingClientRect().top,
        portrait: window.matchMedia("(orientation: portrait)").matches,
      };
    });
    expect(geometry.rootBottom).toBe(expectedHeight);
    expect(geometry.bodyPosition).toBe("relative");
    expect(geometry.barPosition).toBe("absolute");
    expect(geometry.barBottom).toBe(expectedHeight);
    expect(geometry.headerTop).toBe(geometry.portrait ? 79 : 59);
  };
  await assertCanvas(844);
  await page.getByRole("button", { name: "Add video", exact: true }).click();
  const versions = page.getByRole("group", { name: "Preview version", exact: true });
  await expect(
    versions.getByRole("button", { name: "Video", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Post video", { exact: true })).toBeInViewport();
  await versions.getByRole("button", { name: "Image", exact: true }).click();
  await expect(
    versions.getByRole("button", { name: "Image", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("img", { name: "Post image", exact: true }),
  ).toBeInViewport();
  const previews = page.getByRole("group", {
    name: "Image and video previews",
    exact: true,
  });
  await expect
    .poll(() => previews.evaluate((rail) => rail.scrollLeft / rail.clientWidth))
    .toBeGreaterThanOrEqual(0.9);
  await previews.evaluate((rail) => rail.scrollTo({ left: 0 }));
  await expect(
    versions.getByRole("button", { name: "Video", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await assertCanvas(844);
  await page.getByRole("button", { name: "Edit caption", exact: true }).click();
  await page.getByLabel("Caption", { exact: true }).focus();
  await page.evaluate(() => {
    (window as unknown as { __keyboardHeight?: number }).__keyboardHeight = 410;
    window.visualViewport?.dispatchEvent(new Event("resize"));
  });
  await assertCanvas(410);
  await page
    .getByLabel("Caption", { exact: true })
    .evaluate((editor: HTMLTextAreaElement) => editor.blur());
  await assertCanvas(844);
  await page.evaluate(() => {
    delete (window as unknown as { __keyboardHeight?: number }).__keyboardHeight;
    window.dispatchEvent(new Event("pageshow"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await assertCanvas(844);
  await page.setViewportSize({ width: 844, height: 390 });
  await assertCanvas(390);
  await page.setViewportSize({ width: 390, height: 844 });
  await assertCanvas(844);
  await share.click();
  expect(await shareCalls(page)).toHaveLength(1);
  expect(await clipboardWrites(page)).toHaveLength(1);
  // The extra clear strip belongs only to an installed Apple phone.
  await page.evaluate(() => {
    Object.defineProperty(navigator, "standalone", {
      configurable: true,
      get: () => false,
    });
    window.dispatchEvent(new Event("pageshow"));
  });
  await expect(page.locator("html")).toHaveAttribute("data-apple-standalone", "false");
  await expect
    .poll(() =>
      page
        .locator("#root")
        .evaluate((root) => Number.parseFloat(getComputedStyle(root).paddingTop)),
    )
    .toBe(59);
});

test("restored Post prepares direct sharing and follows Sunlight preference", async ({
  page,
}, info) => {
  test.setTimeout(60_000);
  const state = await fixture(page);
  await expect(
    page.getByRole("heading", { name: "Your next great post." }),
  ).toBeVisible();
  await seedRestoredPost(page);
  await recordSharing(page);
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

  // The draft save is bound to the revision the session restored.
  await expect.poll(() => state.drafts.length).toBeGreaterThan(0);
  expect(state.drafts[0].expected_post_revision).toBe(SEEDED_REVISION);
  for (const draft of state.drafts) {
    expect([SEEDED_REVISION, DRAFT_REVISION]).toContain(draft.expected_post_revision);
  }

  if ((page.viewportSize()?.width ?? 1440) < 1200) {
    const share = page.getByRole("button", { name: "Share to Facebook", exact: true });
    await expect(share).toBeEnabled({ timeout: 15000 });
    await shot(page, "post-light", info.project.name);
    await share.click();
    await expect.poll(() => shareCalls(page).then((calls) => calls.length)).toBe(1);
    // Facebook drops shared text, so the sheet carries the file only and the
    // caption goes to the clipboard, led by the employee disclosure.
    expect((await shareCalls(page))[0]).toEqual({
      files: 1,
      text: undefined,
      title: undefined,
    });
    await expect
      .poll(() => clipboardWrites(page).then((writes) => writes.length))
      .toBeGreaterThan(0);
    expect(
      (await clipboardWrites(page))[0].startsWith(`${EMPLOYEE_DISCLOSURE}\n\n`),
    ).toBe(true);
    // The receipt carries the channel, the method and the saved revision.
    await expect.poll(() => state.shares.length).toBe(1);
    expect(state.shares[0]).toEqual({
      channel: "facebook_feed",
      via: "share_sheet",
      expected_post_revision: DRAFT_REVISION,
      caption_mode: "primary",
      disclosures: "",
    });
    await expect(page.getByText("Shared · Facebook", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Done", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Your next great post." }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  } else {
    await expect(
      page.getByRole("button", { name: "Download for Facebook", exact: true }),
    ).toBeEnabled({ timeout: 15000 });
    await shot(page, "post-light", info.project.name);
    await page.getByRole("button", { name: "Copy caption", exact: true }).click();
    await expect
      .poll(() => clipboardWrites(page).then((writes) => writes.length))
      .toBe(1);
    expect(
      (await clipboardWrites(page))[0].startsWith(`${EMPLOYEE_DISCLOSURE}\n\n`),
    ).toBe(true);
    await expect.poll(() => state.shares.length).toBe(1);
    expect(state.shares[0]).toEqual({
      channel: "facebook_feed",
      via: "copy",
      expected_post_revision: DRAFT_REVISION,
      caption_mode: "primary",
      disclosures: "",
    });
  }
});

test("My work reopens a saved post and shares it with the disclosure first", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const saved = {
    id: "qa-saved-post",
    dealer: dealer.id,
    salesperson_id: person.id,
    salesperson_name: person.name,
    scenario_id: "team_anniversary",
    caption:
      "Five great years on the Northline Motors team. Thank you for every handshake!",
    disclosures: "",
    platform_ids: ["facebook_feed", "linkedin"],
    platform_captions: {},
    media_output_mode: "photo",
    primary_format_id: "feed_portrait",
    image_aspect_ratio: "4:5",
    approval_status: "n_a",
    release_required: false,
    release_status: "not_required",
    has_release: false,
    customer_identity_required: false,
    image_review_required: false,
    creative_image_url: "/api/files/posts/qa-saved-post/creative.jpg",
    created: "2026-10-05 15:00:00.000Z",
    // A PocketBase list item carries its record time; the client uses it as
    // the revision it shares against.
    updated: "2026-10-05 15:00:00.000Z",
  };
  await recordSharing(page);
  const state = await fixture(page, "salesperson", (request, path) => {
    if (request.method() === "GET" && path === "/api/app/posts")
      return { json: { items: [saved], nextCursor: null } };
    if (request.method() === "GET" && path === saved.creative_image_url)
      return { body: photo, contentType: "image/jpeg" };
    return undefined;
  });
  await expect(
    page.getByRole("heading", { name: "Your next great post." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "See all" }).click();
  // Home's preview has the same Open label. Wait for the destination before
  // clicking so its image request cannot belong to the exiting Home screen.
  const work = page.getByRole("region", { name: "My work", exact: true });
  // The first visit compiles this lazy screen on Vite's CI development server.
  // Use the workspace-load budget before exercising its saved-post controls.
  await expect(work.getByRole("heading", { name: "My work", level: 1 })).toBeVisible({
    timeout: 15000,
  });
  await work.getByRole("button", { name: /^Open Team/ }).click();
  await expect(page.getByRole("region", { name: "Post preview" })).toBeVisible();
  const channels = page.getByRole("group", { name: "Share to" });
  await channels.getByRole("button", { name: "LinkedIn" }).click();
  await expect(channels.getByRole("button", { name: "LinkedIn" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  if ((page.viewportSize()?.width ?? 1440) < 1200) {
    const share = page.getByRole("button", { name: "Share to LinkedIn", exact: true });
    await expect(share).toBeEnabled({ timeout: 15000 });
    const revisionAtShare = state.drafts.length ? DRAFT_REVISION : saved.updated;
    await share.click();
    await expect.poll(() => shareCalls(page).then((calls) => calls.length)).toBe(1);
    const [sheet] = await shareCalls(page);
    expect(sheet.files).toBe(1);
    // The caption is copied before the sheet opens, and it leads with the
    // employee disclosure.
    await expect
      .poll(() => clipboardWrites(page).then((writes) => writes.length))
      .toBeGreaterThan(0);
    const [copied] = await clipboardWrites(page);
    expect(copied.startsWith(`${EMPLOYEE_DISCLOSURE}\n\n`)).toBe(true);
    expect(copied).toContain("Five great years on the Northline Motors team.");
    // LinkedIn takes that text with the file, except on Apple touch devices:
    // Safari can accept file + text and then drop it, so iOS gets a file-only
    // sheet and the copied caption is the paste path (services/publishTargets.ts).
    const appleTouch = await page.evaluate(
      () =>
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
    );
    if (appleTouch) expect(sheet.text).toBeUndefined();
    else expect(sheet.text).toBe(copied);
    await expect.poll(() => state.shares.length).toBe(1);
    expect(state.shares[0]).toEqual({
      channel: "linkedin",
      via: "share_sheet",
      expected_post_revision: revisionAtShare,
      caption_mode: "primary",
      disclosures: "",
    });
    await expect(page.getByText("Shared · LinkedIn", { exact: true })).toBeVisible();
  } else {
    const copy = page.getByRole("button", { name: "Copy caption", exact: true });
    await expect(copy).toBeEnabled({ timeout: 15000 });
    const revisionAtShare = state.drafts.length ? DRAFT_REVISION : saved.updated;
    await copy.click();
    await expect
      .poll(() => clipboardWrites(page).then((writes) => writes.length))
      .toBe(1);
    const [copied] = await clipboardWrites(page);
    expect(copied.startsWith(`${EMPLOYEE_DISCLOSURE}\n\n`)).toBe(true);
    expect(copied).toContain("Five great years on the Northline Motors team.");
    await expect.poll(() => state.shares.length).toBe(1);
    expect(state.shares[0]).toEqual({
      channel: "linkedin",
      via: "copy",
      expected_post_revision: revisionAtShare,
      caption_mode: "primary",
      disclosures: "",
    });
  }
  // Every draft save of the reopened post was bound to a revision it was given.
  for (const draft of state.drafts) {
    expect([saved.updated, DRAFT_REVISION]).toContain(draft.expected_post_revision);
  }
});

test("saved work searches older pages and retries without losing loaded posts", async ({
  page,
}, info) => {
  const newer = {
    id: "qa-newer-post",
    dealer: dealer.id,
    salesperson_id: person.id,
    salesperson_name: person.name,
    scenario_id: "team_anniversary",
    caption: "A great year on the Northline Motors team.",
    approval_status: "n_a",
    release_required: false,
    image_review_required: false,
    creative_image_url: "/api/files/posts/qa-newer-post/creative.jpg",
    generated_at: "2026-10-05 15:00:00.000Z",
    updated: SEEDED_REVISION,
  };
  const older = {
    ...newer,
    id: "qa-older-post",
    scenario_id: "new_arrival",
    vin: "1FTFW1E50PFA00001",
    caption: "A fresh arrival at Northline Motors.",
    approval_status: "pending",
    creative_image_url: "/api/files/posts/qa-older-post/creative.jpg",
    generated_at: "2026-10-01 15:00:00.000Z",
  };
  const cursor = `${newer.generated_at}|${newer.id}`;
  let olderAttempts = 0;
  const messages: string[] = [];
  page.on("pageerror", (error) => messages.push(error.message));
  const state = await fixture(page, "salesperson", (request, path) => {
    if (request.method() === "GET" && path === "/api/app/posts") {
      const params = new URL(request.url()).searchParams;
      if (params.get("approval_status") === "pending")
        return { json: { items: [older], nextCursor: null } };
      if (params.get("approval_status") === "approved")
        return { json: { items: [], nextCursor: null } };
      if (params.get("cursor") === cursor) {
        olderAttempts += 1;
        if (olderAttempts === 1)
          return { status: 503, json: { error: "Could not load your posts." } };
        return { json: { items: [older], nextCursor: null } };
      }
      return { json: { items: [newer], nextCursor: cursor } };
    }
    if (request.method() === "GET" && /\/creative\.jpg$/.test(path))
      return { body: photo, contentType: "image/jpeg" };
    return undefined;
  });
  await page.getByRole("button", { name: "See all" }).click();
  const search = page.getByRole("searchbox", { name: "Search saved posts" });
  await expect(page.getByRole("button", { name: "Go back", exact: true })).toHaveCount(
    1,
  );
  await expect(page.getByRole("button", { name: "Back", exact: true })).toHaveCount(0);
  await search.fill(older.vin);
  await expect(page.getByText("No matching posts", { exact: true })).toBeVisible();
  const olderButton = page.getByRole("button", { name: "Show older posts" });
  await expect(olderButton).toBeVisible();
  await olderButton.click();
  await expect(page.getByRole("alert")).toContainText("Could not load your posts");
  await expect(page.getByText("0 of 1 loaded posts", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Open New arrival/ })).toBeVisible();
  expect(olderAttempts).toBe(2);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("1 of 2 loaded posts", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Open Team/ })).toBeVisible();
  await expect(page.getByText("2 of 2 loaded posts", { exact: true })).toBeVisible();
  const review = page.getByRole("combobox", { name: "Review", exact: true });
  expect((await review.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await review.selectOption("approved");
  await expect(page.getByText("No matching posts", { exact: true })).toBeVisible();
  await expect(page.getByText("No posts yet", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(review).toHaveValue("all");
  await review.selectOption("pending");
  await expect(page.getByRole("button", { name: /^Open New arrival/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Open Team/ })).toHaveCount(0);
  await expect(
    page.getByText("Waiting for approval", { exact: true }).last(),
  ).toBeVisible();
  const metrics = await page.evaluate(() => ({
    title: document.title,
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    overlay: Boolean(document.querySelector("vite-error-overlay")),
  }));
  expect(metrics.title).toContain("Dealer Social");
  expect(metrics.overflow).toBe(false);
  expect(metrics.overlay).toBe(false);
  expect(messages).toEqual([]);
  expect(state.unknown).toEqual([]);
  if (process.env.E2E_SCREENSHOT_DIR) {
    mkdirSync(process.env.E2E_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({
      path: resolve(
        process.env.E2E_SCREENSHOT_DIR,
        `saved-work-${info.project.name}.png`,
      ),
      fullPage: false,
    });
  }
  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your next great post." }),
  ).toBeVisible();
});

test("system admin sees AI connections and setup guidance", async ({ page }, info) => {
  // The axe scan of the long Connections page (setup steps open) passes 30 s
  // on CI's phone projects; the settings test below needs the same room.
  test.setTimeout(90_000);
  await fixture(page, "super_admin");
  await page.getByRole("tab", { name: "Connections" }).click();
  await expect(
    page.getByRole("heading", { name: "Connections", exact: true }),
  ).toBeVisible();
  const gemini = page.getByRole("article", { name: "Google Gemini" });
  await gemini.getByRole("button", { name: "Set up" }).click();
  await expect(gemini.getByLabel("Gemini API key")).toHaveValue("");
  await page.getByRole("main").locator("details").last().locator("summary").click();
  await expect(page.getByText("API contract", { exact: true })).toBeVisible();
  await expect(page.getByText("walkaroundStudio", { exact: true })).toBeVisible();
  await quality(page);
  await shot(page, "admin-connections", info.project.name);
});

test("dealership setup exposes store instructions and advanced workflow, without provider controls", async ({
  page,
}, info) => {
  // Four sections, each with an axe scan and a full-page screenshot.
  test.setTimeout(120_000);
  await page.addInitScript(() =>
    localStorage.setItem("dsp.dealerSetupDismissed.v1.qa-dealer", "1"),
  );
  await fixture(page, "dealer_admin");
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  const sections = page.getByRole("navigation", {
    name: "Dealership settings sections",
  });
  await expect(sections).toBeVisible();
  // The setup progress bar sits under the section rail from lg; below lg the
  // sections are a chip row with no bar.
  const progress = page.getByRole("progressbar", { name: "Store setup progress" });
  if ((page.viewportSize()?.width ?? 1440) >= 1024)
    await expect(progress).toBeVisible();
  else await expect(progress).toBeHidden();
  await quality(page);
  await shot(page, "manager-profile", info.project.name);
  await sections.getByRole("button", { name: /^Voice/ }).click();
  await expect(page.getByRole("heading", { name: "Voice", exact: true })).toBeVisible();
  await expect(page.getByText("Providers and automation")).toHaveCount(0);
  await expect(page.getByText("Setup instructions")).toHaveCount(0);
  await quality(page);
  await shot(page, "manager-voice", info.project.name);
  await sections.getByRole("button", { name: /^Workflow/ }).click();
  await page
    .getByRole("button", { name: "Advanced workflow controls", exact: true })
    .click();
  await expect(page.getByText("Team feature access", { exact: true })).toBeVisible();
  await quality(page);
  await shot(page, "manager-workflow", info.project.name);
  await sections.getByRole("button", { name: /^Channels/ }).click();
  await expect(page.getByText("Dealership website", { exact: true })).toBeVisible();
  await quality(page);
  await shot(page, "manager-channels", info.project.name);
});
