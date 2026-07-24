import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function expectNoSeriousAxeViolations(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page }).disableRules(['color-contrast']).analyze();
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
        return {
          paddingTop: style.paddingTop,
          paddingBottom: style.paddingBottom,
          top: bounds.top,
          bottom: bounds.bottom,
          viewportHeight: window.innerHeight,
        };
      });
      expect(safeArea.paddingTop).toBe("59px");
      expect(safeArea.paddingBottom).toBe("34px");
      expect(safeArea.top).toBe(0);
      expect(safeArea.bottom).toBe(safeArea.viewportHeight);
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
    await page.route("**/api/app/session", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ error: "Invalid dealer code" }),
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

    await page.goto("/");

    await page.emulateMedia({ reducedMotion: "reduce" });

    const csp = await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute("content");
    expect(csp).toContain("script-src 'self' https://challenges.cloudflare.com");
    expect(csp).toContain("frame-src https://challenges.cloudflare.com");
    expect(csp).toContain("connect-src 'self' https://challenges.cloudflare.com");

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

    // Personal access codes are 4 digits; dialpad buttons use names like "Digit 9".
    for (let i = 0; i < 4; i++) {
      await page.getByRole("button", { name: "Digit 9" }).click();
    }

    await expect(
      page.getByText("Code not recognized. Check the code and try again."),
    ).toBeVisible({ timeout: 10_000 });

    const worker = await page.request.get("/sw.js");
    expect(worker.ok()).toBe(true);
    const workerSource = await worker.text();
    expect(workerSource).toContain('event.data.type === "SKIP_WAITING"');
    expect(workerSource).toContain('url.pathname.startsWith("/api/")');
    await expectNoHorizontalOverflow(page);
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

      const image =
        "data:image/svg+xml;charset=utf-8," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#07111f"/><stop offset="1" stop-color="#2563eb"/></linearGradient></defs><rect width="1080" height="1080" fill="url(#g)"/><path d="M140 640h800l-92-210H310z" fill="#e8eef8" opacity=".92"/><circle cx="350" cy="680" r="88" fill="#07111f"/><circle cx="760" cy="680" r="88" fill="#07111f"/><text x="540" y="860" text-anchor="middle" font-family="Arial" font-size="54" fill="white">NORTHLINE MOTORS</text></svg>',
        );

      localStorage.setItem(
        "dealer-social-post-ai.session",
        JSON.stringify({
          dealerId: "qa-dealer",
          step: 4,
          loginTimestamp: Date.now(),
          generatedPost: {
            image,
            text: "A standout delivery deserves a standout moment. Congratulations on the new ride!",
            postId: "qa-post-1",
            releaseStatus: "saved",
          },
          generationParams: {
            style: "Modern & Bold",
            tone: "Excited",
            customerName: "",
          },
        }),
      );
    });

    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Ready to publish" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy caption" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Share post" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save image" })).toBeVisible();

    await expectNoCriticalAccessibilityIssues(page);
    await expectNoSeriousAxeViolations(page);
    await expectNoHorizontalOverflow(page);

    const creativeTools = page.getByRole("button", { name: /creative tools/i });
    const isDesktop = testInfo.project.name.endsWith("desktop-1440");
    await expect(creativeTools).toHaveAttribute(
      "aria-expanded",
      isDesktop ? "true" : "false",
    );
    if (isDesktop) {
      await expect(page.getByTestId("creative-tools-panel")).toBeVisible();
    } else {
      await expect(page.getByTestId("creative-tools-panel")).toBeHidden();
      await expect(page.getByRole("button", { name: "Regenerate image" })).toBeHidden();
    }

    const shareTrigger = page.getByRole("button", { name: "Share post" });
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
});
