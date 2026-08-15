import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

type ManifestIcon = {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
};

type InstallManifest = {
  id?: string;
  name?: string;
  short_name?: string;
  start_url?: string;
  scope?: string;
  display?: string;
  background_color?: string;
  theme_color?: string;
  icons?: ManifestIcon[];
};

const installPngs = [
  { src: "/dealer-social-dsp-v3-180.png", size: 180 },
  { src: "/dealer-social-dsp-v3-192.png", size: 192 },
  { src: "/dealer-social-dsp-v3-512.png", size: 512 },
  { src: "/dealer-social-dsp-v3-1024.png", size: 1024 },
  { src: "/dealer-social-dsp-v3-maskable-192.png", size: 192 },
  { src: "/dealer-social-dsp-v3-maskable-512.png", size: 512 },
  { src: "/dealer-social-dsp-v3-maskable-1024.png", size: 1024 },
] as const;

async function expectPng(
  request: APIRequestContext,
  src: string,
  expectedSize: number,
) {
  const response = await request.get(src);
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("image/png");

  const bytes = await response.body();
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from("89504e470d0a1a0a", "hex"));
  expect(bytes.subarray(12, 16).toString("ascii")).toBe("IHDR");
  expect(bytes.readUInt32BE(16)).toBe(expectedSize);
  expect(bytes.readUInt32BE(20)).toBe(expectedSize);
}

async function expectFullBleedArtwork(page: Page, sources: string[]) {
  const results = await page.evaluate(async (imageSources) => {
    return Promise.all(
      imageSources.map(async (src) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const drawingContext = canvas.getContext("2d", {
          willReadFrequently: true,
        });
        if (!drawingContext) throw new Error(`Unable to inspect ${src}`);
        drawingContext.drawImage(image, 0, 0);
        const pixels = drawingContext.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        ).data;
        let minimumAlpha = 255;
        for (let index = 3; index < pixels.length; index += 4) {
          minimumAlpha = Math.min(minimumAlpha, pixels[index]);
          if (minimumAlpha === 0) break;
        }
        return { src, minimumAlpha };
      }),
    );
  }, sources);

  // iOS ignores transparent padding when it builds the rounded Home Screen
  // tile, and maskable icons must provide their own full-bleed background.
  expect(results).toEqual(sources.map((src) => ({ src, minimumAlpha: 255 })));
}

async function expectMaskableSafeZone(page: Page, sources: string[]) {
  const results = await page.evaluate(async (imageSources) => {
    return Promise.all(
      imageSources.map(async (src) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const drawingContext = canvas.getContext("2d", {
          willReadFrequently: true,
        });
        if (!drawingContext) throw new Error(`Unable to inspect ${src}`);
        drawingContext.drawImage(image, 0, 0);
        const pixels = drawingContext.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        ).data;
        const center = canvas.width / 2;
        let maximumLightPixelDistance = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          const red = pixels[index];
          const green = pixels[index + 1];
          const blue = pixels[index + 2];
          const isIvory = red >= 210 && green >= 210 && blue >= 205;
          const isCoral = red >= 220 && green >= 55 && green <= 175 && blue <= 135;
          if (!isIvory && !isCoral) continue;
          const pixel = index / 4;
          const x = pixel % canvas.width;
          const y = Math.floor(pixel / canvas.width);
          maximumLightPixelDistance = Math.max(
            maximumLightPixelDistance,
            Math.hypot(x - center, y - center),
          );
        }
        return {
          src,
          maximumLightPixelDistanceRatio: maximumLightPixelDistance / canvas.width,
        };
      }),
    );
  }, sources);

  // Adaptive launchers guarantee only the central circle with radius 40% of
  // the canvas. Both the ivory D/P and coral S are essential, so every glyph
  // pixel must remain inside that circle while the navy field stays full bleed.
  for (const result of results) {
    expect(result.maximumLightPixelDistanceRatio).toBeLessThanOrEqual(0.4);
  }
}

async function stubAuthenticatedCapture(page: Page) {
  await page.route("**/api/app/session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        role: "salesperson",
        dealer: {
          id: "pwa-capture-dealer",
          name: "PWA Capture Motors",
          requires_approval: false,
        },
        person: {
          id: "pwa-capture-person",
          dealer: "pwa-capture-dealer",
          name: "PWA Capture QA",
          role: "salesperson",
          active: true,
        },
        is_impersonation: true,
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
}

test.describe("Home Screen PWA contracts", () => {
  test("ships a complete full-bleed phone install identity", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-phone-390",
      "One browser is sufficient for static install metadata and image contracts.",
    );

    await page.route("**/api/app/session", async (route) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "No active session" }),
      });
    });
    await page.goto("/");

    const manifestLink = page.locator('link[rel~="manifest"]');
    const appleTouchIcon = page.locator('link[rel~="apple-touch-icon"]');
    await expect(manifestLink).toHaveAttribute("href", "/manifest.webmanifest");
    await expect(appleTouchIcon).toHaveAttribute(
      "href",
      "/dealer-social-dsp-v3-180.png",
    );
    await expect(appleTouchIcon).toHaveAttribute("sizes", "180x180");
    await expect(
      page.locator('meta[name="apple-mobile-web-app-capable"]'),
    ).toHaveAttribute("content", "yes");
    await expect(
      page.locator('meta[name="apple-mobile-web-app-title"]'),
    ).toHaveAttribute("content", "Dealer Social");
    await expect(
      page.locator('meta[name="apple-mobile-web-app-status-bar-style"]'),
    ).toHaveAttribute("content", "black-translucent");

    const manifestResponse = await request.get("/manifest.webmanifest");
    expect(manifestResponse.ok()).toBe(true);
    expect(manifestResponse.headers()["content-type"]).toContain("manifest+json");
    const manifest = (await manifestResponse.json()) as InstallManifest;
    expect(manifest).toMatchObject({
      id: "/",
      name: "Dealer Social Post AI",
      short_name: "Dealer Social",
      start_url: "/",
      scope: "/",
      display: "standalone",
    });
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);

    const requiredManifestIcons: ManifestIcon[] = [
      {
        src: "/dealer-social-dsp-v3-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/dealer-social-dsp-v3-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/dealer-social-dsp-v3-1024.png",
        sizes: "1024x1024",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/dealer-social-dsp-v3-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/dealer-social-dsp-v3-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/dealer-social-dsp-v3-maskable-1024.png",
        sizes: "1024x1024",
        type: "image/png",
        purpose: "maskable",
      },
    ];
    for (const requiredIcon of requiredManifestIcons) {
      expect(manifest.icons).toContainEqual(requiredIcon);
    }
    expect(manifest.icons?.filter((icon) => icon.purpose === "any")).toEqual(
      requiredManifestIcons.filter((icon) => icon.purpose === "any"),
    );
    expect(
      manifest.icons?.some(
        (icon) => icon.purpose === "any" && icon.type === "image/svg+xml",
      ),
    ).toBe(false);

    await Promise.all(
      installPngs.map(({ src, size }) => expectPng(request, src, size)),
    );
    await expectFullBleedArtwork(page, [
      "/dealer-social-dsp-v3-180.png",
      "/dealer-social-dsp-v3-maskable-192.png",
      "/dealer-social-dsp-v3-maskable-512.png",
      "/dealer-social-dsp-v3-maskable-1024.png",
    ]);
    await expectMaskableSafeZone(page, [
      "/dealer-social-dsp-v3-maskable-192.png",
      "/dealer-social-dsp-v3-maskable-512.png",
      "/dealer-social-dsp-v3-maskable-1024.png",
    ]);
    for (const size of [192, 512, 1024]) {
      const [regular, maskable] = await Promise.all([
        request.get(`/dealer-social-dsp-v3-${size}.png`),
        request.get(`/dealer-social-dsp-v3-maskable-${size}.png`),
      ]);
      expect((await regular.body()).equals(await maskable.body())).toBe(false);
    }
  });

  test("keeps authenticated Capture usable in iPhone standalone display mode", async ({
    page,
    context,
    browserName,
  }, testInfo) => {
    test.skip(
      browserName !== "chromium" || testInfo.project.name !== "chromium-phone-390",
      "The representative Chromium phone provides deterministic iPhone safe-area emulation.",
    );

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      const nativeMatchMedia = window.matchMedia.bind(window);
      window.matchMedia = ((query: string) => {
        const result = nativeMatchMedia(query);
        if (!query.includes("display-mode")) return result;
        const matches = query === "(display-mode: standalone)";
        return new Proxy(result, {
          get(target, property) {
            if (property === "matches") return matches;
            if (property === "media") return query;
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      }) as typeof window.matchMedia;
      Object.defineProperty(navigator, "standalone", {
        configurable: true,
        get: () => true,
      });
    });
    await stubAuthenticatedCapture(page);

    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setSafeAreaInsetsOverride", {
      insets: {
        top: 59,
        topMax: 59,
        right: 0,
        rightMax: 0,
        bottom: 34,
        bottomMax: 34,
        left: 0,
        leftMax: 0,
      },
    });

    try {
      await page.goto("/#/capture");
      await expect(
        page.getByRole("heading", { name: "Capture the handoff." }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => window.matchMedia("(display-mode: standalone)").matches,
        ),
      ).toBe(true);
      expect(
        await page.evaluate(
          () => (navigator as Navigator & { standalone?: boolean }).standalone,
        ),
      ).toBe(true);
      const standaloneMediaRule = await page.evaluate(() => {
        for (const styleSheet of Array.from(document.styleSheets)) {
          for (const rule of Array.from(styleSheet.cssRules)) {
            if (
              rule instanceof CSSMediaRule &&
              rule.conditionText.includes("display-mode: standalone")
            ) {
              return rule.cssText;
            }
          }
        }
        return "";
      });
      expect(standaloneMediaRule).toContain("body");
      expect(standaloneMediaRule).toContain("padding-top: 0px");

      const impersonationBanner = page
        .getByRole("status")
        .filter({ hasText: "Impersonating" });
      await expect(impersonationBanner).toBeVisible();
      const stackedChrome = await page.evaluate(() => {
        const banner = Array.from(
          document.querySelectorAll<HTMLElement>("[role=status]"),
        ).find((element) => element.textContent?.includes("Impersonating"));
        const header = document.querySelector<HTMLElement>("header");
        if (!banner || !header || !header.parentElement) {
          throw new Error("Missing shell chrome");
        }
        const prompt = document.createElement("section");
        prompt.className = "pwa-update-prompt";
        prompt.style.height = "80px";
        header.parentElement.insertBefore(prompt, header);
        const promptBounds = prompt.getBoundingClientRect();
        const bannerBounds = banner.getBoundingClientRect();
        const headerBounds = header.getBoundingClientRect();
        const result = {
          promptPosition: getComputedStyle(prompt).position,
          bannerBottom: bannerBounds.bottom,
          promptTop: promptBounds.top,
          promptBottom: promptBounds.bottom,
          headerTop: headerBounds.top,
        };
        prompt.remove();
        return result;
      });
      expect(stackedChrome.promptPosition).toBe("relative");
      expect(stackedChrome.promptTop).toBeGreaterThanOrEqual(
        stackedChrome.bannerBottom,
      );
      expect(stackedChrome.headerTop).toBeGreaterThanOrEqual(
        stackedChrome.promptBottom,
      );

      const shell = await page.locator("#root").evaluate((element) => {
        const rootBounds = element.getBoundingClientRect();
        const bodyBounds = document.body.getBoundingClientRect();
        const rootStyle = getComputedStyle(element);
        const bodyStyle = getComputedStyle(document.body);
        return {
          viewportHeight: window.innerHeight,
          visualViewportHeight: window.visualViewport?.height ?? window.innerHeight,
          rootBottom: rootBounds.bottom,
          bodyBottom: bodyBounds.bottom,
          rootPaddingTop: Number.parseFloat(rootStyle.paddingTop),
          rootPaddingBottom: Number.parseFloat(rootStyle.paddingBottom),
          bodyPaddingTop: Number.parseFloat(bodyStyle.paddingTop),
          documentOverflow:
            document.documentElement.scrollHeight -
            document.documentElement.clientHeight,
        };
      });
      expect(shell.visualViewportHeight).toBe(shell.viewportHeight);
      expect(shell.rootBottom).toBe(shell.viewportHeight);
      expect(shell.bodyBottom).toBe(shell.viewportHeight);
      expect(shell.rootPaddingTop).toBe(59);
      expect(shell.rootPaddingBottom).toBe(34);
      expect(shell.bodyPaddingTop).toBe(0);
      expect(shell.documentOverflow).toBe(0);

      const mainContent = page.locator("#main-content");
      const takePhoto = page.getByRole("button", { name: "Take photo" });
      const chooseFromDevice = page.getByRole("button", {
        name: "Choose from device",
      });
      await expect(takePhoto).toBeVisible();
      await expect(chooseFromDevice).toBeVisible();

      await mainContent.evaluate((element) => {
        element.style.scrollBehavior = "auto";
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

      const bottomReach = await page.evaluate(() => {
        const main = document.querySelector<HTMLElement>("#main-content");
        const grid = document.querySelector<HTMLElement>(".capture-studio-grid");
        const sidebar = document.querySelector<HTMLElement>(".capture-studio-sidebar");
        const choose = Array.from(document.querySelectorAll("button")).find(
          (button) => button.textContent?.trim() === "Choose from device",
        );
        if (!main || !grid || !sidebar || !choose) return null;
        const mainBounds = main.getBoundingClientRect();
        const gridBounds = grid.getBoundingClientRect();
        const sidebarBounds = sidebar.getBoundingClientRect();
        const chooseBounds = choose.getBoundingClientRect();
        return {
          mainBottom: mainBounds.bottom,
          gridBottom: gridBounds.bottom,
          sidebarBottom: sidebarBounds.bottom,
          chooseBottom: chooseBounds.bottom,
          viewportHeight: window.innerHeight,
          mainBottomPadding: Number.parseFloat(getComputedStyle(main).paddingBottom),
        };
      });
      expect(bottomReach).not.toBeNull();
      expect(bottomReach!.mainBottom).toBeLessThanOrEqual(
        bottomReach!.viewportHeight - shell.rootPaddingBottom + 1,
      );
      expect(bottomReach!.gridBottom).toBeLessThanOrEqual(
        bottomReach!.mainBottom - bottomReach!.mainBottomPadding + 1,
      );
      expect(bottomReach!.sidebarBottom).toBeLessThanOrEqual(
        bottomReach!.mainBottom + 1,
      );
      expect(bottomReach!.chooseBottom).toBeLessThanOrEqual(
        bottomReach!.mainBottom + 1,
      );
    } finally {
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
  });
});
