import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fileURLToPath } from "node:url";

test("builds, saves and exports a real decoded vehicle spin on phones", async ({
  page,
}, info) => {
  test.skip(
    !info.project.name.endsWith("phone-390"),
    "Video encoding is exercised on one phone per browser engine.",
  );
  test.setTimeout(180000);
  const frames = new Map<number, Buffer>();
  let saved: Record<string, unknown> | null = null;
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => true,
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: ShareData) => {
        (window as unknown as { __shared: { type: string; name: string } }).__shared = {
          type: data.files?.[0]?.type || "",
          name: data.files?.[0]?.name || "",
        };
      },
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as unknown as { __copied: string }).__copied = value;
        },
      },
    });
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path === "/api/app/session")
      return route.fulfill({
        json: {
          role: "salesperson",
          dealer: {
            id: "spin-qa-store",
            name: "Northline Motors",
            requires_approval: false,
          },
          person: {
            id: "spin-qa-person",
            dealer: "spin-qa-store",
            name: "Jamie Test",
            role: "salesperson",
            active: true,
          },
        },
      });
    if (path === "/api/app/vehicle-spins" && method === "POST") {
      const input = route.request().postDataJSON();
      saved = {
        ...input,
        id: "spin-qa",
        dealerName: "Northline Motors",
        state: "uploading",
        canDeliver: false,
        uploadedAngles: [],
      };
      return route.fulfill({ status: 201, json: saved });
    }
    if (path === "/api/app/vehicle-spins")
      return route.fulfill({ json: { items: saved ? [saved] : [], canReview: false } });
    const angle = path.match(/\/vehicle-spins\/spin-qa\/frames\/(\d+)$/);
    if (angle) {
      const index = Number(angle[1]);
      if (method === "POST") {
        const body = route.request().postDataBuffer()!;
        const from = body.indexOf(Buffer.from("\r\n\r\n")) + 4;
        const to = body.lastIndexOf(Buffer.from("\r\n--"));
        let image = body.subarray(from, to);
        // WebKit's intercepted multipart requests omit file payload bytes.
        // Use the actual decoded preview as the server response fixture there;
        // the isolated PocketBase test separately verifies multipart storage.
        if (!image.length) {
          const url = await page
            .getByRole("region", { name: "Interactive vehicle view" })
            .getByRole("img")
            .getAttribute("src");
          image = Buffer.from(
            await page.evaluate(
              async (src) =>
                Array.from(new Uint8Array(await (await fetch(src!)).arrayBuffer())),
              url,
            ),
          );
        }
        frames.set(index, image);
        return route.fulfill({ json: { saved: true } });
      }
      return route.fulfill({ contentType: "image/jpeg", body: frames.get(index)! });
    }
    if (path === "/api/app/vehicle-spins/spin-qa/finish") {
      expect(frames.size).toBe(48);
      saved = {
        ...saved,
        state: "n_a",
        canDeliver: true,
        uploadedAngles: [...frames.keys()],
      };
      return route.fulfill({ json: saved });
    }
    if (path === "/api/app/vehicle-spins/spin-qa/export")
      return route.fulfill({ json: saved });
    if (path === "/api/app/vehicle-spins/spin-qa/share") {
      saved = { ...saved, linkToken: "a".repeat(48) };
      return route.fulfill({ json: saved });
    }
    if (path === "/api/app/vehicle-spins/spin-qa")
      return route.fulfill({ json: saved });
    return route.fulfill({ json: { items: [], success: true } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "360° vehicle studio", exact: true }).click();
  await page
    .getByLabel("Choose a walkaround video", { exact: true })
    .setInputFiles(
      fileURLToPath(new URL("./fixtures/studio-preview-6s.mp4", import.meta.url)),
    );
  await page.getByRole("button", { name: "Build 360° view", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "Your vehicle, angle 1 of 48" }),
  ).toBeVisible({ timeout: 60000 });
  await page.getByRole("button", { name: "Previous angle" }).click();
  await expect(page.getByRole("slider", { name: "View angle" })).toHaveValue("47");
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(page.getByText("Drag to inspect • Zoom out to spin")).toBeVisible();
  await page.getByRole("button", { name: "Reset view" }).click();
  await page.getByLabel("Vehicle name", { exact: true }).fill("2024 Test Vehicle");
  await page.getByLabel("Mileage", { exact: true }).fill("12345");
  await page
    .getByLabel("Caption and hashtags", { exact: true })
    .fill("Synthetic QA vehicle. #TestDrive");
  await page
    .getByRole("checkbox", {
      name: "I checked all angles, the background edges, and the vehicle facts.",
    })
    .check();
  await page
    .getByRole("checkbox", {
      name: "This recording shows the vehicle without identifiable customers or bystanders.",
    })
    .check();
  await page.getByRole("button", { name: "Save for sharing", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Ready to share", exact: true }),
  ).toBeVisible({ timeout: 60000 });
  expect(frames.size).toBe(48);
  for (const frame of frames.values()) {
    expect(frame[0]).toBe(255);
    expect(frame[1]).toBe(216);
    expect(frame.length).toBeLessThan(500000);
  }
  const exportButton = page.getByRole("button", {
    name: "Create vehicle video",
    exact: true,
  });
  if (await exportButton.isEnabled()) {
    await exportButton.click();
    const video = page.getByLabel("Exported vehicle video", { exact: true });
    await expect(video).toBeVisible({ timeout: 60000 });
    await expect
      .poll(() => video.evaluate((node: HTMLVideoElement) => node.videoWidth), {
        timeout: 10000,
      })
      .toBe(1080);
    expect(await video.evaluate((node: HTMLVideoElement) => node.videoHeight)).toBe(
      1920,
    );
    expect(
      await video.evaluate((node: HTMLVideoElement) =>
        Number.isFinite(node.duration) ? node.duration : 8,
      ),
    ).toBeGreaterThan(7);
    await page.getByRole("button", { name: "Share / Save video", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { __copied: string }).__copied),
      )
      .toBe("Synthetic QA vehicle. #TestDrive");
    const shared = await page.evaluate(
      () =>
        (window as unknown as { __shared: { type: string; name: string } }).__shared,
    );
    expect(shared.type).toMatch(/^video\/(mp4|webm)$/);
    expect(shared.name).toMatch(/2024-Test-Vehicle-360\.(mp4|webm)$/);
  } else {
    await expect(
      page.getByText(
        "Video export is unavailable in this browser. Your saved spin can be opened on another device.",
      ),
    ).toBeVisible();
    info.annotations.push({
      type: "encoder-unavailable",
      description: "The browser honestly disables unsupported recording.",
    });
  }
  await page.getByRole("button", { name: "Create customer link", exact: true }).click();
  await expect(page.getByLabel("Customer link", { exact: true })).toHaveValue(
    /#\/spin\/a{48}$/,
  );
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    )
    .toBe(true);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations
      .filter((v) => ["serious", "critical"].includes(v.impact || ""))
      .map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
  ).toEqual([]);
  await page.screenshot({
    path: info.outputPath("vehicle-spin-phone.png"),
    fullPage: true,
  });
});
