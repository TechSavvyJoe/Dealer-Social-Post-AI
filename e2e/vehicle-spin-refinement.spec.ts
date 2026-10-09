import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";

test.use({ serviceWorkers: "block" });

// Synthetic-fixture diagnostics only: never retain source URLs, media bytes,
// accounts, or request bodies. Keep a bounded history through failed imports.
const traceDecoder = async (page: Page) => {
  await page.addInitScript(() => {
    type Sample = {
      event: string;
      id: number;
      time: number;
      currentTime: number | null;
      readyState: number;
      networkState: number;
      seeking: boolean;
      paused: boolean;
      error: number | null;
      mediaTime?: number;
      presentedFrames?: number;
    };
    const history: Sample[] = [];
    const videos = new Map<HTMLVideoElement, number>();
    const finite = (value: number) => (Number.isFinite(value) ? value : null);
    const sample = (event: string, video: HTMLVideoElement) => ({
      event,
      id: videos.get(video)!,
      time: Math.round(performance.now()),
      currentTime: finite(video.currentTime),
      readyState: video.readyState,
      networkState: video.networkState,
      seeking: video.seeking,
      paused: video.paused,
      error: video.error?.code ?? null,
    });
    const record = (value: Sample) => {
      history.push(value);
      if (history.length > 512) history.shift();
    };
    const track = (video: HTMLVideoElement) => {
      if (videos.has(video)) return;
      videos.set(video, videos.size + 1);
      record(sample("attached", video));
      if (typeof video.requestVideoFrameCallback === "function") {
        const request = video.requestVideoFrameCallback.bind(video);
        video.requestVideoFrameCallback = (callback) =>
          request((now, metadata) => {
            record({
              ...sample("presented", video),
              mediaTime: metadata.mediaTime,
              presentedFrames: metadata.presentedFrames,
            });
            callback(now, metadata);
          });
      }
    };
    for (const event of [
      "loadedmetadata",
      "loadeddata",
      "canplay",
      "playing",
      "pause",
      "seeking",
      "seeked",
      "waiting",
      "stalled",
      "ended",
      "error",
      "emptied",
    ]) {
      document.addEventListener(
        event,
        (value) => {
          if (value.target instanceof HTMLVideoElement) {
            track(value.target);
            record(sample(event, value.target));
          }
        },
        true,
      );
    }
    new MutationObserver(() => {
      document.querySelectorAll("video").forEach(track);
    }).observe(document, { childList: true, subtree: true });
    setInterval(() => {
      for (const video of videos.keys()) {
        if (video.isConnected) record(sample("sample", video));
      }
    }, 250);
    Object.assign(window, {
      studioDecoderDiagnostic: () => ({
        history,
        latest: Array.from(videos.keys(), (video) => ({
          ...sample("latest", video),
          connected: video.isConnected,
        })),
        messages: Array.from(
          document.querySelectorAll('[role="status"], [role="alert"]'),
          (node) => node.textContent?.slice(0, 256),
        ).slice(0, 8),
      }),
    });
  });
};

const attachDecoderFailure = async (page: Page, info: TestInfo, stage: string) => {
  const diagnostic = await page.evaluate(() => {
    const inspect = (
      window as typeof window & { studioDecoderDiagnostic?: () => unknown }
    ).studioDecoderDiagnostic;
    return inspect?.() ?? { unavailable: true };
  });
  await info.attach("synthetic-decoder-failure", {
    body: JSON.stringify({ stage, diagnostic }),
    contentType: "application/json",
  });
  await info.attach("synthetic-studio-failure", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
};

const prepareStudio = async (page: Page, storageAvailable: boolean) => {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      json:
        path === "/api/app/session"
          ? {
              role: "salesperson",
              dealer: {
                id: "qa-store",
                name: "Northline Motors",
                requires_approval: false,
              },
              person: {
                id: "qa-person",
                dealer: "qa-store",
                name: "Jamie Test",
                role: "salesperson",
                active: true,
              },
            }
          : {
              items: [],
              canReview: false,
              capacity: {
                personalUsed: 1,
                personalLimit: 10,
                dealershipUsed: 1,
                dealershipLimit: 30,
                canCreate: storageAvailable,
                storageAvailable,
                reason: storageAvailable ? "" : "STORAGE",
              },
            },
    });
  });
};

test("trim controls preserve a cancelled source replacement and rebuild a fresh view", async ({
  page,
}, info) => {
  test.setTimeout(150000);
  await prepareStudio(page, false);
  await page.goto("/");
  await page.getByRole("button", { name: "360° vehicle studio", exact: true }).click();
  const source = fileURLToPath(
    new URL("./fixtures/studio-preview-6s.mp4", import.meta.url),
  );
  await page
    .getByLabel("Choose a walkaround video", { exact: true })
    .setInputFiles(source);
  const start = page.getByLabel("Start (seconds)", { exact: true });
  const end = page.getByLabel("End (seconds)", { exact: true });
  await start.fill("1");
  await end.fill("5");
  await expect(page.getByText("4.0 seconds selected of 6.0")).toBeVisible();
  await page.getByRole("button", { name: "Use full walkaround", exact: true }).click();
  await expect(start).toHaveValue("0");
  await expect(end).toHaveValue("6");
  await expect(
    page.getByRole("slider", { name: "Trim start", exact: true }),
  ).toHaveValue("0");
  await page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Choose one complete turn", exact: true }),
    })
    .screenshot({
      path: info.outputPath("vehicle-spin-trim.png"),
    });
  await page.getByRole("button", { name: "Build 360° view", exact: true }).click();
  const image = page.getByRole("img", {
    name: "Your vehicle, angle 1 of 48",
    exact: true,
  });
  await expect(image).toBeVisible({ timeout: 60000 });
  await expect
    .poll(() =>
      image.evaluate(
        (node: HTMLImageElement) => node.complete && node.naturalWidth > 0,
      ),
    )
    .toBe(true);
  const original = await image.getAttribute("src");
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("discard its unsaved angles");
    await dialog.dismiss();
  });
  await page
    .getByLabel("Choose a walkaround video", { exact: true })
    .setInputFiles(source);
  await expect(
    page.getByRole("status").filter({ hasText: "Opening video" }),
  ).toHaveCount(0, { timeout: 25000 });
  await expect(image).toHaveAttribute("src", original!);
  await page.getByRole("button", { name: "Next angle", exact: true }).click();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.getByRole("button", { name: "Rebuild 360° view", exact: true }).click();
  await expect(image).toBeVisible({ timeout: 60000 });
  await expect(image).toHaveAttribute("style", /scale\(1\)/);
  await page
    .getByRole("region", { name: "Interactive vehicle view", exact: true })
    .screenshot({
      path: info.outputPath("spin-controls-only.png"),
    });
  await page.getByLabel("Vehicle name", { exact: true }).fill("Synthetic vehicle");
  await page
    .getByRole("checkbox", {
      name: "I checked all angles, the background edges, and the vehicle facts.",
      exact: true,
    })
    .check();
  await page
    .getByRole("checkbox", {
      name: "This recording shows the vehicle without identifiable customers or bystanders.",
      exact: true,
    })
    .check();
  await expect(
    page.getByRole("button", { name: "Save for sharing", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText(
      "Archive storage is limited. Keep this page open; this recording has not been saved. Ask your administrator before saving.",
      { exact: true },
    ),
  ).toBeVisible();
});

// A synthetic still fixture is a meaningful rendering reference, not capture or rotation proof.
for (const fixture of [
  {
    name: "decoded vehicle fixture paints recognizable pixels in the phone viewer",
    file: "vehicle-background-fixture.mp4",
  },
  {
    name: "6fps vehicle import builds all 48 quantized samples with decoded pixels",
    file: "vehicle-low-fps-fixture.mp4",
  },
])
  test(fixture.name, async ({ page }, info) => {
    test.setTimeout(120000);
    const lowFps = fixture.file === "vehicle-low-fps-fixture.mp4";
    if (lowFps) await traceDecoder(page);
    let stage = "open-studio";
    try {
      await prepareStudio(page, true);
      await page.goto("/");
      await page
        .getByRole("button", { name: "360° vehicle studio", exact: true })
        .click();
      stage = "load-source";
      await page
        .getByLabel("Choose a walkaround video", { exact: true })
        .setInputFiles(
          fileURLToPath(new URL("./fixtures/" + fixture.file, import.meta.url)),
        );
      const buildStarted = Date.now();
      stage = "start-build";
      await page.getByRole("button", { name: "Build 360° view", exact: true }).click();
      stage = "wait-for-48-frame-view";
      const image = page.getByRole("img", {
        name: "Your vehicle, angle 1 of 48",
        exact: true,
      });
      await expect(image).toBeVisible({ timeout: 60000 });
      const buildMilliseconds = Date.now() - buildStarted;
      await info.attach("full-48-frame-build-time", {
        body: JSON.stringify({ fixture: fixture.file, buildMilliseconds }),
        contentType: "application/json",
      });
      console.log(fixture.file + " full 48-frame build: " + buildMilliseconds + "ms");
      stage = "paint-first-frame";
      await expect
        .poll(() =>
          image.evaluate(
            (node: HTMLImageElement) => node.complete && node.naturalWidth > 0,
          ),
        )
        .toBe(true);
      const pixels = await image.evaluate(async (node: HTMLImageElement) => {
        await node.decode();
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        const canvas = document.createElement("canvas");
        canvas.width = node.naturalWidth;
        canvas.height = node.naturalHeight;
        const context = canvas.getContext("2d")!;
        context.drawImage(node, 0, 0);
        const values = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let min = 255,
          max = 0,
          total = 0,
          count = 0;
        for (let index = 0; index < values.length; index += 256) {
          const light = (values[index] + values[index + 1] + values[index + 2]) / 3;
          min = Math.min(min, light);
          max = Math.max(max, light);
          total += light;
          count++;
        }
        return {
          width: node.naturalWidth,
          height: node.naturalHeight,
          min,
          max,
          mean: total / count,
        };
      });
      await info.attach("decoded-vehicle-pixels", {
        body: JSON.stringify(pixels),
        contentType: "application/json",
      });
      const frameBytes = await image.evaluate(async (node: HTMLImageElement) =>
        Array.from(new Uint8Array(await (await fetch(node.src)).arrayBuffer())),
      );
      await writeFile(
        info.outputPath("extracted-vehicle-angle.jpg"),
        Buffer.from(frameBytes),
      );
      expect(pixels.width).toBe(1280);
      expect(pixels.height).toBe(720);
      expect(pixels.max - pixels.min).toBeGreaterThan(100);
      expect(pixels.mean).toBeGreaterThan(25);
      if (lowFps) {
        // This fixture changes its blue timing band by 10 per decoded source frame.
        // At 6fps, two requested angles share a source frame; the final two angles
        // lie inside the last frame and must not require playback beyond EOF.
        const markers: { angle: number; blue: number }[] = [];
        const slider = page.getByRole("slider", { name: "View angle", exact: true });
        for (const angle of [0, 1, 24, 47]) {
          stage = "check-source-frame-" + angle;
          await slider.focus();
          await slider.press("Home");
          for (let step = 0; step < angle; step++) await slider.press("ArrowRight");
          const sample = page.getByRole("img", {
            name: "Your vehicle, angle " + (angle + 1) + " of 48",
            exact: true,
          });
          const blue = await sample.evaluate(async (node: HTMLImageElement) => {
            await node.decode();
            const canvas = document.createElement("canvas");
            canvas.width = node.naturalWidth;
            canvas.height = node.naturalHeight;
            const context = canvas.getContext("2d")!;
            context.drawImage(node, 0, 0);
            return context.getImageData(640, 32, 1, 1).data[2];
          });
          markers.push({ angle, blue });
          expect(blue).toBeGreaterThanOrEqual(Math.floor(angle / 2) * 10 - 5);
          expect(blue).toBeLessThanOrEqual(Math.floor(angle / 2) * 10 + 5);
        }
        await info.attach("quantized-source-frame-markers", {
          body: JSON.stringify(markers),
          contentType: "application/json",
        });
        await slider.press("Home");
        await image.evaluate((node: HTMLImageElement) => node.decode());
      }
      await page
        .getByRole("region", { name: "Interactive vehicle view", exact: true })
        .screenshot({ path: info.outputPath("vehicle-viewer-painted.png") });
    } catch (error) {
      if (lowFps) {
        await attachDecoderFailure(page, info, stage).catch(async () => {
          await info.attach("synthetic-decoder-stage", {
            body: JSON.stringify({ stage, diagnosticUnavailable: true }),
            contentType: "application/json",
          });
        });
      }
      throw error;
    }
  });
