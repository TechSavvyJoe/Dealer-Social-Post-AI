import {
  expect,
  test,
  type APIResponse,
  type BrowserContext,
  type Page,
  type Response,
} from "@playwright/test";

const realPocketBaseEnabled = process.env.E2E_REAL_POCKETBASE === "true";
const adminUsername = process.env.E2E_ADMIN_USERNAME || "";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "";
const apiContractVersion = "2026-07-31.v4";

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
  const parsed = new URL(page.url());
  // The shim lives on the more-specific /api path so later production Path=/
  // refreshes cannot displace it. Replace it in place (same name, domain and
  // path) before removing anything: the signed-in screens fetch on their own
  // (Home loads My work as soon as it lands), and a request sent while no
  // cookie is installed gets a 401 that signs the page out. Then remove the
  // production Path=/ cookie, which WebKit can retain as a distinct cookie.
  await context.addCookies([
    {
      name,
      value,
      domain: parsed.hostname,
      path: "/api",
      httpOnly: true,
      secure: parsed.protocol === "https:",
      sameSite: "Lax",
    },
  ]);
  await context.clearCookies({ name, path: "/" });
};

/**
 * Impersonation and its exit swap the session in one response, and the app
 * fetches with the new session at once (Home and the header load as soon as
 * they mount). Over HTTPS the response's own Set-Cookie covers that. Over
 * loopback the /api shim would still hold the previous bearer, which the
 * server reads first, so install the minted bearer as the shim before the page
 * sees the response, as the real cookie would be.
 */
const handOffSessionSwapsToLoopbackShim = async (
  context: BrowserContext,
  page: Page,
) => {
  // A fulfilled response does not expose Set-Cookie to the page, so the
  // bearer each swap minted is kept here, read from the server's response.
  // Keyed by path, not by Request: WebKit hands waitForResponse a different
  // Request object for a fulfilled route than the one this handler saw. Swaps
  // run one at a time, and each read consumes its entry, so a stale bearer
  // from an earlier swap can never answer for a later one.
  const mintedByPath = new Map<string, string>();
  await page.route(
    /\/api\/app\/session\/(?:impersonate|exit-impersonate)$/,
    async (route) => {
      const response = await route.fetch();
      const minted = response
        .headersArray()
        .filter(({ name }) => name.toLowerCase() === "set-cookie")
        .map(({ value }) => value.match(/^dealer_session=([^;,\s]+)/)?.[1])
        .find(Boolean);
      if (response.ok() && minted) {
        mintedByPath.set(new URL(route.request().url()).pathname, minted);
        await installLoopbackSessionCookie(context, page, `dealer_session=${minted}`);
      }
      await route.fulfill({ response });
    },
  );
  return {
    /** The dealer_session cookie the server minted for this swap's response. */
    mintedCookie: async (response: Response): Promise<string> => {
      const path = new URL(response.url()).pathname;
      const routed = mintedByPath.get(path);
      mintedByPath.delete(path);
      if (routed) return `dealer_session=${routed}`;
      // WebKit does not route a request its service worker handles (this spec
      // runs with the production worker active), so the shim never saw this
      // swap; read the bearer from the page's own response, as the sign-ins
      // above do.
      return responseSessionCookie(response);
    },
  };
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
    .locator("div.font-semibold.text-ink")
    .filter({ hasText: personName })
    .locator("xpath=../..");

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The system admin's setup board: a table from `md` (the real-backend project
 * runs at 1440 px), one row header per store holding the button that opens
 * the store's detail under the row.
 */
const setupBoardRow = (page: Page, dealerName: string) =>
  page.getByRole("rowheader", { name: new RegExp(escapeRegExp(dealerName)) });

const openSetupBoardStore = async (page: Page, dealerName: string) => {
  const opener = setupBoardRow(page, dealerName).getByRole("button");
  // The board may be remounting after a session swap (sign-in, exit). Over
  // loopback http this test installs the swapped cookie itself (production
  // gets it with the response), so the board's list request can race the
  // swap. One reload settles it on the installed session; it is recorded so
  // a board that needs it is never silent.
  try {
    await expect(opener).toBeVisible({ timeout: 10_000 });
  } catch {
    test.info().annotations.push({
      type: "setup-board-reload",
      description: `"${dealerName}" was not on the board 10 s after a session swap; reloaded once`,
    });
    await page.reload();
    await expect(opener).toBeVisible({ timeout: 15_000 });
  }
  if ((await opener.getAttribute("aria-expanded")) !== "true") await opener.click();
  await expect(opener).toHaveAttribute("aria-expanded", "true");
  const detailId = await opener.getAttribute("aria-controls");
  expect(detailId).toBeTruthy();
  return page.locator(`[id="${detailId}"]`);
};

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
    expect(adminUsername).not.toBe("");
    expect(adminPassword.length).toBeGreaterThanOrEqual(8);

    await page.goto("/", { waitUntil: "networkidle" });
    if (browserName === "chromium") {
      await assertActiveProductionServiceWorker(page);
    }

    // The administrator password is compared exactly: a case-altered variant
    // must not authenticate.
    const caseIndex = adminPassword.search(/[A-Za-z]/);
    if (caseIndex >= 0) {
      const char = adminPassword[caseIndex];
      const wrongCasePassword =
        adminPassword.slice(0, caseIndex) +
        (char === char.toUpperCase() ? char.toLowerCase() : char.toUpperCase()) +
        adminPassword.slice(caseIndex + 1);
      const wrongCaseResponse = await page.request.post("/api/app/session", {
        data: {
          authType: "admin_password",
          username: adminUsername,
          password: wrongCasePassword,
        },
      });
      expect(wrongCaseResponse.status()).toBe(401);
    }

    // An unknown username must fail the same way, without disclosing which
    // half of the pair was wrong.
    const unknownUserResponse = await page.request.post("/api/app/session", {
      data: {
        authType: "admin_password",
        username: `${adminUsername}.nope`,
        password: adminPassword,
      },
    });
    expect(unknownUserResponse.status()).toBe(401);

    await page.getByRole("button", { name: "System admin" }).click();
    await page.getByLabel("Username", { exact: true }).fill(adminUsername);
    await page.getByLabel("Password", { exact: true }).fill(adminPassword);
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
    const sessionSwaps = await handOffSessionSwapsToLoopbackShim(context, page);

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
      "/api/proxy/v1beta/models/gemini-3.6-flash:generateContent",
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
          // Playwright retries deliberately repeat this full persistence
          // canary. Give each attempt a unique safe identifier so the
          // one-minute telemetry coalescer does not turn a valid retry into a
          // 202 "already stored" response.
          releaseSha: `ci-runtime-canary-${browserName}-r${testInfo.retry}`,
          apiContractVersion,
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

    // Health responses refresh the production Secure cookie. WebKit discards
    // that cookie on loopback HTTP, so restore the equivalent loopback-only
    // shim before the reload that proves session restoration.
    await installLoopbackSessionCookie(context, page, adminCookie);
    await page.reload({ waitUntil: "networkidle" });

    await expect(page.getByRole("heading", { name: "System admin" })).toBeVisible({
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
    await expect(page.getByRole("tab", { name: "Connections" })).toBeVisible();
    // The Dealers tab is the setup board; its search replaces the store filter,
    // which lives on the Admins and Users tabs.
    await expect(page.getByRole("heading", { name: "Setup board" })).toBeVisible();
    await expect(
      page.getByRole("searchbox", { name: "Find a dealership" }),
    ).toBeVisible();
    await expect(page.getByLabel("Store", { exact: true })).toHaveCount(0);

    const suffix = `${testInfo.project.name}-${Date.now().toString(36)}`
      .replace(/[^a-z0-9-]/gi, "")
      .slice(-32);
    const dealerName = `E2E Northline ${suffix}`;
    const managerName = `E2E Manager ${suffix}`;
    const salespersonName = `E2E Sales ${suffix}`;
    const managerUsername = `mgr.${Date.now().toString(36)}.${browserName.slice(0, 3)}`;
    // Deliberate leading/trailing spaces prove the browser and proxy preserve
    // the exact password instead of normalizing a credential in transit.
    const managerPassword = ` E2E manager access ${suffix}! `;

    await page.getByRole("button", { name: "Add dealer", exact: true }).click();
    const newDealerDialog = page.getByRole("dialog", { name: "New dealership" });
    await expect(newDealerDialog).toBeVisible();
    await newDealerDialog.getByLabel("Dealer name *").fill(dealerName);
    const createDealerPromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/app/dealers") &&
        response.request().method() === "POST",
    );
    await newDealerDialog.getByRole("button", { name: "Create dealer" }).click();
    const createDealerResponse = await createDealerPromise;
    expect(createDealerResponse.status()).toBe(200);
    const dealerId = String(((await createDealerResponse.json()) as JsonObject).id);
    expect(dealerId).toMatch(/^[a-z0-9]{15}$/);
    const privateInviteResponse = await page.request.post(
      `/api/app/dealers/${dealerId}/invitation`,
      { data: { action: "issue" } },
    );
    expect(privateInviteResponse.status()).toBe(200);
    const privateInvite = String((await privateInviteResponse.json()).token);
    const installInvite = async (
      context: import("@playwright/test").BrowserContext,
    ) => {
      await context.addCookies([
        {
          name: "dealer_invitation",
          value: privateInvite,
          domain: new URL(page.url()).hostname,
          path: "/api",
          httpOnly: true,
          secure: false,
          sameSite: "Strict",
        },
      ]);
    };

    await expect(newDealerDialog).toBeHidden();

    // The setup board lists the store this spec just created, read back from
    // PocketBase, and opening its row shows what is left to set up. A new
    // store has no manager yet, so the deep links wait for one.
    await expect(setupBoardRow(page, dealerName)).toBeVisible();
    let storeDetail = await openSetupBoardStore(page, dealerName);
    await expect(
      storeDetail.getByRole("heading", { name: /^\d+ things? left to set up$/ }),
    ).toBeVisible();
    await expect(storeDetail.getByText("Brand voice", { exact: true })).toBeVisible();
    await expect(
      storeDetail.getByRole("button", { name: "Open Voice" }),
    ).toBeDisabled();
    await expect(
      storeDetail.getByText("This store has no active manager yet."),
    ).toBeVisible();
    await expect(
      storeDetail.getByRole("heading", { name: "This store's posts" }),
    ).toBeVisible();

    // Setup notes save on their own and survive a full reload.
    const setupNotes = `E2E setup notes ${suffix}\nCall the GM before the Facebook page is linked.`;
    const setupNotesField = storeDetail.getByLabel("Setup notes", { exact: true });
    await expect(setupNotesField).toBeEnabled();
    await setupNotesField.fill(setupNotes);
    await expect(storeDetail.getByText("Unsaved changes")).toBeVisible();
    const saveNotesPromise = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/app/dealers/${dealerId}`) &&
        response.request().method() === "PATCH",
    );
    await storeDetail.getByRole("button", { name: "Save notes" }).click();
    const saveNotesResponse = await saveNotesPromise;
    expect(saveNotesResponse.status()).toBe(200);
    await expect(storeDetail.getByText(/^Saved /)).toBeVisible();
    await expect(storeDetail.getByRole("button", { name: "Save notes" })).toHaveCount(
      0,
    );

    await installLoopbackSessionCookie(context, page, adminCookie);
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "System admin" })).toBeVisible({
      timeout: 15_000,
    });
    await installLoopbackSessionCookie(context, page, adminCookie);
    storeDetail = await openSetupBoardStore(page, dealerName);
    await expect(storeDetail.getByLabel("Setup notes", { exact: true })).toHaveValue(
      setupNotes,
    );

    // The open store's Admins button selects the store on the Admins tab.
    await storeDetail.getByRole("button", { name: "Admins", exact: true }).click();
    await expect(page.getByRole("tab", { name: "Admins" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByLabel("Store", { exact: true })).toHaveValue(dealerId);
    const managerPanel = page
      .getByRole("heading", { name: `Add a manager to ${dealerName}` })
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

    // Configure the dealer-scoped manager account through the actual audited
    // super-admin UI. The password is write-only and never appears in the
    // response, roster, or future session payload.
    await page.getByRole("button", { name: "Set up manager login" }).click();
    const managerAccountDialog = page.getByRole("dialog", {
      name: "Account settings",
    });
    await managerAccountDialog
      .getByLabel("Manager username")
      .fill(managerUsername.toUpperCase());
    await managerAccountDialog
      .getByLabel("Password", { exact: true })
      .fill(managerPassword);
    await managerAccountDialog.getByLabel("Confirm password").fill(managerPassword);
    const configureManagerLoginPromise = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/app/salespeople/${managerId}/manager-login`) &&
        response.request().method() === "PUT",
    );
    await managerAccountDialog
      .getByRole("button", { name: "Enable manager login" })
      .click();
    const configureManagerLoginResponse = await configureManagerLoginPromise;
    expect(configureManagerLoginResponse.status()).toBe(200);
    expect(
      (await responseHeaders(configureManagerLoginResponse))["cache-control"],
    ).toContain("no-store");
    const configuredManagerText = await configureManagerLoginResponse.text();
    const configuredManager = JSON.parse(configuredManagerText) as JsonObject;
    expect(configuredManager).toMatchObject({
      hasManagerLogin: true,
      managerUsername,
    });
    expect(configuredManagerText).not.toContain(managerPassword);
    expect(configuredManagerText).not.toContain('"password"');
    expect(configuredManagerText).not.toContain('"tokenKey"');
    await expect(
      managerAccountDialog.getByLabel("New password", { exact: true }),
    ).toHaveValue("");
    await expect(managerAccountDialog.getByLabel("Confirm password")).toHaveValue("");
    await managerAccountDialog.getByRole("button", { name: "Close dialog" }).click();

    // The locked PocketBase auth collection must not mint a reusable PB auth
    // token directly. Only the app session route may exchange this password.
    const directPocketBaseAuth = await page.request.post(
      "/api/collections/manager_accounts/auth-with-password",
      {
        data: { identity: managerUsername, password: managerPassword },
      },
    );
    expect(directPocketBaseAuth.status()).not.toBe(200);
    expect(await directPocketBaseAuth.text()).not.toContain('"token"');

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
      .getByRole("heading", { name: `Add a salesperson to ${dealerName}` })
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
    await page.getByLabel("Store", { exact: true }).selectOption("");
    await page.getByPlaceholder("Search salespeople…").fill(salespersonName);
    const filteredSalespersonRow = rosterRow(page, salespersonName);
    await expect(filteredSalespersonRow).toBeVisible();
    await expect(
      filteredSalespersonRow.getByText(dealerName, { exact: true }),
    ).toBeVisible();
    await page.getByPlaceholder("Search salespeople…").fill("");
    await page.getByLabel("Store", { exact: true }).selectOption(dealerId);

    // A manager can authenticate with the dealer-scoped username/password and
    // receives an authoritative, credential-free identity in API and manager UI.
    const managerContext = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      viewport: testInfo.project.use.viewport,
    });
    await installInvite(managerContext);
    const managerPage = await managerContext.newPage();
    await managerPage.goto("/");
    await managerPage
      .getByRole("button", { name: "Manager username and password" })
      .click();
    await managerPage
      .getByRole("textbox", { name: "Username" })
      .fill(managerUsername.toUpperCase());
    await managerPage.getByLabel("Password", { exact: true }).fill(managerPassword);
    const managerLoginPromise = managerPage.waitForResponse(
      (response) =>
        response.url().endsWith("/api/app/session") &&
        response.request().method() === "POST",
    );
    await managerPage
      .getByRole("button", { name: "Continue to manager workspace" })
      .click();
    const managerLoginResponse = await managerLoginPromise;
    expect(managerLoginResponse.status()).toBe(200);
    const managerSession = (await managerLoginResponse.json()) as JsonObject;
    expect(managerSession.role).toBe("dealer_admin");
    expectSessionPersonSummary(managerSession.person, {
      name: managerName,
      role: "manager",
    });
    const managerCookie = await responseSessionCookie(managerLoginResponse);
    await installLoopbackSessionCookie(managerContext, managerPage, managerCookie);
    await expect(managerPage.getByText("Manager dashboard")).toBeVisible({
      timeout: 15_000,
    });

    // A dealership manager cannot create, reset, or disable their own
    // password account; that authority stays with the isolated system admin.
    const managerConfigureDenied = await managerPage.request.put(
      `/api/app/salespeople/${managerId}/manager-login`,
      {
        headers: { Cookie: managerCookie },
        data: { username: managerUsername, password: managerPassword },
      },
    );
    expect(managerConfigureDenied.status()).toBe(403);
    expect(await managerConfigureDenied.json()).toMatchObject({
      code: "MANAGER_LOGIN_FORBIDDEN",
    });

    // Persist a meaningful settings edit through the manager-owned UI, then
    // prove both the refreshed session payload and a full application reload
    // hydrate the exact stored business hours from PocketBase.
    const expectedHours =
      "Mon 8:30 AM–7:30 PM, Tue–Fri 9:00 AM–8:00 PM, Sat 9:00 AM–6:00 PM, Sun closed";
    // A footer the manager saves in Voice must reach the sample post beside
    // the form, before and after the save is read back from PocketBase.
    const expectedFooter = `Ask for the E2E ${suffix} delivery desk.`;
    await managerPage.getByRole("tab", { name: "Settings" }).click();
    let managerSettingsCard = managerPage.getByRole("tabpanel", { name: "Settings" });
    const settingsSections = managerSettingsCard.getByRole("navigation", {
      name: "Dealership settings sections",
    });
    const openSettingsSection = async (label: string) => {
      const sectionButton = settingsSections.getByRole("button", {
        name: new RegExp(`^${escapeRegExp(label)}(,|$)`),
      });
      await sectionButton.click();
      await expect(sectionButton).toHaveAttribute("aria-current", "page");
      await expect(
        managerSettingsCard.getByRole("heading", { name: label, exact: true }),
      ).toBeVisible();
    };
    const samplePost = () =>
      managerSettingsCard.getByRole("complementary", { name: "Sample post" });
    const managerMondayOpen = managerSettingsCard.getByLabel("Monday opens");
    const managerMondayClose = managerSettingsCard.getByLabel("Monday closes");
    const noApprovalRequired = managerSettingsCard.getByRole("radio", {
      name: "No approval required",
    });
    const approvalRequired = managerSettingsCard.getByRole("radio", {
      name: "Require manager approval",
    });
    // The approval choice sits under "Require manager approval" in Workflow.
    await openSettingsSection("Workflow");
    await expect(noApprovalRequired).toBeChecked();
    await noApprovalRequired.focus();
    await managerPage.keyboard.press("ArrowRight");
    await expect(approvalRequired).toBeFocused();
    await expect(approvalRequired).toBeChecked();
    await managerPage.keyboard.press("ArrowLeft");
    await expect(noApprovalRequired).toBeFocused();
    await expect(noApprovalRequired).toBeChecked();

    await openSettingsSection("Voice");
    await expect(samplePost().getByText(expectedFooter)).toHaveCount(0);
    await managerSettingsCard
      .getByLabel("Footer", { exact: true })
      .fill(expectedFooter);
    await expect(
      samplePost().locator('[data-part="footer"]').getByText(expectedFooter, {
        exact: true,
      }),
    ).toBeVisible();

    await openSettingsSection("Store profile");
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
    expect(saveHoursResponse.request().postData() || "").toContain(expectedFooter);

    const managerSessionAfterSaveResponse = await managerPage.request.get(
      "/api/app/session",
      { headers: { Cookie: managerCookie } },
    );
    expect(managerSessionAfterSaveResponse.status()).toBe(200);
    const managerSessionAfterSave =
      (await managerSessionAfterSaveResponse.json()) as JsonObject;
    expect((managerSessionAfterSave.dealer as JsonObject).hours).toBe(expectedHours);
    expect((managerSessionAfterSave.dealer as JsonObject).default_footer).toBe(
      expectedFooter,
    );
    // Setup notes belong to the system admin alone; no session payload carries them.
    expect(
      Object.hasOwn(managerSessionAfterSave.dealer as JsonObject, "setup_notes"),
    ).toBe(false);
    expect(JSON.stringify(managerSessionAfterSave)).not.toContain(
      `E2E setup notes ${suffix}`,
    );

    // The explicit loopback session probe above also receives PocketBase's
    // production Secure refresh cookie. Restore the HTTP-only test shim before
    // the reload so WebKit can prove the same persisted session flow.
    await installLoopbackSessionCookie(managerContext, managerPage, managerCookie);
    await managerPage.reload({ waitUntil: "networkidle" });
    await expect(managerPage.getByText("Manager dashboard")).toBeVisible({
      timeout: 15_000,
    });
    await managerPage.getByRole("tab", { name: "Settings" }).click();
    managerSettingsCard = managerPage.getByRole("tabpanel", { name: "Settings" });
    await expect(managerSettingsCard.getByLabel("Monday opens")).toHaveValue("8:30 AM");
    await expect(managerSettingsCard.getByLabel("Monday closes")).toHaveValue(
      "7:30 PM",
    );
    await expect(
      managerSettingsCard.getByText(expectedHours, { exact: true }),
    ).toBeVisible();
    // After the reload the sample post is built from the saved record alone.
    await openSettingsSection("Voice");
    await expect(managerSettingsCard.getByLabel("Footer", { exact: true })).toHaveValue(
      expectedFooter,
    );
    await expect(
      samplePost().locator('[data-part="footer"]').getByText(expectedFooter, {
        exact: true,
      }),
    ).toBeVisible();

    // Sign in directly as the newly created salesperson (not through admin
    // impersonation). The returned and restored identities are authoritative
    // summaries and never contain the reusable PIN.
    const salespersonContext = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      viewport: testInfo.project.use.viewport,
    });
    await installInvite(salespersonContext);
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
      salespersonPage.getByRole("heading", { name: "Your next great post." }),
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
        platform_ids: JSON.stringify(["instagram_feed", "facebook_feed"]),
        media_output_mode: "both",
        primary_format_id: "feed_portrait",
        image_aspect_ratio: "4:5",
      },
    });
    expect(createPostResponse.status()).toBe(200);
    const createdPost = (await createPostResponse.json()) as JsonObject;
    expect(createdPost.dealer).toBe(dealerId);
    const createdPostId = String(createdPost.id);
    expect(createdPostId).toMatch(/^[a-z0-9]{15}$/);
    expect(createdPost).toMatchObject({
      platform_ids: ["instagram_feed", "facebook_feed"],
      media_output_mode: "both",
      primary_format_id: "feed_portrait",
      image_aspect_ratio: "4:5",
    });

    // Older clients omit media_output_mode. Preserve one compatibility release
    // by treating that omission as a photo request while still validating the
    // selected format pair.
    const legacyPhotoResponse = await salespersonPage.request.post("/api/app/posts", {
      headers: { Cookie: salespersonCookie },
      multipart: {
        caption: "Synthetic legacy photo canary.",
        platform_ids: JSON.stringify(["instagram_story"]),
        primary_format_id: "story_vertical",
        image_aspect_ratio: "9:16",
      },
    });
    expect(legacyPhotoResponse.status()).toBe(200);
    const legacyPhotoPost = (await legacyPhotoResponse.json()) as JsonObject;
    const legacyPhotoPostId = String(legacyPhotoPost.id);
    expect(legacyPhotoPostId).toMatch(/^[a-z0-9]{15}$/);
    expect(legacyPhotoPost).toMatchObject({
      media_output_mode: "photo",
      primary_format_id: "story_vertical",
      image_aspect_ratio: "9:16",
    });

    const invalidMediaModeResponse = await salespersonPage.request.post(
      "/api/app/posts",
      {
        headers: { Cookie: salespersonCookie },
        multipart: {
          caption: "Synthetic invalid media-mode canary.",
          media_output_mode: "audio",
          primary_format_id: "feed_square",
          image_aspect_ratio: "1:1",
        },
      },
    );
    expect(invalidMediaModeResponse.status()).toBe(400);
    expect(await invalidMediaModeResponse.json()).toMatchObject({
      error: "Invalid media output mode",
    });

    const mismatchedOutputProfileResponse = await salespersonPage.request.post(
      "/api/app/posts",
      {
        headers: { Cookie: salespersonCookie },
        multipart: {
          caption: "Synthetic mismatched output-profile canary.",
          media_output_mode: "photo",
          primary_format_id: "feed_portrait",
          image_aspect_ratio: "9:16",
        },
      },
    );
    expect(mismatchedOutputProfileResponse.status()).toBe(400);
    expect(await mismatchedOutputProfileResponse.json()).toMatchObject({
      error: "Output format and aspect ratio do not match",
    });

    const salespersonHistoryResponse = await salespersonPage.request.get(
      "/api/app/posts?limit=1000",
      { headers: { Cookie: salespersonCookie } },
    );
    expect(salespersonHistoryResponse.status()).toBe(200);
    expect(
      (await responseHeaders(salespersonHistoryResponse))["cache-control"],
    ).toContain("no-store");
    const salespersonHistory = (await salespersonHistoryResponse.json()) as {
      items: JsonObject[];
    };
    expect(
      salespersonHistory.items.find((item) => item.id === createdPostId),
    ).toMatchObject({
      dealer: dealerId,
      salesperson_id: salespersonId,
      salesperson_name: salespersonName,
      platform_ids: ["instagram_feed", "facebook_feed"],
      media_output_mode: "both",
      primary_format_id: "feed_portrait",
      image_aspect_ratio: "4:5",
    });
    expect(
      salespersonHistory.items.find((item) => item.id === legacyPhotoPostId),
    ).toMatchObject({
      dealer: dealerId,
      salesperson_id: salespersonId,
      media_output_mode: "photo",
      primary_format_id: "story_vertical",
      image_aspect_ratio: "9:16",
    });
    expect(
      salespersonHistory.items.every((item) => item.salesperson_id === salespersonId),
    ).toBe(true);

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
      platform_ids: ["instagram_feed", "facebook_feed"],
      media_output_mode: "both",
      primary_format_id: "feed_portrait",
      image_aspect_ratio: "4:5",
    });
    expect(authoritativePost?.salesperson_id).not.toBe(managerId);
    expect(authoritativePost?.salesperson_name).not.toBe(spoofedSalespersonName);

    const salespersonLogoutResponse = await salespersonPage.request.delete(
      "/api/app/session",
      { headers: { Cookie: salespersonCookie } },
    );
    expect(salespersonLogoutResponse.status()).toBe(200);
    await salespersonContext.close();

    // Rotating the manager PIN must revoke every manager session—including one
    // authenticated by password—while leaving the password account available.
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

    if (browserName === "chromium") {
      // Password replacement is atomic, exact, and revokes the old bearer. A
      // later disable also revokes its bearer while deliberately retaining the
      // manager's temporary PIN fallback for this compatibility release.
      const lifecycleContext = await browser.newContext({
        baseURL: new URL(page.url()).origin,
        viewport: testInfo.project.use.viewport,
      });
      await installInvite(lifecycleContext);
      const lifecyclePage = await lifecycleContext.newPage();
      const passwordReloginResponse = await lifecyclePage.request.post(
        "/api/app/session",
        {
          data: {
            authType: "manager_password",
            username: managerUsername,
            password: managerPassword,
          },
        },
      );
      expect(passwordReloginResponse.status()).toBe(200);
      const preReplacePasswordCookie = await responseSessionCookie(
        passwordReloginResponse,
      );
      const replacementPassword = ` Replacement manager access ${suffix}! `;
      const replaceManagerLoginResponse = await page.request.put(
        `/api/app/salespeople/${managerId}/manager-login`,
        {
          headers: { Cookie: adminCookie },
          data: {
            username: managerUsername,
            password: replacementPassword,
          },
        },
      );
      expect(replaceManagerLoginResponse.status()).toBe(200);
      expect(await replaceManagerLoginResponse.json()).toMatchObject({
        hasManagerLogin: true,
        managerUsername,
      });

      const replacedBearerResponse = await lifecyclePage.request.get(
        "/api/app/session",
        { headers: { Cookie: preReplacePasswordCookie } },
      );
      expect(replacedBearerResponse.status()).toBe(401);
      const oldPasswordResponse = await lifecyclePage.request.post("/api/app/session", {
        data: {
          authType: "manager_password",
          username: managerUsername,
          password: managerPassword,
        },
      });
      expect(oldPasswordResponse.status()).toBe(401);
      expect(await oldPasswordResponse.json()).toMatchObject({
        code: "INVALID_CREDENTIALS",
      });
      const replacementLoginResponse = await lifecyclePage.request.post(
        "/api/app/session",
        {
          data: {
            authType: "manager_password",
            username: managerUsername,
            password: replacementPassword,
          },
        },
      );
      expect(replacementLoginResponse.status()).toBe(200);
      const replacementManagerCookie = await responseSessionCookie(
        replacementLoginResponse,
      );

      const disableManagerLoginResponse = await page.request.delete(
        `/api/app/salespeople/${managerId}/manager-login`,
        { headers: { Cookie: adminCookie } },
      );
      expect(disableManagerLoginResponse.status()).toBe(200);
      expect(await disableManagerLoginResponse.json()).toMatchObject({
        hasManagerLogin: false,
      });
      const disabledBearerResponse = await lifecyclePage.request.get(
        "/api/app/session",
        { headers: { Cookie: replacementManagerCookie } },
      );
      expect(disabledBearerResponse.status()).toBe(401);
      const pinAfterDisableResponse = await lifecyclePage.request.post(
        "/api/app/session",
        { data: { dealerCode: rotatedCredential.pin } },
      );
      expect(pinAfterDisableResponse.status()).toBe(200);
      await lifecycleContext.close();
    }

    // Start and exit a real salesperson impersonation. On loopback, install the
    // newly minted cookie before the exit action for the same Secure-cookie reason.
    const preImpersonationAdminCookie = adminCookie;
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
    const impersonationCookie = await sessionSwaps.mintedCookie(impersonateResponse);
    await installLoopbackSessionCookie(context, page, impersonationCookie);

    // The source bearer is parked while its child is active. Rejecting a copied
    // source token prevents concurrent direct admin use, but must not invalidate
    // the live child session needed to exit safely.
    const parkedSourceResponse = await page.request.get("/api/app/session", {
      headers: { Cookie: preImpersonationAdminCookie },
    });
    expect(parkedSourceResponse.status()).toBe(401);
    const parkedClearCookie =
      (await responseHeaders(parkedSourceResponse))["set-cookie"] || "";
    expect(parkedClearCookie).toContain("dealer_session=");
    expect(parkedClearCookie.toLowerCase()).toContain("max-age=0");

    // APIRequestContext applies Set-Cookie responses to the browser context, so
    // restore the child shim before proving the child remains authoritative.
    await installLoopbackSessionCookie(context, page, impersonationCookie);
    const activeChildResponse = await page.request.get("/api/app/session", {
      headers: { Cookie: impersonationCookie },
    });
    expect(activeChildResponse.status()).toBe(200);
    expect((await activeChildResponse.json()) as JsonObject).toMatchObject({
      role: "salesperson",
      is_impersonation: true,
    });
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
    adminCookie = await sessionSwaps.mintedCookie(exitResponse);
    expect(adminCookie).not.toBe(preImpersonationAdminCookie);
    expect(adminCookie).not.toBe(impersonationCookie);
    await installLoopbackSessionCookie(context, page, adminCookie);

    // Exiting mints a new admin bearer; the copied pre-impersonation source
    // token never becomes valid again.
    const retiredSourceResponse = await page.request.get("/api/app/session", {
      headers: { Cookie: preImpersonationAdminCookie },
    });
    expect(retiredSourceResponse.status()).toBe(401);
    await installLoopbackSessionCookie(context, page, adminCookie);

    await expect(page.getByRole("heading", { name: "System Admin" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(impersonationBanner).toBeHidden();

    // A row's deep link opens the store as its manager on the settings section
    // that fixes it: "Open Voice" lands on Voice, holding the saved footer.
    storeDetail = await openSetupBoardStore(page, dealerName);
    await expect(storeDetail.getByLabel("Setup notes", { exact: true })).toHaveValue(
      setupNotes,
    );
    const openVoice = storeDetail.getByRole("button", { name: "Open Voice" });
    await expect(openVoice).toBeEnabled();
    const preDeepLinkAdminCookie = adminCookie;
    const deepLinkPromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/app/session/impersonate") &&
        response.request().method() === "POST",
    );
    await openVoice.click();
    const deepLinkResponse = await deepLinkPromise;
    expect(deepLinkResponse.status()).toBe(200);
    const deepLinked = (await deepLinkResponse.json()) as JsonObject;
    expect(deepLinked.is_impersonation).toBe(true);
    expectSessionPersonSummary(deepLinked.person, {
      name: managerName,
      role: "manager",
    });
    expect(JSON.stringify(deepLinked)).not.toContain("setup_notes");
    expect(JSON.stringify(deepLinked)).not.toContain(`E2E setup notes ${suffix}`);
    const deepLinkCookie = await sessionSwaps.mintedCookie(deepLinkResponse);
    await installLoopbackSessionCookie(context, page, deepLinkCookie);

    await expect(
      impersonationBanner.getByText(managerName, { exact: true }),
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("tab", { name: "Settings" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const deepLinkSettings = page.getByRole("tabpanel", { name: "Settings" });
    await expect(
      deepLinkSettings
        .getByRole("navigation", { name: "Dealership settings sections" })
        .getByRole("button", { name: /^Voice(,|$)/ }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      deepLinkSettings.getByRole("heading", { name: "Voice", exact: true }),
    ).toBeVisible();
    await expect(deepLinkSettings.getByLabel("Footer", { exact: true })).toHaveValue(
      expectedFooter,
    );

    const deepLinkExitPromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/app/session/exit-impersonate") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Exit to System Admin" }).click();
    const deepLinkExitResponse = await deepLinkExitPromise;
    expect(deepLinkExitResponse.status()).toBe(200);
    expect((await deepLinkExitResponse.json()) as JsonObject).toMatchObject({
      role: "super_admin",
      is_impersonation: false,
    });
    adminCookie = await sessionSwaps.mintedCookie(deepLinkExitResponse);
    expect(adminCookie).not.toBe(preDeepLinkAdminCookie);
    await installLoopbackSessionCookie(context, page, adminCookie);
    await expect(page.getByRole("heading", { name: "System admin" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(impersonationBanner).toBeHidden();
  });
});
