import { expect, test, type Page } from "@playwright/test";
import type {
  ConnectionDealer,
  ConnectionServiceId,
  ConnectionsResponse,
  ManagedConnection,
} from "../services/connections";

const DESKTOP_PROJECT = "chromium-desktop-1440";
const MOBILE_PROJECT = "chromium-phone-390";

const dealers: ConnectionDealer[] = [
  { id: "northside-qa", name: "Northside Motors" },
  { id: "southside-qa", name: "Southside Motors" },
];

const connection = (
  service: ConnectionServiceId,
  state: ManagedConnection["state"],
  overrides: Partial<ManagedConnection> = {},
): ManagedConnection => ({
  service,
  scope: service === "website" ? "dealer" : "global",
  ...(service === "website" ? { dealerId: dealers[0].id } : {}),
  configured: state !== "needs_setup" && state !== "off",
  enabled: state !== "off",
  revision: 1,
  state,
  capabilities: [],
  nextAction:
    state === "ready" ? "No action needed." : "Save settings, then run a test.",
  settings: {},
  credentialConfigured: {},
  ...overrides,
});

const makeConnections = (): ConnectionsResponse => ({
  scope: "guided_setup",
  secureStorageAvailable: true,
  dealers,
  services: [
    connection("gemini", "needs_setup", {
      revision: 0,
      capabilities: [
        { id: "caption_text", label: "Caption generation", state: "not_tested" },
        { id: "image_generation", label: "Image generation", state: "not_tested" },
        { id: "video_generation", label: "Video generation", state: "not_tested" },
      ],
    }),
    connection("anthropic", "off", { configured: false, enabled: false }),
    connection("openai", "off", { configured: false, enabled: false }),
    connection("website", "off", {
      dealerId: dealers[0].id,
      configured: false,
      enabled: false,
    }),
    connection("website", "needs_test", {
      dealerId: dealers[1].id,
      revision: 2,
      configured: true,
      enabled: true,
      settings: {
        siteUrl: "https://southside.example",
        destinationId: "southside-private-drafts",
      },
      credentialConfigured: { sharedSecret: true },
      capabilities: [
        { id: "websiteReady", label: "Private draft delivery", state: "not_tested" },
      ],
    }),
    connection("walkaround", "off", { configured: false, enabled: false }),
  ],
  apiContractVersion: "guided-setup-e2e",
  modelPolicyVersion: "5",
});

const json = (body: unknown, status = 200) => ({
  status,
  contentType: "application/json",
  body: JSON.stringify(body),
});

async function installAdminApi(page: Page) {
  const state = makeConnections();
  const requests: Array<{ path: string; method: string; body?: unknown }> = [];
  let websiteTestAttempts = 0;
  let geminiTestAttempts = 0;

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;
    let body: Record<string, unknown> = {};
    if (method !== "GET" && request.postData()) {
      try {
        body = request.postDataJSON() as Record<string, unknown>;
      } catch {
        body = {};
      }
    }
    requests.push({ path, method, ...(Object.keys(body).length ? { body } : {}) });

    if (path === "/api/app/session" && method === "GET") {
      return route.fulfill(
        json({
          role: "super_admin",
          dealer: { id: "system-admin-qa", name: "System Admin" },
          person: null,
          is_impersonation: false,
        }),
      );
    }
    if (path === "/api/app/dealers" && method === "GET") {
      return route.fulfill(json({ items: dealers }));
    }
    if (path === "/api/app/connections" && method === "GET") {
      return route.fulfill(json(state));
    }
    if (path === "/api/app/connections/proofs" && method === "GET") {
      const service = url.searchParams.get("service");
      const dealerId = url.searchParams.get("dealerId");
      const items =
        service === "website" && dealerId === dealers[1].id
          ? [
              {
                id: "website-proof-south-1",
                label: "Approved release · Morning delivery",
                state: "verified",
              },
            ]
          : service === "walkaround" && dealerId === dealers[0].id
            ? [
                {
                  id: "walkaround-proof-north-1",
                  label: "Completed private project · Test clip",
                  state: "verified",
                },
              ]
            : [];
      return route.fulfill(json({ items }));
    }
    if (path === "/api/app/connections/gemini" && method === "PATCH") {
      const target = state.services.find((item) => item.service === "gemini")!;
      target.configured = true;
      target.enabled = Boolean(body.enabled);
      target.revision += 1;
      target.state = "needs_test";
      target.credentialConfigured = { apiKey: true };
      target.nextAction = "Run a text test.";
      // The stub intentionally returns only the server's secret-presence flag.
      return route.fulfill(json(target));
    }
    if (path === "/api/app/connections/website" && method === "PATCH") {
      const dealerId = String(body.dealerId ?? "");
      const target = state.services.find(
        (item) => item.service === "website" && item.dealerId === dealerId,
      );
      if (!target) return route.fulfill(json({ error: "Unknown dealership" }, 404));
      target.configured = true;
      target.enabled = Boolean(body.enabled);
      target.revision += 1;
      target.state = "needs_test";
      target.settings = (body.settings as ManagedConnection["settings"]) ?? {};
      target.credentialConfigured = { sharedSecret: true };
      return route.fulfill(json(target));
    }
    if (path.endsWith("/test") && method === "POST") {
      const service = path.split("/").at(-2) as ConnectionServiceId;
      const dealerId = String(body.dealerId ?? "");
      const proofId = String(body.proofId ?? "");
      const target = state.services.find(
        (item) =>
          item.service === service &&
          (service !== "website" || item.dealerId === dealerId),
      );
      if (
        !target ||
        !body.idempotencyKey ||
        ((service === "website" || service === "walkaround") && !proofId)
      ) {
        return route.fulfill(json({ error: "A valid test proof is required" }, 400));
      }
      if (service === "website") {
        websiteTestAttempts += 1;
        // Simulate an ambiguous network/server failure, followed by a
        // confirmed pending receipt, then a completed private receipt.
        if (websiteTestAttempts === 1) {
          return route.fulfill(json({ error: "Temporary delivery timeout" }, 503));
        }
        if (websiteTestAttempts === 2) {
          target.state = "needs_test";
          target.errorCode = "CONNECTION_DRAFT_PENDING";
          target.nextAction = "Test this same saved draft again to confirm receipt.";
          return route.fulfill(json(target));
        }
      }
      if (service === "gemini" && geminiTestAttempts++ === 0) {
        target.state = "testing";
        target.errorCode = "CONNECTION_TEST_UNKNOWN";
        target.nextAction = "The test response was interrupted. Retry to confirm.";
        return route.fulfill(json(target));
      }
      target.state = "ready";
      delete target.errorCode;
      target.lastVerifiedAt = "2026-10-09T12:00:00.000Z";
      target.nextAction = "No action needed.";
      if (service === "gemini") {
        target.capabilities = [
          { id: "caption_text", label: "Caption generation", state: "verified" },
          { id: "image_generation", label: "Image generation", state: "not_tested" },
          { id: "video_generation", label: "Video generation", state: "not_tested" },
        ];
      }
      if (service === "website") {
        target.capabilities = [
          { id: "websiteReady", label: "Private draft delivery", state: "verified" },
        ];
      }
      return route.fulfill(json(target));
    }
    if (path === "/api/app/health" && method === "GET") {
      return route.fulfill(
        json({
          ok: true,
          ts: "2026-10-09T12:00:00.000Z",
          checks: {},
          version: "e2e",
          releaseSha: "e2e-guided-connections",
          apiContractVersion: "guided-setup-e2e",
          modelPolicyVersion: "5",
          backup: { configured: false, status: "not_configured" },
        }),
      );
    }
    if (path === "/api/telemetry") return route.fulfill(json({ success: true }));

    return route.fulfill(json({ error: "Unexpected API request" }, 404));
  });

  return { requests };
}

async function openConnections(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("tab", { name: "Connections" })).toBeVisible();
  await page.getByRole("tab", { name: "Connections" }).click();
  await expect(
    page.getByRole("heading", { name: "Connections", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("article", { name: "Google Gemini" })).toBeVisible();
}

test.describe("guided system connections", () => {
  test("saves and tests shared AI, keeps off options neutral, and tests a dealer website proof", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== DESKTOP_PROJECT,
      "Run the stateful connections journey once on desktop; mobile layout has its own check.",
    );
    const { requests } = await installAdminApi(page);
    await openConnections(page);

    const anthropic = page.getByRole("article", { name: "Anthropic fallback" });
    await expect(anthropic.getByText("Off", { exact: true })).toBeVisible();
    await expect(
      anthropic.getByText("This optional service is off by choice."),
    ).toBeVisible();
    await expect(anthropic.getByRole("alert")).toHaveCount(0);

    const walkaround = page.getByRole("article", {
      name: "Walkaround video service",
    });
    await expect(walkaround.getByText("Off", { exact: true })).toBeVisible();
    await expect(
      walkaround.getByText("This optional service is off by choice."),
    ).toBeVisible();
    await walkaround.getByRole("button", { name: "Set up" }).click();
    await walkaround
      .getByLabel("Manage a dealership's YouTube account")
      .selectOption(dealers[0].id);
    const advancedSummary = walkaround
      .locator("details")
      .getByText("Advanced technical details");
    await advancedSummary.click();
    await expect(walkaround.getByLabel("Private storage bucket")).toBeVisible();
    await expect(walkaround.getByLabel("Video worker token")).toBeVisible();

    const gemini = page.getByRole("article", { name: "Google Gemini" });
    await gemini.getByRole("button", { name: "Set up" }).click();
    await gemini.getByLabel("Gemini API key").fill("e2e-temporary-key");
    await gemini.getByRole("button", { name: "Save connection" }).click();
    await expect(gemini.getByText("Test required")).toBeVisible();
    await expect(gemini.getByLabel("Gemini API key")).toHaveValue("");
    await expect(gemini.getByText(/Image generation: Not tested/)).toBeVisible();

    await gemini.getByRole("button", { name: "Test connection" }).click();
    await expect(gemini.getByText("Testing", { exact: true })).toBeVisible();
    await gemini.getByRole("button", { name: "Test connection" }).click();
    await expect(gemini.getByText("Caption access verified")).toBeVisible();
    await expect(gemini.getByText("Caption generation: Verified")).toBeVisible();
    await expect(gemini.getByText("Image generation: Not tested")).toBeVisible();
    await expect(gemini.getByText("Video generation: Not tested")).toBeVisible();
    const geminiTests = requests.filter(
      (request) => request.path === "/api/app/connections/gemini/test",
    );
    expect(geminiTests).toHaveLength(2);
    expect((geminiTests[1]?.body as Record<string, unknown>).idempotencyKey).toBe(
      (geminiTests[0]?.body as Record<string, unknown>).idempotencyKey,
    );

    const website = page.getByRole("article", { name: "Customer website drafts" });
    await website.getByRole("button", { name: "Set up" }).click();
    await website.getByLabel("Dealership").selectOption(dealers[1].id);
    await expect(website.getByLabel("Approved website address")).toHaveValue(
      "https://southside.example",
    );
    const proofSelect = website.getByLabel("Released post ID for private test");
    await expect(
      proofSelect.getByRole("option", { name: "Approved release · Morning delivery" }),
    ).toBeAttached();
    await proofSelect.selectOption("website-proof-south-1");
    await website.getByRole("button", { name: "Test connection" }).click();
    await expect(website.getByRole("alert")).toContainText(
      "Temporary delivery timeout",
    );
    const firstWebsiteTest = requests.find(
      (request) => request.path === "/api/app/connections/website/test",
    );
    expect(firstWebsiteTest?.body).toMatchObject({
      dealerId: dealers[1].id,
      proofId: "website-proof-south-1",
      expectedRevision: 2,
    });
    await website.getByRole("button", { name: "Test connection" }).click();
    await expect(
      website.getByText(
        "Draft delivery is still pending. Test this same saved draft again to confirm receipt.",
        { exact: true },
      ),
    ).toBeVisible();
    await website.getByRole("button", { name: "Test connection" }).click();
    await expect(website.getByText("Ready")).toBeVisible();
    await expect(website.getByText("Private draft delivery: Verified")).toBeVisible();

    const websiteTests = requests.filter(
      (request) => request.path === "/api/app/connections/website/test",
    );
    expect(websiteTests).toHaveLength(3);
    expect(websiteTests[0]?.body).toMatchObject({
      dealerId: dealers[1].id,
      proofId: "website-proof-south-1",
      expectedRevision: 2,
    });
    expect(websiteTests[1]?.body).toMatchObject(
      websiteTests[0]?.body as Record<string, unknown>,
    );
    expect(websiteTests[2]?.body).toMatchObject({
      dealerId: dealers[1].id,
      proofId: "website-proof-south-1",
      expectedRevision: 2,
    });
    const retryKeys = websiteTests.map(
      (request) => (request.body as Record<string, unknown>).idempotencyKey,
    );
    expect(typeof retryKeys[0]).toBe("string");
    expect(retryKeys[1]).toBe(retryKeys[0]);
    expect(retryKeys[2]).not.toBe(retryKeys[1]);
    expect(
      requests.some((request) => /public|publish|upload/i.test(request.path)),
    ).toBe(false);
    const geminiSave = requests.find(
      (request) =>
        request.path === "/api/app/connections/gemini" && request.method === "PATCH",
    );
    expect(geminiSave?.body).toMatchObject({
      confirmApply: true,
      credentials: { apiKey: "e2e-temporary-key" },
    });
    expect(JSON.stringify(stateSafeRequests(requests))).not.toContain(
      "e2e-temporary-key",
    );
  });

  test("keeps the setup cards usable on a phone and captures the mobile view", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== MOBILE_PROJECT,
      "Use the representative 390 px Chromium phone project for the mobile screenshot.",
    );
    await installAdminApi(page);
    await openConnections(page);
    await expect(
      page.getByRole("article", { name: "Walkaround video service" }),
    ).toBeVisible();
    const overflow = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    const screenshotPath = testInfo.outputPath("guided-connections-mobile.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await testInfo.attach("guided-connections-mobile", {
      path: screenshotPath,
      contentType: "image/png",
    });
  });
});

// Keep request inspection useful while ensuring the typed API key is never
// accidentally included in an assertion's diagnostic output.
const stateSafeRequests = (
  requests: Array<{ path: string; method: string; body?: unknown }>,
) =>
  requests.map(({ path, method, body }) => ({
    path,
    method,
    body:
      body && typeof body === "object"
        ? Object.fromEntries(
            Object.entries(body as Record<string, unknown>).map(([key, value]) => [
              key,
              key === "credentials" ? "[REDACTED]" : value,
            ]),
          )
        : body,
  }));
