import { test, expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// These restored-post fixtures represent creatives generated under the current
// reviewed image policy. Keep this in sync with config/gemini-model-policy.json;
// an intentional policy bump should quarantine them until the fixture is updated.
const CURRENT_TEST_MODEL_POLICY_VERSION = "5";

async function expectNoSeriousAxeViolations(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page }).analyze();
  // Contrast is ENFORCING as of the 2026-08-30 text-surface-500 → 400
  // migration (the full matrix ran clean with zero log-only warnings).
  // Regressions below WCAG AA now fail the gate like any other serious issue.
  const violations = results.violations
    .filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    )
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.map((node) => node.target.join(" ")).slice(0, 5),
    }));
  expect(violations).toEqual([]);
}

async function expectNoCriticalAccessibilityIssues(
  page: import("@playwright/test").Page,
) {
  const issues = await page.evaluate(() => {
    const findings: string[] = [];
    const ids = Array.from(document.querySelectorAll<HTMLElement>("[id]"))
      .map((element) => element.id)
      .filter(Boolean);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    if (duplicates.length > 0) {
      findings.push(`duplicate ids: ${Array.from(new Set(duplicates)).join(", ")}`);
    }
    if (!document.documentElement.lang) findings.push("missing html lang");
    if (document.querySelector("img:not([alt])")) findings.push("image without alt");
    if (document.querySelector('[role="dialog"]:not([aria-modal="true"])')) {
      findings.push("dialog missing aria-modal");
    }
    const unlabeledInputs = Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        "input, textarea, select",
      ),
    ).filter((control) => {
      if (control.type === "hidden") return false;
      if (
        control.getAttribute("aria-label") ||
        control.getAttribute("aria-labelledby")
      ) {
        return false;
      }
      return (
        !control.id || !document.querySelector(`label[for="${CSS.escape(control.id)}"]`)
      );
    });
    if (unlabeledInputs.length > 0) {
      findings.push(`${unlabeledInputs.length} unlabeled form controls`);
    }
    return findings;
  });
  expect(issues).toEqual([]);
}

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

async function expectControlsInsideViewport(page: Page, controls: Locator) {
  const geometry = await controls.evaluateAll((elements) =>
    elements.map((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        width: bounds.width,
        height: bounds.height,
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom,
        left: bounds.left,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    }),
  );
  expect(geometry.length).toBeGreaterThan(0);
  expect(
    geometry.filter(
      (bounds) =>
        bounds.width < 44 ||
        bounds.height < 44 ||
        bounds.top < -1 ||
        bounds.left < -1 ||
        bounds.right > bounds.viewportWidth + 1 ||
        bounds.bottom > bounds.viewportHeight + 1,
    ),
  ).toEqual([]);
}

test.describe("Dealer Social Post AI Flow", () => {
  test("honors Dynamic Island and home-indicator safe areas", async ({
    page,
    context,
    browserName,
  }, testInfo) => {
    test.skip(
      browserName !== "chromium" || !testInfo.project.name.endsWith("phone-large-440"),
      "CDP Dynamic Island emulation runs on the representative Chromium phone",
    );

    await page.route("**/api/app/session", async (route) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "No active session" }),
      });
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setSafeAreaInsetsOverride", {
      insets: {
        top: 59,
        topMax: 59,
        left: 0,
        leftMax: 0,
        bottom: 34,
        bottomMax: 34,
        right: 0,
        rightMax: 0,
      },
    });

    try {
      await page.goto("/");
      await expect(page.getByRole("heading", { name: /^sign in$/i })).toBeVisible();
      const safeArea = await page.locator("#root").evaluate((root) => {
        const style = getComputedStyle(root);
        const bounds = root.getBoundingClientRect();
        const de = document.documentElement;
        const bodyStyle = getComputedStyle(document.body);
        const container = document.querySelector(".app-container");
        return {
          paddingTop: style.paddingTop,
          paddingBottom: style.paddingBottom,
          top: bounds.top,
          bottom: bounds.bottom,
          viewportHeight: window.innerHeight,
          // Shell geometry contract. Headless Chromium cannot reproduce iOS
          // Safari's collapsing chrome, so the rendered symptom is not
          // observable here — but the structure that causes it is.
          bodyPosition: bodyStyle.position,
          bodyMinHeight: bodyStyle.minHeight,
          htmlOverscroll: getComputedStyle(de).overscrollBehaviorY,
          bodyOverscroll: bodyStyle.overscrollBehaviorY,
          documentScrollOverflow: de.scrollHeight - de.clientHeight,
          containerBottom: container
            ? Math.round(container.getBoundingClientRect().bottom)
            : -1,
        };
      });
      expect(safeArea.paddingTop).toBe("59px");
      expect(safeArea.paddingBottom).toBe("34px");
      expect(safeArea.top).toBe(0);
      expect(safeArea.bottom).toBe(safeArea.viewportHeight);

      // The mobile shell is pinned to the visual viewport. Mixing
      // `-webkit-fill-available` with `100dvh` let body outgrow the viewport on
      // iOS, which both opened a rubber-band scroll surface outside the app and
      // left a gap under the shell. Assert the structure, not the symptom.
      expect(safeArea.bodyPosition).toBe("fixed");
      expect(safeArea.bodyMinHeight).toBe("0px");
      // Must be set on html as well: Safari does not reliably propagate
      // overscroll-behavior from body to the viewport.
      expect(safeArea.htmlOverscroll).toBe("none");
      expect(safeArea.bodyOverscroll).toBe("none");
      // Nothing to drag: the document itself must never scroll on mobile.
      expect(safeArea.documentScrollOverflow).toBe(0);
      // The shell background reaches the physical bottom of the screen.
      expect(safeArea.containerBottom).toBe(safeArea.viewportHeight);
      await expectNoHorizontalOverflow(page);
    } finally {
      await cdp.send("Emulation.setSafeAreaInsetsOverride", {
        insets: {
          top: 0,
          topMax: 0,
          left: 0,
          leftMax: 0,
          bottom: 0,
          bottomMax: 0,
          right: 0,
          rightMax: 0,
        },
      });
    }
  });

  test("should load the login page and handle invalid login", async ({
    page,
  }, testInfo) => {
    // Keep this smoke test independent of PocketBase in CI: stub session APIs
    // so Vite can run alone and the login failure path is deterministic.
    let loginAttempts = 0;
    let submittedTurnstileToken = "";
    await page.route("**/api/app/session", async (route) => {
      if (route.request().method() === "POST") {
        loginAttempts += 1;
        const requestBody = route.request().postDataJSON() as {
          turnstileToken?: string;
        };
        if (loginAttempts === 5 && requestBody.turnstileToken) {
          submittedTurnstileToken = requestBody.turnstileToken;
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              role: "salesperson",
              dealer: {
                id: "turnstile-qa-dealer",
                name: "Turnstile QA Motors",
                requires_approval: false,
              },
              person: {
                id: "turnstile-qa-person",
                dealer: "turnstile-qa-dealer",
                name: "Turnstile QA",
                role: "salesperson",
                active: true,
              },
            }),
          });
          return;
        }
        const challengeRequired = loginAttempts === 4;
        await route.fulfill({
          status: challengeRequired ? 403 : 401,
          contentType: "application/json",
          body: JSON.stringify(
            challengeRequired
              ? {
                  error: "CHALLENGE_REQUIRED",
                  code: "CHALLENGE_REQUIRED",
                  message: "Complete the security check to continue.",
                  action: "turnstile-spin-v2",
                }
              : {
                  error: "INVALID_CODE",
                  code: "INVALID_CODE",
                  message: "Invalid access code.",
                },
          ),
        });
        return;
      }
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "No active session" }),
      });
    });
    await page.route("**/api/telemetry", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });
    await page.route(
      "https://challenges.cloudflare.com/turnstile/v0/api.js**",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/javascript",
          body: [
            "window.__dspTurnstileRenderCalls=0;",
            "window.turnstile={",
            "render:function(container,options){",
            "window.__dspTurnstileRenderCalls+=1;",
            "window.__dspTurnstileOptions=options;",
            "container.dataset.testWidgetReady='true';",
            "container.textContent='Security verification ready';",
            "return 'staged-login-widget';",
            "},",
            "remove:function(){},",
            "reset:function(){}",
            "};",
          ].join(""),
        });
      },
    );

    await page.goto("/");

    await page.emulateMedia({ reducedMotion: "reduce" });

    // Production owns one canonical CSP in Vercel's response headers. A
    // second HTML meta policy would intersect with it and can silently block
    // Turnstile even when the response header is correct.
    await expect(
      page.locator('meta[http-equiv="Content-Security-Policy"]'),
    ).toHaveCount(0);

    // Login was simplified for mobile: primary heading is "Sign in".
    await expect(page.getByRole("heading", { name: /^sign in$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /my code/i })).toBeVisible();
    await expectNoCriticalAccessibilityIssues(page);
    await expectNoSeriousAxeViolations(page);
    await expectNoHorizontalOverflow(page);

    if (testInfo.project.name.endsWith("phone-landscape-844")) {
      const rowGeometry = await page
        .getByRole("group", { name: "Four digit access code keypad" })
        .locator(":scope > div")
        .evaluateAll((rows) =>
          rows.map((row) => {
            const bounds = row.getBoundingClientRect();
            return { top: bounds.top, bottom: bounds.bottom, height: bounds.height };
          }),
        );
      expect(rowGeometry.every((row) => row.height >= 44)).toBe(true);
      expect(
        rowGeometry.every(
          (row, index) =>
            index === rowGeometry.length - 1 ||
            row.bottom <= rowGeometry[index + 1].top,
        ),
      ).toBe(true);
    }

    // Keyboard users must be able to reach a real control immediately.
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toBeVisible();

    const enterCodeContainingZero = async () => {
      await expect(
        page.getByRole("status", { name: "0 of 4 digits entered" }),
      ).toBeVisible();
      for (const digit of ["9", "0", "9", "0"]) {
        await page.getByRole("button", { name: `Digit ${digit}` }).click();
      }
    };

    // Repeated invalid feedback must stay inline and actionable. Persistent
    // overlays previously stacked over Digit 0 and prevented the fourth request
    // that should trigger the managed security challenge.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await enterCodeContainingZero();
      await expect(
        page.getByText("Code not recognized. Check the code and try again."),
      ).toBeVisible({ timeout: 10_000 });
      await expect(
        page.getByRole("status", { name: "0 of 4 digits entered" }),
      ).toBeVisible();
    }

    await enterCodeContainingZero();
    await expect(page.getByRole("heading", { name: "Security check" })).toBeVisible({
      timeout: 10_000,
    });
    expect(loginAttempts).toBe(4);
    await expect(
      page.locator('.cf-turnstile[data-test-widget-ready="true"]'),
    ).toContainText("Security verification ready");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as Window & {
                __dspTurnstileRenderCalls?: number;
              }
            ).__dspTurnstileRenderCalls || 0,
        ),
      )
      .toBe(1);
    await page.evaluate(() => {
      (
        window as Window & {
          __dspTurnstileOptions?: {
            callback: (token: string) => void;
          };
        }
      ).__dspTurnstileOptions?.callback("turnstile-browser-proof-token");
    });
    await expect.poll(() => loginAttempts).toBe(5);
    expect(submittedTurnstileToken).toBe("turnstile-browser-proof-token");
    await expect(
      page.getByRole("heading", { name: "Security check" }),
    ).not.toBeVisible();

    const worker = await page.request.get("/sw.js");
    expect(worker.ok()).toBe(true);
    const workerSource = await worker.text();
    expect(workerSource).toContain('event.data.type === "SKIP_WAITING"');
    expect(workerSource).toContain('url.pathname.startsWith("/api/")');
    await expectNoHorizontalOverflow(page);
  });

  test("keeps manager sign-in reachable and isolated from background PIN keys", async ({
    page,
  }) => {
    const submittedCredentials: Array<Record<string, unknown>> = [];
    await page.route("**/api/app/session", async (route) => {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        submittedCredentials.push(body);
        const managerAttempt = body.authType === "manager_password";
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({
            error: managerAttempt ? "INVALID_CREDENTIALS" : "INVALID_CODE",
            code: managerAttempt ? "INVALID_CREDENTIALS" : "INVALID_CODE",
            message: "Invalid sign-in credentials.",
          }),
        });
        return;
      }
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "No active session" }),
      });
    });
    await page.route("**/api/telemetry", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.getByRole("button", { name: "Manager username and password" }).click();

    const managerHeading = page.getByRole("heading", {
      name: "Dealership manager",
    });
    const username = page.getByRole("textbox", { name: "Username" });
    const password = page.getByLabel("Password", { exact: true });
    const submit = page.getByRole("button", {
      name: "Continue to manager workspace",
    });
    const managerForm = submit.locator("xpath=ancestor::form");

    await expect(managerForm).toBeVisible();
    const expectReachable = async (locator: typeof managerHeading, label: string) => {
      await locator.scrollIntoViewIfNeeded();
      await expect(locator, `${label} must be reachable`).toBeVisible();
      const geometry = await locator.evaluate((element) => {
        const container = element.closest("form");
        if (!container) return null;
        const bounds = element.getBoundingClientRect();
        const frame = container.getBoundingClientRect();
        return {
          left: bounds.left,
          right: bounds.right,
          top: bounds.top,
          bottom: bounds.bottom,
          frameLeft: frame.left,
          frameRight: frame.right,
          frameTop: frame.top,
          frameBottom: frame.bottom,
        };
      });
      expect(
        geometry,
        `${label} must belong to the manager scroll container`,
      ).not.toBeNull();
      expect(geometry!.left).toBeGreaterThanOrEqual(geometry!.frameLeft - 1);
      expect(geometry!.right).toBeLessThanOrEqual(geometry!.frameRight + 1);
      expect(geometry!.top).toBeGreaterThanOrEqual(geometry!.frameTop - 1);
      expect(geometry!.bottom).toBeLessThanOrEqual(geometry!.frameBottom + 1);
    };

    await expectReachable(managerHeading, "Manager heading");
    await expectReachable(username, "Manager username");
    await expectReachable(password, "Manager password");
    await expectReachable(submit, "Manager submit action");
    expect(
      await managerForm.evaluate((form) => form.scrollWidth <= form.clientWidth + 1),
    ).toBe(true);
    await expectNoHorizontalOverflow(page);

    // The page-level digit shortcut belongs exclusively to personal-code mode.
    // When neither manager input is focused, background digits must not mutate
    // the hidden PIN state or trigger a personal-code credential exchange.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    for (const digit of ["1", "2", "3", "4"]) {
      await page.keyboard.press(digit);
    }
    await expect.poll(() => submittedCredentials.length).toBe(0);

    await username.fill("manager.one");
    await password.fill("test-manager-password-2026!");
    await submit.click();
    await expect.poll(() => submittedCredentials.length).toBe(1);
    expect(submittedCredentials[0]).toEqual({
      authType: "manager_password",
      username: "manager.one",
      password: "test-manager-password-2026!",
    });
    expect(submittedCredentials[0]).not.toHaveProperty("dealerCode");
    await expectNoHorizontalOverflow(page);
  });

  test("keeps the authenticated capture studio reachable on a changing phone viewport", async ({
    page,
  }, testInfo) => {
    test.skip(
      !testInfo.project.name.endsWith("phone-390"),
      "The representative 390px Chromium and WebKit phones cover the capture scrollport.",
    );

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route("**/api/app/session", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          role: "salesperson",
          dealer: {
            id: "qa-capture-dealer",
            name: "Capture QA Motors",
            requires_approval: false,
          },
          person: {
            id: "qa-capture-person",
            dealer: "qa-capture-dealer",
            name: "Capture QA",
            role: "salesperson",
            active: true,
          },
        }),
      });
    });
    await page.route("**/api/telemetry", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    await page.goto("/#/capture");
    await expect(
      page.getByRole("heading", { name: "Capture the handoff." }),
    ).toBeVisible();

    const mainContent = page.locator("#main-content");
    const transitionWrapper = mainContent.locator(":scope > div").first();
    const contentWrapper = transitionWrapper.locator(":scope > div").first();
    const captureGrid = page.locator(".capture-studio-grid");
    const captureSidebar = page.locator(".capture-studio-sidebar");
    const takePhoto = page.getByRole("button", { name: "Take photo" });
    const chooseFromDevice = page.getByRole("button", {
      name: "Choose from device",
    });

    await expect(transitionWrapper.locator(".capture-studio-grid")).toHaveCount(1);
    await expect(contentWrapper.locator(".capture-studio-grid")).toHaveCount(1);
    await expect(captureGrid).toBeVisible();
    await expect(captureSidebar).toBeVisible();
    expect(
      await captureSidebar.evaluate((sidebar) => {
        const preview = document.querySelector(".capture-studio-preview");
        return Boolean(
          preview &&
          (sidebar.compareDocumentPosition(preview) &
            Node.DOCUMENT_POSITION_FOLLOWING) !==
            0,
        );
      }),
    ).toBe(true);

    const expectDocumentLockedToViewport = async () => {
      const geometry = await page.evaluate(() => ({
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        htmlClientHeight: document.documentElement.clientHeight,
        htmlScrollHeight: document.documentElement.scrollHeight,
        bodyClientHeight: document.body.clientHeight,
        bodyScrollHeight: document.body.scrollHeight,
      }));
      expect(geometry.viewportWidth).toBe(390);
      expect(geometry.htmlScrollHeight).toBe(geometry.htmlClientHeight);
      expect(geometry.bodyScrollHeight).toBe(geometry.bodyClientHeight);
      expect(geometry.htmlClientHeight).toBe(geometry.viewportHeight);
    };

    const expectCaptureEndReachable = async () => {
      const scrollContract = await mainContent.evaluate((element) => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        overflowY: getComputedStyle(element).overflowY,
      }));
      expect(scrollContract.clientHeight).toBeGreaterThan(0);
      expect(scrollContract.scrollHeight).toBeGreaterThan(scrollContract.clientHeight);
      expect(["auto", "scroll"]).toContain(scrollContract.overflowY);

      await mainContent.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await expect
        .poll(() =>
          mainContent.evaluate(
            (element) =>
              element.scrollHeight - element.clientHeight - element.scrollTop,
          ),
        )
        .toBeLessThanOrEqual(1);

      const [
        mainBounds,
        transitionBounds,
        contentBounds,
        gridBounds,
        sidebarBounds,
        chooseBounds,
      ] = await Promise.all([
        mainContent.boundingBox(),
        transitionWrapper.boundingBox(),
        contentWrapper.boundingBox(),
        captureGrid.boundingBox(),
        captureSidebar.boundingBox(),
        chooseFromDevice.boundingBox(),
      ]);
      expect(mainBounds).not.toBeNull();
      expect(transitionBounds).not.toBeNull();
      expect(contentBounds).not.toBeNull();
      expect(gridBounds).not.toBeNull();
      expect(sidebarBounds).not.toBeNull();
      expect(chooseBounds).not.toBeNull();
      const mainBottom = (mainBounds?.y || 0) + (mainBounds?.height || 0);
      const transitionBottom =
        (transitionBounds?.y || 0) + (transitionBounds?.height || 0);
      const contentBottom = (contentBounds?.y || 0) + (contentBounds?.height || 0);
      const gridBottom = (gridBounds?.y || 0) + (gridBounds?.height || 0);
      const mainBottomPadding = await mainContent.evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).paddingBottom),
      );
      expect(transitionBottom).toBeGreaterThanOrEqual(gridBottom - 1);
      expect(contentBottom).toBeGreaterThanOrEqual(gridBottom - 1);
      expect(gridBottom).toBeLessThanOrEqual(mainBottom - mainBottomPadding + 1);
      expect(
        (sidebarBounds?.y || 0) + (sidebarBounds?.height || 0),
      ).toBeLessThanOrEqual(mainBottom + 1);
      expect((chooseBounds?.y || 0) + (chooseBounds?.height || 0)).toBeLessThanOrEqual(
        mainBottom + 1,
      );
      await expect(chooseFromDevice).toBeVisible();
    };

    await expectDocumentLockedToViewport();
    await expect(takePhoto).toBeVisible();
    await expect(chooseFromDevice).toBeVisible();
    await expectControlsInsideViewport(
      page,
      page.getByRole("button", { name: /^(Take photo|Choose from device)$/ }),
    );
    await expectCaptureEndReachable();

    await page.setViewportSize({ width: 390, height: 600 });
    await expect.poll(() => page.evaluate(() => window.innerHeight)).toBe(600);
    await expectDocumentLockedToViewport();
    await expectCaptureEndReachable();
  });

  test("keeps the responsive result workspace job-first", async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });

    await page.route("**/api/app/session", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          role: "salesperson",
          dealer: {
            id: "qa-dealer",
            name: "Northline Motors",
            requires_approval: false,
          },
          person: {
            id: "qa-person",
            dealer: "qa-dealer",
            name: "Jamie Rivera",
            role: "salesperson",
            active: true,
          },
        }),
      });
    });

    await page.route("**/api/telemetry", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    await page.route("**/api/app/posts/qa-post-1/draft", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "qa-post-1",
          updated: true,
          post_revision: "2026-08-05 09:43:00.000Z",
        }),
      });
    });

    await page.addInitScript(() => {
      (window as unknown as { __shareCalls: ShareData[] }).__shareCalls = [];
      Object.defineProperty(navigator, "canShare", {
        configurable: true,
        value: () => true,
      });
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: (shareData: ShareData) => {
          (window as unknown as { __shareCalls: ShareData[] }).__shareCalls.push(
            shareData,
          );
          return Promise.resolve();
        },
      });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: () => Promise.resolve() },
      });
    });

    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Capture the handoff." }),
    ).toBeVisible();
    await page.evaluate(async (modelPolicyVersion) => {
      const image =
        "data:image/svg+xml;charset=utf-8," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#07111f"/><stop offset="1" stop-color="#2563eb"/></linearGradient></defs><rect width="1080" height="1080" fill="url(#g)"/><path d="M140 640h800l-92-210H310z" fill="#e8eef8" opacity=".92"/><circle cx="350" cy="680" r="88" fill="#07111f"/><circle cx="760" cy="680" r="88" fill="#07111f"/><text x="540" y="860" text-anchor="middle" font-family="Arial" font-size="54" fill="white">NORTHLINE MOTORS</text></svg>',
        );
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("dealer-social-post-ai", 2);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("creative-assets")) {
            db.createObjectStore("creative-assets", { keyPath: "key" });
          }
          if (!db.objectStoreNames.contains("media-archive")) {
            const archive = db.createObjectStore("media-archive", {
              keyPath: "id",
            });
            archive.createIndex("dealerId", "dealerId", { unique: false });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction("creative-assets", "readwrite");
        transaction.objectStore("creative-assets").put({
          key: "qa-dealer:generated",
          value: image,
          updatedAt: Date.now(),
          mediaEpoch: 0,
        });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      database.close();
      localStorage.setItem(
        "dealer-social-post-ai.session",
        JSON.stringify({
          dealerId: "qa-dealer",
          step: 4,
          loginTimestamp: Date.now(),
          generatedPost: {
            text: "A standout delivery deserves a standout moment. Congratulations on the new ride!",
            postId: "qa-post-1",
            releaseStatus: "saved",
            aiMeta: { modelPolicyVersion },
            platformIds: ["facebook_feed", "linkedin"],
            mediaOutputMode: "photo",
            primaryFormatId: "feed_portrait",
            imageAspectRatio: "4:5",
          },
          generationParams: {
            style: "Modern & Bold",
            tone: "Excited",
            customerName: "",
            platformIds: ["facebook_feed", "linkedin"],
            mediaOutputMode: "photo",
            primaryFormatId: "feed_portrait",
            imageAspectRatio: "4:5",
          },
        }),
      );
    }, CURRENT_TEST_MODEL_POLICY_VERSION);
    await page.reload();

    const isDesktop = testInfo.project.name.endsWith("desktop-1440");
    await expect(
      page.getByRole("heading", {
        name: isDesktop ? "Publish studio" : "Facebook Feed",
      }),
    ).toBeVisible();
    const mediaPreview = page.getByRole("region", { name: "Media preview" });
    const deliveryBar = page.getByLabel("Post delivery actions");
    const shareAndSaveActions = isDesktop ? mediaPreview : deliveryBar;
    if (!isDesktop) {
      await expect(
        deliveryBar.getByRole("button", { name: "Copy caption" }),
      ).toBeVisible();
    }
    const shareTrigger = shareAndSaveActions.getByRole("button", {
      name: "Share post",
    });
    await expect(shareTrigger).toBeVisible();
    await expect(
      shareAndSaveActions.getByRole("button", {
        name: /^Save (?:image|video|to Photos|\d+×\d+)$/,
      }),
    ).toBeVisible();
    const deliveryBoard = page.getByRole("region", { name: "Platform delivery" });
    await expect(deliveryBoard).toBeVisible();
    await expect(
      deliveryBoard.getByRole("checkbox", {
        name: /Include Facebook Feed image 4:5 in Share selected/i,
      }),
    ).toBeChecked();
    await expect(
      deliveryBoard.getByRole("checkbox", {
        name: /Include LinkedIn Feed image 1:1 in Share selected/i,
      }),
    ).toBeChecked();
    const clearAllDeliveries = deliveryBoard.getByRole("button", {
      name: "Clear all",
    });
    const shareAllDeliveries = deliveryBoard.getByRole("button", {
      name: "Share all 2",
    });
    await expect(shareAllDeliveries).toBeEnabled();
    for (const control of [clearAllDeliveries, shareAllDeliveries]) {
      expect(
        await control.evaluate(
          (element) => element.scrollWidth <= element.clientWidth + 1,
        ),
      ).toBe(true);
    }

    await expectNoCriticalAccessibilityIssues(page);
    await expectNoSeriousAxeViolations(page);
    await expectNoHorizontalOverflow(page);

    const creativeTools = page.getByRole("button", { name: /creative tools/i });
    await expect(creativeTools).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("creative-tools-panel")).toBeHidden();
    await expect(page.getByRole("button", { name: "Regenerate image" })).toBeHidden();

    await shareTrigger.focus();
    await page.keyboard.press("Enter");
    const shareDialog = page.getByRole("dialog", { name: "Share" });
    await expect(shareDialog).toBeVisible();
    await page.getByRole("button", { name: "Share to Facebook" }).click();
    const shareNow = page.getByRole("button", { name: "Share now" });
    await expect(shareNow).toBeEnabled({ timeout: 10_000 });
    await shareNow.click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __shareCalls: ShareData[] }).__shareCalls.length,
        ),
      )
      .toBe(1);

    // Escape closes the focus-trapped modal and restores focus to its trigger.
    await page.keyboard.press("Escape");
    await expect(shareDialog).toBeHidden();
    await expect(shareTrigger).toBeFocused();
    await expectNoHorizontalOverflow(page);

    if (testInfo.project.name.endsWith("phone-390")) {
      await shareAllDeliveries.click();
      await expect(shareDialog).toBeVisible();
      await expect(shareDialog.getByText("Share sequence")).toBeVisible();
      await expect(shareDialog.getByText("1 of 2")).toBeVisible();
      await expect(shareNow).toBeEnabled({ timeout: 10_000 });
      await shareNow.click();
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as unknown as { __shareCalls: ShareData[] }).__shareCalls.length,
          ),
        )
        .toBe(2);
      await shareDialog
        .getByRole("button", { name: /Next selected: LinkedIn/i })
        .click();
      await expect(shareDialog).toBeVisible();
      await expect(shareDialog.getByText("2 of 2")).toBeVisible();
      await expect(shareNow).toBeEnabled({ timeout: 10_000 });
      await shareNow.click();
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as unknown as { __shareCalls: ShareData[] }).__shareCalls.length,
          ),
        )
        .toBe(3);
      await shareDialog.getByRole("button", { name: "Finish sequence" }).click();
      await expect(shareDialog).toBeHidden();
      const completionToast = page.getByText(/Share sequence finished/i);
      await expect(completionToast).toBeVisible();
      const [toastBounds, deliveryBarBounds] = await Promise.all([
        completionToast.boundingBox(),
        deliveryBar.boundingBox(),
      ]);
      expect(toastBounds).not.toBeNull();
      expect(deliveryBarBounds).not.toBeNull();
      expect((toastBounds?.y || 0) + (toastBounds?.height || 0)).toBeLessThanOrEqual(
        (deliveryBarBounds?.y || 0) + 1,
      );
      await expectNoHorizontalOverflow(page);
    }

    if (testInfo.project.name.endsWith("phone-320")) {
      await page.evaluate(() => {
        Object.defineProperty(navigator, "share", {
          configurable: true,
          value: undefined,
        });
      });
      await page.keyboard.press("Enter");
      await expect(shareDialog).toBeVisible();
      await page.getByRole("button", { name: "Share to Facebook" }).click();
      await expect(shareNow).toBeEnabled({ timeout: 10_000 });
      await shareNow.click();
      await expect(
        shareDialog.getByText(/System sharing is unavailable/i),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(shareTrigger).toBeFocused();
    }

    await page.screenshot({
      path: testInfo.outputPath("result-mobile.png"),
      fullPage: true,
    });
  });

  test("keeps Website-only private and viewport-bound until the final Send", async ({
    page,
  }, testInfo) => {
    test.skip(
      ![
        "chromium-phone-320",
        "chromium-phone-390",
        "webkit-phone-320",
        "webkit-phone-390",
      ].includes(testInfo.project.name),
      "The two narrow Chromium and WebKit phones cover the Website-only publishing boundary.",
    );
    await page.emulateMedia({ reducedMotion: "reduce" });

    let websitePostCount = 0;
    let websiteRequestBody: Record<string, unknown> | null = null;
    const readyPublication = {
      status: "draft_ready",
      attempts: 1,
      reviewUrl:
        "https://joegallant.me/studio/updates#draft-00000000-0000-4000-8000-000000000001",
      lastError: "destination_unavailable",
      updatedAt: "2026-08-05T13:00:00.000Z",
    };

    await page.route("**/api/app/session", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          role: "salesperson",
          dealer: {
            id: "qa-website-dealer",
            name: "Synthetic QA Motors",
            requires_approval: false,
          },
          person: {
            id: "qa-website-person",
            dealer: "qa-website-dealer",
            name: "Synthetic QA",
            role: "salesperson",
            active: true,
          },
        }),
      });
    });
    await page.route("**/api/app/website-destinations", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            {
              id: "joe_customer_hub",
              label: "Website",
              siteUrl: "https://joegallant.me",
              enabled: true,
              mode: "private_draft",
            },
          ],
        }),
      });
    });
    await page.route("**/api/app/posts/qa-website-1/draft", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "qa-website-1",
          updated: true,
          post_revision: "2026-08-05 09:43:00.000Z",
        }),
      });
    });
    await page.route(
      "**/api/app/posts/qa-website-1/website-publication",
      async (route) => {
        if (route.request().method() === "POST") {
          websitePostCount += 1;
          websiteRequestBody = route.request().postDataJSON() as Record<
            string,
            unknown
          >;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            route.request().method() === "POST" || websitePostCount > 0
              ? readyPublication
              : { status: "not_requested", attempts: 0 },
          ),
        });
      },
    );
    await page.route("**/api/proxy/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      title: "Synthetic delivery update",
                      body: "Final synthetic website copy prepared only after review.",
                      altText: "Synthetic vehicle delivery graphic for QA.",
                      category: "deliveries",
                      privacyFlags: ["review_visual_privacy"],
                    }),
                  },
                ],
              },
            },
          ],
        }),
      });
    });
    await page.route("**/api/telemetry", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Capture the handoff." }),
    ).toBeVisible();
    await page.evaluate(async (modelPolicyVersion) => {
      const image = `data:image/svg+xml;base64,${btoa(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080"><rect width="1080" height="1080" fill="#07111f"/><path d="M140 640h800l-92-210H310z" fill="#e8eef8"/><circle cx="350" cy="680" r="88" fill="#2563eb"/><circle cx="760" cy="680" r="88" fill="#2563eb"/><text x="540" y="860" text-anchor="middle" font-family="Arial" font-size="54" fill="white">SYNTHETIC QA</text></svg>',
      )}`;
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("dealer-social-post-ai", 2);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("creative-assets")) {
            db.createObjectStore("creative-assets", { keyPath: "key" });
          }
          if (!db.objectStoreNames.contains("media-archive")) {
            const archive = db.createObjectStore("media-archive", { keyPath: "id" });
            archive.createIndex("dealerId", "dealerId", { unique: false });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction("creative-assets", "readwrite");
        transaction.objectStore("creative-assets").put({
          key: "qa-website-dealer:generated",
          value: image,
          updatedAt: Date.now(),
          mediaEpoch: 0,
        });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      database.close();
      localStorage.setItem(
        "dealer-social-post-ai.session",
        JSON.stringify({
          dealerId: "qa-website-dealer",
          step: 4,
          loginTimestamp: Date.now(),
          generatedPost: {
            text: "Final synthetic caption after salesperson review.",
            postId: "qa-website-1",
            releaseStatus: "saved",
            aiMeta: { modelPolicyVersion },
            platformIds: [],
            mediaOutputMode: "photo",
            primaryFormatId: "feed_square",
            imageAspectRatio: "1:1",
            websiteDraft: {
              enabled: true,
              kind: "customer_story",
              category: "deliveries",
              title: "Earlier synthetic title",
              body: "Earlier copy must never be sent automatically.",
              altText: "Synthetic QA creative.",
              customerDisplayName: "Customer",
              privacyFlags: ["review_visual_privacy"],
              schemaVersion: 1,
            },
            websitePublication: { status: "not_requested" },
          },
          generationParams: {
            style: "Modern & Bold",
            tone: "Excited",
            customerName: "",
            scenarioId: "customer_delivery",
            platformIds: [],
            websiteEnabled: true,
            mediaOutputMode: "photo",
            primaryFormatId: "feed_square",
            imageAspectRatio: "1:1",
          },
        }),
      );
    }, CURRENT_TEST_MODEL_POLICY_VERSION);
    await page.reload();

    await expect(
      page.getByRole("heading", { name: "Finish and send to website" }),
    ).toBeVisible();
    await expect(page.getByText("Private website draft")).toBeVisible();
    await expect(page.getByText("TikTok")).toHaveCount(0);
    await expect(
      page.getByRole("list", { name: "Mobile platform outputs" }),
    ).toHaveCount(0);
    expect(websitePostCount).toBe(0);

    const statusCard = page.getByRole("status").filter({
      hasText: "Website selected",
    });
    await expect(statusCard).toBeVisible();
    const initialCardGeometry = await statusCard.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(initialCardGeometry.height).toBeLessThanOrEqual(64);
    expect(initialCardGeometry.scrollWidth).toBeLessThanOrEqual(
      initialCardGeometry.clientWidth + 1,
    );

    const footer = page.getByLabel("Post delivery actions");
    const footerFrame = await footer.evaluate((element) => {
      const shell = element.parentElement as HTMLElement;
      const bounds = shell.getBoundingClientRect();
      return {
        parentIsBody: shell.parentElement === document.body,
        bottom: bounds.bottom,
        viewportHeight: window.innerHeight,
      };
    });
    expect(footerFrame.parentIsBody).toBe(true);
    expect(footerFrame.bottom).toBe(footerFrame.viewportHeight);
    await expectControlsInsideViewport(page, footer.getByRole("button"));

    const previewHeight = await page
      .getByRole("region", { name: "Media preview" })
      .evaluate((element) => element.getBoundingClientRect().height);
    expect(previewHeight).toBeLessThanOrEqual(
      testInfo.project.name.endsWith("phone-320") ? 161 : 321,
    );

    const privacyToggle = statusCard.locator(
      'summary[aria-label="Website privacy review details"]',
    );
    await privacyToggle.click();
    const privacyPanel = statusCard.locator("details > div");
    await expect(privacyPanel).toBeVisible();
    const privacyGeometry = await privacyPanel.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, width: window.innerWidth };
    });
    expect(privacyGeometry.left).toBeGreaterThanOrEqual(0);
    expect(privacyGeometry.right).toBeLessThanOrEqual(privacyGeometry.width + 1);
    await privacyToggle.click();

    await page.locator("#main-content").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const finalContentGeometry = await page.evaluate(() => {
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>(
          'main a[href], main button:not([disabled]), main input:not([disabled]), main textarea:not([disabled]), main select:not([disabled]), main [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => {
        const style = getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        return (
          style.display !== "none" && style.visibility !== "hidden" && bounds.height > 0
        );
      });
      const lastControl = candidates.at(-1);
      const footerShell = document
        .querySelector<HTMLElement>('[aria-label="Post delivery actions"]')
        ?.parentElement?.getBoundingClientRect();
      const lastBounds = lastControl?.getBoundingClientRect();
      return {
        lastBottom: lastBounds?.bottom ?? Number.POSITIVE_INFINITY,
        footerTop: footerShell?.top ?? Number.NEGATIVE_INFINITY,
      };
    });
    expect(finalContentGeometry.lastBottom).toBeLessThanOrEqual(
      finalContentGeometry.footerTop + 1,
    );

    await footer.getByRole("button", { name: "Send website draft" }).click();
    await expect.poll(() => websitePostCount).toBe(1);
    expect(websiteRequestBody).toEqual({
      expected_post_revision: "2026-08-05 09:43:00.000Z",
      website_draft: expect.objectContaining({
        // Customer stories are now built deterministically from the reviewed
        // caption so a metadata model cannot introduce a different customer.
        body: expect.stringContaining(
          "Final synthetic caption after salesperson review.",
        ),
        kind: "customer_story",
        category: "deliveries",
      }),
    });
    await expect(
      page.getByRole("alert").filter({
        hasText: "Draft ready — check status",
      }),
    ).toBeVisible();
    await expect(
      footer.getByRole("button", { name: "Review website draft" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Review" })).toHaveCount(0);
    await page.waitForTimeout(100);
    expect(websitePostCount).toBe(1);
    await expectNoHorizontalOverflow(page);
  });

  test("surfaces the offline banner and clears it on reconnect", async ({
    page,
    context,
  }) => {
    // Keep this banner contract independent from a developer's active local
    // session and wait for the login route's lazy chunk before disconnecting.
    // Otherwise a very small/slow phone can go offline while Vite is still
    // fetching the authenticated Capture chunk, turning a banner test into a
    // nondeterministic module-load failure.
    await page.route("**/api/app/session", async (route) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "No active session" }),
      });
    });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /^sign in$/i })).toBeVisible();
    await expect(page.getByText("You're offline", { exact: false })).toHaveCount(0);

    await context.setOffline(true);
    await expect(page.getByText("You're offline", { exact: false })).toBeVisible();

    await context.setOffline(false);
    await expect(page.getByText("You're offline", { exact: false })).toHaveCount(0);
  });
});
