import { test, expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const stagedReleaseEnabled = process.env.E2E_STAGED_RELEASE === "true";
const expectedReleaseSha = process.env.E2E_EXPECTED_SHA || "";
const expectedOrigin = stagedReleaseEnabled
  ? new URL(process.env.E2E_BASE_URL || "").origin
  : "";

async function expectNoSeriousAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
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

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
  expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
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

test.describe("Hosted staged release", () => {
  test.skip(
    !stagedReleaseEnabled,
    "Runs only through the evidence-bound staged Vercel release gate.",
  );

  test("serves the exact responsive, accessible, installable login shell", async ({
    page,
    context,
    browserName,
  }, testInfo) => {
    expect(expectedReleaseSha).toMatch(/^[0-9a-f]{40}$/);
    await page.emulateMedia({ reducedMotion: "reduce" });

    const unsafeRequests: Array<{ method: string; path: string }> = [];
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        url.origin === expectedOrigin &&
        !["GET", "HEAD", "OPTIONS"].includes(request.method())
      ) {
        unsafeRequests.push({ method: request.method(), path: url.pathname });
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });

    const portraitSafeArea =
      browserName === "chromium" &&
      testInfo.project.name === "chromium-phone-large-440";
    const landscapeSafeArea =
      browserName === "chromium" &&
      testInfo.project.name === "chromium-phone-landscape-844";
    const cdp =
      portraitSafeArea || landscapeSafeArea ? await context.newCDPSession(page) : null;
    if (cdp) {
      await cdp.send("Emulation.setSafeAreaInsetsOverride", {
        insets: portraitSafeArea
          ? {
              top: 59,
              topMax: 59,
              right: 0,
              rightMax: 0,
              bottom: 34,
              bottomMax: 34,
              left: 0,
              leftMax: 0,
            }
          : {
              top: 0,
              topMax: 0,
              right: 47,
              rightMax: 47,
              bottom: 21,
              bottomMax: 21,
              left: 47,
              leftMax: 47,
            },
      });
    }

    try {
      const getSameOrigin = async (
        path: string,
        headers: Record<string, string> = {},
      ) => {
        const response = await page.request.get(path, {
          headers,
          maxRedirects: 0,
        });
        expect(new URL(response.url()).origin).toBe(expectedOrigin);
        return response;
      };

      const rootResponse = await getSameOrigin("/", {
        "cache-control": "no-cache",
      });
      expect(rootResponse.ok()).toBe(true);
      const html = await rootResponse.text();
      const csp = rootResponse.headers()["content-security-policy"] || "";
      for (const directive of [
        "default-src 'self'",
        "script-src 'self' 'sha256-JPRzJy1ZJFiT889VGwZTmb4NJoJxo5BneGlZaLKKzaU=' https://challenges.cloudflare.com",
        "frame-src https://challenges.cloudflare.com",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ]) {
        expect(csp.split("; ")).toContain(directive);
      }
      expect(rootResponse.headers()["strict-transport-security"]).toBe(
        "max-age=63072000; includeSubDomains; preload",
      );
      expect(rootResponse.headers()["x-content-type-options"]).toBe("nosniff");
      expect(rootResponse.headers()["x-frame-options"]).toBe("DENY");
      expect(rootResponse.headers()["referrer-policy"]).toBe(
        "strict-origin-when-cross-origin",
      );
      expect(rootResponse.headers()["permissions-policy"]).toContain(
        "camera=(self), microphone=(self)",
      );
      expect(rootResponse.headers()["permissions-policy"]).toContain(
        "payment=(), usb=()",
      );
      expect(html).toContain('name="viewport"');
      expect(html).toContain("viewport-fit=cover");
      expect(html).toContain('rel="manifest"');

      const scriptSources = Array.from(
        html.matchAll(/<script[^>]+src="([^"]+\.js)"/g),
        (match) => match[1],
      );
      expect(scriptSources.length).toBeGreaterThan(0);
      let bundleContainsRelease = false;
      for (const source of scriptSources) {
        const response = await getSameOrigin(source);
        expect(response.ok()).toBe(true);
        expect(response.headers()["content-type"]).toContain("javascript");
        expect(response.headers()["cache-control"]).toContain("immutable");
        if ((await response.text()).includes(expectedReleaseSha)) {
          bundleContainsRelease = true;
        }
      }
      expect(bundleContainsRelease).toBe(true);

      const healthResponse = await getSameOrigin("/api/app/health");
      expect(healthResponse.ok()).toBe(true);
      const health = await healthResponse.json();
      expect(health).toMatchObject({
        ok: true,
        releaseSha: expectedReleaseSha,
        backup: { status: "verified" },
      });

      const proxyResponse = await getSameOrigin("/api/app/proxy-readiness");
      expect(proxyResponse.ok()).toBe(true);
      await expect(proxyResponse.json()).resolves.toMatchObject({ ok: true });

      const manifestResponse = await getSameOrigin("/manifest.webmanifest");
      expect(manifestResponse.ok()).toBe(true);
      expect(manifestResponse.headers()["content-type"]).toContain("manifest+json");
      const manifest = await manifestResponse.json();
      expect(manifest).toMatchObject({
        name: "Dealer Social Post AI",
        short_name: "Dealer Social",
        display: "standalone",
        start_url: "/",
      });
      expect(manifest.description).toContain("dealership-ready social posts");
      expect(manifest.icons).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            src: "/dealer-social-icon-v2-192.png",
            sizes: "192x192",
          }),
          expect.objectContaining({
            src: "/dealer-social-icon-v2-512.png",
            sizes: "512x512",
          }),
        ]),
      );
      for (const asset of [
        "/dealer-social-icon-v2-192.png",
        "/dealer-social-icon-v2-512.png",
        "/dealer-social-icon-v2-180.png",
        "/brand-mark.svg",
      ]) {
        const response = await getSameOrigin(asset);
        expect(response.ok()).toBe(true);
        const body = await response.body();
        expect(body.byteLength).toBeGreaterThan(100);
        if (asset.endsWith(".png")) {
          expect(response.headers()["content-type"]).toContain("image/png");
          expect(body.subarray(0, 8)).toEqual(Buffer.from("89504e470d0a1a0a", "hex"));
        } else {
          expect(response.headers()["content-type"]).toContain("image/svg+xml");
          expect(body.toString("utf8", 0, 200)).toContain("<svg");
        }
      }

      const workerResponse = await getSameOrigin("/sw.js", {
        "cache-control": "no-cache",
      });
      expect(workerResponse.ok()).toBe(true);
      expect(workerResponse.headers()["cache-control"]).toBe(
        "no-cache, no-store, must-revalidate",
      );
      expect(workerResponse.headers()["content-type"]).toContain("javascript");
      const workerSource = await workerResponse.text();
      expect(workerSource).toContain(`dsp-${expectedReleaseSha}`);
      expect(workerSource).toContain('url.pathname.startsWith("/api/")');
      expect(workerSource).toContain('event.data.type === "SKIP_WAITING"');

      const navigation = await page.goto("/", { waitUntil: "domcontentloaded" });
      expect(navigation?.ok()).toBe(true);
      expect(new URL(navigation?.url() || page.url()).origin).toBe(expectedOrigin);
      expect(new URL(page.url()).origin).toBe(expectedOrigin);
      await expect(page.getByRole("heading", { name: /^sign in$/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /my code/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /system admin/i })).toBeVisible();
      await expect(
        page.locator('meta[http-equiv="Content-Security-Policy"]'),
      ).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await expectNoSeriousAxeViolations(page);
      await expectControlsInsideViewport(
        page,
        page
          .getByRole("group", { name: "Four digit access code keypad" })
          .getByRole("button"),
      );

      const skipLink = page.getByRole("link", { name: /skip to main content/i });
      await skipLink.focus();
      await expect(skipLink).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/#main-content$/);
      await page.evaluate(() => history.replaceState(null, "", "/"));

      const myCodeButton = page.getByRole("button", { name: /my code/i });
      await myCodeButton.focus();
      await expect(myCodeButton).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("button", { name: /manager username and password/i }),
      ).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: /system admin/i })).toBeFocused();
      await page.keyboard.press("Enter");

      const adminUsernameInput = page.locator('input[name="admin-username"]');
      await expect(adminUsernameInput).toBeFocused();
      await expect(adminUsernameInput).toHaveAttribute("autocomplete", "username");
      await expect(adminUsernameInput).toHaveAttribute("autocapitalize", "none");
      await adminUsernameInput.fill("system.owner");
      await page.keyboard.press("Tab");

      const adminPasswordInput = page.locator('input[name="admin-password"]');
      await expect(adminPasswordInput).toBeFocused();
      await expect(adminPasswordInput).toHaveAttribute("type", "password");
      await expect(adminPasswordInput).toHaveAttribute(
        "autocomplete",
        "current-password",
      );
      await expect(adminPasswordInput).toHaveAttribute("autocapitalize", "none");
      await adminPasswordInput.fill("Aa1Bb2Cc3Dd4");
      await expect(adminPasswordInput).toHaveValue("Aa1Bb2Cc3Dd4");
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("button", { name: "Show administrator password" }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(adminPasswordInput).toHaveAttribute("type", "text");
      await expect(adminPasswordInput).toHaveValue("Aa1Bb2Cc3Dd4");
      await expect(
        page.getByRole("button", { name: "Hide administrator password" }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(adminPasswordInput).toHaveAttribute("type", "password");

      await expectNoSeriousAxeViolations(page);
      await expectNoHorizontalOverflow(page);
      const submitButton = page.getByRole("button", {
        name: /continue to system admin/i,
      });
      await submitButton.scrollIntoViewIfNeeded();
      await expectControlsInsideViewport(page, submitButton);

      const frame = await page.evaluate(() => {
        const root = document.getElementById("root");
        if (!root) return null;
        const bounds = root.getBoundingClientRect();
        const style = getComputedStyle(root);
        return {
          top: bounds.top,
          bottom: bounds.bottom,
          viewportHeight: window.innerHeight,
          paddingTop: style.paddingTop,
          paddingBottom: style.paddingBottom,
          paddingLeft: style.paddingLeft,
          paddingRight: style.paddingRight,
        };
      });
      expect(frame).not.toBeNull();
      expect(frame?.top).toBeGreaterThanOrEqual(-1);
      expect(frame?.bottom).toBeLessThanOrEqual((frame?.viewportHeight || 0) + 1);
      if (portraitSafeArea) {
        expect(frame?.paddingTop).toBe("59px");
        expect(frame?.paddingBottom).toBe("34px");
        expect(frame?.top).toBe(0);
        expect(frame?.bottom).toBe(frame?.viewportHeight);
      } else if (landscapeSafeArea) {
        expect(frame?.paddingTop).toBe("4px");
        expect(frame?.paddingBottom).toBe("21px");
        expect(frame?.paddingLeft).toBe("47px");
        expect(frame?.paddingRight).toBe("47px");
      }

      if (testInfo.project.name.endsWith("desktop-1440")) {
        const serviceWorker = await page.evaluate(async () => {
          if (!("serviceWorker" in navigator)) return null;
          const registration = await Promise.race([
            navigator.serviceWorker.ready,
            new Promise<never>((_, reject) =>
              window.setTimeout(
                () => reject(new Error("service worker registration timed out")),
                15_000,
              ),
            ),
          ]);
          return {
            scope: registration.scope,
            scriptUrl:
              registration.active?.scriptURL ||
              registration.waiting?.scriptURL ||
              registration.installing?.scriptURL ||
              "",
          };
        });
        expect(serviceWorker?.scope).toBe(new URL("/", page.url()).href);
        expect(serviceWorker?.scriptUrl).toBe(new URL("/sw.js", page.url()).href);
      }
      await page.waitForTimeout(250);
      expect(unsafeRequests).toEqual([]);
    } finally {
      if (cdp) {
        await cdp.send("Emulation.setSafeAreaInsetsOverride", {
          insets: {
            top: 0,
            topMax: 0,
            right: 0,
            rightMax: 0,
            bottom: 0,
            bottomMax: 0,
            left: 0,
            leftMax: 0,
          },
        });
      }
    }
  });
});
