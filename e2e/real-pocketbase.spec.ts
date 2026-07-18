import {
  expect,
  test,
  type APIResponse,
  type BrowserContext,
  type Page,
  type Response,
} from "@playwright/test";

const realPocketBaseEnabled = process.env.E2E_REAL_POCKETBASE === "true";
const adminCode = process.env.E2E_ADMIN_CODE || "";
const apiContractVersion = "2026-07-17.v2";

type JsonObject = Record<string, unknown>;

type PlaywrightResponse = APIResponse | Response;

const responseHeaders = async (
  response: PlaywrightResponse,
): Promise<Record<string, string>> =>
  "allHeaders" in response ? response.allHeaders() : response.headers();

const responseSessionCookie = async (response: PlaywrightResponse): Promise<string> => {
  const setCookie = (await responseHeaders(response))["set-cookie"] || "";
  const match = setCookie.match(/(?:^|,\s*)dealer_session=([^;,\s]+)/);
  expect(match, "response should mint a dealer_session cookie").not.toBeNull();
  return `dealer_session=${match?.[1] || ""}`;
};

/**
 * The production cookie is Secure. Chromium intentionally declines it when the
 * container canary is exposed over loopback HTTP, so install the same opaque
 * token as a loopback-only cookie before exercising authenticated UI routes.
 */
const installLoopbackSessionCookie = async (
  context: BrowserContext,
  page: Page,
  cookie: string,
) => {
  const [name, value] = cookie.split("=", 2);
  const origin = new URL(page.url()).origin;
  await context.addCookies([
    {
      name,
      value,
      url: origin,
      httpOnly: true,
      secure: origin.startsWith("https:"),
      sameSite: "Lax",
    },
  ]);
};

const expectPersonSummary = (
  value: unknown,
  expected: { name: string; role: "manager" | "salesperson" },
) => {
  expect(value).toBeTruthy();
  const person = value as JsonObject;
  expect(person.name).toBe(expected.name);
  expect(person.role).toBe(expected.role);
  expect(person.active).toBe(true);
  expect(Object.hasOwn(person, "pin")).toBe(false);
  expect(Object.hasOwn(person, "accessCode")).toBe(false);
};

const expectSessionPersonSummary = (
  value: unknown,
  expected: { name: string; role: "manager" | "salesperson" },
) => {
  expectPersonSummary(value, expected);
  const person = value as JsonObject;
  expect(Object.hasOwn(person, "hasPin")).toBe(false);
  expect(Object.hasOwn(person, "pinNeedsDistribution")).toBe(false);
  expect(Object.hasOwn(person, "created_at")).toBe(false);
};

const enterPersonalCode = async (page: Page, pin: string) => {
  expect(pin).toMatch(/^\d{4}$/);
  for (const digit of pin) {
    await page.getByRole("button", { name: `Digit ${digit}` }).click();
  }
};

const rosterRow = (page: Page, personName: string) =>
  page
    .locator("div.font-semibold.text-surface-50")
    .filter({ hasText: personName })
    .locator("xpath=../..");

const assertActiveProductionServiceWorker = async (page: Page) => {
  const result = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) {
      return { supported: false, active: false, scriptURL: "", controlled: false };
    }

    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) =>
        window.setTimeout(
          () => reject(new Error("service worker did not become ready")),
          15_000,
        ),
      ),
    ]);
    return {
      supported: true,
      active: registration.active?.state === "activated",
      scriptURL: registration.active?.scriptURL || "",
      controlled: Boolean(navigator.serviceWorker.controller),
    };
  });

  if (!result.supported) return;
  expect(result.active).toBe(true);
  expect(new URL(result.scriptURL).pathname).toBe("/sw.js");

  // A first visit may activate the worker without controlling that page. One
  // reload must put the production shell under the active worker's control.
  if (!result.controlled) await page.reload({ waitUntil: "networkidle" });
  await expect
    .poll(() =>
      page.evaluate(() => navigator.serviceWorker.controller?.scriptURL || ""),
    )
    .toContain("/sw.js");
};

test.describe("real PocketBase release flow", () => {
  test.skip(
    !realPocketBaseEnabled,
    "Set E2E_REAL_POCKETBASE=true and E2E_BASE_URL to run the container-backed flow.",
  );
  test.setTimeout(120_000);

  test("proves secure people, identity, revocation, impersonation, and the production shell", async ({
    browser,
    browserName,
    context,
    page,
  }, testInfo) => {
    expect(adminCode).toMatch(/^[A-Za-z0-9]{12}$/);

    await page.goto("/", { waitUntil: "networkidle" });
    if (browserName === "chromium") {
      await assertActiveProductionServiceWorker(page);
    }

    // A mixed-case deployment secret must not accept a case-altered variant.
    const caseIndex = adminCode.search(/[A-Za-z]/);
    if (caseIndex >= 0) {
      const char = adminCode[caseIndex];
      const wrongCaseCode =
        adminCode.slice(0, caseIndex) +
        (char === char.toUpperCase() ? char.toLowerCase() : char.toUpperCase()) +
        adminCode.slice(caseIndex + 1);
      const wrongCaseResponse = await page.request.post("/api/app/session", {
        data: { dealerCode: wrongCaseCode },
      });
      expect(wrongCaseResponse.status()).toBe(401);
      expect((await wrongCaseResponse.json()).code).toBe("INVALID_CODE");
    }

    await page.getByRole("button", { name: "System admin" }).click();
    await page.getByLabel("System admin code", { exact: true }).fill(adminCode);
    const adminLoginPromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/app/session") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Continue to system admin" }).click();
    const adminLoginResponse = await adminLoginPromise;
    expect(adminLoginResponse.status()).toBe(200);
    const adminSession = (await adminLoginResponse.json()) as JsonObject;
    expect(adminSession.role).toBe("super_admin");
    expect(JSON.stringify(adminSession)).not.toContain('"pin"');

    let adminCookie = await responseSessionCookie(adminLoginResponse);
    await installLoopbackSessionCookie(context, page, adminCookie);

    // Exercise the actual PocketBase JSVM callback boundary. Static imports do
    // not catch handler-scope mistakes because PB serializes each route into an
    // isolated program. The CI origin is a deterministic upstream stub.
    const healthBeforeResponse = await page.request.get("/api/app/health", {
      headers: { Cookie: adminCookie },
    });
    expect([200, 503]).toContain(healthBeforeResponse.status());
    const healthBefore = (await healthBeforeResponse.json()) as {
      generation: { providerAttempts24h: number; providerFailures24h: number };
      recentErrors: { total24h: number };
      modelPolicyVersion: string;
    };
    const generationAttemptId = `e2e_${Date.now().toString(36)}_${"a".repeat(20)}`;
    const providerResponse = await page.request.post(
      "/api/proxy/v1beta/models/gemini-3.5-flash:generateContent",
      {
        headers: {
          Cookie: adminCookie,
          "X-Generation-Task": "caption",
          "X-Generation-Attempt-ID": generationAttemptId,
          "X-Model-Policy-Version": healthBefore.modelPolicyVersion,
        },
        data: {
          contents: [
            {
              parts: [{ text: "Synthetic release canary caption" }],
            },
          ],
          generationConfig: { maxOutputTokens: 2048 },
        },
      },
    );
    expect(providerResponse.status()).toBe(429);
    expect(await providerResponse.json()).toMatchObject({
      error: { status: "RESOURCE_EXHAUSTED", message: "Synthetic provider failure" },
    });

    const syntheticVin = "1HGCM82633A004352";
    const telemetryResponse = await page.request.post("/api/telemetry", {
      data: {
        level: "error",
        name: `runtime.canary.${syntheticVin}${syntheticVin}`,
        message: `Discard this customer name and ${syntheticVin}`,
        payload: {
          task: "caption",
          errorCode: "SYNTHETIC_PROVIDER_FAILURE",
          releaseSha: "ci-runtime-canary",
          apiContractVersion: "2026-07-17.v2",
          dealerCode: "MustNeverPersist1",
          token: "MustNeverPersist2",
        },
      },
    });
    expect(telemetryResponse.status()).toBe(200);
    expect(await telemetryResponse.json()).toEqual({ success: true });

    const healthAfterResponse = await page.request.get("/api/app/health", {
      headers: { Cookie: adminCookie },
    });
    const healthAfterText = await healthAfterResponse.text();
    const healthAfter = JSON.parse(healthAfterText) as typeof healthBefore & {
      recentErrors: {
        total24h: number;
        topActions: Array<{ name: string; count: number }>;
      };
    };
    expect(healthAfter.generation.providerAttempts24h).toBe(
      healthBefore.generation.providerAttempts24h + 1,
    );
    expect(healthAfter.generation.providerFailures24h).toBe(
      healthBefore.generation.providerFailures24h + 1,
    );
    expect(healthAfter.recentErrors.total24h).toBe(
      healthBefore.recentErrors.total24h + 1,
    );
    expect(healthAfterText).not.toContain(syntheticVin);
    expect(healthAfterText).not.toContain("MustNeverPersist");
    expect(
      healthAfter.recentErrors.topActions.some((entry) =>
        entry.name.includes("[REDACTED_VIN][REDACTED_VIN]"),
      ),
    ).toBe(true);

    await page.reload({ waitUntil: "networkidle" });

    await expect(page.getByRole("heading", { name: "System Admin" })).toBeVisible({
      timeout: 15_000,
    });
    // WebKit can replace the loopback-only non-Secure test cookie when the
    // restored-session response refreshes the real production Secure cookie.
    // Reinstall the same opaque token after proving restore so subsequent UI
    // mutations exercise authorization over HTTP exactly as Chromium does.
    await installLoopbackSessionCookie(context, page, adminCookie);
    await expect(page.getByRole("tab", { name: "Dealers" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("tab", { name: "Admins" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Users" })).toBeVisible();
    await expect(page.getByLabel("Dealership view")).toHaveValue("");

    const suffix = `${testInfo.project.name}-${Date.now().toString(36)}`
      .replace(/[^a-z0-9-]/gi, "")
      .slice(-32);
    const dealerName = `E2E Northline ${suffix}`;
    const managerName = `E2E Manager ${suffix}`;
    const salespersonName = `E2E Sales ${suffix}`;

    await page.getByRole("button", { name: "Add Dealer" }).click();
    await page.getByLabel("Dealer name *").fill(dealerName);
    const createDealerPromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/app/dealers") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Create dealer" }).click();
    const createDealerResponse = await createDealerPromise;
    expect(createDealerResponse.status()).toBe(200);
    const dealerId = String(((await createDealerResponse.json()) as JsonObject).id);
    expect(dealerId).toMatch(/^[a-z0-9]{15}$/);
    await expect(page.locator("h3").filter({ hasText: dealerName })).toBeVisible();

    await page.getByLabel("Dealership view").selectOption(dealerId);
    await page.getByRole("tab", { name: "Admins" }).click();
    const managerPanel = page
      .getByRole("heading", { name: `Add manager · ${dealerName}` })
      .locator("..");
    await managerPanel.getByPlaceholder("e.g. Jordan Lee").fill(managerName);
    const createManagerPromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/app/salespeople") &&
        response.request().method() === "POST",
    );
    await managerPanel.getByRole("button", { name: "Add", exact: true }).click();
    const createManagerResponse = await createManagerPromise;
    expect(createManagerResponse.status()).toBe(200);
    expect((await responseHeaders(createManagerResponse))["cache-control"]).toContain(
      "no-store",
    );
    const managerCredential = (await createManagerResponse.json()) as {
      person: JsonObject;
      pin: string;
    };
    expect(managerCredential.pin).toMatch(/^\d{4}$/);
    expectPersonSummary(managerCredential.person, {
      name: managerName,
      role: "manager",
    });
    const managerId = String(managerCredential.person.id);

    await expect(
      page.locator("code").filter({ hasText: managerCredential.pin }),
    ).toBeVisible();
    const acknowledgeManagerPromise = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/app/salespeople/${managerId}/acknowledge-pin`) &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Mark as shared" }).click();
    expect((await acknowledgeManagerPromise).status()).toBe(200);
    await expect(
      page.locator("code").filter({ hasText: managerCredential.pin }),
    ).toBeHidden();

    await page.getByRole("tab", { name: "Users" }).click();
    const salespersonPanel = page
      .getByRole("heading", { name: `Add salesperson · ${dealerName}` })
      .locator("..");
    await salespersonPanel.getByPlaceholder("e.g. Sarah Chen").fill(salespersonName);
    const createSalespersonPromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/app/salespeople") &&
        response.request().method() === "POST",
    );
    await salespersonPanel.getByRole("button", { name: "Add", exact: true }).click();
    const createSalespersonResponse = await createSalespersonPromise;
    expect(createSalespersonResponse.status()).toBe(200);
    const salespersonCredential = (await createSalespersonResponse.json()) as {
      person: JsonObject;
      pin: string;
    };
    expect(salespersonCredential.pin).toMatch(/^\d{4}$/);
    expectPersonSummary(salespersonCredential.person, {
      name: salespersonName,
      role: "salesperson",
    });
    const salespersonId = String(salespersonCredential.person.id);

    // Ordinary roster payloads expose state flags, never a reusable credential.
    const rosterResponse = await page.request.get(
      `/api/app/salespeople?dealer=${dealerId}&limit=50`,
      {
        headers: {
          Cookie: adminCookie,
          "X-Dealer-Client-Contract": apiContractVersion,
        },
      },
    );
    expect(rosterResponse.status()).toBe(200);
    const roster = (await rosterResponse.json()) as { items: JsonObject[] };
    for (const item of roster.items) {
      expect(Object.hasOwn(item, "pin")).toBe(false);
      expect(Object.hasOwn(item, "accessCode")).toBe(false);
      expect(typeof item.hasPin).toBe("boolean");
      expect(typeof item.pinNeedsDistribution).toBe("boolean");
    }
    const rosterManager = roster.items.find((item) => item.id === managerId);
    expect(rosterManager?.hasPin).toBe(true);
    expect(rosterManager?.pinNeedsDistribution).toBe(false);

    // During the one-release compatibility window, a request from an older
    // client may still receive the legacy field shape. It must be a presence
    // marker only: never a reusable four-digit credential.
    const legacyRosterResponse = await page.request.get(
      `/api/app/salespeople?dealer=${dealerId}&limit=50`,
      { headers: { Cookie: adminCookie } },
    );
    expect(legacyRosterResponse.status()).toBe(200);
    const legacyRoster = (await legacyRosterResponse.json()) as {
      items: JsonObject[];
    };
    expect(legacyRoster.items.length).toBeGreaterThan(0);
    for (const item of legacyRoster.items) {
      if (Object.hasOwn(item, "pin")) expect(item.pin).toBe("****");
      expect(String(item.pin || "")).not.toMatch(/^\d{4}$/);
    }
    expect(JSON.stringify(legacyRoster)).not.toContain(managerCredential.pin);
    expect(JSON.stringify(legacyRoster)).not.toContain(salespersonCredential.pin);

    // Prove the approved all-store view can find a person and retains a store label.
    await page.getByLabel("Dealership view").selectOption("");
    await page.getByPlaceholder("Search salespeople…").fill(salespersonName);
    const filteredSalespersonRow = rosterRow(page, salespersonName);
    await expect(filteredSalespersonRow).toBeVisible();
    await expect(
      filteredSalespersonRow.getByText(dealerName, { exact: true }),
    ).toBeVisible();
    await page.getByPlaceholder("Search salespeople…").fill("");
    await page.getByLabel("Dealership view").selectOption(dealerId);

    // A manager can authenticate with the one-time handoff and receives an
    // authoritative, PIN-free identity in both API and manager UI.
    const managerContext = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      viewport: testInfo.project.use.viewport,
    });
    const managerPage = await managerContext.newPage();
    await managerPage.goto("/");
    const managerLoginPromise = managerPage.waitForResponse(
      (response) =>
        response.url().endsWith("/api/app/session") &&
        response.request().method() === "POST",
    );
    await enterPersonalCode(managerPage, managerCredential.pin);
    const managerLoginResponse = await managerLoginPromise;
    expect(managerLoginResponse.status()).toBe(200);
    const managerSession = (await managerLoginResponse.json()) as JsonObject;
    expect(managerSession.role).toBe("dealer_admin");
    expectSessionPersonSummary(managerSession.person, {
      name: managerName,
      role: "manager",
    });
    await expect(managerPage.getByText("Manager dashboard")).toBeVisible({
      timeout: 15_000,
    });
    const managerCookie = await responseSessionCookie(managerLoginResponse);
    await installLoopbackSessionCookie(managerContext, managerPage, managerCookie);

    // Persist a meaningful settings edit through the manager-owned UI, then
    // prove both the refreshed session payload and a full application reload
    // hydrate the exact stored business hours from PocketBase.
    const expectedHours =
      "Mon 8:30 AM–7:30 PM, Tue–Fri 9:00 AM–8:00 PM, Sat 9:00 AM–6:00 PM, Sun closed";
    await managerPage.getByRole("button", { name: "Settings", exact: true }).click();
    let managerSettingsCard = managerPage
      .getByRole("heading", { name: "Dealership settings" })
      .locator("xpath=../../..");
    const managerMondayOpen = managerSettingsCard.getByLabel("Monday opens");
    const managerMondayClose = managerSettingsCard.getByLabel("Monday closes");
    await managerMondayOpen.selectOption("8:30 AM");
    await managerMondayClose.selectOption("7:30 PM");
    await expect(managerMondayOpen).toHaveValue("8:30 AM");
    await expect(managerMondayClose).toHaveValue("7:30 PM");
    await expect(
      managerSettingsCard.getByText(expectedHours, { exact: true }),
    ).toBeVisible();
    const saveHoursPromise = managerPage.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/app/dealers/${dealerId}`) &&
        response.request().method() === "PATCH",
    );
    await managerSettingsCard
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    const saveHoursResponse = await saveHoursPromise;
    expect(saveHoursResponse.status()).toBe(200);
    expect(saveHoursResponse.request().postData() || "").toContain(expectedHours);

    const managerSessionAfterSaveResponse = await managerPage.request.get(
      "/api/app/session",
      { headers: { Cookie: managerCookie } },
    );
    expect(managerSessionAfterSaveResponse.status()).toBe(200);
    const managerSessionAfterSave =
      (await managerSessionAfterSaveResponse.json()) as JsonObject;
    expect((managerSessionAfterSave.dealer as JsonObject).hours).toBe(expectedHours);

    // The explicit loopback session probe above also receives PocketBase's
    // production Secure refresh cookie. Restore the HTTP-only test shim before
    // the reload so WebKit can prove the same persisted session flow.
    await installLoopbackSessionCookie(managerContext, managerPage, managerCookie);
    await managerPage.reload({ waitUntil: "networkidle" });
    await expect(managerPage.getByText("Manager dashboard")).toBeVisible({
      timeout: 15_000,
    });
    await managerPage.getByRole("button", { name: "Settings", exact: true }).click();
    managerSettingsCard = managerPage
      .getByRole("heading", { name: "Dealership settings" })
      .locator("xpath=../../..");
    await expect(managerSettingsCard.getByLabel("Monday opens")).toHaveValue("8:30 AM");
    await expect(managerSettingsCard.getByLabel("Monday closes")).toHaveValue(
      "7:30 PM",
    );
    await expect(
      managerSettingsCard.getByText(expectedHours, { exact: true }),
    ).toBeVisible();

    // Sign in directly as the newly created salesperson (not through admin
    // impersonation). The returned and restored identities are authoritative
    // summaries and never contain the reusable PIN.
    const salespersonContext = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      viewport: testInfo.project.use.viewport,
    });
    const salespersonPage = await salespersonContext.newPage();
    await salespersonPage.goto("/");
    const salespersonLoginPromise = salespersonPage.waitForResponse(
      (response) =>
        response.url().endsWith("/api/app/session") &&
        response.request().method() === "POST",
    );
    await enterPersonalCode(salespersonPage, salespersonCredential.pin);
    const salespersonLoginResponse = await salespersonLoginPromise;
    expect(salespersonLoginResponse.status()).toBe(200);
    const salespersonSession = (await salespersonLoginResponse.json()) as JsonObject;
    expect(salespersonSession.role).toBe("salesperson");
    expectSessionPersonSummary(salespersonSession.person, {
      name: salespersonName,
      role: "salesperson",
    });
    const salespersonCookie = await responseSessionCookie(salespersonLoginResponse);
    await installLoopbackSessionCookie(
      salespersonContext,
      salespersonPage,
      salespersonCookie,
    );
    await expect(
      salespersonPage.getByRole("heading", { name: "Capture the handoff." }),
    ).toBeVisible({ timeout: 15_000 });

    const restoredSalespersonResponse = await salespersonPage.request.get(
      "/api/app/session",
      { headers: { Cookie: salespersonCookie } },
    );
    expect(restoredSalespersonResponse.status()).toBe(200);
    const restoredSalesperson =
      (await restoredSalespersonResponse.json()) as JsonObject;
    expect(restoredSalesperson.role).toBe("salesperson");
    expectSessionPersonSummary(restoredSalesperson.person, {
      name: salespersonName,
      role: "salesperson",
    });

    // Old clients may still submit attribution fields for one compatibility
    // release. The backend must ignore both fields and bind the post to the
    // validated salesperson session instead.
    const spoofedSalespersonName = `Spoofed ${suffix}`;
    const createPostResponse = await salespersonPage.request.post("/api/app/posts", {
      headers: { Cookie: salespersonCookie },
      multipart: {
        salesperson_name: spoofedSalespersonName,
        salesperson_id: managerId,
        style: "Modern",
        tone: "Excited",
        caption: "Synthetic attribution canary. No provider call required.",
      },
    });
    expect(createPostResponse.status()).toBe(200);
    const createdPost = (await createPostResponse.json()) as JsonObject;
    expect(createdPost.dealer).toBe(dealerId);
    const createdPostId = String(createdPost.id);
    expect(createdPostId).toMatch(/^[a-z0-9]{15}$/);

    const managerHistoryResponse = await managerPage.request.get(
      "/api/app/posts?limit=1000",
      { headers: { Cookie: managerCookie } },
    );
    expect(managerHistoryResponse.status()).toBe(200);
    const managerHistory = (await managerHistoryResponse.json()) as {
      items: JsonObject[];
    };
    const authoritativePost = managerHistory.items.find(
      (item) => item.id === createdPostId,
    );
    expect(authoritativePost).toMatchObject({
      dealer: dealerId,
      salesperson_id: salespersonId,
      salesperson_name: salespersonName,
    });
    expect(authoritativePost?.salesperson_id).not.toBe(managerId);
    expect(authoritativePost?.salesperson_name).not.toBe(spoofedSalespersonName);

    const salespersonLogoutResponse = await salespersonPage.request.delete(
      "/api/app/session",
      { headers: { Cookie: salespersonCookie } },
    );
    expect(salespersonLogoutResponse.status()).toBe(200);
    await salespersonContext.close();

    // Rotating the manager PIN must immediately revoke the old session and code.
    const rotateResponse = await page.request.post(
      `/api/app/salespeople/${managerId}/rotate-pin`,
      { headers: { Cookie: adminCookie }, data: {} },
    );
    expect(rotateResponse.status()).toBe(200);
    expect((await responseHeaders(rotateResponse))["cache-control"]).toContain(
      "no-store",
    );
    const rotatedCredential = (await rotateResponse.json()) as {
      person: JsonObject;
      pin: string;
    };
    expect(rotatedCredential.pin).toMatch(/^\d{4}$/);
    expect(rotatedCredential.pin).not.toBe(managerCredential.pin);
    expectPersonSummary(rotatedCredential.person, {
      name: managerName,
      role: "manager",
    });

    const revokedSessionResponse = await managerPage.request.get("/api/app/session", {
      headers: { Cookie: managerCookie },
    });
    expect(revokedSessionResponse.status()).toBe(401);
    const oldPinResponse = await managerPage.request.post("/api/app/session", {
      data: { dealerCode: managerCredential.pin },
    });
    expect(oldPinResponse.status()).toBe(401);
    const rotatedPinResponse = await managerPage.request.post("/api/app/session", {
      data: { dealerCode: rotatedCredential.pin },
    });
    expect(rotatedPinResponse.status()).toBe(200);
    expectSessionPersonSummary(
      ((await rotatedPinResponse.json()) as JsonObject).person,
      {
        name: managerName,
        role: "manager",
      },
    );
    const rotatedManagerCookie = await responseSessionCookie(rotatedPinResponse);
    await managerPage.request.delete("/api/app/session", {
      headers: { Cookie: rotatedManagerCookie },
    });
    await managerContext.close();

    // Start and exit a real salesperson impersonation. On loopback, install the
    // newly minted cookie before the exit action for the same Secure-cookie reason.
    const salespersonRow = rosterRow(page, salespersonName);
    const impersonatePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/app/session/impersonate") &&
        response.request().method() === "POST",
    );
    await salespersonRow.getByRole("button", { name: "Open as" }).click();
    const impersonateResponse = await impersonatePromise;
    expect(impersonateResponse.status()).toBe(200);
    const impersonated = (await impersonateResponse.json()) as JsonObject;
    expect(impersonated.role).toBe("salesperson");
    expect(impersonated.is_impersonation).toBe(true);
    expectSessionPersonSummary(impersonated.person, {
      name: salespersonName,
      role: "salesperson",
    });
    const impersonationCookie = await responseSessionCookie(impersonateResponse);
    await installLoopbackSessionCookie(context, page, impersonationCookie);

    const impersonationBanner = page
      .getByRole("status")
      .filter({ hasText: "Impersonating" });
    await expect(impersonationBanner).toBeVisible();
    await expect(
      impersonationBanner.getByText(salespersonName, { exact: true }),
    ).toBeVisible();
    const exitPromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/app/session/exit-impersonate") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Exit to System Admin" }).click();
    const exitResponse = await exitPromise;
    expect(exitResponse.status()).toBe(200);
    const restored = (await exitResponse.json()) as JsonObject;
    expect(restored.role).toBe("super_admin");
    expect(restored.is_impersonation).toBe(false);
    adminCookie = await responseSessionCookie(exitResponse);
    await installLoopbackSessionCookie(context, page, adminCookie);
    await expect(page.getByRole("heading", { name: "System Admin" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(impersonationBanner).toBeHidden();
  });
});
