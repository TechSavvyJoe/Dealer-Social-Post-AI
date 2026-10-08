import { test, expect } from "@playwright/test";
import { contentSecurityPolicy } from "../vercel";

test("self-hosted vehicle segmentation and edge corrections work under production CSP", async ({
  page,
}, info) => {
  test.skip(
    !info.project.name.endsWith("desktop-1440"),
    "One real model execution per browser engine.",
  );
  test.setTimeout(180000);
  await page.route("**/spin-model-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      headers: { "Content-Security-Policy": contentSecurityPolicy },
      body: "<!doctype html><html><head><title>Vehicle model test</title></head><body><main>Local vehicle background test</main></body></html>",
    }),
  );
  await page.goto("/spin-model-test");
  const result = await page.evaluate(async () => {
    // Exercise the actual worker/model; do not replace the segmentation API.
    const modulePath = "/utils/vehicleSpinBackground.ts";
    const { segmentSpinVehicle, composeSpinFrames } = await import(modulePath);
    const original = await (await fetch("/category/inventory.webp")).blob();
    const options = {
      signal: new AbortController().signal,
      onProgress: () => undefined,
    };
    const first = await segmentSpinVehicle([original], [{ x: 0.6, y: 0.5 }], options);
    const corrected = await segmentSpinVehicle(
      [original],
      [
        { x: 0.6, y: 0.5 },
        { x: 0.76, y: 0.5 },
        { x: 0.06, y: 0.1, remove: true },
      ],
      options,
    );
    const image = await createImageBitmap(corrected[0]);
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    image.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let opaque = 0,
      clear = 0;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] > 200) opaque++;
      if (pixels[i] < 30) clear++;
    }
    const composed = await composeSpinFrames(
      [original],
      corrected,
      "graphite",
      null,
      options.signal,
    );
    return {
      initial: first[0].type,
      corrected: corrected[0].type,
      opaque: opaque / (pixels.length / 4),
      clear: clear / (pixels.length / 4),
      output: composed[0].type,
      bytes: composed[0].size,
    };
  });
  expect(result.initial).toBe("image/png");
  expect(result.corrected).toBe("image/png");
  expect(result.opaque).toBeGreaterThan(0.04);
  expect(result.clear).toBeGreaterThan(0.06);
  expect(result.output).toBe("image/jpeg");
  expect(result.bytes).toBeLessThanOrEqual(500000);
});
