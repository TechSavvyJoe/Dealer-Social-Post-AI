import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A React.lazy component starts its dynamic import when it first RENDERS, not
 * when it becomes visible. App.tsx rendered the Settings and Photo-review
 * modals unconditionally with isOpen={false}, so the unauthenticated login
 * screen pulled SettingsModal, ImageCropModal, mediaSave, imageUtils and their
 * icon chunks. Measured against the dev server on 2026-09-10:
 *
 *   before: SettingsModal, ImageCropModal, mediaSave, imageUtils all fetched
 *   after:  none of them fetched until the panel is opened
 *
 * Salespeople open the app on lot LTE, so this is real time before first paint.
 */
describe("lazy panels stay off the boot path", () => {
  const source = readFileSync(resolve(process.cwd(), "App.tsx"), "utf8");

  it("gates every lazy panel behind a first-open latch", () => {
    for (const [component, latch] of [
      ["LazySettingsModal", "settingsEverOpened"],
      ["LazyImageCropModal", "cropEverOpened"],
      ["LazyPostHistory", "historyEverOpened"],
    ] as const) {
      const at = source.indexOf(`<${component}`);
      expect(at, `${component} not found in App.tsx`).toBeGreaterThan(-1);

      // The latch guard must appear immediately before the element, not merely
      // somewhere in the file.
      const preceding = source.slice(Math.max(0, at - 200), at);
      expect(preceding, `${component} is not gated by ${latch}`).toContain(
        `${latch} && (`,
      );
    }
  });

  it("keeps the panel mounted after its first open, so the close animation runs", () => {
    // The latch must never go back to false; a plain `isOpen &&` would unmount
    // mid-exit and make closing feel broken.
    expect(source).toContain("const useMountedOnce = (open: boolean): boolean =>");
    expect(source).toContain("if (open) setMounted(true);");
    expect(source).toContain("return mounted || open;");
  });
});
