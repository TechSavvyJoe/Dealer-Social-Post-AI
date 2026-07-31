import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function expectNoSeriousAxeViolations(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page })
    .disableRules(["color-contrast"])
    .analyze();
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
    let loginAttempts = 0;
    await page.route("**/api/app/session", async (route) => {
      if (route.request().method() === "POST") {
        loginAttempts += 1;
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
            "window.turnstile={",
            "render:function(){return 'staged-login-widget';},",
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

    await page.route("**/api/app/posts/qa-post-1/draft", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: "qa-post-1", updated: true }),
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
    await page.evaluate(async () => {
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
    });
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
});
