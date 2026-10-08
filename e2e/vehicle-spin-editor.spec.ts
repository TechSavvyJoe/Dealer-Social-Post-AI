import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";

// Recording six minutes of canvas/worker activity on a retry can exhaust a
// hosted runner. Keep failure screenshots and visible progress instead.
test.use({ trace: "off", screenshot: "only-on-failure" });

test("vehicle background controls preserve originals and refine the selected angle", async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== "chromium-desktop-1440",
    "Full 48-frame model sequence runs once; WebKit model and editor have separate coverage.",
  );
  test.setTimeout(720000);
  page.setDefaultTimeout(15000);
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      json:
        path === "/api/app/session"
          ? {
              role: "salesperson",
              dealer: {
                id: "qa-dealer",
                name: "Northline Motors",
                requires_approval: false,
              },
              person: {
                id: "qa-person",
                dealer: "qa-dealer",
                name: "Jamie Test",
                role: "salesperson",
                active: true,
              },
            }
          : { items: [], canReview: false },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "360° vehicle studio", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Every angle. One great view." }),
  ).toBeVisible();
  // Six-second still-video fixture derived from the repo's generated inventory
  // category image. It exercises editing, not real-world walkaround quality.
  await page
    .getByLabel("Choose a walkaround video", { exact: true })
    .setInputFiles(
      fileURLToPath(
        new URL("./fixtures/vehicle-background-fixture.mp4", import.meta.url),
      ),
    );
  await page.getByRole("button", { name: "Build 360° view", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "Your vehicle, angle 1 of 48" }),
  ).toBeVisible({ timeout: 60000 });
  const original = await page
    .getByRole("region", { name: "Interactive vehicle view" })
    .getByRole("img")
    .getAttribute("src");
  const digest = async (src: string | null) =>
    page.evaluate(
      async (url) =>
        Array.from(
          new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              await (await fetch(url!)).arrayBuffer(),
            ),
          ),
        ).join(","),
      src,
    );
  const originalDigest = await digest(original);
  await page.getByRole("button", { name: "Pearl studio", exact: true }).click();
  const picture = page
    .getByRole("region", { name: "Interactive vehicle view" })
    .getByRole("img");
  const box = await picture.boundingBox();
  // The source is 12:5, centered within the 8:5 viewer. x=60%, y=50% hits the door.
  await picture.click({ position: { x: box!.width * 0.6, y: box!.height * 0.5 } });
  const progressLog = setInterval(() => {
    void page
      .getByRole("status")
      .allTextContents()
      .then(
        (status) => console.log("Background editor progress:", status.join(" ")),
        () => undefined,
      );
  }, 30000);
  try {
    // The application permits ten minutes of processing. A slower CPU runner
    // must be allowed to reach that real limit instead of failing at six.
    await expect(
      page.getByRole("button", { name: "Restore missing detail", exact: true }),
    ).toBeEnabled({ timeout: 630000 });
  } finally {
    clearInterval(progressLog);
  }
  await expect(
    page.getByRole("button", { name: "Pearl studio", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Next angle", exact: true }).click();
  await page
    .getByRole("button", { name: "Restore missing detail", exact: true })
    .click();
  await expect(
    page.getByRole("group", { name: "Tap a missing part of the vehicle" }),
  ).toBeVisible();
  const refinedBox = await picture.boundingBox();
  await picture.click({
    position: { x: refinedBox!.width * 0.76, y: refinedBox!.height * 0.5 },
  });
  await expect(
    page.getByRole("button", { name: "Restore missing detail", exact: true }),
  ).toBeEnabled({ timeout: 60000 });
  await expect(page.getByRole("slider", { name: "View angle" })).toHaveValue("1");
  await page
    .getByLabel("Vehicle name", { exact: true })
    .fill("Vehicle background preview");
  await page
    .getByRole("heading", { name: "Every angle. One great view." })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath("vehicle-spin-refined-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Original", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Original", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Reset view" }).click();
  expect(await digest(await picture.getAttribute("src"))).toBe(originalDigest);
});
